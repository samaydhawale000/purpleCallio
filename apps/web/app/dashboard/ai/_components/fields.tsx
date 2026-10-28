'use client';

import {
  ButtonHTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { Loader2 } from 'lucide-react';
import { buttonCls, inputCls, type ButtonVariant } from '../../_ui';

const errCls = 'border-red-300 focus:border-red-400 focus:ring-red-400/15';
const labelCls = 'text-[13px] font-medium text-[#170B2E]';
const helperCls = 'text-xs text-[#6B6478]';

interface FieldProps {
  label: string;
  error?: string;
  helper?: ReactNode;
  id: string;
}

function Messages({ error, helper }: { error?: string; helper?: ReactNode }) {
  return (
    <>
      {error && <p className="text-xs text-red-600">{error}</p>}
      {helper && !error && <div className={helperCls}>{helper}</div>}
    </>
  );
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
      <label htmlFor={id} className={labelCls}>{label}</label>
      <input id={id} {...props} className={`${inputCls} ${error ? errCls : ''} ${className}`} />
      <Messages error={error} helper={helper} />
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
      <label htmlFor={id} className={labelCls}>{label}</label>
      <textarea id={id} {...props} className={`${inputCls} ${error ? errCls : ''} ${className}`} />
      <Messages error={error} helper={helper} />
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
      <label htmlFor={id} className={labelCls}>{label}</label>
      <select id={id} {...props} className={`${inputCls} ${error ? errCls : ''}`}>
        {children}
      </select>
      <Messages error={error} helper={helper} />
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
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 accent-[#6D28D9]"
      />
      <span>
        <span className="text-sm text-[#170B2E]">{label}</span>
        {helper && <span className={`block ${helperCls}`}>{helper}</span>}
      </span>
    </label>
  );
}

/** Kit-styled button with a spinner while `loading`. */
export function ActionButton({
  variant = 'primary',
  loading,
  small,
  className = '',
  children,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  loading?: boolean;
  small?: boolean;
}) {
  return (
    <button
      type={type}
      {...props}
      disabled={loading || props.disabled}
      className={buttonCls(variant, `${small ? 'px-3 py-1.5 text-[13px]' : ''} ${className}`)}
    >
      {loading && <Loader2 size={14} className="animate-spin" />}
      {children}
    </button>
  );
}
