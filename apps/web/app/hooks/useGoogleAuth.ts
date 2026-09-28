'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { useAuthStore, toAuthUser } from '../store/auth.store';

// Declare the Google Identity Services global type.
declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (
            el: HTMLElement,
            options: {
              theme?: string;
              size?: string;
              width?: number;
              text?: string;
              shape?: string;
              logo_alignment?: string;
            },
          ) => void;
        };
      };
    };
  }
}

export function useGoogleAuth() {
  const router = useRouter();
  const { setTokens, setUser } = useAuthStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const clientId =
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || '';

const handleCredential = useCallback(
    async (credential: string) => {
      setLoading(true);
      setError('');
      try {
        const res = await api.post('/auth/google', {
          idToken: credential,
        });
        setTokens(res.data.accessToken, res.data.refreshToken);
        if (res.data.user) {
          setUser(toAuthUser(res.data.user));
        }
        // Incomplete profiles stay on this page — AuthCard swaps the Google
        // button for the profile-completion step. Only an explicit
        // onboardingRequired === false goes straight to the dashboard, so a
        // response without the flag never skips onboarding.
        if (res.data.onboardingRequired === false) {
          router.push('/dashboard');
        }
      } catch {
        setError('Google sign-in failed. Please try again.');
      } finally {
        setLoading(false);
      }
    },
    [router, setTokens, setUser],
  );

  // True once the Google Identity Services script has loaded.
  const [gsiReady, setGsiReady] = useState(false);

  // Load the Google Identity Services script once.
  useEffect(() => {
    if (!clientId) return;

    // Already loaded globally.
    if (window.google?.accounts) {
      setGsiReady(true);
      return;
    }

    const existing = document.getElementById('google-gsi-script') as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => setGsiReady(true));
      return;
    }

    const script = document.createElement('script');
    script.id = 'google-gsi-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => setGsiReady(true);
    document.head.appendChild(script);
  }, [clientId]);

  // Initialize + render the Google button into the given element.
  const renderButton = useCallback(
    (el: HTMLElement | null) => {
      if (!el || !clientId || !window.google?.accounts) {
        return;
      }
      window.google.accounts.id.initialize({
        client_id: clientId,
        callback: (response) => {
          if (response.credential) {
            handleCredential(response.credential);
          }
        },
      });
      window.google.accounts.id.renderButton(el, {
        theme: 'outline',
        size: 'large',
        width: 280,
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'left',
      });
    },
    [clientId, handleCredential],
  );

  return { renderButton, loading, error, clientId, gsiReady };
}
