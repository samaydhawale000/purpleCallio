'use client';

/**
 * Admin billing building blocks. Thin wrappers over the dashboard kit so the
 * billing console shares its look: flat grey panels, white tables, one accent.
 */

import { ButtonHTMLAttributes, ReactNode, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { useAuthStore } from '../../../store/auth.store';
import { apiError, isAuthError } from '../../../lib/admin-billing';
import {
  Pager,
  Panel as KitPanel,
  Pill,
  Stat as KitStat,
  buttonCls,
  inputCls as kitInputCls,
  type Tone,
} from '../../../dashboard/_ui';

export const inputCls = `${kitInputCls} disabled:bg-[#F7F6FA] disabled:text-[#6B6478] read-only:bg-[#F7F6FA]`;
export const thCls = 'whitespace-nowrap px-4 py-2.5 text-xs font-medium text-[#6B6478]';
export const tdCls = 'px-4 py-3 align-top text-[#170B2E]';
export const linkBtn = 'text-[13px] font-medium text-[#5B21B6] hover:underline disabled:opacity-40 disabled:no-underline';
export const rowCls = 'border-b border-[#F2EFF6] last:border-0';

export function Spinner({ tall = true }: { tall?: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm text-[#6B6478] ${tall ? 'py-16' : 'py-6'}`}>
      <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading" />
      Loading…
    </div>
  );
}

/**
 * A titled block. The heading sits above a flat grey panel; pass `flush`
 * when the content is a table that should sit on the page directly.
 */
export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={className}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-[#170B2E]">{title}</h2>}
            {subtitle && <p className="mt-0.5 max-w-3xl text-[13px] text-[#6B6478]">{subtitle}</p>}
          </div>
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
      {flush ? children : <KitPanel>{children}</KitPanel>}
    </section>
  );
}

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1.5 block text-[13px] font-medium text-[#170B2E]">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-[#6B6478]">{hint}</span>}
    </label>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-sm text-[#170B2E]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[#6D28D9]"
      />
      <span>
        {label}
        {hint && <span className="block text-xs text-[#6B6478]">{hint}</span>}
      </span>
    </label>
  );
}

/** A number with a label. Place several inside one Panel or StatRow. */
export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return <KitStat label={label} value={value} hint={hint} />;
}

/** One grey panel holding a row of stats. */
export function StatRow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <KitPanel className={className}>
      <div className="grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">{children}</div>
    </KitPanel>
  );
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'success',
  PAID: 'success',
  ACCEPTED: 'success',
  INACTIVE: 'neutral',
  ARCHIVED: 'neutral',
  DRAFT: 'neutral',
  CLOSED: 'neutral',
  WITHDRAWN: 'neutral',
  CANCELLED: 'neutral',
  CANCELED: 'neutral',
  EXPIRED: 'neutral',
  PENDING: 'warning',
  PENDING_PAYMENT: 'warning',
  PAST_DUE: 'warning',
  NEGOTIATING: 'warning',
  CONTACTED: 'accent',
  PROPOSAL_SENT: 'accent',
  SENT: 'accent',
  NEW: 'accent',
  FAILED: 'danger',
  REFUNDED: 'danger',
  REJECTED: 'danger',
  SUSPENDED: 'danger',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const text = label ?? status.replace(/_/g, ' ').toLowerCase();
  return <Pill tone={STATUS_TONE[status] ?? 'neutral'}>{text.charAt(0).toUpperCase() + text.slice(1)}</Pill>;
}

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple';
const BADGE_TONE: Record<BadgeVariant, Tone> = {
  default: 'neutral',
  success: 'success',
  warning: 'warning',
  error: 'danger',
  info: 'accent',
  purple: 'accent',
};

/** Same props as components/ui/Badge, rendered as a kit Pill. */
export function Badge({ variant = 'default', children }: { variant?: BadgeVariant; children: ReactNode; className?: string }) {
  return <Pill tone={BADGE_TONE[variant]}>{children}</Pill>;
}

/** Same props as components/ui/Button, without the gradient. */
export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  children,
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}) {
  const sizeCls = size === 'sm' ? 'px-3 py-1.5 text-[13px]' : size === 'lg' ? 'px-5 py-2.5' : '';
  return (
    <button {...props} disabled={loading || props.disabled} className={buttonCls(variant, `${sizeCls} ${className}`)}>
      {loading && <Loader2 size={14} className="shrink-0 animate-spin" />}
      {children}
    </button>
  );
}

/** Same props as components/ui/Pagination, rendered with the kit Pager. */
export function Pagination({
  page,
  pageCount,
  totalItems,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  totalItems: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (totalItems === 0) return null;
  return <Pager page={page} pageCount={pageCount} total={totalItems} onChange={onPageChange} />;
}

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className={`my-10 w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-xl bg-white shadow-xl`}>
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <h3 className="text-base font-semibold text-[#170B2E]">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-[#6B6478] hover:bg-[#F7F6FA] hover:text-[#170B2E]"
          >
            <X size={18} />
          </button>
        </div>
        <div className="px-6 pb-6 pt-3">{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-700">
      {children}
    </p>
  );
}

/** Log out and leave on 401/403; otherwise return a readable message. */
export function useAdminErrorHandler() {
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  return useCallback(
    (e: unknown, fallback?: string) => {
      if (isAuthError(e)) {
        logout();
        router.push('/');
        return '';
      }
      return apiError(e, fallback);
    },
    [logout, router],
  );
}

/** Small fetch helper: loading / error / reload for a single resource. */
export function useResource<T>(loader: () => Promise<T>, deps: unknown[]) {
  const handle = useAdminErrorHandler();
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const reload = useCallback(async () => {
    setError('');
    try {
      setData(await loader());
    } catch (e) {
      setError(handle(e, 'Failed to load'));
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    setLoading(true);
    reload();
  }, [reload]);
  return { data, setData, loading, error, reload };
}

/** White table with thin borders; rows are passed as <tr className={rowCls}>. */
export function Table({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-[#ECE8F2] bg-white">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#ECE8F2] text-left">
            {headers.map((h, i) => (
              <th key={`${h}-${i}`} className={thCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {empty && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-10 text-center text-[13px] text-[#6B6478]">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
