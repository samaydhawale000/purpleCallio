'use client';

import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { useAuthStore } from '../store/auth.store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3005';
const SOCKET_URL = API_URL.replace(/\/api\/?$/, '');

let socket: Socket | null = null;

/**
 * Lazily-created dashboard push socket (`/realtime` namespace). Its own
 * connection (multiplex: false) so it never interferes with a call's
 * signaling socket. The auth callback runs on every (re)connect, so a token
 * refreshed by the API client is picked up automatically.
 */
function getSocket(): Socket {
  if (!socket) {
    socket = io(`${SOCKET_URL}/realtime`, {
      autoConnect: false,
      multiplex: false,
      transports: ['websocket'],
      auth: (cb) => cb({ token: useAuthStore.getState().token }),
    });
    // The server drops sockets with a missing/expired token; retry once the
    // API client has had a chance to refresh it.
    socket.on('disconnect', (reason) => {
      if (reason === 'io server disconnect') {
        setTimeout(() => {
          if (useAuthStore.getState().token) socket?.connect();
        }, 5_000);
      }
    });
  }
  return socket;
}

/** Subscribe to a server push event while the component is mounted. */
export function useRealtimeEvent<T = Record<string, unknown>>(
  event: string,
  handler: (payload: T) => void,
) {
  const token = useAuthStore((s) => s.token);
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!token) {
      socket?.disconnect();
      return;
    }
    const s = getSocket();
    const listener = (payload: T) => handlerRef.current(payload);
    s.on(event, listener);
    if (!s.connected) s.connect();
    return () => {
      s.off(event, listener);
    };
  }, [event, token]);
}
