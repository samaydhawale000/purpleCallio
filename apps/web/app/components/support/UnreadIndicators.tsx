/** Leading dot in a ticket row: filled when there's an unseen message. */
export function UnreadDot({ unread }: { unread?: boolean }) {
  return (
    <span
      className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
      style={
        unread
          ? { background: '#7F40E8', boxShadow: '0 0 0 3px rgba(127,64,232,0.15)' }
          : { background: 'transparent' }
      }
      aria-label={unread ? 'Unread' : undefined}
    />
  );
}

export function NewMessageTag({ label }: { label: string }) {
  return (
    <span
      className="shrink-0 px-1.5 py-0.5 rounded-md text-[10px] font-semibold uppercase tracking-wide text-white"
      style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
    >
      {label}
    </span>
  );
}
