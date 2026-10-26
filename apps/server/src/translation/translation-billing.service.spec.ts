import { resetLiveUsdInrRate, setLiveUsdInrRate } from '../exchange-rate/exchange-rate';
import { Logger } from '@nestjs/common';

import {
  providerCostPaiseFor,
  TranslationBillingService,
  translationCreditsFor,
} from './translation-billing.service';

describe('translationCreditsFor', () => {
  it('rounds up once per session', () => {
    expect(
      translationCreditsFor({ voiceSeconds: 61, captionsSeconds: 30, voiceRate: 450, captionsRate: 60 }),
    ).toBe(Math.ceil((61 * 450) / 60 + (30 * 60) / 60));
    expect(translationCreditsFor({ voiceSeconds: 0, captionsSeconds: 0, voiceRate: 450, captionsRate: 60 })).toBe(0);
  });

  it('provider cost uses route-mode keys first', () => {
    const costs = { 'soniox-voice': 150, 'soniox-captions': 50, other: 300 };
    expect(providerCostPaiseFor(costs, 'soniox', 'VOICE', 120)).toBe(300);
    expect(providerCostPaiseFor(costs, 'soniox', 'CAPTIONS', 60)).toBe(50);
    expect(providerCostPaiseFor(costs, 'other', 'VOICE', 60)).toBe(300);
    expect(providerCostPaiseFor(costs, 'mock', 'VOICE', 60)).toBe(0);
  });

  it('falls back to Soniox USD list prices at the live exchange rate when admin has no entry', () => {
    setLiveUsdInrRate(100, 'test');
    expect(providerCostPaiseFor({}, 'soniox', 'CAPTIONS', 60)).toBe(21); // $0.0021 × ₹100
    expect(providerCostPaiseFor({}, 'soniox', 'VOICE', 60)).toBe(80); // $0.008 × ₹100
    setLiveUsdInrRate(80, 'test');
    expect(providerCostPaiseFor({}, 'soniox', 'VOICE', 60)).toBe(64); // follows the dollar
    resetLiveUsdInrRate();
  });
});

describe('TranslationBillingService', () => {
  let session: any;
  let config: any;
  let debits: any[];
  let service: TranslationBillingService;
  let credits: any;

  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  beforeEach(() => {
    debits = [];
    config = {
      translationProviderCostsPaise: { soniox: 100 },
    };
    session = {
      id: 'ts_1',
      callId: 'call_1',
      ownerId: 'owner',
      direction: 'caller_to_receiver',
      route: 'soniox',
      mode: 'VOICE',
      status: 'ENDED',
      voiceSeconds: 120,
      captionsSeconds: 0,
      voiceRate: 450,
      captionsRate: 60,
      usageRecordedAt: null,
    };
    const tx: any = {
      translationSession: {
        updateMany: jest.fn(async () => {
          if (session.usageRecordedAt) return { count: 0 };
          session.usageRecordedAt = new Date();
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: any) => Object.assign(session, data)),
      },
    };
    const prisma: any = {
      translationSession: { findUnique: jest.fn(async () => ({ ...session })) },
    };
    credits = {
      withWallet: jest.fn(async (_u: string, fn: any) => fn(tx)),
      debit: jest.fn(async (input: any) => {
        debits.push(input);
        return { debited: input.amount, shortfall: 0, duplicate: false };
      }),
      getSummary: jest.fn(async () => ({ available: 10_000 })),
    };
    service = new TranslationBillingService(
      prisma,
      { get: jest.fn(async () => config) } as any,
      credits,
    );
  });

  it('debits once with the idempotency key and reference', async () => {
    const charge = await service.recordSession('ts_1');
    expect(charge).toMatchObject({ credits: 900, debited: 900, providerCostPaise: 200 });
    expect(await service.recordSession('ts_1')).toBeNull();
    expect(debits).toHaveLength(1);
    expect(debits[0]).toMatchObject({
      userId: 'owner',
      amount: 900,
      referenceType: 'TRANSLATION_SESSION',
      referenceId: 'ts_1',
      idempotencyKey: 'translation:ts_1',
      allowPartial: true,
      paidOnly: true,
    });
    expect(session.creditsCharged).toBe(900);
  });

  it('uses the rates locked on the session', async () => {
    session.voiceRate = 100;
    expect((await service.recordSession('ts_1'))!.credits).toBe(200);
  });

  it('skips live sessions', async () => {
    session.status = 'ACTIVE';
    expect(await service.recordSession('ts_1')).toBeNull();
    expect(debits).toHaveLength(0);
  });

  it('chargeReport uses its own key and reference', async () => {
    await service.chargeReport('call_1', 'owner', 100);
    expect(credits.debit).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 100,
        referenceType: 'TRANSLATION_REPORT',
        idempotencyKey: 'translation-report:call_1',
        allowPartial: true,
      }),
    );
    expect(await service.chargeReport('call_1', 'owner', 0)).toMatchObject({ debited: 0 });
  });
});
