'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Badge } from '../../../components/ui/Badge';
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="PurpleLex lexicons"
        subtitle="Names, product terms and approved translations that every translated call must respect."
        actions={
          projects && projects.length > 0 ? (
            <>
              <ProjectPicker projects={projects} value={projectId} onChange={setProjectId} />
              <Button onClick={() => setShowNew(true)}>
                <Plus size={15} className="mr-1" /> New lexicon
              </Button>
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
        <>
          {error && <ErrorBox>{error}</ErrorBox>}

          {showNew && (
            <Card title="New lexicon">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
                <Input label="Lexicon name" placeholder="e.g. Clinic terms" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="new-lex-industry" className="text-sm font-medium text-[#3D3650]">Industry (optional)</label>
                  <select id="new-lex-industry" className={selectCls} value={industry} onChange={(e) => setIndustry(e.target.value)}>
                    <option value="">Not set</option>
                    {INDUSTRIES.map((i) => (
                      <option key={i.id} value={i.id}>{i.label}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <Button onClick={create} loading={busy === 'create'} disabled={!name.trim()}>Create lexicon</Button>
                <Button variant="ghost" onClick={() => setShowNew(false)}>Cancel</Button>
              </div>
            </Card>
          )}

          {packs.length > 0 && (
            <Card title="Start from an industry pack" subtitle="A ready-made lexicon you can edit. It is copied into this project.">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {packs.map((p) => (
                  <div key={p.industry} className="rounded-xl border border-[#E7DFF5] p-4 flex flex-col gap-2">
                    <p className="text-sm font-semibold text-[#170B2E]">{p.name ?? industryLabel(p.industry)}</p>
                    {p.description && <p className="text-xs text-[#3D3650]">{p.description}</p>}
                    {(p.termCount ?? p.terms?.length) != null && (
                      <p className="text-xs text-[#3D3650]">{p.termCount ?? p.terms?.length} terms</p>
                    )}
                    <Button
                      variant="secondary"
                      size="sm"
                      className="self-start"
                      loading={busy === `pack:${p.industry}`}
                      onClick={() => fromPack(p)}
                      aria-label={`Use the ${p.name ?? industryLabel(p.industry)} pack`}
                    >
                      Use this pack
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {lexicons.length === 0 ? (
            !showNew && (
              <Empty title="No lexicons yet" action={<Button onClick={() => setShowNew(true)}><Plus size={15} className="mr-1" /> New lexicon</Button>}>
                Add brand names to keep as is, terms with approved translations, and pronunciation hints. Pass the lexicon&apos;s ID
                as <code className="font-mono text-xs">translation.lexiconId</code> or set it as the project default.
              </Empty>
            )
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6 items-start">
              <Card title="Lexicons">
                <ul className="flex flex-col gap-1" aria-label="Lexicons">
                  {lexicons.map((l) => (
                    <li key={l.id} className="flex items-center gap-1">
                      <button
                        onClick={() => setSelected(l.id)}
                        aria-current={selected === l.id ? 'true' : undefined}
                        className={`flex-1 min-w-0 text-left px-3 py-2 rounded-lg text-sm ${
                          selected === l.id ? 'bg-[#7F40E8]/10 text-[#6425C4] font-medium' : 'text-[#170B2E] hover:bg-[#F8F4FD]'
                        }`}
                      >
                        <span className="block truncate">{l.name}</span>
                        <span className="block text-xs text-[#3D3650] font-normal">
                          {lexiconTermCount(l)} terms{l.industry ? ` · ${industryLabel(l.industry)}` : ''}
                        </span>
                      </button>
                      <button
                        onClick={() => remove(l)}
                        disabled={busy === `del:${l.id}`}
                        aria-label={`Delete ${l.name}`}
                        className="p-2 rounded-lg text-[#3D3650] hover:text-red-600 hover:bg-red-500/5 disabled:opacity-50"
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
                  <p className="text-sm text-[#3D3650]">Select a lexicon to edit its terms.</p>
                  <div className="mt-2"><Badge variant="purple">Tip</Badge> <span className="text-xs text-[#3D3650]">You can paste or upload a CSV after opening a lexicon.</span></div>
                </Card>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
