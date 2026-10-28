import type { Tone } from '../_ui';

export interface CallRow {
  id: string;
  projectId: string;
  callerId: string;
  receiverId: string;
  callerName?: string | null;
  receiverName?: string | null;
  type: 'AUDIO' | 'VIDEO';
  status: string;
  startedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  project?: { id: string; name: string };
  events?: { id: string; event: string; createdAt: string; participantId?: string | null }[];
}

// ACCEPTED means the call was answered and has not ended yet — it is live,
// not "completed". A call stays ACCEPTED until someone ends it.
const STATUS: Record<string, { label: string; tone: Tone }> = {
  INITIATED: { label: 'Initiated', tone: 'neutral' },
  RINGING: { label: 'Ringing', tone: 'warning' },
  ACCEPTED: { label: 'In progress', tone: 'accent' },
  ENDED: { label: 'Ended', tone: 'success' },
  MISSED: { label: 'Missed', tone: 'danger' },
  REJECTED: { label: 'Declined', tone: 'danger' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
  BUSY: { label: 'Busy', tone: 'neutral' },
};

export const callStatus = (status: string) => STATUS[status] ?? { label: status, tone: 'neutral' as Tone };

export const callTypeLabel = (type: string) => (type === 'VIDEO' ? 'Video' : 'Audio');

/** Talk time of an ended call. A call still in progress shows "Live". */
export function callDuration(call: Pick<CallRow, 'startedAt' | 'endedAt' | 'status'>): string {
  if (!call.startedAt) return '—';
  if (!call.endedAt) return call.status === 'ACCEPTED' ? 'Live' : '—';
  const secs = Math.max(0, Math.floor((new Date(call.endedAt).getTime() - new Date(call.startedAt).getTime()) / 1000));
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}

export const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'ALL', label: 'All' },
  { value: 'ACCEPTED', label: 'In progress' },
  { value: 'ENDED', label: 'Ended' },
  { value: 'MISSED', label: 'Missed' },
  { value: 'REJECTED', label: 'Declined' },
  { value: 'RINGING', label: 'Ringing' },
];
