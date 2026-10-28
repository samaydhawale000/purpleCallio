'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  Users,
  PhoneCall,
  Gauge,
  Activity,
  ScrollText,
  Settings,
  LogOut,
  Menu,
  X,
  ShieldCheck,
  CreditCard,
  Headset,
  UserCog,
  Lock,
  Eye,
} from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { NotificationBell } from '../components/notifications/NotificationBell';
import { notifyNotificationsChanged } from '../lib/notifications';
import { useRealtimeEvent } from '../lib/realtime';
import { useRequireAuth } from '../hooks/useRequireAuth';
import logo from '../assets/images/logo.webp';
import { AdminAccessContext, getAdminMe, tabForPathname, type AdminPermissions } from '../lib/admin-access';

type NavItem = { label: string; href: string; icon: typeof LayoutDashboard };

const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  { items: [{ label: 'Dashboard', href: '/admin', icon: LayoutDashboard }] },
  {
    label: 'Operations',
    items: [
      { label: 'Customers', href: '/admin/customers', icon: Users },
      { label: 'Live Calls', href: '/admin/calls', icon: PhoneCall },
      { label: 'Usage', href: '/admin/usage', icon: Gauge },
      { label: 'System Health', href: '/admin/health', icon: Activity },
    ],
  },
  {
    label: 'Business',
    items: [
      { label: 'Billing', href: '/admin/billing', icon: CreditCard },
      { label: 'Support', href: '/admin/support', icon: Headset },
    ],
  },
  {
    label: 'Admin',
    items: [
      { label: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText },
      { label: 'Platform Settings', href: '/admin/settings', icon: Settings },
      { label: 'Admins', href: '/admin/admins', icon: UserCog },
    ],
  },
];

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const pathname = usePathname();
  useRequireAuth();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  // One subscription per layout; the bell(s) and notification page listen
  // for the resulting window event.
  useRealtimeEvent('notification:new', notifyNotificationsChanged);
  // Only render the layout UI after auth has been resolved to avoid flash.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Per-tab access for the signed-in admin (null until loaded).
  const token = useAuthStore((s) => s.token);
  const [perms, setPerms] = useState<AdminPermissions | null>(null);
  const [accessError, setAccessError] = useState(false);
  useEffect(() => {
    if (!token) return;
    getAdminMe()
      .then((me) => setPerms(me.permissions))
      .catch(() => setAccessError(true));
  }, [token]);
  const currentTab = tabForPathname(pathname);
  const currentLevel = currentTab ? perms?.[currentTab] : 'WRITE';
  const allowed = (item: NavItem) => {
    const tab = tabForPathname(item.href);
    return !tab || !!perms?.[tab];
  };
  const groups = NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter(allowed) })).filter((g) => g.items.length > 0);

  const displayName = user?.name || user?.email || 'Admin';
  const avatarUrl = user?.avatarUrl || '';

  return (
    <div className="min-h-screen bg-white lg:flex">
      {/* Mobile top bar */}
      <div className="flex h-14 items-center justify-between border-b border-[#ECE8F2] bg-white px-4 lg:hidden">
        <Link href="/admin" className="flex items-center gap-2">
          <Image src={logo} alt="PurpleCallio" width={132} height={32} className="h-auto w-[116px] object-contain" />
          <span className="rounded-md bg-[#F1EBFC] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#5B21B6]">Admin</span>
        </Link>
        <div className="flex items-center gap-2">
          <NotificationBell area="ADMIN" align="right" />
          <button
            onClick={() => setSidebarOpen(true)}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#ECE8F2] text-[#4B4458]"
            aria-label="Open menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      {sidebarOpen && <div className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebarOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-60 transform flex-col border-r border-[#ECE8F2] bg-white transition-transform duration-200 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        } lg:sticky lg:top-0 lg:h-screen lg:flex-none lg:translate-x-0`}
      >
        <div className="flex h-16 items-center justify-between gap-2 px-4">
          <Link href="/admin" className="flex min-w-0 items-center gap-2">
            <Image src={logo} alt="PurpleCallio" width={156} height={38} className="h-auto w-[112px] shrink-0 object-contain" />
            <span className="rounded-md bg-[#F1EBFC] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[#5B21B6]">Admin</span>
          </Link>
          <div className="hidden lg:block">
            <NotificationBell area="ADMIN" align="left" />
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="flex h-8 w-8 items-center justify-center text-[#4B4458] lg:hidden"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {groups.map((group, i) => (
            <div key={group.label ?? i} className="mt-4 first:mt-1">
              {group.label && (
                <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-[#9C95A8]">{group.label}</p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => {
                  const Icon = item.icon;
                  const active = pathname === item.href || (item.href !== '/admin' && !!pathname?.startsWith(item.href));
                  return (
                    <div key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                          active ? 'bg-[#F1EBFC] font-medium text-[#170B2E]' : 'text-[#4B4458] hover:bg-[#F7F6FA] hover:text-[#170B2E]'
                        }`}
                      >
                        <Icon size={16} className={active ? 'text-[#6D28D9]' : 'text-[#857E92]'} />
                        {item.label}
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[#ECE8F2] px-3 py-3">
          <div className="flex items-center gap-2.5 px-2.5 py-1.5">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={avatarUrl} alt={displayName} className="h-7 w-7 shrink-0 rounded-full object-cover" />
            ) : (
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#6D28D9] text-xs font-semibold text-white">
                {(displayName || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium text-[#170B2E]">{displayName}</p>
              <p className="truncate text-xs text-[#857E92]">Administrator</p>
            </div>
            <button
              onClick={() => {
                logout();
                router.push('/');
              }}
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#857E92] transition-colors hover:bg-[#F7F6FA] hover:text-red-600"
              aria-label="Logout"
              title="Logout"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <main className="w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          {ready &&
            (accessError ? (
              <NoAccess text="You don't have admin access." />
            ) : !perms ? null : !currentLevel ? (
              <NoAccess text="You don't have access to this section." />
            ) : (
              <AdminAccessContext.Provider value={perms}>
                {currentLevel === 'READ' && (
                  <div className="mb-4 inline-flex items-center gap-2 rounded-lg bg-[#F7F6FA] px-3 py-1.5 text-xs text-[#6B6478]">
                    <Eye size={14} aria-hidden="true" /> View only: you can see this section but not make changes.
                  </div>
                )}
                {children}
              </AdminAccessContext.Provider>
            ))}
        </main>
      </div>
    </div>
  );
}

function NoAccess({ text }: { text: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-24 text-center text-[#6B6478]">
      <Lock size={24} className="text-[#9C95A8]" aria-hidden="true" />
      <p className="text-sm">{text}</p>
    </div>
  );
}
