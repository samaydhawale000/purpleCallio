'use client';

import { useRequireAuth } from '../../hooks/useRequireAuth';
import { NotificationsPanel } from '../../components/notifications/NotificationsPanel';

export default function NotificationsPage() {
  const { isAuthed } = useRequireAuth();
  if (!isAuthed) return null;
  // The panel brings its own title and tabs (shared with /admin).
  return (
    <div className="max-w-4xl">
      <NotificationsPanel area="CUSTOMER" />
    </div>
  );
}
