'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Pagination } from '../../components/ui/Pagination';

type AuditLog = {
  id: string;
  action: string;
  actor: string;
  metadata: any;
  createdAt: string;
};

const ACTION_COLORS: Record<string, string> = {
  USER_REGISTERED: 'bg-[#7F40E8]/10 text-[#7F40E8] border-[#7F40E8]/30',
  PROJECT_CREATED: 'bg-[#7F40E8]/10 text-[#7F40E8] border-[#7F40E8]/30',
  API_KEY_GENERATED: 'bg-sky-500/10 text-sky-700 border-sky-500/30',
  PLAN_CHANGED: 'bg-amber-500/10 text-amber-700 border-amber-500/30',
  ACCOUNT_SUSPENDED: 'bg-red-500/10 text-red-600 border-red-500/30',
  ACCOUNT_RESUMED: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/30',
};

export default function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  useEffect(() => {
    api
      .get(`/admin/audit-logs?page=${page}`)
      .then((res) => {
        setLogs(res.data.data ?? []);
        setTotal(res.data.total ?? 0);
        setPageCount(res.data.pageCount ?? 1);
        setPageSize(res.data.pageSize ?? 10);
      })
      .catch((e) => setError(e?.response?.data?.message || e?.message || 'Failed to load'))
      .finally(() => setLoading(false));
  }, [page]);

  if (loading) {
    return <div className="text-[#3D3650] text-sm py-20 text-center">Loading audit logs…</div>;
  }

  if (error) {
    return (
      <div className="py-20 text-center">
        <p className="text-red-600 text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold text-[#170B2E]">Audit Logs</h1>
        <p className="text-[#3D3650] text-sm mt-1">Recent platform activity</p>
      </header>

      <div className="rounded-xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E7DFF5] text-left">
                <th className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Action</th>
                <th className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Actor</th>
                <th className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Details</th>
                <th className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Timestamp</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-[#E7DFF5]/60 hover:bg-[#7F40E8]/[0.03]">
                  <td className="px-4 py-3">
                    <span
                      className={`px-2 py-0.5 rounded-full text-[11px] font-mono border ${
                        ACTION_COLORS[l.action] || 'bg-slate-500/10 text-[#3D3650] border-slate-500/30'
                      }`}
                    >
                      {l.action.replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-[#3D3650]">{l.actor}</td>
                  <td className="px-4 py-3 text-[#3D3650] font-mono text-xs">
                    {l.metadata ? JSON.stringify(l.metadata) : '—'}
                  </td>
                  <td className="px-4 py-3 text-[#3D3650]">
                    {new Date(l.createdAt).toLocaleString()}
                  </td>
                </tr>
              ))}
              {logs.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-10 text-center text-[#3D3650]">
                    No audit logs yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-4">
          <Pagination
            page={page}
            pageCount={pageCount}
            totalItems={total}
            pageSize={pageSize}
            onPageChange={setPage}
          />
        </div>
      </div>
    </div>
  );
}
