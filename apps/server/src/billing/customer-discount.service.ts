import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { CustomerDiscount } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isValidDiscountPercentage } from './discount.util';

export interface SetDiscountInput {
  percentage: number;
  effectiveFrom: Date;
  effectiveUntil?: Date | null;
  reason?: string | null;
}

/**
 * Admin-assigned, customer-specific commercial discounts. This service owns:
 *  - resolving the discount active for a customer as of a given date
 *    (invoice generation and live previews always pass an explicit date —
 *    see InvoiceBillingService — so past invoices are never affected by a
 *    later discount change),
 *  - CRUD + the "only one active discount per customer" invariant,
 *  - audit logging for every change.
 *
 * Does NOT compute money — see discount.util.ts for the paise math, and
 * RatingEngineService/UsageBillingService for usage + free-allowance, which
 * this service never touches.
 */
@Injectable()
export class CustomerDiscountService {
  private readonly logger = new Logger(CustomerDiscountService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * The discount in effect for this customer at `asOf` (default: now), or
   * null if none applied at that moment. Effective-date rules: applies from
   * effectiveFrom (inclusive) through effectiveUntil (inclusive), or
   * indefinitely if effectiveUntil is null.
   *
   * Deliberately does NOT filter on `active` — resolution for a historical
   * `asOf` must keep working even after the discount has since been
   * replaced/disabled (which flips `active` to false). setDiscount/
   * disableDiscount instead close out a superseded record's effectiveUntil
   * at the exact moment it stopped applying, so the date range alone is
   * always the authoritative answer to "was a discount in effect on date X"
   * — `active` is purely a "is this the current forward-looking record"
   * flag for admin display (see getLatestDiscount).
   */
  async getActiveDiscount(
    companyId: string,
    asOf: Date = new Date(),
  ): Promise<CustomerDiscount | null> {
    return this.prisma.customerDiscount.findFirst({
      where: {
        companyId,
        effectiveFrom: { lte: asOf },
        OR: [{ effectiveUntil: null }, { effectiveUntil: { gte: asOf } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  /**
   * The most recent discount record for this customer regardless of
   * active/effective-date status — for admin display ("Discount: 15% —
   * Active" vs "Discount: 15% — Disabled" vs "No discount").
   */
  async getLatestDiscount(companyId: string): Promise<CustomerDiscount | null> {
    return this.prisma.customerDiscount.findFirst({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Create a new discount for this customer, deactivating any existing
   * active discount first (only one active discount per customer — no
   * stacking). The previous record is kept, not deleted, for audit/history.
   */
  async setDiscount(
    companyId: string,
    adminId: string,
    input: SetDiscountInput,
  ): Promise<CustomerDiscount> {
    this.validatePercentage(input.percentage);
    this.validateDates(input.effectiveFrom, input.effectiveUntil ?? null);

    return this.prisma.$transaction(async (tx) => {
      const previous = await tx.customerDiscount.findFirst({
        where: { companyId, active: true },
      });

      if (previous) {
        await tx.customerDiscount.update({
          where: { id: previous.id },
          data: {
            active: false,
            // Close the previous discount's effective window exactly where
            // the new one begins — unless it already ended earlier (a gap
            // between the two), in which case leave its true end alone.
            // This is what lets getActiveDiscount resolve historical dates
            // correctly without checking `active` at all.
            effectiveUntil:
              previous.effectiveUntil == null ||
              previous.effectiveUntil >= input.effectiveFrom
                ? input.effectiveFrom
                : previous.effectiveUntil,
          },
        });
      }

      const created = await tx.customerDiscount.create({
        data: {
          companyId,
          percentage: input.percentage,
          active: true,
          effectiveFrom: input.effectiveFrom,
          effectiveUntil: input.effectiveUntil ?? null,
          reason: input.reason ?? null,
          createdBy: adminId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: previous ? 'DISCOUNT_UPDATED' : 'DISCOUNT_CREATED',
          metadata: {
            companyId,
            previousPercentage: previous?.percentage ?? null,
            newPercentage: created.percentage,
            effectiveFrom: created.effectiveFrom,
            effectiveUntil: created.effectiveUntil,
            reason: created.reason,
          },
        },
      });

      this.logger.log(
        `Discount ${previous ? 'updated' : 'created'} for ${companyId}: ${created.percentage}% by admin ${adminId}`,
      );
      return created;
    });
  }

  /** Disables the customer's currently-active discount, if any. */
  async disableDiscount(
    companyId: string,
    adminId: string,
  ): Promise<CustomerDiscount | null> {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.customerDiscount.findFirst({
        where: { companyId, active: true },
      });
      if (!active) return null;

      const now = new Date();
      const updated = await tx.customerDiscount.update({
        where: { id: active.id },
        data: {
          active: false,
          // Close its window at the moment of disabling (unless it already
          // had an earlier effectiveUntil), for the same reason as above.
          effectiveUntil:
            active.effectiveUntil == null || active.effectiveUntil >= now
              ? now
              : active.effectiveUntil,
        },
      });

      await tx.auditLog.create({
        data: {
          actorId: adminId,
          action: 'DISCOUNT_DISABLED',
          metadata: { companyId, previousPercentage: active.percentage },
        },
      });

      this.logger.log(`Discount disabled for ${companyId} by admin ${adminId}`);
      return updated;
    });
  }

  private validatePercentage(value: unknown): void {
    if (!isValidDiscountPercentage(value)) {
      throw new BadRequestException(
        'percentage must be an integer between 0 and 100.',
      );
    }
  }

  private validateDates(
    effectiveFrom: Date,
    effectiveUntil: Date | null,
  ): void {
    if (
      !(effectiveFrom instanceof Date) ||
      Number.isNaN(effectiveFrom.getTime())
    ) {
      throw new BadRequestException('effectiveFrom must be a valid date.');
    }
    if (effectiveUntil != null) {
      if (
        !(effectiveUntil instanceof Date) ||
        Number.isNaN(effectiveUntil.getTime())
      ) {
        throw new BadRequestException('effectiveUntil must be a valid date.');
      }
      if (effectiveUntil <= effectiveFrom) {
        throw new BadRequestException(
          'effectiveUntil must be after effectiveFrom.',
        );
      }
    }
  }
}
