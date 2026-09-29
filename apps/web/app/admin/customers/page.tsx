'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import { Pagination } from '../../components/ui/Pagination';

type Customer = { id: string; name: string | null; email: string; companyName: string | null; profileCompleted: boolean; hasPaymentMethod: boolean; status: string; lastActiveAt: string | null; projectCount: number; minutesUsed: number };

export default function AdminCustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState('');
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10); const [total, setTotal] = useState(0); const [pageCount, setPageCount] = useState(1);
  const load = () => { setLoading(true); api.get(`/admin/customers?page=${page}`).then((res) => { setCustomers(res.data.data ?? []); setTotal(res.data.total ?? 0); setPageCount(res.data.pageCount ?? 1); setPageSize(res.data.pageSize ?? 10); }).catch((e) => setError(e?.response?.data?.message || e?.message || 'Failed to load')).finally(() => setLoading(false)); };
  useEffect(load, [page]);
  const update = async (id: string, path: string, body: object) => { await api.patch(`/admin/customers/${id}/${path}`, body); load(); };
  if (loading) return <div className="text-[#3D3650] text-sm py-20 text-center">Loading customers…</div>;
  if (error) return <div className="py-20 text-center"><p className="text-red-600 text-sm">{error}</p></div>;
  return <div className="space-y-6"><header><h1 className="text-2xl font-bold text-[#170B2E]">Customers</h1><p className="text-[#3D3650] text-sm mt-1">{total} registered companies</p></header>
    <div className="rounded-xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}><div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="border-b border-[#E7DFF5] text-left">{['Company', 'Owner', 'Billing', 'Projects', 'Call Time (min)', 'Last Active', 'Status', 'Actions'].map((label) => <th key={label} className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">{label}</th>)}</tr></thead><tbody>{customers.map((c) => <tr key={c.id} className="border-b border-[#E7DFF5]/60"><td className="px-4 py-3 text-[#170B2E] font-medium"><Link href={`/admin/customers/${c.id}`} className="hover:text-[#7F40E8] hover:underline">{c.companyName || c.name || 'Unnamed'}</Link>{!c.profileCompleted && <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded border border-amber-500/40 text-amber-700">Profile incomplete</span>}</td><td className="px-4 py-3 text-[#3D3650]">{c.companyName && c.name ? <><span className="text-[#170B2E]">{c.name}</span><br /></> : null}{c.email}</td><td className="px-4 py-3"><span className={`text-[11px] px-2 py-1 rounded ${c.hasPaymentMethod ? 'text-emerald-700 border border-emerald-500/30' : 'text-[#3D3650] border border-[#E7DFF5]'}`}>{c.hasPaymentMethod ? 'Card on file' : 'No card'}</span></td><td className="px-4 py-3 text-[#3D3650]">{c.projectCount}</td><td className="px-4 py-3 text-[#3D3650]">{c.minutesUsed}</td><td className="px-4 py-3 text-[#3D3650]">{c.lastActiveAt ? new Date(c.lastActiveAt).toLocaleDateString() : '—'}</td><td className="px-4 py-3 text-[#3D3650]">{c.status}</td><td className="px-4 py-3"><button onClick={() => update(c.id, 'status', { status: c.status === 'SUSPENDED' ? 'ACTIVE' : 'SUSPENDED' })} className="text-[11px] px-2.5 py-1 rounded border border-red-500/40 text-red-600">{c.status === 'ACTIVE' ? 'Suspend' : 'Resume'}</button></td></tr>)}{customers.length === 0 && <tr><td colSpan={8} className="px-4 py-10 text-center text-[#3D3650]">No customers yet.</td></tr>}</tbody></table></div><div className="px-4 pb-4"><Pagination page={page} pageCount={pageCount} totalItems={total} pageSize={pageSize} onPageChange={setPage} /></div></div>
  </div>;
}
