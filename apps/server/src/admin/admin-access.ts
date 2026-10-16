/**
 * Per-tab admin access. `User.adminPermissions` maps a tab key to READ or
 * WRITE; a missing tab means no access. `null` means full access (the
 * original admins, before team permissions existed).
 *
 * Dashboard and Notifications are open to every admin.
 */
export const ADMIN_TABS = [
  'customers',
  'calls',
  'usage',
  'health',
  'billing',
  'support',
  'audit-logs',
  'settings',
  'admins',
] as const;

export type AdminTab = (typeof ADMIN_TABS)[number];
export type AdminAccessLevel = 'READ' | 'WRITE';
export type AdminPermissions = Partial<Record<AdminTab, AdminAccessLevel>>;

/** Which tab an /admin/... API path belongs to; null = any admin may call it. */
export function tabForPath(path: string): AdminTab | null {
  const rest = path.split('?')[0].replace(/^.*?\/admin\/?/, '');
  const [first, second] = rest.split('/');
  switch (first) {
    case 'billing':
      // The customer page shows the customer's billing panel.
      return second === 'customers' ? 'customers' : 'billing';
    case 'customers':
    case 'calls':
    case 'usage':
    case 'support':
    case 'audit-logs':
    case 'settings':
    case 'admins':
      return first;
    case 'health':
    case 'monitoring':
    case 'alerts':
      return 'health';
    default:
      return null; // overview, me
  }
}

/** Keeps only known tabs with a valid level. */
export function cleanPermissions(input: unknown): AdminPermissions {
  const out: AdminPermissions = {};
  if (!input || typeof input !== 'object') return out;
  for (const tab of ADMIN_TABS) {
    const level = (input as Record<string, unknown>)[tab];
    if (level === 'READ' || level === 'WRITE') out[tab] = level;
  }
  return out;
}

/** Resolved access for every tab (null permissions = WRITE everywhere). */
export function resolvePermissions(perms: unknown): AdminPermissions {
  if (perms == null) return Object.fromEntries(ADMIN_TABS.map((t) => [t, 'WRITE'])) as AdminPermissions;
  return cleanPermissions(perms);
}
