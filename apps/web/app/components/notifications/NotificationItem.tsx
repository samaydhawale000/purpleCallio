'use client';

import { timeAgo, type AppNotification } from '../../lib/notifications';

interface Props {
  notification: AppNotification;
  onOpen: (n: AppNotification) => void;
  compact?: boolean;
}

/** One notification row; the dot marks unread (filled) vs read (hollow). */
export function NotificationItem({ notification: n, onOpen, compact = false }: Props) {
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={`w-full text-left flex gap-3 transition-colors hover:bg-[#7F40E8]/[0.04] ${
        compact ? 'px-4 py-3' : 'px-5 py-4'
      }`}
      style={!n.read ? { background: 'rgba(127,64,232,0.04)' } : undefined}
    >
      <span
        className="mt-1.5 w-2 h-2 rounded-full shrink-0"
        style={
          n.read
            ? { border: '1.5px solid #C4AEE8' }
            : { background: '#7F40E8', boxShadow: '0 0 0 3px rgba(127,64,232,0.15)' }
        }
        aria-label={n.read ? 'Read' : 'Unread'}
      />
      <span className="min-w-0 flex-1">
        <span
          className={`block text-sm text-[#170B2E] ${n.read ? 'font-medium' : 'font-semibold'} ${
            compact ? 'truncate' : ''
          }`}
        >
          {n.title}
        </span>
        <span className={`block text-[#3D3650] mt-0.5 ${compact ? 'text-xs line-clamp-2' : 'text-sm'}`}>
          {n.message}
        </span>
        <span className="block text-[11px] text-[#6B6478] mt-1.5">{timeAgo(n.createdAt)}</span>
      </span>
    </button>
  );
}
