import { Injectable, Logger } from '@nestjs/common';
import WebSocket from 'ws';

import {
  AiProvider,
  AiProviderConnectConfig,
  AiProviderError,
  AiProviderErrorCode,
  AiProviderSession,
} from '../ai-provider.interface';

/**
 * OpenAI Realtime (GA) over the raw WebSocket (no SDK). Event names and
 * session shape follow https://developers.openai.com/api/reference/resources/realtime
 * (checked 2026-10).
 */
export const OPENAI_REALTIME_URL = 'wss://api.openai.com/v1/realtime';
export const OPENAI_DEFAULT_MODEL = 'gpt-realtime-2.1';
export const OPENAI_TRANSCRIBE_MODEL = 'gpt-4o-mini-transcribe';
/** Built-in voices; anything else (e.g. a Gemini voice) uses the default. */
export const OPENAI_VOICES = [
  'alloy',
  'ash',
  'ballad',
  'coral',
  'echo',
  'sage',
  'shimmer',
  'verse',
  'marin',
  'cedar',
] as const;
/** audio/pcm is 24 kHz mono PCM16 in both directions. */
const SAMPLE_RATE = 24_000;
const SETUP_TIMEOUT_MS = 10_000;

/** The subset of `ws` the provider uses, so specs can pass a fake. */
export interface OpenAiSocket {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  on(event: 'open', listener: () => void): this;
  on(event: 'message', listener: (data: WebSocket.RawData) => void): this;
  on(event: 'close', listener: (code: number) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

export type OpenAiSocketFactory = (
  url: string,
  headers: Record<string, string>,
) => OpenAiSocket;

interface OpenAiServerEvent {
  type?: string;
  response_id?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  response?: {
    id?: string;
    status?: string;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  error?: { type?: string; code?: string | null };
}

function openAiModel(model?: string | null): string {
  return (
    model?.trim() || process.env.AI_OPENAI_MODEL?.trim() || OPENAI_DEFAULT_MODEL
  );
}

/** ISO-639-1 for the transcription hint ("en-IN" → "en"), else none. */
function transcriptionLanguage(language: string): string | null {
  const primary = language.split('-')[0]?.toLowerCase() ?? '';
  return /^[a-z]{2}$/.test(primary) ? primary : null;
}

/** Whether OPENAI_API_KEY is set (read on every call, like aiConfig). */
export function openAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiProvider.name);

  /** Replaced in specs. The key travels in a header; never log headers. */
  socketFactory: OpenAiSocketFactory = (url, headers) =>
    new WebSocket(url, { headers });

  isConfigured(): boolean {
    return openAiConfigured();
  }

  connect(config: AiProviderConnectConfig): Promise<OpenAiSession> {
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    if (!apiKey) {
      this.logger.error('event=ai_provider_not_configured provider=openai');
      return Promise.reject(new AiProviderError('AI_PROVIDER_UNAVAILABLE'));
    }

    let socket: OpenAiSocket;
    try {
      socket = this.socketFactory(
        `${OPENAI_REALTIME_URL}?model=${encodeURIComponent(openAiModel(config.model))}`,
        { Authorization: `Bearer ${apiKey}` },
      );
    } catch {
      return Promise.reject(new AiProviderError('AI_PROVIDER_UNAVAILABLE'));
    }
    const session = new OpenAiSession(socket, this.logger);
    return session.open(config);
  }
}

export class OpenAiSession extends AiProviderSession {
  readonly inputSampleRate = SAMPLE_RATE;
  readonly outputSampleRate = SAMPLE_RATE;

  private ready = false;
  private closed = false;
  private closing = false;
  /** The response being generated, if any. */
  private activeResponseId: string | null = null;
  /** Responses cut off by barge-in or cancelResponse(): drop their output. */
  private readonly droppedResponses = new Set<string>();
  /** Tool calls waiting for sendToolResult. */
  private readonly pendingCalls = new Set<string>();
  /** A tool result arrived while a response was still running. */
  private responseAfterTools = false;
  private agentTranscript = '';
  private readonly userTranscripts = new Map<string, string>();

  constructor(
    private readonly socket: OpenAiSocket,
    private readonly logger: Logger,
  ) {
    super();
  }

  open(config: AiProviderConnectConfig): Promise<OpenAiSession> {
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
        this.logger.warn('event=ai_provider_setup_timeout provider=openai');
        fail('AI_PROVIDER_UNAVAILABLE');
      }, SETUP_TIMEOUT_MS);
      timer.unref?.();

      this.socket.on('open', () => {
        this.send({ type: 'session.update', session: this.sessionConfig(config) });
      });
      this.socket.on('message', (data) => {
        const event = this.parse(data);
        if (!event) return;
        if (!this.ready) {
          // session.created arrives first; our update is acked by session.updated.
          if (event.type === 'session.updated') {
            this.ready = true;
            settled = true;
            clearTimeout(timer);
            resolve(this);
          } else if (event.type === 'error') {
            this.logError(event);
            fail('AI_PROVIDER_UNAVAILABLE');
          }
          return;
        }
        this.handle(event);
      });
      this.socket.on('error', (err) => {
        // Never log the error message: it can echo request details.
        this.logger.warn(
          `event=ai_provider_socket_error provider=openai error=${err?.name ?? 'unknown'}`,
        );
        if (!this.ready) fail('AI_PROVIDER_UNAVAILABLE');
      });
      this.socket.on('close', (code) => {
        if (!this.ready) {
          this.logger.warn(
            `event=ai_provider_setup_rejected provider=openai closeCode=${code}`,
          );
          fail('AI_PROVIDER_UNAVAILABLE');
          this.markClosed();
          return;
        }
        if (!this.closing) {
          this.logger.warn(
            `event=ai_provider_closed provider=openai closeCode=${code}`,
          );
          this.emitError('AI_CONNECTION_FAILED');
        }
        this.markClosed();
      });
    });
  }

  sendAudio(pcm16: Buffer): void {
    this.send({
      type: 'input_audio_buffer.append',
      audio: pcm16.toString('base64'),
    });
  }

  sendToolResult(callId: string, result: unknown): void {
    if (!this.pendingCalls.delete(callId)) return;
    let output: string;
    try {
      output = JSON.stringify(result ?? null);
    } catch {
      output = 'null';
    }
    this.send({
      type: 'conversation.item.create',
      item: { type: 'function_call_output', call_id: callId, output },
    });
    // The model only answers once every call of the turn has a result, and
    // a response.create while one is running would be refused.
    if (this.pendingCalls.size > 0) return;
    if (this.activeResponseId) this.responseAfterTools = true;
    else this.send({ type: 'response.create' });
  }

  greet(text: string): void {
    // A per-response `instructions` would replace the session prompt, so the
    // greeting goes in as a system item instead.
    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'message',
        role: 'system',
        content: [
          {
            type: 'input_text',
            text: `Start the call now by saying this greeting to the caller: ${text}`,
          },
        ],
      },
    });
    this.send({ type: 'response.create' });
  }

  cancelResponse(): void {
    const id = this.activeResponseId;
    if (!id) return;
    this.droppedResponses.add(id);
    this.send({ type: 'response.cancel' });
  }

  close(): void {
    if (this.closed) return;
    this.closing = true;
    this.safeClose();
    // Don't wait for the close handshake: callers treat close() as final.
    this.markClosed();
  }

  // ── Inbound ──────────────────────────────────────────
  private handle(event: OpenAiServerEvent) {
    switch (event.type) {
      case 'response.created':
        this.activeResponseId = event.response?.id ?? null;
        return;

      case 'response.output_audio.delta':
        if (!event.delta || this.dropped(event.response_id)) return;
        this.emit('audio', Buffer.from(event.delta, 'base64'));
        return;

      case 'response.output_audio_transcript.delta':
        if (!event.delta || this.dropped(event.response_id)) return;
        this.agentTranscript += event.delta;
        this.emit('transcript', {
          role: 'agent',
          text: this.agentTranscript,
          final: false,
        });
        return;

      case 'response.output_audio_transcript.done':
        if (this.dropped(event.response_id)) return;
        this.agentTranscript = event.transcript ?? this.agentTranscript;
        this.flushAgentTranscript();
        return;

      case 'conversation.item.input_audio_transcription.delta': {
        if (!event.delta || !event.item_id) return;
        const text = (this.userTranscripts.get(event.item_id) ?? '') + event.delta;
        this.userTranscripts.set(event.item_id, text);
        this.emit('transcript', { role: 'user', text, final: false });
        return;
      }

      case 'conversation.item.input_audio_transcription.completed': {
        const buffered = event.item_id
          ? this.userTranscripts.get(event.item_id)
          : undefined;
        if (event.item_id) this.userTranscripts.delete(event.item_id);
        const text = (event.transcript ?? buffered ?? '').trim();
        if (text) this.emit('transcript', { role: 'user', text, final: true });
        return;
      }

      case 'input_audio_buffer.speech_started':
        // Barge-in. Server VAD also interrupts on its own; cancelling here
        // stops any further output reaching the caller right away.
        this.cancelResponse();
        this.flushAgentTranscript();
        this.emit('userSpeechStarted');
        return;

      case 'response.function_call_arguments.done': {
        if (!event.call_id || !event.name) return;
        // The response was cancelled by a barge-in: don't run its tool.
        if (this.dropped(event.response_id)) return;
        this.pendingCalls.add(event.call_id);
        this.emit('toolCall', {
          id: event.call_id,
          name: event.name,
          args: parseArguments(event.arguments),
        });
        return;
      }

      case 'response.done':
        this.onResponseDone(event);
        return;

      case 'error':
        this.onError(event);
        return;

      default:
        return;
    }
  }

  private onResponseDone(event: OpenAiServerEvent) {
    const response = event.response;
    const id = response?.id ?? null;
    if (!id || this.activeResponseId === id) this.activeResponseId = null;
    const cancelled =
      response?.status === 'cancelled' || (id !== null && this.dropped(id));
    if (id) this.droppedResponses.delete(id);

    // Cancelled responses are still billed by the provider.
    const usage = response?.usage;
    if (usage) {
      this.emit('usage', {
        inputTokens: nonNegative(usage.input_tokens),
        outputTokens: nonNegative(usage.output_tokens),
      });
    }

    if (cancelled) {
      this.agentTranscript = '';
    } else {
      this.flushAgentTranscript();
      this.emit('turnComplete');
    }

    if (this.responseAfterTools && this.pendingCalls.size === 0) {
      this.responseAfterTools = false;
      this.send({ type: 'response.create' });
    }
  }

  /**
   * invalid_request_error is about one client event (e.g. cancelling when
   * nothing is running) and leaves the session usable; anything else ends it.
   */
  private onError(event: OpenAiServerEvent) {
    this.logError(event);
    if (event.error?.type === 'invalid_request_error') return;
    this.emitError('AI_CONNECTION_FAILED');
  }

  private logError(event: OpenAiServerEvent) {
    // type/code are stable identifiers; the message never leaves this layer.
    this.logger.warn(
      `event=ai_provider_error provider=openai type=${safeToken(event.error?.type)} code=${safeToken(event.error?.code)}`,
    );
  }

  private dropped(responseId?: string | null) {
    return Boolean(responseId && this.droppedResponses.has(responseId));
  }

  private flushAgentTranscript() {
    const text = this.agentTranscript.trim();
    this.agentTranscript = '';
    if (text) this.emit('transcript', { role: 'agent', text, final: true });
  }

  private emitError(code: AiProviderErrorCode) {
    // An 'error' event without a listener would throw.
    if (this.listenerCount('error') > 0) this.emit('error', code);
  }

  // ── Plumbing ─────────────────────────────────────────
  private sessionConfig(config: AiProviderConnectConfig) {
    const voice = config.voice?.trim().toLowerCase();
    const language = transcriptionLanguage(config.language);
    return {
      type: 'realtime',
      output_modalities: ['audio'],
      instructions: config.systemPrompt,
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          transcription: {
            model: OPENAI_TRANSCRIBE_MODEL,
            ...(language ? { language } : {}),
          },
          turn_detection: {
            type: 'server_vad',
            create_response: true,
            interrupt_response: true,
          },
        },
        output: {
          format: { type: 'audio/pcm', rate: SAMPLE_RATE },
          ...(voice && (OPENAI_VOICES as readonly string[]).includes(voice)
            ? { voice }
            : {}),
        },
      },
      ...(config.tools.length
        ? {
            tools: config.tools.map((t) => ({
              type: 'function',
              name: t.name,
              description: t.description,
              parameters: t.parameters,
            })),
            tool_choice: 'auto',
          }
        : {}),
    };
  }

  private parse(data: WebSocket.RawData): OpenAiServerEvent | null {
    try {
      const text = Array.isArray(data)
        ? Buffer.concat(data).toString('utf8')
        : Buffer.isBuffer(data)
          ? data.toString('utf8')
          : Buffer.from(data).toString('utf8');
      const parsed: unknown = JSON.parse(text);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch {
      this.logger.warn('event=ai_provider_bad_message provider=openai');
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

/** Model-generated JSON; anything unparsable or non-object becomes {}. */
function parseArguments(raw?: string): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function safeToken(value: unknown): string {
  return typeof value === 'string' && /^[a-z0-9_.-]{1,64}$/i.test(value)
    ? value
    : 'unknown';
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}
