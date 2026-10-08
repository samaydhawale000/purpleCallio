import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  BillingStatus,
  CreditBucketSource,
  CreditTransactionType,
  NotificationType,
  Payment,
  PaymentPurpose,
  PaymentStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { PAYMENT_PROVIDER } from '../../payment/providers/payment-provider';
import type {
  PaymentProvider,
  ProviderPayment,
} from '../../payment/providers/payment-provider';
import { BillingAuditService } from '../billing-audit.service';
import { BillingConfigService } from '../billing-config.service';
import { BillingNotificationService } from '../billing-notification.service';
import { CreditService } from '../credits/credit.service';
import {
  SubscriptionService,
  snapshotData,
} from '../subscriptions/subscription.service';
import { AutoRenewService } from '../subscriptions/auto-renew.service';

type Tx = Prisma.TransactionClient;
type PostCommit = (() => Promise<unknown>)[];

const SUBSCRIPTION_PURPOSES: PaymentPurpose[] = [
  PaymentPurpose.SUBSCRIPTION_PURCHASE,
  PaymentPurpose.SUBSCRIPTION_UPGRADE,
  PaymentPurpose.CUSTOM_PLAN,
];

/**
 * Turns a verified provider payment into entitlements — exactly once.
 *
 * Both the browser callback and the provider webhook land here; whichever
 * arrives first does the work and the other finds the Payment already PAID.
 * Everything (Payment → PAID, subscription activation/renewal, credit
 * grant, receipt number) commits in ONE transaction under the customer's
 * wallet lock plus a row lock on the Payment, so there is never a state
 * where money was taken but the plan/credits are missing, or credits were
 * granted twice. Unique providerPaymentId / ledger idempotency keys are the
 * database-level backstops.
 */
@Injectable()
export class BillingFulfillmentService {
  private readonly logger = new Logger(BillingFulfillmentService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
    private credits: CreditService,
    private subscriptions: SubscriptionService,
    private config: BillingConfigService,
    private audit: BillingAuditService,
    private notify: BillingNotificationService,
    private notifications: NotificationService,
    private autoRenew: AutoRenewService,
  ) {}

  private async lockPayment(tx: Tx, paymentId: string): Promise<Payment> {
    await tx.$queryRaw`SELECT "id" FROM "Payment" WHERE "id" = ${paymentId} FOR UPDATE`;
    return tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
  }

  /**
   * Fulfills a payment the provider reports as captured. A capture is
   * honored even if the checkout was locally marked FAILED/EXPIRED (the
   * customer retried inside Checkout, or paid after we gave up waiting) —
   * money was taken, so the purchase must be delivered.
   */
  async fulfill(
    paymentId: string,
    providerPayment: ProviderPayment,
    source: 'callback' | 'webhook',
    opts: { providerPeriodEnd?: Date | null } = {},
  ) {
    const head = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!head) throw new NotFoundException('Payment not found');
    if (!head.userId) throw new BadRequestException('Payment has no customer.');
    if (head.paymentStatus === PaymentStatus.PAID)
      return { alreadyFulfilled: true };

    if (providerPayment.status !== 'captured') {
      throw new BadRequestException('Payment is not captured.');
    }
    if (
      providerPayment.amountPaise !== head.amount ||
      providerPayment.currency !== head.currency
    ) {
      await this.markFailed(paymentId, providerPayment, 'Amount mismatch');
      await this.notifications.notifyAdmins({
        type: NotificationType.PAYMENT_FAILED,
        title: 'Payment amount mismatch',
        message: `Payment ${paymentId} was captured for ${providerPayment.amountPaise} ${providerPayment.currency} but expected ${head.amount} ${head.currency}. Nothing was activated — review and refund.`,
        metadata: { paymentId },
        dedupeKey: `admin:payment-mismatch:${paymentId}`,
      });
      return { alreadyFulfilled: false, mismatch: true };
    }

    const postCommit: PostCommit = [];
    const outcome = await this.credits.withWallet(head.userId, async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      if (payment.paymentStatus === PaymentStatus.PAID)
        return { alreadyFulfilled: true };
      if (payment.paymentStatus === PaymentStatus.REFUNDED)
        return { alreadyFulfilled: true };

      await tx.paymentAttempt.upsert({
        where: { providerPaymentId: providerPayment.providerPaymentId },
        create: {
          paymentId,
          providerPaymentId: providerPayment.providerPaymentId,
          status: 'captured',
          method: providerPayment.method,
        },
        update: { status: 'captured', method: providerPayment.method },
      });

      const [{ nextval }] = await tx.$queryRaw<
        { nextval: bigint }[]
      >`SELECT nextval('"Payment_receipt_seq"')`;
      const paid = await tx.payment.update({
        where: { id: paymentId },
        data: {
          paymentStatus: PaymentStatus.PAID,
          providerPaymentId: providerPayment.providerPaymentId,
          paymentMethod: providerPayment.method,
          paidAt: new Date(),
          receiptNumber: Number(nextval),
          failureReason: null,
        },
      });

      let subscriptionId: string | null = paid.subscriptionId;
      if (SUBSCRIPTION_PURPOSES.includes(paid.purpose)) {
        if (!paid.subscriptionId)
          throw new Error(
            `Payment ${paid.id} has no subscription to activate.`,
          );
        const sub = await this.subscriptions.activatePending(
          tx,
          paid.subscriptionId,
          paid,
          postCommit,
        );
        subscriptionId = sub.id;
        if (paid.customOfferId) await this.acceptOffer(tx, paid.customOfferId);
      } else if (paid.purpose === PaymentPurpose.SUBSCRIPTION_RENEWAL) {
        subscriptionId = await this.renew(
          tx,
          paid,
          postCommit,
          opts.providerPeriodEnd,
        );
      } else if (paid.purpose === PaymentPurpose.TOPUP) {
        await this.grantTopUp(tx, paid);
        postCommit.push(() =>
          this.notify.topUpSucceeded(paid.userId!, paid.credits, paid.id),
        );
      } else {
        throw new Error(
          `Payment ${paid.id} has unsupported purpose ${paid.purpose}.`,
        );
      }

      await this.audit.log(
        {
          action:
            paid.purpose === PaymentPurpose.TOPUP
              ? 'TOPUP_PURCHASED'
              : 'PAYMENT_RECEIVED',
          actorId: paid.userId,
          entity: 'Payment',
          entityId: paid.id,
          newValue: {
            purpose: paid.purpose,
            amount: paid.amount,
            credits: paid.credits,
            subscriptionId,
          },
          extra: {
            source,
            providerPaymentId: providerPayment.providerPaymentId,
          },
        },
        tx,
      );
      postCommit.unshift(() => this.notify.paymentSucceeded(paid));
      return { alreadyFulfilled: false };
    });

    await this.subscriptions.flush(postCommit);
    return outcome;
  }

  /**
   * Renewal of a plan that was still active at checkout. If it lapsed
   * before the payment completed, the customer is now on Free: start a
   * fresh subscription on the paid-for version instead.
   */
  private async renew(
    tx: Tx,
    payment: Payment,
    postCommit: PostCommit,
    providerPeriodEnd?: Date | null,
  ): Promise<string> {
    const sub = payment.subscriptionId
      ? await tx.subscription.findUnique({
          where: { id: payment.subscriptionId },
        })
      : null;
    if (sub && sub.status === BillingStatus.ACTIVE) {
      const renewed = await this.subscriptions.extendForRenewal(
        tx,
        sub.id,
        payment,
        postCommit,
        providerPeriodEnd,
      );
      return renewed.id;
    }
    if (!payment.planVersionId)
      throw new Error(`Renewal payment ${payment.id} has no plan version.`);
    const version = await tx.planVersion.findUniqueOrThrow({
      where: { id: payment.planVersionId },
      include: { plan: true },
    });
    // A late auto-renew charge keeps its mandate on the new subscription.
    const mandateId =
      payment.providerSubscriptionId &&
      sub?.providerSubscriptionId === payment.providerSubscriptionId
        ? sub.providerSubscriptionId
        : null;
    if (mandateId && sub) {
      await tx.subscription.update({
        where: { id: sub.id },
        data: { providerSubscriptionId: null, autoRenew: false },
      });
    }
    const pending = await tx.subscription.create({
      data: {
        companyId: payment.userId!,
        status: BillingStatus.PENDING_PAYMENT,
        ...snapshotData(version.plan, version),
        previousSubscriptionId: sub?.id ?? null,
        ...(mandateId ? { providerSubscriptionId: mandateId } : {}),
      },
    });
    await tx.payment.update({
      where: { id: payment.id },
      data: { subscriptionId: pending.id },
    });
    const activated = await this.subscriptions.activatePending(
      tx,
      pending.id,
      payment,
      postCommit,
    );
    return activated.id;
  }

  private async grantTopUp(tx: Tx, payment: Payment) {
    const config = await this.config.get(tx);
    let expiresAt: Date | null = null;
    if (config.topUpExpiryPolicy === 'DAYS' && config.topUpExpiryDays) {
      expiresAt = new Date(Date.now() + config.topUpExpiryDays * 86_400_000);
    } else if (config.topUpExpiryPolicy === 'SUBSCRIPTION_END') {
      const postCommit: PostCommit = [];
      const sub = await this.subscriptions.ensureCurrentLocked(
        tx,
        payment.userId!,
        postCommit,
      );
      expiresAt = sub.currentPeriodEnd;
    }
    await this.credits.grant(
      {
        userId: payment.userId!,
        amount: payment.credits,
        type: CreditTransactionType.TOPUP_PURCHASE,
        source: CreditBucketSource.TOPUP,
        expiresAt,
        referenceType: 'Payment',
        referenceId: payment.id,
        idempotencyKey: `topup:${payment.id}`,
        metadata: {
          topUpPackageId: payment.topUpPackageId,
          description: payment.description,
          pricePaise: payment.subtotalPaise,
        },
      },
      tx,
    );
  }

  private async acceptOffer(tx: Tx, offerId: string) {
    const offer = await tx.customPlanOffer.update({
      where: { id: offerId },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    if (offer.requestId) {
      await tx.customPlanRequest.update({
        where: { id: offer.requestId },
        data: { status: 'ACCEPTED', closedAt: new Date() },
      });
    }
  }

  /**
   * A charge on an auto-renew mandate (provider `subscription.charged`).
   * The first charge of a new mandate completes its pending checkout; later
   * charges become renewal payments. Idempotent by provider payment id, so
   * redelivered webhooks and the browser callback can arrive in any order.
   */
  async recordMandateCharge(
    providerPayment: ProviderPayment,
    mandate: { providerSubscriptionId: string; currentEnd: Date | null },
  ) {
    if (providerPayment.status !== 'captured') return { ignored: true };
    const sub = await this.prisma.subscription.findUnique({
      where: { providerSubscriptionId: mandate.providerSubscriptionId },
    });
    if (!sub) return { ignored: true };

    const known = await this.prisma.payment.findUnique({
      where: { providerPaymentId: providerPayment.providerPaymentId },
    });
    if (known) {
      if (known.paymentStatus !== PaymentStatus.PAID) {
        await this.fulfill(known.id, providerPayment, 'webhook', {
          providerPeriodEnd: mandate.currentEnd,
        });
      }
      return { paymentId: known.id };
    }

    // First charge of a mandate created at checkout.
    const checkout = await this.prisma.payment.findFirst({
      where: {
        providerSubscriptionId: mandate.providerSubscriptionId,
        purpose: { not: PaymentPurpose.SUBSCRIPTION_RENEWAL },
        paymentStatus: {
          in: [
            PaymentStatus.PENDING,
            PaymentStatus.FAILED,
            PaymentStatus.EXPIRED,
          ],
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (checkout && sub.status !== BillingStatus.ACTIVE) {
      await this.fulfill(checkout.id, providerPayment, 'webhook');
      return { paymentId: checkout.id };
    }

    // Renewal charge.
    const versionId = sub.renewalPlanVersionId ?? sub.planVersionId;
    const version = versionId
      ? await this.prisma.planVersion.findUnique({
          where: { id: versionId },
          include: { plan: true },
        })
      : null;
    const config = await this.config.get();
    const amount = providerPayment.amountPaise;
    const subtotalPaise = Math.round(
      (amount * 100) / (100 + config.taxPercent),
    );
    let renewal: Payment;
    try {
      renewal = await this.prisma.payment.create({
        data: {
          userId: sub.companyId,
          subscriptionId: sub.id,
          purpose: PaymentPurpose.SUBSCRIPTION_RENEWAL,
          provider: this.provider.name,
          providerPaymentId: providerPayment.providerPaymentId,
          providerSubscriptionId: mandate.providerSubscriptionId,
          amount,
          subtotalPaise,
          taxPercent: config.taxPercent,
          taxPaise: amount - subtotalPaise,
          currency: providerPayment.currency,
          credits: version?.includedCredits ?? sub.includedCredits,
          planVersionId: version?.id ?? null,
          description: `${version?.plan.name ?? sub.planName} plan renewal (auto-renew)`,
          lineItems: [
            {
              label: `${version?.plan.name ?? sub.planName} plan renewal (auto-renew)`,
              amountPaise: subtotalPaise,
              credits: version?.includedCredits ?? sub.includedCredits,
            },
            {
              label: `GST (${config.taxPercent}%)`,
              amountPaise: amount - subtotalPaise,
            },
          ],
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') return { duplicate: true };
      throw e;
    }
    if (sub.renewalAmountPaise != null && amount !== sub.renewalAmountPaise) {
      await this.notifications.notifyAdmins({
        type: NotificationType.PAYMENT_FAILED,
        title: 'Auto-renew charged an unexpected amount',
        message: `Mandate ${mandate.providerSubscriptionId} charged ${amount} paise; expected ${sub.renewalAmountPaise}. The renewal was honored — review the customer's terms.`,
        metadata: { paymentId: renewal.id, customerId: sub.companyId },
        dedupeKey: `admin:mandate-amount:${renewal.id}`,
      });
    }
    await this.fulfill(renewal.id, providerPayment, 'webhook', {
      providerPeriodEnd: mandate.currentEnd,
    });
    return { paymentId: renewal.id };
  }

  /** Records a failed attempt. Never touches a PAID payment. */
  async markFailed(
    paymentId: string,
    providerPayment:
      | (Pick<
          ProviderPayment,
          'providerPaymentId' | 'errorCode' | 'errorDescription'
        > & { method?: string | null })
      | null,
    reason: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (
      !payment ||
      payment.paymentStatus === PaymentStatus.PAID ||
      payment.paymentStatus === PaymentStatus.REFUNDED
    )
      return;
    if (providerPayment?.providerPaymentId) {
      await this.prisma.paymentAttempt.upsert({
        where: { providerPaymentId: providerPayment.providerPaymentId },
        create: {
          paymentId,
          providerPaymentId: providerPayment.providerPaymentId,
          status: 'failed',
          method: providerPayment.method ?? null,
          errorCode: providerPayment.errorCode ?? null,
          errorDescription: providerPayment.errorDescription ?? null,
        },
        update: {},
      });
    }
    const updated = await this.prisma.payment.updateMany({
      where: {
        id: paymentId,
        paymentStatus: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] },
      },
      data: {
        paymentStatus: PaymentStatus.FAILED,
        failureReason: reason.slice(0, 300),
      },
    });
    if (
      updated.count &&
      payment.userId &&
      payment.paymentStatus === PaymentStatus.PENDING
    ) {
      await this.audit.log({
        action: 'PAYMENT_FAILED',
        actorId: payment.userId,
        entity: 'Payment',
        entityId: paymentId,
        newValue: { reason, purpose: payment.purpose, amount: payment.amount },
      });
      await this.notify.paymentFailed(payment, reason);
    }
  }

  // ── Refunds ──────────────────────────────────────────────
  /** Admin-initiated full refund through the provider, then local reversal. */
  async refund(paymentId: string, actorId: string, reason: string) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!payment) throw new NotFoundException('Payment not found');
    if (
      payment.paymentStatus !== PaymentStatus.PAID ||
      !payment.providerPaymentId
    ) {
      throw new BadRequestException('Only paid payments can be refunded.');
    }
    if (!reason?.trim())
      throw new BadRequestException('A refund reason is required.');
    const refund = await this.provider.refundPayment(
      payment.providerPaymentId,
      payment.amount - payment.refundedPaise,
    );
    return this.applyRefund(
      paymentId,
      refund.amountPaise || payment.amount - payment.refundedPaise,
      actorId,
      reason.trim(),
    );
  }

  /**
   * Records a refund (from the admin action or a provider webhook). A full
   * refund reverses what the payment bought: top-up credits that remain are
   * removed; a subscription payment ends that subscription immediately,
   * removes the credits it funded and moves the customer to Free. Partial
   * refunds only record the money — credit changes are left to the admin.
   */
  async applyRefund(
    paymentId: string,
    refundedPaise: number,
    actorId: string | null,
    reason: string,
  ) {
    const head = await this.prisma.payment.findUnique({
      where: { id: paymentId },
    });
    if (!head?.userId) throw new NotFoundException('Payment not found');
    const postCommit: PostCommit = [];
    const result = await this.credits.withWallet(head.userId, async (tx) => {
      const payment = await this.lockPayment(tx, paymentId);
      if (payment.paymentStatus === PaymentStatus.REFUNDED)
        return { duplicate: true, creditsRemoved: 0 };
      if (payment.paymentStatus !== PaymentStatus.PAID)
        throw new BadRequestException('Only paid payments can be refunded.');

      const total = Math.min(
        payment.amount,
        Math.max(payment.refundedPaise, refundedPaise),
      );
      const full = total >= payment.amount;
      await tx.payment.update({
        where: { id: paymentId },
        data: {
          refundedPaise: total,
          refundedAt: new Date(),
          ...(full ? { paymentStatus: PaymentStatus.REFUNDED } : {}),
        },
      });
      let creditsRemoved = 0;
      if (full) {
        if (payment.purpose === PaymentPurpose.TOPUP) {
          creditsRemoved = await this.credits.forfeitBuckets(
            payment.userId!,
            { referenceType: 'Payment', referenceId: payment.id },
            CreditTransactionType.REFUND,
            `refund:${payment.id}`,
            tx,
            { paymentId: payment.id, reason },
          );
        } else if (payment.subscriptionId) {
          creditsRemoved = await this.credits.forfeitBuckets(
            payment.userId!,
            {
              subscriptionId: payment.subscriptionId,
              OR: [
                { referenceId: payment.subscriptionId },
                { referenceId: payment.id },
              ],
            },
            CreditTransactionType.REFUND,
            `refund:${payment.id}`,
            tx,
            { paymentId: payment.id, reason },
          );
          const sub = await tx.subscription.findUnique({
            where: { id: payment.subscriptionId },
          });
          if (sub?.status === BillingStatus.ACTIVE) {
            await tx.subscription.update({
              where: { id: sub.id },
              data: {
                status: BillingStatus.CANCELED,
                canceledAt: new Date(),
                currentPeriodEnd: new Date(),
              },
            });
            await this.subscriptions.ensureCurrentLocked(
              tx,
              payment.userId!,
              postCommit,
            );
            if (sub.autoRenew || sub.providerSubscriptionId) {
              postCommit.push(() =>
                this.autoRenew.disable(sub.id, 'refunded', {
                  atCycleEnd: false,
                  notifyCustomer: false,
                }),
              );
            }
          }
        }
      }
      await this.audit.log(
        {
          action: 'PAYMENT_REFUNDED',
          actorId,
          entity: 'Payment',
          entityId: paymentId,
          oldValue: {
            status: payment.paymentStatus,
            refundedPaise: payment.refundedPaise,
          },
          newValue: {
            status: full ? 'REFUNDED' : 'PAID',
            refundedPaise: total,
            creditsRemoved,
          },
          extra: { reason, customerId: payment.userId },
        },
        tx,
      );
      return { duplicate: false, creditsRemoved, full };
    });
    await this.subscriptions.flush(postCommit);
    return result;
  }

  // ── Reads ────────────────────────────────────────────────
  /** Client-facing outcome of a checkout (used for success/failure screens). */
  async describe(paymentId: string) {
    const payment = await this.prisma.payment.findUniqueOrThrow({
      where: { id: paymentId },
    });
    const sub = payment.subscriptionId
      ? await this.prisma.subscription.findUnique({
          where: { id: payment.subscriptionId },
        })
      : null;
    return {
      paymentId: payment.id,
      status: payment.paymentStatus,
      purpose: payment.purpose,
      description: payment.description,
      amountPaise: payment.amount,
      currency: payment.currency,
      credits: payment.credits,
      failureReason:
        payment.paymentStatus === PaymentStatus.PAID
          ? null
          : payment.failureReason,
      receiptNumber: payment.receiptNumber,
      subscription:
        payment.paymentStatus === PaymentStatus.PAID && sub
          ? {
              id: sub.id,
              planName: sub.planName,
              status: sub.status,
              currentPeriodEnd: sub.currentPeriodEnd,
            }
          : null,
    };
  }
}
