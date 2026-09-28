'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  KeyRound,
  Plus,
  Copy,
  Check,
  Trash2,
  Power,
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  createdAt: string;
  project?: { id: string; name: string };
}

interface Project {
  id: string;
  name: string;
}

export default function ApiKeysPage() {
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

  const [keys, setKeys] = useState<ApiKey[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewKey, setShowNewKey] = useState(false);
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyProject, setNewKeyProject] = useState('');
  const [creating, setCreating] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  // The raw key is only ever available in the create response — shown once,
  // then discarded. The list only ever holds the masked keyPrefix.
  const [revealedKey, setRevealedKey] = useState<{ id: string; key: string } | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [keysRes, projectsRes] = await Promise.all([
        api.get('/api-keys'),
        api.get('/projects'),
      ]);
      setKeys(keysRes.data);
      setProjects(projectsRes.data);
      if (projectsRes.data.length > 0 && !newKeyProject) {
        setNewKeyProject(projectsRes.data[0].id);
      }
    } catch {
      logout();
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [logout, router, newKeyProject]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) { router.push('/login'); return; }
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady, token, fetchData, router]);

  async function createKey() {
    if (!newKeyName.trim() || !newKeyProject) return;
    setCreating(true);
    try {
      const res = await api.post('/api-keys', { projectId: newKeyProject, name: newKeyName.trim() });
      const project = projects.find((p) => p.id === newKeyProject);
      const { key: rawKey, ...masked } = res.data;
      setKeys((prev) => [{ ...masked, project }, ...prev]);
      setRevealedKey({ id: masked.id, key: rawKey });
      setNewKeyName('');
      setShowNewKey(false);
    } finally { setCreating(false); }
  }

  async function toggleKey(key: ApiKey) {
    setBusy(key.id);
    try {
      const res = await api.patch(`/api-keys/${key.id}`, { isActive: !key.isActive });
      setKeys((prev) => prev.map((k) => k.id === key.id ? { ...k, isActive: res.data.isActive } : k));
    } finally { setBusy(null); }
  }

  async function revokeKey(key: ApiKey) {
    if (!confirm(`Revoke API key "${key.name}"? This cannot be undone.`)) return;
    setBusy(key.id);
    try {
      await api.delete(`/api-keys/${key.id}`);
      setKeys((prev) => prev.filter((k) => k.id !== key.id));
    } finally { setBusy(null); }
  }

  async function copyRevealedKey() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey.key);
    setCopied(revealedKey.id);
    setTimeout(() => setCopied(null), 2000);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="flex flex-col items-center gap-3">
          <svg className="animate-spin h-6 w-6 text-[#7F40E8]" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-[#3D3650]">Loading API keys…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">API Keys</h1>
          <p className="text-sm text-[#3D3650] mt-1">
            Create and manage keys for all your projects.
          </p>
        </div>
        <Button onClick={() => { setShowNewKey(true); setNewKeyName(''); }}>
          <Plus size={16} className="mr-1.5" /> Create API Key
        </Button>
      </div>

      {showNewKey && (
        <div
          className="rounded-2xl border border-[#D6C4EE] p-5"
          style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.06), rgba(65,6,134,0.03))' }}
        >
          <p className="text-sm font-semibold text-[#170B2E] mb-4">New API Key</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <Input
              label="Key name"
              placeholder="e.g. Production key"
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createKey()}
              autoFocus
            />
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-[#3D3650]">Project</label>
              <select
                value={newKeyProject}
                onChange={(e) => setNewKeyProject(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg text-sm text-[#170B2E] bg-[#FFFFFF] border border-[#E7DFF5] outline-none focus:border-[#7F40E8]/60"
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-3">
            <Button onClick={createKey} loading={creating} disabled={!newKeyProject}>Create</Button>
            <Button variant="ghost" onClick={() => setShowNewKey(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {revealedKey && (
        <div
          className="rounded-2xl border p-5"
          style={{ borderColor: 'rgba(52,211,153,0.35)', background: 'rgba(16,185,129,0.06)' }}
        >
          <p className="text-sm font-semibold text-[#170B2E] mb-1">Your new API key</p>
          <p className="text-xs text-amber-700 mb-3">
            Copy it now — you won&apos;t be able to view it again after leaving this page.
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <code className="flex-1 min-w-0 text-xs font-mono text-[#170B2E] bg-[#F8F4FD] border border-[#E7DFF5] rounded-lg px-3 py-2.5 break-all">
              {revealedKey.key}
            </code>
            <button
              onClick={copyRevealedKey}
              className="p-2.5 rounded-lg text-[#3D3650] hover:text-[#170B2E] hover:bg-[#7F40E8]/5 transition-colors border border-[#E7DFF5]"
              title="Copy"
            >
              {copied === revealedKey.id
                ? <Check size={16} style={{ color: '#34D399' }} />
                : <Copy size={16} />}
            </button>
          </div>
          <div className="mt-3">
            <Button variant="ghost" onClick={() => setRevealedKey(null)}>I&apos;ve saved it</Button>
          </div>
        </div>
      )}

      {keys.length === 0 ? (
        <div
          className="rounded-2xl border border-[#E7DFF5] py-16 px-6 text-center"
          style={{ background: '#FFFFFF' }}
        >
          <div
            className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
            style={{ background: 'rgba(65,6,134,0.1)', border: '1px solid rgba(65,6,134,0.2)' }}
          >
            <KeyRound size={24} style={{ color: '#A05DF9' }} />
          </div>
          <p className="text-base font-semibold text-[#170B2E] mb-1">No API keys yet</p>
          <p className="text-sm text-[#3D3650] mb-6 max-w-sm mx-auto">
            Create a key to authenticate calls to the PurpleCallio API.
          </p>
          {projects.length === 0 ? (
            <p className="text-xs text-amber-700 mb-4">
              You need a project first. Create one in the Projects page.
            </p>
          ) : (
            <Button onClick={() => { setShowNewKey(true); setNewKeyName(''); }}>
              <Plus size={15} className="mr-1.5" /> Create API Key
            </Button>
          )}
        </div>
      ) : (
        <div className="divide-y divide-[#E7DFF5] rounded-2xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}>
          {keys.map((key) => (
            <div key={key.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: 'rgba(65,6,134,0.1)', border: '1px solid rgba(65,6,134,0.2)' }}
              >
                <KeyRound size={17} style={{ color: '#A05DF9' }} />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-[#170B2E]">{key.name}</p>
                  <Badge variant={key.isActive ? 'success' : 'error'}>
                    {key.isActive ? 'Active' : 'Revoked'}
                  </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <p className="text-xs font-mono text-[#3D3650] truncate max-w-[220px] sm:max-w-xs">
                    {key.keyPrefix}••••••••••••••••••••
                  </p>
                  {key.project?.name && (
                    <span className="text-xs text-[#3D3650]">· {key.project.name}</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => toggleKey(key)}
                  disabled={busy === key.id}
                  className="p-2 rounded-lg text-[#3D3650] hover:text-[#170B2E] hover:bg-[#7F40E8]/5 transition-colors disabled:opacity-50"
                  title={key.isActive ? 'Deactivate' : 'Activate'}
                >
                  <Power size={16} style={{ color: key.isActive ? '#34D399' : '#F87171' }} />
                </button>
                <button
                  onClick={() => revokeKey(key)}
                  disabled={busy === key.id}
                  className="p-2 rounded-lg text-[#3D3650] hover:text-red-600 hover:bg-red-500/5 transition-colors disabled:opacity-50"
                  title="Revoke"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
        <div
          className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}
        >
          <ShieldCheck size={16} style={{ color: '#34D399' }} />
        </div>
        <div>
          <p className="text-sm font-medium text-[#170B2E]">Security best practice</p>
          <p className="text-xs text-[#3D3650] mt-0.5">
            Treat API keys like passwords. Rotate them regularly and never expose them
            in client-side code. Use separate keys per environment.
          </p>
        </div>
      </div>
    </div>
  );
}
