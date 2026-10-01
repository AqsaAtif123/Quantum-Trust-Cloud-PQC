import { useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const apiOrigin = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');

/**
 * One shared socket per session, authenticated the same way as REST calls
 * (the in-memory access token — see authStore.ts for why it's not
 * persisted to storage). The server verifies this token identically to
 * HTTP requests (see backend server.ts's io.use handshake middleware).
 */
let sharedSocket: Socket | null = null;

export function useSocket(): Socket | null {
  const accessToken = useAuthStore((s) => s.accessToken);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!accessToken) return undefined;

    if (!sharedSocket) {
      sharedSocket = io(apiOrigin || undefined, {
        path: '/socket.io',
        auth: { token: accessToken },
        withCredentials: true,
      });
    }
    socketRef.current = sharedSocket;

    return () => {
      // Deliberately not disconnecting on unmount: other components (e.g.
      // notifications) may still need the shared connection. Disconnection
      // happens on logout instead (see authStore.clear callers).
    };
  }, [accessToken]);

  return socketRef.current;
}

export function disconnectSocket(): void {
  sharedSocket?.disconnect();
  sharedSocket = null;
}
