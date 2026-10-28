'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../../lib/api';
import {
  DetailList,
  ErrorNote,
  Loading,
  PageHeader,
  Panel,
  Pill,
  Section,
  Stat,
  Table,
  fmtNumber,
} from '../../dashboard/_ui';

type HealthData = {
  node: { status: string; uptime: number };
  database: { status: string };
  turn: { status: string; configured: boolean; credentialGeneration: string };
  websocket: { clients: number; inCall?: number; rooms?: number };
  memory: { usage: number; total: number };
};

type Alert = {
  id: string;
  type: string;
  severity: string;
  message: string;
};

// A "not available" field always carries `available: false` and a null
// value — see admin.service.ts's getMonitoring doc comment. Never inferred
// from a missing key; the API always returns the shape explicitly.
type NotAvailable<T> = { available: boolean } & T;

type Capacity = { limit: number; unit: string } | null;

type MonitoringData = {
  server: {
    cpu: NotAvailable<{ value: number | null; source: string; unit?: string; capacity?: Capacity }>;
    memory: NotAvailable<{ value: number | null; source: string; unit?: string; capacity?: Capacity }>;
    network: NotAvailable<{ rxMbps: number | null; txMbps: number | null; source: string; capacityMbps?: number | null }>;
    disk: NotAvailable<{
      readMBps: number | null;
      writeMBps: number | null;
      source: string;
      storage: { usedBytes: number | null; totalBytes: number | null; available: false };
    }>;
    uptime: NotAvailable<{ value: number; source: string }>;
    // Whether the last OCI Monitoring API call actually succeeded — never
    // inferred from env vars being set. See OciMonitoringService.
    oci: { connected: boolean; checkedAt: string; error: string | null };
  };
  calls: {
    active: number;
    concurrentUsers: number;
    today: number;
    month: number;
    minutesMonth: number;
    avgDurationSeconds: number;
  };
  webrtc: NotAvailable<{
    p2pCalls: number;
    turnCalls: number;
    p2pPercent: number | null;
    turnPercent: number | null;
    iceSuccessRate: number | null;
    iceFailureRate: number | null;
    // Absent from servers older than the connectivity telemetry.
    unknownCalls?: number;
    failureReasons?: Record<string, number>;
    setupMsP50?: number | null;
    setupMsP95?: number | null;
    mediaVerifiedPercent?: number | null;
    iceRestartCalls?: number;
    iceRestartRecoveryRate?: number | null;
  }>;
  turn: NotAvailable<{
    configured: boolean;
    credentialGeneration: string;
    activeSessions: number | null;
    bytesReceived: number | null;
    bytesSent: number | null;
    bandwidthMbps: number | null;
  }>;
  database: { connections: number | null };
};

const POLL_MS = 5000;

export default function AdminHealthPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [monitoring, setMonitoring] = useState<MonitoringData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = () => {
    Promise.all([
      api.get('/admin/health'),
      api.get('/admin/alerts'),
      api.get('/admin/monitoring'),
    ])
      .then(([h, a, m]) => {
        setHealth(h.data);
        setAlerts(a.data);
        setMonitoring(m.data);
        setError('');
      })
      .catch((e) => {
        // Only blank the page for a first-load failure. A transient error on
        // a later poll just keeps the last good data on screen rather than
        // replacing a live dashboard with an error page every few seconds.
        setHealth((prev) => {
          if (!prev) setError(e?.response?.data?.message || e?.message || 'Failed to load');
          return prev;
        });
      })
      .finally(() => setLoading(false));
  };

  // Polled, not pushed over a socket — an admin dashboard checking in every
  // few seconds doesn't need millisecond-fresh numbers, and this needs no
  // new infrastructure (no Redis, no admin-facing socket channel) to add.
  useEffect(() => {
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, []);

  const header = (
    <PageHeader title="System health" description={`Live infrastructure status · refreshes every ${POLL_MS / 1000}s`} />
  );

  if (loading) {
    return (
      <>
        {header}
        <Loading label="Loading health…" />
      </>
    );
  }

  if (error || !health) {
    return (
      <>
        {header}
        <ErrorNote message={error || 'Failed to load'} />
      </>
    );
  }

  const m = monitoring;

  const services: { name: string; status: string; ok: boolean; detail: ReactNode }[] = [
    { name: 'Node server', status: health.node.status, ok: health.node.status === 'healthy', detail: '—' },
    { name: 'Database', status: health.database.status, ok: health.database.status === 'healthy', detail: '—' },
    {
      name: 'TURN server',
      status: health.turn.status,
      ok: health.turn.status === 'healthy',
      detail: health.turn.configured
        ? `Credential generation: ${health.turn.credentialGeneration}`
        : 'Not configured',
    },
  ];
  if (m) {
    services.push({
      name: 'OCI Monitoring',
      status: m.server.oci.connected ? 'connected' : 'unavailable',
      ok: m.server.oci.connected,
      detail: m.server.oci.error ?? '—',
    });
  }

  return (
    <>
      {header}

      {/* Active calls is the single most important operational number, so
          the live counters lead the page. */}
      <Section>
        <Panel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-5">
            {m && <Stat label="Active calls" value={fmtNumber(m.calls.active)} />}
            {m && <Stat label="Concurrent users" value={fmtNumber(m.calls.concurrentUsers)} />}
            <Stat label="WebSocket clients" value={fmtNumber(health.websocket.clients)} />
            <Stat label="Active call rooms" value={fmtNumber(health.websocket.rooms ?? 0)} />
            {/* The NestJS process's own heap, distinct from host RAM below. */}
            <Stat label="Node heap memory" value={`${health.memory.usage} / ${health.memory.total}`} unit="MB" />
          </div>
        </Panel>
      </Section>

      <Section title="Alerts">
        {alerts.length === 0 ? (
          <Panel>
            <p className="text-sm text-emerald-700">All systems operational. No active alerts.</p>
          </Panel>
        ) : (
          <Table
            rows={alerts}
            rowKey={(a) => a.id}
            columns={[
              {
                key: 'severity',
                label: 'Severity',
                render: (a) => (
                  <Pill tone={/crit|high|error/i.test(a.severity) ? 'danger' : 'warning'}>{a.severity}</Pill>
                ),
              },
              { key: 'type', label: 'Type', className: 'text-[#6B6478]', render: (a) => a.type },
              { key: 'message', label: 'Message', className: 'whitespace-normal', render: (a) => a.message },
            ]}
          />
        )}
      </Section>

      <Section title="Services">
        <Table
          rows={services}
          rowKey={(s) => s.name}
          columns={[
            { key: 'name', label: 'Service', className: 'font-medium', render: (s) => s.name },
            { key: 'status', label: 'Status', render: (s) => <Pill tone={s.ok ? 'success' : 'danger'}>{s.status}</Pill> },
            { key: 'detail', label: 'Detail', className: 'whitespace-normal text-[#6B6478]', render: (s) => s.detail },
          ]}
        />
      </Section>

      {/* Every row is either a real measured/calculated number, or an
          explicit "Not available" — never a fabricated 0. See
          admin.service.ts getMonitoring() for what backs each one. */}
      {m && (
        <div className="grid gap-x-6 lg:grid-cols-2">
          <Section title="Server">
            <Panel>
              <DetailList
                items={[
                  {
                    label: 'CPU',
                    value: metric(m.server.cpu.available, fmtPct(m.server.cpu.value), {
                      suffix: m.server.cpu.capacity ? ` / ${m.server.cpu.capacity.limit}% safe limit` : undefined,
                      note: !m.server.cpu.available ? m.server.cpu.source.toUpperCase() + ' monitoring not connected' : undefined,
                    }),
                  },
                  {
                    label: 'Memory',
                    value: metric(
                      m.server.memory.available,
                      m.server.memory.capacity && m.server.memory.value != null
                        ? `${fmtGB((m.server.memory.value / 100) * m.server.memory.capacity.limit)} / ${m.server.memory.capacity.limit} GB`
                        : fmtPct(m.server.memory.value),
                      {
                        note: !m.server.memory.available
                          ? m.server.memory.source.toUpperCase() + ' monitoring not connected'
                          : undefined,
                      },
                    ),
                  },
                  {
                    label: 'Network RX',
                    value: metric(m.server.network.available, fmtMbps(m.server.network.rxMbps), {
                      suffix: m.server.network.capacityMbps ? ` / ${m.server.network.capacityMbps} Mbps` : undefined,
                    }),
                  },
                  {
                    label: 'Network TX',
                    value: metric(m.server.network.available, fmtMbps(m.server.network.txMbps), {
                      suffix: m.server.network.capacityMbps ? ` / ${m.server.network.capacityMbps} Mbps` : undefined,
                    }),
                  },
                  { label: 'Disk read', value: metric(m.server.disk.available, fmtMBps(m.server.disk.readMBps)) },
                  { label: 'Disk write', value: metric(m.server.disk.available, fmtMBps(m.server.disk.writeMBps)) },
                  {
                    label: 'Disk storage',
                    value: metric(false, '', {
                      note: 'not exposed by oci_computeagent (needs the oci_blockstore namespace)',
                    }),
                  },
                  { label: 'Uptime', value: metric(m.server.uptime.available, formatUptime(m.server.uptime.value)) },
                ]}
              />
            </Panel>
          </Section>

          <Section title="Calls">
            <Panel>
              <DetailList
                items={[
                  { label: 'Calls today', value: m.calls.today.toLocaleString() },
                  { label: 'Calls this month', value: m.calls.month.toLocaleString() },
                  { label: 'Call minutes (month)', value: m.calls.minutesMonth.toLocaleString() },
                  { label: 'Avg duration', value: formatDuration(m.calls.avgDurationSeconds) },
                ]}
              />
            </Panel>
          </Section>

          <Section title="WebRTC">
            <Panel>
              <DetailList
                items={[
                  { label: 'P2P calls', value: metric(m.webrtc.p2pPercent != null, String(m.webrtc.p2pCalls)) },
                  { label: 'TURN calls', value: metric(m.webrtc.p2pPercent != null, String(m.webrtc.turnCalls)) },
                  { label: 'P2P %', value: metric(m.webrtc.p2pPercent != null, fmtPct(m.webrtc.p2pPercent)) },
                  { label: 'TURN %', value: metric(m.webrtc.turnPercent != null, fmtPct(m.webrtc.turnPercent)) },
                  { label: 'ICE success', value: metric(m.webrtc.iceSuccessRate != null, fmtPct(m.webrtc.iceSuccessRate)) },
                  { label: 'ICE failures', value: metric(m.webrtc.iceFailureRate != null, fmtPct(m.webrtc.iceFailureRate)) },
                  {
                    label: 'Path unconfirmed',
                    value: metric(m.webrtc.unknownCalls != null, String(m.webrtc.unknownCalls ?? ''), {
                      note: 'Only one side reported; not counted as P2P or TURN',
                    }),
                  },
                  {
                    label: 'Setup p50 / p95',
                    value: metric(m.webrtc.setupMsP50 != null, `${fmtMs(m.webrtc.setupMsP50)} / ${fmtMs(m.webrtc.setupMsP95)}`),
                  },
                  {
                    label: 'Media verified',
                    value: metric(m.webrtc.mediaVerifiedPercent != null, fmtPct(m.webrtc.mediaVerifiedPercent ?? null)),
                  },
                  {
                    label: 'ICE restarts → recovered',
                    value: metric(
                      !!m.webrtc.iceRestartCalls,
                      `${m.webrtc.iceRestartCalls ?? 0} calls · ${fmtPct(m.webrtc.iceRestartRecoveryRate ?? null)}`,
                    ),
                  },
                  ...(m.webrtc.failureReasons && Object.keys(m.webrtc.failureReasons).length > 0
                    ? [
                        {
                          label: 'Failure reasons',
                          value: Object.entries(m.webrtc.failureReasons)
                            .sort((a, b) => b[1] - a[1])
                            .map(([reason, count]) => `${reason} ${count}`)
                            .join(' · '),
                        },
                      ]
                    : []),
                ]}
              />
              {!m.webrtc.available && (
                <p className="mt-2 text-xs text-[#6B6478]">
                  No calls have reported a transport or ICE outcome yet this month.
                </p>
              )}
            </Panel>
          </Section>

          <Section title="TURN">
            <Panel>
              <DetailList
                items={[
                  { label: 'Active sessions', value: metric(m.turn.available, String(m.turn.activeSessions ?? '')) },
                  { label: 'Bandwidth', value: metric(m.turn.available, fmtMbps(m.turn.bandwidthMbps)) },
                  { label: 'Bytes received', value: metric(m.turn.available, fmtBytes(m.turn.bytesReceived)) },
                  { label: 'Bytes sent', value: metric(m.turn.available, fmtBytes(m.turn.bytesSent)) },
                ]}
              />
              {!m.turn.available && (
                <p className="mt-2 text-xs text-[#6B6478]">
                  {m.turn.configured
                    ? "coturn's REST admin/stats API isn't enabled yet."
                    : 'TURN is not configured.'}
                </p>
              )}
            </Panel>
          </Section>
        </div>
      )}
    </>
  );
}

/** A monitoring value, or an explicit "Not available" (never a fabricated 0). */
function metric(available: boolean, value: string, opts: { suffix?: string; note?: string } = {}): ReactNode {
  if (!available) {
    return (
      <span>
        <span className="text-[#6B6478]">Not available</span>
        {opts.note && <span className="block text-xs text-[#9C95A8]">{opts.note}</span>}
      </span>
    );
  }
  return (
    <span className="tabular-nums">
      {value}
      {opts.suffix && <span className="text-[#6B6478]">{opts.suffix}</span>}
    </span>
  );
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '—';
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  if (days === 0) return `${hours}h`;
  return `${days}d ${hours}h`;
}

function fmtPct(value: number | null): string {
  return value == null ? '' : `${value.toFixed(1)}%`;
}

function fmtMs(value: number | null | undefined): string {
  if (value == null) return '—';
  return value < 1000 ? `${value} ms` : `${(value / 1000).toFixed(1)} s`;
}

function fmtMbps(value: number | null): string {
  return value == null ? '' : `${value.toFixed(2)} Mbps`;
}

function fmtMBps(value: number | null): string {
  return value == null ? '' : `${value.toFixed(2)} MB/s`;
}

function fmtGB(value: number): string {
  return value.toFixed(2);
}

function fmtBytes(value: number | null): string {
  if (value == null) return '';
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)} GB`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)} MB`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)} KB`;
  return `${value} B`;
}
