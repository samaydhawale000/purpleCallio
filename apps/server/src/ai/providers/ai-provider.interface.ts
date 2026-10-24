import { EventEmitter } from 'events';

/** Tool as declared to the provider (JSON Schema parameters, no endpoint). */
export interface AiProviderTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface AiProviderConnectConfig {
  systemPrompt: string;
  voice?: string | null;
  language: string;
  tools: AiProviderTool[];
  model?: string | null;
}

export type AiTranscriptRole = 'user' | 'agent';

export interface AiTranscriptEvent {
  role: AiTranscriptRole;
  text: string;
  final: boolean;
}

export interface AiToolCallEvent {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Token counts for one completed turn; the relay sums them. */
export interface AiUsageEvent {
  inputTokens: number;
  outputTokens: number;
}

/**
 * Stable codes only. Provider error text never leaves the provider layer.
 */
export type AiProviderErrorCode =
  | 'AI_PROVIDER_UNAVAILABLE'
  | 'AI_CONNECTION_FAILED';

export interface AiProviderSessionEvents {
  audio: [pcm16: Buffer];
  transcript: [event: AiTranscriptEvent];
  /** Barge-in: the user spoke over the agent; flush queued playback. */
  userSpeechStarted: [];
  toolCall: [event: AiToolCallEvent];
  /** The provider withdrew these tool calls (e.g. the user interrupted). */
  toolCallCancelled: [ids: string[]];
  usage: [event: AiUsageEvent];
  turnComplete: [];
  error: [code: AiProviderErrorCode];
  /** Emitted once, whether closed by us or by the provider. */
  closed: [];
}

/** A typed EventEmitter for the events above. */
export abstract class AiProviderSession extends EventEmitter<AiProviderSessionEvents> {
  abstract readonly inputSampleRate: number;
  abstract readonly outputSampleRate: number;

  /** Little-endian PCM16 mono at inputSampleRate. */
  abstract sendAudio(pcm16: Buffer): void;
  abstract sendToolResult(callId: string, result: unknown): void;
  /** Asks the agent to speak first (the agent's welcome message). */
  abstract greet(text: string): void;
  abstract cancelResponse(): void;
  abstract close(): void;
}

export interface AiProvider {
  readonly name: string;
  /** Whether the provider's key is set; missing means always available. */
  isConfigured?(): boolean;
  /** Resolves once the provider accepted the setup; rejects with a code. */
  connect(config: AiProviderConnectConfig): Promise<AiProviderSession>;
}

/** Rejection value of AiProvider.connect. */
export class AiProviderError extends Error {
  constructor(public readonly code: AiProviderErrorCode) {
    super(code);
    this.name = 'AiProviderError';
  }
}
