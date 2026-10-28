'use client';

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import {
  INDUSTRIES,
  Lexicon,
  LexiconPack,
  createLexicon,
  createLexiconFromPack,
  deleteLexicon,
  industryLabel,
  lexiconTermCount,
  listLexiconPacks,
  listLexicons,
  translationErrorText,
} from '../../../lib/translation';
import { buttonCls, inputCls } from '../../_ui';
import {
  Card,
  Empty,
  ErrorBox,
  Loading,
  NoProjects,
  PageHeader,
  ProjectPicker,
  TranslationNav,
  selectCls,
  useProjects,
} from '../_components/shared';
import { LexiconEditor } from '../_components/LexiconEditor';

/** PurpleLex: per-project glossaries enforced during translation. */
export default function LexiconsPage() {
  const { projects, projectId, setProjectId, error: projectsError, loading: projectsLoading } = useProjects();
  const [lexicons, setLexicons] = useState<Lexicon[] | null>(null);
  const [packs, setPacks] = useState<LexiconPack[]>([]);
  const [loadError, setLoadError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    if (!projectId) return;
    setLexicons(null);
    setLoadError('');
    setSelected(null);
    listLexicons(projectId)
      .then((l) => setLexicons(Array.isArray(l) ? l : []))
      .catch((e) => setLoadError(translationErrorText(e, 'Could not load lexicons. Please try again.')));
    listLexiconPacks(projectId)
      .then((p) => setPacks(Array.isArray(p) ? p : []))
      .catch(() => setPacks([]));
  }, [projectId]);

  useEffect(load, [load]);

  const added = (lex: Lexicon) => {
    setLexicons((prev) => [lex, ...(prev ?? []).filter((l) => l.id !== lex.id)]);
    setSelected(lex.id);
  };

  const create = async () => {
    if (!name.trim()) return;
    setBusy('create');
    setError('');
    try {
      added(await createLexicon(projectId, { name: name.trim(), industry: industry || null }));
      setShowNew(false);
      setName('');
      setIndustry('');
    } catch (e) {
      setError(translationErrorText(e, 'Could not create the lexicon. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const fromPack = async (pack: LexiconPack) => {
    setBusy(`pack:${pack.industry}`);
    setError('');
    try {
      added(await createLexiconFromPack(projectId, { industry: pack.industry }));
    } catch (e) {
      setError(translationErrorText(e, 'Could not create a lexicon from that pack. Please try again.'));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (lex: Lexicon) => {
    if (!confirm(`Delete lexicon "${lex.name}" and all its terms? Calls that use it will translate without it.`)) return;
    setBusy(`del:${lex.id}`);
    setError('');
    try {
      await deleteLexicon(projectId, lex.id);
      setLexicons((prev) => (prev ?? []).filter((l) => l.id !== lex.id));
      if (selected === lex.id) setSelected(null);
    } catch (e) {
      setError(translationErrorText(e, `Could not delete "${lex.name}". Please try again.`));
    } finally {
      setBusy(null);
    }
  };

  const current = lexicons?.find((l) => l.id === selected) ?? null;

  const newButton = (
    <button type="button" className={buttonCls('primary')} onClick={() => setShowNew(true)}>
      New lexicon
    </button>
  );

  return (
    <>
      <PageHeader
        title="Lexicons"
        subtitle="Names, product terms and approved translations that every translated call must respect."
        actions={
          projects && projects.length > 0 ? (
            <>
              <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
              {newButton}
            </>
          ) : undefined
        }
      />
      <TranslationNav />

      {projectsLoading ? (
        <Loading label="Loading projects…" />
      ) : projectsError ? (
        <ErrorBox>Could not load your projects. Please refresh the page.</ErrorBox>
      ) : !projects?.length ? (
        <NoProjects />
      ) : loadError ? (
        <ErrorBox onRetry={load}>{loadError}</ErrorBox>
      ) : !lexicons ? (
        <Loading label="Loading lexicons…" />
      ) : (
        <div className="flex flex-col gap-6">
          {error && <ErrorBox>{error}</ErrorBox>}

          {showNew && (
            <Card title="New lexicon">
              <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="new-lex-name" className="text-[13px] font-medium text-[#170B2E]">Lexicon name</label>
                  <input
                    id="new-lex-name"
                    className={inputCls}
                    placeholder="e.g. Clinic terms"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="new-lex-industry" className="text-[13px] font-medium text-[#170B2E]">Industry (optional)</label>
                  <select id="new-lex-industry" className={selectCls} value={industry} onChange={(e) => setIndustry(e.target.value)}>
                    <option value="">Not set</option>
                    {INDUSTRIES.map((i) => (
                      <option key={i.id} value={i.id}>{i.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button type="button" className={buttonCls('primary')} onClick={create} disabled={busy === 'create' || !name.trim()}>
                  Create lexicon
                </button>
                <button type="button" className={buttonCls('ghost')} onClick={() => setShowNew(false)}>Cancel</button>
              </div>
            </Card>
          )}

          {packs.length > 0 && (
            <Card title="Start from an industry pack" subtitle="A ready-made lexicon copied into this project, which you can then edit.">
              <ul className="overflow-hidden rounded-lg border border-[#ECE8F2] bg-white">
                {packs.map((p) => {
                  const label = p.name ?? industryLabel(p.industry);
                  const count = p.termCount ?? p.terms?.length;
                  return (
                    <li key={p.industry} className="flex flex-wrap items-center gap-3 border-b border-[#F2EFF6] px-4 py-3 last:border-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[#170B2E]">{label}</p>
                        {(p.description || count != null) && (
                          <p className="text-xs text-[#6B6478]">
                            {[p.description, count != null ? `${count} terms` : null].filter(Boolean).join(' · ')}
                          </p>
                        )}
                      </div>
                      <button
                        type="button"
                        className={buttonCls('secondary', 'px-3 py-1.5')}
                        disabled={busy === `pack:${p.industry}`}
                        onClick={() => fromPack(p)}
                        aria-label={`Use the ${label} pack`}
                      >
                        Use this pack
                      </button>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          {lexicons.length === 0 ? (
            !showNew && (
              <Empty title="No lexicons yet" action={newButton}>
                Add brand names to keep as is, terms with approved translations, and pronunciation hints. Pass the lexicon&apos;s ID
                as <code className="font-mono text-xs">translation.lexiconId</code> or set it as the project default.
              </Empty>
            )
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[260px_1fr]">
              <Card title="Lexicons">
                <ul className="flex flex-col gap-0.5" aria-label="Lexicons">
                  {lexicons.map((l) => (
                    <li key={l.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => setSelected(l.id)}
                        aria-current={selected === l.id ? 'true' : undefined}
                        className={`min-w-0 flex-1 rounded-lg px-3 py-2 text-left text-sm ${
                          selected === l.id ? 'bg-white font-medium text-[#5B21B6]' : 'text-[#170B2E] hover:bg-white/60'
                        }`}
                      >
                        <span className="block truncate">{l.name}</span>
                        <span className="block text-xs font-normal text-[#6B6478]">
                          {lexiconTermCount(l)} terms{l.industry ? ` · ${industryLabel(l.industry)}` : ''}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(l)}
                        disabled={busy === `del:${l.id}`}
                        aria-label={`Delete ${l.name}`}
                        className="rounded-lg p-2 text-[#6B6478] hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                      >
                        <Trash2 size={15} />
                      </button>
                    </li>
                  ))}
                </ul>
              </Card>
              {current ? (
                <LexiconEditor
                  key={current.id}
                  projectId={projectId}
                  lexicon={current}
                  onCountChange={(n) =>
                    setLexicons((prev) => (prev ?? []).map((l) => (l.id === current.id ? { ...l, termCount: n } : l)))
                  }
                />
              ) : (
                <Card>
                  <p className="text-sm text-[#170B2E]">Select a lexicon to edit its terms.</p>
                  <p className="mt-1 text-xs text-[#6B6478]">You can paste or upload a CSV after opening a lexicon.</p>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
