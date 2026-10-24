import { checkTranslation, visibleLength } from './check';

const base = { sourceLanguage: 'en', targetLanguage: 'hi' };

describe('checkTranslation', () => {
  it('passes a correct translation with no reasons', () => {
    expect(
      checkTranslation({
        ...base,
        source:
          'Your EMI of ₹12,500 is due on 22/10/2026 at 10:30 am. Call 98765 43210.',
        translated:
          'आपकी ₹12,500 की EMI 22 अक्टूबर 2026 को सुबह 10:30 बजे देय है। 98765 43210 पर कॉल करें।',
        lexicon: [{ term: 'EMI', kind: 'DO_NOT_TRANSLATE' }],
      }),
    ).toEqual({ reasons: [], lexiconHits: 1 });
  });

  it('accepts Indian amount wordings on either side', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'The loan is ₹2,50,000 total',
        translated: 'लोन कुल 2.5 लाख रुपये का है',
      }).reasons,
    ).toEqual([]);
    expect(
      checkTranslation({
        sourceLanguage: 'mr',
        targetLanguage: 'en',
        source: 'फ्लॅटची किंमत १.२ कोटी आहे',
        translated: 'The flat costs 1.2 crore',
      }).reasons,
    ).toEqual([]);
  });

  it('flags a dropped amount', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'Please pay ₹2,50,000 today',
        translated: 'कृपया आज भुगतान करें',
      }).reasons,
    ).toContain('term_mismatch:amount');
  });

  it('flags a changed amount', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'Please pay 2.5 lakh today',
        translated: 'कृपया आज 25 लाख का भुगतान करें',
      }).reasons,
    ).toEqual(['term_mismatch:amount']);
  });

  it('does not flag an amount whose currency word was dropped', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'Pay Rs 500 now',
        translated: 'अभी 500 दें',
      }).reasons,
    ).toEqual([]);
  });

  it('flags changed numbers, dates, times and phones', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'Take 40 tablets',
        translated: 'चालीस नहीं, 14 गोलियाँ लें',
      }).reasons,
    ).toEqual(['term_mismatch:number']);
    expect(
      checkTranslation({
        ...base,
        source: 'Come on 22 Oct',
        translated: '23 अक्टूबर को आइए',
      }).reasons,
    ).toEqual(['term_mismatch:date']);
    expect(
      checkTranslation({
        ...base,
        source: 'Come at 10:30',
        translated: '11:30 बजे आइए',
      }).reasons,
    ).toEqual(['term_mismatch:date']);
    expect(
      checkTranslation({
        ...base,
        source: 'Call 9876543210',
        translated: '9876543201 पर कॉल करें',
      }).reasons,
    ).toEqual(['term_mismatch:phone']);
  });

  it('treats implicit meridiem as the same time', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'Meet at 5 pm',
        translated: 'शाम 5 बजे मिलें',
      }).reasons,
    ).toEqual([]);
  });

  it('accepts small numbers written as words', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'I have 2 kids',
        translated: 'मेरे दो बच्चे हैं',
      }).reasons,
    ).toEqual([]);
    expect(
      checkTranslation({
        sourceLanguage: 'hi',
        targetLanguage: 'en',
        source: 'मेरे 3 बच्चे हैं',
        translated: 'I have three kids',
      }).reasons,
    ).toEqual([]);
  });

  it('accepts a date whose month name is in an unrecognised script when day and year survive', () => {
    expect(
      checkTranslation({
        ...base,
        targetLanguage: 'xx',
        source: 'Due 22 Oct 2026',
        translated: 'Zzz 22 qqq 2026',
      }).reasons,
    ).toEqual([]);
  });

  it('flags missing lexicon terms', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'Complete your KYC',
        translated: 'अपना केवाईसी पूरा करें',
        lexicon: [{ term: 'KYC', kind: 'DO_NOT_TRANSLATE' }],
      }),
    ).toEqual({ reasons: ['term_mismatch:lexicon'], lexiconHits: 0 });
  });

  it('flags implausible length ratios only for long enough sources', () => {
    expect(
      checkTranslation({
        ...base,
        source: 'Please describe all your symptoms in detail',
        translated: 'हाँ',
      }).reasons,
    ).toEqual(['length_mismatch']);
    expect(
      checkTranslation({
        ...base,
        source: 'Please describe all your symptoms in detail',
        translated: '',
      }).reasons,
    ).toEqual(['length_mismatch']);
    expect(
      checkTranslation({
        ...base,
        source: 'Yes',
        translated: 'जी हाँ, बिल्कुल सही बात है आपकी',
      }).reasons,
    ).toEqual([]);
    expect(
      checkTranslation({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        source: 'Thank you very much',
        translated: 'ありがとう',
      }).reasons,
    ).toEqual([]);
  });

  it('deduplicates reasons and never contains numbers or percentages', () => {
    const r = checkTranslation({
      ...base,
      source: 'Pay ₹500 and ₹700 by 22 Oct, 15% fee',
      translated: 'भुगतान करें',
    });
    expect(r.reasons).toEqual([
      'term_mismatch:number',
      'term_mismatch:amount',
      'term_mismatch:date',
    ]);
    for (const reason of r.reasons) expect(reason).not.toMatch(/\d|%/);
  });

  it('handles empty strings', () => {
    expect(checkTranslation({ ...base, source: '', translated: '' })).toEqual({
      reasons: [],
      lexiconHits: 0,
    });
  });
});

describe('visibleLength', () => {
  it('ignores marks, spaces and punctuation; weights CJK', () => {
    expect(visibleLength('a b, c!')).toBe(3);
    expect(visibleLength('किताब')).toBe(3);
    expect(visibleLength('漢字')).toBe(6);
  });
});
