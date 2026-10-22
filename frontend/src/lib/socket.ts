import { useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { useAuthStore } from '../store/authStore';

const apiOrigin = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '');
const enableSocket = import.meta.env.VITE_ENABLE_SOCKET !== 'false';

/**
 * One shared socket per session.
 * On Vercel we disable it via VITE_ENABLE_SOCKET=false to avoid 404 polling spam.
 * File upload / file list will still work via REST API.
 */
let sharedSocket: Socket | null = null;

export function useSocket(): Socket | null {
  const accessToken = useAuthStore((s) => s.accessToken);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    if (!enableSocket) return undefined;
    if (!accessToken) return undefined;

    // Dynamic import so build doesn't break when disabled
    const init = async () => {
      if (!sharedSocket) {
        const { io } = await import('socket.io-client');
        sharedSocket = io(apiOrigin || undefined, {
          path: '/socket.io',
          auth: { token: accessToken },
          withCredentials: true,
          autoConnect: true,
          transports: ['polling', 'websocket'],
        });
      }
      socketRef.current = sharedSocket;
    };
    init();

    return () => {
      // keep connection alive for notifications
    };
  }, [accessToken]);

  if (!enableSocket) return null;
  return socketRef.current;
}

export function disconnectSocket(): void {
  sharedSocket?.disconnect();
  sharedSocket = null;
}
