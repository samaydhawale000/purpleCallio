import { Injectable } from '@nestjs/common';

import { normalizeLanguage } from '../languages';
import { isProduction, translationConfig } from '../translation.config';
import {
  TranslationProvider,
  TranslationProviderMode,
} from './translation-provider.interface';
import { TranslationProviderRegistry } from './translation-provider.registry';

export interface TranslationRoutePick {
  provider: TranslationProvider;
  route: string;
  /** Always null: Live Translate deliberately has no provider fallback. */
  fallback: TranslationProvider | null;
  /** May be 'captions' when voice was asked for a language with no voice. */
  mode: TranslationProviderMode;
}

const SONIOX = 'soniox';

function norm(lang: string): string {
  if (lang === 'auto') return 'auto';
  return (normalizeLanguage(lang) ?? lang).toLowerCase();
}

/** Soniox is the sole production route.  The mock is opt-in/local only. */
@Injectable()
export class TranslationRouter {
  constructor(private readonly registry: TranslationProviderRegistry) {}

  pick(
    sourceLanguage: string,
    targetLanguage: string,
    mode: TranslationProviderMode,
  ): TranslationRoutePick | null {
    const source = norm(sourceLanguage);
    const target = norm(targetLanguage);
    const config = translationConfig();
    const mock = this.registry.get('mock');

    if (config.mockProvider && mock) return this.result(mock, null, source, target, mode);

    const usable = (p: TranslationProvider | null, m: TranslationProviderMode) =>
      !!p && p.name !== 'mock' && p.isConfigured() && p.supports(source, target, m);

    const soniox = this.registry.get(SONIOX);
    if (soniox && usable(soniox, mode)) return this.result(soniox, null, source, target, mode);
    if (soniox && mode === 'voice' && usable(soniox, 'captions'))
      return this.result(soniox, null, source, target, 'captions');

    if (!isProduction() && mock && this.registry.configured().length === 0) {
      return this.result(mock, null, source, target, mode);
    }
    return null;
  }

  private result(
    provider: TranslationProvider,
    fallback: TranslationProvider | null,
    source: string,
    target: string,
    mode: TranslationProviderMode,
  ): TranslationRoutePick {
    const effective =
      mode === 'voice' && provider.supports(source, target, 'voice')
        ? 'voice'
        : 'captions';
    return { provider, route: provider.name, fallback, mode: effective };
  }
}
