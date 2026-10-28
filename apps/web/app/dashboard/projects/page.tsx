"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check, Copy } from "lucide-react";
import { useAuthStore } from "../../store/auth.store";
import { useRequireAuth } from "../../hooks/useRequireAuth";
import { api } from "../../lib/api";
import {
  Empty,
  Loading,
  PageHeader,
  Panel,
  Pill,
  Section,
  Table,
  TextLink,
  buttonCls,
  fmtDate,
  inputCls,
} from "../_ui";

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

const DEFAULT_KEY_NAME = "Default key";

/** Projects and their API keys + webhooks, managed in one place. */
export default function ProjectsPage() {
  const { token, logout } = useAuthStore();
  const router = useRouter();
  const { isReady } = useRequireAuth();

  const [projects, setProjects] = useState<Project[]>([]);
  const [keysByProject, setKeysByProject] = useState<Record<string, ApiKey[]>>(
    {},
  );
  const [loading, setLoading] = useState(true);

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectDesc, setNewProjectDesc] = useState("");
  const [withKey, setWithKey] = useState(true);
  const [firstKeyName, setFirstKeyName] = useState(DEFAULT_KEY_NAME);
  const [creating, setCreating] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showNewKey, setShowNewKey] = useState<string | null>(null);
  const [newKeyName, setNewKeyName] = useState("");
  const [creatingKey, setCreatingKey] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  // Raw key is only present in the create response — shown once, then discarded.
  const [revealedKey, setRevealedKey] = useState<{
    id: string;
    projectId: string;
    key: string;
  } | null>(null);
  const [error, setError] = useState<{
    projectId: string | null;
    message: string;
  } | null>(null);

  const [webhookInputs, setWebhookInputs] = useState<Record<string, string>>(
    {},
  );
  const [savingWebhook, setSavingWebhook] = useState<string | null>(null);
  const [webhookSaved, setWebhookSaved] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [projectsRes, keysRes] = await Promise.all([
        api.get("/projects"),
        api.get("/api-keys"),
      ]);
      setProjects(projectsRes.data);
      const inputs: Record<string, string> = {};
      for (const p of projectsRes.data) inputs[p.id] = p.webhookUrl ?? "";
      setWebhookInputs(inputs);
      const grouped: Record<string, ApiKey[]> = {};
      for (const k of keysRes.data as ApiKey[]) {
        const pid = k.project?.id;
        if (pid) (grouped[pid] ??= []).push(k);
      }
      setKeysByProject(grouped);
      // Deep link from notifications: /dashboard/projects?project=<id>
      const linked = new URLSearchParams(window.location.search).get("project");
      if (linked && projectsRes.data.some((p: Project) => p.id === linked))
        setExpandedId(linked);
    } catch {
      logout();
      router.push("/login");
    } finally {
      setLoading(false);
    }
  }, [logout, router]);

  useEffect(() => {
    if (!isReady) return;
    if (!token) {
      router.push("/login");
      return;
    }
    fetchData();
  }, [isReady, token, fetchData, router]);

  function openNewProject() {
    setShowNewProject(true);
    setNewProjectName("");
    setNewProjectDesc("");
    setWithKey(true);
    setFirstKeyName(DEFAULT_KEY_NAME);
  }

  function addKey(projectId: string, key: ApiKey) {
    setKeysByProject((prev) => ({
      ...prev,
      [projectId]: [key, ...(prev[projectId] ?? [])],
    }));
  }

  async function createProject() {
    if (!newProjectName.trim() || (withKey && !firstKeyName.trim())) return;
    setCreating(true);
    setError(null);
    let project: Project;
    try {
      const res = await api.post("/projects", {
        name: newProjectName.trim(),
        description: newProjectDesc.trim() || undefined,
      });
      project = res.data;
    } catch {
      setError({
        projectId: null,
        message: "Could not create the project. Please try again.",
      });
      setCreating(false);
      return;
    }

    setProjects((prev) => [project, ...prev]);
    setWebhookInputs((prev) => ({ ...prev, [project.id]: "" }));
    setExpandedId(project.id);
    setShowNewProject(false);

    if (withKey) {
      try {
        const res = await api.post("/api-keys", {
          projectId: project.id,
          name: firstKeyName.trim(),
        });
        const { key: rawKey, ...masked } = res.data;
        addKey(project.id, masked);
        setRevealedKey({ id: masked.id, projectId: project.id, key: rawKey });
      } catch {
        setError({
          projectId: project.id,
          message:
            'Project created, but the API key could not be generated. Use "New key" to try again.',
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
      const res = await api.post("/api-keys", {
        projectId,
        name: newKeyName.trim(),
      });
      const { key: rawKey, ...masked } = res.data;
      addKey(projectId, masked);
      setRevealedKey({ id: masked.id, projectId, key: rawKey });
      setNewKeyName("");
      setShowNewKey(null);
    } catch {
      setError({
        projectId,
        message: "Could not create the API key. Please try again.",
      });
    } finally {
      setCreatingKey(false);
    }
  }

  async function toggleKey(projectId: string, key: ApiKey) {
    setBusyKey(key.id);
    try {
      const res = await api.patch(`/api-keys/${key.id}`, {
        isActive: !key.isActive,
      });
      setKeysByProject((prev) => ({
        ...prev,
        [projectId]: prev[projectId].map((k) =>
          k.id === key.id ? { ...k, isActive: res.data.isActive } : k,
        ),
      }));
    } catch {
      setError({
        projectId,
        message: `Could not update "${key.name}". Please try again.`,
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function revokeKey(projectId: string, key: ApiKey) {
    if (
      !confirm(
        `Revoke API key "${key.name}"? Apps using it will stop working. This cannot be undone.`,
      )
    )
      return;
    setBusyKey(key.id);
    try {
      await api.delete(`/api-keys/${key.id}`);
      setKeysByProject((prev) => ({
        ...prev,
        [projectId]: prev[projectId].filter((k) => k.id !== key.id),
      }));
      if (revealedKey?.id === key.id) setRevealedKey(null);
    } catch {
      setError({
        projectId,
        message: `Could not revoke "${key.name}". Please try again.`,
      });
    } finally {
      setBusyKey(null);
    }
  }

  async function saveWebhook(projectId: string) {
    setSavingWebhook(projectId);
    try {
      const url = webhookInputs[projectId]?.trim() || null;
      const res = await api.patch(`/projects/${projectId}/webhook`, {
        webhookUrl: url,
      });
      setProjects((prev) =>
        prev.map((p) =>
          p.id === projectId
            ? {
                ...p,
                webhookUrl: res.data.webhookUrl,
                webhookSecret: res.data.webhookSecret,
              }
            : p,
        ),
      );
      setWebhookSaved(projectId);
      setTimeout(() => setWebhookSaved(null), 2500);
    } finally {
      setSavingWebhook(null);
    }
  }

  async function copyRevealedKey() {
    if (!revealedKey) return;
    await navigator.clipboard.writeText(revealedKey.key);
    setCopied(revealedKey.id);
    setTimeout(() => setCopied(null), 2000);
  }

  const keyCountLabel = (keys: ApiKey[]) => {
    const active = keys.filter((k) => k.isActive).length;
    return keys.length === 0
      ? "No API keys"
      : `${keys.length} API key${keys.length === 1 ? "" : "s"}${active < keys.length ? ` · ${active} active` : ""}`;
  };

  if (loading) return <Loading label="Loading projects…" />;

  const selected = projects.find((p) => p.id === expandedId) ?? null;

  if (selected) {
    const project = selected;
    const keys = keysByProject[project.id] ?? [];
    return (
      <>
        <button
          type="button"
          onClick={() => setExpandedId(null)}
          className="mb-4 inline-flex items-center gap-1 text-[13px] text-[#6B6478] hover:text-[#170B2E]"
        >
          <ArrowLeft size={14} /> All projects
        </button>
        <PageHeader
          title={project.name}
          description={
            project.description || `Created ${fmtDate(project.createdAt)}`
          }
        />

        <Section
          title="API keys"
          description={keyCountLabel(keys)}
          actions={
            <button
              type="button"
              className={buttonCls("secondary")}
              onClick={() => {
                setShowNewKey(project.id);
                setNewKeyName("");
              }}
            >
              New key
            </button>
          }
        >
          {showNewKey === project.id && (
            <div className="mb-3 flex flex-col gap-2 sm:flex-row">
              <input
                className={inputCls}
                aria-label="Key name"
                placeholder="Key name, e.g. Staging server"
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createKey(project.id)}
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonCls("primary")}
                  onClick={() => createKey(project.id)}
                  disabled={creatingKey || !newKeyName.trim()}
                >
                  {creatingKey ? "Creating…" : "Create"}
                </button>
                <button
                  type="button"
                  className={buttonCls("ghost")}
                  onClick={() => setShowNewKey(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && error.projectId === project.id && (
            <p className="mb-3 text-[13px] text-red-600">{error.message}</p>
          )}

          {revealedKey?.projectId === project.id && (
            <Panel className="mb-3">
              <p className="text-sm font-medium text-[#170B2E]">
                Your new API key
              </p>
              <p className="mt-0.5 text-[13px] text-[#6B6478]">
                Copy it now. You won&apos;t be able to see it again.
              </p>
              <div className="mt-3 flex items-center gap-2">
                <code className="min-w-0 flex-1 break-all rounded-lg border border-[#ECE8F2] bg-white px-3 py-2 font-mono text-[13px] text-[#170B2E]">
                  {revealedKey.key}
                </code>
                <button
                  type="button"
                  onClick={copyRevealedKey}
                  className={buttonCls("secondary", "px-2.5")}
                  title="Copy"
                  aria-label="Copy API key"
                >
                  {copied === revealedKey.id ? (
                    <Check size={15} className="text-emerald-600" />
                  ) : (
                    <Copy size={15} />
                  )}
                </button>
              </div>
              <button
                type="button"
                className={buttonCls("ghost", "mt-2 -ml-3")}
                onClick={() => setRevealedKey(null)}
              >
                I&apos;ve saved it
              </button>
            </Panel>
          )}

          <Table
            rows={keys}
            rowKey={(k) => k.id}
            empty={
              <Empty
                title="No API keys yet"
                body="Create one to start calling the API."
              />
            }
            columns={[
              { key: "name", label: "Name", render: (k) => k.name },
              {
                key: "key",
                label: "Key",
                mono: true,
                className: "text-[#6B6478]",
                render: (k) => `${k.keyPrefix}••••••••`,
              },
              {
                key: "status",
                label: "Status",
                render: (k) => (
                  <Pill tone={k.isActive ? "success" : "neutral"}>
                    {k.isActive ? "Active" : "Inactive"}
                  </Pill>
                ),
              },
              {
                key: "created",
                label: "Created",
                className: "text-[#6B6478]",
                render: (k) => fmtDate(k.createdAt),
              },
              {
                key: "actions",
                label: "",
                align: "right",
                render: (k) => (
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() => toggleKey(project.id, k)}
                      disabled={busyKey === k.id}
                      className={buttonCls("ghost", "px-2.5 py-1 text-[13px]")}
                      aria-label={`${k.isActive ? "Deactivate" : "Activate"} ${k.name}`}
                    >
                      {k.isActive ? "Deactivate" : "Activate"}
                    </button>
                    <button
                      type="button"
                      onClick={() => revokeKey(project.id, k)}
                      disabled={busyKey === k.id}
                      className="rounded-lg px-2.5 py-1 text-[13px] font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                      aria-label={`Revoke ${k.name}`}
                    >
                      Revoke
                    </button>
                  </div>
                ),
              },
            ]}
          />
          <p className="mt-2 text-xs text-[#6B6478]">
            Use keys only on your server, never in client-side code.{" "}
            <TextLink href="/docs">API docs</TextLink>
          </p>
        </Section>

        <Section title="Webhook" description="We send call events to this URL.">
          <div className="flex flex-col gap-2 sm:flex-row sm:max-w-xl">
            <input
              className={inputCls}
              aria-label="Webhook URL"
              placeholder="https://your-server.com/webhook"
              value={webhookInputs[project.id] ?? ""}
              onChange={(e) =>
                setWebhookInputs((prev) => ({
                  ...prev,
                  [project.id]: e.target.value,
                }))
              }
            />
            <button
              type="button"
              className={buttonCls("secondary")}
              onClick={() => saveWebhook(project.id)}
              disabled={savingWebhook === project.id}
            >
              {savingWebhook === project.id
                ? "Saving…"
                : webhookSaved === project.id
                  ? "Saved"
                  : "Save"}
            </button>
          </div>
          {project.webhookSecret && (
            <p className="mt-2 text-xs text-[#6B6478]">
              A webhook secret is configured for this project.
            </p>
          )}
        </Section>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project has its own API keys and webhook."
        actions={
          !showNewProject && (
            <button
              type="button"
              className={buttonCls("primary")}
              onClick={openNewProject}
            >
              New project
            </button>
          )
        }
      />

      {showNewProject && (
        <Panel className="mb-8">
          <h2 className="mb-4 text-[15px] font-semibold text-[#170B2E]">
            New project
          </h2>
          <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="mb-1 block text-[13px] text-[#6B6478]">
                Project name
              </span>
              <input
                className={inputCls}
                placeholder="e.g. Mobile app"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createProject()}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] text-[#6B6478]">
                Description (optional)
              </span>
              <input
                className={inputCls}
                placeholder="What is this project for?"
                value={newProjectDesc}
                onChange={(e) => setNewProjectDesc(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createProject()}
              />
            </label>
          </div>

          <label className="flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={withKey}
              onChange={(e) => setWithKey(e.target.checked)}
              className="h-4 w-4 accent-[#6D28D9]"
            />
            <span className="text-sm text-[#170B2E]">
              Generate an API key for this project
            </span>
          </label>
          {withKey && (
            <label className="mt-3 block sm:max-w-sm">
              <span className="mb-1 block text-[13px] text-[#6B6478]">
                Key name
              </span>
              <input
                className={inputCls}
                placeholder="e.g. Backend server"
                value={firstKeyName}
                onChange={(e) => setFirstKeyName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && createProject()}
              />
            </label>
          )}

          {error && error.projectId === null && (
            <p className="mt-3 text-[13px] text-red-600">{error.message}</p>
          )}
          <div className="mt-5 flex gap-2">
            <button
              type="button"
              className={buttonCls("primary")}
              onClick={createProject}
              disabled={
                creating ||
                !newProjectName.trim() ||
                (withKey && !firstKeyName.trim())
              }
            >
              {withKey ? "Create project & key" : "Create project"}
            </button>
            <button
              type="button"
              className={buttonCls("ghost")}
              onClick={() => setShowNewProject(false)}
            >
              Cancel
            </button>
          </div>
        </Panel>
      )}

      {(projects.length > 0 || !showNewProject) && (
        <Table
          rows={projects}
          rowKey={(p) => p.id}
          onRowClick={(p) => setExpandedId(p.id)}
          empty={
            <Empty
              title="No projects yet"
              body="Create a project and we'll generate your first API key with it."
            />
          }
          columns={[
            {
              key: "name",
              label: "Name",
              className: "font-medium",
              render: (p) => p.name,
            },
            {
              key: "description",
              label: "Description",
              className: "max-w-[280px] truncate text-[#6B6478]",
              render: (p) => p.description || "—",
            },
            {
              key: "keys",
              label: "API keys",
              render: (p) => keyCountLabel(keysByProject[p.id] ?? []),
            },
            {
              key: "created",
              label: "Created",
              className: "text-[#6B6478]",
              render: (p) => fmtDate(p.createdAt),
            },
            {
              key: "manage",
              label: "",
              align: "right",
              render: () => (
                <span className="text-[13px] font-medium text-[#5B21B6]">
                  Manage
                </span>
              ),
            },
          ]}
        />
      )}
    </>
  );
}
