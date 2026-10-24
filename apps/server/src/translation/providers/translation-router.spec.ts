import { MockTranslationProvider } from './mock/mock.provider';
import { TranslationProviderRegistry } from './translation-provider.registry';
import { TranslationRouter } from './translation-router';

function provider(configured = true, voice = true) {
  return { name: 'soniox', isConfigured: () => configured, supports: (_s: string, _t: string, mode: string) => mode === 'captions' || voice, connect: jest.fn() } as any;
}

describe('TranslationRouter', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  const router = (soniox: any) => new TranslationRouter(new TranslationProviderRegistry(new MockTranslationProvider(), soniox));

  it('routes every supported pair to Soniox with no fallback', () => {
    for (const [source, target] of [['hi', 'en'], ['en', 'mr'], ['es', 'fr']]) {
      const pick = router(provider()).pick(source, target, 'voice')!;
      expect(pick.route).toBe('soniox');
      expect(pick.fallback).toBeNull();
    }
  });

  it('downgrades voice only when Soniox cannot provide voice', () => {
    expect(router(provider(true, false)).pick('hi', 'en', 'voice')!.mode).toBe('captions');
  });

  it('uses mock only when explicitly enabled or no real provider exists outside production', () => {
    process.env.TRANSLATION_MOCK_PROVIDER = 'true';
    expect(router(provider()).pick('hi', 'en', 'voice')!.route).toBe('mock');
    delete process.env.TRANSLATION_MOCK_PROVIDER;
    process.env.NODE_ENV = 'test';
    expect(router(provider(false)).pick('hi', 'en', 'voice')!.route).toBe('mock');
    process.env.NODE_ENV = 'production';
    expect(router(provider(false)).pick('hi', 'en', 'voice')).toBeNull();
  });
});
