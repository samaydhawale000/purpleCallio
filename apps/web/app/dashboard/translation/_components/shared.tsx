'use client';

import { ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { AlertTriangle, Languages } from 'lucide-react';
import { api } from '../../../lib/api';

const LINKS = [
  { href: '/dashboard/translation', label: 'Overview' },
  { href: '/dashboard/translation/settings', label: 'Settings' },
  { href: '/dashboard/translation/lexicons', label: 'Lexicons' },
  { href: '/dashboard/translation/calls', label: 'Calls & reports' },
];

/** Overview / Settings / Lexicons / Calls switcher shown at the top of every Live Translate page. */
export function TranslationNav() {
  const pathname = usePathname() ?? '';
  const active = (href: string) =>
    href === '/dashboard/translation' ? pathname === href : pathname === href || pathname.startsWith(`${href}/`);
  return (
    <nav aria-label="Live Translate" className="flex flex-wrap gap-1 rounded-lg border border-[#E7DFF5] p-1 w-fit" style={{ background: '#FFFFFF' }}>
      {LINKS.map((l) => (
        <Link
          key={l.href}
          href={l.href}
          aria-current={active(l.href) ? 'page' : undefined}
          className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
            active(l.href) ? 'bg-[#7F40E8]/10 text-[#6425C4] font-medium' : 'text-[#3D3650] hover:text-[#170B2E]'
          }`}
        >
          {l.label}
        </Link>
      ))}
    </nav>
  );
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-[#170B2E]">{title}</h1>
        </div>
        <p className="text-sm text-[#3D3650] mt-1">{subtitle}</p>
      </div>
      {actions && <div className="flex flex-wrap items-end gap-3">{actions}</div>}
    </div>
  );
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
    <section data-testid={testId} className={`rounded-2xl border border-[#E7DFF5] p-5 sm:p-6 ${className}`} style={{ background: '#FFFFFF' }}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-[#170B2E]">{title}</h2>}
            {subtitle && <p className="text-xs text-[#3D3650] mt-0.5">{subtitle}</p>}
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
    <div data-testid={testId} className="rounded-2xl border border-[#E7DFF5] p-5" style={{ background: '#FFFFFF' }}>
      <p className="text-xs text-[#3D3650]">{label}</p>
      <p className="text-2xl font-bold text-[#170B2E] mt-1 tabular-nums">{value}</p>
      {hint && <p className="text-xs text-[#3D3650] mt-1">{hint}</p>}
    </div>
  );
}

export function Loading({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center min-h-[30vh]" role="status">
      <div className="flex flex-col items-center gap-3">
        <svg className="animate-spin h-6 w-6 text-[#7F40E8]" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="text-sm text-[#3D3650]">{label}</span>
      </div>
    </div>
  );
}

export function ErrorBox({ children, onRetry }: { children: ReactNode; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 flex flex-wrap items-center gap-3">
      <AlertTriangle size={16} className="text-red-600 shrink-0" aria-hidden="true" />
      <p className="text-sm text-red-700 flex-1">{children}</p>
      {onRetry && (
        <button onClick={onRetry} className="text-xs font-medium text-[#6425C4] hover:text-[#170B2E]">
          Try again
        </button>
      )}
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-[#E7DFF5] py-14 px-6 text-center" style={{ background: '#FFFFFF' }}>
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
        style={{ background: 'rgba(127,64,232,0.1)', border: '1px solid rgba(127,64,232,0.2)' }}
      >
        <Languages size={24} style={{ color: '#7F40E8' }} aria-hidden="true" />
      </div>
      <p className="text-base font-semibold text-[#170B2E] mb-1">{title}</p>
      {children && <div className="text-sm text-[#3D3650] max-w-md mx-auto">{children}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export const selectCls =
  'w-full px-3 py-2.5 rounded-lg text-sm text-[#170B2E] bg-white border border-[#D6C4EE] outline-none focus:border-[#7F40E8]/60';

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
    <div className="flex flex-col gap-1.5 w-56">
      <label htmlFor="translation-project" className="text-sm font-medium text-[#3D3650]">
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
        <Link href="/dashboard/projects" className="text-sm font-medium text-[#6425C4] hover:text-[#170B2E]">
          Go to Projects &amp; Keys
        </Link>
      }
    >
      Live Translate settings, lexicons and metrics belong to a project.
    </Empty>
  );
}
