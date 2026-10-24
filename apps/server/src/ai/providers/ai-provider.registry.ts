import { Injectable, Logger } from '@nestjs/common';

import { AiProvider } from './ai-provider.interface';
import { GeminiProvider } from './gemini/gemini.provider';
import { OpenAiProvider } from './openai/openai.provider';

/** Provider names an agent version can store. */
export const AI_PROVIDER_NAMES = ['gemini', 'openai'] as const;

/**
 * Picks the provider for a session: the agent version's provider, else
 * AI_DEFAULT_PROVIDER (default `gemini`). Unknown names resolve to null so
 * the relay can answer AI_PROVIDER_UNAVAILABLE.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly logger = new Logger(AiProviderRegistry.name);
  private readonly providers: Map<string, AiProvider>;

  constructor(gemini: GeminiProvider, openai: OpenAiProvider) {
    this.providers = new Map<string, AiProvider>(
      [gemini, openai].map((p) => [p.name, p]),
    );
  }

  resolve(name?: string | null): AiProvider | null {
    const wanted = (
      name?.trim() ||
      process.env.AI_DEFAULT_PROVIDER?.trim() ||
      'gemini'
    ).toLowerCase();
    const provider = this.providers.get(wanted) ?? null;
    if (!provider) {
      this.logger.error(`event=ai_provider_unknown provider=${wanted}`);
    }
    return provider;
  }

  /** Names of the providers whose key is set (for the dashboard select). */
  configured(): string[] {
    return [...this.providers.values()]
      .filter((p) => p.isConfigured?.() ?? true)
      .map((p) => p.name);
  }
}
