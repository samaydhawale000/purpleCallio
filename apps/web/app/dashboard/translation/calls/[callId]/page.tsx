'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import {
  ROLE_LABEL,
  TranslationPhrase,
  TranslationReport,
  fmtNumber,
  getCallReport,
  translationErrorCode,
  translationErrorStatus,
  translationErrorText,
} from '../../../../lib/translation';
import { Notice, Pill, TextLink, fmtDateTime } from '../../../_ui';
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

const STATUS: Record<string, { label: string; tone: 'success' | 'danger' | 'warning' }> = {
  ready: { label: 'Ready', tone: 'success' },
  failed: { label: 'Failed', tone: 'danger' },
};

/** Post-call report for one translated call: summary, transcript and a few simple signals. */
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
            ? 'No report exists for this call. Reports are built only when post-call reports are on for the project and the call used translation.'
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
    <div className="mb-4">
      <TextLink href="/dashboard/translation/calls">← Calls &amp; reports</TextLink>
    </div>
  );

  if (error) {
    return (
      <>
        {back}
        <TranslationNav />
        <ErrorBox onRetry={error.notFound ? undefined : load}>{error.message}</ErrorBox>
      </>
    );
  }
  if (!report) return <Loading label="Loading report…" />;

  const transcript = [...(report.transcript ?? [])].sort((a, b) => ms(a.startedAt) - ms(b.startedAt));
  const start = transcript.length ? ms(transcript[0].startedAt) : 0;
  const summary = report.summary?.[activeLang];
  const signals = report.signals;
  const talk = (['caller', 'receiver'] as const)
    .filter((r) => signals?.talkRatio?.[r] != null)
    .map((r) => {
      const v = signals!.talkRatio![r]!;
      return `${ROLE_LABEL[r]} ${Math.round(v <= 1 ? v * 100 : v)}%`;
    })
    .join(' · ');
  const topics = (signals?.topics ?? [])
    .map((t) => (typeof t === 'string' ? t : t.topic ?? t.name ?? ''))
    .filter(Boolean);
  // Tone stays only as a one-word label per speaker.
  const tone = (signals?.tone ?? []).filter((t) => t.tone && !/\s/.test(t.tone.trim()));
  const status = STATUS[report.status] ?? { label: 'Preparing', tone: 'warning' as const };
  const phraseIds = new Set(transcript.map((p) => p.phraseId));

  return (
    <div className="max-w-5xl">
      {back}
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-[#170B2E]">Call report</h1>
          <Pill tone={status.tone}>{status.label}</Pill>
        </div>
        <p className="mt-1 text-sm text-[#6B6478]">
          <span className="font-mono text-[13px]">{callId}</span>
          {report.createdAt && <> · {fmtDateTime(report.createdAt)}</>}
          {report.creditsCharged > 0 && <> · {fmtNumber(report.creditsCharged)} credits</>}
        </p>
      </header>
      <TranslationNav />

      {report.status === 'pending' && (
        <div role="status">
          <Notice tone="info">The report is being prepared. This page updates automatically.</Notice>
        </div>
      )}
      {report.status === 'failed' && (
        <div className="mb-6">
          <ErrorBox>The report could not be built for this call. The transcript below is still available while it is retained.</ErrorBox>
        </div>
      )}

      <div className="flex flex-col gap-6">
        {languages.length > 0 && (
          <Card
            title="Summary"
            testId="report-summary"
            actions={
              languages.length > 1 ? (
                <div role="tablist" aria-label="Summary language" className="inline-flex rounded-lg border border-[#ECE8F2] bg-white p-0.5">
                  {languages.map((l) => (
                    <button
                      key={l}
                      type="button"
                      role="tab"
                      aria-selected={l === activeLang}
                      onClick={() => setLang(l)}
                      className={`rounded-md px-3 py-1 text-[13px] transition-colors ${
                        l === activeLang ? 'bg-[#F1EBFC] font-medium text-[#5B21B6]' : 'text-[#6B6478] hover:text-[#170B2E]'
                      }`}
                    >
                      {languageName(l)}
                    </button>
                  ))}
                </div>
              ) : (
                <span className="text-[13px] text-[#6B6478]">{languageName(activeLang)}</span>
              )
            }
          >
            <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
              <SummaryList title="Key points" items={summary?.keyPoints ?? []} />
              <SummaryList title="Decisions" items={summary?.decisions ?? []} />
              <div>
                <h3 className="mb-2 text-[13px] font-medium text-[#6B6478]">Action items</h3>
                {(summary?.actionItems ?? []).length === 0 ? (
                  <p className="text-sm text-[#6B6478]">None</p>
                ) : (
                  <ul className="flex flex-col gap-2 text-sm text-[#170B2E]">
                    {summary!.actionItems!.map((a, i) => (
                      <li key={i}>
                        {a.text}
                        {a.phraseId && phraseIds.has(a.phraseId) && (
                          <button
                            type="button"
                            onClick={() => jump(a.phraseId!)}
                            className="mt-0.5 block text-xs font-medium text-[#5B21B6] hover:underline"
                          >
                            Show in transcript
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
            <p className="mt-5 text-xs text-[#6B6478]">Summaries and translations are generated automatically and may not be accurate.</p>
          </Card>
        )}

        {signals && (talk || topics.length > 0 || tone.length > 0) && (
          <Card title="Conversation" testId="report-signals">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
              {talk && (
                <div>
                  <p className="text-[13px] text-[#6B6478]">Talk time</p>
                  <p className="mt-1 text-sm text-[#170B2E]">{talk}</p>
                </div>
              )}
              {topics.length > 0 && (
                <div>
                  <p className="text-[13px] text-[#6B6478]">Topics</p>
                  <div className="mt-1 flex flex-wrap gap-1.5">
                    {topics.map((t, i) => (
                      <Pill key={i}>{t}</Pill>
                    ))}
                  </div>
                </div>
              )}
              {tone.length > 0 && (
                <div data-testid="possible-tone">
                  <p className="text-[13px] text-[#6B6478]">Possible tone</p>
                  <ul className="mt-1 text-sm text-[#170B2E]">
                    {tone.map((t, i) => (
                      <li key={i}>
                        {ROLE_LABEL[t.speaker] ?? t.speaker}: possible tone {t.tone}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </Card>
        )}

        <section data-testid="report-transcript">
          <div className="mb-3">
            <h2 className="text-[15px] font-semibold text-[#170B2E]">Transcript</h2>
            <p className="mt-0.5 text-[13px] text-[#6B6478]">Original words and their translation, side by side.</p>
          </div>
          {transcript.length === 0 ? (
            <p className="rounded-xl bg-[#F7F6FA] p-5 text-sm text-[#6B6478]">
              No transcript is stored for this call (it may have passed its retention period).
            </p>
          ) : (
            <ol className="overflow-hidden rounded-xl border border-[#ECE8F2] bg-white">
              {transcript.map((p) => (
                <PhraseRow key={p.phraseId} phrase={p} start={start} focused={focus === p.phraseId} />
              ))}
            </ol>
          )}
        </section>
      </div>
    </div>
  );
}

function SummaryList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <h3 className="mb-2 text-[13px] font-medium text-[#6B6478]">{title}</h3>
      {items.length === 0 ? (
        <p className="text-sm text-[#6B6478]">None</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-sm text-[#170B2E]">
          {items.map((t, i) => (
            <li key={i}>{t}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PhraseRow({ phrase: p, start, focused }: { phrase: TranslationPhrase; start: number; focused: boolean }) {
  return (
    <li
      id={`phrase-${p.phraseId}`}
      className={`border-b border-[#F2EFF6] px-4 py-3 last:border-0 transition-colors ${focused ? 'bg-[#F1EBFC]' : ''}`}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2 text-xs text-[#6B6478]">
        <span className="tabular-nums">{clock(p.startedAt, start)}</span>
        <span className="font-medium text-[#170B2E]">{ROLE_LABEL[p.speaker] ?? p.speaker}</span>
        <span className="font-mono">
          {p.sourceLanguage} → {p.targetLanguage}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <p className="text-[#170B2E]" lang={p.sourceLanguage}>
          {p.original}
        </p>
        <p className="text-[#6B6478]" lang={p.targetLanguage}>
          {p.translated || '—'}
        </p>
      </div>
    </li>
  );
}
