import {
  limitMessage,
  repeatPrompt,
  truncateOriginal,
  uncertainLabel,
} from './prompts';

const REPEAT_LANGS = [
  'en',
  'hi',
  'mr',
  'ta',
  'te',
  'bn',
  'gu',
  'kn',
  'ml',
  'pa',
  'or',
  'ur',
  'as',
  'es',
  'fr',
  'de',
  'pt',
  'ar',
  'ja',
  'zh',
];

describe('repeatPrompt', () => {
  it('formats English', () => {
    expect(repeatPrompt('en', 'Pay 500 today')).toBe(
      'They didn’t catch: “Pay 500 today” — please repeat.',
    );
  });

  it.each(REPEAT_LANGS)(
    'is localised for %s and embeds the original',
    (lang) => {
      const p = repeatPrompt(lang, 'ORIGINAL');
      expect(p).toContain('ORIGINAL');
      if (lang !== 'en') expect(p).not.toBe(repeatPrompt('en', 'ORIGINAL'));
    },
  );

  it('uses the base language and falls back to English', () => {
    expect(repeatPrompt('hi-IN', 'x')).toBe(repeatPrompt('hi', 'x'));
    expect(repeatPrompt('sw', 'x')).toBe(repeatPrompt('en', 'x'));
    expect(repeatPrompt('', 'x')).toBe(repeatPrompt('en', 'x'));
  });

  it('truncates long originals to about 120 characters', () => {
    const long = 'word '.repeat(60);
    const t = truncateOriginal(long);
    expect([...t].length).toBeLessThanOrEqual(120);
    expect(t.endsWith('…')).toBe(true);
    expect(repeatPrompt('en', long)).toContain(t);
    expect(truncateOriginal('  short   text ')).toBe('short text');
    expect([...truncateOriginal('क'.repeat(300))].length).toBe(120);
  });

  it('does not interpret $ patterns in the original', () => {
    expect(repeatPrompt('en', 'cost $& $1')).toContain('cost $& $1');
  });
});

describe('limitMessage', () => {
  it('returns the English messages', () => {
    expect(limitMessage('en', 'warning')).toBe(
      'Translation ends in about 1 minute',
    );
    expect(limitMessage('en', 'warning', 50)).toBe(
      'Translation ends in about 1 minute',
    );
    expect(limitMessage('en', 'warning', 180)).toBe(
      'Translation ends in about 3 minutes',
    );
    expect(limitMessage('en', 'stepped_down')).toBe(
      'Translation switched to captions to stay within the limit',
    );
    expect(limitMessage('en', 'paused')).toBe(
      'Translation paused — limit reached. The call continues.',
    );
  });

  it.each(['hi', 'mr', 'ta', 'te', 'bn'])('is localised for %s', (lang) => {
    for (const kind of ['warning', 'stepped_down', 'paused'] as const) {
      expect(limitMessage(lang, kind)).not.toBe(limitMessage('en', kind));
    }
    expect(limitMessage(lang, 'warning', 240)).toContain('4');
  });

  it('falls back to English', () => {
    expect(limitMessage('xx', 'paused')).toBe(limitMessage('en', 'paused'));
  });
});

describe('uncertainLabel', () => {
  it('localises and falls back', () => {
    expect(uncertainLabel('en')).toBe('May not be accurate — check');
    for (const lang of ['hi', 'mr', 'ta', 'te', 'bn'])
      expect(uncertainLabel(lang)).not.toBe(uncertainLabel('en'));
    expect(uncertainLabel('mr-IN')).toBe(uncertainLabel('mr'));
    expect(uncertainLabel('xx')).toBe(uncertainLabel('en'));
  });
});
