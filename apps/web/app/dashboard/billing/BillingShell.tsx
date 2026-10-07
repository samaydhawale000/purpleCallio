'use client';

import { useCallback, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { useAuthStore } from '../../store/auth.store';

/**
 * Shared chrome for every billing page: title, sub-navigation and the
 * loading / error states. Plan, Credits and Usage are the center of the
 * billing area; payment methods are secondary.
 */
const NAV: { label: string; href: string; match?: (p: string) => boolean }[] = [
  { label: 'Overview', href: '/dashboard/billing', match: (p) => p === '/dashboard/billing' },
  { label: 'Plans', href: '/dashboard/billing/plans', match: (p) => p.startsWith('/dashboard/billing/plans') || p.startsWith('/dashboard/billing/offers') },
  { label: 'Credits', href: '/dashboard/billing/credits', match: (p) => p.startsWith('/dashboard/billing/credits') },
  { label: 'Usage', href: '/dashboard/usage', match: (p) => p.startsWith('/dashboard/usage') },
  { label: 'Payments & receipts', href: '/dashboard/billing/payments', match: (p) => p.startsWith('/dashboard/billing/payments') || p.startsWith('/dashboard/billing/invoices') },
  { label: 'Top-ups', href: '/dashboard/billing/credits#topups', match: () => false },
  { label: 'Payment methods', href: '/dashboard/billing/payments#payment-methods', match: () => false },
];

export function BillingNav() {
  const pathname = usePathname() ?? '';
  return (
    <nav aria-label="Billing" className="flex gap-1 overflow-x-auto border-b border-[#E7DFF5] -mb-px">
      {NAV.map((item) => {
        const active = item.match ? item.match(pathname) : pathname === item.href;
        return (
          <Link
            key={item.label}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`whitespace-nowrap px-3 py-2 text-sm border-b-2 transition-colors ${
              active
                ? 'border-[#7F40E8] text-[#170B2E] font-semibold'
                : 'border-transparent text-[#3D3650] hover:text-[#170B2E]'
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BillingHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">{title}</h1>
          {subtitle && <p className="text-sm text-[#3D3650] mt-1">{subtitle}</p>}
        </div>
        {actions}
      </div>
      <BillingNav />
    </div>
  );
}

export function PageLoader({ label = 'Loading billing…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center min-h-[40vh]">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="animate-spin h-6 w-6 text-[#7F40E8]" />
        <span className="text-sm text-[#3D3650]">{label}</span>
      </div>
    </div>
  );
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 px-4 py-3 text-sm text-red-600"
      style={{ background: 'rgba(239,68,68,0.06)' }}
    >
      <span className="inline-flex items-center gap-2">
        <AlertTriangle size={14} /> {message}
      </span>
      {onRetry && (
        <button type="button" onClick={onRetry} className="text-xs font-medium underline">
          Try again
        </button>
      )}
    </div>
  );
}

export function SectionCard({
  title,
  subtitle,
  actions,
  children,
  id,
  className = '',
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <section id={id} className={`rounded-2xl border border-[#E7DFF5] bg-white p-6 scroll-mt-20 ${className}`}>
      {(title || actions) && (
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            {title && <h2 className="text-sm font-semibold text-[#170B2E]">{title}</h2>}
            {subtitle && <p className="text-xs text-[#3D3650] mt-0.5">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

/** 401 → log out and send to login; returns true when handled. */
export function useAuthErrorHandler() {
  const logout = useAuthStore((s) => s.logout);
  const router = useRouter();
  return useCallback(
    (e: unknown) => {
      if ((e as { response?: { status?: number } })?.response?.status === 401) {
        logout();
        router.push('/login');
        return true;
      }
      return false;
    },
    [logout, router],
  );
}

export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  cancelLabel = 'Go back',
  tone = 'primary',
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'primary' | 'danger';
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" role="dialog" aria-modal="true" aria-label={title}>
      <div className="w-full max-w-md rounded-2xl border border-[#E7DFF5] bg-white p-6 shadow-2xl">
        <h3 className="text-base font-semibold text-[#170B2E]">{title}</h3>
        <div className="mt-2 text-sm text-[#3D3650] space-y-2">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-lg border border-[#D6C4EE] text-[#3D3650] hover:bg-[#F0E9FA] disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`text-sm px-4 py-2 rounded-lg font-medium disabled:opacity-50 ${
              tone === 'danger' ? 'bg-red-600 text-white hover:bg-red-700' : 'text-white'
            }`}
            style={tone === 'primary' ? { background: 'linear-gradient(135deg, #7F40E8 0%, #410686 100%)' } : undefined}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
