'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import {
  Bell,
  CircleAlert,
  CircleCheck,
  Database,
  RefreshCw,
  Server,
  PhoneCall,
  Radio,
  Router,
} from 'lucide-react';

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

  if (loading) {
    return <div className="text-[#3D3650] text-sm py-20 text-center">Loading health…</div>;
  }

  if (error || !health) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  const components = [
    { name: 'Node Server', status: health.node.status, icon: CircleCheck },
    { name: 'Database', status: health.database.status, icon: Database },
    {
      name: 'TURN Server',
      status: health.turn.status,
      icon: RefreshCw,
      detail: health.turn.configured
        ? `Credential generation: ${health.turn.credentialGeneration}`
        : 'Not configured',
    },
  ];

  const m = monitoring;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[#170B2E]">System Health</h1>
        <p className="text-[#3D3650] text-sm mt-1">
          Live infrastructure status · refreshes every {POLL_MS / 1000}s
        </p>
      </header>

      {/* Active Calls is the single most important operational number —
          full width, front and center, above everything else. */}
      {m && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <HeroStat icon={PhoneCall} label="Active Calls" value={String(m.calls.active)} />
          <HeroStat icon={Radio} label="Concurrent Users" value={String(m.calls.concurrentUsers)} />
        </div>
      )}

      {/* Four monitoring cards: Infrastructure / Calls / WebRTC / TURN.
          Every row is either a real measured/calculated number, or an
          explicit "Not available" — never a fabricated 0. See
          admin.service.ts getMonitoring() for what backs each one. */}
      {m && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <StatCard icon={Server} title="Server">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-[#3D3650]">OCI Monitoring</span>
              <span
                className={`inline-flex items-center gap-1.5 text-xs font-mono px-2 py-0.5 rounded-full border ${
                  m.server.oci.connected
                    ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                    : 'bg-slate-500/10 text-[#3D3650] border-slate-600/40'
                }`}
                title={m.server.oci.error ?? undefined}
              >
                {m.server.oci.connected ? 'connected' : 'unavailable'}
              </span>
            </div>
            <StatRow
              label="CPU"
              na={!m.server.cpu.available}
              value={fmtPct(m.server.cpu.value)}
              suffix={m.server.cpu.capacity ? ` / ${m.server.cpu.capacity.limit}% safe limit` : undefined}
              note={!m.server.cpu.available ? m.server.cpu.source.toUpperCase() + ' monitoring not connected' : undefined}
            />
            <StatRow
              label="Memory"
              na={!m.server.memory.available}
              value={
                m.server.memory.capacity && m.server.memory.value != null
                  ? `${fmtGB((m.server.memory.value / 100) * m.server.memory.capacity.limit)} / ${m.server.memory.capacity.limit} GB`
                  : fmtPct(m.server.memory.value)
              }
              note={!m.server.memory.available ? m.server.memory.source.toUpperCase() + ' monitoring not connected' : undefined}
            />
            <StatRow
              label="Network RX"
              na={!m.server.network.available}
              value={fmtMbps(m.server.network.rxMbps)}
              suffix={m.server.network.capacityMbps ? ` / ${m.server.network.capacityMbps} Mbps` : undefined}
            />
            <StatRow
              label="Network TX"
              na={!m.server.network.available}
              value={fmtMbps(m.server.network.txMbps)}
              suffix={m.server.network.capacityMbps ? ` / ${m.server.network.capacityMbps} Mbps` : undefined}
            />
            <StatRow label="Disk read" na={!m.server.disk.available} value={fmtMBps(m.server.disk.readMBps)} />
            <StatRow label="Disk write" na={!m.server.disk.available} value={fmtMBps(m.server.disk.writeMBps)} />
            <StatRow
              label="Disk storage"
              na
              value=""
              note="not exposed by oci_computeagent (needs the oci_blockstore namespace)"
            />
            <StatRow label="Uptime" na={!m.server.uptime.available} value={formatUptime(m.server.uptime.value)} />
          </StatCard>

          <StatCard icon={PhoneCall} title="Calls">
            <StatRow label="Active calls" value={String(m.calls.active)} />
            <StatRow label="Calls today" value={m.calls.today.toLocaleString()} />
            <StatRow label="Calls this month" value={m.calls.month.toLocaleString()} />
            <StatRow label="Call minutes (month)" value={m.calls.minutesMonth.toLocaleString()} />
            <StatRow label="Avg duration" value={formatDuration(m.calls.avgDurationSeconds)} />
          </StatCard>

          <StatCard icon={Router} title="WebRTC">
            <StatRow label="P2P calls" na={m.webrtc.p2pPercent == null} value={String(m.webrtc.p2pCalls)} />
            <StatRow label="TURN calls" na={m.webrtc.p2pPercent == null} value={String(m.webrtc.turnCalls)} />
            <StatRow label="P2P %" na={m.webrtc.p2pPercent == null} value={fmtPct(m.webrtc.p2pPercent)} />
            <StatRow label="TURN %" na={m.webrtc.turnPercent == null} value={fmtPct(m.webrtc.turnPercent)} />
            <StatRow
              label="ICE success"
              na={m.webrtc.iceSuccessRate == null}
              value={fmtPct(m.webrtc.iceSuccessRate)}
            />
            <StatRow
              label="ICE failures"
              na={m.webrtc.iceFailureRate == null}
              value={fmtPct(m.webrtc.iceFailureRate)}
            />
            {!m.webrtc.available && (
              <p className="text-[11px] text-[#3D3650] mt-1">
                No calls have reported a transport or ICE outcome yet this month.
              </p>
            )}
          </StatCard>

          <StatCard icon={RefreshCw} title="TURN">
            <StatRow label="Active sessions" na={!m.turn.available} value={String(m.turn.activeSessions ?? '')} />
            <StatRow label="Bandwidth" na={!m.turn.available} value={fmtMbps(m.turn.bandwidthMbps)} />
            <StatRow label="Bytes received" na={!m.turn.available} value={fmtBytes(m.turn.bytesReceived)} />
            <StatRow label="Bytes sent" na={!m.turn.available} value={fmtBytes(m.turn.bytesSent)} />
            {!m.turn.available && (
              <p className="text-[11px] text-[#3D3650] mt-1">
                {m.turn.configured
                  ? "coturn's REST admin/stats API isn't enabled yet."
                  : 'TURN is not configured.'}
              </p>
            )}
          </StatCard>
        </div>
      )}

      {/* Alerts */}
      <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
        <p className="flex items-center gap-2 text-sm font-semibold text-[#170B2E] mb-3"><Bell size={16} /> Alerts</p>
        {alerts.length === 0 ? (
          <p className="text-sm text-emerald-700">All systems operational. No active alerts.</p>
        ) : (
          <div className="space-y-2">
            {alerts.map((a) => (
              <div key={a.id} className="flex items-center gap-2 text-sm text-amber-700">
                <CircleAlert size={16} />
                <span>{a.message}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Components */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {components.map((c) => (
          <div key={c.name} className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
            <div className="mb-2 text-[#6425C4]"><c.icon size={22} /></div>
            <p className="text-[#170B2E] font-medium">{c.name}</p>
            <span
              className={`inline-block mt-2 px-2.5 py-0.5 rounded-full text-[11px] font-mono border ${
                c.status === 'healthy'
                  ? 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30'
                  : 'bg-red-500/10 text-red-600 border-red-500/30'
              }`}
            >
              {c.status}
            </span>
            {c.detail && <p className="text-[11px] text-[#3D3650] mt-1.5">{c.detail}</p>}
          </div>
        ))}
      </div>

      {/* Node-process metrics not folded into the cards above — this is the
          NestJS process's own heap, distinct from (not-yet-available) host
          RAM in the Server card. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <MetricCard label="Node Heap Memory" value={`${health.memory.usage} / ${health.memory.total} MB`} />
        <MetricCard label="WebSocket Clients" value={String(health.websocket.clients)} />
        <MetricCard label="Active Call Rooms" value={String(health.websocket.rooms ?? 0)} />
      </div>
    </div>
  );
}

function HeroStat({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center gap-2 text-[#6425C4] mb-2">
        <Icon size={18} />
        <p className="text-xs text-[#3D3650] uppercase tracking-wide">{label}</p>
      </div>
      <p className="text-4xl font-bold text-[#170B2E]">{value}</p>
    </div>
  );
}

function StatCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <div className="flex items-center gap-2 text-[#6425C4] mb-4">
        <Icon size={18} />
        <p className="text-sm font-semibold text-[#170B2E]">{title}</p>
      </div>
      <div className="space-y-2.5">{children}</div>
    </div>
  );
}

function StatRow({
  label,
  value,
  suffix,
  na,
  note,
}: {
  label: string;
  value: string;
  suffix?: string;
  na?: boolean;
  note?: string;
}) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-[#3D3650]">{label}</span>
      {na ? (
        <span className="text-right">
          <span className="text-[#3D3650] font-mono text-xs">Not available</span>
          {note && <span className="block text-[10px] text-slate-700">{note}</span>}
        </span>
      ) : (
        <span className="text-[#170B2E] font-mono">
          {value}
          {suffix && <span className="text-[#3D3650]">{suffix}</span>}
        </span>
      )}
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <p className="text-xs text-[#3D3650]">{label}</p>
      <p className="text-2xl font-bold text-[#170B2E] mt-1">{value}</p>
    </div>
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
