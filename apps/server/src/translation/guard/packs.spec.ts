import * as guard from './index';
import { INDUSTRY_PACKS } from './packs';

describe('INDUSTRY_PACKS', () => {
  it('has one pack per industry with 25–40 well-formed terms', () => {
    expect(INDUSTRY_PACKS.map((p) => p.industry).sort()).toEqual([
      'ecommerce',
      'finance',
      'healthcare',
      'legal',
      'saas',
    ]);
    for (const pack of INDUSTRY_PACKS) {
      expect(pack.name).toBeTruthy();
      expect(pack.description).toBeTruthy();
      expect(pack.terms.length).toBeGreaterThanOrEqual(25);
      expect(pack.terms.length).toBeLessThanOrEqual(40);
      const names = pack.terms.map((t) => t.term.toLowerCase());
      expect(new Set(names).size).toBe(names.length);
      for (const t of pack.terms) {
        expect(t.term.trim()).toBe(t.term);
        expect(['DO_NOT_TRANSLATE', 'TRANSLATE_AS', 'PRONOUNCE_AS']).toContain(
          t.kind,
        );
        if (t.kind === 'TRANSLATE_AS')
          expect(Object.keys(t.translations ?? {}).length).toBeGreaterThan(0);
      }
    }
  });

  it('includes the core acronyms', () => {
    const all = INDUSTRY_PACKS.flatMap((p) => p.terms.map((t) => t.term));
    for (const t of [
      'MRI',
      'ECG',
      'CT scan',
      'HbA1c',
      'EMI',
      'KYC',
      'GST',
      'UPI',
      'NEFT',
      'IFSC',
      'SLA',
      'API',
      'SDK',
      'Kubernetes',
      'COD',
      'RTO',
    ]) {
      expect(all).toContain(t);
    }
  });

  it('packs produce provider hints', () => {
    const hints = guard.lexiconHints(INDUSTRY_PACKS[0].terms, 'hi');
    expect(
      hints.some(
        (h) => h.kind === 'TRANSLATE_AS' && h.translation === 'रक्तचाप',
      ),
    ).toBe(true);
  });
});

describe('guard index', () => {
  it('re-exports the public API', () => {
    for (const name of [
      'extractEntities',
      'applyLexicon',
      'lexiconHints',
      'checkTranslation',
      'analyzePcm16',
      'isPoorAudio',
      'PhraseAudioStats',
      'evaluateGuard',
      'ReplayBuffer',
      'repeatPrompt',
      'limitMessage',
      'uncertainLabel',
    ]) {
      expect(typeof (guard as Record<string, unknown>)[name]).toBe('function');
    }
    expect(guard.LATE_TRANSLATION_MS).toBe(6000);
    expect(Array.isArray(guard.INDUSTRY_PACKS)).toBe(true);
  });
});
