import { Injectable, Optional } from '@nestjs/common';

import { MockTranslationProvider } from './mock/mock.provider';
import { SonioxProvider } from './soniox/soniox.provider';
import { TranslationProvider } from './translation-provider.interface';

/** All translation routes by id (`soniox`, `mock`). */
@Injectable()
export class TranslationProviderRegistry {
  private readonly providers = new Map<string, TranslationProvider>();

  constructor(
    mock: MockTranslationProvider,
    @Optional() soniox?: SonioxProvider,
  ) {
    for (const p of [mock, soniox]) {
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
