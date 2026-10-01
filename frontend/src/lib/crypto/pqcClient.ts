/**
 * Runs the identical @noble/post-quantum implementation used on the
 * backend (see backend/src/services/crypto/pqc.ts), so a file key wrapped
 * in the browser can be unwrapped correctly wherever it's decapsulated,
 * and a signature produced here verifies the same way everywhere.
 *
 * The user's ML-KEM/ML-DSA SECRET keys are generated and stored here,
 * client-side. Only the corresponding PUBLIC keys are ever sent to the
 * backend (see User model's kemPublicKey/dsaPublicKey fields).
 */
import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';

export interface PqcIdentity {
  kemPublicKey: Uint8Array;
  kemSecretKey: Uint8Array;
  dsaPublicKey: Uint8Array;
  dsaSecretKey: Uint8Array;
}

/** Generated once at registration; secret keys are then protected by the three-part key protection scheme, never sent to the server raw. */
export function generatePqcIdentity(): PqcIdentity {
  const kemSeed = window.crypto.getRandomValues(new Uint8Array(64));
  const dsaSeed = window.crypto.getRandomValues(new Uint8Array(32));
  const kem = ml_kem768.keygen(kemSeed);
  const dsa = ml_dsa65.keygen(dsaSeed);
  return {
    kemPublicKey: kem.publicKey,
    kemSecretKey: kem.secretKey,
    dsaPublicKey: dsa.publicKey,
    dsaSecretKey: dsa.secretKey,
  };
}

/**
 * Wrap a file's raw AES key so only the holder of kemSecretKey can recover
 * it. ML-KEM encapsulation alone only produces a shared secret; it isn't a
 * key-wrapping primitive itself, so we derive an AES-256-GCM key from the
 * shared secret (via SHA-256) and use that to encrypt the file key. This
 * keeps the actual file-key wrapping symmetric and auditable, on top of
 * the quantum-safe key agreement.
 */
export interface WrappedFileKey {
  /** ML-KEM ciphertext the recipient decapsulates to recover the shared secret. */
  kemCipherText: Uint8Array;
  /** The file key, AES-256-GCM encrypted under the shared-secret-derived key. */
  wrappedKey: ArrayBuffer;
  iv: Uint8Array;
}

async function deriveWrappingKey(sharedSecret: Uint8Array): Promise<CryptoKey> {
  const digest = await window.crypto.subtle.digest('SHA-256', sharedSecret as BufferSource);
  return window.crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function wrapFileKey(
  fileKeyRaw: ArrayBuffer,
  recipientKemPublicKey: Uint8Array,
): Promise<WrappedFileKey> {
  const { cipherText: kemCipherText, sharedSecret } = ml_kem768.encapsulate(recipientKemPublicKey);
  const wrappingKey = await deriveWrappingKey(sharedSecret);
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const wrappedKey = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, wrappingKey, fileKeyRaw);
  return { kemCipherText, wrappedKey, iv };
}

export function unwrapFileKey(
  wrapped: WrappedFileKey,
  kemSecretKey: Uint8Array,
): Promise<ArrayBuffer> {
  const sharedSecret = ml_kem768.decapsulate(wrapped.kemCipherText, kemSecretKey);
  return deriveWrappingKey(sharedSecret).then((wrappingKey) =>
    window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: wrapped.iv as BufferSource }, wrappingKey, wrapped.wrappedKey),
  );
}

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return window.btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = window.atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Serializes a WrappedFileKey to a single base64 string for transport/
 * storage (e.g. as the `wrappedFileKey` field sent to the backend). Shared
 * by every feature that wraps a symmetric key for a recipient — files,
 * vault documents, and collaboration room keys — so there's exactly one
 * wire format instead of each feature inventing its own.
 */
export async function serializeWrappedKey(wrapped: WrappedFileKey): Promise<string> {
  const parts = {
    kemCipherText: bufToBase64(wrapped.kemCipherText),
    wrappedKey: bufToBase64(wrapped.wrappedKey),
    iv: bufToBase64(wrapped.iv),
  };
  return window.btoa(JSON.stringify(parts));
}

export function deserializeWrappedKey(serialized: string): WrappedFileKey {
  const parts = JSON.parse(window.atob(serialized));
  const wrappedKeyBytes = base64ToBuf(parts.wrappedKey);
  return {
    kemCipherText: base64ToBuf(parts.kemCipherText),
    wrappedKey: wrappedKeyBytes.slice().buffer,
    iv: base64ToBuf(parts.iv),
  };
}

export function signDocumentHash(hashBytes: Uint8Array, dsaSecretKey: Uint8Array): Uint8Array {
  return ml_dsa65.sign(hashBytes, dsaSecretKey);
}

export function verifyDocumentSignature(
  hashBytes: Uint8Array,
  signature: Uint8Array,
  dsaPublicKey: Uint8Array,
): boolean {
  try {
    return ml_dsa65.verify(signature, hashBytes, dsaPublicKey);
  } catch {
    return false;
  }
}
