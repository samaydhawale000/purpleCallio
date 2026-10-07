'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, X } from 'lucide-react';
import { useAuthStore } from '../../../store/auth.store';
import { apiError, isAuthError } from '../../../lib/admin-billing';
import { Badge } from '../../../components/ui/Badge';

export const inputCls =
  'w-full rounded-lg border border-[#E7DFF5] bg-white px-3 py-2 text-sm text-[#170B2E] focus:border-[#7F40E8] outline-none disabled:opacity-60';
export const thCls = 'px-4 py-3 text-xs font-mono uppercase tracking-widest text-[#3D3650] whitespace-nowrap';
export const tdCls = 'px-4 py-3 text-[#3D3650] align-top';
export const linkBtn = 'text-xs font-medium text-[#6425C4] hover:text-[#170B2E] disabled:opacity-40';

export function Spinner({ tall = true }: { tall?: boolean }) {
  return (
    <div className={`flex items-center justify-center ${tall ? 'min-h-[40vh]' : 'py-10'}`}>
      <Loader2 className="animate-spin h-6 w-6 text-[#7F40E8]" aria-label="Loading" />
    </div>
  );
}

export function Panel({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-[#E7DFF5] bg-white p-5 sm:p-6 ${className}`}>
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
      <span className="block text-xs font-medium text-[#3D3650] mb-1">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-[#6B6478] mt-1">{hint}</span>}
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
    <label className="flex items-start gap-2 text-sm text-[#170B2E] cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[#7F40E8]"
      />
      <span>
        {label}
        {hint && <span className="block text-[11px] text-[#6B6478]">{hint}</span>}
      </span>
    </label>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="rounded-xl border border-[#E7DFF5] p-4 bg-white">
      <p className="text-xs text-[#3D3650]">{label}</p>
      <p className="text-xl font-bold text-[#170B2E] mt-1">{value}</p>
      {hint && <p className="text-[11px] text-[#6B6478] mt-1">{hint}</p>}
    </div>
  );
}

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple'> = {
  ACTIVE: 'success',
  PAID: 'success',
  ACCEPTED: 'success',
  INACTIVE: 'default',
  ARCHIVED: 'default',
  DRAFT: 'default',
  CLOSED: 'default',
  WITHDRAWN: 'default',
  CANCELLED: 'default',
  CANCELED: 'default',
  EXPIRED: 'default',
  PENDING: 'warning',
  PENDING_PAYMENT: 'warning',
  PAST_DUE: 'warning',
  NEGOTIATING: 'warning',
  CONTACTED: 'info',
  PROPOSAL_SENT: 'purple',
  SENT: 'purple',
  NEW: 'info',
  FAILED: 'error',
  REFUNDED: 'error',
  REJECTED: 'error',
  SUSPENDED: 'error',
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge variant={STATUS_VARIANT[status] ?? 'default'}>{label ?? status.replace(/_/g, ' ').toLowerCase()}</Badge>;
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
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 overflow-y-auto" role="dialog" aria-modal="true" aria-label={title}>
      <div className={`w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} rounded-2xl bg-white border border-[#E7DFF5] shadow-2xl my-8`}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#E7DFF5]">
          <h3 className="text-base font-semibold text-[#170B2E]">{title}</h3>
          <button onClick={onClose} aria-label="Close" className="text-[#3D3650] hover:text-[#170B2E]">
            <X size={18} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p role="alert" className="text-sm text-red-600">
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

export function Table({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#E7DFF5] text-left">
            {headers.map((h) => (
              <th key={h} className={thCls}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {children}
          {empty && (
            <tr>
              <td colSpan={headers.length} className="px-4 py-10 text-center text-[#3D3650]">
                {empty}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export const rowCls = 'border-b border-[#E7DFF5]/60 last:border-0';
