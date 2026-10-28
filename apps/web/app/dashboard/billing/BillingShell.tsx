'use client';

import { useCallback, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../../store/auth.store';

import { ErrorNote, Loading, PageHeader, Tabs, buttonCls, type TabItem } from '../_ui';

/**
 * Shared chrome for every billing page: title, sub-navigation and the
 * loading / error states. Billing is money only — balance, transactions,
 * payments. Usage has its own page.
 */
const NAV: TabItem[] = [
  { label: 'Overview', href: '/dashboard/billing', exact: true },
  { label: 'Transactions', href: '/dashboard/billing/credits' },
  { label: 'Payments & receipts', href: '/dashboard/billing/payments', also: ['/dashboard/billing/invoices'] },
];

export function BillingNav() {
  return <Tabs items={NAV} />;
}

export function BillingHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div>
      <PageHeader title={title} description={subtitle} actions={actions} />
      <div className="-mt-2">
        <BillingNav />
      </div>
    </div>
  );
}

export function PageLoader({ label = 'Loading billing…' }: { label?: string }) {
  return <Loading label={label} />;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return <ErrorNote message={message} onRetry={onRetry} />;
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
    <section id={id} className={`scroll-mt-20 rounded-xl bg-[#F7F6FA] p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-[15px] font-semibold text-[#170B2E]">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-[#6B6478]">{subtitle}</p>}
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
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-[#170B2E]">{title}</h3>
        <div className="mt-2 space-y-2 text-sm text-[#6B6478]">{children}</div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={buttonCls('secondary')}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={tone === 'danger' ? buttonCls('primary', '!bg-red-600 hover:!bg-red-700') : buttonCls('primary')}
          >
            {busy ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
