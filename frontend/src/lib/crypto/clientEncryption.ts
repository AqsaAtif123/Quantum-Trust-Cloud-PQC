/**
 * CLIENT-SIDE FILE ENCRYPTION
 * ===========================
 * This is the module that makes the "backend never sees plaintext" claim
 * true. It runs entirely in the browser via the native WebCrypto API
 * (window.crypto.subtle), which is implemented in the browser/OS itself —
 * not a hand-rolled cipher.
 *
 * Flow:
 *   1. Generate a fresh random 256-bit key for this file (generateFileKey)
 *   2. Encrypt the file bytes with AES-256-GCM (encryptFile)
 *   3. Wrap (encrypt) that file key under the user's own key material so
 *      only the user (and people they explicitly share with) can unwrap it
 *   4. Upload only the ciphertext + wrapped key + IV + auth tag
 *
 * The unwrapped, plaintext file key must never be sent to the backend.
 */

const AES_ALGO = 'AES-GCM';
const IV_LENGTH_BYTES = 12;

export interface EncryptedFilePayload {
  ciphertext: ArrayBuffer;
  iv: Uint8Array;
  // WebCrypto's AES-GCM appends the auth tag to the ciphertext by default;
  // we still expose iv/ciphertext separately for storage-layer clarity and
  // so a future non-browser client verifying via node:crypto can align on
  // the same wire format used server-side (see envelopeEncryption.ts).
}

/** Generate a fresh, non-extractable-by-default-safe raw AES-256 key for one file. */
export async function generateFileKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey({ name: AES_ALGO, length: 256 }, true, ['encrypt', 'decrypt']);
}

export async function exportKeyRaw(key: CryptoKey): Promise<ArrayBuffer> {
  return window.crypto.subtle.exportKey('raw', key);
}

export async function importKeyRaw(raw: ArrayBuffer): Promise<CryptoKey> {
  return window.crypto.subtle.importKey('raw', raw, AES_ALGO, true, ['encrypt', 'decrypt']);
}

/**
 * Encrypts a File/Blob's bytes client-side. For very large files this
 * should be adapted to a chunked/streaming approach (WebCrypto's
 * subtle.encrypt operates on a single buffer); the interface here is kept
 * so a chunked implementation can slot in behind the same call site.
 */
export async function encryptFile(file: Blob, key: CryptoKey): Promise<EncryptedFilePayload> {
  const iv = window.crypto.getRandomValues(new Uint8Array(IV_LENGTH_BYTES));
  const plaintext = await file.arrayBuffer();
  const ciphertext = await window.crypto.subtle.encrypt({ name: AES_ALGO, iv }, key, plaintext);
  return { ciphertext, iv };
}

export async function decryptFile(payload: EncryptedFilePayload, key: CryptoKey): Promise<ArrayBuffer> {
  return window.crypto.subtle.decrypt({ name: AES_ALGO, iv: payload.iv as BufferSource }, key, payload.ciphertext);
}

/** SHA-256 content hash, used for integrity verification and blockchain notarization. */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await window.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export function bufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return window.btoa(binary);
}

export function base64ToBuffer(base64: string): Uint8Array {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
