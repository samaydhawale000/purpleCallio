import { Injectable, Optional } from '@nestjs/common';

import { MockTranslationProvider } from './mock/mock.provider';
import { OpenAiTranslateProvider } from './openai/openai-translate.provider';
import { SarvamProvider } from './sarvam/sarvam.provider';
import { TranslationProvider } from './translation-provider.interface';

/** All translation routes by id (`openai-translate`, `sarvam`, `mock`). */
@Injectable()
export class TranslationProviderRegistry {
  private readonly providers = new Map<string, TranslationProvider>();

  constructor(
    mock: MockTranslationProvider,
    @Optional() openai?: OpenAiTranslateProvider,
    @Optional() sarvam?: SarvamProvider,
  ) {
    for (const p of [mock, openai, sarvam]) {
      if (p) this.providers.set(p.name, p);
    }
  }

  get(name: string | null | undefined): TranslationProvider | null {
    return (name && this.providers.get(name.toLowerCase())) || null;
  }

  /** Real (non-mock) routes whose credentials are set. */
  configured(): TranslationProvider[] {
    return [...this.providers.values()].filter(
      (p) => p.name !== 'mock' && p.isConfigured(),
    );
  }

  all(): TranslationProvider[] {
    return [...this.providers.values()];
  }
}
