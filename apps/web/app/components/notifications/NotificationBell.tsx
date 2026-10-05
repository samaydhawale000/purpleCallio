'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell, BellOff } from 'lucide-react';
import { api } from '../../lib/api';
import { useAuthStore } from '../../store/auth.store';
import {
  NOTIFICATIONS_CHANGED,
  notificationsPath,
  notifyNotificationsChanged,
  type AppNotification,
  type NotificationArea,
} from '../../lib/notifications';
import { NotificationItem } from './NotificationItem';
import { useOpenNotification } from './useOpenNotification';

// The count is refreshed on navigation, on read-state changes, on realtime
// pushes (see the layouts) and on this interval as a fallback.
const POLL_MS = 60_000;

interface Props {
  area: NotificationArea;
  /** Which edge of the bell the dropdown lines up with. */
  align?: 'left' | 'right';
}

export function NotificationBell({ area, align = 'right' }: Props) {
  const token = useAuthStore((s) => s.token);
  const hasHydrated = useAuthStore((s) => s.hasHydrated);
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<AppNotification[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const enabled = hasHydrated && !!token;

  const refreshCount = useCallback(() => {
    if (!enabled) return;
    api
      .get(`/notifications/unread-count?audience=${area}`)
      .then((res) => setCount(res.data?.count ?? 0))
      .catch(() => {});
  }, [area, enabled]);

  const loadLatest = useCallback(() => {
    api
      .get(`/notifications?audience=${area}&page=1`)
      .then((res) => setItems((res.data?.data ?? []).slice(0, 5)))
      .catch(() => setItems([]));
  }, [area]);

  useEffect(() => {
    refreshCount();
    const timer = setInterval(refreshCount, POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, refreshCount);
    return () => {
      clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, refreshCount);
    };
  }, [refreshCount, pathname]);

  // While the dropdown is open, keep its list current too (a push arrives,
  // or something is marked read elsewhere).
  useEffect(() => {
    if (!open) return;
    window.addEventListener(NOTIFICATIONS_CHANGED, loadLatest);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, loadLatest);
  }, [open, loadLatest]);

  // Close on route change and on outside click / Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const openNotification = useOpenNotification(
    area,
    useCallback((id: string) => {
      setItems((prev) => prev?.map((n) => (n.id === id ? { ...n, read: true } : n)) ?? prev);
    }, []),
  );

  async function markAllRead() {
    setItems((prev) => prev?.map((n) => ({ ...n, read: true })) ?? prev);
    setCount(0);
    try {
      await api.patch(`/notifications/read-all?audience=${area}`);
    } finally {
      notifyNotificationsChanged();
    }
  }

  function toggle() {
    if (!open) loadLatest();
    setOpen((o) => !o);
  }

  if (!enabled) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={toggle}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg border border-[#E7DFF5] text-[#3D3650] hover:text-[#170B2E] hover:bg-[#7F40E8]/5 transition-colors"
        aria-label={count ? `Notifications, ${count} unread` : 'Notifications'}
        aria-expanded={open}
      >
        <Bell size={17} />
        {count > 0 && (
          <span
            className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div
          className={`absolute top-full mt-2 z-50 w-[340px] max-w-[calc(100vw-2rem)] rounded-xl border border-[#E7DFF5] bg-white shadow-xl overflow-hidden ${
            align === 'left' ? 'left-0' : 'right-0'
          }`}
        >
          <div className="flex items-center justify-between px-4 py-3 border-b border-[#E7DFF5]">
            <p className="text-sm font-semibold text-[#170B2E]">Notifications</p>
            {count > 0 && (
              <button
                type="button"
                onClick={markAllRead}
                className="text-xs font-medium text-[#6425C4] hover:text-[#170B2E]"
              >
                Mark all as read
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto divide-y divide-[#E7DFF5]">
            {items === null ? (
              <p className="px-4 py-8 text-center text-sm text-[#3D3650]">Loading…</p>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <BellOff size={20} className="mx-auto mb-2 text-[#A05DF9]" />
                <p className="text-sm text-[#3D3650]">You&apos;re all caught up.</p>
              </div>
            ) : (
              items.map((n) => (
                <NotificationItem key={n.id} notification={n} onOpen={openNotification} compact />
              ))
            )}
          </div>

          <Link
            href={notificationsPath(area)}
            className="block text-center px-4 py-2.5 text-sm font-medium text-[#6425C4] hover:bg-[#7F40E8]/[0.04] border-t border-[#E7DFF5]"
          >
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}
