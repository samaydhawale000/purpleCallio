import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationService } from '../../notification/notification.service';
import { PAYMENT_PROVIDER } from '../../payment/providers/payment-provider';
import type {
  PaymentProvider,
  ProviderWebhookEvent,
} from '../../payment/providers/payment-provider';
import { BillingFulfillmentService } from './fulfillment.service';
import { AutoRenewService } from '../subscriptions/auto-renew.service';

/**
 * Provider webhooks (payment captured / failed, refunds, disputes).
 *
 * Every verified event is stored once by (provider, eventId); a redelivery
 * of an already-processed event is acknowledged without doing anything.
 * Fulfillment itself is idempotent too, so the browser callback and the
 * webhook can arrive in either order — or both — with the same result.
 */
@Injectable()
export class BillingWebhookService {
  private readonly logger = new Logger(BillingWebhookService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(PAYMENT_PROVIDER) private provider: PaymentProvider,
    private fulfillment: BillingFulfillmentService,
    private notifications: NotificationService,
    private autoRenew: AutoRenewService,
  ) {}

  async handle(
    rawBody: Buffer | undefined,
    headers: Record<string, string | undefined>,
  ) {
    if (!this.provider.isConfigured()) return { received: true, mock: true };
    if (!rawBody) throw new BadRequestException('Missing body');

    let event: ProviderWebhookEvent;
    try {
      event = await this.provider.parseWebhook(rawBody, headers);
    } catch (err) {
      this.logger.warn(`Rejected webhook: ${String(err)}`);
      throw new BadRequestException('Invalid webhook');
    }

    let record: { id: string; processedAt: Date | null };
    try {
      record = await this.prisma.paymentWebhookEvent.create({
        data: {
          provider: this.provider.name,
          eventId: event.eventId,
          eventType: event.rawType,
          payload: event.raw as Prisma.InputJsonValue,
        },
        select: { id: true, processedAt: true },
      });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e;
      record = await this.prisma.paymentWebhookEvent.findUniqueOrThrow({
        where: {
          provider_eventId: {
            provider: this.provider.name,
            eventId: event.eventId,
          },
        },
        select: { id: true, processedAt: true },
      });
      if (record.processedAt) return { received: true, duplicate: true };
    }

    try {
      await this.process(event);
      await this.prisma.paymentWebhookEvent.update({
        where: { id: record.id },
        data: { processedAt: new Date(), error: null },
      });
    } catch (err) {
      await this.prisma.paymentWebhookEvent.update({
        where: { id: record.id },
        data: { error: String(err).slice(0, 500) },
      });
      this.logger.error(
        `Webhook ${event.rawType} (${event.eventId}) failed: ${String(err)}`,
      );
      // Non-2xx makes the provider redeliver; processing is idempotent.
      throw err;
    }
    return { received: true };
  }

  private async process(event: ProviderWebhookEvent) {
    switch (event.type) {
      // ── Auto-renew mandates ──
      case 'subscription.charged': {
        if (!event.payment || !event.subscription) return;
        await this.fulfillment.recordMandateCharge(
          event.payment,
          event.subscription,
        );
        return;
      }
      case 'subscription.authenticated':
      case 'subscription.activated':
      case 'subscription.pending':
      case 'subscription.halted':
      case 'subscription.cancelled':
      case 'subscription.completed': {
        if (!event.subscription) return;
        await this.autoRenew.onMandateEvent(event.type, event.subscription);
        return;
      }
      case 'payment.captured':
      case 'order.paid': {
        const payment = await this.findPayment(event);
        if (!payment || !event.payment) return;
        if (event.payment.status !== 'captured') return;
        await this.fulfillment.fulfill(payment.id, event.payment, 'webhook');
        return;
      }
      case 'payment.failed': {
        const payment = await this.findPayment(event);
        if (!payment || !event.payment) return;
        await this.fulfillment.markFailed(
          payment.id,
          event.payment,
          event.payment.errorDescription ?? 'Payment failed',
        );
        return;
      }
      case 'refund.processed': {
        if (!event.refund) return;
        const payment = await this.prisma.payment.findUnique({
          where: { providerPaymentId: event.refund.providerPaymentId },
        });
        if (!payment || payment.purpose === 'LEGACY') return;
        if (payment.paymentStatus !== 'PAID') return;
        await this.fulfillment.applyRefund(
          payment.id,
          payment.refundedPaise + event.refund.amountPaise,
          null,
          `Provider refund ${event.refund.providerRefundId}`,
        );
        return;
      }
      case 'payment.dispute.created': {
        const providerPaymentId =
          event.raw?.payload?.dispute?.entity?.payment_id ??
          event.payment?.providerPaymentId;
        await this.notifications.notifyAdmins({
          type: NotificationType.PAYMENT_FAILED,
          title: 'Payment dispute opened',
          message: `A customer opened a dispute on payment ${providerPaymentId ?? 'unknown'}. Review it in Razorpay.`,
          metadata: { providerPaymentId: providerPaymentId ?? null },
          dedupeKey: `admin:dispute:${event.eventId}`,
        });
        return;
      }
      case 'payment.authorized':
      default:
        // Orders auto-capture; the capture event completes the purchase.
        return;
    }
  }

  /** Our Payment for a provider event, by order id (fallback: notes.paymentId). */
  private async findPayment(event: ProviderWebhookEvent) {
    const orderId = event.payment?.providerOrderId;
    const byOrder = orderId
      ? await this.prisma.payment.findUnique({
          where: { providerOrderId: orderId },
        })
      : null;
    if (byOrder) return byOrder.purpose === 'LEGACY' ? null : byOrder;
    const noteId = event.raw?.payload?.payment?.entity?.notes?.paymentId;
    if (typeof noteId === 'string') {
      const byNote = await this.prisma.payment.findUnique({
        where: { id: noteId },
      });
      if (byNote && byNote.purpose !== 'LEGACY') return byNote;
    }
    // Orders from the retired pay-as-you-go flow (card setup / old top-ups)
    // carry no Payment row here — acknowledge and ignore.
    this.logger.debug(
      `No prepaid payment for ${event.rawType} order ${orderId ?? 'n/a'} — ignoring.`,
    );
    return null;
  }
}
