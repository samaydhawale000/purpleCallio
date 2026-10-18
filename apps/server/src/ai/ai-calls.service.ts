import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AiSessionStatus, Prisma } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import { AiTranscriptService } from './ai-transcript.service';
import { AnalyticsQueryDto, ListCallsQueryDto } from './dto/list-calls.dto';

const DAY_MS = 86_400_000;
export const AI_CALLS_PAGE_SIZE = 25;
const DEFAULT_RANGE_DAYS = 30;
const MAX_ANALYTICS_RANGE_DAYS = 366;
/** CallEvents shown on the detail page; one AI_AGENT_SPEAKING per turn adds up. */
const MAX_DETAIL_EVENTS = 500;

const LIVE_STATUSES: AiSessionStatus[] = [
  AiSessionStatus.CREATED,
  AiSessionStatus.CONNECTING,
  AiSessionStatus.ACTIVE,
];

const LIST_SELECT = {
  id: true,
  callId: true,
  agentId: true,
  agent: { select: { name: true } },
  participantId: true,
  participantName: true,
  status: true,
  terminationReason: true,
  connectedAt: true,
  endedAt: true,
  durationSeconds: true,
  creditsCharged: true,
  toolCallCount: true,
  createdAt: true,
} satisfies Prisma.AiCallSessionSelect;

type ListRow = Prisma.AiCallSessionGetPayload<{ select: typeof LIST_SELECT }>;

interface AnalyticsRow {
  status: AiSessionStatus;
  connectedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number | null;
  toolCallCount: number;
  creditsCharged: number | null;
  createdAt: Date;
}

/**
 * The customer's AI call history and analytics (dashboard, JWT). Scoped by
 * AiCallSession.ownerId; another account's session is a plain 404.
 */
@Injectable()
export class AiCallsService {
  constructor(
    private prisma: PrismaService,
    private transcripts: AiTranscriptService,
  ) {}

  async list(userId: string, query: ListCallsQueryDto) {
    const { from, to } = parseRange(query);
    const page = query.page ? Number(query.page) : 1;
    const where: Prisma.AiCallSessionWhereInput = {
      ownerId: userId,
      createdAt: { gte: from, lt: to },
      ...(query.agentId ? { agentId: query.agentId } : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.aiCallSession.count({ where }),
      this.prisma.aiCallSession.findMany({
        where,
        select: LIST_SELECT,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * AI_CALLS_PAGE_SIZE,
        take: AI_CALLS_PAGE_SIZE,
      }),
    ]);
    return {
      items: rows.map(toListItem),
      page,
      pageSize: AI_CALLS_PAGE_SIZE,
      total,
    };
  }

  async detail(userId: string, sessionId: string) {
    const session = await this.prisma.aiCallSession.findFirst({
      where: { id: sessionId, ownerId: userId },
      select: {
        ...LIST_SELECT,
        agentVersionId: true,
        maxDurationSeconds: true,
        metadata: true,
      },
    });
    if (!session) throw new NotFoundException('Call not found');

    const [events, toolInvocations, transcript] = await Promise.all([
      this.prisma.callEvent.findMany({
        where: { callId: session.callId },
        orderBy: { createdAt: 'asc' },
        take: MAX_DETAIL_EVENTS,
        select: {
          event: true,
          participantId: true,
          metadata: true,
          createdAt: true,
        },
      }),
      this.prisma.aiToolInvocation.findMany({
        where: { sessionId: session.id },
        orderBy: { createdAt: 'asc' },
        select: {
          id: true,
          toolId: true,
          toolName: true,
          status: true,
          latencyMs: true,
          errorCode: true,
          createdAt: true,
        },
      }),
      this.transcripts.listForSession(session.id),
    ]);

    return {
      ...toListItem(session),
      agentVersionId: session.agentVersionId,
      maxDurationSeconds: session.maxDurationSeconds,
      metadata: session.metadata,
      events,
      toolInvocations,
      transcriptStored: transcript.length > 0,
      transcript: transcript.map((m) => ({
        role: m.role.toLowerCase(),
        content: m.content,
        createdAt: m.createdAt,
      })),
    };
  }

  async analytics(userId: string, query: AnalyticsQueryDto, now = new Date()) {
    const { from, to } = parseRange(query, now);
    if (to.getTime() - from.getTime() > MAX_ANALYTICS_RANGE_DAYS * DAY_MS) {
      throw new BadRequestException(
        `The range can be at most ${MAX_ANALYTICS_RANGE_DAYS} days.`,
      );
    }
    const rows: AnalyticsRow[] = await this.prisma.aiCallSession.findMany({
      where: { ownerId: userId, createdAt: { gte: from, lt: to } },
      select: {
        status: true,
        connectedAt: true,
        endedAt: true,
        durationSeconds: true,
        toolCallCount: true,
        creditsCharged: true,
        createdAt: true,
      },
    });
    return { from, to, ...aggregateAnalytics(rows, from, to, now) };
  }
}

function toListItem(row: ListRow) {
  return {
    sessionId: row.id,
    callId: row.callId,
    date: row.createdAt,
    agentId: row.agentId,
    agentName: row.agent?.name ?? null,
    participantId: row.participantId,
    participantName: row.participantName,
    status: row.status,
    terminationReason: row.terminationReason,
    connectedAt: row.connectedAt,
    endedAt: row.endedAt,
    durationSeconds: row.durationSeconds,
    creditsCharged: row.creditsCharged,
    toolCallCount: row.toolCallCount,
  };
}

/** `[from, to)`. A date-only `to` includes that whole UTC day. Defaults: last 30 days. */
export function parseRange(
  query: { from?: string; to?: string },
  now = new Date(),
) {
  let to = query.to ? new Date(query.to) : now;
  if (query.to && /^\d{4}-\d{2}-\d{2}$/.test(query.to)) {
    to = new Date(to.getTime() + DAY_MS);
  }
  const from = query.from
    ? new Date(query.from)
    : new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
  if (isNaN(from.getTime()) || isNaN(to.getTime())) {
    throw new BadRequestException('Invalid date range.');
  }
  if (from >= to) {
    throw new BadRequestException('from must be before to.');
  }
  return { from, to };
}

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** Pure, so the spec can check it without a database. */
export function aggregateAnalytics(
  rows: AnalyticsRow[],
  from: Date,
  to: Date,
  now = new Date(),
) {
  let totalSeconds = 0;
  let answered = 0;
  let toolCalls = 0;
  let creditsUsed = 0;
  const statuses = { completed: 0, failed: 0, expired: 0, inProgress: 0 };

  const days = new Map<string, { seconds: number; sessions: number }>();
  for (
    let t = Date.parse(utcDay(from));
    t < to.getTime();
    t += DAY_MS
  ) {
    days.set(utcDay(new Date(t)), { seconds: 0, sessions: 0 });
  }

  const edges: [number, number][] = [];
  for (const row of rows) {
    const seconds = row.durationSeconds ?? 0;
    totalSeconds += seconds;
    if (seconds > 0) answered++;
    toolCalls += row.toolCallCount;
    creditsUsed += row.creditsCharged ?? 0;

    if (row.status === AiSessionStatus.ENDED) statuses.completed++;
    else if (row.status === AiSessionStatus.FAILED) statuses.failed++;
    else if (row.status === AiSessionStatus.EXPIRED) statuses.expired++;
    else if (LIVE_STATUSES.includes(row.status)) statuses.inProgress++;

    const day = days.get(utcDay(row.connectedAt ?? row.createdAt));
    if (day) {
      day.seconds += seconds;
      day.sessions++;
    }

    if (row.connectedAt) {
      const end = (row.endedAt ?? now).getTime();
      edges.push([row.connectedAt.getTime(), 1], [end, -1]);
    }
  }

  // Ends sort before starts at the same instant: back-to-back isn't overlap.
  edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let live = 0;
  let peakConcurrency = 0;
  for (const [, delta] of edges) {
    live += delta;
    peakConcurrency = Math.max(peakConcurrency, live);
  }

  return {
    totalSessions: rows.length,
    totalMinutes: round1(totalSeconds / 60),
    averageDurationSeconds: answered ? Math.round(totalSeconds / answered) : 0,
    ...statuses,
    toolCalls,
    creditsUsed,
    peakConcurrency,
    minutesPerDay: [...days].map(([date, d]) => ({
      date,
      minutes: round1(d.seconds / 60),
      sessions: d.sessions,
    })),
  };
}

function round1(value: number) {
  return Math.round(value * 10) / 10;
}
