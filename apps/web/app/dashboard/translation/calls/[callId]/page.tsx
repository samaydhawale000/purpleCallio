'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { Badge } from '../../../../components/ui/Badge';
import {
  ROLE_LABEL,
  TranslationPhrase,
  TranslationReport,
  fmtNumber,
  getCallReport,
  humanizeGuardReason,
  phraseGuard,
  translationErrorCode,
  translationErrorStatus,
  translationErrorText,
} from '../../../../lib/translation';
import { Card, ErrorBox, Loading, TranslationNav } from '../../_components/shared';

const POLL_MS = 10_000;

function languageName(code: string) {
  try {
    const name = new Intl.DisplayNames(['en'], { type: 'language' }).of(code);
    return name && name !== code ? name : code;
  } catch {
    return code;
  }
}

const ms = (v: string | number | null | undefined) => (v == null ? 0 : typeof v === 'number' ? v : Date.parse(v) || 0);

function clock(v: string | number, start: number) {
  const s = Math.max(0, Math.round((ms(v) - start) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Post-Call Suite report for one translated call. */
export default function CallReportPage() {
  const { callId } = useParams<{ callId: string }>();
  const [report, setReport] = useState<TranslationReport | null>(null);
  const [error, setError] = useState<{ notFound: boolean; message: string } | null>(null);
  const [lang, setLang] = useState<string>('');
  const [focus, setFocus] = useState<string | null>(null);

  const load = useCallback(() => {
    getCallReport(callId)
      .then((r) => {
        setError(null);
        setReport(r);
      })
      .catch((e) => {
        const notFound = translationErrorStatus(e) === 404 || translationErrorCode(e) === 'TRANSLATION_REPORT_NOT_FOUND';
        setError({
          notFound,
          message: notFound
            ? 'No report exists for this call. Reports are built only when the Post-Call Suite is on for the project and the call used translation.'
            : translationErrorText(e, 'Could not load the report. Please try again.'),
        });
      });
  }, [callId]);

  useEffect(load, [load]);

  // A pending report is being built — check again shortly.
  useEffect(() => {
    if (report?.status !== 'pending') return;
    const t = setInterval(load, POLL_MS);
    return () => clearInterval(t);
  }, [report?.status, load]);

  const languages = Object.keys(report?.summary ?? {});
  const activeLang = languages.includes(lang) ? lang : languages[0] ?? '';

  const jump = (phraseId: string) => {
    setFocus(phraseId);
    document.getElementById(`phrase-${phraseId}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
  };

  const back = (
    <Link href="/dashboard/translation/calls" className="inline-flex items-center gap-1.5 text-sm text-[#3D3650] hover:text-[#170B2E]">
      <ArrowLeft size={15} /> Calls &amp; reports
    </Link>
  );

  if (error) {
    return (
      <div className="flex flex-col gap-6">
        {back}
        <TranslationNav />
        <ErrorBox onRetry={error.notFound ? undefined : load}>{error.message}</ErrorBox>
      </div>
    );
  }
  if (!report) return <Loading label="Loading report…" />;

  const transcript = [...(report.transcript ?? [])].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  const start = transcript.length ? ms(transcript[0].startedAt) : 0;
  const summary = report.summary?.[activeLang];
  const signals = report.signals;
  const tone = signals?.tone ?? [];
  const phraseIds = new Set(transcript.map((p) => p.phraseId));

  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <div className="flex flex-col gap-2">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-[#170B2E]">Call report</h1>
          <Badge variant={report.status === 'ready' ? 'success' : report.status === 'failed' ? 'error' : 'warning'}>
            {report.status === 'ready' ? 'Ready' : report.status === 'failed' ? 'Failed' : 'Preparing'}
          </Badge>
        </div>
        <p className="text-sm text-[#3D3650]">
          <span className="font-mono text-xs">{callId}</span>
          {report.createdAt && <> · {new Date(report.createdAt).toLocaleString('en-IN')}</>}
          {report.creditsCharged > 0 && <> · {fmtNumber(report.creditsCharged)} credits</>}
        </p>
      </div>
      <TranslationNav />

      {report.status === 'pending' && (
        <div role="status" className="rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-sm text-amber-800">
          The report is being prepared. This page updates automatically.
        </div>
      )}
      {report.status === 'failed' && (
        <ErrorBox>The report could not be built for this call. The transcript below is still available while it is retained.</ErrorBox>
      )}

      <p className="text-xs text-[#3D3650]">
        Summaries and translations are generated automatically and may not be accurate. Check flagged phrases against the original.
      </p>

      {languages.length > 0 && (
        <Card
          title="Summary"
          testId="report-summary"
          actions={
            languages.length > 1 ? (
              <div role="tablist" aria-label="Summary language" className="flex gap-1 rounded-lg border border-[#E7DFF5] p-1">
                {languages.map((l) => (
                  <button
                    key={l}
                    role="tab"
                    aria-selected={l === activeLang}
                    onClick={() => setLang(l)}
                    className={`px-2.5 py-1 rounded-md text-xs ${l === activeLang ? 'bg-[#7F40E8]/10 text-[#6425C4] font-medium' : 'text-[#3D3650]'}`}
                  >
                    {languageName(l)}
                  </button>
                ))}
              </div>
            ) : (
              <span className="text-xs text-[#3D3650]">{languageName(activeLang)}</span>
            )
          }
        >
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SummaryList title="Key points" items={summary?.keyPoints ?? []} />
            <SummaryList title="Decisions" items={summary?.decisions ?? []} />
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-[#3D3650] mb-2">Action items</h3>
              {(summary?.actionItems ?? []).length === 0 ? (
                <p className="text-sm text-[#3D3650]">None.</p>
              ) : (
                <ul className="flex flex-col gap-2 text-sm text-[#170B2E]">
                  {summary!.actionItems!.map((a, i) => (
                    <li key={i}>
                      {a.text}
                      {a.phraseId && phraseIds.has(a.phraseId) && (
                        <button onClick={() => jump(a.phraseId!)} className="block text-xs font-medium text-[#6425C4] hover:text-[#170B2E] mt-0.5">
                          Show in transcript
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </Card>
      )}

      {signals && (
        <Card title="Conversation signals" testId="report-signals">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            {signals.talkRatio && (
              <div className="col-span-2">
                <p className="text-xs text-[#3D3650] mb-1">Talk time</p>
                <p className="text-[#170B2E]">
                  {(['caller', 'receiver'] as const)
                    .filter((r) => signals.talkRatio?.[r] != null)
                    .map((r) => {
                      const v = signals.talkRatio![r]!;
                      return `${ROLE_LABEL[r]} ${Math.round(v <= 1 ? v * 100 : v)}%`;
                    })
                    .join(' · ')}
                </p>
              </div>
            )}
            <div>
              <p className="text-xs text-[#3D3650] mb-1">Replays</p>
              <p className="text-[#170B2E] tabular-nums">{fmtNumber(signals.replays ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-[#3D3650] mb-1">Repeat requests</p>
              <p className="text-[#170B2E] tabular-nums">{fmtNumber(signals.repeats ?? 0)}</p>
            </div>
            <div>
              <p className="text-xs text-[#3D3650] mb-1">Flagged moments</p>
              <p className="text-[#170B2E] tabular-nums">{fmtNumber(signals.flaggedMoments?.length ?? 0)}</p>
            </div>
          </div>
          {(signals.topics ?? []).length > 0 && (
            <div className="mt-4">
              <p className="text-xs text-[#3D3650] mb-1">Topics</p>
              <div className="flex flex-wrap gap-1.5">
                {signals.topics!.map((t, i) => {
                  const label = typeof t === 'string' ? t : t.topic ?? t.name ?? '';
                  return label ? <Badge key={i}>{label}</Badge> : null;
                })}
              </div>
            </div>
          )}
          {tone.length > 0 && (
            <div className="mt-5" data-testid="possible-tone">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#3D3650] mb-2">Possible tone</p>
              <ul className="flex flex-col gap-2 text-sm">
                {tone.map((t, i) => (
                  <li key={i} className="rounded-xl border border-[#E7DFF5] p-3">
                    <p className="text-[#170B2E]">
                      {ROLE_LABEL[t.speaker] ?? t.speaker}
                      {t.topic ? ` on ${t.topic}` : ''}: possible tone <strong>{t.tone}</strong>
                    </p>
                    {(t.quotes ?? []).map((q, j) => (
                      <p key={j} className="text-xs text-[#3D3650] mt-1">“{q}”</p>
                    ))}
                  </li>
                ))}
              </ul>
              <p className="text-[11px] text-[#6B6478] mt-2">Possible tone is an automated hint and may not be accurate.</p>
            </div>
          )}
        </Card>
      )}

      <Card title="Transcript" subtitle="Original words and their translation, side by side." testId="report-transcript">
        {transcript.length === 0 ? (
          <p className="text-sm text-[#3D3650]">No transcript is stored for this call (it may have passed its retention period).</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {transcript.map((p) => (
              <PhraseRow key={p.phraseId} phrase={p} start={start} focused={focus === p.phraseId} />
            ))}
          </ol>
        )}
      </Card>
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-[#3D3650] mb-2">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-[#3D3650]">None.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm text-[#170B2E] list-disc pl-4">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhraseRow({ phrase: p, start, focused }: { phrase: TranslationPhrase; start: number; focused: boolean }) {
  const guard = phraseGuard(p);
  return (
    <li
      id={`phrase-${p.phraseId}`}
      data-flagged={guard.flagged ? 'true' : undefined}
      className={`rounded-xl border p-3 transition-colors ${
        focused ? 'border-[#7F40E8] bg-[#7F40E8]/5' : guard.flagged ? 'border-amber-500/30 bg-amber-500/5' : 'border-[#E7DFF5]'
      }`}
    >
      <div className="flex flex-wrap items-center gap-2 mb-1.5 text-xs text-[#3D3650]">
        <span className="tabular-nums">{clock(p.startedAt, start)}</span>
        <span className="font-medium text-[#170B2E]">{ROLE_LABEL[p.speaker] ?? p.speaker}</span>
        <span className="font-mono">{p.sourceLanguage} → {p.targetLanguage}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
        <p className="text-[#170B2E]" lang={p.sourceLanguage}>{p.original}</p>
        <p className="text-[#3D3650]" lang={p.targetLanguage}>{p.translated || '—'}</p>
      </div>
      {guard.flagged && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>
            May not be accurate
            {guard.reasons.length > 0 && <>: {guard.reasons.map(humanizeGuardReason).join('; ')}</>}
          </span>
        </p>
      )}
    </li>
  );
}
