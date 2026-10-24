import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CreditPricingStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { BillingAuditService } from './billing-audit.service';
import { creditsForPurchase } from './credit-pricing.util';

export interface CreditPricingInput {
  currency?: string;
  creditPricePaise?: number;
  /** Minimum customer purchase amount, in minor currency units (paise for INR). */
  minimumPurchasePaise?: number;
  purchasedValidityDays?: number;
  // Retained as an API-level advanced capability for scheduled publishing;
  // the main admin form intentionally does not expose it.
  effectiveAt?: string;
}

const integer = (label: string, n: unknown, min: number, max: number) => {
  if (!Number.isSafeInteger(n) || (n as number) < min || (n as number) > max)
    throw new BadRequestException(label);
  return n as number;
};

/** Drafts may be edited; published rate/policy snapshots are immutable. */
@Injectable()
export class CreditPricingService {
  constructor(
    private prisma: PrismaService,
    private audit: BillingAuditService,
  ) {}

  async current(currency = 'INR', now = new Date()) {
    return this.prisma.creditPricingVersion.findFirst({
      where: {
        currency: currency.toUpperCase(),
        status: {
          in: [CreditPricingStatus.PUBLISHED, CreditPricingStatus.SCHEDULED],
        },
        effectiveAt: { lte: now },
      },
      orderBy: [{ effectiveAt: 'desc' }, { version: 'desc' }],
    });
  }

  async currentCurrencies(now = new Date()) {
    const rows = await this.prisma.creditPricingVersion.findMany({
      where: {
        status: {
          in: [CreditPricingStatus.PUBLISHED, CreditPricingStatus.SCHEDULED],
        },
        effectiveAt: { lte: now },
      },
      select: { currency: true },
      orderBy: { currency: 'asc' },
    });
    return Promise.all(
      [...new Set(rows.map(({ currency }) => currency))].map((currency) =>
        this.current(currency, now),
      ),
    );
  }

  async list() {
    return this.prisma.creditPricingVersion.findMany({
      orderBy: [{ currency: 'asc' }, { version: 'desc' }],
    });
  }

  async createDraft(input: CreditPricingInput, actorId: string) {
    const data = this.validate(input, true);
    const currency = data.currency as string;
    const latest = await this.prisma.creditPricingVersion.findFirst({
      where: { currency },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const row = await this.prisma.creditPricingVersion.create({
      data: {
        ...data,
        currency,
        version: (latest?.version ?? 0) + 1,
        createdById: actorId,
      } as Prisma.CreditPricingVersionUncheckedCreateInput,
    });
    await this.audit.log({
      action: 'CREDIT_PRICING_DRAFT_CREATED',
      actorId,
      entity: 'CreditPricingVersion',
      entityId: row.id,
      newValue: row,
    });
    return row;
  }

  async updateDraft(id: string, input: CreditPricingInput, actorId: string) {
    const before = await this.prisma.creditPricingVersion.findUnique({
      where: { id },
    });
    if (!before) throw new NotFoundException('Pricing draft not found.');
    if (before.status !== CreditPricingStatus.DRAFT)
      throw new ConflictException('Only unpublished drafts can be edited.');
    const data = this.validate(input, false, before);
    const row = await this.prisma.creditPricingVersion.update({
      where: { id },
      data,
    });
    await this.audit.log({
      action: 'CREDIT_PRICING_DRAFT_UPDATED',
      actorId,
      entity: 'CreditPricingVersion',
      entityId: id,
      oldValue: before,
      newValue: row,
    });
    return row;
  }

  preview(input: CreditPricingInput) {
    const p = this.validate(input, true);
    const price = p.creditPricePaise as number;
    return {
      policy: p,
      examples: [10_000, 50_000, 100_000].map((purchaseAmountPaise) => ({
        purchaseAmountPaise,
        credits: creditsForPurchase(purchaseAmountPaise, price),
      })),
      rounding:
        'Credits are rounded down to whole credits. INR prices use paise (two decimal places); checkout keeps its existing tax and payable-amount calculation.',
    };
  }

  async publish(id: string, actorId: string, confirm: boolean) {
    if (confirm !== true)
      throw new BadRequestException(
        'Explicit publication confirmation is required.',
      );
    const draft = await this.prisma.creditPricingVersion.findUnique({
      where: { id },
    });
    if (!draft) throw new NotFoundException('Pricing draft not found.');
    if (draft.status !== CreditPricingStatus.DRAFT)
      throw new ConflictException(
        'Only an unpublished draft can be published.',
      );
    const now = new Date();
    const scheduled = draft.effectiveAt > now;
    const result = await this.prisma.$transaction(async (tx) => {
      if (!scheduled) {
        await tx.creditPricingVersion.updateMany({
          where: {
            currency: draft.currency,
            status: CreditPricingStatus.PUBLISHED,
          },
          data: { status: CreditPricingStatus.SUPERSEDED },
        });
      }
      return tx.creditPricingVersion.update({
        where: { id },
        data: {
          status: scheduled
            ? CreditPricingStatus.SCHEDULED
            : CreditPricingStatus.PUBLISHED,
          publishedById: actorId,
          publishedAt: now,
        },
      });
    });
    await this.audit.log({
      action: scheduled
        ? 'CREDIT_PRICING_SCHEDULED'
        : 'CREDIT_PRICING_PUBLISHED',
      actorId,
      entity: 'CreditPricingVersion',
      entityId: id,
      oldValue: draft,
      newValue: result,
    });
    return result;
  }

  async cancel(id: string, actorId: string) {
    const row = await this.prisma.creditPricingVersion.findUnique({
      where: { id },
    });
    if (!row) throw new NotFoundException('Pricing version not found.');
    if (
      row.status !== CreditPricingStatus.DRAFT &&
      row.status !== CreditPricingStatus.SCHEDULED
    )
      throw new ConflictException(
        'Only a draft or scheduled version can be cancelled.',
      );
    const cancelled = await this.prisma.creditPricingVersion.update({
      where: { id },
      data: { status: CreditPricingStatus.CANCELLED },
    });
    await this.audit.log({
      action: 'CREDIT_PRICING_CANCELLED',
      actorId,
      entity: 'CreditPricingVersion',
      entityId: id,
      oldValue: row,
      newValue: cancelled,
    });
    return cancelled;
  }

  async activateDue(now = new Date()) {
    const due = await this.prisma.creditPricingVersion.findMany({
      where: {
        status: CreditPricingStatus.SCHEDULED,
        effectiveAt: { lte: now },
      },
      orderBy: [{ effectiveAt: 'asc' }, { version: 'asc' }],
    });
    let activated = 0;
    for (const version of due) {
      const published = await this.prisma.$transaction(async (tx) => {
        const claimed = await tx.creditPricingVersion.updateMany({
          where: { id: version.id, status: CreditPricingStatus.SCHEDULED },
          data: { status: CreditPricingStatus.PUBLISHED },
        });
        if (!claimed.count) return null;
        await tx.creditPricingVersion.updateMany({
          where: {
            currency: version.currency,
            id: { not: version.id },
            status: CreditPricingStatus.PUBLISHED,
            effectiveAt: { lte: version.effectiveAt },
          },
          data: { status: CreditPricingStatus.SUPERSEDED },
        });
        return tx.creditPricingVersion.findUniqueOrThrow({
          where: { id: version.id },
        });
      });
      if (!published) continue;
      activated++;
      await this.audit.log({
        action: 'CREDIT_PRICING_PUBLISHED',
        actorId: published.publishedById,
        entity: 'CreditPricingVersion',
        entityId: published.id,
        newValue: published,
        extra: { activatedBySchedule: true },
      });
    }
    return activated;
  }

  private validate(
    input: CreditPricingInput,
    creating: boolean,
    baseline?: {
      currency: string;
      creditPricePaise: number;
      minimumPurchasePaise: number;
      purchasedValidityDays: number;
    },
  ) {
    const out: Record<string, unknown> = {};
    const currency = (
      input.currency ??
      baseline?.currency ??
      'INR'
    ).toUpperCase();
    // Credit prices are denominated in paise and the existing top-up checkout
    // currently processes INR only. Do not publish currencies the gateway
    // flow cannot charge.
    if (currency !== 'INR')
      throw new BadRequestException(
        'Credit pricing currently supports INR only.',
      );
    if (input.currency !== undefined || creating) out.currency = currency;

    const price = input.creditPricePaise ?? baseline?.creditPricePaise;
    if (input.creditPricePaise !== undefined || creating)
      out.creditPricePaise = integer(
        'Price per credit must be a positive amount in paise.',
        price,
        1,
        2_147_483_647,
      );

    const minimumPurchase =
      input.minimumPurchasePaise ?? baseline?.minimumPurchasePaise ?? 100_000;
    if (input.minimumPurchasePaise !== undefined || creating) {
      out.minimumPurchasePaise = integer(
        'Minimum purchase must be a positive whole amount in paise.',
        minimumPurchase,
        1,
        2_147_483_647,
      );
      if ((out.minimumPurchasePaise as number) < (price as number))
        throw new BadRequestException(
          'Minimum purchase must buy at least one whole credit.',
        );
    }

    const validity =
      input.purchasedValidityDays ?? baseline?.purchasedValidityDays ?? 365;
    if (input.purchasedValidityDays !== undefined || creating)
      out.purchasedValidityDays = integer(
        'Purchased credit validity must be a whole number from 1 to 3650 days.',
        validity,
        1,
        3650,
      );

    if (input.effectiveAt !== undefined) {
      const date = new Date(input.effectiveAt);
      if (!Number.isFinite(date.getTime()))
        throw new BadRequestException('Effective date must be a valid date.');
      out.effectiveAt = date;
    }
    return out;
  }
}
