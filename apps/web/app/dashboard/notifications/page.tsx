'use client';

import { useRequireAuth } from '../../hooks/useRequireAuth';
import { NotificationsPanel } from '../../components/notifications/NotificationsPanel';

export default function NotificationsPage() {
  const { isAuthed } = useRequireAuth();
  if (!isAuthed) return null;
  return <NotificationsPanel area="CUSTOMER" />;
}
