import {
  assertLanguage,
  configForStorage,
  modeFromDb,
  modeToDb,
  readTranslationConfig,
  validateTranslationRequest,
} from './translation-config';

const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return (e as { response?: { code?: string } }).response?.code;
  }
  return null;
};

describe('translation-config', () => {
  it('accepts the PROTOCOL example', () => {
    const out = validateTranslationRequest({
      mode: 'voice',
      lexiconId: '0b6c6a0e-3f0e-4a59-9a8e-0d1f2e3a4b5c',
      context: { industry: 'Healthcare', purpose: ' follow-up ', roles: { caller: 'doctor', receiver: 'patient' } },
      postCallReport: true,
      maxMinutes: 30,
      guard: { enabled: true, sensitivity: 'standard' },
      onLimit: 'captions_then_off',
    });
    expect(out.mode).toBe('voice');
    expect(out.context).toEqual({ industry: 'healthcare', purpose: 'follow-up', roles: { caller: 'doctor', receiver: 'patient' } });
    // replay omitted stays undefined (relay decides with the project setting)
    expect(out.guard).toEqual({ enabled: true, sensitivity: 'standard' });
    expect(configForStorage(out)).not.toHaveProperty('mode');
  });

  it('maps sensitivity aliases to canonical names and keeps an explicit replay', () => {
    expect(validateTranslationRequest({ guard: { sensitivity: 'strict', replay: false } }).guard).toEqual({
      enabled: true,
      sensitivity: 'high',
      replay: false,
    });
    expect(validateTranslationRequest({ guard: { sensitivity: 'relaxed' } }).guard?.sensitivity).toBe('low');
  });

  it.each([
    [{ mode: 'shout' }],
    [{ maxMinutes: 0 }],
    [{ maxMinutes: 601 }],
    [{ onLimit: 'explode' }],
    [{ guard: { sensitivity: 'paranoid' } }],
    [{ context: { purpose: 'x'.repeat(201) } }],
    [{ unknown: 1 }],
    ['nope'],
  ])('rejects %j with TRANSLATION_INVALID_CONFIG', (input) => {
    expect(code(() => validateTranslationRequest(input))).toBe('TRANSLATION_INVALID_CONFIG');
  });

  it('rejects a malformed lexicon id as not found', () => {
    expect(code(() => validateTranslationRequest({ lexiconId: 'x' }))).toBe('TRANSLATION_LEXICON_NOT_FOUND');
  });

  it('validates languages with LANGUAGE_TAG plus auto', () => {
    expect(assertLanguage('callerLanguage', 'en-IN')).toBe('en-IN');
    expect(assertLanguage('callerLanguage', 'auto')).toBe('auto');
    expect(assertLanguage('callerLanguage', undefined)).toBeUndefined();
    expect(code(() => assertLanguage('callerLanguage', 'english'))).toBe('TRANSLATION_INVALID_LANGUAGE');
    expect(code(() => assertLanguage('x', 'auto', { allowAuto: false }))).toBe('TRANSLATION_INVALID_LANGUAGE');
  });

  it('maps modes and reads stored config tolerantly', () => {
    expect(modeToDb('voice')).toBe('VOICE');
    expect(modeFromDb('CAPTIONS')).toBe('captions');
    expect(modeFromDb(null)).toBe('off');
    expect(readTranslationConfig(null)).toEqual({});
    expect(readTranslationConfig({ maxMinutes: 5, junk: true })).toEqual({ maxMinutes: 5 });
  });
});
