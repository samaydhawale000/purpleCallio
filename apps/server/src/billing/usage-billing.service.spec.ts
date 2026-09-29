import { UsageBillingService } from './usage-billing.service';

/**
 * Focused on checkSpendingLimit's discount interaction (the one behavior
 * this task actually changes in UsageBillingService). getCurrentUsage's own
 * correctness is out of scope here — it's stubbed via a direct spy rather
 * than re-implemented, so these tests isolate exactly what changed.
 */
describe('UsageBillingService — checkSpendingLimit with a customer discount', () => {
  function makeService(opts: {
    spendingLimitPaise: number | null;
    rawBillableCostPaise: number;
    discountPercentage: number | null;
  }) {
    const prisma = {
      user: {
        findUnique: jest.fn(async () => ({ spendingLimitPaise: opts.spendingLimitPaise })),
      },
    };
    const discounts = {
      getActiveDiscount: jest.fn(async () =>
        opts.discountPercentage == null ? null : { percentage: opts.discountPercentage },
      ),
    };
    const service = new UsageBillingService(
      prisma as never,
      {} as never, // BillingService — unused by checkSpendingLimit
      discounts as never,
    );
    jest.spyOn(service, 'getCurrentUsage').mockResolvedValue({
      cost: { totalPaise: opts.rawBillableCostPaise },
    } as never);
    return { service, discounts };
  }

  it('no spending limit set → always allowed, regardless of discount', async () => {
    const { service } = makeService({
      spendingLimitPaise: null,
      rawBillableCostPaise: 1_000_000,
      discountPercentage: 15,
    });
    const result = await service.checkSpendingLimit('user-1');
    expect(result.allowed).toBe(true);
  });

  it('blocks when the raw (pre-discount) cost would exceed the limit, if there is no discount', async () => {
    const { service } = makeService({
      spendingLimitPaise: 10000,
      rawBillableCostPaise: 10000,
      discountPercentage: null,
    });
    const result = await service.checkSpendingLimit('user-1');
    expect(result.allowed).toBe(false);
  });

  it('a discount that brings the NET cost below the limit allows the call, even though the raw cost alone would have blocked it', async () => {
    // Raw cost 10000 paise would hit a 10000-paise limit exactly (blocked),
    // but a 25% discount brings the real, chargeable cost to 7500 — under
    // the limit. The customer should not be blocked over money they will
    // never actually be charged.
    const { service } = makeService({
      spendingLimitPaise: 10000,
      rawBillableCostPaise: 10000,
      discountPercentage: 25,
    });
    const result = await service.checkSpendingLimit('user-1');
    expect(result.allowed).toBe(true);
  });

  it('still blocks once the DISCOUNTED cost itself reaches the limit', async () => {
    // Raw cost 20000, 25% discount -> net 15000, limit 15000 -> blocked.
    const { service } = makeService({
      spendingLimitPaise: 15000,
      rawBillableCostPaise: 20000,
      discountPercentage: 25,
    });
    const result = await service.checkSpendingLimit('user-1');
    expect(result.allowed).toBe(false);
  });

  it('resolves the discount as of "now" (a live, in-cycle check), not a fixed cycle-start date', async () => {
    const { service, discounts } = makeService({
      spendingLimitPaise: 10000,
      rawBillableCostPaise: 5000,
      discountPercentage: 10,
    });
    await service.checkSpendingLimit('user-1');
    expect(discounts.getActiveDiscount).toHaveBeenCalledWith('user-1');
  });
});

describe('UsageBillingService — free allowance and per-call usage are in participant-minutes', () => {
  const RATES = {
    audioPaise: 20,
    videoPaise: 80,
    screenSharePaise: 10,
    freeAudioMins: 500,
    freeVideoMins: 200,
    taxPercent: 18,
  };
  const usageRow = {
    id: 'usage-1',
    callsCreated: 0,
    billingCycleStart: new Date(Date.now() - 10 * 86400000),
    billingCycleEnd: new Date(Date.now() + 20 * 86400000),
  };

  function makeService(prisma: Record<string, unknown>) {
    const service = new UsageBillingService(
      prisma as never,
      {} as never,
      {} as never,
    );
    jest
      .spyOn(service, 'getOrCreateUsage')
      .mockResolvedValue(usageRow as never);
    jest.spyOn(service, 'getRates').mockResolvedValue(RATES);
    return service;
  }

  it('2 participants × 260-minute audio call = 520 participant-min → 20 billable after the 500 free', async () => {
    const service = makeService({
      callUsage: {
        aggregate: jest.fn().mockResolvedValue({
          _sum: {
            audioMinutes: 520,
            videoMinutes: 0,
            screenShareMinutes: 0,
            participants: 2,
          },
          _count: 1,
        }),
      },
      user: {
        findUnique: jest.fn().mockResolvedValue({ razorpayTokenId: 'tok' }),
      },
    });

    const result = await service.getCurrentUsage('user-1');

    expect(result.usage.audioMinutes).toBe(520);
    expect(result.freeAllowance.audioMinutes).toBe(500);
    // 20 billable participant-minutes × ₹0.20.
    expect(result.cost.audioPaise).toBeCloseTo(20 * RATES.audioPaise);
    expect(result.cost.totalPaise).toBeCloseTo(400);
  });

  it('getCallUsage returns the rated participant-minutes plus wall-clock seconds as separate context', async () => {
    const t0 = new Date('2026-09-01T10:00:00Z');
    const t10 = new Date('2026-09-01T10:10:00Z');
    const service = makeService({
      callUsage: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'cu-1',
            usageId: 'usage-1',
            callId: 'call-1',
            // 10-minute call, 2 participants, both cameras on.
            audioMinutes: 0,
            videoMinutes: 20,
            screenShareMinutes: 0,
            participants: 2,
            costPaise: 1600,
            startedAt: t0,
            endedAt: t10,
            createdAt: t10,
          },
        ]),
      },
      usageSegment: {
        findMany: jest.fn().mockResolvedValue([
          {
            callId: 'call-1',
            startedAt: t0,
            endedAt: t10,
            audio: false,
            video: true,
            screenShare: false,
          },
        ]),
      },
    });

    const result = await service.getCallUsage('user-1');
    const call = result.data[0];

    expect(call.videoMinutes).toBe(20);
    expect(call.audioMinutes).toBe(0);
    expect(call.durationSeconds).toEqual({
      callSeconds: 600,
      audioSeconds: 0,
      videoSeconds: 600,
      screenShareSeconds: 0,
    });
    // 20 video participant-min are all within the 200 free.
    expect(call.billedCostPaise).toBe(0);
    expect(call.billableVideoMinutes).toBe(0);
  });

  it('getCallUsage consumes the free allowance in participant-minutes, in call order', async () => {
    const mk = (id: string, audioMinutes: number, createdAt: Date) => ({
      id,
      usageId: 'usage-1',
      callId: id,
      audioMinutes,
      videoMinutes: 0,
      screenShareMinutes: 0,
      participants: 2,
      costPaise: 0,
      startedAt: createdAt,
      endedAt: createdAt,
      createdAt,
    });
    const service = makeService({
      callUsage: {
        findMany: jest.fn().mockResolvedValue([
          mk('first', 400, new Date('2026-09-01T10:00:00Z')),
          // 2 participants × 60 min = 120 participant-min; only 100 free left.
          mk('second', 120, new Date('2026-09-02T10:00:00Z')),
        ]),
      },
      usageSegment: { findMany: jest.fn().mockResolvedValue([]) },
    });

    const result = await service.getCallUsage('user-1');
    const byId = Object.fromEntries(result.data.map((c) => [c.callId, c]));

    expect(byId.first.billableAudioMinutes).toBe(0);
    expect(byId.second.billableAudioMinutes).toBe(20);
    expect(byId.second.billedCostPaise).toBe(20 * RATES.audioPaise);
  });
});
