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
}

export default function ProjectsPage() {
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [newProjectDesc, setNewProjectDesc] = useState('');
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [projectKeys, setProjectKeys] = useState<Record<string, ApiKey[]>>({});
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState('');
  const [creatingKey, setCreatingKey] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  // Raw key is only present in the create response — shown once, then discarded.
  const [revealedKey, setRevealedKey] = useState<{ id: string; key: string } | null>(null);

  const [webhookInputs, setWebhookInputs] = useState<Record<string, string>>({});
  const [savingWebhook, setSavingWebhook] = useState<string | null>(null);
  const [webhookSaved, setWebhookSaved] = useState<string | null>(null);

  const fetchProjects = useCallback(async () => {
    try {
      const res = await api.get('/projects');
      setProjects(res.data);
      const inputs: Record<string, string> = {};
      for (const p of res.data) inputs[p.id] = p.webhookUrl ?? '';
      setWebhookInputs(inputs);
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
    fetchProjects();
  }, [isReady, token, fetchProjects, router]);

  const fetchKeys = useCallback(async (projectId: string) => {
    if (projectKeys[projectId]) return;
    const res = await api.get(`/api-keys/${projectId}`);
    setProjectKeys((prev) => ({ ...prev, [projectId]: res.data }));
  }, [projectKeys]);

  async function toggleProject(id: string) {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    await fetchKeys(id);
  }

  async function createProject() {
    if (!newProjectName.trim()) return;
    setCreating(true);
    try {
      const res = await api.post('/projects', { name: newProjectName.trim(), description: newProjectDesc.trim() || undefined });
      setProjects((prev) => [res.data, ...prev]);
      setWebhookInputs((prev) => ({ ...prev, [res.data.id]: '' }));
      setNewProjectName('');
      setNewProjectDesc('');
      setShowNewProject(false);
    } finally { setCreating(false); }
  }

  async function createKey(projectId: string) {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const res = await api.post('/api-keys', { projectId, name: newKeyName.trim() });
      const { key: rawKey, ...masked } = res.data;
      setProjectKeys((prev) => ({ ...prev, [projectId]: [masked, ...(prev[projectId] ?? [])] }));
      setRevealedKey({ id: masked.id, key: rawKey });
      setNewKeyName('');
      setShowNewKey(null);
    } finally { setCreatingKey(false); }
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
          <h1 className="text-2xl font-bold text-[#170B2E]">Projects</h1>
          <p className="text-sm text-[#3D3650] mt-1">
            Manage your projects, API keys, and webhooks.
          </p>
        </div>
        <Button onClick={() => { setShowNewProject(true); setNewProjectName(''); setNewProjectDesc(''); }}>
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
          <div className="flex gap-3">
            <Button onClick={createProject} loading={creating}>Create Project</Button>
            <Button variant="ghost" onClick={() => setShowNewProject(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {projects.length === 0 ? (
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
            Create a project to get your first API key and start building.
          </p>
          <Button onClick={() => { setShowNewProject(true); setNewProjectName(''); setNewProjectDesc(''); }}>
            <Plus size={15} className="mr-1.5" /> Create Project
          </Button>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {projects.map((project) => (
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
                  <span className="text-xs text-[#3D3650]">
                    {projectKeys[project.id]?.length ?? 0} API Keys
                  </span>
                  <button
                    onClick={() => toggleProject(project.id)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[#6425C4] hover:text-[#6425C4] transition-colors"
                  >
                    {expandedId === project.id ? 'Hide details' : 'Manage'} <ArrowUpRight size={13} />
                  </button>
                </div>
              </div>

              {expandedId === project.id && (
                <div className="border-t border-[#E7DFF5] p-5">
                  {/* API Keys */}
                  <div className="mb-6">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-sm font-semibold text-[#170B2E]">API Keys</p>
                      <Button variant="secondary" size="sm" onClick={() => setShowNewKey(project.id)}>
                        <Plus size={13} className="mr-1" /> New Key
                      </Button>
                    </div>

                    {showNewKey === project.id && (
                      <div className="flex gap-2 mb-3">
                        <Input
                          placeholder="Key name"
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

                    {revealedKey && projectKeys[project.id]?.some((k) => k.id === revealedKey.id) && (
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

                    {!projectKeys[project.id]?.length ? (
                      <p className="text-sm text-[#3D3650]">No API keys yet.</p>
                    ) : (
                      <div className="divide-y divide-[#E7DFF5] rounded-xl border border-[#E7DFF5]">
                        {projectKeys[project.id].map((key) => (
                          <div key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <KeyRound size={15} style={{ color: '#6425C4' }} />
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <p className="text-sm font-medium text-[#170B2E]">{key.name}</p>
                                <Badge variant={key.isActive ? 'success' : 'error'}>
                                  {key.isActive ? 'Active' : 'Revoked'}
                                </Badge>
                              </div>
                              <p className="text-xs font-mono text-[#3D3650] truncate">
                                {key.keyPrefix}••••••••••••••••••••
                              </p>
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
          ))}
        </div>
      )}

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
    </div>
  );
}
