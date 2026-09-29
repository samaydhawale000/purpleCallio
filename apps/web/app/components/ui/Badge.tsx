import { ReactNode } from 'react';

type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'purple';

interface BadgeProps {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
}

const styles: Record<BadgeVariant, string> = {
  default: 'bg-[#F8F4FD] text-[#3D3650] border-[#E7DFF5]',
  success:  'bg-emerald-500/10 text-emerald-700 border-emerald-500/20',
  warning:  'bg-amber-500/10  text-amber-700  border-amber-500/20',
  error:    'bg-red-500/10    text-red-700    border-red-500/20',
  info:     'bg-blue-500/10   text-blue-700   border-blue-500/20',
  purple:   'bg-[#7F40E8]/10 text-[#6425C4] border-[#7F40E8]/20',
};

export function Badge({ variant = 'default', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium border ${styles[variant]} ${className}`}
    >
      {children}
    </span>
  );
}
