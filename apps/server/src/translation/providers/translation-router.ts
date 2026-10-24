import { Injectable } from '@nestjs/common';

import { isIndic, normalizeLanguage, voiceSupported } from '../languages';
import { isProduction, translationConfig } from '../translation.config';
import {
  TranslationProvider,
  TranslationProviderMode,
} from './translation-provider.interface';
import { TranslationProviderRegistry } from './translation-provider.registry';

export interface TranslationRoutePick {
  provider: TranslationProvider;
  route: string;
  /** Tried once if the primary fails (connect or mid-call error). */
  fallback: TranslationProvider | null;
  /** May be 'captions' when voice was asked for a language with no voice. */
  mode: TranslationProviderMode;
}

const SARVAM = 'sarvam';
const OPENAI = 'openai-translate';

function norm(lang: string): string {
  if (lang === 'auto') return 'auto';
  return (normalizeLanguage(lang) ?? lang).toLowerCase();
}

function isEnglish(lang: string): boolean {
  return lang === 'en' || lang.startsWith('en-');
}

/**
 * Launch routing table (PROTOCOL.md §8):
 * - Indian↔Indian and Indian↔English → sarvam (fallback openai-translate when
 *   it supports the pair);
 * - every other pair → openai-translate;
 * - voice into a language the route can't speak → captions;
 * - TRANSLATION_MOCK_PROVIDER=true, or no real route configured outside
 *   production → mock.
 */
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

    // Explicit override (still has to be able to serve the pair).
    if (config.defaultRoute) {
      const forced = this.registry.get(config.defaultRoute);
      if (forced?.name === 'mock') return this.result(forced, null, source, target, mode);
      if (forced && (usable(forced, mode) || usable(forced, 'captions'))) {
        return this.result(forced, null, source, target, mode);
      }
    }

    const sourceIndic = source !== 'auto' && isIndic(source);
    const targetIndic = isIndic(target);
    const indicRoute =
      (sourceIndic && (targetIndic || isEnglish(target))) ||
      (targetIndic && (source === 'auto' || isEnglish(source) || sourceIndic));
    const order = indicRoute ? [SARVAM, OPENAI] : [OPENAI, SARVAM];
    const candidates = order
      .map((name) => this.registry.get(name))
      .filter((p): p is TranslationProvider => !!p);

    // Voice where some route can speak the target; else captions.
    const wantVoice = mode === 'voice' && voiceSupported(target);
    let effective: TranslationProviderMode = wantVoice ? 'voice' : 'captions';
    let primary = candidates.find((p) => usable(p, effective)) ?? null;
    if (!primary && effective === 'voice') {
      effective = 'captions';
      primary = candidates.find((p) => usable(p, 'captions')) ?? null;
    }
    if (primary) {
      const fallback =
        candidates.find((p) => p !== primary && usable(p, effective)) ?? null;
      return { provider: primary, route: primary.name, fallback, mode: effective };
    }

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
