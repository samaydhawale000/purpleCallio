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
} from 'lucide-react';
import { useAuthStore } from '../store/auth.store';
import { useRequireAuth } from '../hooks/useRequireAuth';
import logo from '../assets/images/logo.webp';

const NAV_ITEMS = [
  { label: 'Dashboard', href: '/admin', icon: LayoutDashboard },
  { label: 'Customers', href: '/admin/customers', icon: Users },
  { label: 'Live Calls', href: '/admin/calls', icon: PhoneCall },
  { label: 'Usage', href: '/admin/usage', icon: Gauge },
{ label: 'System Health', href: '/admin/health', icon: Activity },
  { label: 'Billing & Revenue', href: '/admin/billing', icon: CreditCard },
  { label: 'Audit Logs', href: '/admin/audit-logs', icon: ScrollText },
  { label: 'Platform Settings', href: '/admin/settings', icon: Settings },
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
  // Only render the layout UI after auth has been resolved to avoid flash.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  const displayName = user?.name || user?.email || 'Admin';
  const avatarUrl = user?.avatarUrl || '';

  return (
    <div className="min-h-screen lg:flex" style={{ background: '#FFFFFF' }}>
      {/* Mobile top bar */}
      <div
        className="lg:hidden flex items-center justify-between px-4 h-14 border-b border-[#E7DFF5]"
        style={{ background: '#F8F4FD' }}
      >
        <Link href="/admin" className="flex items-center gap-2">
          <Image src={logo} alt="PurpleCallio" width={132} height={32} className="h-auto w-[116px] object-contain" />
          <span className="font-mono font-bold text-[#170B2E] tracking-tight">
            Admin
          </span>
        </Link>
        <button
          onClick={() => setSidebarOpen(true)}
          className="w-10 h-10 flex items-center justify-center rounded-lg border border-[#E7DFF5] text-[#3D3650]"
          aria-label="Open menu"
        >
          <Menu size={20} />
        </button>
      </div>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 transform transition-transform duration-300
          border-r border-[#E7DFF5] flex flex-col
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:sticky lg:top-0 lg:h-screen lg:flex-none lg:w-64
        `}
        style={{ background: '#F8F4FD' }}
      >
        {/* Brand */}
        <div className="flex items-center justify-between px-5 h-16 border-b border-[#E7DFF5]">
          <Link href="/admin" className="flex items-center gap-2.5">
            <Image src={logo} alt="PurpleCallio" width={156} height={38} className="h-auto w-[136px] object-contain" />
            <span className="font-mono font-bold text-[#170B2E] tracking-tight">
              Admin
            </span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden w-8 h-8 flex items-center justify-center text-[#3D3650]"
            aria-label="Close menu"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          <p className="px-3 pb-2 text-[11px] font-mono uppercase tracking-widest text-[#3D3650]">
            Internal
          </p>
          <div className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const active =
                pathname === item.href ||
                (item.href !== '/admin' && pathname?.startsWith(item.href));
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`
                    flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all
                    ${active ? 'text-[#170B2E] font-medium' : 'text-[#3D3650] hover:text-[#170B2E]'}
                  `}
                  style={
                    active
                      ? {
                          background:
                            'linear-gradient(135deg, rgba(127,64,232,0.15), rgba(65,6,134,0.1))',
                          border: '1px solid rgba(127,64,232,0.25)',
                        }
                      : undefined
                  }
                >
                  <Icon size={17} style={{ color: active ? '#6425C4' : undefined }} />
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-[#E7DFF5]">
          <div className="flex items-center gap-3 px-3 py-2">
            {avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={avatarUrl}
                alt={displayName}
                className="w-8 h-8 rounded-full object-cover shrink-0"
              />
            ) : (
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold text-white shrink-0"
                style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
              >
                {(displayName || 'U')[0].toUpperCase()}
              </div>
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[#170B2E] truncate">{displayName}</p>
              <p className="text-xs text-[#3D3650] truncate">Administrator</p>
            </div>
            <button
              onClick={() => {
                logout();
                router.push('/');
              }}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-[#3D3650] hover:text-red-600 hover:bg-[#7F40E8]/5 transition-colors"
              aria-label="Logout"
              title="Logout"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 min-w-0">
        <main className="px-4 sm:px-6 lg:px-8 py-6 lg:py-8 max-w-7xl mx-auto">
          {ready && children}
        </main>
      </div>
    </div>
  );
}
