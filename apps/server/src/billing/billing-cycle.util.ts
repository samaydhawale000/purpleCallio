export function addAnchoredMonth(from: Date, anchorDay: number): Date {
  const next = new Date(from.getFullYear(), from.getMonth() + 1, 1);
  const daysInMonth = new Date(
    next.getFullYear(),
    next.getMonth() + 1,
    0,
  ).getDate();
  next.setDate(Math.min(anchorDay, daysInMonth));
  return next;
}
