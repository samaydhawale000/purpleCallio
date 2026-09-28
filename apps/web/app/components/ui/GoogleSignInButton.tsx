'use client';

import { useEffect, useRef } from 'react';
import { useGoogleAuth } from '../../hooks/useGoogleAuth';

export function GoogleSignInButton() {
  const ref = useRef<HTMLDivElement | null>(null);
  const { renderButton, loading, error, clientId, gsiReady } = useGoogleAuth();

  useEffect(() => {
    if (clientId && gsiReady && ref.current) {
      renderButton(ref.current);
    }
  }, [clientId, gsiReady, renderButton]);

  return (
    <div className="flex flex-col items-center gap-3">
      <div ref={ref} className="flex justify-center min-h-[40px]" />
      {loading && (
        <p className="text-sm text-[#3D3650]">Signing you in…</p>
      )}
      {error && (
        <div
          className="text-sm text-red-600 px-4 py-3 rounded-lg border border-red-300 w-full"
          style={{ background: 'rgba(239,68,68,0.06)' }}
        >
          {error}
        </div>
      )}
      {!clientId && (
        <p className="text-xs text-[#3D3650] text-center">
          Google sign-in is not configured. Add{' '}
          <code className="text-[#7F40E8]">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> to continue.
        </p>
      )}
    </div>
  );
}
