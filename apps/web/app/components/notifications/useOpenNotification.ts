'use client';

import { useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../../lib/api';
import {
  notificationHref,
  notifyNotificationsChanged,
  type AppNotification,
  type NotificationArea,
} from '../../lib/notifications';

/** Mark as read (if unread), then go to the related page if there is one. */
export function useOpenNotification(area: NotificationArea, onRead?: (id: string) => void) {
  const router = useRouter();
  return useCallback(
    async (n: AppNotification) => {
      if (!n.read) {
        onRead?.(n.id);
        try {
          await api.patch(`/notifications/${n.id}/read`);
        } catch {
          // non-fatal — navigation still happens
        }
        notifyNotificationsChanged();
      }
      const href = notificationHref(n, area);
      if (href) router.push(href);
    },
    [area, onRead, router],
  );
}
