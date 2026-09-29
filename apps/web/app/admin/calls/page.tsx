'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Pagination } from '../../components/ui/Pagination';

type LiveCall = { id: string; type: 'AUDIO' | 'VIDEO'; status: string; startedAt: string | null; createdAt: string; company: string; participants: number; duration: number };

export default function AdminCallsPage() {
  const [calls, setCalls] = useState<LiveCall[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  const load = () => {
    setLoading(true);
    api.get(`/admin/calls?page=${page}`).then((res) => {
      setCalls(res.data.data ?? []);
      setTotal(res.data.total ?? 0);
      setPageCount(res.data.pageCount ?? 1);
      setPageSize(res.data.pageSize ?? 10);
    }).catch((e) => setError(e?.response?.data?.message || e?.message || 'Failed to load')).finally(() => setLoading(false));
  };

  useEffect(load, [page]);

  const endCall = async (id: string) => { await api.patch(`/admin/calls/${id}/end`); load(); };
  if (loading) return <div className="text-[#3D3650] text-sm py-20 text-center">Loading live calls…</div>;
  if (error) return <div className="py-20 text-center"><p className="text-red-600 text-sm">{error}</p></div>;

  return <div className="space-y-6"><header><h1 className="text-2xl font-bold text-[#170B2E]">Live Calls</h1><p className="text-[#3D3650] text-sm mt-1">{total} active calls</p></header>
    <div className="rounded-xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[#E7DFF5] text-left">{['Call ID', 'Company', 'Participants', 'Type', 'Started At', 'Duration', 'Status', 'Actions'].map((label) => <th key={label} className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">{label}</th>)}</tr></thead><tbody>
      {calls.map((c) => <tr key={c.id} className="border-b border-[#E7DFF5]/60 hover:bg-[#7F40E8]/[0.03]"><td className="px-4 py-3 font-mono text-xs text-[#3D3650]">{c.id.slice(0, 8)}</td><td className="px-4 py-3 text-[#170B2E] font-medium">{c.company}</td><td className="px-4 py-3 text-[#3D3650]">{c.participants}</td><td className="px-4 py-3 text-[#3D3650]">{c.type}</td><td className="px-4 py-3 text-[#3D3650]">{c.startedAt ? new Date(c.startedAt).toLocaleTimeString() : '—'}</td><td className="px-4 py-3 text-[#3D3650]">{Math.round(c.duration)} min</td><td className="px-4 py-3 text-emerald-700">{c.status}</td><td className="px-4 py-3"><button onClick={() => endCall(c.id)} className="text-[11px] px-2.5 py-1 rounded border border-red-500/40 text-red-600 hover:bg-red-500/10">End Call</button></td></tr>)}
      {calls.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-[#3D3650]">No active calls right now.</td></tr>}
    </tbody></table></div><div className="px-4 pb-4"><Pagination page={page} pageCount={pageCount} totalItems={total} pageSize={pageSize} onPageChange={setPage} /></div></div>
  </div>;
}
