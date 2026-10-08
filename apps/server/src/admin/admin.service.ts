import { Injectable, NotFoundException } from '@nestjs/common';
import { CallStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CallGateway } from '../socket/gateways/call.gateway';
import { TurnService } from '../turn/turn.service';
import { UsageBillingService } from '../billing/usage-billing.service';
import { SubscriptionService } from '../billing/subscriptions/subscription.service';
import { CreditService } from '../billing/credits/credit.service';
import { AutoRenewService } from '../billing/subscriptions/auto-renew.service';
import {
  CustomerDiscountService,
  SetDiscountInput,
} from '../billing/customer-discount.service';
import { OciMonitoringService } from '../oci/oci-monitoring.service';
import { CallService } from '../call/services/call.service';

@Injectable()
export class AdminService {
  constructor(
    private prisma: PrismaService,
    private callGateway: CallGateway,
    private turnService: TurnService,
    private usageBilling: UsageBillingService,
    private customerDiscounts: CustomerDiscountService,
    private ociMonitoring: OciMonitoringService,
    private callService: CallService,
    private subscriptions: SubscriptionService,
    private credits: CreditService,
    private autoRenew: AutoRenewService,
  ) {}

  // ── Overview ──────────────────────────────────────────
  async getOverview() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [totalUsers, paidUsersAgg, totalProjects, activeCalls] =
      await Promise.all([
        this.prisma.user.count(),
        // Paying = an active paid/custom prepaid subscription.
        this.prisma.subscription.groupBy({
          by: ['companyId'],
          where: { status: 'ACTIVE', planType: { in: ['PAID', 'CUSTOM'] } },
        }),
        this.prisma.project.count(),
        this.prisma.call.count({
          where: { status: { in: ['RINGING', 'ACCEPTED', 'INITIATED'] } },
        }),
      ]);

    const paidUsers = paidUsersAgg.length;
    const freeUsers = Math.max(0, totalUsers - paidUsers);

    const [callsEndedToday, callsEndedMonth] = await Promise.all([
      this.prisma.call.findMany({
        where: { startedAt: { not: null }, endedAt: { gte: startOfDay } },
        select: { startedAt: true, endedAt: true },
      }),
      this.prisma.call.findMany({
        where: { startedAt: { not: null }, endedAt: { gte: startOfMonth } },
        select: { startedAt: true, endedAt: true },
      }),
    ]);

    // "Platform minutes": wall-clock call duration (start→end), NOT the same
    // thing as billing. Kept separate from participantMinutesMonth below,
    // which is the actual per-participant-minute billing basis.
    const minutesToday = Math.round(
      callsEndedToday.reduce(
        (sum, c) => sum + this.diffMinutes(c.startedAt!, c.endedAt!),
        0,
      ),
    );
    const minutesMonth = Math.round(
      callsEndedMonth.reduce(
        (sum, c) => sum + this.diffMinutes(c.startedAt!, c.endedAt!),
        0,
      ),
    );

    // Real concurrent participant count from the socket gateway, not a
    // guessed "2 per call" — a call can have 1 participant waiting or more
    // than 2 once group calls/screen share are involved.
    const activeParticipants = this.callGateway.getMetrics().inCall;

    // Metered participant-minutes and credits consumed (the prepaid
    // billing basis) — distinct from the platform-minutes figures above —
    // plus verified prepaid revenue this month.
    const [billingSummary, revenueMonth] = await Promise.all([
      this.usageBilling.summarizeAdminUsage(startOfMonth),
      this.prisma.payment.aggregate({
        where: {
          purpose: { not: 'LEGACY' },
          paymentStatus: 'PAID',
          paidAt: { gte: startOfMonth },
        },
        _sum: { amount: true },
      }),
    ]);
    const participantMinutesMonth =
      billingSummary.lineItems.audioMinutes +
      billingSummary.lineItems.videoMinutes +
      billingSummary.lineItems.screenShareMinutes;
    const creditsConsumedMonth = billingSummary.creditsConsumed;
    const revenueMonthPaise = revenueMonth._sum.amount ?? 0;

    return {
      stats: {
        totalCompanies: totalUsers,
        freeUsers,
        paidUsers,
        totalProjects,
        activeCalls,
        activeParticipants,
        minutesToday,
        minutesMonth,
        participantMinutesMonth,
        creditsConsumedMonth,
        revenueMonthPaise,
      },
      charts: await this.getCharts(),
    };
  }

  private async getCharts() {
    const now = new Date();

    const calls7d = await this.prisma.call.findMany({
      where: { createdAt: { gte: this.daysAgo(7) } },
      select: { createdAt: true },
    });
    const callsByDay = this.groupByDay(
      calls7d.map((c) => c.createdAt),
      7,
    );

    const ended7d = await this.prisma.call.findMany({
      where: { startedAt: { not: null }, endedAt: { gte: this.daysAgo(7) } },
      select: { startedAt: true, endedAt: true },
    });
    const minutesByDay = this.groupByDayMinutes(ended7d, 7);

    const users30d = await this.prisma.user.findMany({
      where: { createdAt: { gte: this.daysAgo(30) } },
      select: { createdAt: true },
    });
    const usersByDay = this.groupByDay(
      users30d.map((u) => u.createdAt),
      30,
    );

    return {
      calls: callsByDay,
      minutes: minutesByDay,
      newUsers: usersByDay,
    };
  }

  // ── Customers ────────────────────────────────────────
  async getCustomers(pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const [total, users] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.user.findMany({
        orderBy: { createdAt: 'desc' },
        include: {
          projects: {
            include: { apiKeys: true, calls: true },
          },
          subscriptions: {
            where: { status: 'ACTIVE' },
            orderBy: { createdAt: 'desc' },
            take: 1,
            select: { planName: true, planType: true },
          },
          creditWallet: { select: { balance: true } },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = await Promise.all(
      users.map(async (u) => {
        const projects = u.projects;
        const totalMinutes = projects
          .flatMap((p) => p.calls)
          .reduce(
            (sum, c) =>
              sum +
              (c.startedAt && c.endedAt
                ? this.diffMinutes(c.startedAt, c.endedAt)
                : 0),
            0,
          );
        return {
          id: u.id,
          name: u.name,
          email: u.email,
          avatarUrl: u.avatarUrl,
          companyName: u.companyName,
          profileCompleted: u.profileCompleted,
          plan: u.subscriptions[0]?.planName ?? null,
          planType: u.subscriptions[0]?.planType ?? null,
          creditBalance: u.creditWallet?.balance ?? 0,
          status: u.status,
          role: u.role,
          createdAt: u.createdAt,
          lastActiveAt: u.lastActiveAt,
          projects: projects.map((p) => ({
            id: p.id,
            name: p.name,
            apiKeys: p.apiKeys.length,
            calls: p.calls.length,
          })),
          projectCount: projects.length,
          minutesUsed: Math.round(totalMinutes),
        };
      }),
    );
    return {
      data,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async updateCustomerStatus(userId: string, status: 'ACTIVE' | 'SUSPENDED') {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { status },
    });
    await this.logAudit(
      status === 'SUSPENDED' ? 'ACCOUNT_SUSPENDED' : 'ACCOUNT_RESUMED',
      userId,
      { userId, status },
    );
    return user;
  }

  // ── Single customer detail (usage + billing rates + discount) ──
  async getCustomer(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('Customer not found');

    const [usage, discount, subscription] = await Promise.all([
      this.usageBilling.getCurrentUsage(userId),
      this.getCustomerDiscount(userId),
      this.subscriptions.getOverview(userId),
    ]);

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      companyName: user.companyName,
      jobTitle: user.jobTitle,
      country: user.country,
      companyWebsite: user.companyWebsite,
      expectedUsageRange: user.expectedUsageRange,
      primaryUseCase: user.primaryUseCase,
      profileCompleted: user.profileCompleted,
      status: user.status,
      createdAt: user.createdAt,
      usage,
      subscription,
      discount,
      // Pay-as-you-go leftovers, shown for context only.
      legacy: {
        hasSavedCard: !!user.razorpayTokenId,
        spendingLimitPaise: user.spendingLimitPaise,
      },
    };
  }

  // ── Customer-specific discount ──────────────────────
  /**
   * The customer's latest discount record (active or not — so the admin UI
   * can show a "Disabled" state). The percentage is applied to plan,
   * renewal and top-up prices at checkout (before GST).
   */
  async getCustomerDiscount(userId: string) {
    const discount = await this.customerDiscounts.getLatestDiscount(userId);
    return {
      discount,
      appliesTo: 'Plan purchases, renewals and credit top-ups (before GST).',
    };
  }

  async setCustomerDiscount(
    userId: string,
    adminId: string,
    input: SetDiscountInput,
  ) {
    await this.customerDiscounts.setDiscount(userId, adminId, input);
    this.autoRenew.inBackground(
      () => this.autoRenew.syncCustomer(userId),
      `discount ${userId}`,
    );
    return this.getCustomerDiscount(userId);
  }

  async disableCustomerDiscount(userId: string, adminId: string) {
    await this.customerDiscounts.disableDiscount(userId, adminId);
    this.autoRenew.inBackground(
      () => this.autoRenew.syncCustomer(userId),
      `discount ${userId}`,
    );
    return this.getCustomerDiscount(userId);
  }

  // ── Live calls ───────────────────────────────────────
  async getLiveCalls(pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const where = {
      status: {
        in: [CallStatus.RINGING, CallStatus.ACCEPTED, CallStatus.INITIATED],
      },
    };
    const [total, calls] = await Promise.all([
      this.prisma.call.count({ where }),
      this.prisma.call.findMany({
        where: { status: { in: ['RINGING', 'ACCEPTED', 'INITIATED'] } },
        orderBy: { createdAt: 'desc' },
        include: { project: { include: { owner: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    const data = calls.map((c) => ({
      id: c.id,
      type: c.type,
      status: c.status,
      startedAt: c.startedAt,
      createdAt: c.createdAt,
      company: c.project?.owner?.name || c.project?.owner?.email || 'Unknown',
      participants: this.callGateway.getRoomParticipantCount(c.id),
      duration: c.startedAt ? this.nowDiffMinutes(c.startedAt) : 0,
    }));
    return {
      data,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  async endCall(callId: string) {
    return this.callService.endCall(callId);
  }

  // ── Usage ────────────────────────────────────────────
  async getUsage() {
    const now = new Date();
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [callsToday, callsMonth, endedToday, endedMonth] = await Promise.all([
      this.prisma.call.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.call.count({ where: { createdAt: { gte: startOfMonth } } }),
      this.prisma.call.findMany({
        where: { startedAt: { not: null }, endedAt: { gte: startOfDay } },
        select: { startedAt: true, endedAt: true },
      }),
      this.prisma.call.findMany({
        where: { startedAt: { not: null }, endedAt: { gte: startOfMonth } },
        select: { startedAt: true, endedAt: true },
      }),
    ]);

    const minutesToday = Math.round(
      endedToday.reduce(
        (s, c) => s + this.diffMinutes(c.startedAt!, c.endedAt!),
        0,
      ),
    );
    const minutesMonth = Math.round(
      endedMonth.reduce(
        (s, c) => s + this.diffMinutes(c.startedAt!, c.endedAt!),
        0,
      ),
    );

    const totalDuration = endedMonth.reduce(
      (s, c) => s + this.diffMinutes(c.startedAt!, c.endedAt!),
      0,
    );
    const avgDuration =
      callsMonth > 0 ? Math.round(totalDuration / callsMonth) : 0;

    return {
      minutesToday,
      minutesMonth,
      callsToday,
      callsMonth,
      avgDuration,
    };
  }

  // ── Health ───────────────────────────────────────────
  async getHealth() {
    let dbOk = true;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbOk = false;
    }

    const memory = process.memoryUsage();
    const ws = this.callGateway.getMetrics();
    // Real check: is TURN configured, and does credential generation
    // actually work — not a hardcoded "healthy". This does not verify the
    // TURN server is reachable over the network.
    const turn = this.turnService.getHealthStatus();

    return {
      node: { status: 'healthy', uptime: process.uptime() },
      database: { status: dbOk ? 'healthy' : 'unhealthy' },
      turn: {
        status: !turn.configured
          ? 'not_configured'
          : turn.credentialGeneration === 'ok'
            ? 'healthy'
            : 'unhealthy',
        configured: turn.configured,
        credentialGeneration: turn.credentialGeneration,
      },
      websocket: { clients: ws.clients, inCall: ws.inCall, rooms: ws.rooms },
      // No real CPU/network metrics here — those need to come from the VPS
      // monitoring layer. `process.cpuUsage()` is cumulative CPU-seconds
      // since process start, not a percentage of anything, so it isn't
      // reported here rather than showing a number that looks like one.
      memory: {
        usage: Math.round(memory.heapUsed / 1024 / 1024),
        total: Math.round(memory.heapTotal / 1024 / 1024),
      },
    };
  }

  // ── Monitoring (live operational metrics) ────────────
  //
  // Every field is labeled by how it was obtained, and the three kinds are
  // never mixed:
  //   - measured:   read directly from a real source (DB, socket gateway,
  //                 the client's own WebRTC stats).
  //   - calculated: derived from measured data (percentages, averages).
  //   - not available: `value: null, available: false` — for anything this
  //                 process cannot itself observe (host CPU/RAM/network,
  //                 coturn session stats). Never a fabricated 0 — 0 means
  //                 "measured, and the answer was zero"; null means "not
  //                 measured at all".
  //
  // `server.*` host CPU/RAM/network/disk are now sourced from OCI Monitoring
  // via OciMonitoringService (Instance Principal auth, its own internal TTL
  // cache) — see that service for the full explanation of what "available"
  // means there and the network/disk rate-conversion caveat. `turn.*`
  // (coturn active sessions/bandwidth) is a separate, still-unwired source
  // (coturn's REST admin API isn't enabled) and stays an explicit
  // not-available placeholder for the same reason `server.*` used to be.
  async getMonitoring() {
    const now = new Date();
    const minuteAgo = new Date(now.getTime() - 60_000);
    const startOfDay = new Date(now);
    startOfDay.setHours(0, 0, 0, 0);
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [
      activeCalls,
      activePlaygroundCalls,
      callsToday,
      callsMonth,
      callsCreatedLastMinute,
      playgroundCreatedLastMinute,
      playgroundExpiredToday,
      endedMonth,
      dbConnections,
      webrtcStats,
      oci,
    ] = await Promise.all([
      this.prisma.call.count({
        where: { status: { in: ['RINGING', 'ACCEPTED', 'INITIATED'] } },
      }),
      this.prisma.call.count({
        where: {
          source: 'PLAYGROUND',
          status: { in: ['RINGING', 'ACCEPTED', 'INITIATED'] },
          expiresAt: { gt: now },
        },
      }),
      this.prisma.call.count({ where: { createdAt: { gte: startOfDay } } }),
      this.prisma.call.count({ where: { createdAt: { gte: startOfMonth } } }),
      this.prisma.call.count({ where: { createdAt: { gte: minuteAgo } } }),
      this.prisma.call.count({
        where: { source: 'PLAYGROUND', createdAt: { gte: minuteAgo } },
      }),
      this.prisma.callEvent.count({
        where: {
          event: 'CALL_EXPIRED',
          createdAt: { gte: startOfDay },
          call: { source: 'PLAYGROUND' },
        },
      }),
      this.prisma.call.findMany({
        where: { startedAt: { not: null }, endedAt: { gte: startOfMonth } },
        select: { startedAt: true, endedAt: true },
      }),
      this.getDbConnectionCount(),
      this.getWebrtcStats(startOfMonth),
      this.ociMonitoring.getSnapshot(),
    ]);

    const totalDuration = endedMonth.reduce(
      (s, c) => s + this.diffMinutes(c.startedAt!, c.endedAt!),
      0,
    );
    const callMinutesMonth = Math.round(totalDuration);
    const avgCallDurationSeconds =
      endedMonth.length > 0
        ? Math.round((totalDuration / endedMonth.length) * 60)
        : 0;

    const ws = this.callGateway.getMetrics();
    const turn = this.turnService.getHealthStatus();

    return {
      server: {
        cpu: oci.cpu,
        memory: oci.memory,
        network: oci.network,
        disk: oci.disk,
        // Uptime IS something this process can measure about itself.
        uptime: { value: process.uptime(), available: true, source: 'node' },
        oci: {
          connected: oci.connected,
          checkedAt: oci.checkedAt,
          error: oci.error,
        },
      },
      calls: {
        active: activeCalls, // measured
        createdLastMinute: callsCreatedLastMinute,
        // Real concurrent participants from the gateway, not an assumed
        // "2 per call" — matches getOverview's activeParticipants.
        concurrentUsers: ws.inCall, // measured
        today: callsToday, // measured
        month: callsMonth, // measured
        minutesMonth: callMinutesMonth, // calculated (sum of measured durations)
        avgDurationSeconds: avgCallDurationSeconds, // calculated
      },
      playground: {
        activeCalls: activePlaygroundCalls,
        callsCreatedLastMinute: playgroundCreatedLastMinute,
        callsExpiredToday: playgroundExpiredToday,
        enabled:
          (process.env.PLAYGROUND_ENABLED ?? 'true').toLowerCase() === 'true',
      },
      webrtc: webrtcStats,
      turn: {
        configured: turn.configured,
        credentialGeneration: turn.credentialGeneration,
        available: false,
        activeSessions: null,
        bytesReceived: null,
        bytesSent: null,
        bandwidthMbps: null,
      },
      websocket: {
        clients: ws.clients,
        inCall: ws.inCall,
        rooms: ws.rooms,
        authFailures: ws.authFailures,
      },
      database: { connections: dbConnections },
    };
  }

  /**
   * Two independent client-reported classifications, computed from one scan
   * of CallEvent so a single busy month doesn't cost two full queries:
   *
   *  - P2P vs TURN, from WEBRTC_TRANSPORT (see CallService.
   *    recordWebrtcTransport). A 1:1 call can get up to two reports, one per
   *    participant, that don't necessarily agree — if EITHER side reported
   *    TURN, media relayed through TURN for at least that leg, so the call
   *    counts as TURN ("sticky": a later P2P report never downgrades it).
   *
   *  - ICE success/failure, from WEBRTC_ICE_SUCCESS / WEBRTC_ICE_FAILED (see
   *    CallService.recordWebrtcIceOutcome). A call that failed and then
   *    recovered via ICE restart has both events — it counts as successful
   *    (a SUCCESS report always wins over a FAILED one), since what this
   *    reliability number is for is "did the call eventually connect".
   *
   * Each percentage is independently null when its own event type has zero
   * reports this month — a month with transport data but no ICE data yet
   * (e.g. rolled out mid-month) shows P2P/TURN numbers with ICE still
   * "not available", rather than either faking one from the other's
   * presence or hiding both behind one shared flag.
   */
  private async getWebrtcStats(since: Date) {
    const events = await this.prisma.callEvent.findMany({
      where: {
        event: {
          in: ['WEBRTC_TRANSPORT', 'WEBRTC_ICE_SUCCESS', 'WEBRTC_ICE_FAILED'],
        },
        createdAt: { gte: since },
      },
      select: { callId: true, event: true, metadata: true },
    });

    const transportByCall = new Map<string, 'P2P' | 'TURN'>();
    const iceByCall = new Map<string, 'SUCCESS' | 'FAILED'>();

    for (const e of events) {
      if (e.event === 'WEBRTC_TRANSPORT') {
        const metadata = e.metadata as { transport?: unknown } | null;
        const transport = metadata?.transport;
        if (transport !== 'P2P' && transport !== 'TURN') continue;
        if (transport === 'TURN' || transportByCall.get(e.callId) !== 'TURN') {
          transportByCall.set(e.callId, transport);
        }
      } else {
        const outcome = e.event === 'WEBRTC_ICE_SUCCESS' ? 'SUCCESS' : 'FAILED';
        if (outcome === 'SUCCESS' || iceByCall.get(e.callId) !== 'SUCCESS') {
          iceByCall.set(e.callId, outcome);
        }
      }
    }

    let p2pCalls = 0;
    let turnCalls = 0;
    for (const t of transportByCall.values()) {
      if (t === 'TURN') turnCalls++;
      else p2pCalls++;
    }
    const totalTransport = p2pCalls + turnCalls;

    let iceSuccessful = 0;
    let iceFailed = 0;
    for (const o of iceByCall.values()) {
      if (o === 'SUCCESS') iceSuccessful++;
      else iceFailed++;
    }
    const totalIce = iceSuccessful + iceFailed;

    return {
      available: totalTransport > 0 || totalIce > 0,
      p2pCalls,
      turnCalls,
      p2pPercent:
        totalTransport > 0
          ? Math.round((p2pCalls / totalTransport) * 1000) / 10
          : null,
      turnPercent:
        totalTransport > 0
          ? Math.round((turnCalls / totalTransport) * 1000) / 10
          : null,
      iceSuccessRate:
        totalIce > 0
          ? Math.round((iceSuccessful / totalIce) * 1000) / 10
          : null,
      iceFailureRate:
        totalIce > 0 ? Math.round((iceFailed / totalIce) * 1000) / 10 : null,
    };
  }

  private async getDbConnectionCount(): Promise<number | null> {
    try {
      const rows = await this.prisma.$queryRaw<{ count: bigint }[]>`
        SELECT count(*)::bigint AS count
        FROM pg_stat_activity
        WHERE datname = current_database()
      `;
      return Number(rows[0]?.count ?? 0);
    } catch {
      return null;
    }
  }

  // ── Alerts ───────────────────────────────────────────
  async getAlerts() {
    const memPct = Math.round(
      (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100,
    );
    const alerts: {
      id: string;
      type: string;
      severity: string;
      message: string;
    }[] = [];
    const turn = this.turnService.getHealthStatus();
    if (!turn.configured) {
      alerts.push({
        id: 'turn',
        type: 'TURN not configured',
        severity: 'warning',
        message:
          'TURN_SECRET is not set — calls behind restrictive NATs/firewalls may fail to connect.',
      });
    } else if (turn.credentialGeneration !== 'ok') {
      alerts.push({
        id: 'turn',
        type: 'TURN credential generation failing',
        severity: 'critical',
        message:
          'TURN is configured but credential generation is failing — check TURN_SECRET/TURN_SERVER.',
      });
    }

    if (memPct > 80) {
      alerts.push({
        id: 'memory',
        type: 'Memory > 80%',
        severity: 'warning',
        message: `Memory usage is ${memPct}%`,
      });
    }
    return alerts;
  }

  // ── Audit logs ───────────────────────────────────────
  async getAuditLogs(pageValue?: string) {
    const page = Math.max(1, parseInt(pageValue ?? '', 10) || 1);
    const pageSize = Math.min(
      100,
      Math.max(1, Number(process.env.PAGE_SIZE) || 10),
    );
    const [total, logs] = await Promise.all([
      this.prisma.auditLog.count(),
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { actor: { select: { name: true, email: true } } },
      }),
    ]);
    const data = logs.map((l) => ({
      id: l.id,
      action: l.action,
      actor: l.actor?.name || l.actor?.email || 'System',
      metadata: l.metadata,
      createdAt: l.createdAt,
    }));
    return {
      data,
      total,
      page,
      pageSize,
      pageCount: Math.max(1, Math.ceil(total / pageSize)),
    };
  }

  // ── Settings ─────────────────────────────────────────
  async getSettings() {
    const maintenanceMode = await this.getSetting<boolean>('maintenanceMode');
    const announcement = await this.getSetting<string | null>('announcement');

    return {
      maintenanceMode: maintenanceMode ?? false,
      announcement: announcement ?? null,
    };
  }

  async updateSettings(body: any) {
    if (typeof body.maintenanceMode === 'boolean') {
      await this.setSetting('maintenanceMode', body.maintenanceMode);
    }
    if (body.announcement !== undefined) {
      await this.setSetting('announcement', body.announcement ?? null);
    }
    return {
      maintenanceMode:
        (await this.getSetting<boolean>('maintenanceMode')) ?? false,
      announcement: await this.getSetting<string | null>('announcement'),
    };
  }

  private async getSetting<T>(key: string): Promise<T | null> {
    const row = await this.prisma.platformSetting.findUnique({
      where: { key },
    });
    return (row?.value as T | null) ?? null;
  }

  private async setSetting(key: string, value: unknown) {
    await this.prisma.platformSetting.upsert({
      where: { key },
      update: { value: value as any },
      create: { key, value: value as any },
    });
  }

  // ── Helpers ──────────────────────────────────────────
  private async logAudit(action: any, actorId: string, metadata: any) {
    await this.prisma.auditLog.create({ data: { action, actorId, metadata } });
  }

  private diffMinutes(start: Date, end: Date): number {
    return (end.getTime() - start.getTime()) / 60000;
  }

  private nowDiffMinutes(start: Date): number {
    return Math.max(0, (Date.now() - start.getTime()) / 60000);
  }

  private daysAgo(n: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  }

  private groupByDay(dates: Date[], days: number) {
    const result: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const count = dates.filter(
        (dt) =>
          dt.getDate() === d.getDate() &&
          dt.getMonth() === d.getMonth() &&
          dt.getFullYear() === d.getFullYear(),
      ).length;
      result.push({ label, value: count });
    }
    return result;
  }

  private groupByDayMinutes(
    calls: { startedAt: Date | null; endedAt: Date | null }[],
    days: number,
  ) {
    const result: { label: string; value: number }[] = [];
    const now = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(now.getDate() - i);
      const label = `${d.getMonth() + 1}/${d.getDate()}`;
      const minutes = calls
        .filter(
          (c) =>
            c.endedAt &&
            c.endedAt.getDate() === d.getDate() &&
            c.endedAt.getMonth() === d.getMonth() &&
            c.endedAt.getFullYear() === d.getFullYear(),
        )
        .reduce(
          (s, c) =>
            s +
            (c.startedAt && c.endedAt
              ? this.diffMinutes(c.startedAt, c.endedAt)
              : 0),
          0,
        );
      result.push({ label, value: Math.round(minutes) });
    }
    return result;
  }
}
