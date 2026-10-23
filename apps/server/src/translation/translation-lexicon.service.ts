import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TranslationTermKind } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { LANGUAGE_TAG } from '../ai/dto/validators';
import { listIndustryPacks, findIndustryPack } from './translation-packs';

export const MAX_TERMS_PER_REQUEST = 2000;
export const MAX_TERMS_PER_LEXICON = 5000;
export const MAX_LEXICONS_PER_PROJECT = 50;
export const MAX_CSV_BYTES = 512 * 1024;
const MAX_TERM_LENGTH = 100;
const MAX_TEXT_LENGTH = 200;
const MAX_NAME_LENGTH = 80;
const INDUSTRY_SLUG = /^[a-z][a-z0-9_-]{0,39}$/;

export interface LexiconTermInput {
  term: string;
  kind?: string;
  translations?: Record<string, string> | null;
  pronunciation?: string | null;
  caseSensitive?: boolean;
}

export interface CleanTerm {
  term: string;
  kind: TranslationTermKind;
  translations: Record<string, string> | null;
  pronunciation: string | null;
  caseSensitive: boolean;
}

function bad(message: string): never {
  throw new BadRequestException({
    statusCode: 400,
    code: 'TRANSLATION_INVALID_LEXICON',
    message,
  });
}

function parseKind(raw: unknown, where: string): TranslationTermKind {
  if (raw === undefined || raw === null || raw === '')
    return TranslationTermKind.DO_NOT_TRANSLATE;
  const v = String(raw)
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if ((Object.values(TranslationTermKind) as string[]).includes(v))
    return v as TranslationTermKind;
  bad(
    `${where}: kind must be one of DO_NOT_TRANSLATE, TRANSLATE_AS, PRONOUNCE_AS.`,
  );
}

/** Validates and normalises one PurpleLex term. */
export function cleanTerm(input: unknown, where = 'term'): CleanTerm {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    bad(`${where} must be an object.`);
  const t = input as Record<string, unknown>;
  if (typeof t.term !== 'string' || !t.term.trim())
    bad(`${where}: term is required.`);
  const term = t.term.trim();
  if (term.length > MAX_TERM_LENGTH)
    bad(`${where}: term must be at most ${MAX_TERM_LENGTH} characters.`);
  const kind = parseKind(t.kind, where);

  let translations: Record<string, string> | null = null;
  if (t.translations !== undefined && t.translations !== null) {
    if (typeof t.translations !== 'object' || Array.isArray(t.translations))
      bad(`${where}: translations must map language codes to text.`);
    const entries = Object.entries(t.translations as Record<string, unknown>)
      .map(([k, v]) => [k.trim(), typeof v === 'string' ? v.trim() : v] as const)
      .filter(([, v]) => v !== '');
    for (const [lang, text] of entries) {
      if (!LANGUAGE_TAG.test(lang))
        bad(`${where}: "${lang}" is not a language code.`);
      if (typeof text !== 'string' || text.length > MAX_TEXT_LENGTH)
        bad(
          `${where}: translation for ${lang} must be text of at most ${MAX_TEXT_LENGTH} characters.`,
        );
    }
    translations = entries.length
      ? Object.fromEntries(entries as [string, string][])
      : null;
  }

  let pronunciation: string | null = null;
  if (t.pronunciation !== undefined && t.pronunciation !== null) {
    if (typeof t.pronunciation !== 'string')
      bad(`${where}: pronunciation must be text.`);
    pronunciation = t.pronunciation.trim() || null;
    if (pronunciation && pronunciation.length > MAX_TEXT_LENGTH)
      bad(
        `${where}: pronunciation must be at most ${MAX_TEXT_LENGTH} characters.`,
      );
  }

  if (t.caseSensitive !== undefined && typeof t.caseSensitive !== 'boolean')
    bad(`${where}: caseSensitive must be true or false.`);

  if (kind === TranslationTermKind.TRANSLATE_AS && !translations)
    bad(`${where}: TRANSLATE_AS needs at least one translation.`);
  if (kind === TranslationTermKind.PRONOUNCE_AS && !pronunciation)
    bad(`${where}: PRONOUNCE_AS needs a pronunciation.`);

  return {
    term,
    kind,
    translations,
    pronunciation,
    caseSensitive: (t.caseSensitive as boolean | undefined) ?? false,
  };
}

/** RFC-4180-ish CSV: quoted fields, doubled quotes, CRLF/LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (quoted) bad('CSV has an unterminated quoted field.');
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * CSV import columns: `term,kind,lang:hi,lang:ta,…,pronunciation`
 * (header row required, column order free, `caseSensitive` optional).
 */
export function termsFromCsv(csv: string): CleanTerm[] {
  if (typeof csv !== 'string' || !csv.trim()) bad('csv is required.');
  if (Buffer.byteLength(csv, 'utf8') > MAX_CSV_BYTES)
    bad(`csv must be at most ${MAX_CSV_BYTES / 1024} KB.`);
  const rows = parseCsv(csv.replace(/^﻿/, ''));
  if (rows.length < 2) bad('csv needs a header row and at least one term.');
  const header = rows[0].map((h) => h.trim());
  const termCol = header.findIndex((h) => h.toLowerCase() === 'term');
  if (termCol < 0) bad('csv header must include a "term" column.');
  const kindCol = header.findIndex((h) => h.toLowerCase() === 'kind');
  const pronCol = header.findIndex((h) => h.toLowerCase() === 'pronunciation');
  const caseCol = header.findIndex(
    (h) => h.toLowerCase() === 'casesensitive',
  );
  const langCols: { lang: string; index: number }[] = [];
  header.forEach((h, index) => {
    const m = /^lang:(.+)$/i.exec(h);
    if (!m) return;
    const lang = m[1].trim();
    if (!LANGUAGE_TAG.test(lang))
      bad(`csv column "${h}" is not a language code.`);
    langCols.push({ lang, index });
  });
  const body = rows.slice(1);
  if (body.length > MAX_TERMS_PER_REQUEST)
    bad(`csv can have at most ${MAX_TERMS_PER_REQUEST} terms.`);
  return body.map((r, i) => {
    const translations: Record<string, string> = {};
    for (const { lang, index } of langCols) {
      const v = (r[index] ?? '').trim();
      if (v) translations[lang] = v;
    }
    const cs = caseCol >= 0 ? (r[caseCol] ?? '').trim().toLowerCase() : '';
    return cleanTerm(
      {
        term: r[termCol] ?? '',
        kind: kindCol >= 0 ? r[kindCol] : undefined,
        translations: Object.keys(translations).length ? translations : null,
        pronunciation: pronCol >= 0 ? r[pronCol] : undefined,
        caseSensitive: cs === 'true' || cs === 'yes' || cs === '1',
      },
      `row ${i + 2}`,
    );
  });
}

/** Dedupes by term (last one wins), preserving order. */
function dedupe(terms: CleanTerm[]): CleanTerm[] {
  const map = new Map<string, CleanTerm>();
  for (const t of terms) map.set(t.term, t);
  return [...map.values()];
}

function presentTerm(t: {
  id: string;
  term: string;
  kind: TranslationTermKind;
  translations: Prisma.JsonValue;
  pronunciation: string | null;
  caseSensitive: boolean;
}) {
  return {
    id: t.id,
    term: t.term,
    kind: t.kind,
    translations: (t.translations as Record<string, string> | null) ?? null,
    pronunciation: t.pronunciation,
    caseSensitive: t.caseSensitive,
  };
}

/** PurpleLex: per-project glossaries enforced by the relay. */
@Injectable()
export class TranslationLexiconService {
  constructor(private prisma: PrismaService) {}

  async list(projectId: string) {
    const rows = await this.prisma.translationLexicon.findMany({
      where: { projectId },
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { terms: true } } },
    });
    return rows.map((l) => ({
      id: l.id,
      name: l.name,
      industry: l.industry,
      termCount: l._count.terms,
      createdAt: l.createdAt,
      updatedAt: l.updatedAt,
    }));
  }

  async get(projectId: string, id: string) {
    const lexicon = await this.prisma.translationLexicon.findFirst({
      where: { id, projectId },
      include: { terms: { orderBy: { term: 'asc' } } },
    });
    if (!lexicon)
      throw new NotFoundException({
        statusCode: 404,
        code: 'TRANSLATION_LEXICON_NOT_FOUND',
        message: 'Lexicon not found',
      });
    return {
      id: lexicon.id,
      name: lexicon.name,
      industry: lexicon.industry,
      createdAt: lexicon.createdAt,
      updatedAt: lexicon.updatedAt,
      terms: lexicon.terms.map(presentTerm),
    };
  }

  /** Returns the lexicon id if it belongs to the project, else null. */
  async findOwned(projectId: string, id: string): Promise<string | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const row = await this.prisma.translationLexicon.findFirst({
      where: { id, projectId },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  private async requireOwned(projectId: string, id: string) {
    const owned = await this.findOwned(projectId, id);
    if (!owned)
      throw new NotFoundException({
        statusCode: 404,
        code: 'TRANSLATION_LEXICON_NOT_FOUND',
        message: 'Lexicon not found',
      });
    return owned;
  }

  private cleanName(raw: unknown): string {
    if (typeof raw !== 'string' || !raw.trim()) bad('name is required.');
    const name = raw.trim();
    if (name.length > MAX_NAME_LENGTH)
      bad(`name must be at most ${MAX_NAME_LENGTH} characters.`);
    return name;
  }

  private cleanIndustry(raw: unknown): string | null {
    if (raw === undefined || raw === null || raw === '') return null;
    if (typeof raw !== 'string' || !INDUSTRY_SLUG.test(raw.trim().toLowerCase()))
      bad('industry must be a short lowercase name.');
    return raw.trim().toLowerCase();
  }

  async create(
    projectId: string,
    body: { name?: unknown; industry?: unknown; terms?: unknown },
  ) {
    const name = this.cleanName(body?.name);
    const industry = this.cleanIndustry(body?.industry);
    const terms =
      body?.terms === undefined ? [] : this.cleanTermList(body.terms);
    const count = await this.prisma.translationLexicon.count({
      where: { projectId },
    });
    if (count >= MAX_LEXICONS_PER_PROJECT)
      bad(`A project can have at most ${MAX_LEXICONS_PER_PROJECT} lexicons.`);
    const created = await this.prisma.translationLexicon.create({
      data: {
        projectId,
        name,
        industry,
        terms: terms.length
          ? { create: terms.map((t) => this.termData(t)) }
          : undefined,
      },
    });
    return this.get(projectId, created.id);
  }

  async update(
    projectId: string,
    id: string,
    body: { name?: unknown; industry?: unknown },
  ) {
    await this.requireOwned(projectId, id);
    const data: Prisma.TranslationLexiconUpdateInput = {};
    if (body?.name !== undefined) data.name = this.cleanName(body.name);
    if (body?.industry !== undefined)
      data.industry = this.cleanIndustry(body.industry);
    await this.prisma.translationLexicon.update({ where: { id }, data });
    return this.get(projectId, id);
  }

  async remove(projectId: string, id: string) {
    await this.requireOwned(projectId, id);
    await this.prisma.$transaction([
      // Don't leave the project's default pointing at a deleted lexicon.
      this.prisma.translationSettings.updateMany({
        where: { projectId, defaultLexiconId: id },
        data: { defaultLexiconId: null },
      }),
      this.prisma.translationLexicon.delete({ where: { id } }),
    ]);
    return { deleted: true };
  }

  private cleanTermList(raw: unknown): CleanTerm[] {
    if (!Array.isArray(raw)) bad('terms must be an array.');
    if (raw.length > MAX_TERMS_PER_REQUEST)
      bad(`At most ${MAX_TERMS_PER_REQUEST} terms per request.`);
    return dedupe(raw.map((t, i) => cleanTerm(t, `terms[${i}]`)));
  }

  private termData(t: CleanTerm) {
    return {
      term: t.term,
      kind: t.kind,
      translations: t.translations ?? Prisma.DbNull,
      pronunciation: t.pronunciation,
      caseSensitive: t.caseSensitive,
    };
  }

  /** Bulk upsert by `term` (PUT …/terms). Existing terms not listed are kept. */
  async upsertTerms(projectId: string, id: string, raw: unknown) {
    await this.requireOwned(projectId, id);
    const terms = this.cleanTermList(raw);
    return this.writeTerms(projectId, id, terms);
  }

  async importCsv(projectId: string, id: string, csv: unknown) {
    await this.requireOwned(projectId, id);
    const terms = dedupe(termsFromCsv(csv as string));
    const result = await this.writeTerms(projectId, id, terms);
    return { imported: terms.length, ...result };
  }

  private async writeTerms(projectId: string, id: string, terms: CleanTerm[]) {
    const existing = await this.prisma.translationLexiconTerm.findMany({
      where: { lexiconId: id },
      select: { term: true },
    });
    const known = new Set(existing.map((e) => e.term));
    const added = terms.filter((t) => !known.has(t.term)).length;
    if (existing.length + added > MAX_TERMS_PER_LEXICON)
      bad(`A lexicon can have at most ${MAX_TERMS_PER_LEXICON} terms.`);
    await this.prisma.$transaction(
      terms.map((t) =>
        this.prisma.translationLexiconTerm.upsert({
          where: { lexiconId_term: { lexiconId: id, term: t.term } },
          create: { lexiconId: id, ...this.termData(t) },
          update: this.termData(t),
        }),
      ),
    );
    await this.prisma.translationLexicon.update({
      where: { id },
      data: { updatedAt: new Date() },
    });
    return this.get(projectId, id);
  }

  async deleteTerm(projectId: string, id: string, termId: string) {
    await this.requireOwned(projectId, id);
    const { count } = await this.prisma.translationLexiconTerm.deleteMany({
      where: { id: termId, lexiconId: id },
    });
    if (!count) throw new NotFoundException({
        statusCode: 404,
        code: 'TRANSLATION_TERM_NOT_FOUND',
        message: 'Term not found',
      });
    return { deleted: true };
  }

  /** [{ industry, name, description, termCount }] */
  packs() {
    return listIndustryPacks();
  }

  async fromPack(
    projectId: string,
    body: { industry?: unknown; name?: unknown },
  ) {
    const industry =
      typeof body?.industry === 'string' ? body.industry.trim() : '';
    const pack = findIndustryPack(industry);
    if (!pack)
      throw new NotFoundException({
        statusCode: 404,
        code: 'TRANSLATION_PACK_NOT_FOUND',
        message: `No built-in pack for industry "${industry}".`,
      });
    return this.create(projectId, {
      name: body?.name ?? pack.name,
      industry: pack.industry,
      terms: pack.terms,
    });
  }
}
