import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EntitlementService } from '../billing/subscriptions/entitlement.service';
import { FeatureKey } from '../billing/plans/feature-registry';

export type WebhookEvent =
  | 'call.created'
  | 'call.accepted'
  | 'call.rejected'
  | 'call.cancelled'
  | 'call.busy'
  | 'call.ended'
  | 'call.missed';

export interface WebhookPayload {
  event: WebhookEvent;
  callId: string;
  projectId: string;
  callerId: string;
  receiverId: string;
  type: string;
  status: string;
  timestamp: string;
}

const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 4_000, 16_000]; // delay BEFORE attempt N (0-indexed)
const ATTEMPT_TIMEOUT_MS = 10_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly entitlements: EntitlementService,
  ) {}

  async fireForCall(callId: string, event: WebhookEvent): Promise<void> {
    try {
      const call = await this.prisma.call.findUnique({
        where: { id: callId },
        include: { project: true },
      });

      if (!call || !call.project.webhookUrl) return;

      // Webhooks are a plan entitlement (checked centrally, never by plan name).
      if (
        !(await this.entitlements.hasFeature(
          call.project.ownerId,
          FeatureKey.WEBHOOKS,
        ))
      ) {
        this.logger.debug(
          `Webhooks not included in the plan for project ${call.projectId} — skipping ${event}.`,
        );
        return;
      }

      const payload: WebhookPayload = {
        event,
        callId: call.id,
        projectId: call.projectId,
        callerId: call.callerId,
        receiverId: call.receiverId,
        type: call.type,
        status: call.status,
        timestamp: new Date().toISOString(),
      };

      // Fire-and-forget from the caller's perspective (call.service.ts never
      // awaits this) — retries/backoff happen in the background so a slow or
      // down endpoint never blocks call state transitions. Never throw out
      // of this method: nothing awaits it, so an uncaught rejection here
      // would become an unhandled promise rejection.
      await this.deliverWithRetry(
        call.id,
        call.project.webhookUrl,
        call.project.webhookSecret,
        payload,
      );
    } catch (err: any) {
      this.logger.error(
        `Webhook dispatch failed for call ${callId} (${event}): ${err?.message || err}`,
      );
    }
  }

  /**
   * Delivers with up to MAX_ATTEMPTS tries and exponential backoff between
   * them. Every attempt is reflected in a WebhookDelivery row (event id +
   * attempt count + last error) so a persistently failing endpoint shows up
   * as a dead-lettered delivery instead of only a log line that scrolls away.
   */
  private async deliverWithRetry(
    callId: string,
    url: string,
    secret: string | null,
    payload: WebhookPayload,
  ): Promise<void> {
    const delivery = await this.prisma.webhookDelivery.create({
      data: {
        callId,
        event: payload.event,
        url,
        status: 'pending',
        attempts: 0,
      },
    });

    let lastError: string | null = null;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await sleep(BACKOFF_MS[attempt - 1]);
      }

      try {
        await this.attemptDelivery(url, secret, payload);
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { status: 'delivered', attempts: attempt + 1, lastError: null },
        });
        return;
      } catch (err: any) {
        lastError = err?.message || String(err);
        this.logger.warn(
          `Webhook delivery attempt ${attempt + 1}/${MAX_ATTEMPTS} failed for ${payload.event} (${delivery.id}) → ${url}: ${lastError}`,
        );
        await this.prisma.webhookDelivery.update({
          where: { id: delivery.id },
          data: { attempts: attempt + 1, lastError },
        });
      }
    }

    this.logger.error(
      `Webhook delivery exhausted ${MAX_ATTEMPTS} attempts for ${payload.event} (${delivery.id}) → ${url}: ${lastError}`,
    );
    await this.prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: { status: 'failed' },
    });
  }

  private async attemptDelivery(
    url: string,
    secret: string | null,
    payload: WebhookPayload,
  ): Promise<void> {
    const body = JSON.stringify(payload);
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-PurpleCallio-Event': payload.event,
    };

    if (secret) {
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      headers['X-PurpleCallio-Signature'] = `sha256=${sig}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ATTEMPT_TIMEOUT_MS);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
    } finally {
      clearTimeout(timeout);
    }
  }
}
