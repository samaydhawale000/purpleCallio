import { InvoiceBillingService } from './invoice-billing.service';

/**
 * Minimal hand-rolled fakes for exactly what InvoiceBillingService touches.
 * No mocking framework / NestJS TestingModule — matches this repo's existing
 * lightweight-fake test style (see usage-segment.service.spec.ts).
 */
function createFakePrisma() {
  const usageInvoices = new Map<string, any>();
  const usages = new Map<string, any>(); // key: `${companyId}|${cycleStart.toISOString()}`
  const callUsageRows: any[] = [];
  const prorationAdjustments: any[] = [];
  const users = new Map<string, any>();
  const subscriptionUpdates: any[] = [];
  const auditLogs: any[] = [];
  let invoiceSeq = 0;

  function usageKey(companyId: string, cycleStart: Date) {
    return `${companyId}|${cycleStart.toISOString()}`;
  }

  const prisma = {
    usageInvoice: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where.id) return usageInvoices.get(where.id) ?? null;
        const { userId, cycleStart } = where.userId_cycleStart;
        return (
          [...usageInvoices.values()].find(
            (i) => i.userId === userId && i.cycleStart.getTime() === cycleStart.getTime(),
          ) ?? null
        );
      }),
      findFirst: jest.fn(async ({ where }: any) => {
        return (
          [...usageInvoices.values()].find(
            (i) => i.id === where.id && i.userId === where.userId,
          ) ?? null
        );
      }),
      count: jest.fn(async () => usageInvoices.size),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `inv_${++invoiceSeq}`, createdAt: new Date(), ...data };
        usageInvoices.set(row.id, row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = usageInvoices.get(where.id);
        Object.assign(row, data);
        return row;
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const row of usageInvoices.values()) {
          if (row.id === where.id && (!where.status || row.status === where.status)) {
            Object.assign(row, data);
            count++;
          }
        }
        return { count };
      }),
    },
    usage: {
      findUnique: jest.fn(async ({ where }: any) => {
        const { companyId, billingCycleStart } = where.companyId_billingCycleStart;
        return usages.get(usageKey(companyId, billingCycleStart)) ?? null;
      }),
    },
    callUsage: {
      findMany: jest.fn(async ({ where }: any) =>
        callUsageRows.filter((c) => c.usageId === where.usageId),
      ),
    },
    prorationAdjustment: {
      findMany: jest.fn(async ({ where }: any) =>
        prorationAdjustments.filter((a) => a.userId === where.userId && a.consumedAt == null),
      ),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const a of prorationAdjustments) {
          if (where.id.in.includes(a.id)) {
            Object.assign(a, data);
            count++;
          }
        }
        return { count };
      }),
    },
    subscription: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        subscriptionUpdates.push({ where, data });
        return { count: 1 };
      }),
    },
    user: {
      findUnique: jest.fn(async ({ where }: any) => users.get(where.id) ?? null),
    },
    auditLog: {
      create: jest.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (fn: (tx: any) => Promise<any>) => fn(prisma)),
  };

  return {
    prisma,
    _internals: { usageInvoices, usages, callUsageRows, prorationAdjustments, users, subscriptionUpdates, auditLogs, usageKey },
  };
}

function makeUsageRow(companyId: string, cycleStart: Date, overrides: Partial<any> = {}) {
  return {
    id: `usage_${companyId}_${cycleStart.getTime()}`,
    companyId,
    billingCycleStart: cycleStart,
    billingCycleEnd: new Date(cycleStart.getTime() + 30 * 86400000),
    audioMinutes: 0,
    videoMinutes: 0,
    screenShareMinutes: 0,
    ...overrides,
  };
}

const DEFAULT_RATES = {
  audioPaise: 20,
  videoPaise: 80,
  screenSharePaise: 10,
  freeAudioMins: 500,
  freeVideoMins: 200,
  taxPercent: 18,
};

function makeUsageBillingStub(rates = DEFAULT_RATES, currentUsage: any = null) {
  return {
    getRates: jest.fn(async () => rates),
    getOrCreateUsage: jest.fn(async () => currentUsage),
  };
}

function makeDiscountStub(percentage: number | null, reason: string | null = null) {
  return {
    getActiveDiscount: jest.fn(async () =>
      percentage == null ? null : { percentage, reason },
    ),
  };
}

function makePaymentsStub(intent: any = { id: 'pay_1', status: 'captured' }) {
  return {
    isConfigured: jest.fn(() => true),
    createPaymentIntent: jest.fn(async () => intent),
  };
}

describe('InvoiceBillingService — generateInvoiceForCycle', () => {
  const USER_ID = 'user-peach';
  const CYCLE_START = new Date('2026-10-01T00:00:00Z');

  function makeService(opts: {
    rates?: typeof DEFAULT_RATES;
    usage?: any;
    discountPercentage?: number | null;
    discountReason?: string | null;
  } = {}) {
    const fake = createFakePrisma();
    if (opts.usage) {
      fake._internals.usages.set(
        fake._internals.usageKey(USER_ID, CYCLE_START),
        opts.usage,
      );
    }
    const usageBilling = makeUsageBillingStub(opts.rates ?? DEFAULT_RATES);
    const discounts = makeDiscountStub(opts.discountPercentage ?? null, opts.discountReason ?? null);
    const payments = makePaymentsStub();
    const service = new InvoiceBillingService(
      fake.prisma as never,
      payments as never,
      usageBilling as never,
      discounts as never,
    );
    return { service, fake, usageBilling, discounts, payments };
  }

  it('matches the worked Peach example exactly: 1000 audio + 500 video + 100 screen-share, 15% discount, 18% GST', async () => {
    const usage = makeUsageRow(USER_ID, CYCLE_START, {
      audioMinutes: 1000,
      videoMinutes: 500,
      screenShareMinutes: 100,
    });
    // Free allowance = 0 for this test so the raw usage IS the billable
    // usage — isolates the discount+tax math from the free-allowance step
    // (which is covered separately below).
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0, freeVideoMins: 0 };
    const { service } = makeService({ usage, rates, discountPercentage: 15 });

    const invoice = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;

    expect(invoice.audioPaise).toBe(1000 * 20); // 20000
    expect(invoice.videoPaise).toBe(500 * 80); // 40000
    expect(invoice.screenSharePaise).toBe(100 * 10); // 1000
    expect(invoice.subtotalPaise).toBe(61000); // ₹610 — raw usage subtotal, unaffected by discount
    expect(invoice.discountPercent).toBe(15);
    expect(invoice.discountPaise).toBe(9150); // ₹91.50
    expect(invoice.taxPaise).toBe(9333); // 18% of (61000-9150) = 9333
    expect(invoice.totalPaise).toBe(51850 + 9333); // ₹518.50 taxable + GST
  });

  it('free allowance is applied BEFORE the discount, not after', async () => {
    // 700 audio minutes, 500 free -> 200 billable, at ₹0.20/min = ₹40 = 4000 paise.
    const usage = makeUsageRow(USER_ID, CYCLE_START, { audioMinutes: 700 });
    const { service } = makeService({ usage, discountPercentage: 10 });

    const invoice = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;

    expect(invoice.audioMinutes).toBe(200); // billable, post-allowance
    expect(invoice.subtotalPaise).toBe(4000);
    // WRONG (discount-then-allowance) would be: 700*20*0.9=12600, not this.
    expect(invoice.discountPaise).toBe(400); // 10% of 4000
    expect(invoice.subtotalPaise - invoice.discountPaise).toBe(3600);
  });

  it.each([0, 10, 15, 25, 100])('correctly discounts at %i%%', async (pct) => {
    const usage = makeUsageRow(USER_ID, CYCLE_START, { audioMinutes: 1000 });
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0 };
    const { service } = makeService({ usage, rates, discountPercentage: pct || null });

    const invoice = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;
    const expectedDiscount = Math.round(20000 * (pct / 100));
    expect(invoice.discountPaise).toBe(expectedDiscount);
    expect(invoice.totalPaise).toBeGreaterThanOrEqual(0);
    if (pct === 100) {
      expect(invoice.totalPaise).toBe(0); // fully free: no taxable amount, no tax
    }
  });

  it('with no active discount, behaves exactly as the pre-discount-feature calculation', async () => {
    const usage = makeUsageRow(USER_ID, CYCLE_START, { audioMinutes: 1000 });
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0 };
    const { service } = makeService({ usage, rates, discountPercentage: null });

    const invoice = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;

    expect(invoice.discountPercent).toBeNull();
    expect(invoice.discountPaise).toBe(0);
    expect(invoice.subtotalPaise).toBe(20000);
    expect(invoice.taxPaise).toBe(Math.round(20000 * 0.18)); // taxed on full subtotal, unchanged
    expect(invoice.totalPaise).toBe(20000 + Math.round(20000 * 0.18));
  });

  it('a disabled/expired discount (resolver returns null) bills exactly like no discount', async () => {
    const usage = makeUsageRow(USER_ID, CYCLE_START, { audioMinutes: 1000 });
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0 };
    const { service, discounts } = makeService({ usage, rates, discountPercentage: null });

    const invoice = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;
    expect(discounts.getActiveDiscount).toHaveBeenCalledWith(USER_ID, CYCLE_START);
    expect(invoice.discountPaise).toBe(0);
  });

  it('resolves the discount AS OF the cycle start, not "now" — the mechanism behind automatic recurring billing', async () => {
    const usage = makeUsageRow(USER_ID, CYCLE_START, { audioMinutes: 1000 });
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0 };
    const { service, discounts } = makeService({ usage, rates, discountPercentage: 15 });

    await service.generateInvoiceForCycle(USER_ID, CYCLE_START);

    expect(discounts.getActiveDiscount).toHaveBeenCalledTimes(1);
    expect(discounts.getActiveDiscount).toHaveBeenCalledWith(USER_ID, CYCLE_START);
  });

  it('a discount continues automatically across multiple recurring cycles with no admin action', async () => {
    const cycle1 = new Date('2026-10-01T00:00:00Z');
    const cycle2 = new Date('2026-11-01T00:00:00Z');
    const cycle3 = new Date('2026-12-01T00:00:00Z');

    const fake = createFakePrisma();
    for (const [cycle, audioMinutes] of [[cycle1, 100], [cycle2, 200], [cycle3, 120]] as const) {
      fake._internals.usages.set(
        fake._internals.usageKey(USER_ID, cycle),
        makeUsageRow(USER_ID, cycle, { audioMinutes }),
      );
    }
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0 };
    const usageBilling = makeUsageBillingStub(rates);
    const discounts = makeDiscountStub(15); // same 15% every time, no admin action between cycles
    const service = new InvoiceBillingService(
      fake.prisma as never,
      makePaymentsStub() as never,
      usageBilling as never,
      discounts as never,
    );

    const inv1 = (await service.generateInvoiceForCycle(USER_ID, cycle1))!;
    const inv2 = (await service.generateInvoiceForCycle(USER_ID, cycle2))!;
    const inv3 = (await service.generateInvoiceForCycle(USER_ID, cycle3))!;

    expect(inv1.discountPercent).toBe(15);
    expect(inv2.discountPercent).toBe(15);
    expect(inv3.discountPercent).toBe(15);
    expect(inv1.discountPaise).toBe(300); // 15% of 100*20=2000
    expect(inv2.discountPaise).toBe(600); // 15% of 200*20=4000
    expect(inv3.discountPaise).toBe(360); // 15% of 120*20=2400
  });

  it('a discount change between cycles affects only the later cycle, not the earlier one', async () => {
    const cycle1 = new Date('2026-10-01T00:00:00Z');
    const cycle2 = new Date('2026-11-01T00:00:00Z');

    const fake = createFakePrisma();
    for (const cycle of [cycle1, cycle2]) {
      fake._internals.usages.set(
        fake._internals.usageKey(USER_ID, cycle),
        makeUsageRow(USER_ID, cycle, { audioMinutes: 1000 }),
      );
    }
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0 };
    const usageBilling = makeUsageBillingStub(rates);
    // Simulate the resolver returning different percentages depending on the
    // asOf date passed — exactly what CustomerDiscountService does when an
    // admin changes the discount between cycle1 and cycle2.
    const getActiveDiscount = jest.fn(async (_userId: string, asOf: Date) =>
      asOf.getTime() < cycle2.getTime() ? { percentage: 15, reason: null } : { percentage: 20, reason: null },
    );
    const service = new InvoiceBillingService(
      fake.prisma as never,
      makePaymentsStub() as never,
      usageBilling as never,
      { getActiveDiscount } as never,
    );

    const inv1 = (await service.generateInvoiceForCycle(USER_ID, cycle1))!;
    const inv2 = (await service.generateInvoiceForCycle(USER_ID, cycle2))!;

    expect(inv1.discountPercent).toBe(15);
    expect(inv2.discountPercent).toBe(20);
  });

  it('a past invoice is never recalculated by re-generating for the same cycle after the discount changes', async () => {
    const usage = makeUsageRow(USER_ID, CYCLE_START, { audioMinutes: 1000 });
    const rates = { ...DEFAULT_RATES, freeAudioMins: 0 };
    const fake = createFakePrisma();
    fake._internals.usages.set(fake._internals.usageKey(USER_ID, CYCLE_START), usage);
    const usageBilling = makeUsageBillingStub(rates);

    let currentPercentage = 15;
    const getActiveDiscount = jest.fn(async () => ({ percentage: currentPercentage, reason: null }));
    const service = new InvoiceBillingService(
      fake.prisma as never,
      makePaymentsStub() as never,
      usageBilling as never,
      { getActiveDiscount } as never,
    );

    const firstGeneration = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;
    expect(firstGeneration.discountPercent).toBe(15);

    // Admin changes the discount AFTER October's invoice was already generated.
    currentPercentage = 20;

    const secondCall = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;
    expect(secondCall.id).toBe(firstGeneration.id);
    expect(secondCall.discountPercent).toBe(15); // unchanged — existing invoice returned as-is
    expect(secondCall.discountPaise).toBe(firstGeneration.discountPaise);
  });

  it('persists the discount reason onto the invoice for historical display', async () => {
    const usage = makeUsageRow(USER_ID, CYCLE_START, { audioMinutes: 1000 });
    const { service } = makeService({
      usage,
      rates: { ...DEFAULT_RATES, freeAudioMins: 0 },
      discountPercentage: 15,
      discountReason: 'Enterprise volume agreement',
    });

    const invoice = (await service.generateInvoiceForCycle(USER_ID, CYCLE_START))!;
    expect(invoice.discountReason).toBe('Enterprise volume agreement');
  });
});

describe('InvoiceBillingService — chargeInvoice (Razorpay amount + dunning)', () => {
  const USER_ID = 'user-peach';

  function makeServiceWithOpenInvoice(invoiceOverrides: Partial<any>, userOverrides: Partial<any> = {}) {
    const fake = createFakePrisma();
    const invoice = {
      id: 'inv_1',
      userId: USER_ID,
      status: 'open',
      totalPaise: 60183,
      currency: 'INR',
      ...invoiceOverrides,
    };
    fake._internals.usageInvoices.set(invoice.id, invoice);
    fake._internals.users.set(USER_ID, {
      id: USER_ID,
      razorpayCustomerId: 'cust_1',
      phone: '+911234567890',
      email: 'peach@example.com',
      razorpayTokenId: 'tok_1',
      ...userOverrides,
    });
    return { fake, invoice };
  }

  it('charges Razorpay for exactly invoice.totalPaise — the final amount after free allowance, discount, and tax', async () => {
    const { fake, invoice } = makeServiceWithOpenInvoice({ totalPaise: 51850 + 9333 });
    const payments = makePaymentsStub({ id: 'pay_1', status: 'captured' });
    const service = new InvoiceBillingService(
      fake.prisma as never,
      payments as never,
      makeUsageBillingStub() as never,
      makeDiscountStub(null) as never,
    );

    await service.chargeInvoice(USER_ID, invoice.id);

    expect(payments.createPaymentIntent).toHaveBeenCalledWith(
      expect.objectContaining({ amountPaise: 51850 + 9333 }),
    );
  });

  it('a failed payment still enters the existing dunning flow unchanged', async () => {
    const { fake, invoice } = makeServiceWithOpenInvoice({});
    const payments = {
      isConfigured: jest.fn(() => true),
      createPaymentIntent: jest.fn(async () => {
        throw new Error('card declined');
      }),
    };
    const service = new InvoiceBillingService(
      fake.prisma as never,
      payments as never,
      makeUsageBillingStub() as never,
      makeDiscountStub(null) as never,
    );

    const result = (await service.chargeInvoice(USER_ID, invoice.id))!;

    expect(result.status).toBe('dunning');
    expect(result.dunningStartedAt).toBeInstanceOf(Date);
    expect(result.nextRetryAt).toBeInstanceOf(Date);
    expect(fake._internals.subscriptionUpdates[0].data.status).toBe('PAST_DUE');
  });
});
