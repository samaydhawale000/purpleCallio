'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Plus,
  FolderKanban,
  KeyRound,
  ArrowUpRight,
  Trash2,
  Copy,
  Check,
  Globe,
  Power,
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';
import { useRequireAuth } from '../../hooks/useRequireAuth';
import { api } from '../../lib/api';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Badge } from '../../components/ui/Badge';

interface Project {
  id: string;
  name: string;
  description: string | null;
  webhookUrl: string | null;
  webhookSecret: string | null;
  createdAt: string;
}

interface ApiKey {
  id: string;
  name: string;
  keyPrefix: string;
  isActive: boolean;
  createdAt: string;
  project?: { id: string; name: string };
}

const DEFAULT_KEY_NAME = 'Default key';

/** Projects and their API keys + webhooks, managed in one place. */
export default function ProjectsPage() {
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [keysByProject, setKeysByProject] = useState<Record<string, ApiKey[]>>({});
  const [loading, setLoading] = useState(true);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [withKey, setWithKey] = useState(true);
  const [firstKeyName, setFirstKeyName] = useState(DEFAULT_KEY_NAME);
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Raw key is only present in the create response — shown once, then discarded.
  const [revealedKey, setRevealedKey] = useState<{ id: string; projectId: string; key: string } | null>(null);
  const [error, setError] = useState<{ projectId: string | null; message: string } | null>(null);

  const [webhookInputs, setWebhookInputs] = useState<Record<string, string>>({});
  const [savingWebhook, setSavingWebhook] = useState<string | null>(null);
  const [webhookSaved, setWebhookSaved] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [projectsRes, keysRes] = await Promise.all([api.get('/projects'), api.get('/api-keys')]);
      setProjects(projectsRes.data);
      const inputs: Record<string, string> = {};
      for (const p of projectsRes.data) inputs[p.id] = p.webhookUrl ?? '';
      setWebhookInputs(inputs);
      const grouped: Record<string, ApiKey[]> = {};
      for (const k of keysRes.data as ApiKey[]) {
        const pid = k.project?.id;
        if (pid) (grouped[pid] ??= []).push(k);
      }
      setKeysByProject(grouped);
      // Deep link from notifications: /dashboard/projects?project=<id>
      const linked = new URLSearchParams(window.location.search).get('project');
      if (linked && projectsRes.data.some((p: Project) => p.id === linked)) setExpandedId(linked);
    } catch {
      logout();
      router.push('/login');
    } finally {
      setLoading(false);
    }
  }, [logout, router]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) { router.push('/login'); return; }
    fetchData();
  }, [isReady, token, fetchData, router]);

  function openNewProject() {
    setShowNewProject(true);
    setNewProjectName('');
    setNewProjectDesc('');
    setWithKey(true);
    setFirstKeyName(DEFAULT_KEY_NAME);
  }

  function addKey(projectId: string, key: ApiKey) {
    setKeysByProject((prev) => ({ ...prev, [projectId]: [key, ...(prev[projectId] ?? [])] }));
  }

  async function createProject() {
    if (!newProjectName.trim() || (withKey && !firstKeyName.trim())) return;
    setCreating(true);
    setError(null);
    let project: Project;
    try {
      const res = await api.post('/projects', {
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
      });
      project = res.data;
    } catch {
      setError({ projectId: null, message: 'Could not create the project. Please try again.' });
      setCreating(false);
      return;
    }

    setProjects((prev) => [project, ...prev]);
    setWebhookInputs((prev) => ({ ...prev, [project.id]: '' }));
    setExpandedId(project.id);
    setShowNewProject(false);

    if (withKey) {
      try {
        const res = await api.post('/api-keys', { projectId: project.id, name: firstKeyName.trim() });
        const { key: rawKey, ...masked } = res.data;
        addKey(project.id, masked);
        setRevealedKey({ id: masked.id, projectId: project.id, key: rawKey });
      } catch {
        setError({
          projectId: project.id,
          message: 'Project created, but the API key could not be generated. Use "New key" to try again.',
        });
      }
    }
    setCreating(false);
  }

  async function createKey(projectId: string) {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    setError(null);
    try {
      const res = await api.post('/api-keys', { projectId, name: newKeyName.trim() });
      const { key: rawKey, ...masked } = res.data;
      addKey(projectId, masked);
      setRevealedKey({ id: masked.id, projectId, key: rawKey });
      setNewKeyName('');
      setShowNewKey(null);
    } catch {
      setError({ projectId, message: 'Could not create the API key. Please try again.' });
    } finally { setCreatingKey(false); }
  }

  async function toggleKey(projectId: string, key: ApiKey) {
    setBusyKey(key.id);
    try {
      const res = await api.patch(`/api-keys/${key.id}`, { isActive: !key.isActive });
      setKeysByProject((prev) => ({
        ...prev,
        [projectId]: prev[projectId].map((k) => (k.id === key.id ? { ...k, isActive: res.data.isActive } : k)),
      }));
    } catch {
      setError({ projectId, message: `Could not update "${key.name}". Please try again.` });
    } finally { setBusyKey(null); }
  }

  async function revokeKey(projectId: string, key: ApiKey) {
    if (!confirm(`Revoke API key "${key.name}"? Apps using it will stop working. This cannot be undone.`)) return;
    setBusyKey(key.id);
    try {
      await api.delete(`/api-keys/${key.id}`);
      setKeysByProject((prev) => ({ ...prev, [projectId]: prev[projectId].filter((k) => k.id !== key.id) }));
      if (revealedKey?.id === key.id) setRevealedKey(null);
    } catch {
      setError({ projectId, message: `Could not revoke "${key.name}". Please try again.` });
    } finally { setBusyKey(null); }
  }

  async function saveWebhook(projectId: string) {
    setSavingWebhook(projectId);
    try {
      const url = webhookInputs[projectId]?.trim() || null;
      const res = await api.patch(`/projects/${projectId}/webhook`, { webhookUrl: url });
      setProjects((prev) =>
        prev.map((p) => p.id === projectId ? { ...p, webhookUrl: res.data.webhookUrl, webhookSecret: res.data.webhookSecret } : p)
      );
      setWebhookSaved(projectId);
      setTimeout(() => setWebhookSaved(null), 2500);
    } finally { setSavingWebhook(null); }
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
          <span className="text-sm text-[#3D3650]">Loading projects…</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">Projects &amp; API Keys</h1>
          <p className="text-sm text-[#3D3650] mt-1">
            Each project has its own API keys and webhook. Create a project to get your first key.
          </p>
        </div>
        <Button onClick={openNewProject}>
          <Plus size={16} className="mr-1.5" /> Create Project
        </Button>
      </div>

      {showNewProject && (
        <div
          className="rounded-2xl border border-[#D6C4EE] p-5"
          style={{ background: 'linear-gradient(135deg, rgba(127,64,232,0.06), rgba(65,6,134,0.03))' }}
        >
          <p className="text-sm font-semibold text-[#170B2E] mb-4">New Project</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            <Input
              label="Project name"
              placeholder="e.g. Production"
              value={newProjectName}
              onChange={(e) => setNewProjectName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
              autoFocus
            />
            <Input
              label="Description (optional)"
              placeholder="What is this project for?"
              value={newProjectDesc}
              onChange={(e) => setNewProjectDesc(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && createProject()}
            />
          </div>

          <div className="rounded-xl border border-[#E7DFF5] bg-white p-4 mb-4">
            <label className="flex items-center gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                checked={withKey}
                onChange={(e) => setWithKey(e.target.checked)}
                className="h-4 w-4 accent-[#7F40E8]"
              />
              <span className="text-sm font-medium text-[#170B2E]">Generate an API key for this project</span>
            </label>
            {withKey && (
              <div className="mt-3 sm:max-w-sm">
                <Input
                  label="Key name"
                  placeholder="e.g. Backend server"
                  value={firstKeyName}
                  onChange={(e) => setFirstKeyName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createProject()}
                />
              </div>
            )}
          </div>

          {error && error.projectId === null && (
            <p className="text-xs text-red-600 mb-3">{error.message}</p>
          )}
          <div className="flex gap-3">
            <Button
              onClick={createProject}
              loading={creating}
              disabled={!newProjectName.trim() || (withKey && !firstKeyName.trim())}
            >
              {withKey ? 'Create project & key' : 'Create project'}
            </Button>
            <Button variant="ghost" onClick={() => setShowNewProject(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
        !showNewProject && (
          <div
            className="rounded-2xl border border-[#E7DFF5] py-16 px-6 text-center"
            style={{ background: '#FFFFFF' }}
          >
            <div
              className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
              style={{ background: 'rgba(127,64,232,0.1)', border: '1px solid rgba(127,64,232,0.2)' }}
            >
              <FolderKanban size={24} style={{ color: '#7F40E8' }} />
            </div>
            <p className="text-base font-semibold text-[#170B2E] mb-1">No projects yet</p>
            <p className="text-sm text-[#3D3650] mb-6 max-w-sm mx-auto">
              Create a project and we&apos;ll generate your first API key with it.
            </p>
            <Button onClick={openNewProject}>
              <Plus size={15} className="mr-1.5" /> Create Project
            </Button>
          </div>
        )
      ) : (
        <div className="flex flex-col gap-4">
          {projects.map((project) => {
            const keys = keysByProject[project.id] ?? [];
            const activeCount = keys.filter((k) => k.isActive).length;
            const expanded = expandedId === project.id;
            return (
              <div
                key={project.id}
                className="rounded-2xl border border-[#E7DFF5] overflow-hidden"
                style={{ background: '#FFFFFF' }}
              >
                <div className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center text-base font-bold text-white shrink-0"
                      style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
                    >
                      {project.name[0].toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[#170B2E]">{project.name}</p>
                        <Badge variant="purple">Production</Badge>
                      </div>
                      <p className="text-xs text-[#3D3650] mt-0.5 truncate">
                        {project.description || 'No description'}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center gap-1.5 text-xs text-[#3D3650]">
                      <KeyRound size={13} />
                      {keys.length === 0
                        ? 'No API keys'
                        : `${keys.length} API key${keys.length === 1 ? '' : 's'}${activeCount < keys.length ? ` · ${activeCount} active` : ''}`}
                    </span>
                    <button
                      onClick={() => setExpandedId(expanded ? null : project.id)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4] hover:text-[#6425C4] transition-colors"
                    >
                      {expanded ? 'Hide details' : 'Manage'} <ArrowUpRight size={13} />
                    </button>
                  </div>
                </div>

                {expanded && (
                  <div className="border-t border-[#E7DFF5] p-5">
                    {/* API Keys */}
                    <div className="mb-6">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-[#170B2E]">API Keys</p>
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => { setShowNewKey(project.id); setNewKeyName(''); }}
                        >
                          <Plus size={13} className="mr-1" /> New key
                        </Button>
                      </div>

                      {showNewKey === project.id && (
                        <div className="flex gap-2 mb-3">
                          <Input
                            placeholder="Key name, e.g. Staging server"
                            value={newKeyName}
                            onChange={(e) => setNewKeyName(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && createKey(project.id)}
                            autoFocus
                            className="flex-1"
                          />
                          <Button onClick={() => createKey(project.id)} loading={creatingKey} size="sm">Create</Button>
                          <Button variant="ghost" size="sm" onClick={() => setShowNewKey(null)}>Cancel</Button>
                        </div>
                      )}

                      {error && error.projectId === project.id && (
                        <p className="text-xs text-red-600 mb-3">{error.message}</p>
                      )}

                      {revealedKey?.projectId === project.id && (
                        <div
                          className="rounded-xl border p-4 mb-3"
                          style={{ borderColor: 'rgba(52,211,153,0.35)', background: 'rgba(16,185,129,0.06)' }}
                        >
                          <p className="text-xs font-semibold text-[#170B2E] mb-1">Your new API key</p>
                          <p className="text-[11px] text-amber-700 mb-2">
                            Copy it now — you won&apos;t be able to view it again.
                          </p>
                          <div className="flex items-center gap-2">
                            <code className="flex-1 min-w-0 text-xs font-mono text-[#170B2E] bg-[#F8F4FD] border border-[#E7DFF5] rounded-lg px-3 py-2 break-all">
                              {revealedKey.key}
                            </code>
                            <button
                              onClick={copyRevealedKey}
                              className="p-2 rounded-lg text-[#3D3650] hover:text-[#170B2E] hover:bg-[#7F40E8]/5 transition-colors border border-[#E7DFF5]"
                              title="Copy"
                            >
                              {copied === revealedKey.id
                                ? <Check size={15} style={{ color: '#34D399' }} />
                                : <Copy size={15} />}
                            </button>
                          </div>
                          <Button variant="ghost" size="sm" className="mt-2" onClick={() => setRevealedKey(null)}>
                            I&apos;ve saved it
                          </Button>
                        </div>
                      )}

                      {keys.length === 0 ? (
                        <p className="text-sm text-[#3D3650]">No API keys yet. Create one to start calling the API.</p>
                      ) : (
                        <div className="divide-y divide-[#E7DFF5] rounded-xl border border-[#E7DFF5]">
                          {keys.map((key) => (
                            <div key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                              <KeyRound size={15} style={{ color: '#6425C4' }} />
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <p className="text-sm font-medium text-[#170B2E]">{key.name}</p>
                                  <Badge variant={key.isActive ? 'success' : 'error'}>
                                    {key.isActive ? 'Active' : 'Inactive'}
                                  </Badge>
                                </div>
                                <p className="text-xs font-mono text-[#3D3650] truncate">
                                  {key.keyPrefix}••••••••••••••••••••
                                  <span className="font-sans"> · Created {new Date(key.createdAt).toLocaleDateString()}</span>
                                </p>
                              </div>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => toggleKey(project.id, key)}
                                  disabled={busyKey === key.id}
                                  className="p-2 rounded-lg text-[#3D3650] hover:text-[#170B2E] hover:bg-[#7F40E8]/5 transition-colors disabled:opacity-50"
                                  title={key.isActive ? 'Deactivate' : 'Activate'}
                                  aria-label={`${key.isActive ? 'Deactivate' : 'Activate'} ${key.name}`}
                                >
                                  <Power size={16} style={{ color: key.isActive ? '#34D399' : '#F87171' }} />
                                </button>
                                <button
                                  onClick={() => revokeKey(project.id, key)}
                                  disabled={busyKey === key.id}
                                  className="p-2 rounded-lg text-[#3D3650] hover:text-red-600 hover:bg-red-500/5 transition-colors disabled:opacity-50"
                                  title="Revoke"
                                  aria-label={`Revoke ${key.name}`}
                                >
                                  <Trash2 size={16} />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Webhook */}
                    <div>
                      <p className="text-sm font-semibold text-[#170B2E] mb-3">Webhook</p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <Input
                          placeholder="https://your-server.com/webhook"
                          value={webhookInputs[project.id] ?? ''}
                          onChange={(e) => setWebhookInputs((prev) => ({ ...prev, [project.id]: e.target.value }))}
                          className="flex-1"
                        />
                        <Button
                          variant="secondary"
                          onClick={() => saveWebhook(project.id)}
                          loading={savingWebhook === project.id}
                        >
                          {webhookSaved === project.id ? 'Saved ✓' : 'Save'}
                        </Button>
                      </div>
                      {project.webhookSecret && (
                        <p className="text-xs text-[#3D3650] mt-2 flex items-center gap-1.5">
                          <Globe size={12} /> Webhook secret is configured for this project.
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-start gap-3 rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)' }}
          >
            <Globe size={16} style={{ color: '#FBBF24' }} />
          </div>
          <div>
            <p className="text-sm font-medium text-[#170B2E]">Need the REST API?</p>
            <p className="text-xs text-[#3D3650] mt-0.5">
              All project and call endpoints are documented. Grab an API key above and start building.
            </p>
            <Link href="/docs" className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4] hover:text-[#6425C4] transition-colors mt-2">
              View documentation <ArrowUpRight size={13} />
            </Link>
          </div>
        </div>
        <div className="flex items-start gap-3 rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
          <div
            className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)' }}
          >
            <ShieldCheck size={16} style={{ color: '#34D399' }} />
          </div>
          <div>
            <p className="text-sm font-medium text-[#170B2E]">Keep keys secret</p>
            <p className="text-xs text-[#3D3650] mt-0.5">
              Treat API keys like passwords: use them only on your server, never in client-side code,
              and use a separate project or key per environment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
