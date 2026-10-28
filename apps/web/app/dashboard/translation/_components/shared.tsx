'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../../../lib/api';

import {
  Empty as KitEmpty,
  ErrorNote,
  Loading as KitLoading,
  PageHeader as KitPageHeader,
  Tabs,
  type TabItem,
} from '../../_ui';

const LINKS: TabItem[] = [
  { href: '/dashboard/translation', label: 'Overview', exact: true },
  { href: '/dashboard/translation/calls', label: 'Calls & reports' },
  { href: '/dashboard/translation/settings', label: 'Settings' },
  { href: '/dashboard/translation/lexicons', label: 'Lexicons' },
];

/** Overview / Calls / Settings / Lexicons tabs shown at the top of every Live Translate page. */
export function TranslationNav() {
  return <Tabs items={LINKS} />;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return <KitPageHeader title={title} description={subtitle} actions={actions} />;
}

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
  testId,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  testId?: string;
}) {
  return (
    <section data-testid={testId} className={`rounded-xl bg-[#F7F6FA] p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-[#170B2E]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-[#6B6478]">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tile({ label, value, hint, testId }: { label: string; value: ReactNode; hint?: ReactNode; testId?: string }) {
  return (
    <div data-testid={testId} className="rounded-xl bg-[#F7F6FA] p-5">
      <p className="text-[13px] text-[#6B6478]">{label}</p>
      <p className="mt-1 text-[24px] font-semibold tracking-tight text-[#170B2E] tabular-nums">{value}</p>
      {hint && <p className="mt-1 text-xs text-[#6B6478]">{hint}</p>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return <KitLoading label={label} />;
}

export function ErrorBox({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return <ErrorNote message={children} onRetry={onRetry} />;
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <KitEmpty title={title} body={children} action={action} />;
}

export const selectCls =
  'w-full rounded-lg border border-[#E4DEEE] bg-white px-3 py-2 text-sm text-[#170B2E] outline-none focus:border-[#7F40E8] focus:ring-2 focus:ring-[#7F40E8]/15';

export interface ProjectRef {
  id: string;
  name: string;
}

const PROJECT_KEY = 'pc-translation-project';

/** Loads the user's projects and remembers the selected one per browser. */
export function useProjects() {
  const [projects, setProjects] = useState<ProjectRef[] | null>(null);
  const [projectId, setProjectIdState] = useState<string>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .get<ProjectRef[]>('/projects')
      .then((r) => {
        if (!alive) return;
        const list = Array.isArray(r.data) ? r.data : [];
        setProjects(list);
        let saved = '';
        try {
          saved = localStorage.getItem(PROJECT_KEY) ?? '';
        } catch {
          // storage unavailable
        }
        setProjectIdState(list.some((p) => p.id === saved) ? saved : list[0]?.id ?? '');
      })
      .catch(() => alive && setError(true));
    return () => {
      alive = false;
    };
  }, []);

  const setProjectId = (id: string) => {
    setProjectIdState(id);
    try {
      localStorage.setItem(PROJECT_KEY, id);
    } catch {
      // storage unavailable
    }
  };

  return { projects, projectId, setProjectId, error, loading: projects === null && !error };
}

export function ProjectPicker({
  projects,
  value,
  onChange,
}: {
  projects: ProjectRef[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="w-52">
      <label htmlFor="translation-project" className="sr-only">
        Project
      </label>
      <select id="translation-project" className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </div>
  );
}

export function NoProjects() {
  return (
    <Empty
      title="Create a project first"
      action={
        <Link href="/dashboard/projects" className="text-sm font-medium text-[#5B21B6] hover:underline">
          Go to Projects &amp; Keys
        </Link>
      }
    >
      Live Translate settings, lexicons and metrics belong to a project.
    </Empty>
  );
}
