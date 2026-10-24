import {
  applyLexicon,
  lexiconHints,
  translationFor,
  type LexiconTerm,
} from './lexicon-correct';

const lexicon: LexiconTerm[] = [
  { term: 'PurpleCallio', kind: 'DO_NOT_TRANSLATE', caseSensitive: true },
  { term: 'EMI', kind: 'DO_NOT_TRANSLATE' },
  {
    term: 'Kubernetes',
    kind: 'DO_NOT_TRANSLATE',
    translations: { hi: 'कुबेरनेट्स' },
  },
  {
    term: 'blood pressure',
    kind: 'TRANSLATE_AS',
    translations: { hi: 'रक्तचाप', mr: 'रक्तदाब' },
  },
  { term: 'Nguyen', kind: 'PRONOUNCE_AS', pronunciation: 'win' },
  { term: 'pods', kind: 'TRANSLATE_AS', translations: {} },
];

describe('applyLexicon', () => {
  it('verifies DO_NOT_TRANSLATE terms that were kept', () => {
    const r = applyLexicon({
      source: 'Your EMI on PurpleCallio is due',
      translated: 'PurpleCallio पर आपकी EMI बाकी है',
      targetLanguage: 'hi',
      lexicon,
    });
    expect(r.text).toBe('PurpleCallio पर आपकी EMI बाकी है');
    expect(r.applied.sort()).toEqual(['EMI', 'PurpleCallio']);
    expect(r.missing).toEqual([]);
  });

  it('restores the casing of a case-sensitive term', () => {
    const r = applyLexicon({
      source: 'Welcome to PurpleCallio',
      translated: 'purplecallio में आपका स्वागत है',
      targetLanguage: 'hi',
      lexicon,
    });
    expect(r.text).toBe('PurpleCallio में आपका स्वागत है');
    expect(r.applied).toEqual(['PurpleCallio']);
  });

  it('restores a DO_NOT_TRANSLATE term from a known literal rendering', () => {
    const r = applyLexicon({
      source: 'Restart the Kubernetes cluster',
      translated: 'कुबेरनेट्स क्लस्टर को रीस्टार्ट करें',
      targetLanguage: 'hi-IN',
      lexicon,
    });
    expect(r.text).toBe('Kubernetes क्लस्टर को रीस्टार्ट करें');
    expect(r.applied).toEqual(['Kubernetes']);
    expect(r.missing).toEqual([]);
  });

  it('reports a DO_NOT_TRANSLATE term it cannot find, without inventing text', () => {
    const r = applyLexicon({
      source: 'Your EMI is due',
      translated: 'आपकी किस्त बाकी है',
      targetLanguage: 'hi',
      lexicon,
    });
    expect(r.text).toBe('आपकी किस्त बाकी है');
    expect(r.missing).toEqual(['EMI']);
    expect(r.applied).toEqual([]);
  });

  it('enforces TRANSLATE_AS by replacing the untranslated source term', () => {
    const r = applyLexicon({
      source: 'Check your blood pressure daily',
      translated: 'रोज़ अपना blood pressure जाँचें',
      targetLanguage: 'hi',
      lexicon,
    });
    expect(r.text).toBe('रोज़ अपना रक्तचाप जाँचें');
    expect(r.applied).toEqual(['blood pressure']);
  });

  it('verifies TRANSLATE_AS and reports when another word was used', () => {
    expect(
      applyLexicon({
        source: 'Blood pressure is high',
        translated: 'रक्तदाब जास्त आहे',
        targetLanguage: 'mr',
        lexicon,
      }),
    ).toEqual({
      text: 'रक्तदाब जास्त आहे',
      applied: ['blood pressure'],
      missing: [],
    });
    expect(
      applyLexicon({
        source: 'Blood pressure is high',
        translated: 'बीपी ज़्यादा है',
        targetLanguage: 'hi',
        lexicon,
      }).missing,
    ).toEqual(['blood pressure']);
  });

  it('skips TRANSLATE_AS without an agreed form and PRONOUNCE_AS that is not visible', () => {
    const r = applyLexicon({
      source: 'Nguyen restarted the pods',
      translated: 'न्गुयेन ने पॉड्स रीस्टार्ट किए',
      targetLanguage: 'hi',
      lexicon,
    });
    expect(r.applied).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('ignores terms not present in the source and respects word boundaries', () => {
    const r = applyLexicon({
      source: 'EMIRATES flight is late', // "EMI" is not a word here
      translated: 'उड़ान लेट है',
      targetLanguage: 'hi',
      lexicon,
    });
    expect(r).toEqual({ text: 'उड़ान लेट है', applied: [], missing: [] });
  });

  it('matches Indic-script terms by substring', () => {
    const r = applyLexicon({
      source: 'आयुष्मान कार्ड लाओ',
      translated: 'Bring the card',
      targetLanguage: 'en',
      lexicon: [
        {
          term: 'आयुष्मान',
          kind: 'DO_NOT_TRANSLATE',
          translations: { en: 'Ayushman' },
        },
      ],
    });
    expect(r.text).toBe('Bring the card');
    expect(r.missing).toEqual(['आयुष्मान']);
  });

  it('copes with empty input and junk entries', () => {
    expect(
      applyLexicon({
        source: '',
        translated: '',
        targetLanguage: 'hi',
        lexicon: [{ term: '  ', kind: 'DO_NOT_TRANSLATE' }],
      }),
    ).toEqual({ text: '', applied: [], missing: [] });
  });
});

describe('translationFor', () => {
  it('falls back to the base language', () => {
    expect(translationFor(lexicon[3], 'hi-IN')).toBe('रक्तचाप');
    expect(translationFor(lexicon[3], 'ta')).toBeNull();
    expect(
      translationFor(
        { term: 'x', kind: 'TRANSLATE_AS', translations: { 'hi-IN': 'य' } },
        'hi',
      ),
    ).toBe('य');
  });
});

describe('lexiconHints', () => {
  it('maps terms to provider hints for one target language', () => {
    expect(lexiconHints(lexicon, 'hi')).toEqual(
      expect.arrayContaining([
        { term: 'PurpleCallio', kind: 'DO_NOT_TRANSLATE' },
        { term: 'EMI', kind: 'DO_NOT_TRANSLATE' },
        { term: 'Kubernetes', kind: 'DO_NOT_TRANSLATE' },
        {
          term: 'blood pressure',
          kind: 'TRANSLATE_AS',
          translation: 'रक्तचाप',
        },
        { term: 'Nguyen', kind: 'PRONOUNCE_AS', pronunciation: 'win' },
      ]),
    );
    expect(lexiconHints(lexicon, 'hi')).toHaveLength(5);
    expect(
      lexiconHints(lexicon, 'ta').some((h) => h.kind === 'TRANSLATE_AS'),
    ).toBe(false);
    expect(lexiconHints(null, 'hi')).toEqual([]);
  });
});
