import { BillingInterval } from '@prisma/client';
import { addAnchoredMonth } from '../billing-cycle.util';

/**
 * End of a billing period that starts at `start`.
 *  - MONTH: `count` months later, on the anchor day-of-month (clamped to the
 *    month's length, so a Jan-31 start renews Feb-28 then Mar-31).
 *  - YEAR: `count` years later.
 *  - CUSTOM: `count` days later.
 */
export function addBillingInterval(
  start: Date,
  interval: BillingInterval,
  count = 1,
  anchorDay = start.getDate(),
): Date {
  const n = Math.max(1, count);
  if (interval === BillingInterval.CUSTOM) {
    return new Date(start.getTime() + n * 86_400_000);
  }
  if (interval === BillingInterval.YEAR) {
    const end = new Date(start);
    end.setFullYear(end.getFullYear() + n);
    return end;
  }
  let end = start;
  for (let i = 0; i < n; i++) {
    const next = addAnchoredMonth(end, anchorDay);
    next.setHours(
      start.getHours(),
      start.getMinutes(),
      start.getSeconds(),
      start.getMilliseconds(),
    );
    end = next;
  }
  return end;
}
