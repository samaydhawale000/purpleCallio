import { InsufficientCreditsError } from '../credits/credit.service';
import { CUSTOM_PLAN_INITIAL_MESSAGE } from '../custom-plans/custom-plan.service';
import {
  buyPlan,
  createHarness,
  createUser,
  Harness,
  planBySlug,
  resetDb,
  TEST_DB_URL,
} from './billing-harness';

/**
 * Prepaid billing against a real Postgres (row locks, unique constraints
 * and transactions are the point — mocks can't prove them).
 *
 *   BILLING_TEST_DATABASE_URL=postgresql://…/bluejoinet_test npm run test:billing
 */
const d = TEST_DB_URL ? describe : describe.skip;

d('prepaid billing (integration)', () => {
  let h: Harness;

  beforeAll(() => {
    h = createHarness();
  });
  afterAll(async () => {
    await h.prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(h);
    h.notifications.createNotification.mockClear();
    h.notifications.notifyAdmins.mockClear();
  });

  const balance = async (userId: string) =>
    (await h.prisma.creditWallet.findUnique({ where: { userId } }))?.balance ??
    0;
  const ledgerSum = async (userId: string) =>
    (
      await h.prisma.creditTransaction.aggregate({
        where: { userId },
        _sum: { amount: true },
      })
    )._sum.amount ?? 0;
  const bucketSum = async (userId: string) =>
    (
      await h.prisma.creditBucket.aggregate({
        where: { userId },
        _sum: { remaining: true },
      })
    )._sum.remaining ?? 0;
  /** Wallet balance == ledger total == Σ bucket remaining. */
  const expectConsistent = async (userId: string) => {
    const b = await balance(userId);
    expect(await ledgerSum(userId)).toBe(b);
    expect(await bucketSum(userId)).toBe(b);
    expect(b).toBeGreaterThanOrEqual(0);
  };

  // ── Credits ──────────────────────────────────────────────
  describe('credits', () => {
    const grant = (userId: string, amount: number, key: string) =>
      h.credits.grant({
        userId,
        amount,
        type: 'PROMOTION',
        source: 'PROMOTION',
        idempotencyKey: key,
      });

    it('consumes credits: 100 available, 10 required → 90 remaining', async () => {
      const u = await createUser(h);
      await grant(u.id, 100, 'g1');
      const r = await h.credits.debit({
        userId: u.id,
        amount: 10,
        type: 'USAGE_DEBIT',
        idempotencyKey: 'd1',
      });
      expect(r.debited).toBe(10);
      expect(await balance(u.id)).toBe(90);
      await expectConsistent(u.id);
    });

    it('rejects usage it cannot cover: 5 available, 10 required → rejected, balance stays 5', async () => {
      const u = await createUser(h);
      await grant(u.id, 5, 'g1');
      await expect(
        h.credits.debit({
          userId: u.id,
          amount: 10,
          type: 'USAGE_DEBIT',
          idempotencyKey: 'd1',
        }),
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
      expect(await balance(u.id)).toBe(5);
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, type: 'USAGE_DEBIT' },
        }),
      ).toBe(0);
      await expectConsistent(u.id);
    });

    it('never goes negative under concurrency: 10 available, two concurrent debits of 7', async () => {
      const u = await createUser(h);
      await grant(u.id, 10, 'g1');
      const results = await Promise.allSettled([
        h.credits.debit({
          userId: u.id,
          amount: 7,
          type: 'USAGE_DEBIT',
          idempotencyKey: 'a',
        }),
        h.credits.debit({
          userId: u.id,
          amount: 7,
          type: 'USAGE_DEBIT',
          idempotencyKey: 'b',
        }),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect(await balance(u.id)).toBe(3);
      await expectConsistent(u.id);
    });

    it('stays consistent under a burst of concurrent debits', async () => {
      const u = await createUser(h);
      await grant(u.id, 50, 'g1');
      await Promise.allSettled(
        Array.from({ length: 20 }, (_, i) =>
          h.credits.debit({
            userId: u.id,
            amount: 3,
            type: 'USAGE_DEBIT',
            idempotencyKey: `burst-${i}`,
          }),
        ),
      );
      expect(await balance(u.id)).toBe(50 - 16 * 3);
      await expectConsistent(u.id);
    });

    it('applies a duplicate transaction only once (idempotency key)', async () => {
      const u = await createUser(h);
      await grant(u.id, 100, 'g1');
      await grant(u.id, 100, 'g1');
      const [a, b] = await Promise.all([
        h.credits.debit({
          userId: u.id,
          amount: 10,
          type: 'USAGE_DEBIT',
          idempotencyKey: 'same',
        }),
        h.credits.debit({
          userId: u.id,
          amount: 10,
          type: 'USAGE_DEBIT',
          idempotencyKey: 'same',
        }),
      ]);
      expect([a.duplicate, b.duplicate].sort()).toEqual([false, true]);
      expect(await balance(u.id)).toBe(90);
      await expectConsistent(u.id);
    });

    it('partial debit (usage that already happened) never goes below zero and records the shortfall', async () => {
      const u = await createUser(h);
      await grant(u.id, 5, 'g1');
      const r = await h.credits.debit({
        userId: u.id,
        amount: 12,
        type: 'USAGE_DEBIT',
        idempotencyKey: 'call',
        allowPartial: true,
      });
      expect(r).toMatchObject({ debited: 5, shortfall: 7, balanceAfter: 0 });
      await expectConsistent(u.id);
    });

    it('spends soonest-expiring credits first and expires only the expired bucket', async () => {
      const u = await createUser(h);
      await h.credits.grant({
        userId: u.id,
        amount: 10,
        type: 'PROMOTION',
        source: 'PROMOTION',
        idempotencyKey: 'never',
      });
      const soon = new Date(Date.now() + 60_000);
      await h.credits.grant({
        userId: u.id,
        amount: 10,
        type: 'PROMOTION',
        source: 'PROMOTION',
        idempotencyKey: 'soon',
        expiresAt: soon,
      });
      await h.credits.debit({
        userId: u.id,
        amount: 4,
        type: 'USAGE_DEBIT',
        idempotencyKey: 'd',
      });
      const soonBucket = await h.prisma.creditBucket.findFirstOrThrow({
        where: { userId: u.id, expiresAt: { not: null } },
      });
      expect(soonBucket.remaining).toBe(6);

      await h.prisma.creditBucket.update({
        where: { id: soonBucket.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      await h.credits.expireDue(u.id);
      expect(await balance(u.id)).toBe(10);
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, type: 'EXPIRATION' },
        }),
      ).toBe(1);
      await expectConsistent(u.id);
    });

    it('expired credits are not spendable even before the expiry job runs', async () => {
      const u = await createUser(h);
      await h.credits.grant({
        userId: u.id,
        amount: 10,
        type: 'PROMOTION',
        source: 'PROMOTION',
        idempotencyKey: 'old',
        expiresAt: new Date(Date.now() - 1000),
      });
      await expect(
        h.credits.debit({
          userId: u.id,
          amount: 1,
          type: 'USAGE_DEBIT',
          idempotencyKey: 'd',
        }),
      ).rejects.toBeInstanceOf(InsufficientCreditsError);
      await expectConsistent(u.id);
    });
  });

  // ── Plans ────────────────────────────────────────────────
  describe('plans', () => {
    it('seeds dynamic default plans and lists only active public ones', async () => {
      const plans = await h.plans.listPublicPlans();
      expect(plans.map((p) => p.slug)).toEqual([
        'free',
        'starter',
        'growth',
        'business',
        'enterprise',
      ]);
      expect(plans.find((p) => p.slug === 'enterprise')?.customPricing).toBe(
        true,
      );
    });

    it('creates, edits (new version) and archives a plan', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const created = await h.plans.createPlan(
        {
          slug: 'scale',
          name: 'Scale',
          type: 'PAID',
          pricePaise: 999900,
          includedCredits: 500000,
          features: ['HOSTED_UI'],
        },
        admin.id,
      );
      expect(created.version?.version).toBe(1);

      const renamed = await h.plans.updatePlan(
        created.id,
        { name: 'Scale+' },
        admin.id,
      );
      expect(renamed.version?.version).toBe(1); // display-only change

      const repriced = await h.plans.updatePlan(
        created.id,
        { pricePaise: 1099900 },
        admin.id,
      );
      expect(repriced.version?.version).toBe(2);
      expect(repriced.version?.pricePaise).toBe(1099900);
      expect(repriced.version?.includedCredits).toBe(500000);

      const archived = await h.plans.archivePlan(created.id, admin.id);
      expect(archived.status).toBe('ARCHIVED');
      expect(
        (await h.plans.listPublicPlans()).some((p) => p.id === created.id),
      ).toBe(false);
      expect(
        await h.prisma.auditLog.count({
          where: {
            action: { in: ['PLAN_CREATED', 'PLAN_UPDATED', 'PLAN_ARCHIVED'] },
          },
        }),
      ).toBe(4);
    });

    it('editing a plan never changes an existing customer’s purchased terms', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const u = await createUser(h);
      const { plan } = await buyPlan(h, u.id, 'growth');
      await h.plans.updatePlan(
        plan.id,
        { pricePaise: 249900, includedCredits: 75000 },
        admin.id,
      );

      const sub = await h.subscriptions.getActiveSubscription(u.id);
      expect(sub.pricePaise).toBe(199900);
      expect(sub.includedCredits).toBe(100000);
      expect(sub.planVersionId).toBe(plan.currentVersionId);
      expect((await planBySlug(h, 'growth')).currentVersion?.pricePaise).toBe(
        249900,
      );
    });

    it('refuses to deactivate the only active Free plan', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const free = await planBySlug(h, 'free');
      await expect(h.plans.archivePlan(free.id, admin.id)).rejects.toThrow(
        /only active Free plan/,
      );
    });
  });

  // ── Free plan & subscription lifecycle ───────────────────
  describe('subscriptions', () => {
    it('new accounts get the Free plan and its credits (configurable)', async () => {
      const u = await createUser(h);
      const sub = await h.subscriptions.getActiveSubscription(u.id);
      expect(sub.planType).toBe('FREE');
      expect(await balance(u.id)).toBe(
        (await planBySlug(h, 'free')).currentVersion!.includedCredits,
      );
      // Allocation is idempotent per period.
      await h.subscriptions.getActiveSubscription(u.id);
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, type: 'SUBSCRIPTION_ALLOCATION' },
        }),
      ).toBe(1);
    });

    it('concurrent first requests create exactly one Free subscription', async () => {
      const u = await createUser(h);
      await Promise.all(
        Array.from({ length: 5 }, () =>
          h.subscriptions.getActiveSubscription(u.id),
        ),
      );
      expect(
        await h.prisma.subscription.count({
          where: { companyId: u.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
      await expectConsistent(u.id);
    });

    it('Free credits refresh at the next period with the current Free allowance', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const u = await createUser(h);
      const sub = await h.subscriptions.getActiveSubscription(u.id);
      await h.credits.debit({
        userId: u.id,
        amount: 100,
        type: 'USAGE_DEBIT',
        idempotencyKey: 'x',
      });
      const free = await planBySlug(h, 'free');
      await h.plans.updatePlan(free.id, { includedCredits: 2000 }, admin.id);
      // Period ended.
      await h.prisma.subscription.update({
        where: { id: sub.id },
        data: {
          currentPeriodStart: new Date(Date.now() - 40 * 86_400_000),
          currentPeriodEnd: new Date(Date.now() - 1000),
        },
      });
      await h.prisma.creditBucket.updateMany({
        where: { subscriptionId: sub.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const rolled = await h.subscriptions.getActiveSubscription(u.id);
      expect(rolled.id).toBe(sub.id);
      expect(rolled.currentPeriodEnd!.getTime()).toBeGreaterThan(Date.now());
      expect(rolled.includedCredits).toBe(2000);
      await h.credits.expireDue(u.id);
      expect(await balance(u.id)).toBe(2000);
      await expectConsistent(u.id);
    });

    it('activates a paid plan only after verified payment and allocates its credits', async () => {
      const u = await createUser(h);
      await h.subscriptions.getActiveSubscription(u.id);
      const { result } = await buyPlan(h, u.id, 'growth');
      expect(result.status).toBe('PAID');
      const sub = await h.subscriptions.getActiveSubscription(u.id);
      expect(sub.planName).toBe('Growth');
      expect(sub.status).toBe('ACTIVE');
      const free = (await planBySlug(h, 'free')).currentVersion!
        .includedCredits;
      expect(await balance(u.id)).toBe(100000 + free);
      expect(
        await h.prisma.subscription.count({
          where: { companyId: u.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
      await expectConsistent(u.id);
    });

    it('expires a paid plan at period end and falls back to Free (no charge)', async () => {
      const u = await createUser(h);
      await buyPlan(h, u.id, 'starter');
      const paid = await h.subscriptions.getActiveSubscription(u.id);
      await h.prisma.subscription.update({
        where: { id: paid.id },
        data: { currentPeriodEnd: new Date(Date.now() - 1000) },
      });

      const now = await h.subscriptions.getActiveSubscription(u.id);
      expect(now.planType).toBe('FREE');
      expect(
        (
          await h.prisma.subscription.findUniqueOrThrow({
            where: { id: paid.id },
          })
        ).status,
      ).toBe('EXPIRED');
      expect(await h.prisma.payment.count({ where: { userId: u.id } })).toBe(1);
    });

    it('renews early: extends the period and adds the next period’s credits', async () => {
      const u = await createUser(h);
      await buyPlan(h, u.id, 'starter');
      const before = await h.subscriptions.getActiveSubscription(u.id);
      const started = await h.checkout.start(u.id, { kind: 'renewal' });
      expect(started.quote.purpose).toBe('SUBSCRIPTION_RENEWAL');
      const paid = h.provider.pay(started.providerOrderId);
      await h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      });

      const after = await h.subscriptions.getActiveSubscription(u.id);
      expect(after.id).toBe(before.id);
      expect(after.currentPeriodEnd!.getTime()).toBeGreaterThan(
        before.currentPeriodEnd!.getTime(),
      );
      expect(
        await h.prisma.creditTransaction.count({
          where: {
            userId: u.id,
            type: 'SUBSCRIPTION_ALLOCATION',
            amount: 10000,
          },
        }),
      ).toBe(2);
      await expectConsistent(u.id);
    });

    it('upgrades with a full new payment; the old plan’s credits are kept until they expire', async () => {
      const u = await createUser(h);
      await buyPlan(h, u.id, 'starter');
      const starter = await h.subscriptions.getActiveSubscription(u.id);
      const { result } = await buyPlan(h, u.id, 'growth');
      expect(result.purpose).toBe('SUBSCRIPTION_UPGRADE');
      const growth = await h.subscriptions.getActiveSubscription(u.id);
      expect(growth.planName).toBe('Growth');
      const old = await h.prisma.subscription.findUniqueOrThrow({
        where: { id: starter.id },
      });
      expect(old.status).toBe('CANCELED');
      expect(old.replacedBySubscriptionId).toBe(growth.id);
      expect(
        await h.prisma.creditBucket.count({
          where: { subscriptionId: starter.id, remaining: 10000 },
        }),
      ).toBe(1);
    });

    it('rejects buying a cheaper plan directly — downgrades are scheduled for period end', async () => {
      const u = await createUser(h);
      await buyPlan(h, u.id, 'growth');
      const starter = await planBySlug(h, 'starter');
      await expect(
        h.checkout.start(u.id, { kind: 'plan', planId: starter.id }),
      ).rejects.toThrow(/Downgrades take effect/);

      const scheduled = await h.subscriptions.scheduleDowngrade(
        u.id,
        starter.id,
      );
      expect(scheduled.scheduledPlanId).toBe(starter.id);
      const sub = await h.subscriptions.getActiveSubscription(u.id);
      expect(sub.planName).toBe('Growth'); // entitlements kept until period end

      await h.prisma.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodEnd: new Date(Date.now() - 1000) },
      });
      expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
        'FREE',
      );
      // "Renew" now offers the scheduled plan.
      const quote = await h.checkout.quote(u.id, { kind: 'renewal' });
      expect(quote.description).toBe('Starter plan');
    });

    it('after a downgrade to Free takes effect, "Renew" offers the paid plan again', async () => {
      const u = await createUser(h);
      await buyPlan(h, u.id, 'starter');
      const free = await planBySlug(h, 'free');
      const sub = await h.subscriptions.scheduleDowngrade(u.id, free.id);
      await h.prisma.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodEnd: new Date(Date.now() - 1000) },
      });
      expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
        'FREE',
      );
      expect(
        (await h.checkout.quote(u.id, { kind: 'renewal' })).description,
      ).toBe('Starter plan');
    });

    it('expired-but-unswept credits do not count toward the balance or call eligibility', async () => {
      const u = await createUser(h);
      const sub = await h.subscriptions.getActiveSubscription(u.id);
      await h.prisma.creditBucket.updateMany({
        where: { userId: u.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect(
        (await h.credits.getSummary(u.id, sub.currentPeriodStart)).available,
      ).toBe(0);
      expect((await h.entitlements.canStartCall(u.id, 'AUDIO')).allowed).toBe(
        false,
      );
    });

    it('cancels at period end: the plan stays active until then, then ends as CANCELED', async () => {
      const u = await createUser(h);
      await buyPlan(h, u.id, 'starter');
      const sub = await h.subscriptions.cancel(u.id);
      expect(sub.cancelAtPeriodEnd).toBe(true);
      expect((await h.subscriptions.getActiveSubscription(u.id)).planName).toBe(
        'Starter',
      );
      await h.prisma.subscription.update({
        where: { id: sub.id },
        data: { currentPeriodEnd: new Date(Date.now() - 1000) },
      });
      await h.subscriptions.getActiveSubscription(u.id);
      expect(
        (
          await h.prisma.subscription.findUniqueOrThrow({
            where: { id: sub.id },
          })
        ).status,
      ).toBe('CANCELED');
    });
  });

  // ── Checkout & payments ──────────────────────────────────
  describe('checkout', () => {
    it('derives the amount from the database (price + GST), never from the client', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const quote = await h.checkout.quote(u.id, {
        kind: 'plan',
        planId: growth.id,
        amount: 1,
      } as any);
      expect(quote.subtotalPaise).toBe(199900);
      expect(quote.taxPaise).toBe(Math.round(199900 * 0.18));
      expect(quote.totalPaise).toBe(199900 + Math.round(199900 * 0.18));
    });

    it('a failed payment leaves the plan inactive with no credits', async () => {
      const u = await createUser(h);
      await h.subscriptions.getActiveSubscription(u.id);
      const before = await balance(u.id);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      const failed = h.provider.pay(started.providerOrderId, {
        status: 'failed',
      });
      const result = await h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: failed.providerPaymentId,
        signature: failed.signature,
      });
      expect(result.status).toBe('FAILED');
      expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
        'FREE',
      );
      expect(await balance(u.id)).toBe(before);
      const pending = await h.prisma.subscription.findFirstOrThrow({
        where: { companyId: u.id, planName: 'Growth' },
      });
      expect(pending.status).toBe('PENDING_PAYMENT');
    });

    it('rejects a forged completion signature', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      const paid = h.provider.pay(started.providerOrderId);
      await expect(
        h.checkout.verify(u.id, {
          paymentId: started.paymentId,
          providerOrderId: started.providerOrderId,
          providerPaymentId: paid.providerPaymentId,
          signature: 'forged',
        }),
      ).rejects.toThrow(/could not verify/);
      expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
        'FREE',
      );
    });

    it('duplicate browser callbacks fulfill once', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      const paid = h.provider.pay(started.providerOrderId);
      const body = {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      };
      await Promise.all([
        h.checkout.verify(u.id, body),
        h.checkout.verify(u.id, body),
        h.checkout.verify(u.id, body),
      ]);
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, amount: 100000 },
        }),
      ).toBe(1);
      expect(
        await h.prisma.subscription.count({
          where: { companyId: u.id, status: 'ACTIVE' },
        }),
      ).toBe(1);
      await expectConsistent(u.id);
    });

    it('webhook before callback, and webhook redelivered twice → one activation', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      const paid = h.provider.pay(started.providerOrderId);
      const evt = h.provider.webhookBody(
        'evt_1',
        'payment.captured',
        h.provider.payments.get(paid.providerPaymentId)!,
      );
      await h.webhooks.handle(evt.raw, evt.headers);
      const dup = await h.webhooks.handle(evt.raw, evt.headers);
      expect(dup).toMatchObject({ duplicate: true });
      // A second event id for the same payment (order.paid) is also harmless.
      const evt2 = h.provider.webhookBody(
        'evt_2',
        'order.paid',
        h.provider.payments.get(paid.providerPaymentId)!,
      );
      await h.webhooks.handle(evt2.raw, evt2.headers);
      const cb = await h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      });
      expect(cb.status).toBe('PAID');
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, amount: 100000 },
        }),
      ).toBe(1);
      expect(
        await h.prisma.payment.count({
          where: { userId: u.id, paymentStatus: 'PAID' },
        }),
      ).toBe(1);
      expect(await h.prisma.paymentWebhookEvent.count()).toBe(2);
      await expectConsistent(u.id);
    });

    it('callback before webhook → webhook is a no-op', async () => {
      const u = await createUser(h);
      const { paid } = await buyPlan(h, u.id, 'growth');
      const evt = h.provider.webhookBody(
        'evt_9',
        'payment.captured',
        h.provider.payments.get(paid.providerPaymentId)!,
      );
      await h.webhooks.handle(evt.raw, evt.headers);
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, amount: 100000 },
        }),
      ).toBe(1);
    });

    it('webhook and callback racing → exactly one fulfillment', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      const paid = h.provider.pay(started.providerOrderId);
      const evt = h.provider.webhookBody(
        'evt_r',
        'payment.captured',
        h.provider.payments.get(paid.providerPaymentId)!,
      );
      await Promise.all([
        h.webhooks.handle(evt.raw, evt.headers),
        h.checkout.verify(u.id, {
          paymentId: started.paymentId,
          providerOrderId: started.providerOrderId,
          providerPaymentId: paid.providerPaymentId,
          signature: paid.signature,
        }),
      ]);
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, amount: 100000 },
        }),
      ).toBe(1);
      await expectConsistent(u.id);
    });

    it('a capture after the checkout was marked failed still delivers the purchase', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      await h.checkout.reportFailure(u.id, started.paymentId, {
        description: 'Card declined',
      });
      const paid = h.provider.pay(started.providerOrderId);
      const evt = h.provider.webhookBody(
        'evt_late',
        'payment.captured',
        h.provider.payments.get(paid.providerPaymentId)!,
      );
      await h.webhooks.handle(evt.raw, evt.headers);
      expect((await h.subscriptions.getActiveSubscription(u.id)).planName).toBe(
        'Growth',
      );
    });

    it('rejects an unsigned/forged webhook', async () => {
      await expect(
        h.webhooks.handle(
          Buffer.from('{"id":"x","event":"payment.captured"}'),
          { 'x-sig': 'nope' },
        ),
      ).rejects.toThrow(/Invalid webhook/);
    });

    it('amount mismatch never activates and alerts admins', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      const paid = h.provider.pay(started.providerOrderId, {
        amountPaise: 100,
      });
      const res = await h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      });
      expect(res.status).toBe('FAILED');
      expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
        'FREE',
      );
      expect(h.notifications.notifyAdmins).toHaveBeenCalled();
    });

    it('a double-clicked checkout reuses the open order instead of creating a second one', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const [a, b] = [
        await h.checkout.start(u.id, { kind: 'plan', planId: growth.id }),
        await h.checkout.start(u.id, { kind: 'plan', planId: growth.id }),
      ];
      expect(b.paymentId).toBe(a.paymentId);
      expect(b.providerOrderId).toBe(a.providerOrderId);
      expect(await h.prisma.payment.count({ where: { userId: u.id } })).toBe(1);
    });

    it('abandoned checkouts expire and their pending subscription is cancelled', async () => {
      const u = await createUser(h);
      const growth = await planBySlug(h, 'growth');
      const started = await h.checkout.start(u.id, {
        kind: 'plan',
        planId: growth.id,
      });
      await h.checkout.abandon(started.paymentId, 'test');
      expect(
        (
          await h.prisma.payment.findUniqueOrThrow({
            where: { id: started.paymentId },
          })
        ).paymentStatus,
      ).toBe('EXPIRED');
      expect(
        await h.prisma.subscription.count({
          where: { companyId: u.id, status: 'PENDING_PAYMENT' },
        }),
      ).toBe(0);
    });
  });

  // ── Top-ups & refunds ────────────────────────────────────
  describe('top-ups and refunds', () => {
    it('buys a top-up and adds its credits once', async () => {
      const u = await createUser(h);
      await h.subscriptions.getActiveSubscription(u.id);
      const before = await balance(u.id);
      const pkg = (await h.topUps.listActive())[0];
      const started = await h.checkout.start(u.id, {
        kind: 'topup',
        topUpPackageId: pkg.id,
      });
      const paid = h.provider.pay(started.providerOrderId);
      const body = {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      };
      await h.checkout.verify(u.id, body);
      await h.checkout.verify(u.id, body);
      expect(await balance(u.id)).toBe(before + pkg.credits);
      expect(
        await h.prisma.creditTransaction.count({
          where: { userId: u.id, type: 'TOPUP_PURCHASE' },
        }),
      ).toBe(1);
      await expectConsistent(u.id);
    });

    it('top-up expiry follows the admin policy', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      await h.config.update(
        { topUpExpiryPolicy: 'DAYS', topUpExpiryDays: 30 },
        admin.id,
      );
      const u = await createUser(h);
      const pkg = (await h.topUps.listActive())[0];
      const started = await h.checkout.start(u.id, {
        kind: 'topup',
        topUpPackageId: pkg.id,
      });
      const paid = h.provider.pay(started.providerOrderId);
      await h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      });
      const bucket = await h.prisma.creditBucket.findFirstOrThrow({
        where: { userId: u.id, source: 'TOPUP' },
      });
      expect(
        Math.round((bucket.expiresAt!.getTime() - Date.now()) / 86_400_000),
      ).toBe(30);
    });

    it('a full refund removes the remaining top-up credits (and is idempotent)', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const u = await createUser(h);
      await h.subscriptions.getActiveSubscription(u.id);
      const before = await balance(u.id);
      const pkg = (await h.topUps.listActive())[0];
      const started = await h.checkout.start(u.id, {
        kind: 'topup',
        topUpPackageId: pkg.id,
      });
      const paid = h.provider.pay(started.providerOrderId);
      await h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      });
      await h.credits.debit({
        userId: u.id,
        amount: before + 100,
        type: 'USAGE_DEBIT',
        idempotencyKey: 'spend',
      });

      const r = await h.fulfillment.refund(
        started.paymentId,
        admin.id,
        'Customer request',
      );
      expect(r.creditsRemoved).toBe(pkg.credits - 100);
      expect(await balance(u.id)).toBe(0);
      expect(
        (
          await h.prisma.payment.findUniqueOrThrow({
            where: { id: started.paymentId },
          })
        ).paymentStatus,
      ).toBe('REFUNDED');
      const again = await h.fulfillment.applyRefund(
        started.paymentId,
        999999,
        null,
        'webhook',
      );
      expect(again.duplicate).toBe(true);
      await expectConsistent(u.id);
    });

    it('refunding a plan purchase ends it and returns the customer to Free', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const u = await createUser(h);
      const { started } = await buyPlan(h, u.id, 'growth');
      await h.fulfillment.refund(
        started.paymentId,
        admin.id,
        'Mistaken purchase',
      );
      expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
        'FREE',
      );
      expect(
        await h.prisma.creditBucket.count({
          where: { userId: u.id, initialAmount: 100000, remaining: { gt: 0 } },
        }),
      ).toBe(0);
      await expectConsistent(u.id);
    });
  });

  // ── Usage → credits & entitlements ───────────────────────
  describe('usage', () => {
    it('debits a finished call’s credits once and blocks new calls at zero', async () => {
      const u = await createUser(h);
      await h.subscriptions.getActiveSubscription(u.id);
      const start = await balance(u.id);
      await h.usage.recordCallUsage(u.id, 'call-1', {
        audioMinutes: 10,
        videoMinutes: 10,
        screenShareMinutes: 2,
        participants: 2,
      });
      await h.usage.recordCallUsage(u.id, 'call-1', {
        audioMinutes: 10,
        videoMinutes: 10,
        screenShareMinutes: 2,
        participants: 2,
      });
      const cfg = await h.config.get();
      const expected =
        10 * cfg.audioCreditsPerMinute +
        10 * cfg.videoCreditsPerMinute +
        2 * cfg.screenShareCreditsPerMinute;
      expect(await balance(u.id)).toBe(start - expected);
      expect(
        await h.prisma.callUsage.count({ where: { callId: 'call-1' } }),
      ).toBe(1);

      await h.usage.recordCallUsage(u.id, 'call-2', {
        audioMinutes: 100000,
        videoMinutes: 0,
        screenShareMinutes: 0,
        participants: 2,
      });
      expect(await balance(u.id)).toBe(0);
      const debit = await h.prisma.creditTransaction.findUniqueOrThrow({
        where: { idempotencyKey: 'usage:call-2' },
      });
      expect((debit.metadata as any).shortfall).toBeGreaterThan(0);
      expect((await h.usage.canStartCall(u.id, 'AUDIO')).allowed).toBe(false);
      expect(await h.prisma.usageInvoice.count()).toBe(0); // never an unpaid invoice
      await expectConsistent(u.id);
    });

    it('sends threshold notifications once per period', async () => {
      const u = await createUser(h);
      await h.subscriptions.getActiveSubscription(u.id);
      const credits = await balance(u.id);
      const cfg = await h.config.get();
      await h.usage.recordCallUsage(u.id, 'c1', {
        audioMinutes: (credits * 0.85) / cfg.audioCreditsPerMinute,
        videoMinutes: 0,
        screenShareMinutes: 0,
        participants: 2,
      });
      await h.usage.recordCallUsage(u.id, 'c2', {
        audioMinutes: 1,
        videoMinutes: 0,
        screenShareMinutes: 0,
        participants: 2,
      });
      const types = h.notifications.createNotification.mock.calls.map(
        (c: any[]) => c[0].type,
      );
      expect(types.filter((t: string) => t === 'CREDITS_LOW')).toHaveLength(1);
    });

    it('checks features centrally from the purchased entitlements', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const u = await createUser(h);
      expect(await h.entitlements.hasFeature(u.id, 'WEBHOOKS')).toBe(true);
      expect(await h.entitlements.hasFeature(u.id, 'NOT_A_FEATURE')).toBe(
        false,
      );
      await h.plans.createPlan(
        {
          slug: 'ui-only',
          name: 'UI only',
          type: 'PAID',
          pricePaise: 99900,
          includedCredits: 50000,
          features: ['HOSTED_UI'],
        },
        admin.id,
      );
      await buyPlan(h, u.id, 'ui-only');
      expect(await h.entitlements.hasFeature(u.id, 'HOSTED_UI')).toBe(true);
      expect(await h.entitlements.hasFeature(u.id, 'WEBHOOKS')).toBe(false);
    });
  });

  // ── Custom plans ─────────────────────────────────────────
  describe('custom plans', () => {
    it('opens a support conversation with the predefined message, once (even under concurrent clicks)', async () => {
      const u = await createUser(h);
      const results = await Promise.all([
        h.customPlans.requestCustomPlan(u.id),
        h.customPlans.requestCustomPlan(u.id),
        h.customPlans.requestCustomPlan(u.id),
      ]);
      expect(results.filter((r) => r.created)).toHaveLength(1);
      expect(new Set(results.map((r) => r.request!.ticketId)).size).toBe(1);
      const ticket = await h.prisma.supportTicket.findUniqueOrThrow({
        where: { id: results[0].request!.ticketId },
        include: { messages: true },
      });
      expect(ticket.type).toBe('CUSTOM_PLAN');
      expect(ticket.messages).toHaveLength(1);
      expect(ticket.messages[0].message).toBe(CUSTOM_PLAN_INITIAL_MESSAGE);
      expect(h.notifications.notifyAdmins).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'CUSTOM_PLAN_REQUEST_CREATED' }),
      );
    });

    it('admin reply → offer → customer accepts & pays → custom subscription active', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const u = await createUser(h);
      const { request } = await h.customPlans.requestCustomPlan(u.id);
      await h.support.addAdminMessage(
        admin.id,
        request!.ticketId,
        'Happy to help!',
      );
      expect(
        (
          await h.prisma.customPlanRequest.findUniqueOrThrow({
            where: { id: request!.id },
          })
        ).status,
      ).toBe('CONTACTED');

      const detail = await h.customPlans.createOffer(
        request!.id,
        {
          name: 'Acme Enterprise',
          pricePaise: 2500000,
          includedCredits: 2000000,
          features: ['HOSTED_UI', 'WEBHOOKS'],
        },
        admin.id,
      );
      expect(detail.status).toBe('PROPOSAL_SENT');
      const offer = detail.offers[0];
      expect(offer.plan.isPublic).toBe(false);
      expect(
        (await h.plans.listPublicPlans()).some((p) => p.id === offer.plan.id),
      ).toBe(false);

      // Nothing activates before payment.
      const started = await h.checkout.start(u.id, {
        kind: 'offer',
        offerId: offer.id,
      });
      expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
        'FREE',
      );
      const paid = h.provider.pay(started.providerOrderId);
      await h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerOrderId: started.providerOrderId,
        providerPaymentId: paid.providerPaymentId,
        signature: paid.signature,
      });

      const sub = await h.subscriptions.getActiveSubscription(u.id);
      expect(sub.planName).toBe('Acme Enterprise');
      expect(sub.planType).toBe('CUSTOM');
      expect(
        (
          await h.prisma.customPlanOffer.findUniqueOrThrow({
            where: { id: offer.id },
          })
        ).status,
      ).toBe('ACCEPTED');
      expect(
        (
          await h.prisma.customPlanRequest.findUniqueOrThrow({
            where: { id: request!.id },
          })
        ).status,
      ).toBe('ACCEPTED');
      // Another customer cannot use this offer or plan.
      const other = await createUser(h);
      await expect(
        h.checkout.start(other.id, { kind: 'offer', offerId: offer.id }),
      ).rejects.toThrow(/not found/i);
      await expect(
        h.checkout.start(other.id, { kind: 'plan', planId: offer.plan.id }),
      ).rejects.toThrow(/not found/i);
    });

    it('a new request is allowed after the previous one is closed', async () => {
      const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
      const u = await createUser(h);
      const first = await h.customPlans.requestCustomPlan(u.id);
      await h.customPlans.updateRequest(
        first.request!.id,
        { status: 'CLOSED' },
        admin.id,
      );
      const second = await h.customPlans.requestCustomPlan(u.id);
      expect(second.created).toBe(true);
      expect(second.request!.id).not.toBe(first.request!.id);
    });
  });
});
