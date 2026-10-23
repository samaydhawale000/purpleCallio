import {
  evaluateGuard,
  GUARD_REASONS,
  LATE_TRANSLATION_MS,
  type GuardSensitivity,
} from './rules';

const levels: GuardSensitivity[] = ['low', 'standard', 'high'];

describe('evaluateGuard', () => {
  it('is ok with no signals', () => {
    for (const l of levels)
      expect(evaluateGuard({ termReasons: [] }, l)).toEqual({
        status: 'ok',
        reasons: [],
      });
  });

  it.each(levels)('hard signals flag at %s sensitivity', (level) => {
    expect(
      evaluateGuard({ termReasons: ['term_mismatch:amount'] }, level),
    ).toEqual({
      status: 'uncertain',
      reasons: ['term_mismatch:amount'],
    });
    expect(
      evaluateGuard({ termReasons: [], recognitionFailed: true }, level).status,
    ).toBe('uncertain');
    expect(
      evaluateGuard({ termReasons: [], providerError: true }, level).reasons,
    ).toEqual(['provider_error']);
  });

  it('uses per-sensitivity ASR confidence thresholds', () => {
    const at = (c: number, l: GuardSensitivity) =>
      evaluateGuard({ termReasons: [], asrConfidence: c }, l).reasons.includes(
        'low_asr_confidence',
      );
    expect(at(0.5, 'low')).toBe(false);
    expect(at(0.39, 'low')).toBe(true);
    expect(at(0.5, 'standard')).toBe(true);
    expect(at(0.6, 'standard')).toBe(false);
    expect(at(0.65, 'high')).toBe(true);
    expect(at(0.75, 'high')).toBe(false);
    expect(
      evaluateGuard({ termReasons: [], asrConfidence: null }, 'high').reasons,
    ).toEqual([]);
    expect(
      evaluateGuard({ termReasons: [], asrConfidence: undefined }, 'high')
        .reasons,
    ).toEqual([]);
  });

  it('needs 3 / 2 / 1 soft signals at low / standard / high', () => {
    const one = { termReasons: [], poorAudio: true };
    const two = { ...one, lateTranslation: true };
    const three = { ...two, languageMismatch: true };
    expect(evaluateGuard(one, 'high').status).toBe('uncertain');
    expect(evaluateGuard(one, 'standard').status).toBe('ok');
    expect(evaluateGuard(two, 'standard').status).toBe('uncertain');
    expect(evaluateGuard(two, 'low').status).toBe('ok');
    expect(evaluateGuard(three, 'low')).toEqual({
      status: 'uncertain',
      reasons: ['language_mismatch', 'poor_audio', 'late_translation'],
    });
  });

  it('defaults to standard and treats unknown sensitivity as standard', () => {
    const two = {
      termReasons: [],
      alternativesDisagree: true,
      lengthMismatch: true,
    };
    expect(evaluateGuard(two).status).toBe('uncertain');
    expect(
      evaluateGuard({ termReasons: [], poorAudio: true }, 'bogus' as never)
        .status,
    ).toBe('ok');
  });

  it('accepts length_mismatch via termReasons, dedupes, drops non-vocabulary', () => {
    const r = evaluateGuard(
      {
        termReasons: [
          'term_mismatch:amount',
          'term_mismatch:amount',
          'length_mismatch',
          'confidence 42%',
          '',
        ],
        lengthMismatch: true,
      },
      'standard',
    );
    expect(r).toEqual({
      status: 'uncertain',
      reasons: ['term_mismatch:amount', 'length_mismatch'],
    });
  });

  it('only ever outputs protocol vocabulary, never numbers or percentages', () => {
    const r = evaluateGuard(
      {
        termReasons: [
          'term_mismatch:number',
          'term_mismatch:date',
          'term_mismatch:phone',
          'term_mismatch:lexicon',
        ],
        recognitionFailed: true,
        providerError: true,
        asrConfidence: 0.1,
        alternativesDisagree: true,
        lengthMismatch: true,
        languageMismatch: true,
        poorAudio: true,
        lateTranslation: true,
      },
      'high',
    );
    expect(r.reasons).toHaveLength(12);
    for (const reason of r.reasons) {
      expect(GUARD_REASONS).toContain(reason);
      expect(reason).not.toMatch(/\d|%/);
    }
  });

  it('exports the late threshold', () => {
    expect(LATE_TRANSLATION_MS).toBe(6000);
  });
});
