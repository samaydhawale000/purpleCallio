import { BadRequestException } from '@nestjs/common';
import {
  creditPurchaseAllocation,
  creditExpiryFromDays,
  creditsForPurchase,
} from './credit-pricing.util';

describe('credit pricing math', () => {
  it('floors amount divided by per-credit minor-unit price', () => {
    expect(creditsForPurchase(100_000, 20)).toBe(5_000);
    expect(creditsForPurchase(101, 20)).toBe(5);
  });

  it('reports allocated value and the remainder that is not carried forward', () => {
    expect(creditPurchaseAllocation(10_000, 20)).toEqual({
      credits: 500,
      allocatedPaise: 10_000,
      unallocatedPaise: 0,
    });
    expect(creditPurchaseAllocation(101, 20)).toEqual({
      credits: 5,
      allocatedPaise: 100,
      unallocatedPaise: 1,
    });
  });

  it('rejects non-positive or imprecise monetary values', () => {
    expect(() => creditsForPurchase(0, 20)).toThrow(BadRequestException);
    expect(() => creditsForPurchase(100, 0)).toThrow(BadRequestException);
    expect(() => creditsForPurchase(Number.MAX_SAFE_INTEGER + 1, 20)).toThrow(
      BadRequestException,
    );
  });

  it('uses UTC calendar-day validity for lot expiry', () => {
    const start = new Date('2026-01-10T20:30:00.000Z');
    expect(creditExpiryFromDays(start, 365).toISOString()).toBe(
      '2027-01-10T00:00:00.000Z',
    );
    expect(start.toISOString()).toBe('2026-01-10T20:30:00.000Z');
  });
});
