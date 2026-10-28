'use client';

/**
 * Building blocks shared by every dashboard page. One look everywhere:
 * flat grey panels, a single purple accent, no gradients, no glow.
 */

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, Loader2, X } from 'lucide-react';

export { LineChart } from './LineChart';
export type { ChartSeries } from './LineChart';

// ── Formatting ──────────────────────────────────────────────

export const fmtNumber = (n: number | null | undefined) =>
  (Number.isFinite(n) ? Number(n) : 0).toLocaleString('en-IN');

export const fmtDate = (iso: string | Date | null | undefined) =>
  iso
    ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

export const fmtDateTime = (iso: string | Date | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('en-IN', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—';

/** "12 Oct" axis label from a YYYY-MM-DD key. */
export const fmtDay = (date: string) =>
  new Date(`${date}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

// ── Data loading ────────────────────────────────────────────

/**
 * Loads one block of data. Each block on a page loads on its own, so a
 * single failing request shows an error in that block instead of blanking
 * the whole page.
 */
export function useResource<T>(
  load: () => Promise<T>,
  deps: unknown[] = [],
  errorText?: (e: unknown) => string,
) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const loadRef = useRef(load);
  loadRef.current = load;
  const errorRef = useRef(errorText);
  errorRef.current = errorText;

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await loadRef.current());
    } catch (e: any) {
      setError(errorRef.current?.(e) ?? (e?.response?.data?.message || 'Could not load this section.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, error, loading, reload, setData };
}

// ── Layout ──────────────────────────────────────────────────

export function PageHeader({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[22px] font-semibold tracking-tight text-[#170B2E]">{title}</h1>
          {description && <p className="mt-1 text-sm text-[#6B6478]">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children && <div className="mt-6">{children}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-10 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-[#170B2E]">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-[#6B6478]">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Panel({
  children,
  className = '',
  padded = true,
}: {
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return <div className={`rounded-xl bg-[#F7F6FA] ${padded ? 'p-5' : ''} ${className}`}>{children}</div>;
}

export function Stat({
  label,
  value,
  unit,
  hint,
  tone,
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  tone?: 'danger';
}) {
  return (
    <div className="min-w-0">
      <p className="text-[13px] text-[#6B6478]">{label}</p>
      <p
        className={`mt-1 text-[26px] font-semibold leading-tight tracking-tight ${
          tone === 'danger' ? 'text-[#C2410C]' : 'text-[#170B2E]'
        }`}
      >
        {value}
        {unit && <span className="ml-1 text-sm font-normal text-[#6B6478]">{unit}</span>}
      </p>
      {hint && <p className="mt-1 text-xs text-[#6B6478]">{hint}</p>}
    </div>
  );
}

// ── Navigation ──────────────────────────────────────────────

export type TabItem = { label: string; href: string; exact?: boolean; also?: string[] };

export function Tabs({ items }: { items: TabItem[] }) {
  const pathname = usePathname() ?? '';
  const isActive = (t: TabItem) => {
    const paths = [t.href, ...(t.also ?? [])];
    return paths.some((p) => (t.exact ? pathname === p : pathname === p || pathname.startsWith(`${p}/`)));
  };
  return (
    <nav className="mb-8 flex gap-6 overflow-x-auto border-b border-[#ECE8F2]" aria-label="Sections">
      {items.map((t) => {
        const active = isActive(t);
        return (
          <Link
            key={t.href}
            href={t.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px whitespace-nowrap border-b-2 pb-2.5 text-sm transition-colors ${
              active
                ? 'border-[#7F40E8] font-medium text-[#170B2E]'
                : 'border-transparent text-[#6B6478] hover:text-[#170B2E]'
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-lg border border-[#ECE8F2] bg-white p-0.5">
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`rounded-md px-3 py-1 text-[13px] transition-colors ${
            o.value === value ? 'bg-[#F1EBFC] font-medium text-[#5B21B6]' : 'text-[#6B6478] hover:text-[#170B2E]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Controls ────────────────────────────────────────────────

const btnBase =
  'inline-flex items-center justify-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
const btnVariants = {
  primary: 'bg-[#6D28D9] text-white hover:bg-[#5B21B6]',
  secondary: 'border border-[#E4DEEE] bg-white text-[#170B2E] hover:bg-[#F7F6FA]',
  ghost: 'text-[#5B21B6] hover:bg-[#F1EBFC]',
  danger: 'border border-red-200 bg-white text-red-600 hover:bg-red-50',
};
export type ButtonVariant = keyof typeof btnVariants;
export const buttonCls = (variant: ButtonVariant = 'primary', extra = '') =>
  `${btnBase} ${btnVariants[variant]} ${extra}`;

export const inputCls =
  'w-full rounded-lg border border-[#E4DEEE] bg-white px-3 py-2 text-sm text-[#170B2E] placeholder:text-[#9C95A8] focus:border-[#7F40E8] focus:outline-none focus:ring-2 focus:ring-[#7F40E8]/15';

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-sm font-medium text-[#5B21B6] hover:underline">
      {children}
    </Link>
  );
}

// ── Tables ──────────────────────────────────────────────────

export type Column<T> = {
  key: string;
  label: string;
  align?: 'right';
  mono?: boolean;
  className?: string;
  render: (row: T) => ReactNode;
};

export function Table<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  empty,
}: {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  empty?: ReactNode;
}) {
  if (rows.length === 0 && empty) return <>{empty}</>;
  return (
    <div className="overflow-x-auto rounded-xl border border-[#ECE8F2] bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#ECE8F2] text-left">
            {columns.map((c) => (
              <th
                key={c.key}
                className={`whitespace-nowrap px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-[#6B6478] ${
                  c.align === 'right' ? 'text-right' : ''
                }`}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={`border-b border-[#F2EFF6] last:border-0 ${
                onRowClick ? 'cursor-pointer hover:bg-[#FAF9FC]' : ''
              }`}
            >
              {columns.map((c) => (
                <td
                  key={c.key}
                  className={`whitespace-nowrap px-4 py-3 text-[#170B2E] ${c.align === 'right' ? 'text-right tabular-nums' : ''} ${
                    c.mono ? 'font-mono text-[13px]' : ''
                  } ${c.className ?? ''}`}
                >
                  {c.render(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Status ──────────────────────────────────────────────────

export type Tone = 'neutral' | 'success' | 'warning' | 'danger' | 'accent';
const toneCls: Record<Tone, string> = {
  neutral: 'bg-[#F2EFF6] text-[#4B4458]',
  success: 'bg-emerald-50 text-emerald-700',
  warning: 'bg-amber-50 text-amber-700',
  danger: 'bg-red-50 text-red-700',
  accent: 'bg-[#F1EBFC] text-[#5B21B6]',
};

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ${toneCls[tone]}`}>
      {children}
    </span>
  );
}

// ── States ──────────────────────────────────────────────────

export function Loading({ label = 'Loading…', className = '' }: { label?: string; className?: string }) {
  return (
    <div className={`flex items-center gap-2 py-8 text-sm text-[#6B6478] ${className}`} role="status">
      <Loader2 size={16} className="animate-spin" />
      {label}
    </div>
  );
}

export function Empty({ title, body, action }: { title: ReactNode; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-[#E4DEEE] px-6 py-10 text-center">
      <p className="text-sm font-medium text-[#170B2E]">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-[13px] text-[#6B6478]">{body}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorNote({ message, onRetry }: { message: ReactNode; onRetry?: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      <AlertCircle size={15} className="shrink-0" />
      <span className="min-w-0 flex-1">{message}</span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="font-medium underline">
          Retry
        </button>
      )}
    </div>
  );
}

export function Notice({ tone = 'warning', children }: { tone?: 'warning' | 'info'; children: ReactNode }) {
  return (
    <div
      className={`mb-6 rounded-lg px-4 py-3 text-sm ${
        tone === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-[#F1EBFC] text-[#4C1D95]'
      }`}
    >
      {children}
    </div>
  );
}

/** Right-hand detail panel for a selected row. */
export function Drawer({
  title,
  onClose,
  children,
}: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        role="dialog"
        aria-label={typeof title === 'string' ? title : undefined}
        className="h-full w-full max-w-md overflow-y-auto bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center justify-between">
          <h2 className="text-base font-semibold text-[#170B2E]">{title}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-[#6B6478] hover:bg-[#F7F6FA]">
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

/** Label / value rows inside a drawer or panel. */
export function DetailList({ items }: { items: { label: string; value: ReactNode; mono?: boolean }[] }) {
  return (
    <dl className="divide-y divide-[#F2EFF6] text-sm">
      {items.map((i) => (
        <div key={i.label} className="flex justify-between gap-4 py-2.5">
          <dt className="shrink-0 text-[#6B6478]">{i.label}</dt>
          <dd className={`min-w-0 break-all text-right text-[#170B2E] ${i.mono ? 'font-mono text-[13px]' : ''}`}>{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Pager({
  page,
  pageCount,
  total,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-3 flex items-center justify-between text-[13px] text-[#6B6478]">
      <span>
        Page {page} of {pageCount} · {fmtNumber(total)} total
      </span>
      <div className="flex gap-2">
        <button type="button" className={buttonCls('secondary', 'px-3 py-1.5')} disabled={page <= 1} onClick={() => onChange(page - 1)}>
          Previous
        </button>
        <button
          type="button"
          className={buttonCls('secondary', 'px-3 py-1.5')}
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
        >
          Next
        </button>
      </div>
    </div>
  );
}

/** Renders loading / error / content for one block loaded with useResource. */
export function Block<T>({
  res,
  children,
  loadingLabel,
}: {
  res: { data: T | null; error: string | null; loading: boolean; reload: () => void };
  children: (data: T) => ReactNode;
  loadingLabel?: string;
}) {
  if (res.loading && res.data == null) return <Loading label={loadingLabel} />;
  if (res.error) return <ErrorNote message={res.error} onRetry={res.reload} />;
  if (res.data == null) return null;
  return <>{children(res.data)}</>;
}
