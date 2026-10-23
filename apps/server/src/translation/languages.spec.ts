import {
  captionsSupported,
  fromSarvamCode,
  getLanguage,
  isIndic,
  LANGUAGES,
  normalizeLanguage,
  publicLanguageList,
  toSarvamCode,
  voiceSupported,
} from './languages';

const SCHEDULED = [
  'as',
  'bn',
  'brx',
  'doi',
  'gu',
  'hi',
  'kn',
  'ks',
  'kok',
  'mai',
  'ml',
  'mni',
  'mr',
  'ne',
  'or',
  'pa',
  'sa',
  'sat',
  'sd',
  'ta',
  'te',
  'ur',
];

describe('languages', () => {
  it('lists all 22 scheduled languages as indic, plus English and global languages', () => {
    const indic = LANGUAGES.filter((l) => l.indic)
      .map((l) => l.code)
      .sort();
    expect(indic).toEqual([...SCHEDULED].sort());
    for (const c of [
      'en',
      'es',
      'fr',
      'de',
      'it',
      'pt',
      'ja',
      'ko',
      'zh',
      'ar',
      'ru',
      'tr',
      'id',
      'vi',
      'th',
      'nl',
      'pl',
      'uk',
    ]) {
      expect(getLanguage(c)).not.toBeNull();
    }
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });

  it('marks exactly the 13 OpenAI output languages', () => {
    const out = LANGUAGES.filter((l) => l.openai.output)
      .map((l) => l.code)
      .sort();
    expect(out).toEqual([
      'de',
      'en',
      'es',
      'fr',
      'hi',
      'id',
      'it',
      'ja',
      'ko',
      'pt',
      'ru',
      'vi',
      'zh',
    ]);
  });

  it('normalizes codes', () => {
    expect(normalizeLanguage('hi-IN')).toBe('hi');
    expect(normalizeLanguage(' EN_us ')).toBe('en');
    expect(normalizeLanguage('od-IN')).toBe('or');
    expect(normalizeLanguage('AUTO')).toBe('auto');
    expect(normalizeLanguage('kok-IN')).toBe('kok');
    expect(normalizeLanguage('zh-Hans')).toBe('zh');
    expect(normalizeLanguage('xx')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage('12')).toBeNull();
  });

  it('isIndic / voiceSupported / captionsSupported', () => {
    expect(isIndic('mr-IN')).toBe(true);
    expect(isIndic('en')).toBe(false);
    expect(isIndic('auto')).toBe(false);
    expect(voiceSupported('mr')).toBe(true); // Bulbul
    expect(voiceSupported('es')).toBe(true); // OpenAI
    expect(voiceSupported('ur')).toBe(false);
    expect(voiceSupported('ar')).toBe(false);
    expect(captionsSupported('ur')).toBe(true);
    expect(captionsSupported('tr')).toBe(false);
  });

  it('maps to and from Sarvam codes', () => {
    expect(toSarvamCode('hi')).toBe('hi-IN');
    expect(toSarvamCode('or')).toBe('od-IN');
    expect(toSarvamCode('en-US')).toBe('en-IN');
    expect(toSarvamCode('es')).toBeNull();
    expect(fromSarvamCode('od-IN')).toBe('or');
    expect(fromSarvamCode(null)).toBeNull();
    expect(fromSarvamCode('unknown')).toBeNull();
  });

  it('publicLanguageList has the PROTOCOL shape', () => {
    const list = publicLanguageList();
    expect(list.pairs).toBe(
      'all-to-all; voice availability is per target language',
    );
    const mr = list.languages.find((l) => l.code === 'mr');
    expect(mr).toEqual({
      code: 'mr',
      name: 'Marathi',
      nativeName: 'मराठी',
      script: 'Deva',
      rtl: false,
      voice: true,
      captions: true,
      routes: ['sarvam'],
    });
    expect(list.languages.find((l) => l.code === 'hi')!.routes).toEqual([
      'sarvam',
      'openai-translate',
    ]);
    expect(list.languages.find((l) => l.code === 'ur')).toMatchObject({
      rtl: true,
      voice: false,
      captions: true,
    });
    expect(list.languages.find((l) => l.code === 'es')!.routes).toEqual([
      'openai-translate',
    ]);
  });
});
