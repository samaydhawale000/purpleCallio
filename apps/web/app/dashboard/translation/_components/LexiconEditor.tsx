'use client';

import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  Lexicon,
  LexiconTerm,
  MAX_TERMS_PER_SAVE,
  TERM_KINDS,
  TermKind,
  checkLexiconCsv,
  deleteLexiconTerm,
  getLexicon,
  importLexiconCsv,
  putLexiconTerms,
  translationErrorText,
} from '../../../lib/translation';
import { buttonCls, inputCls } from '../../_ui';
import { Card, ErrorBox, Loading } from './shared';

interface Row {
  key: string;
  id?: string;
  term: string;
  kind: TermKind;
  translations: Record<string, string>;
  pronunciation: string;
  caseSensitive: boolean;
}

let seq = 0;
const toRow = (t: LexiconTerm): Row => ({
  key: t.id ?? `new-${++seq}`,
  id: t.id,
  term: t.term,
  kind: t.kind,
  translations: { ...(t.translations ?? {}) },
  pronunciation: t.pronunciation ?? '',
  caseSensitive: !!t.caseSensitive,
});

const LANG = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/i;
const cell = 'px-3 py-2 align-top';
const ctl = 'w-full rounded-md border border-[#E4DEEE] bg-white px-2 py-1.5 text-sm text-[#170B2E] outline-none focus:border-[#7F40E8] focus:ring-2 focus:ring-[#7F40E8]/15';

/** Validates rows and builds the bulk-upsert body, or returns an error message. */
export function rowsToTerms(rows: Row[]): LexiconTerm[] | string {
  const filled = rows.filter((r) => r.term.trim());
  if (filled.length > MAX_TERMS_PER_SAVE) return `A lexicon can hold up to ${MAX_TERMS_PER_SAVE} terms per save.`;
  const seen = new Set<string>();
  for (const r of filled) {
    const k = r.caseSensitive ? r.term.trim() : r.term.trim().toLowerCase();
    if (seen.has(k)) return `"${r.term.trim()}" is listed twice.`;
    seen.add(k);
    if (r.kind === 'TRANSLATE_AS' && !Object.values(r.translations).some((v) => v.trim())) {
      return `Add at least one translation for "${r.term.trim()}".`;
    }
    if (r.kind === 'PRONOUNCE_AS' && !r.pronunciation.trim()) return `Add how "${r.term.trim()}" should be pronounced.`;
  }
  return filled.map((r) => {
    const out: LexiconTerm = { term: r.term.trim(), kind: r.kind, caseSensitive: r.caseSensitive };
    if (r.kind === 'TRANSLATE_AS') {
      out.translations = Object.fromEntries(Object.entries(r.translations).filter(([, v]) => v.trim()).map(([l, v]) => [l, v.trim()]));
    }
    if (r.kind === 'PRONOUNCE_AS') out.pronunciation = r.pronunciation.trim();
    return out;
  });
}

export function LexiconEditor({
  projectId,
  lexicon,
  onCountChange,
}: {
  projectId: string;
  lexicon: Lexicon;
  onCountChange: (n: number) => void;
}) {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [languages, setLanguages] = useState<string[]>([]);
  const [newLang, setNewLang] = useState('');
  const [loadError, setLoadError] = useState('');
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [csv, setCsv] = useState('');
  const [csvOpen, setCsvOpen] = useState(false);
  const [csvError, setCsvError] = useState('');
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    setLoadError('');
    getLexicon(projectId, lexicon.id)
      .then((l) => {
        const terms = l.terms ?? [];
        setRows(terms.map(toRow));
        const langs = new Set<string>();
        terms.forEach((t) => Object.keys(t.translations ?? {}).forEach((k) => langs.add(k)));
        setLanguages([...langs].sort());
        onCountChange(terms.length);
      })
      .catch((e) => setLoadError(translationErrorText(e, 'Could not load the terms. Please try again.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, lexicon.id]);

  useEffect(load, [load]);

  const update = (key: string, patch: Partial<Row>) => {
    setSaved(false);
    setRows((prev) => (prev ?? []).map((r) => (r.key === key ? { ...r, ...patch } : r)));
  };

  const addRow = () => {
    setSaved(false);
    setRows((prev) => [...(prev ?? []), toRow({ term: '', kind: 'DO_NOT_TRANSLATE' })]);
  };

  const addLanguage = () => {
    const code = newLang.trim().toLowerCase();
    if (!LANG.test(code)) return setError('Enter a language code such as hi, ta or en-IN.');
    setError('');
    if (!languages.includes(code)) setLanguages([...languages, code]);
    setNewLang('');
  };

  const removeRow = async (row: Row) => {
    setError('');
    if (row.id) {
      try {
        await deleteLexiconTerm(projectId, lexicon.id, row.id);
      } catch (e) {
        return setError(translationErrorText(e, `Could not delete "${row.term}". Please try again.`));
      }
    }
    setRows((prev) => {
      const next = (prev ?? []).filter((r) => r.key !== row.key);
      onCountChange(next.filter((r) => r.id).length);
      return next;
    });
  };

  const save = async () => {
    if (!rows) return;
    setError('');
    const terms = rowsToTerms(rows);
    if (typeof terms === 'string') return setError(terms);
    setSaving(true);
    try {
      await putLexiconTerms(projectId, lexicon.id, terms);
      setSaved(true);
      load();
    } catch (e) {
      setError(translationErrorText(e, 'Could not save the terms. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    file.text().then(setCsv).catch(() => setCsvError('Could not read that file.'));
  };

  const importCsv = async () => {
    setCsvError('');
    const check = checkLexiconCsv(csv);
    if ('error' in check) return setCsvError(check.error);
    setImporting(true);
    try {
      await importLexiconCsv(projectId, lexicon.id, csv);
      setCsv('');
      setCsvOpen(false);
      load();
    } catch (e) {
      setCsvError(translationErrorText(e, 'Could not import the CSV. Check the format and try again.'));
    } finally {
      setImporting(false);
    }
  };

  const csvCheck = csv.trim() ? checkLexiconCsv(csv) : null;

  return (
    <Card
      title={lexicon.name}
      subtitle={`ID ${lexicon.id} · pass it as translation.lexiconId`}
      actions={
        <>
          <button type="button" className={buttonCls('secondary', 'px-3 py-1.5')} onClick={() => setCsvOpen((o) => !o)}>
            Import CSV
          </button>
          <button type="button" className={buttonCls('secondary', 'px-3 py-1.5')} onClick={addRow}>
            Add term
          </button>
        </>
      }
    >
      {csvOpen && (
        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-[#ECE8F2] bg-white p-4">
          <p className="text-xs text-[#6B6478]">
            Columns: <code className="font-mono">term,kind,lang:hi,lang:ta,…,pronunciation</code>. Kind is DO_NOT_TRANSLATE, TRANSLATE_AS or
            PRONOUNCE_AS. Existing terms with the same name are updated.
          </p>
          <label htmlFor="lexicon-csv" className="text-[13px] font-medium text-[#170B2E]">Paste CSV</label>
          <textarea
            id="lexicon-csv"
            rows={5}
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            placeholder={'term,kind,lang:hi,pronunciation\nPurpleCallio,DO_NOT_TRANSLATE,,\ninvoice,TRANSLATE_AS,चालान,'}
            className={`${inputCls} font-mono`}
          />
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-[13px] text-[#6B6478]">
              <span>Or upload a .csv file</span>
              <input type="file" accept=".csv,text/csv" onChange={onFile} className="ml-2 text-xs" aria-label="Upload CSV file" />
            </label>
          </div>
          {csvCheck && !('error' in csvCheck) && (
            <p className="text-xs text-[#6B6478]">
              {csvCheck.rows} terms{csvCheck.languages.length ? ` · languages: ${csvCheck.languages.join(', ')}` : ''}
            </p>
          )}
          {csvError && <p role="alert" className="text-sm text-red-600">{csvError}</p>}
          <div className="flex gap-2">
            <button type="button" className={buttonCls('primary', 'px-3 py-1.5')} onClick={importCsv} disabled={importing || !csv.trim()}>
              Import terms
            </button>
            <button type="button" className={buttonCls('ghost', 'px-3 py-1.5')} onClick={() => setCsvOpen(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loadError ? (
        <ErrorBox onRetry={load}>{loadError}</ErrorBox>
      ) : !rows ? (
        <Loading label="Loading terms…" />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2 mb-3">
            <div className="flex flex-col gap-1">
              <label htmlFor="new-lang" className="text-[13px] font-medium text-[#170B2E]">Add a translation language</label>
              <input
                id="new-lang"
                value={newLang}
                onChange={(e) => setNewLang(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addLanguage()}
                placeholder="e.g. hi"
                className={`${ctl} w-28`}
              />
            </div>
            <button type="button" className={buttonCls('secondary', 'px-3 py-1.5')} onClick={addLanguage}>
              Add language
            </button>
            {languages.length > 0 && <span className="text-xs text-[#6B6478] pb-1.5">Columns: {languages.join(', ')}</span>}
          </div>

          {rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[#E4DEEE] py-8 text-center text-sm text-[#6B6478]">No terms yet. Add a term or import a CSV.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-[#ECE8F2] bg-white">
              <table className="w-full text-sm" aria-label="Lexicon terms">
                <thead>
                  <tr className="border-b border-[#ECE8F2] text-left text-xs uppercase tracking-wide text-[#6B6478]">
                    <th className="px-3 py-2.5 font-medium">Term</th>
                    <th className="px-3 py-2.5 font-medium">Rule</th>
                    {languages.map((l) => (
                      <th key={l} className="px-3 py-2.5 font-medium font-mono">{l}</th>
                    ))}
                    <th className="px-3 py-2.5 font-medium">Pronunciation</th>
                    <th className="px-3 py-2.5 font-medium">Match case</th>
                    <th className="px-3 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const name = r.term.trim() || `row ${i + 1}`;
                    return (
                      <tr key={r.key} className="border-b border-[#F2EFF6] last:border-0">
                        <td className={cell}>
                          <input aria-label={`Term ${i + 1}`} className={`${ctl} min-w-[140px]`} value={r.term} onChange={(e) => update(r.key, { term: e.target.value })} />
                        </td>
                        <td className={cell}>
                          <select aria-label={`Rule for ${name}`} className={ctl} value={r.kind} onChange={(e) => update(r.key, { kind: e.target.value as TermKind })}>
                            {TERM_KINDS.map((k) => (
                              <option key={k.id} value={k.id}>{k.label}</option>
                            ))}
                          </select>
                        </td>
                        {languages.map((l) => (
                          <td key={l} className={cell}>
                            <input
                              aria-label={`${name} in ${l}`}
                              disabled={r.kind !== 'TRANSLATE_AS'}
                              className={`${ctl} min-w-[110px] disabled:opacity-40`}
                              value={r.translations[l] ?? ''}
                              onChange={(e) => update(r.key, { translations: { ...r.translations, [l]: e.target.value } })}
                            />
                          </td>
                        ))}
                        <td className={cell}>
                          <input
                            aria-label={`Pronunciation of ${name}`}
                            disabled={r.kind !== 'PRONOUNCE_AS'}
                            className={`${ctl} min-w-[120px] disabled:opacity-40`}
                            value={r.pronunciation}
                            onChange={(e) => update(r.key, { pronunciation: e.target.value })}
                          />
                        </td>
                        <td className={`${cell} text-center`}>
                          <input
                            type="checkbox"
                            aria-label={`Match case for ${name}`}
                            checked={r.caseSensitive}
                            onChange={(e) => update(r.key, { caseSensitive: e.target.checked })}
                            className="mt-2 accent-[#6D28D9]"
                          />
                        </td>
                        <td className={cell}>
                          <button
                            onClick={() => removeRow(r)}
                            aria-label={`Remove ${name}`}
                            className="rounded-md p-1.5 text-[#6B6478] hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <p className="mt-3 text-xs text-[#6B6478]">
            {TERM_KINDS.map((k) => `${k.label}: ${k.hint}`).join(' ')}
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-4">
            <button type="button" className={buttonCls('primary')} onClick={save} disabled={saving}>
              Save terms
            </button>
            {saved && <span role="status" className="text-sm text-emerald-700">Terms saved</span>}
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
          </div>
        </>
      )}
    </Card>
  );
}
