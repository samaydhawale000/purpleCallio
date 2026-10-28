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
import { ErrorNote, Loading, PageHeader, Panel, Table, buttonCls, inputCls } from '../../dashboard/_ui';

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

  const addButton =
    canWrite && editing === null ? (
      <button type="button" onClick={() => setEditing('new')} className={buttonCls('primary')}>
        <Plus size={16} aria-hidden="true" /> Add admin
      </button>
    ) : undefined;

  const header = (
    <PageHeader
      title="Admins"
      description="People who can access this admin panel, and what they can do in each section."
      actions={!loading && !error ? addButton : undefined}
    />
  );

  if (loading) {
    return (
      <>
        {header}
        <Loading label="Loading admins…" />
      </>
    );
  }
  if (error) {
    return (
      <>
        {header}
        <ErrorNote message={error} />
      </>
    );
  }

  return (
    <>
      {header}

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

      <Table
        rows={admins}
        rowKey={(a) => a.id}
        columns={[
          {
            key: 'person',
            label: 'Person',
            render: (a) => (
              <div className="leading-tight">
                <p className="font-medium text-[#170B2E]">
                  {a.name || a.email}
                  {a.id === myId && <span className="ml-2 text-xs font-normal text-[#6B6478]">(you)</span>}
                </p>
                {a.name && <p className="text-[13px] text-[#6B6478]">{a.email}</p>}
              </div>
            ),
          },
          { key: 'access', label: 'Access', className: 'whitespace-normal text-[#6B6478]', render: (a) => accessSummary(a) },
          ...(canWrite
            ? [
                {
                  key: 'actions',
                  label: '',
                  align: 'right' as const,
                  render: (a: AdminMember) =>
                    a.id !== myId && (
                      <span className="inline-flex gap-1">
                        <button type="button" onClick={() => setEditing(a)} className={buttonCls('ghost', 'px-2.5 py-1')}>
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => onRemove(a)}
                          className="rounded-lg px-2.5 py-1 text-sm font-medium text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </span>
                    ),
                },
              ]
            : []),
        ]}
      />
    </>
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
    <Panel className="mb-8 space-y-4">
      <h2 className="text-[15px] font-semibold text-[#170B2E]">{admin ? `Edit access for ${admin.email}` : 'Add admin'}</h2>
      {!admin && (
        <label className="block max-w-sm">
          <span className="text-sm font-medium text-[#170B2E]">Email</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.com"
            className={`${inputCls} mt-1.5`}
          />
          <span className="mt-1 block text-xs text-[#6B6478]">They sign in with Google using this email.</span>
        </label>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {ADMIN_TABS.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2">
            <span className="text-sm text-[#170B2E]">{t.label}</span>
            <select
              value={perms[t.key] ?? ''}
              onChange={(e) => setLevel(t.key, e.target.value as AdminAccessLevel | '')}
              aria-label={`${t.label} access`}
              className="rounded-md border border-[#E4DEEE] bg-white px-2 py-1 text-sm text-[#170B2E] focus:border-[#7F40E8] focus:outline-none"
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
      <p className="text-xs text-[#6B6478]">Dashboard and Notifications are visible to every admin. Read = view only, Write = view and make changes.</p>

      {error && <ErrorNote message={error} />}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={save}
          disabled={saving || (!admin && !email.trim())}
          className={buttonCls('primary')}
        >
          {saving ? 'Saving…' : admin ? 'Save access' : 'Add admin'}
        </button>
        <button type="button" onClick={onCancel} className={buttonCls('secondary')}>
          Cancel
        </button>
      </div>
    </Panel>
  );
}
