'use client';

import { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import {
  ADMIN_TABS,
  addAdmin,
  listAdmins,
  removeAdmin,
  updateAdmin,
  useCanWrite,
  type AdminAccessLevel,
  type AdminMember,
  type AdminPermissions,
} from '../../lib/admin-access';

const LEVELS: { value: AdminAccessLevel | ''; label: string }[] = [
  { value: '', label: 'No access' },
  { value: 'READ', label: 'Read' },
  { value: 'WRITE', label: 'Write' },
];

const errMsg = (e: any) => e?.response?.data?.message || e?.message || 'Something went wrong';

function accessSummary(a: AdminMember) {
  if (a.fullAccess || a.adminPermissions == null) return 'Full access';
  const parts = ADMIN_TABS.filter((t) => a.adminPermissions?.[t.key]).map(
    (t) => `${t.label}: ${a.adminPermissions![t.key] === 'WRITE' ? 'Write' : 'Read'}`,
  );
  return parts.length ? parts.join(', ') : 'Dashboard only';
}

export default function AdminAdminsPage() {
  const canWrite = useCanWrite();
  const myId = useAuthStore((s) => s.user?.userId);
  const [admins, setAdmins] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // null = form closed, 'new' = adding, otherwise the admin being edited
  const [editing, setEditing] = useState<AdminMember | 'new' | null>(null);

  const load = useCallback(() => {
    listAdmins()
      .then(setAdmins)
      .catch((e) => setError(errMsg(e)))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);

  const onRemove = async (a: AdminMember) => {
    if (!confirm(`Remove admin access for ${a.email}? Their account stays as a normal customer.`)) return;
    try {
      await removeAdmin(a.id);
      load();
    } catch (e) {
      alert(errMsg(e));
    }
  };

  if (loading) return <div className="text-[#3D3650] text-sm py-20 text-center">Loading admins…</div>;
  if (error) return <div className="py-20 text-center text-red-600 text-sm">{error}</div>;

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">Admins</h1>
          <p className="text-[#3D3650] text-sm mt-1">People who can access this admin panel, and what they can do in each section.</p>
        </div>
        {canWrite && editing === null && (
          <button
            onClick={() => setEditing('new')}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#7F40E8] px-4 py-2 text-sm font-medium text-white hover:bg-[#6425C4]"
          >
            <Plus size={16} aria-hidden="true" /> Add admin
          </button>
        )}
      </header>

      {editing !== null && (
        <AdminForm
          admin={editing === 'new' ? null : editing}
          onCancel={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <div className="rounded-xl border border-[#E7DFF5] overflow-hidden bg-white">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#E7DFF5] text-left">
                <th className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Person</th>
                <th className="px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650]">Access</th>
                {canWrite && <th className="px-4 py-3" />}
              </tr>
            </thead>
            <tbody>
              {admins.map((a) => (
                <tr key={a.id} className="border-b border-[#E7DFF5]/60 align-top">
                  <td className="px-4 py-3">
                    <p className="font-medium text-[#170B2E]">
                      {a.name || a.email}
                      {a.id === myId && <span className="ml-2 text-xs font-normal text-[#3D3650]">(you)</span>}
                    </p>
                    {a.name && <p className="text-xs text-[#3D3650]">{a.email}</p>}
                  </td>
                  <td className="px-4 py-3 text-[#3D3650]">{accessSummary(a)}</td>
                  {canWrite && (
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      {a.id !== myId && (
                        <>
                          <button onClick={() => setEditing(a)} className="text-sm text-[#6425C4] hover:underline">
                            Edit
                          </button>
                          <button onClick={() => onRemove(a)} className="ml-4 text-sm text-red-600 hover:underline">
                            Remove
                          </button>
                        </>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function AdminForm({ admin, onCancel, onSaved }: { admin: AdminMember | null; onCancel: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  // Editing a full-access admin starts with Write everywhere.
  const [perms, setPerms] = useState<AdminPermissions>(() =>
    admin?.adminPermissions ?? (admin ? Object.fromEntries(ADMIN_TABS.map((t) => [t.key, 'WRITE'])) : {}),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const setLevel = (key: keyof AdminPermissions, level: AdminAccessLevel | '') =>
    setPerms((p) => {
      const next = { ...p };
      if (level) next[key] = level;
      else delete next[key];
      return next;
    });

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      if (admin) await updateAdmin(admin.id, perms);
      else await addAdmin(email, perms);
      onSaved();
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-[#E7DFF5] bg-[#F8F4FD] p-5 space-y-4">
      <h2 className="font-semibold text-[#170B2E]">{admin ? `Edit access for ${admin.email}` : 'Add admin'}</h2>
      {!admin && (
        <label className="block max-w-sm">
          <span className="text-xs text-[#3D3650]">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className="mt-1 w-full rounded-lg border border-[#E7DFF5] bg-white px-3 py-2 text-sm text-[#170B2E] outline-none focus:border-[#7F40E8]"
          />
          <span className="mt-1 block text-xs text-[#3D3650]">They sign in with Google using this email.</span>
        </label>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_TABS.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2 border border-[#E7DFF5]">
            <span className="text-sm text-[#170B2E]">{t.label}</span>
            <select
              value={perms[t.key] ?? ''}
              onChange={(e) => setLevel(t.key, e.target.value as AdminAccessLevel | '')}
              className="rounded-md border border-[#E7DFF5] bg-white px-2 py-1 text-sm text-[#170B2E]"
            >
              {LEVELS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>
      <p className="text-xs text-[#3D3650]">Dashboard and Notifications are visible to every admin. Read = view only, Write = view and make changes.</p>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving || (!admin && !email.trim())}
          className="rounded-lg bg-[#7F40E8] px-4 py-2 text-sm font-medium text-white hover:bg-[#6425C4] disabled:opacity-50"
        >
          {saving ? 'Saving…' : admin ? 'Save access' : 'Add admin'}
        </button>
        <button onClick={onCancel} className="rounded-lg border border-[#E7DFF5] bg-white px-4 py-2 text-sm text-[#3D3650]">
          Cancel
        </button>
      </div>
    </div>
  );
}
