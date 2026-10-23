import { TranslationLexiconService, cleanTerm, parseCsv, termsFromCsv } from './translation-lexicon.service';

const ID = '0b6c6a0e-3f0e-4a59-9a8e-0d1f2e3a4b5c';

function setup() {
  const lexicon = { id: ID, name: 'L', industry: null, createdAt: new Date(), updatedAt: new Date(), terms: [] };
  const prisma: any = {
    translationLexicon: {
      findFirst: jest.fn().mockResolvedValue(lexicon),
      findMany: jest.fn().mockResolvedValue([{ ...lexicon, _count: { terms: 3 } }]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockResolvedValue(lexicon),
      update: jest.fn().mockResolvedValue(lexicon),
      delete: jest.fn().mockResolvedValue(lexicon),
    },
    translationLexiconTerm: {
      findMany: jest.fn().mockResolvedValue([]),
      upsert: jest.fn().mockReturnValue('op'),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    translationSettings: { updateMany: jest.fn().mockReturnValue('op') },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  return { prisma, service: new TranslationLexiconService(prisma) };
}

describe('PurpleLex terms', () => {
  it('normalises kinds and requires the right fields', () => {
    expect(cleanTerm({ term: ' MRI ' })).toMatchObject({ term: 'MRI', kind: 'DO_NOT_TRANSLATE', caseSensitive: false });
    expect(cleanTerm({ term: 'bp', kind: 'translate as', translations: { hi: 'रक्तचाप' } }).kind).toBe('TRANSLATE_AS');
    expect(() => cleanTerm({ term: 'x', kind: 'TRANSLATE_AS' })).toThrow();
    expect(() => cleanTerm({ term: 'x', kind: 'PRONOUNCE_AS' })).toThrow();
    expect(() => cleanTerm({ term: 'x', translations: { hindi: 'y' } })).toThrow();
  });

  it('parses quoted CSV', () => {
    expect(parseCsv('a,"b,c","d ""e"""\r\n1,2,3\n')).toEqual([
      ['a', 'b,c', 'd "e"'],
      ['1', '2', '3'],
    ]);
  });

  it('imports term,kind,lang:xx,pronunciation columns', () => {
    const terms = termsFromCsv('term,kind,lang:hi,lang:ta,pronunciation\nEMI,TRANSLATE_AS,किस्त,,\nPurpleCallio,PRONOUNCE_AS,,,purple-call-ee-oh\nKYC,,,,\n');
    expect(terms).toHaveLength(3);
    expect(terms[0]).toMatchObject({ term: 'EMI', translations: { hi: 'किस्त' } });
    expect(terms[1]).toMatchObject({ kind: 'PRONOUNCE_AS', pronunciation: 'purple-call-ee-oh' });
    expect(terms[2].kind).toBe('DO_NOT_TRANSLATE');
    expect(() => termsFromCsv('kind\nx')).toThrow();
  });
});

describe('TranslationLexiconService', () => {
  it('lists with termCount', async () => {
    const { service } = setup();
    expect((await service.list('p1'))[0].termCount).toBe(3);
  });

  it('bulk upserts by term (deduped) and caps the request size', async () => {
    const { service, prisma } = setup();
    await service.upsertTerms('p1', ID, [{ term: 'A' }, { term: 'A', kind: 'PRONOUNCE_AS', pronunciation: 'ay' }, { term: 'B' }]);
    expect(prisma.translationLexiconTerm.upsert).toHaveBeenCalledTimes(2);
    await expect(service.upsertTerms('p1', ID, Array.from({ length: 2001 }, (_, i) => ({ term: `t${i}` })))).rejects.toThrow();
  });

  it('404s for a lexicon of another project', async () => {
    const { service, prisma } = setup();
    prisma.translationLexicon.findFirst.mockResolvedValue(null);
    await expect(service.get('p2', ID)).rejects.toMatchObject({ response: { code: 'TRANSLATION_LEXICON_NOT_FOUND' } });
    await expect(service.upsertTerms('p2', ID, [])).rejects.toMatchObject({ status: 404 });
  });

  it('lists packs and creates a lexicon from one', async () => {
    const { service, prisma } = setup();
    const packs = service.packs();
    expect(packs.length).toBeGreaterThan(0);
    expect(packs[0]).toEqual(expect.objectContaining({ industry: expect.any(String), termCount: expect.any(Number) }));
    expect(packs[0]).not.toHaveProperty('terms');
    await service.fromPack('p1', { industry: 'healthcare' });
    expect(prisma.translationLexicon.create.mock.calls[0][0].data.industry).toBe('healthcare');
    await expect(service.fromPack('p1', { industry: 'mining' })).rejects.toMatchObject({ status: 404 });
  });

  it('clears the project default when deleting', async () => {
    const { service, prisma } = setup();
    await service.remove('p1', ID);
    expect(prisma.translationSettings.updateMany).toHaveBeenCalledWith({
      where: { projectId: 'p1', defaultLexiconId: ID },
      data: { defaultLexiconId: null },
    });
  });
});
