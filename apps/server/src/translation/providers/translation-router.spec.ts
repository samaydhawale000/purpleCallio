import { TranslationProviderRegistry } from './translation-provider.registry';
import { TranslationRouter } from './translation-router';
import { MockTranslationProvider } from './mock/mock.provider';

function provider(name: string, opts: { configured?: boolean; voice?: (t: string) => boolean } = {}) {
  return {
    name,
    isConfigured: () => opts.configured ?? true,
    supports: (_s: string, t: string, mode: string) => (mode === 'voice' ? (opts.voice?.(t) ?? true) : true),
    connect: jest.fn(),
  } as any;
}

describe('TranslationRouter', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  function router(openai: any, sarvam: any) {
    return new TranslationRouter(new TranslationProviderRegistry(new MockTranslationProvider(), openai, sarvam));
  }

  it('Indian↔English and Indian↔Indian go to sarvam with openai as fallback', () => {
    const r = router(provider('openai-translate'), provider('sarvam'));
    for (const [s, t] of [['hi', 'en'], ['en-IN', 'mr'], ['ta', 'hi'], ['auto', 'bn']]) {
      const pick = r.pick(s, t, 'voice')!;
      expect(pick.route).toBe('sarvam');
      expect(pick.fallback?.name).toBe('openai-translate');
      expect(pick.mode).toBe('voice');
    }
  });

  it('global pairs go to openai-translate', () => {
    const r = router(provider('openai-translate'), provider('sarvam'));
    expect(r.pick('en', 'fr', 'voice')!.route).toBe('openai-translate');
    expect(r.pick('es', 'hi', 'captions')!.route).toBe('openai-translate');
  });

  it('fallback only when it supports the target', () => {
    const openai = provider('openai-translate');
    openai.supports = () => false;
    const pick = router(openai, provider('sarvam')).pick('hi', 'mr', 'captions')!;
    expect(pick.route).toBe('sarvam');
    expect(pick.fallback).toBeNull();
  });

  it('voice into a language no route can speak downgrades to captions', () => {
    const r = router(provider('openai-translate', { voice: () => false }), provider('sarvam', { voice: () => false }));
    expect(r.pick('hi', 'en', 'voice')!.mode).toBe('captions');
  });

  it('uses the mock when forced or when nothing is configured outside production', () => {
    process.env.TRANSLATION_MOCK_PROVIDER = 'true';
    expect(router(provider('openai-translate'), provider('sarvam')).pick('hi', 'en', 'voice')!.route).toBe('mock');
    delete process.env.TRANSLATION_MOCK_PROVIDER;
    process.env.NODE_ENV = 'test';
    const none = router(provider('openai-translate', { configured: false }), provider('sarvam', { configured: false }));
    expect(none.pick('hi', 'en', 'voice')!.route).toBe('mock');
    process.env.NODE_ENV = 'production';
    expect(none.pick('hi', 'en', 'voice')).toBeNull();
  });

  it('honours TRANSLATION_DEFAULT_ROUTE', () => {
    process.env.TRANSLATION_DEFAULT_ROUTE = 'openai-translate';
    expect(router(provider('openai-translate'), provider('sarvam')).pick('hi', 'en', 'voice')!.route).toBe(
      'openai-translate',
    );
  });
});
