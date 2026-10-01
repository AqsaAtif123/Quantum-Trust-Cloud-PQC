/**
 * CLIENT-SIDE SECRET KEY STORAGE
 * ================================
 * The user's ML-KEM and ML-DSA SECRET keys must persist across page
 * reloads (otherwise every file/room encrypted before a refresh becomes
 * unreadable), but must never sit in plaintext in browser storage or be
 * sent to the server. This module encrypts them at rest in IndexedDB
 * under a key derived from the user's password via PBKDF2-SHA256 (native
 * WebCrypto, real and audited — not a hand-rolled KDF), and only holds
 * the decrypted keys in memory for the current session.
 *
 * THREAT MODEL NOTE: this protects against someone reading IndexedDB
 * directly (e.g. a stolen disk image, a different local user account, or
 * browser devtools inspection by a passerby) — it does NOT protect
 * against an active XSS attack while the user is logged in and unlocked,
 * since a malicious script running in-page could read the in-memory keys
 * the same way legitimate app code does. That risk is inherent to any
 * client-side-encryption design, not specific to this implementation, and
 * is mitigated separately by CSP headers and dependency hygiene, not by
 * key storage design.
 *
 * This intentionally does NOT implement the fuller three-part
 * (Shamir 2-of-3) recovery flow yet — that requires a server-side
 * "recovery share" endpoint and account-recovery UX beyond this module's
 * scope. What's here is real, working, single-factor (password) key
 * protection; the three-part scheme should wrap this rather than replace
 * it, adding Share B (server) / Share C (offline) as additional unlock
 * paths alongside the password path implemented here.
 */

const DB_NAME = 'quantumtrust-keystore';
const DB_VERSION = 1;
const STORE_NAME = 'identity_keys';
const PBKDF2_ITERATIONS = 310_000; // OWASP-recommended minimum for PBKDF2-SHA256 as of 2023+

export interface StoredIdentityRecord {
  userId: string;
  salt: string; // base64
  iv: string; // base64
  ciphertext: string; // base64 — AES-256-GCM encrypted JSON of {kemSecretKey, dsaSecretKey} (both base64 inside)
}

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'userId' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function deriveKeyFromPassword(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const baseKey = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, [
    'deriveKey',
  ]);
  return window.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export interface PqcSecretKeys {
  kemSecretKey: Uint8Array;
  dsaSecretKey: Uint8Array;
}

/** Called once at registration, after generatePqcIdentity(). */
export async function persistIdentityKeys(
  userId: string,
  password: string,
  keys: PqcSecretKeys,
): Promise<void> {
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrappingKey = await deriveKeyFromPassword(password, salt);

  const payload = JSON.stringify({
    kemSecretKey: bufToBase64(keys.kemSecretKey),
    dsaSecretKey: bufToBase64(keys.dsaSecretKey),
  });
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    wrappingKey,
    new TextEncoder().encode(payload),
  );

  const record: StoredIdentityRecord = {
    userId,
    salt: bufToBase64(salt),
    iv: bufToBase64(iv),
    ciphertext: bufToBase64(ciphertext),
  };

  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/**
 * Called at login: decrypts the stored keys using the just-entered
 * password. Returns null if no local record exists (e.g. first login on
 * a new device — in a fuller implementation, this is exactly where
 * three-part-recovery Share B/C would kick in as an alternate unlock
 * path instead of failing).
 */
export async function unlockIdentityKeys(userId: string, password: string): Promise<PqcSecretKeys | null> {
  const db = await openDb();
  const record = await new Promise<StoredIdentityRecord | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(userId);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  if (!record) return null;

  const salt = base64ToBytes(record.salt);
  const iv = base64ToBytes(record.iv);
  const wrappingKey = await deriveKeyFromPassword(password, salt);

  try {
    const plaintextBuf = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      wrappingKey,
      base64ToBytes(record.ciphertext) as BufferSource,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plaintextBuf));
    return {
      kemSecretKey: base64ToBytes(parsed.kemSecretKey),
      dsaSecretKey: base64ToBytes(parsed.dsaSecretKey),
    };
  } catch {
    // Wrong password (AES-GCM auth tag fails) or corrupted record — fail
    // closed with no information about which.
    return null;
  }
}

export async function hasLocalIdentityKeys(userId: string): Promise<boolean> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).get(userId);
    req.onsuccess = () => resolve(!!req.result);
    req.onerror = () => reject(req.error);
  });
}
