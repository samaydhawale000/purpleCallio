import {
  createHarness,
  createUser,
  Harness,
  planBySlug,
  resetDb,
  TEST_DB_URL,
} from './billing-harness';

/**
 * Auto-renew (provider-managed mandates) against a real Postgres.
 *   BILLING_TEST_DATABASE_URL=… npm run test:billing
 */
const d = TEST_DB_URL ? describe : describe.skip;

// Each test truncates and re-seeds the database; give that room on a busy machine.
jest.setTimeout(30_000);

d('auto-renew (integration)', () => {
  let h: Harness;
  beforeAll(() => {
    h = createHarness();
  });
  afterAll(async () => {
    await h.prisma.$disconnect();
  });
  beforeEach(async () => {
    await resetDb(h);
    h.provider.cancelledMandates = [];
    h.provider.planChanges = [];
    h.notifications.createNotification.mockClear();
    h.notifications.notifyAdmins.mockClear();
  });

  const balance = async (userId: string) =>
    (await h.prisma.creditWallet.findUnique({ where: { userId } }))?.balance ??
    0;
  const growthAllocations = (userId: string) =>
    h.prisma.creditTransaction.count({
      where: { userId, type: 'SUBSCRIPTION_ALLOCATION', amount: 100000 },
    });

  /** Buys Growth with auto-renew and completes the first charge via the browser callback. */
  async function buyWithAutoRenew(userId: string, slug = 'growth') {
    const plan = await planBySlug(h, slug);
    const started = await h.checkout.start(userId, {
      kind: 'plan',
      planId: plan.id,
      autoRenew: true,
    });
    const first = h.provider.chargeMandate(started.providerSubscriptionId!);
    const result = await h.checkout.verify(userId, {
      paymentId: started.paymentId,
      providerSubscriptionId: started.providerSubscriptionId,
      providerPaymentId: first.providerPaymentId,
      signature: first.signature,
    });
    const sub = await h.subscriptions.getActiveSubscription(userId);
    return { plan, started, first, result, sub };
  }

  async function renewViaWebhook(
    sub: {
      providerSubscriptionId: string | null;
      currentPeriodEnd: Date | null;
    },
    eventId: string,
    amountPaise?: number,
  ) {
    const charge = h.provider.chargeMandate(
      sub.providerSubscriptionId!,
      amountPaise ? { amountPaise } : {},
    );
    const currentEnd = new Date(
      sub.currentPeriodEnd!.getTime() + 30 * 86_400_000,
    );
    const evt = h.provider.mandateWebhook(
      eventId,
      'subscription.charged',
      {
        providerSubscriptionId: sub.providerSubscriptionId!,
        status: 'active',
        currentEnd,
      },
      h.provider.payments.get(charge.providerPaymentId),
    );
    await h.webhooks.handle(evt.raw, evt.headers);
    return { charge, evt, currentEnd };
  }

  it('is on by default at checkout and sets up a mandate instead of a one-time order', async () => {
    await h.prisma.billingConfig.update({
      where: { key: 'default' },
      data: { autoRenewDefault: true },
    });
    const u = await createUser(h);
    const growth = await planBySlug(h, 'growth');
    const quote = await h.checkout.quote(u.id, {
      kind: 'plan',
      planId: growth.id,
    });
    expect(quote.autoRenew).toEqual({
      available: true,
      on: true,
      amountPaise: quote.totalPaise,
    });
    const started = await h.checkout.start(u.id, {
      kind: 'plan',
      planId: growth.id,
    });
    expect(started.mode).toBe('subscription');
    expect(started.providerOrderId).toBeNull();
    expect(h.provider.mandateAmount(started.providerSubscriptionId!)).toBe(
      quote.totalPaise,
    );
    // Unticked → one-time payment.
    const once = await h.checkout.start(u.id, {
      kind: 'plan',
      planId: growth.id,
      autoRenew: false,
    });
    expect(once.mode).toBe('order');
    // Top-ups never auto-renew.
    const pkg = (await h.topUps.listActive())[0];
    expect(
      (await h.checkout.quote(u.id, { kind: 'topup', topUpPackageId: pkg.id }))
        .autoRenew.available,
    ).toBe(false);
  });

  it('activates only after the first verified charge and records the mandate', async () => {
    const u = await createUser(h);
    const plan = await planBySlug(h, 'growth');
    const started = await h.checkout.start(u.id, {
      kind: 'plan',
      planId: plan.id,
      autoRenew: true,
    });
    expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
      'FREE',
    );
    const first = h.provider.chargeMandate(started.providerSubscriptionId!);
    await expect(
      h.checkout.verify(u.id, {
        paymentId: started.paymentId,
        providerSubscriptionId: started.providerSubscriptionId,
        providerPaymentId: first.providerPaymentId,
        signature: 'forged',
      }),
    ).rejects.toThrow(/could not verify/);
    await h.checkout.verify(u.id, {
      paymentId: started.paymentId,
      providerSubscriptionId: started.providerSubscriptionId,
      providerPaymentId: first.providerPaymentId,
      signature: first.signature,
    });
    const sub = await h.subscriptions.getActiveSubscription(u.id);
    expect(sub).toMatchObject({
      planName: 'Growth',
      autoRenew: true,
      providerSubscriptionStatus: 'active',
      renewalAmountPaise: started.amountPaise,
    });
    expect(await growthAllocations(u.id)).toBe(1);
  });

  it('first charge arriving by webhook before the callback activates exactly once', async () => {
    const u = await createUser(h);
    const plan = await planBySlug(h, 'growth');
    const started = await h.checkout.start(u.id, {
      kind: 'plan',
      planId: plan.id,
      autoRenew: true,
    });
    const first = h.provider.chargeMandate(started.providerSubscriptionId!);
    const evt = h.provider.mandateWebhook(
      'e1',
      'subscription.charged',
      {
        providerSubscriptionId: started.providerSubscriptionId!,
        status: 'active',
      },
      h.provider.payments.get(first.providerPaymentId),
    );
    await h.webhooks.handle(evt.raw, evt.headers);
    await h.checkout.verify(u.id, {
      paymentId: started.paymentId,
      providerSubscriptionId: started.providerSubscriptionId,
      providerPaymentId: first.providerPaymentId,
      signature: first.signature,
    });
    await h.webhooks.handle(evt.raw, evt.headers);
    expect(await growthAllocations(u.id)).toBe(1);
    expect(
      await h.prisma.payment.count({
        where: { userId: u.id, paymentStatus: 'PAID' },
      }),
    ).toBe(1);
  });

  it('renews on the provider charge: extends to the provider cycle end and adds credits once', async () => {
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    const { evt, currentEnd } = await renewViaWebhook(sub, 'renew-1');
    await h.webhooks.handle(evt.raw, evt.headers); // redelivery
    const renewed = await h.subscriptions.getActiveSubscription(u.id);
    expect(renewed.id).toBe(sub.id);
    expect(renewed.currentPeriodEnd!.toISOString()).toBe(
      currentEnd.toISOString(),
    );
    expect(await growthAllocations(u.id)).toBe(2);
    const renewal = await h.prisma.payment.findFirstOrThrow({
      where: { userId: u.id, purpose: 'SUBSCRIPTION_RENEWAL' },
    });
    expect(renewal).toMatchObject({
      paymentStatus: 'PAID',
      amount: sub.renewalAmountPaise,
    });
    expect(renewal.receiptNumber).not.toBeNull();
    expect(renewal.subtotalPaise + renewal.taxPaise).toBe(renewal.amount);
  });

  it('the same renewal charge delivered under different event ids renews once', async () => {
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    const { charge, currentEnd } = await renewViaWebhook(sub, 'renew-a');
    const again = h.provider.mandateWebhook(
      'renew-b',
      'subscription.charged',
      {
        providerSubscriptionId: sub.providerSubscriptionId!,
        status: 'active',
        currentEnd,
      },
      h.provider.payments.get(charge.providerPaymentId),
    );
    await h.webhooks.handle(again.raw, again.headers);
    expect(await growthAllocations(u.id)).toBe(2);
    expect(
      await h.prisma.payment.count({
        where: { userId: u.id, purpose: 'SUBSCRIPTION_RENEWAL' },
      }),
    ).toBe(1);
  });

  it('keeps the plan through the grace window while a renewal is pending, then falls back to Free and stops the mandate', async () => {
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    await h.prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - 3_600_000) },
    });
    expect((await h.subscriptions.getActiveSubscription(u.id)).planName).toBe(
      'Growth',
    );

    await h.prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - 80 * 3_600_000) },
    });
    expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
      'FREE',
    );
    expect(
      (await h.prisma.subscription.findUniqueOrThrow({ where: { id: sub.id } }))
        .status,
    ).toBe('EXPIRED');
    expect(h.provider.cancelledMandates).toContainEqual({
      id: sub.providerSubscriptionId,
      atCycleEnd: false,
    });
  });

  it('a late renewal charge after the plan lapsed still delivers a plan (money was taken)', async () => {
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    await h.prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - 80 * 3_600_000) },
    });
    await h.subscriptions.getActiveSubscription(u.id); // lapses to Free
    const lapsed = await h.prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    await renewViaWebhook(
      { ...lapsed, providerSubscriptionId: sub.providerSubscriptionId },
      'late-1',
    );
    expect((await h.subscriptions.getActiveSubscription(u.id)).planName).toBe(
      'Growth',
    );
  });

  it('halted mandates turn auto-renew off and tell the customer', async () => {
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    const evt = h.provider.mandateWebhook('h1', 'subscription.halted', {
      providerSubscriptionId: sub.providerSubscriptionId!,
      status: 'halted',
    });
    await h.webhooks.handle(evt.raw, evt.headers);
    const after = await h.prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(after).toMatchObject({
      autoRenew: false,
      autoRenewOffReason: 'renewal_failed',
      status: 'ACTIVE',
    });
    expect(h.notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Auto-renew stopped' }),
    );
    // No grace any more: the plan ends at period end.
    await h.prisma.subscription.update({
      where: { id: sub.id },
      data: { currentPeriodEnd: new Date(Date.now() - 60_000) },
    });
    expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
      'FREE',
    );
  });

  it('price increases apply from the next renewal, with notice', async () => {
    const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
    const u = await createUser(h);
    const { sub, started } = await buyWithAutoRenew(u.id);
    await h.plans.updatePlan(sub.planId!, { pricePaise: 249900 }, admin.id);
    await h.autoRenew.syncPlan(sub.planId!);

    const synced = await h.prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    const newTotal = 249900 + Math.round(249900 * 0.18);
    expect(synced.renewalAmountPaise).toBe(newTotal);
    expect(synced.pricePaise).toBe(199900); // current period unchanged
    expect(h.provider.mandateAmount(sub.providerSubscriptionId!)).toBe(
      newTotal,
    );
    expect(h.notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Your renewal price is changing' }),
    );
    expect(started.amountPaise).not.toBe(newTotal);

    await renewViaWebhook(synced, 'renew-price', newTotal);
    const renewed = await h.subscriptions.getActiveSubscription(u.id);
    expect(renewed.pricePaise).toBe(249900);
    expect(renewed.renewalPlanVersionId).toBeNull();
  });

  it('if the provider cannot move the mandate, auto-renew is switched off rather than charging an unannounced amount', async () => {
    const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    await h.plans.updatePlan(sub.planId!, { pricePaise: 299900 }, admin.id);
    h.provider.failNextPlanChange = true;
    await h.autoRenew.syncPlan(sub.planId!);
    const after = await h.prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(after).toMatchObject({
      autoRenew: false,
      autoRenewOffReason: 'renewal_terms_changed',
    });
    expect(h.provider.cancelledMandates).toContainEqual({
      id: sub.providerSubscriptionId,
      atCycleEnd: true,
    });
  });

  it('cancelling the plan stops the mandate at cycle end', async () => {
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    const cancelled = await h.subscriptions.cancel(u.id);
    expect(cancelled).toMatchObject({
      autoRenew: false,
      cancelAtPeriodEnd: true,
    });
    expect(h.provider.cancelledMandates).toContainEqual({
      id: sub.providerSubscriptionId,
      atCycleEnd: true,
    });
  });

  it('upgrading cancels the old mandate immediately', async () => {
    const u = await createUser(h);
    const { sub: starter } = await buyWithAutoRenew(u.id, 'starter');
    const { sub: growth } = await buyWithAutoRenew(u.id, 'growth');
    expect(growth.planName).toBe('Growth');
    expect(h.provider.cancelledMandates).toContainEqual({
      id: starter.providerSubscriptionId,
      atCycleEnd: false,
    });
    expect(
      (
        await h.prisma.subscription.findUniqueOrThrow({
          where: { id: starter.id },
        })
      ).autoRenew,
    ).toBe(false);
  });

  it('manual early renewal is blocked while auto-renew is on', async () => {
    const u = await createUser(h);
    await buyWithAutoRenew(u.id);
    await expect(h.checkout.quote(u.id, { kind: 'renewal' })).rejects.toThrow(
      /Auto-renew is on/,
    );
  });

  it('a scheduled downgrade moves the mandate to the cheaper plan and the renewal switches plans', async () => {
    const u = await createUser(h);
    const { sub } = await buyWithAutoRenew(u.id);
    const starter = await planBySlug(h, 'starter');
    await h.subscriptions.scheduleDowngrade(u.id, starter.id);
    const starterTotal = 49900 + Math.round(49900 * 0.18);
    expect(h.provider.mandateAmount(sub.providerSubscriptionId!)).toBe(
      starterTotal,
    );
    const synced = await h.prisma.subscription.findUniqueOrThrow({
      where: { id: sub.id },
    });
    expect(synced.planName).toBe('Growth');
    await renewViaWebhook(synced, 'renew-down', starterTotal);
    expect((await h.subscriptions.getActiveSubscription(u.id)).planName).toBe(
      'Starter',
    );
  });

  it('can be turned on later (first charge at period end) and off again', async () => {
    const u = await createUser(h);
    const plan = await planBySlug(h, 'starter');
    const started = await h.checkout.start(u.id, {
      kind: 'plan',
      planId: plan.id,
      autoRenew: false,
    });
    const paid = h.provider.pay(started.providerOrderId!);
    await h.checkout.verify(u.id, {
      paymentId: started.paymentId,
      providerOrderId: started.providerOrderId,
      providerPaymentId: paid.providerPaymentId,
      signature: paid.signature,
    });
    const sub = await h.subscriptions.getActiveSubscription(u.id);
    expect(sub.autoRenew).toBe(false);

    const session = await h.autoRenew.startEnable(u.id);
    expect(
      h.provider.mandates
        .get(session.providerSubscriptionId)!
        .startAt!.toISOString(),
    ).toBe(sub.currentPeriodEnd!.toISOString());
    const auth = h.provider.chargeMandate(session.providerSubscriptionId, {
      amountPaise: 0,
    });
    const before = await balance(u.id);
    const state = await h.autoRenew.confirmEnable(u.id, {
      providerSubscriptionId: session.providerSubscriptionId,
      providerPaymentId: auth.providerPaymentId,
      signature: auth.signature,
    });
    expect(state.autoRenew).toBe(true);
    expect(await balance(u.id)).toBe(before); // authorization adds nothing
    expect(await h.prisma.payment.count({ where: { userId: u.id } })).toBe(1);

    const off = await h.autoRenew.disableForCustomer(u.id);
    expect(off.autoRenew).toBe(false);
    expect(h.provider.cancelledMandates).toContainEqual({
      id: session.providerSubscriptionId,
      atCycleEnd: true,
    });
  });

  it('an abandoned auto-renew checkout cancels its unpaid mandate', async () => {
    const u = await createUser(h);
    const plan = await planBySlug(h, 'growth');
    const started = await h.checkout.start(u.id, {
      kind: 'plan',
      planId: plan.id,
      autoRenew: true,
    });
    await h.checkout.abandon(started.paymentId, 'test');
    expect(h.provider.cancelledMandates).toContainEqual({
      id: started.providerSubscriptionId,
      atCycleEnd: false,
    });
  });

  it('a full refund of an auto-renewing plan stops the mandate', async () => {
    const admin = await createUser(h, 'admin@test.dev', { role: 'ADMIN' });
    const u = await createUser(h);
    const { sub, started } = await buyWithAutoRenew(u.id);
    await h.fulfillment.refund(started.paymentId, admin.id, 'Requested');
    expect((await h.subscriptions.getActiveSubscription(u.id)).planType).toBe(
      'FREE',
    );
    expect(h.provider.cancelledMandates).toContainEqual({
      id: sub.providerSubscriptionId,
      atCycleEnd: false,
    });
  });
});
