import crypto from 'crypto';

/**
 * AES-256-GCM authenticated encryption primitives.
 *
 * IMPORTANT TRUST MODEL NOTE:
 * File *contents* are encrypted on the client before upload (see
 * frontend/src/lib/crypto/clientEncryption.ts). The backend never sees
 * plaintext file bytes in the normal upload/download flow.
 *
 * This server-side module is used only for things the server is allowed to
 * touch under the zero-trust model: wrapping/unwrapping key SHARES that are
 * already the output of the Shamir split (see shamirSecretSharing.ts), and
 * encrypting non-file-content metadata at rest where useful. It must never
 * be used to hold a complete, unsplit file key or user master key.
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96-bit IV is the NIST-recommended size for GCM
const AUTH_TAG_LENGTH_BYTES = 16;

export interface EncryptedPayload {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function generateRandomKey(byteLength = 32): Buffer {
  return crypto.randomBytes(byteLength);
}

export function encryptBuffer(plaintext: Buffer, key: Buffer, aad?: Buffer): EncryptedPayload {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return { ciphertext, iv, authTag };
}

export function decryptBuffer(
  payload: EncryptedPayload,
  key: Buffer,
  aad?: Buffer,
): Buffer {
  if (key.length !== 32) {
    throw new Error('AES-256-GCM requires a 32-byte key');
  }
  if (payload.authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('Invalid authentication tag length');
  }

  const decipher = crypto.createDecipheriv(ALGORITHM, key, payload.iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(payload.authTag);

  // Throws if the ciphertext or AAD has been tampered with — this is the
  // "authenticated" part of authenticated encryption, and callers must not
  // swallow this error.
  return Buffer.concat([decipher.update(payload.ciphertext), decipher.final()]);
}

/** Serialize an encrypted payload for storage as base64 (e.g. in MongoDB). */
export function serializeEncryptedPayload(payload: EncryptedPayload): string {
  return Buffer.concat([payload.iv, payload.authTag, payload.ciphertext]).toString('base64');
}

export function deserializeEncryptedPayload(serialized: string): EncryptedPayload {
  const buf = Buffer.from(serialized, 'base64');
  const iv = buf.subarray(0, IV_LENGTH_BYTES);
  const authTag = buf.subarray(IV_LENGTH_BYTES, IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  const ciphertext = buf.subarray(IV_LENGTH_BYTES + AUTH_TAG_LENGTH_BYTES);
  return { iv, authTag, ciphertext };
}

/** Constant-time comparison, used anywhere secrets are compared (tokens, hashes). */
export function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
