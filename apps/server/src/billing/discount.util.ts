/**
 * Pure, framework-agnostic discount + tax arithmetic — the ONE place a
 * customer-specific discount and GST are turned into paise. Used by
 * CheckoutService for plan, renewal, top-up and custom-plan prices, so
 * there is never a second implementation of this math to drift out of sync.
 *
 * Rounding rule: standard round-half-up via `Math.round`, matching every
 * other paise calculation already in this codebase (see
 * RatingEngineService.rateSegment's costPaise, and the pre-existing
 * taxPaise calculation this replaces in InvoiceBillingService).
 */

export interface InvoiceAmounts {
  /** Subtotal before discount and tax (e.g. the plan price). */
  subtotalPaise: number;
  /** The discount percentage applied, or null if none was active. */
  discountPercent: number | null;
  /** Discount amount in paise, subtracted from subtotalPaise. Always >= 0. */
  discountPaise: number;
  /** subtotalPaise - discountPaise — the base GST is computed on. */
  taxableAmountPaise: number;
  /** GST computed on taxableAmountPaise (post-discount), per taxPercent. */
  taxPaise: number;
  /** taxableAmountPaise + taxPaise — what the customer pays. */
  totalPaise: number;
}

/**
 * Discount amount in paise for a given subtotal + percentage.
 * `percentage` of 0/null/undefined always yields 0 — never NaN.
 */
export function calculateDiscountPaise(
  subtotalPaise: number,
  percentage: number | null | undefined,
): number {
  if (!percentage) return 0;
  return Math.round((subtotalPaise * percentage) / 100);
}

/**
 * Full discount + tax breakdown for a checkout. Order is fixed and must not
 * change: subtotal → discount → tax on the discounted (taxable) amount →
 * total.
 */
export function calculateInvoiceAmounts(params: {
  subtotalPaise: number;
  discountPercent: number | null | undefined;
  taxPercent: number;
}): InvoiceAmounts {
  const { subtotalPaise, taxPercent } = params;
  const discountPercent = params.discountPercent ?? null;
  const discountPaise = calculateDiscountPaise(subtotalPaise, discountPercent);
  const taxableAmountPaise = subtotalPaise - discountPaise;
  const taxPaise = Math.round(taxableAmountPaise * (taxPercent / 100));

  return {
    subtotalPaise,
    discountPercent,
    discountPaise,
    taxableAmountPaise,
    taxPaise,
    totalPaise: taxableAmountPaise + taxPaise,
  };
}

/** 0-100 inclusive integer. Rejects negative, >100, NaN, and non-integers. */
export function isValidDiscountPercentage(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 100
  );
}
