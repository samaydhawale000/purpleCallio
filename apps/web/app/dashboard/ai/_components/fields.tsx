'use client';

import { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const control =
  'w-full px-3 py-2.5 rounded-lg text-sm text-[#170B2E] placeholder:text-[#6B6478] bg-white border outline-none transition-all';
const okBorder = 'border-[#D6C4EE] focus:border-[#7F40E8]/60 focus:shadow-[0_0_0_3px_rgba(127,64,232,0.1)]';
const errBorder = 'border-red-500/50 focus:border-red-500/70';

interface FieldProps {
  label: string;
  error?: string;
  helper?: ReactNode;
  id: string;
}

export function TextInput({
  label,
  error,
  helper,
  id,
  className = '',
  ...props
}: FieldProps & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[#3D3650]">{label}</label>
      <input id={id} {...props} className={`${control} ${error ? errBorder : okBorder} ${className}`} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {helper && !error && <div className="text-xs text-[#3D3650]">{helper}</div>}
    </div>
  );
}

export function TextArea({
  label,
  error,
  helper,
  id,
  className = '',
  ...props
}: FieldProps & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[#3D3650]">{label}</label>
      <textarea id={id} {...props} className={`${control} ${error ? errBorder : okBorder} ${className}`} />
      {error && <p className="text-xs text-red-600">{error}</p>}
      {helper && !error && <div className="text-xs text-[#3D3650]">{helper}</div>}
    </div>
  );
}

export function Select({
  label,
  error,
  helper,
  id,
  children,
  ...props
}: FieldProps & SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-[#3D3650]">{label}</label>
      <select id={id} {...props} className={`${control} ${error ? errBorder : okBorder}`}>
        {children}
      </select>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {helper && !error && <div className="text-xs text-[#3D3650]">{helper}</div>}
    </div>
  );
}

export function Checkbox({
  label,
  checked,
  onChange,
  helper,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  helper?: string;
}) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[#7F40E8]"
      />
      <span>
        <span className="text-sm text-[#170B2E]">{label}</span>
        {helper && <span className="block text-xs text-[#3D3650]">{helper}</span>}
      </span>
    </label>
  );
}
