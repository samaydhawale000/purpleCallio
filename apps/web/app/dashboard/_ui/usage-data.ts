import { api } from '../../lib/api';

/** One UTC day from GET /dashboard/usage/daily. */
export interface DailyUsage {
  date: string;
  callCredits: number;
  translateCredits: number;
  aiCredits: number;
  reportCredits: number;
  totalCredits: number;
  callMinutes: number;
  translateMinutes: number;
  aiMinutes: number;
}

export const getDailyUsage = (days: number, projectId?: string) =>
  api
    .get<DailyUsage[]>('/dashboard/usage/daily', { params: { days, ...(projectId ? { projectId } : {}) } })
    .then((r) => r.data ?? []);

export const sumBy = <T,>(rows: T[], pick: (r: T) => number) => rows.reduce((n, r) => n + (pick(r) || 0), 0);

export const RANGE_OPTIONS = [
  { value: 7, label: '7d' },
  { value: 30, label: '30d' },
  { value: 90, label: '90d' },
];

/** YYYY-MM-DD for N-1 days ago (UTC), the start of a "last N days" window. */
export function rangeStart(days: number) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d.toISOString().slice(0, 10);
}
