'use client';

import { NotificationsPanel } from '../../components/notifications/NotificationsPanel';

export default function AdminNotificationsPage() {
  // The panel brings its own title and tabs (shared with /dashboard).
  return (
    <div className="max-w-4xl">
      <NotificationsPanel area="ADMIN" />
    </div>
  );
}
