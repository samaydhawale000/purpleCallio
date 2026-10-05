import { Badge } from '../ui/Badge';
import type { TicketStatus } from '../../lib/support';

const VARIANTS = {
  OPEN: 'info',
  PENDING: 'warning',
  RESOLVED: 'success',
} as const;

const LABELS: Record<TicketStatus, string> = {
  OPEN: 'Open',
  PENDING: 'Pending',
  RESOLVED: 'Resolved',
};

export function TicketStatusBadge({ status }: { status: TicketStatus }) {
  return <Badge variant={VARIANTS[status]}>{LABELS[status]}</Badge>;
}

export function ticketStatusLabel(status: TicketStatus) {
  return LABELS[status];
}
