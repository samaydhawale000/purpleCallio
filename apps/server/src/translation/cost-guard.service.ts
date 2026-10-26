import { Injectable, Logger, Optional } from '@nestjs/common';
import { NotificationType, TranslationSessionStatus } from '@prisma/client';

import { CreditService } from '../billing/credits/credit.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from '../webhook/webhook.service';

export type CostGuardScope = 'call' | 'budget' | 'credits';
export type CostGuardKind = 'warning' | 'stepped_down' | 'paused';

export interface CostGuardAction {
  kind: CostGuardKind;
  scope: CostGuardScope;
  remainingSeconds?: number;
}

export interface CostGuardBudgets {
  dailyBudgetCredits?: number | null;
  monthlyBudgetCredits?: number | null;
  alertThresholds?: number[] | null;
}

/** Live view of one relay that CostGuard evaluates every 5 s. */
export interface CostGuardState {
  callId: string;
  projectId: string;
  ownerId: string;
  /** Highest mode currently allowed in the call. */
  mode: 'voice' | 'captions' | 'off';
  onLimit: 'captions_then_off' | 'off';
  maxMinutes: number;
  /** Wall-clock seconds translation has been active in this call. */
  usedSeconds: number;
  /** Credits accrued by this relay's sessions and not yet debited. */
  liveCredits: number;
  /** Current accrual rate, credits per minute (the projection horizon). */
  creditsPerMinute: number;
  /** Warnings already sent: `call`, `<scope>:<mode>` (mutated by evaluate). */
  warned: Set<string>;
  budgets: CostGuardBudgets | null;
}

export const COST_GUARD_WARNING_RATIO = 0.9;

type WebhookFire = (callId: string, event: string, data?: unknown) => Promise<void>;

/**
 * Fire-and-forget translation webhook. WebhookService.fireForCall gains an
 * optional `data` argument and the translation event names (owned by the
 * webhook change); the cast keeps this compiling either way.
 */
export function fireTranslationWebhook(
  webhooks: WebhookService | undefined | null,
  callId: string,
  event: string,
  data?: Record<string, unknown>,
): void {
  if (!webhooks) return;
  try {
    const fire = webhooks.fireForCall as unknown as WebhookFire;
    void Promise.resolve(fire.call(webhooks, callId, event, data)).catch(() => undefined);
  } catch {
    // Never let a webhook break the relay.
  }
}

function utcDayStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function utcMonthStart(now: Date) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/**
 * CostGuard (PROTOCOL.md §4): per-call maxMinutes, project daily/monthly
 * budgets and wallet balance. Never ends the call.
 */
@Injectable()
export class CostGuardService {
  private readonly logger = new Logger(CostGuardService.name);
  /** `${projectId}|${period}|${threshold}` already alerted on this instance. */
  private readonly alerted = new Set<string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly credits: CreditService,
    @Optional() private readonly notifications?: NotificationService,
    @Optional() private readonly webhooks?: WebhookService,
  ) {}

  /**
   * - `call` (time limit): warning once at ≥ 90 %, pause at 100 % — never a
   *   step-down.
   * - `budget` / `credits`: projection = used + one minute at the current
   *   accrual rate. At 100 % in voice with captions_then_off → step down;
   *   captions then continue while their (lower) projection still fits and
   *   pause at 100 %. Warnings are once per scope and mode, so captions get
   *   their own ≥ 90 % warning.
   */
  async evaluate(state: CostGuardState, now = new Date()): Promise<CostGuardAction[]> {
    if (state.mode === 'off') return [];
    const actions: CostGuardAction[] = [];
    const warn = (key: string, action: CostGuardAction) => {
      if (state.warned.has(key)) return;
      state.warned.add(key);
      actions.push(action);
    };

    // Per call: wall-clock of translation.
    const limitSeconds = Math.max(1, state.maxMinutes) * 60;
    const callRemaining = Math.max(0, Math.floor(limitSeconds - state.usedSeconds));
    if (state.usedSeconds >= limitSeconds) {
      return [{ kind: 'paused', scope: 'call', remainingSeconds: 0 }];
    }
    if (state.usedSeconds / limitSeconds >= COST_GUARD_WARNING_RATIO) {
      warn('call', { kind: 'warning', scope: 'call', remainingSeconds: callRemaining });
    }

    // Money: used + one minute at the current rate, against what is allowed.
    const horizon = Math.max(0, state.creditsPerMinute);
    const remainingFor = (left: number) =>
      horizon > 0 ? Math.max(0, Math.floor((left / horizon) * 60)) : undefined;
    const money: { scope: CostGuardScope; used: number; limit: number }[] = [];
    const b = state.budgets;
    if (b && (b.dailyBudgetCredits || b.monthlyBudgetCredits)) {
      const iso = now.toISOString();
      const periods: { key: string; since: Date; budget: number }[] = [];
      if (b.dailyBudgetCredits && b.dailyBudgetCredits > 0) {
        periods.push({ key: `day:${iso.slice(0, 10)}`, since: utcDayStart(now), budget: b.dailyBudgetCredits });
      }
      if (b.monthlyBudgetCredits && b.monthlyBudgetCredits > 0) {
        periods.push({ key: `month:${iso.slice(0, 7)}`, since: utcMonthStart(now), budget: b.monthlyBudgetCredits });
      }
      for (const p of periods) {
        const used = (await this.chargedSince(state.projectId, p.since)) + state.liveCredits;
        money.push({ scope: 'budget', used, limit: p.budget });
        await this.budgetAlerts(state, p.key, used, p.budget, b.alertThresholds ?? []);
      }
    }
    if (state.liveCredits > 0 || horizon > 0) {
      const wallet = await this.credits.getSummary(state.ownerId);
      // Live accrual is not debited yet: the wallet still holds it. Free
      // credits never pay for translation.
      money.push({ scope: 'credits', used: state.liveCredits, limit: Math.max(0, wallet.paidAvailable) });
    }

    for (const m of money) {
      const projected = m.used + horizon;
      const ratio = m.limit > 0 ? projected / m.limit : projected > 0 ? Infinity : 0;
      if (ratio >= 1) {
        const kind: CostGuardKind =
          state.mode === 'voice' && state.onLimit === 'captions_then_off' ? 'stepped_down' : 'paused';
        actions.push({ kind, scope: m.scope, remainingSeconds: remainingFor(m.limit - m.used) });
        return actions;
      }
      if (ratio >= COST_GUARD_WARNING_RATIO) {
        warn(`${m.scope}:${state.mode}`, {
          kind: 'warning',
          scope: m.scope,
          remainingSeconds: remainingFor(m.limit - projected),
        });
      }
    }
    return actions;
  }

  private async chargedSince(projectId: string, since: Date): Promise<number> {
    const agg = await this.prisma.translationSession.aggregate({
      where: {
        projectId,
        startedAt: { gte: since },
        status: { not: TranslationSessionStatus.ACTIVE },
      },
      _sum: { creditsCharged: true },
    });
    return agg._sum.creditsCharged ?? 0;
  }

  /** One TranslationBudgetAlert row + notification + webhook per threshold crossing. */
  private async budgetAlerts(
    state: CostGuardState,
    period: string,
    usedCredits: number,
    budgetCredits: number,
    thresholds: number[],
  ) {
    const percent = (usedCredits / budgetCredits) * 100;
    for (const threshold of [...thresholds].sort((a, b) => a - b)) {
      if (!(threshold > 0) || percent < threshold) continue;
      const key = `${state.projectId}|${period}|${threshold}`;
      if (this.alerted.has(key)) continue;
      this.alerted.add(key);
      try {
        await this.prisma.translationBudgetAlert.create({
          data: { projectId: state.projectId, period, threshold },
        });
      } catch (err) {
        if ((err as { code?: string })?.code === 'P2002') continue; // already alerted
        this.alerted.delete(key);
        this.logger.warn(
          `event=translation_budget_alert_failed projectId=${state.projectId} error=${(err as Error)?.name ?? 'unknown'}`,
        );
        continue;
      }
      const periodName = period.startsWith('day:') ? 'daily' : 'monthly';
      await this.notifications?.createNotification({
        userId: state.ownerId,
        type: NotificationType.TRANSLATION_BUDGET_THRESHOLD,
        title: `Translation ${periodName} budget at ${threshold}%`,
        message: `Live Translate has used ${Math.round(usedCredits)} of ${budgetCredits} credits of this project's ${periodName} budget.`,
        metadata: { projectId: state.projectId, period, threshold },
        dedupeKey: `translation-budget:${state.projectId}:${period}:${threshold}`,
      });
      // No project-level webhook method: sent on the current call.
      fireTranslationWebhook(this.webhooks, state.callId, 'translation.budget.threshold', {
        period,
        threshold,
        usedCredits: Math.round(usedCredits),
        budgetCredits,
      });
    }
  }
}
