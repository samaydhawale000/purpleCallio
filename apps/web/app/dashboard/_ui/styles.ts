/**
 * Plain helpers shared by the dashboard kit. No 'use client' here, so server
 * components can call them too (e.g. buttonCls on a server-rendered Link).
 */

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
