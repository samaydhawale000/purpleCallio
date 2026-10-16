'use client';

import { createContext, useContext } from 'react';
import { usePathname } from 'next/navigation';
import { api } from './api';

/** Admin tabs that can be granted per person. Mirrors apps/server/src/admin/admin-access.ts. */
export const ADMIN_TABS = [
  { key: 'customers', label: 'Customers', href: '/admin/customers' },
  { key: 'calls', label: 'Live Calls', href: '/admin/calls' },
  { key: 'usage', label: 'Usage', href: '/admin/usage' },
  { key: 'health', label: 'System Health', href: '/admin/health' },
  { key: 'billing', label: 'Billing', href: '/admin/billing' },
  { key: 'support', label: 'Support', href: '/admin/support' },
  { key: 'audit-logs', label: 'Audit Logs', href: '/admin/audit-logs' },
  { key: 'settings', label: 'Platform Settings', href: '/admin/settings' },
  { key: 'admins', label: 'Admins', href: '/admin/admins' },
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number]['key'];
export type AdminAccessLevel = 'READ' | 'WRITE';
export type AdminPermissions = Partial<Record<AdminTab, AdminAccessLevel>>;

export interface AdminMember {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  adminPermissions: AdminPermissions | null;
  fullAccess?: boolean;
}

export const getAdminMe = () =>
  api.get<AdminMember & { permissions: AdminPermissions }>('/admin/me').then((r) => r.data);
export const listAdmins = () => api.get<AdminMember[]>('/admin/admins').then((r) => r.data);
export const addAdmin = (email: string, permissions: AdminPermissions) =>
  api.post<AdminMember>('/admin/admins', { email, permissions }).then((r) => r.data);
export const updateAdmin = (id: string, permissions: AdminPermissions) =>
  api.patch<AdminMember>(`/admin/admins/${id}`, { permissions }).then((r) => r.data);
export const removeAdmin = (id: string) => api.delete(`/admin/admins/${id}`).then((r) => r.data);

/** The tab a /admin page belongs to; null for Dashboard / Notifications (open to every admin). */
export function tabForPathname(pathname: string | null): AdminTab | null {
  return ADMIN_TABS.find((t) => pathname?.startsWith(t.href))?.key ?? null;
}

// ── Context ──────────────────────────────────────────────────────────────
export const AdminAccessContext = createContext<AdminPermissions | null>(null);

/** Access level for a tab (defaults to the current page's tab). */
export function useAdminAccess(tab?: AdminTab | null) {
  const perms = useContext(AdminAccessContext);
  const pathname = usePathname();
  const key = tab === undefined ? tabForPathname(pathname) : tab;
  // No provider (e.g. a component rendered in isolation) = no client-side gating; the API still enforces access.
  const level = !key || !perms ? 'WRITE' : perms[key];
  return { canRead: !!level, canWrite: level === 'WRITE' };
}

/** True when the signed-in admin may take actions on the current page. */
export const useCanWrite = (tab?: AdminTab | null) => useAdminAccess(tab).canWrite;
