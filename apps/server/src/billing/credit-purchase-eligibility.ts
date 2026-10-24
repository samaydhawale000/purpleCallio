import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Who may buy prepaid credits (AUTO_TOPUP.md §1.1): any ACTIVE account that
 * finished onboarding (`profileCompleted`), unless an administrator set
 * `User.creditPurchaseBlocked`. Plan type no longer matters, and
 * `BillingConfig.freeAccountsCanPurchaseCredits` is not a purchase gate.
 */
export const CREDIT_PURCHASE_UNAVAILABLE = 'CREDIT_PURCHASE_UNAVAILABLE';

export type CreditPurchaseEligibility =
  | { eligible: true; code?: undefined; reason?: undefined }
  | {
      eligible: false;
      code: typeof CREDIT_PURCHASE_UNAVAILABLE;
      reason: string;
    };

export interface CreditPurchaseAccount {
  status: string;
  profileCompleted: boolean;
  creditPurchaseBlocked: boolean;
}

export const CREDIT_PURCHASE_ACCOUNT_SELECT = {
  status: true,
  profileCompleted: true,
  creditPurchaseBlocked: true,
} satisfies Prisma.UserSelect;

export function creditPurchaseEligibility(
  user: CreditPurchaseAccount | null | undefined,
): CreditPurchaseEligibility {
  const no = (reason: string): CreditPurchaseEligibility => ({
    eligible: false,
    code: CREDIT_PURCHASE_UNAVAILABLE,
    reason,
  });
  if (!user || user.status !== 'ACTIVE')
    return no(
      'Credit purchases are unavailable for this account. Contact support for help.',
    );
  if (!user.profileCompleted)
    return no('Complete your business profile before buying credits.');
  if (user.creditPurchaseBlocked)
    return no(
      'Credit purchases have been turned off for this account. Contact support for help.',
    );
  return { eligible: true };
}

/** 400 `{ code: 'CREDIT_PURCHASE_UNAVAILABLE', message }` when not eligible. */
export function assertCreditPurchaseEligible(
  user: CreditPurchaseAccount | null | undefined,
): void {
  const result = creditPurchaseEligibility(user);
  if (!result.eligible)
    throw new BadRequestException({
      code: result.code,
      message: result.reason,
    });
}
