'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  children: ReactNode;
}

const base =
  'inline-flex items-center justify-center gap-2 font-medium transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed select-none cursor-pointer';

const variants = {
  primary: 'text-white',
  secondary:
    'bg-[#F8F4FD] border border-[#D6C4EE] text-[#3D3650] hover:bg-[#F0E9FA] hover:border-[#C4AEE8]',
  ghost: 'text-[#3D3650] hover:text-[#170B2E] hover:bg-[#7F40E8]/5',
  danger:
    'bg-red-500/10 border border-red-500/30 text-red-600 hover:bg-red-500/20 hover:border-red-500/50',
};

const sizes = {
  sm: 'text-xs px-3 py-1.5 rounded-md',
  md: 'text-sm px-4 py-2.5 rounded-lg',
  lg: 'text-sm px-6 py-3 rounded-lg',
};

export function Button({
  variant = 'primary',
  size = 'md',
  loading,
  children,
  className = '',
  style,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      disabled={loading || props.disabled}
      className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}
      style={
        variant === 'primary'
          ? { background: 'linear-gradient(135deg, #7F40E8 0%, #410686 100%)', ...style }
          : style
      }
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      )}
      {children}
    </button>
  );
}
