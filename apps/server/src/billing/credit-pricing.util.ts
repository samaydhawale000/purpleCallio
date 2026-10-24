import { BadRequestException } from '@nestjs/common';

/** Prices are per whole credit in minor currency units; no floating point is used. */
export function creditsForPurchase(
  amountPaise: number,
  creditPricePaise: number,
): number {
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0)
    throw new BadRequestException(
      'Purchase amount must be a positive whole number of minor units.',
    );
  if (!Number.isSafeInteger(creditPricePaise) || creditPricePaise <= 0)
    throw new BadRequestException(
      'Credit price must be a positive whole number of minor units.',
    );
  return Math.floor(amountPaise / creditPricePaise);
}

/** Exact integer allocation and unallocated remainder for a quoted amount. */
export function creditPurchaseAllocation(
  amountPaise: number,
  creditPricePaise: number,
) {
  const credits = creditsForPurchase(amountPaise, creditPricePaise);
  const allocatedPaise = credits * creditPricePaise;
  return {
    credits,
    allocatedPaise,
    unallocatedPaise: amountPaise - allocatedPaise,
  };
}

/** UTC-day expiry avoids deployment-host timezone affecting credit lots. */
export function creditExpiryFromDays(start: Date, validityDays: number): Date {
  if (!Number.isInteger(validityDays) || validityDays < 1)
    throw new BadRequestException(
      'Credit validity must be a positive whole number of days.',
    );
  const expiry = new Date(start);
  expiry.setUTCHours(0, 0, 0, 0);
  expiry.setUTCDate(expiry.getUTCDate() + validityDays);
  return expiry;
}
