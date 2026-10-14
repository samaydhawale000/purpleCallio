/**
 * Minutes as a human duration. Usage is stored in fractional minutes
 * (3.89 = 3 min 53 s), which reads like "almost 4" as a decimal, so it is
 * never shown that way:
 *   0.89 → "53s" · 3.89 → "3m 53s" · 3.1 → "3m 06s" · 125.5 → "2h 05m 30s" · 12,000.2 → "200h 00m"
 * (same style as the call list's durations).
 * Seconds are dropped from 100 hours up, where they are noise.
 */
export function formatMinutes(minutes: number | null | undefined): string {
  const value = Number.isFinite(minutes) ? Math.max(0, Number(minutes)) : 0;
  const totalSeconds = Math.round(value * 60);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  if (h >= 100) return `${h.toLocaleString('en-IN')}h ${pad(m)}m`;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  if (m > 0) return `${m}m ${pad(s)}s`;
  return `${s}s`;
}
