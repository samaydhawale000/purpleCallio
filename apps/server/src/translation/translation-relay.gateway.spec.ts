import { Logger } from '@nestjs/common';

import { CostGuardService } from './cost-guard.service';
import { MockTranslationProvider } from './providers/mock/mock.provider';
import {
  TranslationConnectConfig,
  TranslationProvider,
  TranslationProviderSession,
} from './providers/translation-provider.interface';
import {
  TRANSLATION_RECONNECT_GRACE_MS,
  TRANSLATION_TICK_MS,
  TranslationRelayGateway,
} from './translation-relay.gateway';

const NOW = new Date('2026-10-22T12:00:00Z');
const CALLER = 'bj_session_caller_token';
const RECEIVER = 'bj_session_receiver_token';

class FakeSession extends TranslationProviderSession {
  config!: TranslationConnectConfig;
  sendAudio = jest.fn();
  endOfSpeech = jest.fn();
  close = jest.fn(() => {
    this.emit('closed');
  });
}

function fakeProvider(name: string) {
  const sessions: FakeSession[] = [];
  const provider = {
    name,
    sessions,
    isConfigured: () => true,
    supports: () => true,
    connect: jest.fn(async (config: TranslationConnectConfig) => {
      const s = new FakeSession();
      s.config = config;
      sessions.push(s);
      return s;
    }),
  };
  return provider;
}

class FakeSocket {
  handshake: any;
  disconnected = false;
  emit = jest.fn();
  disconnect = jest.fn(() => {
    this.disconnected = true;
  });
  private handlers = new Map<string, Array<(...args: any[]) => void>>();
  constructor(token: string) {
    this.handshake = { auth: { token } };
  }
  on(event: string, handler: (...args: any[]) => void) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  trigger(event: string, ...args: any[]) {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }
  emitted(event: string) {
    return this.emit.mock.calls.filter(([n]) => n === event).map(([, ...rest]) => rest);
  }
  payloads(event: string) {
    return this.emitted(event).map(([p]) => p);
  }
}

/** 20 ms of a clear 16 kHz tone (well above the poor-audio floor). */
function frame(): Buffer {
  const buf = Buffer.alloc(640);
  for (let i = 0; i < 320; i++) {
    buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 300 * i) / 16000) * 8000), i * 2);
  }
  return buf;
}

describe('TranslationRelayGateway', () => {
  let gateway: TranslationRelayGateway;
  let call: any;
  let settings: any;
  let lexiconTerms: any[];
  let primary: ReturnType<typeof fakeProvider>;
  let fallback: ReturnType<typeof fakeProvider> | null;
  let useMock: boolean;
  let sessions: any;
  let billing: any;
  let access: any;
  let transcripts: any;
  let reports: any;
  let webhooks: any;
  let rows: any[];
  let wallet: number;
  let debited: number;

  const flush = () => jest.advanceTimersByTimeAsync(0);
  const advance = (ms: number) => jest.advanceTimersByTimeAsync(ms);

  async function connect(token: string) {
    const socket = new FakeSocket(token);
    await gateway.handleConnection(socket as any);
    await flush();
    return socket;
  }

  async function both() {
    const caller = await connect(CALLER);
    const receiver = await connect(RECEIVER);
    await flush();
    return { caller, receiver };
  }

  async function speak(socket: FakeSocket, frames = 10) {
    socket.trigger('speech.start', {});
    for (let i = 0; i < frames; i++) socket.trigger('audio', frame());
    socket.trigger('speech.end', {});
    await flush();
  }

  /** The provider session serving the caller → receiver direction. */
  const callerSession = () =>
    primary.sessions.find((s) => s.config.sourceLanguage === call.callerLanguage)!;

  beforeAll(() => {
    for (const level of ['log', 'warn', 'error', 'debug'] as const) {
      jest.spyOn(Logger.prototype, level).mockImplementation(() => undefined);
    }
  });

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    process.env.TRANSLATION_ENABLED = 'true';
    process.env.TRANSLATION_MOCK_LATENCY_MS = '100';
    call = {
      id: 'call_1',
      projectId: 'project_1',
      status: 'ACCEPTED',
      callerLanguage: 'hi',
      receiverLanguage: 'en',
      translationMode: 'VOICE',
      translationConfig: null,
      project: { ownerId: 'owner_1' },
    };
    settings = null;
    lexiconTerms = [];
    primary = fakeProvider('fake');
    fallback = null;
    useMock = false;
    rows = [];
    wallet = 1_000_000;
    debited = 0;

    const prisma: any = {
      translationSettings: { findUnique: jest.fn(async () => settings) },
      translationLexicon: {
        findFirst: jest.fn(async () => ({ id: 'lex_1', terms: lexiconTerms })),
      },
      call: { findUnique: jest.fn(async () => ({ status: call.status })) },
      translationSession: {
        aggregate: jest.fn(async () => ({ _sum: { creditsCharged: 0 } })),
      },
      translationBudgetAlert: { create: jest.fn(async () => ({})) },
    };
    const callSessions: any = {
      getByToken: jest.fn(async (token: string) =>
        token === CALLER || token === RECEIVER
          ? {
              callerToken: CALLER,
              receiverToken: RECEIVER,
              expiresAt: new Date(Date.now() + 3600_000),
              call,
            }
          : null,
      ),
    };
    sessions = {
      start: jest.fn(async (input: any) => {
        const row = { id: `ts_${rows.length + 1}`, voiceRate: 450, captionsRate: 60, ...input };
        rows.push(row);
        return row;
      }),
      end: jest.fn(async (id: string, end: any) => {
        const row = rows.find((r) => r.id === id);
        if (!row || row.ended) return false;
        row.ended = end;
        return true;
      }),
      checkpoint: jest.fn(async () => true),
      updateRoute: jest.fn(async () => undefined),
    };
    access = {
      canStart: jest.fn(async () => ({ ok: true, trial: false })),
      trialSecondsRemaining: jest.fn(async () => 0),
    };
    billing = {
      recordSession: jest.fn(async (id: string) => {
        const row = rows.find((r) => r.id === id);
        const credits = Math.ceil(
          (row.ended.voiceSeconds * row.voiceRate) / 60 + (row.ended.captionsSeconds * row.captionsRate) / 60,
        );
        debited += credits;
        return { debited: credits };
      }),
    };
    const mock = new MockTranslationProvider();
    const router: any = {
      pick: jest.fn((_s: string, _t: string, mode: 'voice' | 'captions') => {
        const provider = useMock ? mock : (primary as unknown as TranslationProvider);
        return { provider, route: provider.name, fallback: fallback as any, mode };
      }),
    };
    const credits: any = {
      getSummary: jest.fn(async () => ({ available: wallet - debited, paidAvailable: wallet - debited })),
    };
    webhooks = { fireForCall: jest.fn(async () => undefined) };
    const costGuard = new CostGuardService(prisma, credits, undefined, webhooks);
    transcripts = { write: jest.fn(async () => undefined), flush: jest.fn(async () => undefined) };
    reports = { enqueue: jest.fn(async () => undefined) };
    const billingConfig: any = { get: jest.fn(async () => ({ translationDefaultMaxMinutes: 60 })) };

    gateway = new TranslationRelayGateway(
      callSessions,
      prisma,
      sessions,
      access,
      billing,
      router,
      costGuard,
      transcripts,
      billingConfig,
      webhooks,
      reports,
    );
  });

  afterEach(async () => {
    await gateway.onModuleDestroy();
    jest.useRealTimers();
    delete process.env.TRANSLATION_ENABLED;
    delete process.env.TRANSLATION_MOCK_LATENCY_MS;
  });

  describe('handshake', () => {
    it('refuses when translation is disabled', async () => {
      process.env.TRANSLATION_ENABLED = 'false';
      const s = await connect(CALLER);
      expect(s.payloads('error')).toEqual([{ code: 'TRANSLATION_DISABLED' }]);
      expect(s.disconnect).toHaveBeenCalled();
    });

    it('refuses an unknown token', async () => {
      const s = await connect('bj_session_nope');
      expect(s.payloads('error')).toEqual([{ code: 'TRANSLATION_SESSION_INVALID' }]);
    });

    it('refuses an ended call', async () => {
      call.status = 'ENDED';
      const s = await connect(CALLER);
      expect(s.payloads('error')).toEqual([{ code: 'TRANSLATION_CALL_ENDED' }]);
    });

    it('refuses when the plan lacks translation', async () => {
      access.canStart.mockResolvedValueOnce({ ok: false, code: 'TRANSLATION_NOT_IN_PLAN', trial: false });
      const s = await connect(CALLER);
      expect(s.payloads('error')).toEqual([{ code: 'TRANSLATION_NOT_IN_PLAN' }]);
    });

    it('sends ready with the role and the protocol rates', async () => {
      const { caller, receiver } = await both();
      expect(caller.payloads('ready')[0]).toMatchObject({
        role: 'caller',
        inputSampleRate: 16000,
        outputSampleRate: 24000,
        mode: 'voice',
        you: { speak: 'hi', hear: 'hi' },
        peer: null,
        replayEnabled: false,
        guard: { enabled: true, sensitivity: 'standard' },
        limits: { maxMinutes: 60, usedSeconds: 0 },
        trial: false,
      });
      expect(receiver.payloads('ready')[0]).toMatchObject({
        role: 'receiver',
        peer: { speak: 'hi', hear: 'hi' },
      });
      expect(caller.payloads('peer')).toContainEqual({ connected: true, speak: 'en', hear: 'en' });
    });
  });

  describe('routing', () => {
    it('opens one session per direction once both are connected', async () => {
      const caller = await connect(CALLER);
      expect(sessions.start).not.toHaveBeenCalled();
      await connect(RECEIVER);
      await flush();
      expect(sessions.start).toHaveBeenCalledTimes(2);
      const configs = primary.sessions.map((s) => `${s.config.sourceLanguage}>${s.config.targetLanguage}:${s.config.mode}`);
      expect(configs.sort()).toEqual(['en>hi:voice', 'hi>en:voice']);
      expect(caller.disconnect).not.toHaveBeenCalled();
    });

    it("sends A's audio to A's direction only; captions to both, audio to B only", async () => {
      const { caller, receiver } = await both();
      await speak(caller, 5);
      const toEn = callerSession();
      const toHi = primary.sessions.find((s) => s !== toEn)!;
      expect(toEn.sendAudio).toHaveBeenCalledTimes(5);
      expect(toEn.endOfSpeech).toHaveBeenCalledTimes(1);
      expect(toHi.sendAudio).not.toHaveBeenCalled();

      toEn.emit('transcript', { text: 'नमस्ते', final: true });
      toEn.emit('translation', { text: 'Hello', final: true });
      toEn.emit('audio', Buffer.alloc(4800));
      toEn.emit('phraseDone');
      await flush();

      for (const s of [caller, receiver]) {
        const finals = s.payloads('caption').filter((c: any) => c.final);
        expect(finals).toHaveLength(1);
        expect(finals[0]).toMatchObject({
          phraseId: 'caller-1',
          speaker: 'caller',
          sourceLanguage: 'hi',
          targetLanguage: 'en',
          original: 'नमस्ते',
          translated: 'Hello',
          guard: { status: 'ok', reasons: [] },
        });
        expect(finals[0].startedAt).toBe(NOW.getTime());
        expect(finals[0].endedAt).toBe(NOW.getTime());
      }
      expect(receiver.emitted('audio')).toEqual([[Buffer.alloc(4800), { phraseId: 'caller-1' }]]);
      expect(caller.emitted('audio')).toEqual([]);
    });

    it('opens no session when both speak the same language', async () => {
      call.receiverLanguage = 'hi';
      await both();
      expect(sessions.start).not.toHaveBeenCalled();
    });

    it('captions mode produces no translated audio', async () => {
      call.translationMode = 'CAPTIONS';
      const { caller, receiver } = await both();
      await speak(caller);
      const s = callerSession();
      expect(s.config.mode).toBe('captions');
      s.emit('translation', { text: 'Hello', final: true });
      s.emit('audio', Buffer.alloc(4800));
      await flush();
      expect(receiver.emitted('audio')).toEqual([]);
      expect(receiver.payloads('caption').some((c: any) => c.final)).toBe(true);
    });

    it('re-plans on settings: matching languages close the direction', async () => {
      const { receiver } = await both();
      receiver.trigger('settings', { hear: 'hi' });
      await flush();
      // caller (hi) → receiver now hears hi: that direction ends.
      expect(sessions.end).toHaveBeenCalledTimes(1);
      expect(sessions.end.mock.calls[0][1]).toMatchObject({ reason: 'inactive' });
    });

    it("tells a participant whose own mode is off that the peer still needs their speech", async () => {
      const { caller, receiver } = await both();
      expect(caller.payloads('outbound').at(-1)).toEqual({ active: true });
      caller.trigger('settings', { mode: 'off' });
      await flush();
      // Only the caller stopped listening: their speech is still translated.
      expect(caller.payloads('ready').at(-1)).toMatchObject({ mode: 'off', outbound: true });
      expect(receiver.payloads('outbound').at(-1)).toEqual({ active: false });
      await speak(caller);
      expect(callerSession().sendAudio).toHaveBeenCalled();
      receiver.trigger('settings', { mode: 'off' });
      await flush();
      expect(caller.payloads('outbound').at(-1)).toEqual({ active: false });
    });

    it('a call-wide language update keeps a hear language the participant picked', async () => {
      const { caller, receiver } = await both();
      receiver.trigger('settings', { hear: 'ta' });
      await flush();
      await gateway.applyCallUpdate('call_1', { callerLanguage: 'ta', receiverLanguage: 'mr' });
      expect(receiver.payloads('ready').at(-1).you).toEqual({ speak: 'mr', hear: 'ta' });
      // The caller never picked one, so hear follows speak.
      expect(caller.payloads('ready').at(-1).you).toEqual({ speak: 'ta', hear: 'ta' });
    });

    it('rejects invalid settings', async () => {
      const { caller } = await both();
      caller.trigger('settings', { hear: 'auto' });
      await flush();
      expect(caller.payloads('error')).toContainEqual({ code: 'TRANSLATION_INVALID_LANGUAGE' });
    });

    it('drops oversized frames and counts them', async () => {
      const { caller } = await both();
      caller.trigger('speech.start', {});
      caller.trigger('audio', Buffer.alloc(32_002));
      caller.trigger('speech.end', {});
      await flush();
      expect(callerSession().sendAudio).not.toHaveBeenCalled();
      await gateway.endForCall('call_1');
      const end = sessions.end.mock.calls.find(([id]: any) => id === 'ts_1') ?? sessions.end.mock.calls[0];
      const all = sessions.end.mock.calls.map(([, e]: any) => e.metrics.droppedFrames);
      expect(all).toContain(1);
      expect(end).toBeDefined();
    });
  });

  describe('replay and repeat', () => {
    it('replay is disabled by default', async () => {
      const { caller, receiver } = await both();
      await speak(caller);
      receiver.trigger('replay', { phraseId: 'caller-1' });
      expect(receiver.payloads('error')).toContainEqual({ code: 'TRANSLATION_REPLAY_DISABLED' });
    });

    it('replays the original audio when the project and call allow it', async () => {
      settings = { replayEnabled: true };
      call.translationConfig = { guard: { enabled: true, replay: true } };
      const { caller, receiver } = await both();
      await speak(caller, 4);
      receiver.trigger('replay', { phraseId: 'caller-1' });
      const replays = receiver.emitted('replay.audio');
      expect(replays).toHaveLength(1);
      expect(replays[0][0].length).toBe(4 * 640);
      expect(replays[0][1]).toEqual({ phraseId: 'caller-1', sampleRate: 16000, done: true });
    });

    it('call guard.replay=false wins over the project setting', async () => {
      settings = { replayEnabled: true };
      call.translationConfig = { guard: { enabled: true, replay: false } };
      const { receiver } = await both();
      expect(receiver.payloads('ready')[0].replayEnabled).toBe(false);
    });

    it('repeat.request reaches only the speaker, in their language', async () => {
      const { caller, receiver } = await both();
      await speak(caller);
      callerSession().emit('transcript', { text: 'फीस ₹2,500 है', final: true });
      await flush();
      receiver.trigger('repeat.request', { phraseId: 'caller-1' });
      const asks = caller.payloads('repeat.requested');
      expect(asks).toHaveLength(1);
      expect(asks[0]).toMatchObject({ phraseId: 'caller-1', original: 'फीस ₹2,500 है' });
      expect(typeof asks[0].prompt).toBe('string');
      expect(asks[0].prompt.length).toBeGreaterThan(0);
      expect(receiver.payloads('repeat.requested')).toEqual([]);
    });
  });

  describe('MeaningGuard and PurpleLex', () => {
    it('flags the mock amount change (every 5th phrase)', async () => {
      useMock = true;
      const { caller, receiver } = await both();
      for (let i = 0; i < 5; i++) {
        await speak(caller, 10);
        await advance(500);
      }
      const finals = receiver.payloads('caption').filter((c: any) => c.final && c.speaker === 'caller');
      expect(finals).toHaveLength(5);
      for (const c of finals.slice(0, 4)) expect(c.guard.status).toBe('ok');
      expect(finals[4].guard.status).toBe('uncertain');
      expect(finals[4].guard.reasons).toContain('term_mismatch:amount');
      expect(receiver.payloads('flagged')).toEqual([
        { phraseId: 'caller-5', reasons: finals[4].guard.reasons },
      ]);
      expect(caller.payloads('flagged')).toHaveLength(1);
      // Voice mode: the mock tone reached the listener only.
      expect(receiver.emitted('audio').length).toBeGreaterThan(0);
      expect(caller.emitted('audio').filter(([, m]: any) => m.phraseId.startsWith('caller'))).toEqual([]);
    });

    it('applies PurpleLex before the final caption', async () => {
      call.callerLanguage = 'en';
      call.receiverLanguage = 'hi';
      call.translationConfig = { lexiconId: '00000000-0000-0000-0000-000000000001' };
      lexiconTerms = [
        {
          term: 'PurpleCallio',
          kind: 'DO_NOT_TRANSLATE',
          translations: { hi: 'पर्पलकॉलियो' },
          pronunciation: null,
          caseSensitive: false,
        },
      ];
      const { caller, receiver } = await both();
      const s = callerSession();
      expect(s.config.lexicon).toEqual([{ term: 'PurpleCallio', kind: 'DO_NOT_TRANSLATE' }]);
      await speak(caller);
      s.emit('transcript', { text: 'Welcome to PurpleCallio', final: true });
      s.emit('translation', { text: 'पर्पलकॉलियो में आपका स्वागत है', final: true });
      await flush();
      const final = receiver.payloads('caption').find((c: any) => c.final);
      expect(final.translated).toBe('PurpleCallio में आपका स्वागत है');
      expect(final.lexiconApplied).toEqual(['PurpleCallio']);
    });

    it('stores final phrases when the Post-Call Suite is on', async () => {
      settings = { postCallReportEnabled: true, transcriptRetentionDays: 7 };
      const { caller } = await both();
      await speak(caller);
      callerSession().emit('transcript', { text: 'नमस्ते', final: true });
      callerSession().emit('translation', { text: 'Hello', final: true });
      await flush();
      expect(transcripts.write).toHaveBeenCalledWith(
        'call_1',
        expect.objectContaining({ phraseId: 'caller-1', original: 'नमस्ते', translated: 'Hello' }),
        7,
      );
      await gateway.endForCall('call_1');
      expect(reports.enqueue).toHaveBeenCalledWith('call_1');
    });

    it('stores nothing by default', async () => {
      const { caller } = await both();
      await speak(caller);
      callerSession().emit('translation', { text: 'Hello', final: true });
      await gateway.endForCall('call_1');
      expect(transcripts.write).not.toHaveBeenCalled();
      expect(reports.enqueue).not.toHaveBeenCalled();
    });
  });

  describe('CostGuard', () => {
    const kinds = (s: FakeSocket) => s.payloads('limit').map((l: any) => `${l.kind}:${l.scope}`);

    it('per-call limit: warning then pause (no step-down); the call stays up', async () => {
      call.translationConfig = { maxMinutes: 1 };
      const { caller, receiver } = await both();
      await advance(55_000);
      expect(kinds(receiver)).toEqual(['warning:call']);
      await advance(TRANSLATION_TICK_MS);
      expect(kinds(receiver)).toEqual(['warning:call', 'paused:call']);
      expect(caller.payloads('mode')).toContainEqual({ mode: 'off', reason: 'limit' });
      expect(rows.filter((r) => r.mode === 'captions')).toHaveLength(0);
      expect(sessions.end).toHaveBeenCalledTimes(2);
      expect(caller.disconnect).not.toHaveBeenCalled();
      expect(receiver.disconnect).not.toHaveBeenCalled();
      expect(caller.payloads('ended')).toEqual([]);
      expect(webhooks.fireForCall).toHaveBeenCalledWith('call_1', 'translation.limit_reached', {
        scope: 'call',
        action: 'paused',
      });

      // No resume: asking for voice again fails the limit check.
      receiver.trigger('settings', { mode: 'voice' });
      await advance(TRANSLATION_TICK_MS * 2);
      expect(kinds(receiver)).toEqual(['warning:call', 'paused:call', 'paused:call']);
      expect(sessions.start).toHaveBeenCalledTimes(2);
    });

    it('credits: voice steps down, captions run while they fit, then pause', async () => {
      wallet = 2000;
      const { caller, receiver } = await both();
      // Voice: 2 × 450/min accrues 15 credits/s; projection = live + 900.
      await advance(60_000);
      expect(kinds(receiver)).toEqual(['warning:credits']);
      await advance(15_000);
      expect(kinds(receiver)).toEqual(['warning:credits', 'stepped_down:credits']);
      expect(receiver.payloads('mode')).toContainEqual({ mode: 'captions', reason: 'limit' });
      expect(rows.filter((r) => r.mode === 'captions')).toHaveLength(2);
      expect(debited).toBe(2 * Math.ceil((75 * 450) / 60));
      // Captions: 2 credits/s against the 874 left.
      await advance(300_000);
      expect(kinds(receiver)).toEqual(['warning:credits', 'stepped_down:credits']);
      await advance(40_000);
      expect(kinds(receiver)).toEqual(['warning:credits', 'stepped_down:credits', 'warning:credits']);
      await advance(45_000);
      expect(kinds(receiver)).toEqual([
        'warning:credits',
        'stepped_down:credits',
        'warning:credits',
        'paused:credits',
      ]);
      expect(caller.payloads('mode')).toContainEqual({ mode: 'off', reason: 'limit' });
      const captions = rows.filter((r) => r.mode === 'captions');
      expect(captions.every((r) => r.ended.captionsSeconds >= 375)).toBe(true);
      expect(caller.payloads('ended')).toEqual([]);

      // Paused: no resume on its own, nor on a mode change that doesn't fit…
      await advance(30_000);
      receiver.trigger('settings', { mode: 'voice' });
      await flush();
      expect(rows).toHaveLength(4);
      expect(kinds(receiver).at(-1)).toBe('paused:credits');
      // …but after a top-up a participant mode change resumes voice.
      wallet += 100_000;
      receiver.trigger('settings', { mode: 'voice' });
      await flush();
      expect(rows.filter((r) => r.mode === 'voice' && !r.ended)).toHaveLength(2);
      expect(receiver.payloads('mode').at(-1)).toEqual({ mode: 'voice', reason: 'participant' });
    });

    it('an API mode change resumes only when the limit check passes', async () => {
      wallet = 2000;
      call.translationConfig = { onLimit: 'off' };
      const { receiver } = await both();
      await advance(75_000);
      expect(kinds(receiver)).toEqual(['warning:credits', 'paused:credits']);
      expect(await gateway.applyCallUpdate('call_1', { mode: 'voice' })).toBe(true);
      expect(rows).toHaveLength(2);
      wallet += 100_000;
      await gateway.applyCallUpdate('call_1', { mode: 'voice' });
      await flush();
      expect(rows).toHaveLength(4);
    });
  });

  describe('finalize', () => {
    it('ends when the call ends and charges each session once', async () => {
      const { caller } = await both();
      await advance(20_000);
      call.status = 'ENDED';
      await advance(TRANSLATION_TICK_MS);
      expect(caller.payloads('ended')).toEqual([{ reason: 'call_ended' }]);
      expect(sessions.end).toHaveBeenCalledTimes(2);
      expect(billing.recordSession).toHaveBeenCalledTimes(2);
      const ended = sessions.end.mock.calls[0][1];
      expect(ended.voiceSeconds).toBe(25);
      expect(ended.captionsSeconds).toBe(0);
      await gateway.endForCall('call_1');
      await gateway.onModuleDestroy();
      expect(billing.recordSession).toHaveBeenCalledTimes(2);
      expect(webhooks.fireForCall).toHaveBeenCalledWith(
        'call_1',
        'call.translation.ended',
        expect.objectContaining({ credits: 2 * Math.ceil((25 * 450) / 60) }),
      );
    });

    it('does not bill time while a participant is away', async () => {
      const { receiver } = await both();
      await advance(10_000);
      receiver.trigger('disconnect');
      await advance(10_000);
      await connect(RECEIVER);
      await advance(10_000);
      await gateway.endForCall('call_1');
      expect(sessions.end.mock.calls[0][1].voiceSeconds).toBe(20);
    });
  });

  describe('fallback and reconnect', () => {
    it('falls back once on a provider error', async () => {
      fallback = fakeProvider('backup');
      const { caller, receiver } = await both();
      await speak(caller);
      const s = callerSession();
      s.emit('error', 'TRANSLATION_PROVIDER_UNAVAILABLE');
      await flush();
      expect(fallback.connect).toHaveBeenCalledTimes(1);
      expect(sessions.updateRoute).toHaveBeenCalledWith(expect.any(String), 'backup');
      // The in-flight phrase is closed and flagged.
      const flagged = receiver.payloads('flagged');
      expect(flagged[0]).toMatchObject({ phraseId: 'caller-1' });
      expect(flagged[0].reasons).toContain('provider_error');
      // New audio goes to the fallback.
      await speak(caller, 3);
      expect(fallback.sessions[0].sendAudio).toHaveBeenCalledTimes(3);
      await gateway.endForCall('call_1');
      const metrics = sessions.end.mock.calls.map(([, e]: any) => e.metrics);
      expect(metrics.some((m: any) => m.fallbacks === 1 && m.providerFailures === 1)).toBe(true);
    });

    it('reports an error when there is no fallback', async () => {
      const { caller } = await both();
      callerSession().emit('error', 'TRANSLATION_CONNECTION_FAILED');
      await flush();
      expect(caller.payloads('error')).toContainEqual({ code: 'TRANSLATION_PROVIDER_UNAVAILABLE' });
      expect(caller.disconnect).not.toHaveBeenCalled();
    });

    it('keeps the directions through a reconnect inside the grace window', async () => {
      const { receiver } = await both();
      receiver.trigger('disconnect');
      await advance(TRANSLATION_RECONNECT_GRACE_MS - 1000);
      const again = await connect(RECEIVER);
      await advance(5_000);
      expect(sessions.end).not.toHaveBeenCalled();
      expect(again.payloads('ready')[0].role).toBe('receiver');
      expect(sessions.start).toHaveBeenCalledTimes(2);
    });

    it('closes the directions after the grace window', async () => {
      const { caller, receiver } = await both();
      receiver.trigger('disconnect');
      await advance(TRANSLATION_RECONNECT_GRACE_MS);
      expect(sessions.end).toHaveBeenCalledTimes(2);
      expect(caller.payloads('peer').at(-1)).toEqual({ connected: false });
    });

    it('a new socket for the same role replaces the old one', async () => {
      const { receiver } = await both();
      const second = await connect(RECEIVER);
      expect(receiver.payloads('ended')).toEqual([{ reason: 'replaced' }]);
      expect(second.payloads('ready')).toHaveLength(1);
      expect(sessions.end).not.toHaveBeenCalled();
    });
  });
});
