'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellOff, CheckCheck, RefreshCw, TriangleAlert } from 'lucide-react';
import { api } from '../../lib/api';
import {
  NOTIFICATIONS_CHANGED,
  notifyNotificationsChanged,
  type AppNotification,
  type NotificationArea,
} from '../../lib/notifications';
import { Button } from '../ui/Button';
import { Pagination } from '../ui/Pagination';
import { EmptyState } from '../ui/EmptyState';
import { NotificationItem } from './NotificationItem';
import { useOpenNotification } from './useOpenNotification';

type Filter = 'all' | 'unread';

/** Full notification center (the /notifications page body) for either area. */
export function NotificationsPanel({ area }: { area: NotificationArea }) {
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unread, setUnread] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [markingAll, setMarkingAll] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [pageCount, setPageCount] = useState(1);

  const load = useCallback(() => {
    const params = new URLSearchParams({ audience: area, page: String(page) });
    if (filter === 'unread') params.set('filter', 'unread');
    return api
      .get(`/notifications?${params}`)
      .then((res) => {
        setItems(res.data.data ?? []);
        setUnread(res.data.unread ?? 0);
        setTotal(res.data.total ?? 0);
        setPageCount(res.data.pageCount ?? 1);
        setPageSize(res.data.pageSize ?? 10);
        setFailed(false);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [area, filter, page]);

  useEffect(() => {
    load();
  }, [load]);

  // A read in the bell dropdown (or another tab of this page) refreshes us.
  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => window.removeEventListener(NOTIFICATIONS_CHANGED, load);
  }, [load]);

  const openNotification = useOpenNotification(
    area,
    useCallback((id: string) => {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
      setUnread((u) => Math.max(0, u - 1));
    }, []),
  );

  async function markAllRead() {
    setMarkingAll(true);
    try {
      await api.patch(`/notifications/read-all?audience=${area}`);
      notifyNotificationsChanged();
    } finally {
      setMarkingAll(false);
    }
  }

  function changeFilter(f: Filter) {
    setFilter(f);
    setPage(1);
    setLoading(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#170B2E]">Notifications</h1>
          <p className="text-sm text-[#3D3650] mt-1">
            {unread > 0 ? `${unread} unread` : 'You’re all caught up.'}
          </p>
        </div>
        {unread > 0 && (
          <Button variant="secondary" onClick={markAllRead} loading={markingAll}>
            {!markingAll && <CheckCheck size={15} />} Mark all as read
          </Button>
        )}
      </div>

      <div className="flex gap-1 border-b border-[#E7DFF5]">
        {(['all', 'unread'] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => changeFilter(f)}
            className="px-4 py-2 text-sm -mb-px border-b-2 transition-colors"
            style={{
              color: filter === f ? '#6425C4' : '#3D3650',
              borderColor: filter === f ? '#7F40E8' : 'transparent',
              fontWeight: filter === f ? 600 : 400,
            }}
          >
            {f === 'all' ? 'All' : `Unread${unread ? ` (${unread})` : ''}`}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-[#3D3650] text-sm py-20 text-center">Loading notifications…</div>
      ) : failed ? (
        <EmptyState
          icon={TriangleAlert}
          tone="error"
          title="Couldn't load notifications"
          body="Something went wrong while loading your notifications. Please try again."
          action={
            <Button variant="secondary" onClick={() => { setLoading(true); load(); }}>
              <RefreshCw size={15} className="mr-1.5" /> Try again
            </Button>
          }
        />
      ) : items.length === 0 ? (
        <EmptyState
          icon={BellOff}
          title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
          body={
            filter === 'unread'
              ? 'You’re all caught up.'
              : 'Important updates about your account will show up here.'
          }
        />
      ) : (
        <div className="rounded-2xl border border-[#E7DFF5] overflow-hidden" style={{ background: '#FFFFFF' }}>
          <div className="divide-y divide-[#E7DFF5]">
            {items.map((n) => (
              <NotificationItem key={n.id} notification={n} onOpen={openNotification} />
            ))}
          </div>
          <div className="px-5 pb-4">
            <Pagination
              page={page}
              pageCount={pageCount}
              totalItems={total}
              pageSize={pageSize}
              onPageChange={setPage}
            />
          </div>
        </div>
      )}
    </div>
  );
}
