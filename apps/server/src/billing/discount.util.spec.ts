import {
  calculateDiscountPaise,
  calculateInvoiceAmounts,
  isValidDiscountPercentage,
} from './discount.util';

describe('discount.util', () => {
  describe('calculateDiscountPaise', () => {
    it('returns 0 for no discount (0/null/undefined)', () => {
      expect(calculateDiscountPaise(61000, 0)).toBe(0);
      expect(calculateDiscountPaise(61000, null)).toBe(0);
      expect(calculateDiscountPaise(61000, undefined)).toBe(0);
    });

    it('computes 10% discount exactly', () => {
      expect(calculateDiscountPaise(10000, 10)).toBe(1000);
    });

    it('computes 15% discount exactly (the Peach example: ₹610 subtotal)', () => {
      // ₹610 = 61000 paise, matches the worked example in the spec exactly.
      expect(calculateDiscountPaise(61000, 15)).toBe(9150);
    });

    it('computes 25% discount exactly', () => {
      expect(calculateDiscountPaise(10000, 25)).toBe(2500);
    });

    it('computes 100% discount as the full subtotal (free)', () => {
      expect(calculateDiscountPaise(12345, 100)).toBe(12345);
    });

    it('rounds half-up via Math.round, matching the rest of the codebase', () => {
      expect(calculateDiscountPaise(17, 50)).toBe(9); // 8.5 -> 9
      expect(calculateDiscountPaise(5, 50)).toBe(3); // 2.5 -> 3 (round-half-up, not banker's — which would give 2)
    });
  });

  describe('calculateInvoiceAmounts', () => {
    it('matches the worked Peach example exactly: 1000 audio + 500 video + 100 screen at ₹0.20/₹0.80/₹0.10, 15% discount, 18% GST', () => {
      // Audio: 1000 * 20 = 20000 paise (₹200)
      // Video: 500 * 80 = 40000 paise (₹400)
      // Screen: 100 * 10 = 1000 paise (₹10)
      // Subtotal: 61000 paise (₹610)
      const result = calculateInvoiceAmounts({
        subtotalPaise: 61000,
        discountPercent: 15,
        taxPercent: 18,
      });
      expect(result.discountPaise).toBe(9150); // ₹91.50
      expect(result.taxableAmountPaise).toBe(51850); // ₹518.50
      expect(result.taxPaise).toBe(9333); // 18% of 51850 = 9333
      expect(result.totalPaise).toBe(51850 + 9333);
    });

    it('is a fully backward-compatible no-op when there is no discount', () => {
      const withoutDiscount = calculateInvoiceAmounts({
        subtotalPaise: 61000,
        discountPercent: null,
        taxPercent: 18,
      });
      expect(withoutDiscount.discountPaise).toBe(0);
      expect(withoutDiscount.taxableAmountPaise).toBe(61000);
      // Exactly the old (pre-discount-feature) calculation: subtotal * tax%.
      expect(withoutDiscount.taxPaise).toBe(Math.round(61000 * 0.18));
      expect(withoutDiscount.totalPaise).toBe(61000 + Math.round(61000 * 0.18));
    });

    it('applies tax on the DISCOUNTED amount, not the raw subtotal', () => {
      const result = calculateInvoiceAmounts({
        subtotalPaise: 100000,
        discountPercent: 20,
        taxPercent: 18,
      });
      // Wrong (pre-discount subtotal taxed): 100000 * 0.18 = 18000
      // Right (post-discount taxable base): 80000 * 0.18 = 14400
      expect(result.taxPaise).toBe(14400);
      expect(result.taxPaise).not.toBe(18000);
    });

    it('a 100% discount produces a zero-tax, zero-total invoice', () => {
      const result = calculateInvoiceAmounts({
        subtotalPaise: 61000,
        discountPercent: 100,
        taxPercent: 18,
      });
      expect(result.discountPaise).toBe(61000);
      expect(result.taxableAmountPaise).toBe(0);
      expect(result.taxPaise).toBe(0);
      expect(result.totalPaise).toBe(0);
    });
  });

  describe('isValidDiscountPercentage', () => {
    it.each([0, 10, 15, 25, 100])('accepts %i as valid', (v) => {
      expect(isValidDiscountPercentage(v)).toBe(true);
    });

    it.each([
      -1,
      -10,
      101,
      1000,
      NaN,
      Infinity,
      -Infinity,
      12.5,
      '15',
      null,
      undefined,
    ])('rejects %p as invalid', (v) => {
      expect(isValidDiscountPercentage(v)).toBe(false);
    });
  });
});
