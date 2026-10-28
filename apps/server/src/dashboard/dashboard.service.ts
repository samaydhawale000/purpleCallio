import { Injectable, NotFoundException } from '@nestjs/common';
import { CallStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private async userProjectIds(userId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  async getCalls(
    userId: string,
    options: {
      projectId?: string;
      page?: string;
      search?: string;
      status?: string;
    } = {},
  ) {
    const page = Math.max(1, parseInt(options.page ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Number(process.env.PAGE_SIZE) || 10,
    );
    const projectIds = options.projectId
      ? [options.projectId]
      : await this.userProjectIds(userId);

    if (projectIds.length === 0) {
      return { data: [], total: 0, page, pageSize, pageCount: 1 };
    }

    const search = options.search?.trim();
    const status = Object.values(CallStatus).includes(options.status as CallStatus)
      ? (options.status as CallStatus)
      : undefined;
    const where = {
      projectId: { in: projectIds },
      ...(status ? { status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search, mode: 'insensitive' as const } },
              { callerId: { contains: search, mode: 'insensitive' as const } },
              { receiverId: { contains: search, mode: 'insensitive' as const } },
              { project: { name: { contains: search, mode: 'insensitive' as const } } },
            ],
          }
        : {}),
    };

    const [total, data] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.findMany({
        where,
        include: { project: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      data,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async getCallDetails(userId: string, callId: string) {
    const projectIds = await this.userProjectIds(userId);
    if (projectIds.length === 0) {
      throw new NotFoundException('Call not found');
    }

    const call = await this.prisma.call.findFirst({
      where: { id: callId, projectId: { in: projectIds } },
      include: {
        project: { select: { id: true, name: true } },
        events: { orderBy: { createdAt: 'asc' } },
      },
    });

    if (!call) throw new NotFoundException('Call not found');
    return call;
  }

async getUsage(userId: string) {
    const projectIds = await this.userProjectIds(userId);
    if (projectIds.length === 0) {
      return { totalCalls: 0, activeCalls: 0, minutesUsed: 0, calls: [] };
    }

    const calls = await this.prisma.call.findMany({
      where: { projectId: { in: projectIds } },
      select: { status: true, startedAt: true, endedAt: true },
    });

    const totalCalls = calls.length;
    const activeCalls = calls.filter(
      (c) =>
        c.status === CallStatus.ACCEPTED ||
        c.status === CallStatus.RINGING ||
        c.status === CallStatus.INITIATED,
    ).length;

    let minutesUsed = 0;
    const now = Date.now();

    for (const c of calls) {
      if (!c.startedAt) continue;
      const end = c.endedAt ? c.endedAt.getTime() : now;
      const start = c.startedAt.getTime();
      if (end > start) minutesUsed += Math.floor((end - start) / 60000);
    }

    return { totalCalls, activeCalls, minutesUsed, calls };
  }

  /**
   * Aggregate stats for the dashboard hero / stat cards.
   */
  async getOverview(userId: string) {
    const projects = await this.prisma.project.findMany({
      where: { ownerId: userId },
      select: { id: true },
    });
    const projectIds = projects.map((p) => p.id);

    if (projectIds.length === 0) {
      return {
        projects: 0,
        activeCalls: 0,
        calls: 0,
        minutesUsed: 0,
        apiKeys: 0,
      };
    }

    const [apiKeys, calls] = await Promise.all([
      this.prisma.apiKey.count({
        where: { project: { ownerId: userId } },
      }),
      this.prisma.call.findMany({
        where: { projectId: { in: projectIds } },
        select: { status: true, startedAt: true, endedAt: true },
      }),
    ]);

    const activeCalls = calls.filter(
      (c) =>
        c.status === CallStatus.ACCEPTED ||
        c.status === CallStatus.RINGING ||
        c.status === CallStatus.INITIATED,
    ).length;

    let minutesUsed = 0;
    const now = Date.now();
    for (const c of calls) {
      if (!c.startedAt) continue;
      const end = c.endedAt ? c.endedAt.getTime() : now;
      const start = c.startedAt.getTime();
      if (end > start) minutesUsed += Math.floor((end - start) / 60000);
    }

    return {
      projects: projects.length,
      activeCalls,
      calls: calls.length,
      minutesUsed,
      apiKeys,
    };
  }

  /**
   * Daily usage chart data for the last N days (default 7).
   * Returns [{ date, label, minutes, calls }] ordered ascending.
   */
  async getUsageChart(userId: string, days = 7) {
    const projectIds = await this.userProjectIds(userId);
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));

    const calls = projectIds.length
      ? await this.prisma.call.findMany({
          where: {
            projectId: { in: projectIds },
            startedAt: { gte: start },
          },
          select: { startedAt: true, endedAt: true },
        })
      : [];

    const buckets: Record<string, { minutes: number; calls: number }> = {};
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const key = d.toISOString().slice(0, 10);
      buckets[key] = { minutes: 0, calls: 0 };
    }

    const now = Date.now();
    for (const c of calls) {
      if (!c.startedAt) continue;
      const key = new Date(c.startedAt).toISOString().slice(0, 10);
      if (!buckets[key]) continue;
      buckets[key].calls += 1;
      const end = c.endedAt ? c.endedAt.getTime() : now;
      const startMs = c.startedAt.getTime();
      if (end > startMs) {
        buckets[key].minutes += Math.floor((end - startMs) / 60000);
      }
    }

    return Object.entries(buckets).map(([date, v]) => ({
      date,
      label: new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
      }),
      minutes: v.minutes,
      calls: v.calls,
    }));
  }

  /**
   * Credits and minutes per UTC day for the last N days, split by product.
   * Reads the same billed rows as the translation usage breakdown, so the
   * daily totals add up to what the Usage page's product table shows.
   */
  async getDailyUsage(userId: string, days = 30, projectId?: string) {
    const span = Math.min(Math.max(1, Math.floor(days)), 90);
    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);
    start.setUTCDate(start.getUTCDate() - (span - 1));
    const range = { gte: start };

    if (projectId) {
      const owned = await this.prisma.project.findFirst({
        where: { id: projectId, ownerId: userId },
        select: { id: true },
      });
      if (!owned) throw new NotFoundException('Project not found');
    }
    const project = projectId ? { projectId } : {};
    // CallUsage rows only carry the call id, so a project filter goes
    // through that project's calls in the window.
    const callFilter = projectId
      ? {
          callId: {
            in: (
              await this.prisma.call.findMany({
                where: { projectId, createdAt: { gte: new Date(start.getTime() - 86_400_000) } },
                select: { id: true },
              })
            ).map((c) => c.id),
          },
        }
      : {};

    const [callRows, translationRows, aiRows, reportRows] = await Promise.all([
      this.prisma.callUsage.findMany({
        where: { usage: { companyId: userId }, createdAt: range, ...callFilter },
        select: {
          createdAt: true,
          creditsCharged: true,
          audioMinutes: true,
          videoMinutes: true,
          screenShareMinutes: true,
        },
      }),
      this.prisma.translationSession.findMany({
        where: { ownerId: userId, startedAt: range, ...project },
        select: {
          startedAt: true,
          creditsCharged: true,
          voiceSeconds: true,
          captionsSeconds: true,
        },
      }),
      this.prisma.aiCallSession.findMany({
        where: { ownerId: userId, usageRecordedAt: range, ...project },
        select: {
          usageRecordedAt: true,
          creditsCharged: true,
          durationSeconds: true,
        },
      }),
      this.prisma.translationReport.findMany({
        where: { call: { project: { ownerId: userId } }, createdAt: range, ...project },
        select: { createdAt: true, creditsCharged: true },
      }),
    ]);

    type Day = {
      date: string;
      callCredits: number;
      translateCredits: number;
      aiCredits: number;
      reportCredits: number;
      callMinutes: number;
      translateMinutes: number;
      aiMinutes: number;
    };
    const buckets = new Map<string, Day>();
    for (let i = 0; i < span; i++) {
      const d = new Date(start);
      d.setUTCDate(d.getUTCDate() + i);
      const date = d.toISOString().slice(0, 10);
      buckets.set(date, {
        date,
        callCredits: 0,
        translateCredits: 0,
        aiCredits: 0,
        reportCredits: 0,
        callMinutes: 0,
        translateMinutes: 0,
        aiMinutes: 0,
      });
    }
    const day = (at: Date | null) =>
      at ? buckets.get(at.toISOString().slice(0, 10)) : undefined;

    for (const r of callRows) {
      const b = day(r.createdAt);
      if (!b) continue;
      b.callCredits += r.creditsCharged;
      b.callMinutes += r.audioMinutes + r.videoMinutes + r.screenShareMinutes;
    }
    for (const r of translationRows) {
      const b = day(r.startedAt);
      if (!b) continue;
      b.translateCredits += r.creditsCharged;
      b.translateMinutes += (r.voiceSeconds + r.captionsSeconds) / 60;
    }
    for (const r of aiRows) {
      const b = day(r.usageRecordedAt);
      if (!b) continue;
      b.aiCredits += r.creditsCharged ?? 0;
      b.aiMinutes += (r.durationSeconds ?? 0) / 60;
    }
    for (const r of reportRows) {
      const b = day(r.createdAt);
      if (b) b.reportCredits += r.creditsCharged;
    }

    const round2 = (n: number) => Math.round(n * 100) / 100;
    return [...buckets.values()].map((b) => ({
      ...b,
      callMinutes: round2(b.callMinutes),
      translateMinutes: round2(b.translateMinutes),
      aiMinutes: round2(b.aiMinutes),
      totalCredits:
        b.callCredits + b.translateCredits + b.aiCredits + b.reportCredits,
    }));
  }
}

