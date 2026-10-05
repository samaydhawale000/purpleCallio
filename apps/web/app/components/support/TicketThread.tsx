'use client';

import { FormEvent, KeyboardEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { Headset, SendHorizontal } from 'lucide-react';
import { Button } from '../ui/Button';
import { MESSAGE_MAX_LENGTH, type SupportMessage } from '../../lib/support';

interface Props {
  messages: SupportMessage[];
  /** Whose point of view the thread is rendered from — their messages sit on the right. */
  viewer: 'CUSTOMER' | 'ADMIN';
  customerLabel: string;
  placeholder: string;
  submitLabel: string;
  onReply: (message: string) => Promise<boolean>;
  /** Ticket summary rendered as the chat panel's header. */
  header?: ReactNode;
}

function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return 'Today';
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function TicketThread({
  messages,
  viewer,
  customerLabel,
  placeholder,
  submitLabel,
  onReply,
  header,
}: Props) {
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keep the newest message in view, like a messaging app.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function send() {
    if (sending) return;
    if (!draft.trim()) {
      setError('Message is required.');
      return;
    }
    setError('');
    setSending(true);
    try {
      if (await onReply(draft.trim())) setDraft('');
    } finally {
      setSending(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    send();
  }

  // Enter sends; Shift+Enter inserts a newline.
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  }

  const customerInitial = (customerLabel || 'U')[0].toUpperCase();

  return (
    <div
      className="flex flex-col w-full rounded-2xl border border-[#E7DFF5] overflow-hidden h-[calc(100dvh-11rem)] min-h-[520px]"
      style={{ background: '#FFFFFF' }}
    >
      {header && <div className="shrink-0 border-b border-[#E7DFF5] px-5 py-4">{header}</div>}

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 flex flex-col gap-4"
        style={{ background: '#FBF8FE' }}
      >
        {messages.map((m, i) => {
          const isAdmin = m.senderType === 'ADMIN';
          const mine = m.senderType === viewer;
          const created = new Date(m.createdAt);
          const prev = messages[i - 1];
          const newDay = !prev || new Date(prev.createdAt).toDateString() !== created.toDateString();
          const name = isAdmin
            ? viewer === 'ADMIN' && m.senderName
              ? m.senderName
              : 'PurpleCallio Support'
            : customerLabel;

          return (
            <div key={m.id} className="flex flex-col gap-4">
              {newDay && (
                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-[#E7DFF5]" />
                  <span className="text-[11px] font-mono uppercase tracking-widest text-[#3D3650]">
                    {dayLabel(created)}
                  </span>
                  <div className="h-px flex-1 bg-[#E7DFF5]" />
                </div>
              )}

              <div className={`flex items-end gap-2.5 ${mine ? 'flex-row-reverse' : ''}`}>
                {isAdmin ? (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: 'rgba(127,64,232,0.12)', border: '1px solid rgba(127,64,232,0.25)' }}
                  >
                    <Headset size={15} style={{ color: '#7F40E8' }} />
                  </div>
                ) : (
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center shrink-0 text-xs font-bold text-white"
                    style={{ background: 'linear-gradient(135deg, #7F40E8, #410686)' }}
                  >
                    {customerInitial}
                  </div>
                )}

                <div className={`flex flex-col min-w-0 max-w-[85%] sm:max-w-[70%] ${mine ? 'items-end' : 'items-start'}`}>
                  <div className={`flex items-baseline gap-2 mb-1 px-1 ${mine ? 'flex-row-reverse' : ''}`}>
                    <span className="text-xs font-semibold text-[#170B2E] truncate">
                      {mine ? 'You' : name}
                    </span>
                    {isAdmin && !mine && (
                      <span className="text-[10px] font-mono uppercase tracking-wider text-[#6425C4]">Support</span>
                    )}
                    <span className="text-[11px] text-[#3D3650] shrink-0">
                      {created.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <div
                    className={`px-4 py-2.5 text-sm whitespace-pre-wrap break-words rounded-2xl ${
                      mine
                        ? 'rounded-br-md text-white'
                        : 'rounded-bl-md text-[#170B2E] border border-[#E7DFF5] bg-white'
                    }`}
                    style={mine ? { background: 'linear-gradient(135deg, #7F40E8 0%, #5B1FB8 100%)' } : undefined}
                  >
                    {m.message}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Composer */}
      <form onSubmit={submit} className="shrink-0 border-t border-[#E7DFF5] px-4 sm:px-5 py-3">
        <div className="flex items-end gap-3">
          <textarea
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              if (error) setError('');
            }}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label={placeholder}
            rows={2}
            maxLength={MESSAGE_MAX_LENGTH}
            className={`flex-1 px-3 py-2.5 rounded-xl text-sm text-[#170B2E] placeholder:text-[#6B6478] bg-white border outline-none transition-all resize-none max-h-40 ${
              error
                ? 'border-red-500/50 focus:border-red-500/70'
                : 'border-[#D6C4EE] focus:border-[#7F40E8]/60 focus:shadow-[0_0_0_3px_rgba(127,64,232,0.1)]'
            }`}
          />
          <Button type="submit" loading={sending} className="shrink-0">
            {!sending && <SendHorizontal size={15} />}
            {submitLabel}
          </Button>
        </div>
        <div className="flex justify-between gap-3 mt-1.5 px-1">
          <p className="text-xs text-red-600">{error}</p>
          <p className="text-[11px] text-[#3D3650] shrink-0">Enter to send · Shift+Enter for a new line</p>
        </div>
      </form>
    </div>
  );
}
