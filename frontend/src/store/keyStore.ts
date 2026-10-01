import { create } from 'zustand';

interface KeyState {
  kemSecretKey: Uint8Array | null;
  dsaSecretKey: Uint8Array | null;
  kemPublicKey: Uint8Array | null;
  unlocked: boolean;
  setKeys: (keys: { kemSecretKey: Uint8Array; dsaSecretKey: Uint8Array; kemPublicKey: Uint8Array }) => void;
  clear: () => void;
}

/**
 * Deliberately in-memory only, same reasoning as authStore's accessToken:
 * these are the actual plaintext PQC secret keys for the session, and
 * persisting them anywhere in browser storage would defeat the purpose of
 * encrypting them at rest in secretKeyStore.ts. A page refresh clears this
 * and requires unlockIdentityKeys(password) to run again.
 *
 * kemPublicKey is not sensitive (it's already known to the server and
 * anyone we share with) but is kept here too since the UI needs it
 * alongside the secret keys — e.g. to wrap a fresh room key for ourselves
 * when creating a collaboration room.
 */
export const useKeyStore = create<KeyState>((set) => ({
  kemSecretKey: null,
  dsaSecretKey: null,
  kemPublicKey: null,
  unlocked: false,
  setKeys: ({ kemSecretKey, dsaSecretKey, kemPublicKey }) =>
    set({ kemSecretKey, dsaSecretKey, kemPublicKey, unlocked: true }),
  clear: () => set({ kemSecretKey: null, dsaSecretKey: null, kemPublicKey: null, unlocked: false }),
}));
