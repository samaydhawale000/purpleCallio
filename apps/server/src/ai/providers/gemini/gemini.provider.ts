import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

import {
  AiProvider,
  AiProviderConnectConfig,
  AiProviderError,
  AiProviderErrorCode,
  AiProviderSession,
  AiTranscriptRole,
} from '../ai-provider.interface';

/**
 * Gemini Live over the raw BidiGenerateContent WebSocket (no SDK).
 * Message shapes follow https://ai.google.dev/api/live (checked 2026-10).
 */
export const GEMINI_LIVE_URL =
  'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
export const GEMINI_DEFAULT_MODEL = 'gemini-3.8-live';
const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;
const SETUP_TIMEOUT_MS = 10_000;

/** The subset of `ws` the provider uses, so specs can pass a fake. */
export interface GeminiSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): this;
  on(event: 'close', listener: (code: number) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export type GeminiSocketFactory = (url: string) => GeminiSocket;

interface GeminiServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    modelTurn?: {
      parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }>;
    };
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
    interrupted?: boolean;
    turnComplete?: boolean;
  };
  toolCallCancellation?: { ids?: string[] };
  toolCall?: {
    functionCalls?: Array<{
      id?: string;
      name?: string;
      args?: Record<string, unknown>;
    }>;
  };
  usageMetadata?: {
    promptTokenCount?: number;
    responseTokenCount?: number;
  };
  goAway?: unknown;
}

function geminiModel(model?: string | null): string {
  const configured =
    model?.trim() ||
    process.env.AI_GEMINI_MODEL?.trim() ||
    GEMINI_DEFAULT_MODEL;
  return configured.startsWith('models/') ? configured : `models/${configured}`;
}

@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);

  /** Replaced in specs. The key travels in the URL; never log the URL. */
  socketFactory: GeminiSocketFactory = (url) => new WebSocket(url);

  isConfigured(): boolean {
    return Boolean(process.env.GEMINI_API_KEY?.trim());
  }

  connect(config: AiProviderConnectConfig): Promise<GeminiSession> {
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      this.logger.error('event=ai_provider_not_configured provider=gemini');
      return Promise.reject(new AiProviderError('AI_PROVIDER_UNAVAILABLE'));
    }

    let socket: GeminiSocket;
    try {
      socket = this.socketFactory(
        `${GEMINI_LIVE_URL}?key=${encodeURIComponent(apiKey)}`,
      );
    } catch {
      return Promise.reject(new AiProviderError('AI_PROVIDER_UNAVAILABLE'));
    }
    const session = new GeminiSession(socket, this.logger);
    return session.open(config);
  }
}

export class GeminiSession extends AiProviderSession {
  readonly inputSampleRate = INPUT_SAMPLE_RATE;
  readonly outputSampleRate = OUTPUT_SAMPLE_RATE;

  private ready = false;
  private closed = false;
  private closing = false;
  /** Set by cancelResponse(): drop the rest of the current turn's audio. */
  private dropTurnAudio = false;
  private readonly toolNames = new Map<string, string>();
  private readonly transcripts: Record<AiTranscriptRole, string> = {
    user: '',
    agent: '',
  };
  private pendingUsage: { inputTokens: number; outputTokens: number } | null =
    null;

  constructor(
    private readonly socket: GeminiSocket,
    private readonly logger: Logger,
  ) {
    super();
  }

  open(config: AiProviderConnectConfig): Promise<GeminiSession> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (code: AiProviderErrorCode) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.closing = true;
        this.safeClose();
        reject(new AiProviderError(code));
      };
      const timer = setTimeout(() => {
        this.logger.warn('event=ai_provider_setup_timeout provider=gemini');
        fail('AI_PROVIDER_UNAVAILABLE');
      }, SETUP_TIMEOUT_MS);
      timer.unref?.();

      this.socket.on('open', () => {
        this.send({ setup: this.setupMessage(config) });
      });
      this.socket.on('message', (data) => {
        const message = this.parse(data);
        if (!message) return;
        if (!this.ready && message.setupComplete !== undefined) {
          this.ready = true;
          settled = true;
          clearTimeout(timer);
          resolve(this);
          return;
        }
        if (this.ready) this.handle(message);
      });
      this.socket.on('error', (err) => {
        // Error objects from ws can echo the URL (and so the key): name only.
        this.logger.warn(
          `event=ai_provider_socket_error provider=gemini error=${err?.name ?? 'unknown'}`,
        );
        if (!this.ready) fail('AI_PROVIDER_UNAVAILABLE');
      });
      this.socket.on('close', (code) => {
        if (!this.ready) {
          this.logger.warn(
            `event=ai_provider_setup_rejected provider=gemini closeCode=${code}`,
          );
          fail('AI_PROVIDER_UNAVAILABLE');
          this.markClosed();
          return;
        }
        if (!this.closing) {
          this.logger.warn(
            `event=ai_provider_closed provider=gemini closeCode=${code}`,
          );
          // An 'error' event without a listener would throw.
          if (this.listenerCount('error') > 0) {
            this.emit('error', 'AI_CONNECTION_FAILED');
          }
        }
        this.markClosed();
      });
    });
  }

  sendAudio(pcm16: Buffer): void {
    this.send({
      realtimeInput: {
        audio: {
          data: pcm16.toString('base64'),
          mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
        },
      },
    });
  }

  sendToolResult(callId: string, result: unknown): void {
    const name = this.toolNames.get(callId);
    if (!name) return;
    this.toolNames.delete(callId);
    const response =
      result !== null && typeof result === 'object' && !Array.isArray(result)
        ? result
        : { result };
    this.send({
      toolResponse: { functionResponses: [{ id: callId, name, response }] },
    });
  }

  greet(text: string): void {
    this.send({
      realtimeInput: {
        text: `Start the call now by saying this greeting to the caller: ${text}`,
      },
    });
  }

  /** Gemini has no cancel message; its own VAD stops generation on barge-in. */
  cancelResponse(): void {
    this.dropTurnAudio = true;
  }

  close(): void {
    if (this.closed) return;
    this.closing = true;
    this.safeClose();
    // Don't wait for the close handshake: callers treat close() as final.
    this.markClosed();
  }

  // ── Inbound ──────────────────────────────────────────
  private handle(message: GeminiServerMessage) {
    if (message.usageMetadata) {
      // Gemini repeats usageMetadata on many messages within a turn, so keep
      // only the latest and report it once when the turn ends.
      this.pendingUsage = {
        inputTokens: nonNegative(message.usageMetadata.promptTokenCount),
        outputTokens: nonNegative(message.usageMetadata.responseTokenCount),
      };
    }

    const content = message.serverContent;
    if (content) {
      if (content.inputTranscription?.text) {
        this.appendTranscript('user', content.inputTranscription.text);
      }
      if (content.outputTranscription?.text) {
        this.flushTranscript('user');
        this.appendTranscript('agent', content.outputTranscription.text);
      }
      for (const part of content.modelTurn?.parts ?? []) {
        const data = part.inlineData?.data;
        if (!data || !part.inlineData?.mimeType?.startsWith('audio/')) continue;
        this.flushTranscript('user');
        if (!this.dropTurnAudio)
          this.emit('audio', Buffer.from(data, 'base64'));
      }
      if (content.interrupted) {
        this.flushTranscript('agent');
        this.emit('userSpeechStarted');
      }
      if (content.turnComplete || content.interrupted) this.endTurn();
      if (content.turnComplete) this.emit('turnComplete');
    }

    for (const call of message.toolCall?.functionCalls ?? []) {
      if (!call.id || !call.name) continue;
      this.toolNames.set(call.id, call.name);
      this.emit('toolCall', {
        id: call.id,
        name: call.name,
        args: call.args ?? {},
      });
    }

    const cancelled = message.toolCallCancellation?.ids ?? [];
    if (cancelled.length) this.emit('toolCallCancelled', cancelled);

    if (message.goAway !== undefined) {
      this.logger.warn('event=ai_provider_go_away provider=gemini');
    }
  }

  private endTurn() {
    this.flushTranscript('user');
    this.flushTranscript('agent');
    this.dropTurnAudio = false;
    if (this.pendingUsage) {
      this.emit('usage', this.pendingUsage);
      this.pendingUsage = null;
    }
  }

  private appendTranscript(role: AiTranscriptRole, text: string) {
    this.transcripts[role] += text;
    this.emit('transcript', {
      role,
      text: this.transcripts[role],
      final: false,
    });
  }

  private flushTranscript(role: AiTranscriptRole) {
    const text = this.transcripts[role].trim();
    this.transcripts[role] = '';
    if (text) this.emit('transcript', { role, text, final: true });
  }

  // ── Plumbing ─────────────────────────────────────────
  private setupMessage(config: AiProviderConnectConfig) {
    const voice = config.voice?.trim();
    return {
      model: geminiModel(config.model),
      generationConfig: {
        responseModalities: ['AUDIO'],
        ...(voice
          ? {
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
              },
            }
          : {}),
      },
      // Native-audio models pick the spoken language themselves; the
      // language is stated in the prompt's runtime context instead.
      systemInstruction: { parts: [{ text: config.systemPrompt }] },
      ...(config.tools.length
        ? {
            tools: [
              {
                functionDeclarations: config.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.parameters,
                })),
              },
            ],
          }
        : {}),
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    };
  }

  private parse(data: WebSocket.RawData): GeminiServerMessage | null {
    try {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.from(data).toString('utf8');
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      this.logger.warn('event=ai_provider_bad_message provider=gemini');
      return null;
    }
  }

  private send(message: unknown) {
    if (this.closed || this.socket.readyState !== WebSocket.OPEN) return;
    try {
      this.socket.send(JSON.stringify(message));
    } catch {
      // The close handler reports the failure.
    }
  }

  private safeClose() {
    try {
      this.socket.close(1000);
    } catch {
      // Already closed.
    }
  }

  private markClosed() {
    if (this.closed) return;
    this.closed = true;
    this.emit('closed');
    this.removeAllListeners();
  }
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
