import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CreditBucketSource,
  CreditTransactionType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { omit } from '../omit.util';

type Tx = Prisma.TransactionClient;

export class InsufficientCreditsError extends BadRequestException {
  constructor(
    public readonly required: number,
    public readonly available: number,
  ) {
    super(`Not enough credits: ${required} required, ${available} available.`);
  }
}

export interface GrantInput {
  userId: string;
  amount: number;
  type: CreditTransactionType;
  source: CreditBucketSource;
  expiresAt?: Date | null;
  subscriptionId?: string | null;
  referenceType?: string | null;
  referenceId?: string | null;
  /** Unique per logical event — a repeat with the same key is a no-op. */
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
}

export interface DebitInput {
  userId: string;
  amount: number;
  type: CreditTransactionType;
  referenceType?: string | null;
  referenceId?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  actorId?: string | null;
  /**
   * false (default): reject with InsufficientCreditsError and change
   * nothing if the balance can't cover `amount`.
   * true: debit what is available (never below zero) and report the
   * shortfall — used for usage that already happened (a call that ran past
   * the balance). The balance still never goes negative.
   */
  allowPartial?: boolean;
}

export interface DebitResult {
  debited: number;
  shortfall: number;
  balanceBefore: number;
  balanceAfter: number;
  duplicate: boolean;
  transactionId: string | null;
}

/**
 * Prepaid credit wallet + immutable ledger.
 *
 * Invariants:
 *  - Credits are integers. Wallet.balance == Σ bucket.remaining.
 *  - Every change writes exactly one CreditTransaction (balanceBefore/After).
 *  - Every mutation runs inside a DB transaction holding a row lock on the
 *    customer's wallet (SELECT … FOR UPDATE), so concurrent debits are
 *    serialized and the balance can never go below zero.
 *  - Each logical event carries an idempotencyKey (unique in the ledger):
 *    replaying it (duplicate webhook, retried job) is a no-op.
 *  - Credits live in buckets with their own expiry; spending drains the
 *    soonest-expiring bucket first, and expiring a bucket can only remove
 *    that bucket's remaining credits.
 */
@Injectable()
export class CreditService {
  private readonly logger = new Logger(CreditService.name);

  constructor(private prisma: PrismaService) {}

  // ── Locking ───────────────────────────────────────────────
  /** Ensure the wallet exists and lock it for the rest of `tx`. */
  async lockWallet(
    tx: Tx,
    userId: string,
  ): Promise<{ id: string; balance: number; reserved: number }> {
    await tx.$executeRaw`
      INSERT INTO "CreditWallet" ("id", "userId", "balance", "reserved", "createdAt", "updatedAt")
      VALUES (gen_random_uuid()::text, ${userId}, 0, 0, now(), now())
      ON CONFLICT ("userId") DO NOTHING`;
    const rows = await tx.$queryRaw<
      { id: string; balance: number; reserved: number }[]
    >`
      SELECT "id", "balance", "reserved" FROM "CreditWallet" WHERE "userId" = ${userId} FOR UPDATE`;
    return rows[0];
  }

  /** Run `fn` in a transaction that holds this customer's wallet lock. */
  async withWallet<T>(
    userId: string,
    fn: (
      tx: Tx,
      wallet: { id: string; balance: number; reserved: number },
    ) => Promise<T>,
    tx?: Tx,
  ): Promise<T> {
    if (tx) return fn(tx, await this.lockWallet(tx, userId));
    return this.prisma.$transaction(
      async (t) => fn(t, await this.lockWallet(t, userId)),
      {
        timeout: 15_000,
      },
    );
  }

  // ── Grants ────────────────────────────────────────────────
  async grant(input: GrantInput, tx?: Tx) {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException(
        'Credit grants must be a positive whole number.',
      );
    }
    return this.withWallet(
      input.userId,
      async (t, wallet) => {
        const existing = await t.creditTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing)
          return {
            transaction: existing,
            bucketId: existing.bucketId,
            duplicate: true,
          };

        const bucket = await t.creditBucket.create({
          data: {
            walletId: wallet.id,
            userId: input.userId,
            source: input.source,
            initialAmount: input.amount,
            remaining: input.amount,
            expiresAt: input.expiresAt ?? null,
            subscriptionId: input.subscriptionId ?? null,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
          },
        });
        const balanceAfter = wallet.balance + input.amount;
        await t.creditWallet.update({
          where: { id: wallet.id },
          data: { balance: balanceAfter },
        });
        const transaction = await t.creditTransaction.create({
          data: {
            walletId: wallet.id,
            userId: input.userId,
            type: input.type,
            amount: input.amount,
            balanceBefore: wallet.balance,
            balanceAfter,
            bucketId: bucket.id,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            idempotencyKey: input.idempotencyKey,
            metadata: (input.metadata ??
              Prisma.JsonNull) as Prisma.InputJsonValue,
            actorId: input.actorId ?? null,
          },
        });
        wallet.balance = balanceAfter;
        return { transaction, bucketId: bucket.id, duplicate: false };
      },
      tx,
    );
  }

  // ── Debits ────────────────────────────────────────────────
  async debit(input: DebitInput, tx?: Tx): Promise<DebitResult> {
    if (!Number.isInteger(input.amount) || input.amount < 0) {
      throw new BadRequestException(
        'Credit debits must be a non-negative whole number.',
      );
    }
    return this.withWallet(
      input.userId,
      async (t, wallet) => {
        const existing = await t.creditTransaction.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          const meta = (existing.metadata ?? {}) as Record<string, unknown>;
          return {
            debited: -existing.amount,
            shortfall: Number(meta.shortfall ?? 0),
            balanceBefore: existing.balanceBefore,
            balanceAfter: existing.balanceAfter,
            duplicate: true,
            transactionId: existing.id,
          };
        }

        // Expired credits must never be spendable.
        await this.expireDueBuckets(t, input.userId, wallet);

        const available = Math.max(0, wallet.balance - wallet.reserved);
        if (input.amount > available && !input.allowPartial) {
          throw new InsufficientCreditsError(input.amount, available);
        }
        const toDebit = Math.min(input.amount, available);
        const shortfall = input.amount - toDebit;

        const drained = await this.drainBuckets(t, wallet.id, toDebit);
        const balanceBefore = wallet.balance;
        const balanceAfter = balanceBefore - toDebit;
        // Conditional decrement: belt-and-braces against any path that
        // bypassed the lock — the update matches nothing if it would go negative.
        const updated = await t.creditWallet.updateMany({
          where: { id: wallet.id, balance: { gte: toDebit } },
          data: { balance: { decrement: toDebit } },
        });
        if (updated.count !== 1)
          throw new InsufficientCreditsError(input.amount, available);

        const transaction = await t.creditTransaction.create({
          data: {
            walletId: wallet.id,
            userId: input.userId,
            type: input.type,
            amount: -toDebit,
            balanceBefore,
            balanceAfter,
            bucketId: drained.length === 1 ? drained[0].bucketId : null,
            referenceType: input.referenceType ?? null,
            referenceId: input.referenceId ?? null,
            idempotencyKey: input.idempotencyKey,
            metadata: {
              ...(input.metadata ?? {}),
              requested: input.amount,
              shortfall,
              buckets: drained,
            },
            actorId: input.actorId ?? null,
          },
        });
        wallet.balance = balanceAfter;
        return {
          debited: toDebit,
          shortfall,
          balanceBefore,
          balanceAfter,
          duplicate: false,
          transactionId: transaction.id,
        };
      },
      tx,
    );
  }

  /** Takes `amount` from buckets, soonest-expiring first (never-expiring last). */
  private async drainBuckets(t: Tx, walletId: string, amount: number) {
    const drained: { bucketId: string; amount: number }[] = [];
    if (amount <= 0) return drained;
    const buckets = await t.creditBucket.findMany({
      where: { walletId, remaining: { gt: 0 }, expiredAt: null },
      orderBy: [
        { expiresAt: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'asc' },
      ],
    });
    let left = amount;
    for (const b of buckets) {
      if (left <= 0) break;
      const take = Math.min(b.remaining, left);
      await t.creditBucket.update({
        where: { id: b.id },
        data: { remaining: { decrement: take } },
      });
      drained.push({ bucketId: b.id, amount: take });
      left -= take;
    }
    if (left > 0) {
      // Wallet balance and buckets disagree — refuse rather than corrupt.
      throw new Error(
        `Credit buckets for wallet ${walletId} hold less than the wallet balance.`,
      );
    }
    return drained;
  }

  // ── Expiry ────────────────────────────────────────────────
  /** Expires every bucket past its expiresAt. Caller holds the wallet lock. */
  async expireDueBuckets(
    t: Tx,
    userId: string,
    wallet: { id: string; balance: number },
    now = new Date(),
  ) {
    const due = await t.creditBucket.findMany({
      where: { walletId: wallet.id, expiredAt: null, expiresAt: { lte: now } },
    });
    for (const b of due)
      await this.forfeitBucket(
        t,
        userId,
        wallet,
        b,
        CreditTransactionType.EXPIRATION,
        `expire:${b.id}`,
      );
    return due.length;
  }

  /** Expire due buckets for one customer (own transaction). */
  async expireDue(userId: string, tx?: Tx) {
    return this.withWallet(
      userId,
      (t, wallet) => this.expireDueBuckets(t, userId, wallet),
      tx,
    );
  }

  /**
   * Remove whatever is left in the given buckets (e.g. a refunded purchase,
   * or a subscription ended early). Each forfeit is its own ledger entry.
   */
  async forfeitBuckets(
    userId: string,
    where: Prisma.CreditBucketWhereInput,
    type: CreditTransactionType,
    keyPrefix: string,
    tx?: Tx,
    metadata?: Record<string, unknown>,
  ) {
    return this.withWallet(
      userId,
      async (t, wallet) => {
        const buckets = await t.creditBucket.findMany({
          where: { ...where, walletId: wallet.id, expiredAt: null },
        });
        let removed = 0;
        for (const b of buckets) {
          removed += await this.forfeitBucket(
            t,
            userId,
            wallet,
            b,
            type,
            `${keyPrefix}:${b.id}`,
            metadata,
          );
        }
        return removed;
      },
      tx,
    );
  }

  private async forfeitBucket(
    t: Tx,
    userId: string,
    wallet: { id: string; balance: number },
    bucket: { id: string; remaining: number },
    type: CreditTransactionType,
    idempotencyKey: string,
    metadata?: Record<string, unknown>,
  ): Promise<number> {
    const already = await t.creditTransaction.findUnique({
      where: { idempotencyKey },
    });
    await t.creditBucket.update({
      where: { id: bucket.id },
      data: { remaining: 0, expiredAt: new Date() },
    });
    if (already || bucket.remaining <= 0) return 0;
    const balanceAfter = wallet.balance - bucket.remaining;
    await t.creditWallet.update({
      where: { id: wallet.id },
      data: { balance: balanceAfter },
    });
    await t.creditTransaction.create({
      data: {
        walletId: wallet.id,
        userId,
        type,
        amount: -bucket.remaining,
        balanceBefore: wallet.balance,
        balanceAfter,
        bucketId: bucket.id,
        referenceType: 'CreditBucket',
        referenceId: bucket.id,
        idempotencyKey,
        metadata: (metadata ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      },
    });
    wallet.balance = balanceAfter;
    return bucket.remaining;
  }

  // ── Admin ─────────────────────────────────────────────────
  /** Manual adjustment: positive grants an ADMIN bucket, negative debits. */
  async adjust(
    userId: string,
    amount: number,
    actorId: string,
    reason: string,
    opts: { expiresAt?: Date | null; type?: CreditTransactionType } = {},
  ) {
    if (!Number.isInteger(amount) || amount === 0)
      throw new BadRequestException('Amount must be a non-zero whole number.');
    if (!reason?.trim())
      throw new BadRequestException(
        'A reason is required for manual credit adjustments.',
      );
    const key = `admin:${actorId}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`;
    const type = opts.type ?? CreditTransactionType.ADMIN_ADJUSTMENT;
    if (amount > 0) {
      return this.grant({
        userId,
        amount,
        type,
        source:
          type === CreditTransactionType.PROMOTION
            ? CreditBucketSource.PROMOTION
            : CreditBucketSource.ADMIN,
        expiresAt: opts.expiresAt ?? null,
        referenceType: 'Admin',
        referenceId: actorId,
        idempotencyKey: key,
        metadata: { reason: reason.trim() },
        actorId,
      });
    }
    return this.debit({
      userId,
      amount: -amount,
      type,
      referenceType: 'Admin',
      referenceId: actorId,
      idempotencyKey: key,
      metadata: { reason: reason.trim() },
      actorId,
    });
  }

  // ── Reads ─────────────────────────────────────────────────
  async getSummary(userId: string, periodStart?: Date | null) {
    const wallet = await this.prisma.creditWallet.findUnique({
      where: { userId },
    });
    const now = new Date();
    const buckets = wallet
      ? await this.prisma.creditBucket.findMany({
          where: {
            walletId: wallet.id,
            expiredAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          },
          orderBy: [
            { expiresAt: { sort: 'asc', nulls: 'last' } },
            { createdAt: 'asc' },
          ],
        })
      : [];
    // Credits that "count" for this period: anything still holding credits,
    // plus everything granted since the period started.
    const counted = buckets.filter(
      (b) => b.remaining > 0 || (periodStart && b.createdAt >= periodStart),
    );
    const granted = counted.reduce((s, b) => s + b.initialAmount, 0);
    // Live balance from unexpired buckets: a bucket past its expiry stops
    // counting immediately, even before the expiry job sweeps it into the
    // ledger (wallet.balance catches up then).
    const balance = buckets.reduce((s, b) => s + b.remaining, 0);
    const reserved = wallet?.reserved ?? 0;
    return {
      balance,
      reserved,
      available: Math.max(0, balance - reserved),
      granted,
      used: Math.max(0, granted - balance),
      usedPercent:
        granted > 0
          ? Math.min(100, Math.round(((granted - balance) / granted) * 100))
          : balance > 0
            ? 0
            : 100,
      buckets: buckets
        .filter((b) => b.remaining > 0)
        .map((b) => ({
          id: b.id,
          source: b.source,
          initialAmount: b.initialAmount,
          remaining: b.remaining,
          expiresAt: b.expiresAt,
          createdAt: b.createdAt,
        })),
    };
  }

  async getHistory(
    userId: string,
    params: { page?: string; type?: string } = {},
  ) {
    const page = Math.max(1, parseInt(params.page ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where: Prisma.CreditTransactionWhereInput = { userId };
    if (
      params.type &&
      (Object.values(CreditTransactionType) as string[]).includes(params.type)
    ) {
      where.type = params.type as CreditTransactionType;
    }
    const [total, data] = await Promise.all([
      this.prisma.creditTransaction.count({ where }),
      this.prisma.creditTransaction.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          type: true,
          amount: true,
          balanceBefore: true,
          balanceAfter: true,
          referenceType: true,
          referenceId: true,
          metadata: true,
          createdAt: true,
        },
      }),
    ]);
    return {
      data: data.map((row) => ({
        ...row,
        metadata: this.publicMetadata(row.metadata),
      })),
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  /** Strip internal bookkeeping (bucket ids) from ledger metadata for customers. */
  private publicMetadata(meta: Prisma.JsonValue) {
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return meta;
    return omit(meta as Record<string, unknown>, 'buckets');
  }
}
