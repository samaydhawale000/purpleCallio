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
    return this.notifications.createNotification({
      userId: sub.companyId,
      type: NotificationType.PLAN_EXPIRING,
      title: `${sub.planName} ends on ${fmtDate(sub.currentPeriodEnd)}`,
      message:
        'Renew from Billing to keep your plan and get a fresh set of credits. Plans never renew automatically.',
      metadata: { subscriptionId: sub.id },
      dedupeKey: `plan-expiring:${sub.id}:${sub.currentPeriodEnd?.toISOString()}`,
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
