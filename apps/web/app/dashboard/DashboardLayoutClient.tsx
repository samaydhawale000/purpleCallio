'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard,
  FolderKanban,
  PhoneCall,
  Play,
  Bot,
  Languages,
  Gauge,
  CreditCard,
  BookOpen,
  Headset,
  Settings,
  LogOut,
  Menu,
  X,
} from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { NotificationBell } from '../components/notifications/NotificationBell';
import { notifyNotificationsChanged } from '../lib/notifications';
import { useRealtimeEvent } from '../lib/realtime';
import { useRequireAuth } from '../hooks/useRequireAuth';
import { useAiStatus } from '../lib/ai';
import logo from '../assets/images/logo.webp';

type NavItem = { label: string; href: string; icon: typeof LayoutDashboard };
type NavGroup = { label?: string; items: NavItem[] };

const AI_NAV_ITEM: NavItem = { label: 'AI Agents', href: '/dashboard/ai', icon: Bot };

function navGroups(aiEnabled: boolean): NavGroup[] {
  return [
    { items: [{ label: 'Home', href: '/dashboard', icon: LayoutDashboard }] },
    {
      label: 'Build',
      items: [
        { label: 'Projects & Keys', href: '/dashboard/projects', icon: FolderKanban },
        { label: 'Calls', href: '/dashboard/calls', icon: PhoneCall },
        { label: 'Playground', href: '/dashboard/playground', icon: Play },
        { label: 'Live Translate', href: '/dashboard/translation', icon: Languages },
        ...(aiEnabled ? [AI_NAV_ITEM] : []),
      ],
    },
    {
      label: 'Account',
      items: [
        { label: 'Usage', href: '/dashboard/usage', icon: Gauge },
        { label: 'Billing', href: '/dashboard/billing', icon: CreditCard },
        { label: 'Settings', href: '/dashboard/settings', icon: Settings },
      ],
    },
  ];
}

const FOOTER_ITEMS: NavItem[] = [
  { label: 'Documentation', href: '/docs', icon: BookOpen },
  { label: 'Support', href: '/dashboard/support', icon: Headset },
];

function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon;
  return (
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
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const logout = useAuthStore((s) => s.logout);
  const user = useAuthStore((s) => s.user);
  const router = useRouter();
  const pathname = usePathname();
  const { isReady } = useRequireAuth();
  const { status: aiStatus } = useAiStatus();
  const groups = navGroups(!!aiStatus?.enabled);

  const [sidebarOpen, setSidebarOpen] = useState(false);
  // One subscription per layout; the bell(s) and notification page listen
  // for the resulting window event.
  useRealtimeEvent('notification:new', notifyNotificationsChanged);

  const displayName = user?.name || user?.email || 'Account';
  const avatarUrl = user?.avatarUrl || '';

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  // Profile completion (including the contact phone Razorpay needs) happens
  // on /login right after Google sign-in. A session whose profile is still
  // incomplete is sent back there instead of into the dashboard.
  const needsOnboarding = isReady && user?.profileCompleted === false;
  useEffect(() => {
    if (needsOnboarding) router.replace('/login');
  }, [needsOnboarding, router]);

  if (needsOnboarding) {
    return null;
  }

  const isActive = (href: string) =>
    pathname === href || (href !== '/dashboard' && !!pathname?.startsWith(href));

  return (
    <div className="min-h-screen bg-white lg:flex">
      {/* Mobile top bar */}
      <div className="flex h-14 items-center justify-between border-b border-[#ECE8F2] bg-white px-4 lg:hidden">
        <Link href="/dashboard" className="flex items-center">
          <Image src={logo} alt="PurpleCallio" width={132} height={32} className="h-auto w-[116px] object-contain" />
        </Link>
        <div className="flex items-center gap-2">
          <NotificationBell area="CUSTOMER" align="right" />
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
          <Link href="/dashboard" className="flex min-w-0 items-center">
            <Image src={logo} alt="PurpleCallio" width={156} height={38} className="h-auto w-[128px] object-contain" />
          </Link>
          <div className="hidden lg:block">
            <NotificationBell area="CUSTOMER" align="left" />
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
                <p className="px-2.5 pb-1.5 text-[11px] font-medium uppercase tracking-wider text-[#9C95A8]">
                  {group.label}
                </p>
              )}
              <div className="flex flex-col gap-0.5">
                {group.items.map((item) => (
                  <NavLink key={item.href} item={item} active={isActive(item.href)} />
                ))}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-[#ECE8F2] px-3 py-3">
          <div className="mb-2 flex flex-col gap-0.5">
            {FOOTER_ITEMS.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>
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
              {user?.email && <p className="truncate text-xs text-[#857E92]">{user.email}</p>}
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
        <main className="w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}
