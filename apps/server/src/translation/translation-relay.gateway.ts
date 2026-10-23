import { Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { OnGatewayConnection, WebSocketGateway } from '@nestjs/websockets';
import { CallStatus, TranslationSessionStatus } from '@prisma/client';
import { Socket } from 'socket.io';

import { BillingConfigService } from '../billing/billing-config.service';
import { CallSessionService } from '../call-session/services/call-session.service';
import { socketOriginCallback } from '../common/config/cors';
import { PrismaService } from '../prisma/prisma.service';
import { WebhookService } from '../webhook/webhook.service';
import {
  applyLexicon,
  checkTranslation,
  evaluateGuard,
  isPoorAudio,
  LATE_TRANSLATION_MS,
  lexiconHints,
  limitMessage,
  PhraseAudioStats,
  ReplayBuffer,
  repeatPrompt,
  type GuardSensitivity,
  type LexiconTerm,
} from './guard';
import {
  CostGuardAction,
  CostGuardService,
  fireTranslationWebhook,
} from './cost-guard.service';
import {
  TRANSLATION_INPUT_SAMPLE_RATE,
  TRANSLATION_OUTPUT_SAMPLE_RATE,
  TranslationProvider,
  TranslationProviderSession,
} from './providers/translation-provider.interface';
import { TranslationRouter } from './providers/translation-router';
import { TranslationReportService } from './report/translation-report.service';
import { TranslationAccessService } from './translation-access.service';
import { TranslationBillingService } from './translation-billing.service';
import {
  isValidLanguage,
  modeFromDb,
  readTranslationConfig,
  TRANSLATION_MODES,
  TranslationCallConfig,
  TranslationModeName,
} from './translation-config';
import {
  TRANSLATION_CHECKPOINT_MS,
  TranslationDirection,
  TranslationLimitError,
  TranslationSessionService,
} from './translation-session.service';
import { TranslationTranscriptWriter } from './translation-transcript.writer';
import { translationConfig } from './translation.config';

export const TRANSLATION_RECONNECT_GRACE_MS = 15_000;
export const TRANSLATION_TICK_MS = 5_000;
export const TRANSLATION_IDLE_TIMEOUT_MS = 10 * 60_000;
export const TRANSLATION_MAX_FRAME_BYTES = 32_000;
export const TRANSLATION_MAX_FRAMES_PER_SECOND = 100;
/** Audio buffered per direction while its provider connects (~10 s of 20 ms frames). */
const MAX_PENDING_OPS = 500;
const MAX_REMEMBERED_PHRASES = 500;
const REPLAY_MAX_MS = 120_000;
const REPLAY_CHUNK_BYTES = 32_000;

const ENDED_CALL_STATUSES = new Set<string>([
  CallStatus.ENDED,
  CallStatus.REJECTED,
  CallStatus.CANCELLED,
  CallStatus.BUSY,
  CallStatus.MISSED,
]);

type Role = 'caller' | 'receiver';
type Mode = TranslationModeName;
type ActiveMode = 'voice' | 'captions';
const MODE_RANK: Record<Mode, number> = { off: 0, captions: 1, voice: 2 };
const ROLES: Role[] = ['caller', 'receiver'];

function minMode(a: Mode, b: Mode): Mode {
  return MODE_RANK[a] <= MODE_RANK[b] ? a : b;
}
function other(role: Role): Role {
  return role === 'caller' ? 'receiver' : 'caller';
}
function directionOf(speaker: Role): TranslationDirection {
  return speaker === 'caller' ? 'caller_to_receiver' : 'receiver_to_caller';
}
function base(lang: string | null | undefined): string {
  return (lang ?? '').toLowerCase().split('-')[0];
}
function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return Math.round(sorted[rank - 1]);
}
function digitsOf(text: string): string {
  return (text.match(/\d+/g) ?? []).join(',');
}
/** translation-config sensitivity names → MeaningGuard's. */
function guardSensitivity(s: string | undefined): GuardSensitivity {
  return s === 'relaxed' ? 'low' : s === 'strict' ? 'high' : 'standard';
}

export interface Caption {
  phraseId: string;
  speaker: Role;
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  translated: string;
  final: boolean;
  startedAt: number;
  endedAt?: number;
  translatedAudioAt?: number;
  guard?: { status: 'ok' | 'uncertain'; reasons: string[] };
  lexiconApplied?: string[];
}

interface LivePhrase {
  id: string;
  speaker: Role;
  direction: DirectionState | null;
  sourceLanguage: string;
  targetLanguage: string;
  original: string;
  translated: string;
  final: boolean;
  startedAt: number;
  endedAt?: number;
  translatedAudioAt?: number;
  confidence?: number;
  alternatives?: string[];
  detectedLanguage?: string;
  poorAudio?: boolean;
  guard?: { status: 'ok' | 'uncertain'; reasons: string[] };
  lexiconApplied?: string[];
}

interface DirectionMetrics {
  phrases: number;
  droppedFrames: number;
  providerFailures: number;
  fallbacks: number;
  flags: number;
  flagReasons: Record<string, number>;
  replays: number;
  repeats: number;
  lexiconHits: number;
  firstAudioMs: number[];
  captionDelayMs: number[];
}

type PendingOp = { audio: Buffer } | { end: true };

interface DirectionState {
  key: TranslationDirection;
  speaker: Role;
  listener: Role;
  source: string;
  target: string;
  /** Mode the listener asked for. */
  requestedMode: ActiveMode;
  /** Mode the route serves (voice may become captions). */
  mode: ActiveMode;
  route: string;
  sessionId: string | null;
  voiceRate: number;
  captionsRate: number;
  provider: TranslationProviderSession | null;
  fallback: TranslationProvider | null;
  fallbackUsed: boolean;
  /** Ops buffered while connecting; null once connected (or failed). */
  pending: PendingOp[] | null;
  queue: LivePhrase[];
  failed: boolean;
  closed: boolean;
  status: typeof TranslationSessionStatus.ENDED | typeof TranslationSessionStatus.FAILED;
  voiceMs: number;
  captionsMs: number;
  accrueSince: number | null;
  metrics: DirectionMetrics;
  opening: Promise<void> | null;
  finalizing: Promise<void> | null;
}

interface Participant {
  role: Role;
  socket: Socket | null;
  graceTimer?: NodeJS.Timeout;
  speak: string;
  hear: string;
  /** Participant's own listening mode; null = the call's mode. */
  mode: Mode | null;
  detected: string | null;
  sentMode: Mode | null;
  frameWindowStart: number;
  frameCount: number;
  seq: number;
  open: LivePhrase | null;
  stats: PhraseAudioStats | null;
}

interface RelayTotals {
  voiceSeconds: number;
  captionsSeconds: number;
  credits: number;
  firstAudioMs: number[];
  flags: number;
  replays: number;
  repeats: number;
  fallbacks: number;
}

interface Relay {
  callId: string;
  projectId: string;
  ownerId: string;
  callMode: Mode;
  /** CostGuard ceiling. */
  cap: Mode;
  accessOk: boolean;
  lastAccessCode?: string;
  trial: boolean;
  trialSecondsAtStart: number;
  participants: Record<Role, Participant>;
  directions: Map<TranslationDirection, DirectionState>;
  phrases: Map<string, LivePhrase>;
  config: TranslationCallConfig;
  lexicon: LexiconTerm[];
  guard: { enabled: boolean; sensitivity: string };
  replay: Record<Role, ReplayBuffer> | null;
  postCall: boolean;
  retentionDays: number;
  maxMinutes: number;
  onLimit: 'captions_then_off' | 'off';
  budgets: {
    dailyBudgetCredits: number | null;
    monthlyBudgetCredits: number | null;
    alertThresholds: number[];
  } | null;
  usedMs: number;
  usedSince: number | null;
  /** Credits of finalized directions whose debit hasn't landed yet. */
  unbilledCredits: number;
  /** Rates of the latest session row (resume projection). */
  lastRates: { voice: number; captions: number };
  warned: Set<string>;
  tickTimer?: NodeJS.Timeout;
  ticking: boolean;
  lastCheckpointAt: number;
  lastActivityAt: number;
  started: boolean;
  replanPending: boolean;
  totals: RelayTotals;
  ending: Promise<void> | null;
}

/**
 * Socket.IO namespace `/translate` (PROTOCOL.md §2): one relay per call on
 * this instance, one socket per role, a provider session per active
 * direction. Captions go to both participants, translated audio only to the
 * listener. Billing is per direction-session (TranslationSessionService +
 * TranslationBillingService); CostGuard runs every 5 s.
 */
@WebSocketGateway({
  namespace: '/translate',
  cors: { origin: socketOriginCallback, credentials: false },
})
export class TranslationRelayGateway implements OnGatewayConnection, OnModuleDestroy {
  private readonly logger = new Logger(TranslationRelayGateway.name);
  private readonly relays = new Map<string, Relay>();
  private readonly loading = new Map<string, Promise<Relay | { code: string }>>();

  constructor(
    private readonly callSessions: CallSessionService,
    private readonly prisma: PrismaService,
    private readonly sessions: TranslationSessionService,
    private readonly access: TranslationAccessService,
    private readonly billing: TranslationBillingService,
    private readonly router: TranslationRouter,
    private readonly costGuard: CostGuardService,
    private readonly transcripts: TranslationTranscriptWriter,
    private readonly billingConfig: BillingConfigService,
    @Optional() private readonly webhooks?: WebhookService,
    @Optional() private readonly reports?: TranslationReportService,
  ) {}

  async onModuleDestroy() {
    await Promise.all(
      [...this.relays.values()].map((r) => this.endRelay(r, 'server_shutdown')),
    );
  }

  get activeCount() {
    return this.relays.size;
  }

  // ── Handshake ────────────────────────────────────────
  async handleConnection(client: Socket) {
    if (!translationConfig().enabled) return this.reject(client, 'TRANSLATION_DISABLED');
    const token = (client.handshake?.auth as { token?: unknown } | undefined)?.token;
    if (typeof token !== 'string' || !token.startsWith('bj_session_')) {
      return this.reject(client, 'TRANSLATION_SESSION_INVALID');
    }
    const session = await this.callSessions.getByToken(token).catch(() => null);
    if (!session || !session.call || session.expiresAt.getTime() <= Date.now()) {
      return this.reject(client, 'TRANSLATION_SESSION_INVALID');
    }
    const role: Role = session.callerToken === token ? 'caller' : 'receiver';
    const call = session.call;
    if (ENDED_CALL_STATUSES.has(call.status)) {
      return this.reject(client, 'TRANSLATION_CALL_ENDED');
    }
    let loaded: Relay | { code: string };
    try {
      loaded = await this.getOrCreateRelay(call);
    } catch (err) {
      this.logger.error(
        `event=translation_relay_load_failed callId=${call.id} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return this.reject(client, 'TRANSLATION_PROVIDER_UNAVAILABLE');
    }
    if ('code' in loaded) return this.reject(client, loaded.code);
    if (client.disconnected) return;
    this.attach(loaded, role, client);
  }

  private reject(client: Socket, code: string) {
    client.emit('error', { code });
    client.disconnect(true);
  }

  private async getOrCreateRelay(call: {
    id: string;
    projectId: string;
    status: string;
    callerLanguage: string | null;
    receiverLanguage: string | null;
    translationMode: string;
    translationConfig: unknown;
    project: { ownerId: string };
  }): Promise<Relay | { code: string }> {
    const existing = this.relays.get(call.id);
    if (existing && !existing.ending) return existing;
    if (existing?.ending) await existing.ending;
    const inFlight = this.loading.get(call.id);
    if (inFlight) return inFlight;
    const load = this.loadRelay(call).finally(() => this.loading.delete(call.id));
    this.loading.set(call.id, load);
    return load;
  }

  private async loadRelay(call: {
    id: string;
    projectId: string;
    callerLanguage: string | null;
    receiverLanguage: string | null;
    translationMode: string;
    translationConfig: unknown;
    project: { ownerId: string };
  }): Promise<Relay | { code: string }> {
    const ownerId = call.project.ownerId;
    const config = readTranslationConfig(call.translationConfig);
    const callMode = modeFromDb(call.translationMode);
    const [settings, billingConfig] = await Promise.all([
      this.prisma.translationSettings.findUnique({ where: { projectId: call.projectId } }),
      this.billingConfig.get(),
    ]);

    let trial = false;
    let trialSecondsAtStart = 0;
    if (callMode !== 'off') {
      const check = await this.access.canStart(ownerId, callMode);
      if (!check.ok) return { code: check.code ?? 'TRANSLATION_NOT_IN_PLAN' };
      trial = check.trial;
      if (trial) trialSecondsAtStart = await this.access.trialSecondsRemaining(ownerId);
    }

    const lexicon = await this.loadLexicon(
      call.projectId,
      config.lexiconId ?? settings?.defaultLexiconId ?? null,
    );
    const replayEnabled = settings?.replayEnabled === true && config.guard?.replay !== false;
    const participant = (role: Role, lang: string | null): Participant => {
      const speak = lang || 'en';
      return {
        role,
        socket: null,
        speak,
        hear: speak === 'auto' ? 'en' : speak,
        mode: null,
        detected: null,
        sentMode: null,
        frameWindowStart: 0,
        frameCount: 0,
        seq: 0,
        open: null,
        stats: null,
      };
    };
    const now = Date.now();
    const relay: Relay = {
      callId: call.id,
      projectId: call.projectId,
      ownerId,
      callMode,
      cap: 'voice',
      accessOk: callMode !== 'off',
      trial,
      trialSecondsAtStart,
      participants: {
        caller: participant('caller', call.callerLanguage),
        receiver: participant('receiver', call.receiverLanguage),
      },
      directions: new Map(),
      phrases: new Map(),
      config,
      lexicon,
      guard: {
        enabled: config.guard?.enabled !== false,
        sensitivity: config.guard?.sensitivity ?? 'standard',
      },
      replay: replayEnabled
        ? {
            caller: new ReplayBuffer({ maxMs: REPLAY_MAX_MS, sampleRate: TRANSLATION_INPUT_SAMPLE_RATE }),
            receiver: new ReplayBuffer({ maxMs: REPLAY_MAX_MS, sampleRate: TRANSLATION_INPUT_SAMPLE_RATE }),
          }
        : null,
      postCall: settings?.postCallReportEnabled === true && config.postCallReport !== false,
      retentionDays: settings?.transcriptRetentionDays ?? 30,
      maxMinutes:
        config.maxMinutes ??
        settings?.defaultMaxMinutes ??
        billingConfig.translationDefaultMaxMinutes ??
        60,
      onLimit:
        config.onLimit ?? (settings?.onLimit === 'off' ? 'off' : 'captions_then_off'),
      budgets: settings
        ? {
            dailyBudgetCredits: settings.dailyBudgetCredits ?? null,
            monthlyBudgetCredits: settings.monthlyBudgetCredits ?? null,
            alertThresholds: settings.alertThresholds ?? [],
          }
        : null,
      usedMs: 0,
      usedSince: null,
      unbilledCredits: 0,
      lastRates: { voice: 0, captions: 0 },
      warned: new Set(),
      ticking: false,
      lastCheckpointAt: now,
      lastActivityAt: now,
      started: false,
      replanPending: false,
      totals: {
        voiceSeconds: 0,
        captionsSeconds: 0,
        credits: 0,
        firstAudioMs: [],
        flags: 0,
        replays: 0,
        repeats: 0,
        fallbacks: 0,
      },
      ending: null,
    };
    relay.tickTimer = setInterval(() => void this.tick(relay), TRANSLATION_TICK_MS);
    relay.tickTimer.unref?.();
    this.relays.set(call.id, relay);
    this.logger.log(`event=translation_relay_started callId=${call.id} mode=${callMode}`);
    return relay;
  }

  private async loadLexicon(projectId: string, lexiconId: string | null): Promise<LexiconTerm[]> {
    if (!lexiconId) return [];
    try {
      const lexicon = await this.prisma.translationLexicon.findFirst({
        where: { id: lexiconId, projectId },
        include: { terms: true },
      });
      return (lexicon?.terms ?? []).map((t) => ({
        term: t.term,
        kind: t.kind,
        translations:
          t.translations && typeof t.translations === 'object' && !Array.isArray(t.translations)
            ? (t.translations as Record<string, string>)
            : null,
        pronunciation: t.pronunciation,
        caseSensitive: t.caseSensitive,
      }));
    } catch (err) {
      this.logger.warn(
        `event=translation_lexicon_load_failed projectId=${projectId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
      return [];
    }
  }

  // ── Sockets ──────────────────────────────────────────
  private attach(relay: Relay, role: Role, client: Socket) {
    const p = relay.participants[role];
    this.accrue(relay);
    if (p.socket && p.socket !== client) {
      const old = p.socket;
      p.socket = null;
      old.emit('ended', { reason: 'replaced' });
      old.disconnect(true);
    }
    clearTimeout(p.graceTimer);
    p.graceTimer = undefined;
    p.socket = client;
    p.frameWindowStart = Date.now();
    p.frameCount = 0;
    relay.lastActivityAt = Date.now();

    client.on('audio', (frame: unknown) => this.onAudio(relay, p, client, frame));
    client.on('speech.start', () => {
      if (p.socket !== client || relay.ending) return;
      relay.lastActivityAt = Date.now();
      this.startPhrase(relay, p);
    });
    client.on('speech.end', () => {
      if (p.socket !== client || relay.ending) return;
      relay.lastActivityAt = Date.now();
      this.endPhrase(relay, p);
    });
    client.on('settings', (body: unknown) => {
      if (p.socket !== client || relay.ending) return;
      void this.onSettings(relay, p, body);
    });
    client.on('replay', (body: unknown) => {
      if (p.socket !== client || relay.ending) return;
      this.onReplay(relay, p, body);
    });
    client.on('repeat.request', (body: unknown) => {
      if (p.socket !== client || relay.ending) return;
      this.onRepeat(relay, p, body);
    });
    client.on('end', () => {
      if (p.socket !== client || relay.ending) return;
      this.leave(relay, p, 'participant');
    });
    client.on('disconnect', () => this.onDisconnect(relay, p, client));

    p.sentMode = this.effectiveMode(relay, p);
    client.emit('ready', this.readyPayload(relay, p));
    this.emitPeer(relay, other(role));
    this.replan(relay);
  }

  private readyPayload(relay: Relay, p: Participant) {
    const peer = relay.participants[other(p.role)];
    return {
      role: p.role,
      inputSampleRate: TRANSLATION_INPUT_SAMPLE_RATE,
      outputSampleRate: TRANSLATION_OUTPUT_SAMPLE_RATE,
      mode: this.effectiveMode(relay, p),
      you: { speak: p.speak, hear: p.hear },
      peer: this.present(peer) ? { speak: peer.speak, hear: peer.hear } : null,
      replayEnabled: !!relay.replay,
      guard: { enabled: relay.guard.enabled, sensitivity: relay.guard.sensitivity },
      limits: { maxMinutes: relay.maxMinutes, usedSeconds: Math.floor(this.usedMs(relay) / 1000) },
      trial: relay.trial,
    };
  }

  /** Tells `to` about its peer. */
  private emitPeer(relay: Relay, to: Role) {
    const target = relay.participants[to];
    const peer = relay.participants[other(to)];
    target.socket?.emit(
      'peer',
      this.present(peer)
        ? { connected: !!peer.socket, speak: peer.speak, hear: peer.hear }
        : { connected: false },
    );
  }

  private present(p: Participant) {
    return !!p.socket || !!p.graceTimer;
  }

  private onDisconnect(relay: Relay, p: Participant, client: Socket) {
    if (p.socket !== client || relay.ending) return;
    this.accrue(relay);
    this.endPhrase(relay, p);
    p.socket = null;
    p.graceTimer = setTimeout(() => {
      p.graceTimer = undefined;
      this.gone(relay, p);
    }, TRANSLATION_RECONNECT_GRACE_MS);
    p.graceTimer.unref?.();
    this.accrue(relay);
    this.emitPeer(relay, other(p.role));
  }

  /** `end` from the client: leaves translation; the call continues. */
  private leave(relay: Relay, p: Participant, reason: string) {
    this.accrue(relay);
    this.endPhrase(relay, p);
    const socket = p.socket;
    p.socket = null;
    clearTimeout(p.graceTimer);
    p.graceTimer = undefined;
    if (socket) {
      socket.emit('ended', { reason });
      socket.disconnect(true);
    }
    this.gone(relay, p);
  }

  private gone(relay: Relay, p: Participant) {
    if (relay.ending) return;
    this.emitPeer(relay, other(p.role));
    const anyone = ROLES.some((r) => this.present(relay.participants[r]));
    if (!anyone) {
      void this.endRelay(relay, 'participants_left');
      return;
    }
    this.replan(relay);
  }

  // ── Audio & phrases ──────────────────────────────────
  private onAudio(relay: Relay, p: Participant, client: Socket, frame: unknown) {
    if (p.socket !== client || relay.ending) return;
    const now = Date.now();
    if (now - p.frameWindowStart >= 1000) {
      p.frameWindowStart = now;
      p.frameCount = 0;
    }
    p.frameCount++;
    const pcm = toBuffer(frame);
    if (
      !pcm ||
      pcm.length === 0 ||
      pcm.length > TRANSLATION_MAX_FRAME_BYTES ||
      pcm.length % 2 !== 0 ||
      p.frameCount > TRANSLATION_MAX_FRAMES_PER_SECOND
    ) {
      const d = relay.directions.get(directionOf(p.role));
      if (d) d.metrics.droppedFrames++;
      return;
    }
    relay.lastActivityAt = now;
    const phrase = p.open ?? this.startPhrase(relay, p);
    p.stats?.add(pcm);
    relay.replay?.[p.role].append(pcm);
    const d = phrase.direction;
    if (d && relay.directions.get(d.key) === d) this.sendOp(d, { audio: pcm });
  }

  private startPhrase(relay: Relay, p: Participant): LivePhrase {
    if (p.open) this.endPhrase(relay, p);
    p.seq++;
    const listener = relay.participants[other(p.role)];
    const d = relay.directions.get(directionOf(p.role)) ?? null;
    const phrase: LivePhrase = {
      id: `${p.role}-${p.seq}`,
      speaker: p.role,
      direction: d && !d.failed && !d.closed ? d : null,
      sourceLanguage: p.speak === 'auto' ? (p.detected ?? 'auto') : p.speak,
      targetLanguage: d?.target ?? listener.hear,
      original: '',
      translated: '',
      final: false,
      startedAt: Date.now(),
    };
    phrase.direction?.queue.push(phrase);
    this.remember(relay, phrase);
    p.open = phrase;
    p.stats = new PhraseAudioStats(TRANSLATION_INPUT_SAMPLE_RATE);
    relay.replay?.[p.role].startPhrase(phrase.id);
    return phrase;
  }

  private endPhrase(relay: Relay, p: Participant) {
    const phrase = p.open;
    if (!phrase) return;
    p.open = null;
    phrase.endedAt = Date.now();
    const stats = p.stats?.result();
    p.stats = null;
    if (stats && stats.seconds > 0) phrase.poorAudio = isPoorAudio(stats);
    relay.replay?.[p.role].endPhrase();
    const d = phrase.direction;
    if (d && relay.directions.get(d.key) === d) this.sendOp(d, { end: true });
  }

  private remember(relay: Relay, phrase: LivePhrase) {
    relay.phrases.set(phrase.id, phrase);
    if (relay.phrases.size > MAX_REMEMBERED_PHRASES) {
      const oldest = relay.phrases.keys().next().value;
      if (oldest !== undefined) relay.phrases.delete(oldest);
    }
  }

  private sendOp(d: DirectionState, op: PendingOp) {
    if (d.provider) {
      if ('audio' in op) d.provider.sendAudio(op.audio);
      else d.provider.endOfSpeech();
      return;
    }
    if (!d.pending) return;
    d.pending.push(op);
    if (d.pending.length > MAX_PENDING_OPS) {
      d.pending.shift();
      d.metrics.droppedFrames++;
    }
  }

  // ── Settings / replay / repeat ───────────────────────
  private async onSettings(relay: Relay, p: Participant, body: unknown) {
    const s = (body ?? {}) as { speak?: unknown; hear?: unknown; mode?: unknown };
    if (
      (s.speak !== undefined && !isValidLanguage(s.speak, { allowAuto: true })) ||
      (s.hear !== undefined && !isValidLanguage(s.hear))
    ) {
      p.socket?.emit('error', { code: 'TRANSLATION_INVALID_LANGUAGE' });
      return;
    }
    if (s.mode !== undefined && !TRANSLATION_MODES.includes(s.mode as Mode)) {
      p.socket?.emit('error', { code: 'TRANSLATION_INVALID_CONFIG' });
      return;
    }
    const mode = s.mode as Mode | undefined;
    if (mode && mode !== 'off' && !(await this.ensureAccess(relay, mode))) {
      p.socket?.emit('error', { code: relay.lastAccessCode ?? 'TRANSLATION_NOT_IN_PLAN' });
      return;
    }
    if (relay.ending) return;
    if (typeof s.speak === 'string' && s.speak !== p.speak) {
      p.speak = s.speak;
      p.detected = null;
    }
    if (typeof s.hear === 'string') p.hear = s.hear;
    if (mode) {
      p.mode = mode;
      if (mode !== 'off') await this.liftLimit(relay, mode, [p]);
      if (relay.ending) return;
    }
    this.emitPeer(relay, other(p.role));
    this.replan(relay, 'participant');
    // Confirm the applied languages/mode back to the sender (the SDK diffs
    // its wanted settings against the last `ready`).
    p.sentMode = this.effectiveMode(relay, p);
    p.socket?.emit('ready', this.readyPayload(relay, p));
  }

  /** Entitlement/credit check when translation is switched on mid-call. */
  private async ensureAccess(relay: Relay, mode: ActiveMode): Promise<boolean> {
    if (relay.accessOk) return true;
    const check = await this.access.canStart(relay.ownerId, mode);
    if (!check.ok) {
      relay.lastAccessCode = check.code;
      return false;
    }
    relay.accessOk = true;
    relay.trial = check.trial;
    if (check.trial) {
      relay.trialSecondsAtStart = await this.access.trialSecondsRemaining(relay.ownerId);
    }
    return true;
  }

  private onReplay(relay: Relay, p: Participant, body: unknown) {
    if (!relay.replay) {
      p.socket?.emit('error', { code: 'TRANSLATION_REPLAY_DISABLED' });
      return;
    }
    const phraseId = (body as { phraseId?: unknown } | null)?.phraseId;
    const phrase = typeof phraseId === 'string' ? relay.phrases.get(phraseId) : undefined;
    const pcm = phrase ? relay.replay[phrase.speaker].get(phrase.id) : null;
    if (!phrase || !pcm || pcm.length === 0) {
      p.socket?.emit('error', { code: 'TRANSLATION_PHRASE_NOT_FOUND' });
      return;
    }
    for (let o = 0; o < pcm.length; o += REPLAY_CHUNK_BYTES) {
      const end = Math.min(pcm.length, o + REPLAY_CHUNK_BYTES);
      p.socket?.emit('replay.audio', pcm.subarray(o, end), {
        phraseId: phrase.id,
        sampleRate: TRANSLATION_INPUT_SAMPLE_RATE,
        done: end >= pcm.length,
      });
    }
    this.countOn(relay, phrase, 'replays');
  }

  private onRepeat(relay: Relay, p: Participant, body: unknown) {
    const phraseId = (body as { phraseId?: unknown } | null)?.phraseId;
    const phrase = typeof phraseId === 'string' ? relay.phrases.get(phraseId) : undefined;
    if (!phrase || phrase.speaker === p.role) {
      p.socket?.emit('error', { code: 'TRANSLATION_PHRASE_NOT_FOUND' });
      return;
    }
    const speaker = relay.participants[phrase.speaker];
    const lang =
      phrase.sourceLanguage && phrase.sourceLanguage !== 'auto'
        ? phrase.sourceLanguage
        : speaker.speak === 'auto'
          ? 'en'
          : speaker.speak;
    speaker.socket?.emit('repeat.requested', {
      phraseId: phrase.id,
      original: phrase.original,
      prompt: repeatPrompt(lang, phrase.original),
    });
    this.countOn(relay, phrase, 'repeats');
  }

  private countOn(relay: Relay, phrase: LivePhrase, field: 'replays' | 'repeats') {
    const d = phrase.direction;
    if (d && !d.finalizing) d.metrics[field]++;
    else relay.totals[field]++;
  }

  // ── Planning ─────────────────────────────────────────
  private effectiveMode(relay: Relay, p: Participant): Mode {
    return minMode(p.mode ?? relay.callMode, relay.cap);
  }

  /**
   * A direction exists while both participants are present, the listener's
   * mode isn't off, and the speaker's language differs from what the
   * listener hears ('auto' differs until detected).
   */
  private replan(relay: Relay, reason?: 'participant' | 'api' | 'limit') {
    if (relay.ending) return;
    relay.replanPending = false;
    this.accrue(relay);
    for (const speakerRole of ROLES) {
      const speaker = relay.participants[speakerRole];
      const listener = relay.participants[other(speakerRole)];
      const key = directionOf(speakerRole);
      const existing = relay.directions.get(key);
      const mode = this.effectiveMode(relay, listener);
      const spoken = speaker.speak === 'auto' ? (speaker.detected ?? 'auto') : speaker.speak;
      const wanted =
        this.present(speaker) &&
        this.present(listener) &&
        mode !== 'off' &&
        relay.accessOk &&
        (spoken === 'auto' || base(spoken) !== base(listener.hear));
      if (!wanted) {
        if (existing) void this.finalizeDirection(relay, existing, 'inactive');
        continue;
      }
      const want = { source: speaker.speak, target: listener.hear, mode: mode as ActiveMode };
      if (
        existing &&
        existing.source === want.source &&
        existing.target === want.target &&
        existing.requestedMode === want.mode
      ) {
        continue;
      }
      if (existing) void this.finalizeDirection(relay, existing, 'replanned');
      this.activateDirection(relay, key, speakerRole, want);
    }
    this.accrue(relay);
    this.emitModes(relay, reason);
  }

  private emitModes(relay: Relay, reason?: 'participant' | 'api' | 'limit') {
    for (const role of ROLES) {
      const p = relay.participants[role];
      const mode = this.effectiveMode(relay, p);
      if (!p.socket || mode === p.sentMode) continue;
      p.sentMode = mode;
      p.socket.emit('mode', reason ? { mode, reason } : { mode });
    }
  }

  private activateDirection(
    relay: Relay,
    key: TranslationDirection,
    speaker: Role,
    want: { source: string; target: string; mode: ActiveMode },
  ) {
    const listener = other(speaker);
    const pick = this.router.pick(want.source, want.target, want.mode);
    const d: DirectionState = {
      key,
      speaker,
      listener,
      source: want.source,
      target: want.target,
      requestedMode: want.mode,
      mode: pick?.mode ?? want.mode,
      route: pick?.route ?? 'none',
      sessionId: null,
      voiceRate: 0,
      captionsRate: 0,
      provider: null,
      fallback: pick?.fallback ?? null,
      fallbackUsed: false,
      pending: pick ? [] : null,
      queue: [],
      failed: !pick,
      closed: false,
      status: TranslationSessionStatus.ENDED,
      voiceMs: 0,
      captionsMs: 0,
      accrueSince: null,
      metrics: {
        phrases: 0,
        droppedFrames: 0,
        providerFailures: 0,
        fallbacks: 0,
        flags: 0,
        flagReasons: {},
        replays: 0,
        repeats: 0,
        lexiconHits: 0,
        firstAudioMs: [],
        captionDelayMs: [],
      },
      opening: null,
      finalizing: null,
    };
    relay.directions.set(key, d);
    if (!pick) {
      this.emitBoth(relay, 'error', { code: 'TRANSLATION_PROVIDER_UNAVAILABLE' });
      return;
    }
    if (pick.mode !== want.mode) {
      // No voice for this language on any route: the listener gets captions.
      relay.participants[listener].socket?.emit('mode', { mode: pick.mode });
    }
    // A phrase already being spoken joins the new direction.
    const open = relay.participants[speaker].open;
    if (open && !open.direction) {
      open.direction = d;
      open.targetLanguage = d.target;
      d.queue.push(open);
    }
    d.opening = this.openDirection(relay, d, pick.provider);
  }

  private async openDirection(relay: Relay, d: DirectionState, provider: TranslationProvider) {
    try {
      const row = await this.sessions.start({
        callId: relay.callId,
        projectId: relay.projectId,
        ownerId: relay.ownerId,
        direction: d.key,
        sourceLanguage: d.source,
        targetLanguage: d.target,
        mode: d.mode,
        route: d.route,
      });
      d.sessionId = row.id;
      d.voiceRate = row.voiceRate;
      d.captionsRate = row.captionsRate;
      relay.lastRates = { voice: row.voiceRate, captions: row.captionsRate };
    } catch (err) {
      const code =
        err instanceof TranslationLimitError ? err.code : 'TRANSLATION_PROVIDER_UNAVAILABLE';
      this.logger.warn(
        `event=translation_session_start_failed callId=${relay.callId} direction=${d.key} code=${code}`,
      );
      this.accrue(relay);
      d.failed = true;
      d.pending = null;
      d.voiceMs = 0;
      d.captionsMs = 0;
      this.accrue(relay);
      if (!d.closed) this.emitBoth(relay, 'error', { code });
      return;
    }
    if (d.closed) return;
    await this.connectProvider(relay, d, provider);
  }

  private async connectProvider(relay: Relay, d: DirectionState, provider: TranslationProvider) {
    let session: TranslationProviderSession;
    try {
      session = await provider.connect({
        sourceLanguage: d.source,
        targetLanguage: d.target,
        mode: d.mode,
        lexicon: lexiconHints(relay.lexicon, d.target),
        context: {
          industry: relay.config.context?.industry,
          purpose: relay.config.context?.purpose,
          speakerRole: relay.config.context?.roles?.[d.speaker],
          listenerRole: relay.config.context?.roles?.[d.listener],
        },
      });
    } catch {
      if (d.closed) return;
      d.metrics.providerFailures++;
      this.logger.warn(
        `event=translation_provider_connect_failed callId=${relay.callId} route=${provider.name}`,
      );
      return this.tryFallback(relay, d);
    }
    if (d.closed || relay.ending) {
      session.close();
      return;
    }
    d.provider = session;
    d.route = provider.name;
    this.wireProvider(relay, d, session);
    const pending = d.pending ?? [];
    d.pending = null;
    for (const op of pending) this.sendOp(d, op);
    if (!relay.started) {
      relay.started = true;
      fireTranslationWebhook(this.webhooks, relay.callId, 'call.translation.started', {
        mode: relay.callMode,
        callerLanguage: relay.participants.caller.speak,
        receiverLanguage: relay.participants.receiver.speak,
      });
    }
  }

  private async tryFallback(relay: Relay, d: DirectionState) {
    if (d.fallback && !d.fallbackUsed && !d.closed) {
      d.fallbackUsed = true;
      d.metrics.fallbacks++;
      d.pending = d.pending ?? [];
      const fallback = d.fallback;
      d.route = fallback.name;
      if (d.sessionId) void this.sessions.updateRoute(d.sessionId, fallback.name).catch(() => undefined);
      this.logger.warn(`event=translation_fallback callId=${relay.callId} route=${fallback.name}`);
      return this.connectProvider(relay, d, fallback);
    }
    this.accrue(relay);
    d.failed = true;
    d.status = TranslationSessionStatus.FAILED;
    d.pending = null;
    this.accrue(relay);
    this.emitBoth(relay, 'error', { code: 'TRANSLATION_PROVIDER_UNAVAILABLE' });
  }

  private wireProvider(relay: Relay, d: DirectionState, session: TranslationProviderSession) {
    const live = () => d.provider === session && !d.closed;
    session.on('transcript', (ev) => {
      if (!live()) return;
      const phrase = this.headPhrase(relay, d);
      if (phrase.final) return;
      phrase.original = ev.text ?? '';
      if (ev.final) {
        phrase.confidence = ev.confidence;
        phrase.alternatives = ev.alternatives;
      }
      if (ev.language) {
        phrase.detectedLanguage = ev.language;
        const speaker = relay.participants[d.speaker];
        if (speaker.speak === 'auto') {
          phrase.sourceLanguage = ev.language;
          if (base(ev.language) !== base(speaker.detected)) {
            speaker.detected = base(ev.language);
            relay.replanPending = true;
          }
        }
      }
      this.emitCaption(relay, phrase);
    });
    session.on('translation', (ev) => {
      if (!live()) return;
      const phrase = this.headPhrase(relay, d);
      if (phrase.final) return;
      phrase.translated = ev.text ?? '';
      if (ev.final) this.completePhrase(relay, d, phrase);
      else this.emitCaption(relay, phrase);
    });
    session.on('audio', (pcm) => {
      if (!live() || d.mode !== 'voice') return;
      const phrase = this.headPhrase(relay, d);
      if (!phrase.translatedAudioAt) {
        phrase.translatedAudioAt = Date.now();
        const fromEnd = phrase.endedAt ? phrase.translatedAudioAt - phrase.endedAt : -1;
        const fromStart = phrase.translatedAudioAt - phrase.startedAt;
        const ms = fromEnd > 0 ? Math.min(fromEnd, fromStart) : fromStart;
        if (ms >= 0) d.metrics.firstAudioMs.push(ms);
      }
      relay.participants[d.listener].socket?.emit('audio', pcm, { phraseId: phrase.id });
    });
    session.on('phraseDone', () => {
      if (!live()) return;
      const phrase = d.queue.shift();
      if (phrase && !phrase.final) this.completePhrase(relay, d, phrase);
      if (relay.replanPending) this.replan(relay);
    });
    session.on('error', (code) => {
      if (!live()) return;
      void this.onProviderError(relay, d, session, code);
    });
    session.on('closed', () => {
      if (!live()) return;
      void this.onProviderError(relay, d, session, 'TRANSLATION_CONNECTION_FAILED');
    });
  }

  /** Oldest unfinished phrase of the direction; one is created if the provider ran ahead. */
  private headPhrase(relay: Relay, d: DirectionState): LivePhrase {
    const head = d.queue[0];
    if (head) return head;
    const speaker = relay.participants[d.speaker];
    speaker.seq++;
    const phrase: LivePhrase = {
      id: `${d.speaker}-${speaker.seq}`,
      speaker: d.speaker,
      direction: d,
      sourceLanguage: speaker.speak === 'auto' ? (speaker.detected ?? 'auto') : speaker.speak,
      targetLanguage: d.target,
      original: '',
      translated: '',
      final: false,
      startedAt: Date.now(),
    };
    d.queue.push(phrase);
    this.remember(relay, phrase);
    return phrase;
  }

  private async onProviderError(
    relay: Relay,
    d: DirectionState,
    session: TranslationProviderSession,
    code: string,
  ) {
    d.provider = null;
    session.removeAllListeners();
    session.close();
    d.metrics.providerFailures++;
    this.logger.warn(`event=translation_provider_error callId=${relay.callId} route=${d.route} code=${code}`);
    const affected = d.queue.splice(0);
    for (const phrase of affected) this.completePhrase(relay, d, phrase, { providerError: true });
    const open = relay.participants[d.speaker].open;
    if (open?.direction === d) open.direction = null;
    d.pending = [];
    await this.tryFallback(relay, d);
  }

  // ── Captions & MeaningGuard ──────────────────────────
  private caption(phrase: LivePhrase): Caption {
    return {
      phraseId: phrase.id,
      speaker: phrase.speaker,
      sourceLanguage: phrase.sourceLanguage,
      targetLanguage: phrase.targetLanguage,
      original: phrase.original,
      translated: phrase.translated,
      final: phrase.final,
      startedAt: phrase.startedAt,
      ...(phrase.endedAt ? { endedAt: phrase.endedAt } : {}),
      ...(phrase.translatedAudioAt ? { translatedAudioAt: phrase.translatedAudioAt } : {}),
      ...(phrase.guard ? { guard: phrase.guard } : {}),
      ...(phrase.lexiconApplied?.length ? { lexiconApplied: phrase.lexiconApplied } : {}),
    };
  }

  private emitCaption(relay: Relay, phrase: LivePhrase) {
    this.emitBoth(relay, 'caption', this.caption(phrase));
  }

  /** Final caption: PurpleLex first, then MeaningGuard, then storage. */
  private completePhrase(
    relay: Relay,
    d: DirectionState,
    phrase: LivePhrase,
    opts: { providerError?: boolean } = {},
  ) {
    if (phrase.final) return;
    phrase.final = true;
    const now = Date.now();
    const lexicon = relay.lexicon;
    if (lexicon.length && phrase.translated) {
      const applied = applyLexicon({
        source: phrase.original,
        translated: phrase.translated,
        targetLanguage: d.target,
        lexicon,
      });
      phrase.translated = applied.text;
      if (applied.applied.length) phrase.lexiconApplied = applied.applied;
    }
    const delay = phrase.endedAt ? now - phrase.endedAt : null;
    if (delay !== null && phrase.translated) d.metrics.captionDelayMs.push(delay);
    d.metrics.phrases++;

    if (relay.guard.enabled) {
      const check = checkTranslation({
        source: phrase.original,
        translated: phrase.translated,
        sourceLanguage: phrase.sourceLanguage,
        targetLanguage: d.target,
        lexicon,
      });
      d.metrics.lexiconHits += check.lexiconHits;
      const speaker = relay.participants[d.speaker];
      const result = evaluateGuard(
        {
          termReasons: check.reasons,
          recognitionFailed: !phrase.original.trim() && !opts.providerError,
          asrConfidence: phrase.confidence ?? null,
          alternativesDisagree: !!phrase.alternatives?.some(
            (alt) => digitsOf(alt) !== digitsOf(phrase.original),
          ),
          languageMismatch:
            speaker.speak !== 'auto' &&
            !!phrase.detectedLanguage &&
            base(phrase.detectedLanguage) !== base(speaker.speak),
          poorAudio: phrase.poorAudio === true,
          lateTranslation: delay !== null && delay > LATE_TRANSLATION_MS,
          providerError: opts.providerError === true,
        },
        guardSensitivity(relay.guard.sensitivity),
      );
      phrase.guard = { status: result.status, reasons: result.reasons };
      if (result.status === 'uncertain') {
        d.metrics.flags++;
        for (const r of result.reasons) {
          d.metrics.flagReasons[r] = (d.metrics.flagReasons[r] ?? 0) + 1;
        }
      }
    }
    this.emitCaption(relay, phrase);
    if (phrase.guard?.status === 'uncertain') {
      this.emitBoth(relay, 'flagged', { phraseId: phrase.id, reasons: phrase.guard.reasons });
    }
    if (relay.postCall && (phrase.original || phrase.translated)) {
      void this.transcripts.write(
        relay.callId,
        {
          phraseId: phrase.id,
          speaker: phrase.speaker,
          sourceLanguage: phrase.sourceLanguage,
          targetLanguage: phrase.targetLanguage,
          original: phrase.original,
          translated: phrase.translated,
          startedAt: phrase.startedAt,
          endedAt: phrase.endedAt,
          translatedAudioAt: phrase.translatedAudioAt,
          guardStatus: phrase.guard?.status,
          guardReasons: phrase.guard?.reasons,
        },
        relay.retentionDays,
      );
    }
  }

  private emitBoth(relay: Relay, event: string, payload: unknown) {
    for (const role of ROLES) relay.participants[role].socket?.emit(event, payload);
  }

  // ── Accounting ───────────────────────────────────────
  private bothConnected(relay: Relay) {
    return !!relay.participants.caller.socket && !!relay.participants.receiver.socket;
  }

  /** Folds elapsed wall-clock into each direction and restarts the clocks. */
  private accrue(relay: Relay, now = Date.now()) {
    const both = this.bothConnected(relay) && !relay.ending;
    let anyActive = false;
    for (const d of relay.directions.values()) {
      if (d.accrueSince !== null) {
        const ms = Math.max(0, now - d.accrueSince);
        if (d.mode === 'voice') d.voiceMs += ms;
        else d.captionsMs += ms;
      }
      const active = both && !d.failed && !d.closed;
      d.accrueSince = active ? now : null;
      if (active) anyActive = true;
    }
    if (relay.usedSince !== null) relay.usedMs += Math.max(0, now - relay.usedSince);
    relay.usedSince = anyActive ? now : null;
  }

  private usedMs(relay: Relay) {
    return relay.usedMs + (relay.usedSince !== null ? Date.now() - relay.usedSince : 0);
  }

  private liveCredits(relay: Relay) {
    let voiceSeconds = 0;
    let captionsSeconds = 0;
    let credits = 0;
    let perMinute = 0;
    for (const d of relay.directions.values()) {
      voiceSeconds += d.voiceMs / 1000;
      captionsSeconds += d.captionsMs / 1000;
      credits += (d.voiceMs / 60_000) * d.voiceRate + (d.captionsMs / 60_000) * d.captionsRate;
      if (d.accrueSince !== null) perMinute += d.mode === 'voice' ? d.voiceRate : d.captionsRate;
    }
    if (relay.trial) {
      // Trial seconds are free: approximate with the blended rate.
      const seconds = voiceSeconds + captionsSeconds;
      const trialUsed = Math.min(seconds, relay.trialSecondsAtStart);
      const perSecond = seconds > 0 ? credits / seconds : 0;
      credits = Math.max(0, credits - trialUsed * perSecond);
    }
    return { credits: credits + relay.unbilledCredits, perMinute };
  }

  // ── Tick: call status, idle, checkpoint, CostGuard ───
  private async tick(relay: Relay) {
    if (relay.ending || relay.ticking) return;
    relay.ticking = true;
    try {
      const now = Date.now();
      this.accrue(relay, now);
      const call = await this.prisma.call
        .findUnique({ where: { id: relay.callId }, select: { status: true } })
        .catch(() => null);
      if (relay.ending) return;
      if (call && ENDED_CALL_STATUSES.has(call.status)) {
        await this.endRelay(relay, 'call_ended');
        return;
      }
      const speaking = ROLES.some((r) => relay.participants[r].open);
      if (!speaking && now - relay.lastActivityAt >= TRANSLATION_IDLE_TIMEOUT_MS) {
        await this.endRelay(relay, 'idle_timeout');
        return;
      }
      if (now - relay.lastCheckpointAt >= TRANSLATION_CHECKPOINT_MS) {
        relay.lastCheckpointAt = now;
        for (const d of relay.directions.values()) {
          if (!d.sessionId || d.finalizing) continue;
          void this.sessions
            .checkpoint(d.sessionId, { voiceSeconds: d.voiceMs / 1000, captionsSeconds: d.captionsMs / 1000 })
            .catch(() => undefined);
        }
      }
      await this.runCostGuard(relay);
      if (relay.replanPending) this.replan(relay);
    } catch (err) {
      this.logger.warn(
        `event=translation_tick_failed callId=${relay.callId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
    } finally {
      relay.ticking = false;
    }
  }

  private async runCostGuard(relay: Relay) {
    const modes = ROLES.map((r) => this.effectiveMode(relay, relay.participants[r]));
    const mode = modes.reduce((a, b) => (MODE_RANK[a] >= MODE_RANK[b] ? a : b), 'off' as Mode);
    if (mode === 'off' || relay.directions.size === 0) return;
    const live = this.liveCredits(relay);
    const actions = await this.costGuard.evaluate({
      callId: relay.callId,
      projectId: relay.projectId,
      ownerId: relay.ownerId,
      mode,
      onLimit: relay.onLimit,
      maxMinutes: relay.maxMinutes,
      usedSeconds: this.usedMs(relay) / 1000,
      liveCredits: live.credits,
      creditsPerMinute: live.perMinute,
      trial: relay.trial,
      warned: relay.warned,
      budgets: relay.budgets,
    });
    if (relay.ending) return;
    for (const action of actions) this.applyLimit(relay, action);
  }

  private applyLimit(relay: Relay, action: CostGuardAction) {
    for (const role of ROLES) {
      const p = relay.participants[role];
      p.socket?.emit('limit', {
        kind: action.kind,
        scope: action.scope,
        message: limitMessage(p.hear, action.kind, action.remainingSeconds),
        ...(action.remainingSeconds !== undefined ? { remainingSeconds: action.remainingSeconds } : {}),
      });
    }
    if (action.kind === 'warning') return;
    this.logger.log(
      `event=translation_limit callId=${relay.callId} scope=${action.scope} action=${action.kind}`,
    );
    relay.cap = action.kind === 'stepped_down' ? 'captions' : 'off';
    this.replan(relay, 'limit');
    fireTranslationWebhook(this.webhooks, relay.callId, 'translation.limit_reached', {
      scope: action.scope,
      action: action.kind,
    });
  }

  // ── Public hooks (REST / call lifecycle) ─────────────
  /** PATCH /calls/:id/translation on this instance: applied immediately. */
  async applyCallUpdate(
    callId: string,
    update: { mode?: Mode; callerLanguage?: string | null; receiverLanguage?: string | null },
  ): Promise<boolean> {
    const relay = this.relays.get(callId);
    if (!relay || relay.ending) return false;
    if (update.mode && update.mode !== 'off' && !(await this.ensureAccess(relay, update.mode))) {
      this.emitBoth(relay, 'error', { code: relay.lastAccessCode ?? 'TRANSLATION_NOT_IN_PLAN' });
      return false;
    }
    if (update.mode) {
      relay.callMode = update.mode;
      for (const r of ROLES) relay.participants[r].mode = null;
      if (update.mode !== 'off') {
        await this.liftLimit(relay, update.mode, ROLES.map((r) => relay.participants[r]));
        if (relay.ending) return false;
      }
    }
    const setLang = (p: Participant, lang: string | null | undefined) => {
      if (!lang) return;
      if (lang !== p.speak) p.detected = null;
      p.speak = lang;
      if (lang !== 'auto') p.hear = lang;
    };
    setLang(relay.participants.caller, update.callerLanguage);
    setLang(relay.participants.receiver, update.receiverLanguage);
    this.replan(relay, 'api');
    for (const r of ROLES) {
      const p = relay.participants[r];
      p.sentMode = this.effectiveMode(relay, p);
      p.socket?.emit('ready', this.readyPayload(relay, p));
    }
    return true;
  }

  /** Ends translation for a call on this instance (e.g. the call ended). */
  async endForCall(callId: string, reason = 'call_ended'): Promise<void> {
    const relay = this.relays.get(callId);
    if (relay) await this.endRelay(relay, reason);
  }

  // ── Finalize ─────────────────────────────────────────
  /** Idempotent per direction: the same promise for every path. */
  private finalizeDirection(relay: Relay, d: DirectionState, reason: string): Promise<void> {
    if (d.finalizing) return d.finalizing;
    this.accrue(relay);
    d.closed = true;
    d.accrueSince = null;
    if (relay.directions.get(d.key) === d) relay.directions.delete(d.key);
    this.accrue(relay);
    const provider = d.provider;
    d.provider = null;
    d.pending = null;
    if (provider) {
      provider.removeAllListeners();
      provider.close();
    }
    for (const role of ROLES) {
      const open = relay.participants[role].open;
      if (open?.direction === d) open.direction = null;
    }
    d.finalizing = this.runFinalizeDirection(relay, d, reason);
    return d.finalizing;
  }

  private async runFinalizeDirection(relay: Relay, d: DirectionState, reason: string) {
    await d.opening?.catch(() => undefined);
    const voiceSeconds = Math.round(d.voiceMs / 1000);
    const captionsSeconds = Math.round(d.captionsMs / 1000);
    const m = d.metrics;
    relay.totals.voiceSeconds += voiceSeconds;
    relay.totals.captionsSeconds += captionsSeconds;
    relay.totals.firstAudioMs.push(...m.firstAudioMs);
    relay.totals.flags += m.flags;
    relay.totals.replays += m.replays;
    relay.totals.repeats += m.repeats;
    relay.totals.fallbacks += m.fallbacks;
    if (!d.sessionId) return;
    const owed = this.directionCredits(relay, d);
    relay.unbilledCredits += owed;
    try {
      const ended = await this.sessions.end(d.sessionId, {
        reason,
        status: d.status,
        voiceSeconds,
        captionsSeconds,
        route: d.route,
        metrics: {
          phrases: m.phrases,
          firstAudioMsP50: percentile(m.firstAudioMs, 50),
          firstAudioMsP95: percentile(m.firstAudioMs, 95),
          captionDelayMsP50: percentile(m.captionDelayMs, 50),
          captionDelayMsP95: percentile(m.captionDelayMs, 95),
          droppedFrames: m.droppedFrames,
          providerFailures: m.providerFailures,
          fallbacks: m.fallbacks,
          flags: m.flags,
          flagReasons: m.flagReasons,
          replays: m.replays,
          repeats: m.repeats,
          lexiconHits: m.lexiconHits,
        },
      });
      if (!ended) return;
      const charge = await this.billing.recordSession(d.sessionId);
      relay.totals.credits += charge?.debited ?? 0;
    } catch (err) {
      // The billing cron retries unrecorded sessions.
      this.logger.error(
        `event=translation_direction_finalize_failed callId=${relay.callId} sessionId=${d.sessionId} error=${(err as Error)?.name ?? 'unknown'}`,
      );
    } finally {
      relay.unbilledCredits = Math.max(0, relay.unbilledCredits - owed);
    }
  }

  private directionCredits(relay: Relay, d: DirectionState) {
    if (relay.trial) return 0;
    return (d.voiceMs / 60_000) * d.voiceRate + (d.captionsMs / 60_000) * d.captionsRate;
  }

  /** Directions that would run if no mode or limit stopped them. */
  private languageDirections(relay: Relay) {
    return ROLES.filter((speakerRole) => {
      const speaker = relay.participants[speakerRole];
      const listener = relay.participants[other(speakerRole)];
      const spoken = speaker.speak === 'auto' ? (speaker.detected ?? 'auto') : speaker.speak;
      return (
        this.present(speaker) &&
        this.present(listener) &&
        (spoken === 'auto' || base(spoken) !== base(listener.hear))
      );
    }).length;
  }

  /**
   * After a step-down or pause the cap is never lifted on its own: only an
   * explicit mode change (participant or API) whose limit check passes.
   * Returns whether the requested mode may run now.
   */
  private async liftLimit(relay: Relay, mode: ActiveMode, notify: Participant[]): Promise<boolean> {
    if (MODE_RANK[relay.cap] >= MODE_RANK[mode]) return true;
    const live = this.liveCredits(relay);
    const directions = Math.max(1, this.languageDirections(relay));
    const check = async (m: ActiveMode) =>
      this.costGuard.evaluate({
        callId: relay.callId,
        projectId: relay.projectId,
        ownerId: relay.ownerId,
        mode: m,
        onLimit: relay.onLimit,
        maxMinutes: relay.maxMinutes,
        usedSeconds: this.usedMs(relay) / 1000,
        liveCredits: live.credits,
        creditsPerMinute:
          directions * (m === 'voice' ? relay.lastRates.voice : relay.lastRates.captions),
        trial: relay.trial,
        // A probe: never consumes the real warnings.
        warned: new Set(relay.warned),
        budgets: relay.budgets,
      });
    let blocked = (await check(mode)).find((a) => a.kind !== 'warning');
    let allowed: Mode | null = blocked ? null : mode;
    if (blocked?.kind === 'stepped_down' && MODE_RANK[relay.cap] < MODE_RANK.captions) {
      const captions = (await check('captions')).find((a) => a.kind !== 'warning');
      if (!captions) allowed = 'captions';
      else blocked = captions;
    }
    if (allowed) relay.cap = allowed === 'voice' ? 'voice' : 'captions';
    if (allowed !== mode && blocked) {
      for (const p of notify) {
        const kind = (allowed ?? relay.cap) === 'captions' ? 'stepped_down' : 'paused';
        p.socket?.emit('limit', {
          kind,
          scope: blocked.scope,
          message: limitMessage(p.hear, kind, 0),
          remainingSeconds: 0,
        });
      }
    }
    return allowed === mode;
  }

  private endRelay(relay: Relay, reason: string): Promise<void> {
    if (relay.ending) return relay.ending;
    this.accrue(relay);
    relay.ending = Promise.resolve().then(() => this.runEndRelay(relay, reason));
    return relay.ending;
  }

  private async runEndRelay(relay: Relay, reason: string) {
    clearInterval(relay.tickTimer);
    for (const role of ROLES) {
      const p = relay.participants[role];
      clearTimeout(p.graceTimer);
      p.graceTimer = undefined;
      p.open = null;
    }
    await Promise.all(
      [...relay.directions.values()].map((d) => this.finalizeDirection(relay, d, reason)),
    );
    relay.replay?.caller.clear();
    relay.replay?.receiver.clear();
    for (const role of ROLES) {
      const p = relay.participants[role];
      const socket = p.socket;
      p.socket = null;
      if (socket) {
        socket.emit('ended', { reason });
        socket.disconnect(true);
      }
    }
    if (this.relays.get(relay.callId) === relay) this.relays.delete(relay.callId);
    this.logger.log(`event=translation_relay_ended callId=${relay.callId} reason=${reason}`);

    if (relay.started) {
      const t = relay.totals;
      fireTranslationWebhook(this.webhooks, relay.callId, 'call.translation.ended', {
        voiceMinutes: Math.round((t.voiceSeconds / 60) * 100) / 100,
        captionsMinutes: Math.round((t.captionsSeconds / 60) * 100) / 100,
        credits: t.credits,
        firstAudioMsP50: percentile(t.firstAudioMs, 50),
        flags: t.flags,
        replays: t.replays,
        repeats: t.repeats,
        fallbacks: t.fallbacks,
      });
    }
    if (relay.postCall && this.reports) {
      try {
        await this.transcripts.flush(relay.callId);
        await this.reports.enqueue(relay.callId);
      } catch (err) {
        this.logger.warn(
          `event=translation_report_enqueue_failed callId=${relay.callId} error=${(err as Error)?.name ?? 'unknown'}`,
        );
      }
    }
  }
}

function toBuffer(frame: unknown): Buffer | null {
  if (Buffer.isBuffer(frame)) return frame;
  if (frame instanceof ArrayBuffer) return Buffer.from(frame);
  if (ArrayBuffer.isView(frame)) {
    return Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
  }
  return null;
}
