import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TopUpPackage, TopUpStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingAuditService } from '../billing-audit.service';

export interface TopUpInput {
  name?: string;
  description?: string | null;
  pricePaise?: number;
  currency?: string;
  credits?: number;
  status?: TopUpStatus;
  displayOrder?: number;
  isPopular?: boolean;
}

export function serializeTopUp(t: TopUpPackage) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    pricePaise: t.pricePaise,
    currency: t.currency,
    credits: t.credits,
    status: t.status,
    displayOrder: t.displayOrder,
    isPopular: t.isPopular,
  };
}

/** One-time prepaid credit packages, fully admin-managed. */
@Injectable()
export class TopUpService {
  constructor(
    private prisma: PrismaService,
    private audit: BillingAuditService,
  ) {}

  async listActive() {
    const rows = await this.prisma.topUpPackage.findMany({
      where: { status: TopUpStatus.ACTIVE },
      orderBy: [{ displayOrder: 'asc' }, { pricePaise: 'asc' }],
    });
    return rows.map(serializeTopUp);
  }

  async listAll() {
    const rows = await this.prisma.topUpPackage.findMany({
      orderBy: [{ status: 'asc' }, { displayOrder: 'asc' }],
    });
    const sold = await this.prisma.payment.groupBy({
      by: ['topUpPackageId'],
      where: {
        purpose: 'TOPUP',
        paymentStatus: 'PAID',
        topUpPackageId: { not: null },
      },
      _count: true,
    });
    const counts = new Map(sold.map((s) => [s.topUpPackageId, s._count]));
    return rows.map((t) => ({
      ...serializeTopUp(t),
      purchases: counts.get(t.id) ?? 0,
      updatedAt: t.updatedAt,
    }));
  }

  async getActive(id: string) {
    const t = await this.prisma.topUpPackage.findUnique({ where: { id } });
    if (!t || t.status !== TopUpStatus.ACTIVE)
      throw new NotFoundException('Top-up package not available');
    return t;
  }

  async create(input: TopUpInput, actorId: string) {
    const data = this.validate(input, true);
    const created = await this.prisma.topUpPackage.create({
      data: data as Required<typeof data> & {
        name: string;
        pricePaise: number;
        credits: number;
      },
    });
    await this.audit.log({
      action: 'TOPUP_PACKAGE_CREATED',
      actorId,
      entity: 'TopUpPackage',
      entityId: created.id,
      newValue: serializeTopUp(created),
    });
    return serializeTopUp(created);
  }

  /** Price/credit edits only affect future purchases — past payments snapshot both. */
  async update(id: string, input: TopUpInput, actorId: string) {
    const before = await this.prisma.topUpPackage.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Top-up package not found');
    const updated = await this.prisma.topUpPackage.update({
      where: { id },
      data: this.validate(input, false),
    });
    await this.audit.log({
      action: 'TOPUP_PACKAGE_UPDATED',
      actorId,
      entity: 'TopUpPackage',
      entityId: id,
      oldValue: serializeTopUp(before),
      newValue: serializeTopUp(updated),
    });
    return serializeTopUp(updated);
  }

  private validate(input: TopUpInput, creating: boolean) {
    const out: Partial<TopUpPackage> = {};
    if (input.name !== undefined || creating) {
      if (!input.name?.trim())
        throw new BadRequestException('Name is required.');
      out.name = input.name.trim().slice(0, 80);
    }
    if (input.description !== undefined)
      out.description = input.description?.trim().slice(0, 300) || null;
    if (input.pricePaise !== undefined || creating) {
      if (
        !Number.isInteger(input.pricePaise) ||
        (input.pricePaise as number) < 100
      ) {
        throw new BadRequestException('Price must be at least ₹1 (100 paise).');
      }
      out.pricePaise = input.pricePaise;
    }
    if (input.credits !== undefined || creating) {
      if (!Number.isInteger(input.credits) || (input.credits as number) <= 0) {
        throw new BadRequestException(
          'Credits must be a positive whole number.',
        );
      }
      out.credits = input.credits;
    }
    if (input.currency !== undefined) {
      if (!/^[A-Z]{3}$/.test(input.currency))
        throw new BadRequestException('currency must be a 3-letter ISO code.');
      out.currency = input.currency;
    }
    if (input.status !== undefined) {
      if (!Object.values(TopUpStatus).includes(input.status))
        throw new BadRequestException('Invalid status.');
      out.status = input.status;
    }
    if (input.displayOrder !== undefined) {
      if (!Number.isInteger(input.displayOrder))
        throw new BadRequestException('displayOrder must be a whole number.');
      out.displayOrder = input.displayOrder;
    }
    if (input.isPopular !== undefined) out.isPopular = Boolean(input.isPopular);
    return out;
  }
}
