import { BadRequestException } from '@nestjs/common';
import { CreditPricingService } from './credit-pricing.service';

describe('CreditPricingService admin draft validation', () => {
  const service = new CreditPricingService({} as never, {} as never);

  it('previews INR examples from an amount-only per-credit rate', () => {
    const preview = service.preview({
      currency: 'INR',
      creditPricePaise: 20,
      purchasedValidityDays: 365,
    });

    expect(preview.examples).toEqual([
      { purchaseAmountPaise: 10_000, credits: 500 },
      { purchaseAmountPaise: 50_000, credits: 2_500 },
      { purchaseAmountPaise: 100_000, credits: 5_000 },
    ]);
  });

  it('ignores obsolete empty purchase-bound fields from older clients', () => {
    expect(() =>
      service.preview({
        currency: 'INR',
        creditPricePaise: 20,
        purchasedValidityDays: 365,
        maximumPurchasePaise: '' as unknown as number,
      } as never),
    ).not.toThrow();
  });

  it('creates a draft without purchase-limit or auto-top-up form fields', async () => {
    const created = jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'draft-1',
        ...data,
      }),
    );
    const prisma = {
      creditPricingVersion: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: created,
      },
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const draftService = new CreditPricingService(
      prisma as never,
      audit as never,
    );

    await draftService.createDraft(
      {
        currency: 'INR',
        creditPricePaise: 20,
        purchasedValidityDays: 365,
        maximumPurchasePaise: '' as unknown as number,
      } as never,
      'admin-1',
    );

    expect(created).toHaveBeenCalledWith({
      data: {
        currency: 'INR',
        creditPricePaise: 20,
        purchasedValidityDays: 365,
        version: 1,
        createdById: 'admin-1',
      },
    });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('requires a positive whole-paise price and bounded whole-day validity', () => {
    expect(() =>
      service.preview({ currency: 'INR', creditPricePaise: 0 }),
    ).toThrow(
      new BadRequestException(
        'Price per credit must be a positive amount in paise.',
      ),
    );
    expect(() =>
      service.preview({
        currency: 'INR',
        creditPricePaise: 20,
        purchasedValidityDays: 365.5,
      }),
    ).toThrow(
      new BadRequestException(
        'Purchased credit validity must be a whole number from 1 to 3650 days.',
      ),
    );
  });

  it('rejects currencies that the current paise-based checkout does not support', () => {
    expect(() =>
      service.preview({ currency: 'USD', creditPricePaise: 20 }),
    ).toThrow(
      new BadRequestException('Credit pricing currently supports INR only.'),
    );
  });
});
