import { create } from 'zustand';

interface AuthState {
  userId: string | null;
  accessToken: string | null;
  mfaEnabled: boolean;
  setSession: (params: { userId: string; accessToken: string; mfaEnabled: boolean }) => void;
  clear: () => void;
}

/**
 * Deliberately NOT persisted to localStorage/sessionStorage: an access
 * token sitting in web storage is readable by any injected script (XSS).
 * The backend also sets an httpOnly cookie (qt_access) as the durable
 * credential; this in-memory copy is only used for the Authorization
 * header on same-tab API calls. A page refresh relies on the httpOnly
 * cookie + a silent refresh flow, not on this store.
 */
export const useAuthStore = create<AuthState>((set) => ({
  userId: null,
  accessToken: null,
  mfaEnabled: false,
  setSession: ({ userId, accessToken, mfaEnabled }) => set({ userId, accessToken, mfaEnabled }),
  clear: () => set({ userId: null, accessToken: null, mfaEnabled: false }),
}));
