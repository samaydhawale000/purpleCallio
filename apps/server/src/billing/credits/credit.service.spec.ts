import { CreditBucketSource, CreditTransactionType } from '@prisma/client';

import { CreditService, InsufficientCreditsError } from './credit.service';

type Bucket = {
  id: string;
  source: CreditBucketSource;
  remaining: number;
  initialAmount: number;
  expiresAt: Date | null;
  expiredAt: Date | null;
  createdAt: Date;
};

/** In-memory wallet: enough of Prisma for debit() and getSummary(). */
function fakeWallet(buckets: Bucket[]) {
  const wallet = { id: 'w1', balance: buckets.reduce((s, b) => s + b.remaining, 0), reserved: 0 };
  const live = (where: any) =>
    buckets.filter(
      (b) =>
        b.remaining > 0 &&
        b.expiredAt === null &&
        (!where.source?.notIn || !where.source.notIn.includes(b.source)),
    );
  const db: any = {
    $executeRaw: jest.fn(),
    $queryRaw: jest.fn(async () => [{ ...wallet }]),
    creditTransaction: {
      findUnique: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => ({ id: 'tx1', ...data })),
    },
    creditWallet: {
      findUnique: jest.fn(async () => wallet),
      updateMany: jest.fn(async ({ data }: any) => {
        wallet.balance -= data.balance.decrement;
        return { count: 1 };
      }),
    },
    creditBucket: {
      findMany: jest.fn(async ({ where }: any) =>
        where.expiresAt ? [] : [...live(where)].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime()),
      ),
      aggregate: jest.fn(async ({ where }: any) => ({
        _sum: { remaining: live(where).reduce((s, b) => s + b.remaining, 0) },
      })),
      update: jest.fn(async ({ where, data }: any) => {
        const b = buckets.find((x) => x.id === where.id)!;
        b.remaining -= data.remaining.decrement;
        return b;
      }),
    },
  };
  db.$transaction = jest.fn(async (fn: any) => fn(db));
  return { db, wallet };
}

const bucket = (id: string, source: CreditBucketSource, remaining: number, day: number): Bucket => ({
  id,
  source,
  remaining,
  initialAmount: remaining,
  expiresAt: null,
  expiredAt: null,
  createdAt: new Date(2026, 0, day),
});

const debit = (amount: number, extra: Record<string, unknown> = {}) => ({
  userId: 'u',
  amount,
  type: CreditTransactionType.USAGE_DEBIT,
  idempotencyKey: `k${amount}`,
  ...extra,
});

describe('CreditService free credits', () => {
  let buckets: Bucket[];
  let service: CreditService;
  let wallet: { balance: number };

  beforeEach(() => {
    buckets = [
      bucket('paid', CreditBucketSource.TOPUP, 1000, 1),
      bucket('signup', CreditBucketSource.SIGNUP, 300, 2),
      bucket('promo', CreditBucketSource.PROMOTION, 200, 3),
    ];
    const fake = fakeWallet(buckets);
    wallet = fake.wallet;
    service = new CreditService(fake.db);
  });

  it('calls spend free credits before paid ones', async () => {
    const res = await service.debit(debit(600));
    expect(res.debited).toBe(600);
    expect(buckets.map((b) => b.remaining)).toEqual([900, 0, 0]);
  });

  it('AI debits (paidOnly) never touch free credits', async () => {
    const res = await service.debit(debit(400, { paidOnly: true }));
    expect(res.debited).toBe(400);
    expect(buckets.map((b) => b.remaining)).toEqual([600, 300, 200]);
  });

  it('paidOnly is capped by paid credits even when free credits remain', async () => {
    await expect(service.debit(debit(1200, { paidOnly: true }))).rejects.toBeInstanceOf(InsufficientCreditsError);
    const partial = await service.debit(debit(1200, { paidOnly: true, allowPartial: true }));
    expect(partial).toMatchObject({ debited: 1000, shortfall: 200 });
    expect(wallet.balance).toBe(500);
    expect(buckets.map((b) => b.remaining)).toEqual([0, 300, 200]);
  });

  it('a wallet with only free credits has nothing for AI', async () => {
    buckets.splice(0, 1);
    const fake = fakeWallet(buckets);
    service = new CreditService(fake.db);
    expect(await service.getSummary('u')).toMatchObject({ available: 500, freeBalance: 500, paidAvailable: 0 });
    expect(await service.debit(debit(10, { paidOnly: true, allowPartial: true }))).toMatchObject({ debited: 0, shortfall: 10 });
  });

  it('summary splits free and paid credits', async () => {
    expect(await service.getSummary('u')).toMatchObject({
      balance: 1500,
      available: 1500,
      freeBalance: 500,
      paidAvailable: 1000,
    });
  });
});
