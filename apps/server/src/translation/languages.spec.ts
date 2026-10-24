import {
  captionsSupported,
  getLanguage,
  isIndic,
  LANGUAGES,
  normalizeLanguage,
  publicLanguageList,
  voiceSupported,
} from './languages';

const SONIOX_CODES = ['af','sq','ar','az','eu','be','bn','bs','bg','ca','zh','hr','cs','da','nl','en','et','fi','fr','gl','de','el','gu','he','hi','hu','id','it','ja','kn','kk','ko','lv','lt','mk','ms','ml','mr','no','fa','pl','pt','pa','ro','ru','sr','sk','sl','es','sw','sv','tl','ta','te','th','tr','uk','ur','vi','cy'];

describe('languages', () => {
  it('contains every reviewed Soniox code exactly once with a display name', () => {
    expect(LANGUAGES.map((l) => l.code).sort()).toEqual([...SONIOX_CODES].sort());
    for (const language of LANGUAGES) expect(language.name.trim()).not.toBe('');
    expect(new Set(LANGUAGES.map((l) => l.code)).size).toBe(LANGUAGES.length);
  });

  it('represents STT, text translation, speech translation and TTS separately', () => {
    for (const language of LANGUAGES) {
      expect(language.transcriptionSupported).toBe(true);
      expect(language.textTranslationSupported).toBe(true);
      expect(language.speechTranslationSupported).toBe(true);
      expect(language.ttsSupported).toBe(true);
    }
  });

  it('normalizes codes', () => {
    expect(normalizeLanguage('hi-IN')).toBe('hi');
    expect(normalizeLanguage(' EN_us ')).toBe('en');
    expect(normalizeLanguage('tl-PH')).toBe('tl');
    expect(normalizeLanguage('AUTO')).toBe('auto');
    expect(normalizeLanguage('kok-IN')).toBeNull();
    expect(normalizeLanguage('zh-Hans')).toBe('zh');
    expect(normalizeLanguage('xx')).toBeNull();
    expect(normalizeLanguage('')).toBeNull();
    expect(normalizeLanguage('12')).toBeNull();
  });

  it('isIndic / voiceSupported / captionsSupported', () => {
    expect(isIndic('mr-IN')).toBe(true);
    expect(isIndic('en')).toBe(false);
    expect(isIndic('auto')).toBe(false);
    expect(voiceSupported('mr')).toBe(true);
    expect(voiceSupported('es')).toBe(true);
    expect(voiceSupported('ur')).toBe(true);
    expect(voiceSupported('ar')).toBe(true);
    expect(captionsSupported('ur')).toBe(true);
    expect(captionsSupported('tr')).toBe(true);
  });

  it('publicLanguageList has the PROTOCOL shape', () => {
    const list = publicLanguageList();
    expect(list.pairs).toBe(
      'Soniox-supported one-way and two-way language pairs; availability is model-dependent.',
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
      routes: ['soniox'],
      transcriptionSupported: true,
      textTranslationSupported: true,
      speechTranslationSupported: true,
      ttsSupported: true,
    });
    expect(list.languages.find((l) => l.code === 'hi')!.routes).toEqual([
      'soniox',
    ]);
    expect(list.languages.find((l) => l.code === 'ur')).toMatchObject({
      rtl: true,
      voice: true,
      captions: true,
    });
    expect(list.languages.find((l) => l.code === 'es')!.routes).toEqual([
      'soniox',
    ]);
  });
});
