import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  title: string;
  body: string;
  tone?: 'default' | 'error';
  action?: ReactNode;
}

/** Centered card for a page's empty, no-match and error states. */
export function EmptyState({ icon: Icon, title, body, tone = 'default', action }: Props) {
  const error = tone === 'error';
  return (
    <div
      className="rounded-2xl border border-[#E7DFF5] py-16 px-6 text-center"
      style={{ background: '#FFFFFF' }}
    >
      <div
        className="inline-flex items-center justify-center w-14 h-14 rounded-xl mb-4"
        style={
          error
            ? { background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }
            : { background: 'rgba(65,6,134,0.1)', border: '1px solid rgba(65,6,134,0.2)' }
        }
      >
        <Icon size={24} style={{ color: error ? '#DC2626' : '#A05DF9' }} />
      </div>
      <p className="text-base font-semibold text-[#170B2E] mb-1">{title}</p>
      <p className="text-sm text-[#3D3650] max-w-sm mx-auto">{body}</p>
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}
