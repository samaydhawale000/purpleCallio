import { Injectable } from '@nestjs/common';
import { NotificationType, Payment, Subscription } from '@prisma/client';
import { NotificationService } from '../notification/notification.service';

const fmtCredits = (n: number) => n.toLocaleString('en-IN');
const fmtDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';
const fmtINR = (paise: number) =>
  `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Customer/admin notifications for prepaid billing. Every call carries a
 * dedupe key tied to the underlying event, so a retried webhook or an
 * overlapping job can never notify twice. All sends are best-effort
 * (NotificationService swallows failures) and happen after the business
 * transaction commits.
 */
@Injectable()
export class BillingNotificationService {
  constructor(private notifications: NotificationService) {}

  paymentSucceeded(payment: Payment) {
    return this.notifications.createNotification({
      userId: payment.userId!,
      type: NotificationType.PAYMENT_SUCCESS,
      title: 'Payment successful',
      message: `We received your payment of ${fmtINR(payment.amount)}${payment.description ? ` for ${payment.description}` : ''}.`,
      metadata: { paymentId: payment.id },
      dedupeKey: `payment-success:${payment.id}`,
    });
  }

  paymentFailed(payment: Payment, reason?: string | null) {
    return this.notifications.createNotification({
      userId: payment.userId!,
      type: NotificationType.PAYMENT_FAILED,
      title: 'Payment failed',
      message: `Your payment${payment.description ? ` for ${payment.description}` : ''} didn't go through${reason ? ` (${reason})` : ''}. Nothing was activated — you can try again from Billing.`,
      metadata: { paymentId: payment.id },
      dedupeKey: `payment-failed:${payment.id}`,
    });
  }

  planActivated(sub: Subscription) {
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PLAN_ACTIVATED,
      title: `You're now on ${sub.planName}`,
      message:
        sub.includedCredits > 0
          ? `${fmtCredits(sub.includedCredits)} credits have been added to your account. Your plan is active until ${fmtDate(sub.currentPeriodEnd)}.`
          : `Your plan is active until ${fmtDate(sub.currentPeriodEnd)}.`,
      metadata: { subscriptionId: sub.id },
      dedupeKey: `plan-activated:${sub.id}`,
    });
  }

  planRenewed(sub: Subscription, credits: number) {
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PLAN_ACTIVATED,
      title: `${sub.planName} renewed`,
      message: `${fmtCredits(credits)} credits have been added. Your plan is now active until ${fmtDate(sub.currentPeriodEnd)}.`,
      metadata: { subscriptionId: sub.id },
      dedupeKey: `plan-renewed:${sub.id}:${sub.currentPeriodEnd?.toISOString()}`,
    });
  }

  planExpiringSoon(sub: Subscription) {
    if (sub.autoRenew) {
      const amount = sub.renewalAmountPaise ?? sub.pricePaise;
      return this.notifications.createNotification({
        userId: sub.companyId,
        type: NotificationType.PLAN_EXPIRING,
        title: `${sub.planName} renews on ${fmtDate(sub.currentPeriodEnd)}`,
        message: `Auto-renew will charge ${fmtINR(amount)} (incl. GST) to your saved payment method and add a fresh set of credits. You can turn auto-renew off from Billing before then.`,
        metadata: { subscriptionId: sub.id },
        dedupeKey: `plan-renewing:${sub.id}:${sub.currentPeriodEnd?.toISOString()}`,
      });
    }
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PLAN_EXPIRING,
      title: `${sub.planName} ends on ${fmtDate(sub.currentPeriodEnd)}`,
      message:
        'Auto-renew is off for this plan. Renew from Billing (or turn auto-renew on) to keep your plan and get a fresh set of credits.',
      metadata: { subscriptionId: sub.id },
      dedupeKey: `plan-expiring:${sub.id}:${sub.currentPeriodEnd?.toISOString()}`,
    });
  }

  autoRenewChanged(sub: Subscription, on: boolean, reason?: string) {
    const why: Record<string, string> = {
      renewal_terms_changed:
        "We couldn't update your auto-renew to the plan's new price, so it has been switched off.",
      plan_unavailable: 'Your plan is no longer offered, so it will not renew.',
      renewal_payment_not_received:
        "We didn't receive your renewal payment in time.",
      mandate_cancelled:
        'The auto-pay mandate was cancelled with your bank or payment app.',
    };
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PLAN_ACTIVATED,
      title: on ? 'Auto-renew is on' : 'Auto-renew is off',
      message: on
        ? `${sub.planName} will renew automatically on ${fmtDate(sub.currentPeriodEnd)}${sub.renewalAmountPaise ? ` for ${fmtINR(sub.renewalAmountPaise)}` : ''}. You can turn it off anytime from Billing.`
        : `${why[reason ?? ''] ?? ''} ${sub.planName} stays active until ${fmtDate(sub.currentPeriodEnd)}; renew manually from Billing to continue.`.trim(),
      metadata: { subscriptionId: sub.id },
      dedupeKey: `auto-renew:${sub.id}:${on ? 'on' : 'off'}:${(sub.autoRenewChangedAt ?? new Date()).toISOString()}`,
    });
  }

  renewalPriceChanged(
    sub: Subscription,
    planName: string,
    amountPaise: number,
  ) {
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PLAN_EXPIRING,
      title: 'Your renewal price is changing',
      message: `From your next renewal on ${fmtDate(sub.currentPeriodEnd)}, ${planName} will auto-renew at ${fmtINR(amountPaise)} (incl. GST). Your current period is unchanged. You can turn auto-renew off from Billing before then.`,
      metadata: { subscriptionId: sub.id },
      dedupeKey: `renewal-price:${sub.id}:${sub.currentPeriodEnd?.toISOString()}:${amountPaise}`,
    });
  }

  renewalChargeFailed(sub: Subscription, retrying: boolean) {
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PAYMENT_FAILED,
      title: retrying
        ? 'Renewal payment failed — retrying'
        : 'Auto-renew stopped',
      message: retrying
        ? `We couldn't charge your renewal for ${sub.planName}. Your payment provider will retry over the next few days; you can also renew manually from Billing.`
        : `Your renewal payments for ${sub.planName} kept failing, so auto-renew has stopped. Renew manually from Billing to keep your plan.`,
      metadata: { subscriptionId: sub.id },
      dedupeKey: `renewal-failed:${sub.id}:${sub.currentPeriodEnd?.toISOString()}:${retrying ? 'retry' : 'halted'}`,
    });
  }

  planEnded(sub: Subscription, cancelled: boolean) {
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PLAN_EXPIRED,
      title: cancelled
        ? `${sub.planName} has ended`
        : `${sub.planName} has expired`,
      message:
        "Your account is now on the Free plan. Renew or choose a plan in Billing whenever you're ready.",
      metadata: { subscriptionId: sub.id },
      dedupeKey: `plan-ended:${sub.id}`,
    });
  }

  creditsThreshold(userId: string, threshold: number, periodKey: string) {
    const exhausted = threshold >= 100;
    return this.notifications.createNotification({
      userId,
      type: exhausted
        ? NotificationType.CREDITS_EXHAUSTED
        : NotificationType.CREDITS_LOW,
      title: exhausted
        ? 'Your credits are used up'
        : `You've used ${threshold}% of your credits`,
      message: exhausted
        ? 'New calls are paused until you add credits. Buy a top-up or upgrade your plan in Billing.'
        : `You've used ${threshold}% of your included credits. Top up or upgrade anytime from Billing.`,
      metadata: { threshold },
      dedupeKey: `credits:${periodKey}:${threshold}`,
    });
  }

  topUpSucceeded(userId: string, credits: number, paymentId: string) {
    return this.notifications.createNotification({
      userId,
      type: NotificationType.TOPUP_SUCCESS,
      title: 'Credits added',
      message: `${fmtCredits(credits)} credits have been added to your account.`,
      metadata: { paymentId },
      dedupeKey: `topup-success:${paymentId}`,
    });
  }

  customPlanRequested(
    userId: string,
    ticketId: string,
    requestId: string,
    customerLabel: string,
    company: string | null,
  ) {
    return Promise.all([
      this.notifications.createNotification({
        userId,
        type: NotificationType.CUSTOM_PLAN_REQUEST_CREATED,
        title: 'Your custom plan request has been sent',
        message:
          'Our team will continue the conversation in your support ticket.',
        metadata: { ticketId, requestId },
        dedupeKey: `custom-plan-request:${requestId}`,
      }),
      this.notifications.notifyAdmins({
        type: NotificationType.CUSTOM_PLAN_REQUEST_CREATED,
        title: 'New custom plan request',
        message: `${customerLabel}${company ? ` (${company})` : ''} is interested in a custom PurpleCallio plan.`,
        metadata: { ticketId, requestId },
        dedupeKey: `admin:custom-plan-request:${requestId}`,
      }),
    ]);
  }

  customPlanOffer(userId: string, offerId: string, planName: string) {
    return this.notifications.createNotification({
      userId,
      type: NotificationType.CUSTOM_PLAN_OFFER_RECEIVED,
      title: 'Your custom plan is ready',
      message: `Review "${planName}" and accept it from Billing when you're ready.`,
      metadata: { offerId },
      dedupeKey: `custom-plan-offer:${offerId}`,
    });
  }
}
