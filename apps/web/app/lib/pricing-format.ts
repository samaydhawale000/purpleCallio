/** Pure pricing formatters, safe in server and client components. */

/** "12 months after purchase" for the default 365-day validity, otherwise "N days after purchase". */
export function validityPhrase(days: number | null | undefined): string {
  if (!days || days === 365 || days === 366) return '12 months after purchase';
  return `${days.toLocaleString('en-IN')} days after purchase`;
}

export const formatRate = (n: number) => (n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
