'use client';

import { useEffect } from 'react';
import { AnimatePresence, m } from 'framer-motion';
import { CheckCircle2, XCircle } from 'lucide-react';

export interface ToastState {
  id: number;
  type: 'success' | 'error';
  message: string;
}

interface Props {
  toast: ToastState | null;
  onDismiss: () => void;
}

export function ToastHost({ toast, onDismiss }: Props) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onDismiss, 4000);
    return () => clearTimeout(timer);
  }, [toast, onDismiss]);

  return (
    <div className="fixed top-4 right-4 z-50 pointer-events-none">
      <AnimatePresence>
        {toast && (
          <m.div
            key={toast.id}
            initial={{ opacity: 0, y: -12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.96 }}
            transition={{ duration: 0.18 }}
            className="pointer-events-auto flex items-center gap-2.5 rounded-xl border px-4 py-3 shadow-2xl"
            style={{
              background: toast.type === 'success' ? '#ECFDF5' : '#FEF2F2',
              borderColor: toast.type === 'success' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)',
            }}
          >
            {toast.type === 'success' ? (
              <CheckCircle2 size={16} style={{ color: '#059669' }} />
            ) : (
              <XCircle size={16} style={{ color: '#DC2626' }} />
            )}
            <p className="text-sm font-medium text-[#170B2E]">{toast.message}</p>
          </m.div>
        )}
      </AnimatePresence>
    </div>
  );
}
