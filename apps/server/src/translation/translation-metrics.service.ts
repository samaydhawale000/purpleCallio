import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma, TranslationMode, TranslationSessionStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { creditValuePaise, round2 } from './translation-estimate.service';
import { parsePairLoose } from './translation-pair';

const badRequest = (message: string) =>
  new BadRequestException({ statusCode: 400, code: 'TRANSLATION_INVALID_REQUEST', message });

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

export interface DateRange {
  from: Date;
  to: Date;
}

/**
 * `from`/`to` as YYYY-MM-DD (to inclusive) or full ISO timestamps (to
 * exclusive). Default: the last 30 days.
 */
export function parseRange(from?: string, to?: string, defaultDays = 30): DateRange {
  const parse = (v: string, name: string, endOfDay: boolean) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
      const d = new Date(`${v}T00:00:00Z`);
      if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v)
        throw badRequest(`"${name}" must be a date (YYYY-MM-DD).`);
      return endOfDay ? new Date(d.getTime() + DAY_MS) : d;
    }
    const d = new Date(v);
    if (Number.isNaN(d.getTime()))
      throw badRequest(`"${name}" must be a date (YYYY-MM-DD).`);
    return d;
  };
  const end = to ? parse(to, 'to', true) : new Date();
  const start = from
    ? parse(from, 'from', false)
    : new Date(end.getTime() - defaultDays * DAY_MS);
  if (end <= start) throw badRequest('"to" must not be before "from".');
  if (end.getTime() - start.getTime() > MAX_RANGE_DAYS * DAY_MS)
    throw badRequest(`The range can be at most ${MAX_RANGE_DAYS} days.`);
  return { from: start, to: end };
}

/** "hi-en" / "en-IN-hi" → languages (regions are upper-case, so unambiguous). */
export function parsePair(pair?: string): { source: string; target: string } | null {
  if (pair === undefined || pair === '') return null;
  const parsed = parsePairLoose(pair);
  if (!parsed) throw badRequest('pair must look like "hi-en".');
  return parsed;
}

function langFilter(code: string): Prisma.StringFilter | string {
  // "en" matches "en" and "en-IN"; "en-IN" matches exactly.
  return code.includes('-') ? code : { startsWith: code };
}

/** Phrase-weighted percentile of per-session percentiles (approximation). */
export function weightedPercentile(
  values: { value: number | null; weight: number }[],
  p: number,
): number | null {
  const v = values
    .filter((x) => x.value != null && x.value >= 0)
    .map((x) => ({ value: x.value as number, weight: Math.max(1, x.weight) }))
    .sort((a, b) => a.value - b.value);
  if (!v.length) return null;
  const total = v.reduce((s, x) => s + x.weight, 0);
  const target = total * p;
  let acc = 0;
  for (const x of v) {
    acc += x.weight;
    if (acc >= target) return Math.round(x.value);
  }
  return Math.round(v[v.length - 1].value);
}

const SESSION_SELECT = {
  callId: true,
  sourceLanguage: true,
  targetLanguage: true,
  route: true,
  mode: true,
  status: true,
  voiceSeconds: true,
  captionsSeconds: true,
  creditsCharged: true,
  phrases: true,
  firstAudioMsP50: true,
  firstAudioMsP95: true,
  captionDelayMsP50: true,
  captionDelayMsP95: true,
  droppedFrames: true,
  providerFailures: true,
  fallbacks: true,
  flags: true,
  flagReasons: true,
  replays: true,
  repeats: true,
  lexiconHits: true,
} satisfies Prisma.TranslationSessionSelect;

type SessionRow = Prisma.TranslationSessionGetPayload<{ select: typeof SESSION_SELECT }>;

/** Benchmarks are filled in from the Phase 0 evaluation; placeholders until then. */
const BENCHMARKS = [
  { pair: 'hi-en', route: 'soniox' },
  { pair: 'en-hi', route: 'soniox' },
  { pair: 'mr-en', route: 'soniox' },
  { pair: 'ta-en', route: 'soniox' },
].map((b) => ({ ...b, termPreservation: null, note: 'pending Phase 0' }));

/**
 * Translation Observability (translation/PROTOCOL.md §5) — aggregates
 * TranslationSession rows. Provider cost is NEVER part of these responses.
 */
@Injectable()
export class TranslationMetricsService {
  constructor(private prisma: PrismaService) {}

  async metrics(
    projectId: string,
    query: { from?: string; to?: string; pair?: string; route?: string },
  ) {
    const range = parseRange(query.from, query.to);
    const pair = parsePair(query.pair);
    if (query.route !== undefined && !/^[a-z0-9-]{1,40}$/.test(query.route))
      throw badRequest('route is not a known route id.');
    const where: Prisma.TranslationSessionWhereInput = {
      projectId,
      startedAt: { gte: range.from, lt: range.to },
      ...(query.route ? { route: query.route } : {}),
      ...(pair
        ? {
            sourceLanguage: langFilter(pair.source),
            targetLanguage: langFilter(pair.target),
          }
        : {}),
    };
    const [rows, value] = await Promise.all([
      this.prisma.translationSession.findMany({
        where,
        select: SESSION_SELECT,
        take: 50_000,
      }),
      creditValuePaise(this.prisma),
    ]);
    return { from: range.from, to: range.to, ...aggregate(rows, value.paise) };
  }

  /**
   * CostGuard usage breakdown for the dashboard Usage page: what the
   * account's credits went on, by product, in the window.
   */
  async usageBreakdown(
    ownerId: string,
    query: { from?: string; to?: string; projectId?: string },
  ) {
    const range = parseRange(query.from, query.to);
    const projectFilter = query.projectId ? { projectId: query.projectId } : {};
    const sessionWhere: Prisma.TranslationSessionWhereInput = {
      ownerId,
      ...projectFilter,
      startedAt: { gte: range.from, lt: range.to },
    };
    const [callUsage, translation, ai, reports, value] = await Promise.all([
      this.prisma.callUsage.aggregate({
        where: {
          usage: { companyId: ownerId },
          createdAt: { gte: range.from, lt: range.to },
          ...(query.projectId
            ? {
                callId: {
                  in: (
                    await this.prisma.call.findMany({
                      where: {
                        projectId: query.projectId,
                        createdAt: { gte: new Date(range.from.getTime() - DAY_MS), lt: range.to },
                      },
                      select: { id: true },
                      take: 20_000,
                    })
                  ).map((c) => c.id),
                },
              }
            : {}),
        },
        _sum: {
          audioMinutes: true,
          videoMinutes: true,
          screenShareMinutes: true,
          creditsCharged: true,
        },
        _count: true,
      }),
      this.prisma.translationSession.aggregate({
        where: sessionWhere,
        _sum: {
          voiceSeconds: true,
          captionsSeconds: true,
          creditsCharged: true,
          trialSecondsUsed: true,
        },
        _count: true,
      }),
      this.prisma.aiCallSession.aggregate({
        where: {
          ownerId,
          ...projectFilter,
          usageRecordedAt: { gte: range.from, lt: range.to },
        },
        _sum: { durationSeconds: true, creditsCharged: true },
        _count: true,
      }),
      this.prisma.translationReport.aggregate({
        where: {
          ...projectFilter,
          call: { project: { ownerId } },
          createdAt: { gte: range.from, lt: range.to },
        },
        _sum: { creditsCharged: true },
        _count: true,
      }),
      creditValuePaise(this.prisma),
    ]);
    const rated = await this.prisma.translationSession.findMany({
      where: sessionWhere,
      select: { voiceSeconds: true, captionsSeconds: true, voiceRate: true, captionsRate: true },
      take: 50_000,
    });
    const voiceByRate = rated.reduce(
      (acc, r) => ({
        voice: acc.voice + r.voiceSeconds * r.voiceRate,
        captions: acc.captions + r.captionsSeconds * r.captionsRate,
      }),
      { voice: 0, captions: 0 },
    );
    const callCredits = callUsage._sum.creditsCharged ?? 0;
    const voiceSeconds = translation._sum.voiceSeconds ?? 0;
    const captionsSeconds = translation._sum.captionsSeconds ?? 0;
    const sessionCredits = translation._sum.creditsCharged ?? 0;
    // A session's credits are not split by mode on the row: apportion them
    // by seconds × the session's locked rate (display only).
    const voiceShare =
      voiceSeconds + captionsSeconds > 0
        ? voiceByRate.voice / Math.max(1, voiceByRate.voice + voiceByRate.captions)
        : 0;
    const voiceCredits = Math.round(sessionCredits * voiceShare);
    const captionsCredits = sessionCredits - voiceCredits;
    const aiCredits = ai._sum.creditsCharged ?? 0;
    const reportCredits = reports._sum.creditsCharged ?? 0;
    const total = callCredits + sessionCredits + aiCredits + reportCredits;
    return {
      period: { from: range.from, to: range.to },
      callMinutes: {
        minutes: round2(
          (callUsage._sum.audioMinutes ?? 0) +
            (callUsage._sum.videoMinutes ?? 0) +
            (callUsage._sum.screenShareMinutes ?? 0),
        ),
        credits: callCredits,
      },
      captions: { minutes: round2(captionsSeconds / 60), credits: captionsCredits },
      voice: { minutes: round2(voiceSeconds / 60), credits: voiceCredits },
      aiAgent: {
        minutes: round2((ai._sum.durationSeconds ?? 0) / 60),
        credits: aiCredits,
      },
      reports: { count: reports._count, credits: reportCredits },
      trialMinutes: round2((translation._sum.trialSecondsUsed ?? 0) / 60),
      totalCredits: total,
      approxInrTotal:
        value.paise == null ? null : round2((total * value.paise) / 100),
    };
  }
}

export function aggregate(rows: SessionRow[], creditPaise: number | null) {
  const calls = new Set<string>();
  const callSeconds = new Map<string, number>();
  let voiceSeconds = 0;
  let captionsSeconds = 0;
  let credits = 0;
  let phrases = 0;
  let flags = 0;
  let replays = 0;
  let repeats = 0;
  let lexiconHits = 0;
  let providerFailures = 0;
  let fallbacks = 0;
  let droppedFrames = 0;
  let failedSessions = 0;
  const byReason: Record<string, number> = {};
  const groups = new Map<string, SessionRow[]>();

  for (const r of rows) {
    calls.add(r.callId);
    const seconds = r.voiceSeconds + r.captionsSeconds;
    // A call-minute is the longer of its two directions.
    callSeconds.set(r.callId, Math.max(callSeconds.get(r.callId) ?? 0, seconds));
    voiceSeconds += r.voiceSeconds;
    captionsSeconds += r.captionsSeconds;
    credits += r.creditsCharged;
    phrases += r.phrases;
    flags += r.flags;
    replays += r.replays;
    repeats += r.repeats;
    lexiconHits += r.lexiconHits;
    providerFailures += r.providerFailures;
    fallbacks += r.fallbacks;
    droppedFrames += r.droppedFrames;
    if (r.status === TranslationSessionStatus.FAILED) failedSessions++;
    if (r.flagReasons && typeof r.flagReasons === 'object' && !Array.isArray(r.flagReasons)) {
      for (const [k, v] of Object.entries(r.flagReasons as Record<string, unknown>)) {
        if (typeof v === 'number' && v > 0) byReason[k] = (byReason[k] ?? 0) + v;
      }
    }
    const key = `${r.sourceLanguage}-${r.targetLanguage}|${r.route}`;
    const g = groups.get(key) ?? [];
    g.push(r);
    groups.set(key, g);
  }

  const callMinutes = [...callSeconds.values()].reduce((s, v) => s + v, 0) / 60;
  const avgCreditsPerCallMinute = callMinutes > 0 ? round2(credits / callMinutes) : null;
  const w = (pick: (r: SessionRow) => number | null) =>
    rows.map((r) => ({ value: pick(r), weight: r.phrases }));

  return {
    totals: {
      calls: calls.size,
      sessions: rows.length,
      voiceMinutes: round2(voiceSeconds / 60),
      captionsMinutes: round2(captionsSeconds / 60),
      credits,
      avgCreditsPerCallMinute,
      approxInrPerCallMinute:
        avgCreditsPerCallMinute == null || creditPaise == null
          ? null
          : round2((avgCreditsPerCallMinute * creditPaise) / 100),
    },
    latency: {
      firstAudioMsP50: weightedPercentile(w((r) => r.firstAudioMsP50), 0.5),
      firstAudioMsP95: weightedPercentile(w((r) => r.firstAudioMsP95), 0.95),
      captionDelayMsP50: weightedPercentile(w((r) => r.captionDelayMsP50), 0.5),
      captionDelayMsP95: weightedPercentile(w((r) => r.captionDelayMsP95), 0.95),
    },
    reliability: { providerFailures, fallbacks, droppedFrames, failedSessions },
    guard: {
      phrases,
      flags,
      flagRate: phrases > 0 ? round2(flags / phrases) : 0,
      byReason,
      replays,
      repeats,
      lexiconHits,
    },
    byPair: [...groups.entries()]
      .map(([key, g]) => {
        const [pair, route] = key.split('|');
        const p = g.reduce((s, r) => s + r.phrases, 0);
        const f = g.reduce((s, r) => s + r.flags, 0);
        return {
          pair,
          route,
          sessions: g.length,
          minutes: round2(g.reduce((s, r) => s + r.voiceSeconds + r.captionsSeconds, 0) / 60),
          voiceSessions: g.filter((r) => r.mode === TranslationMode.VOICE).length,
          firstAudioMsP50: weightedPercentile(
            g.map((r) => ({ value: r.firstAudioMsP50, weight: r.phrases })),
            0.5,
          ),
          flagRate: p > 0 ? round2(f / p) : 0,
        };
      })
      .sort((a, b) => b.minutes - a.minutes),
    benchmarks: BENCHMARKS,
  };
}
