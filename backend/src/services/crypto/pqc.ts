/**
 * POST-QUANTUM CRYPTOGRAPHY MODULE
 * =================================
 * Uses @noble/post-quantum — a pure TypeScript, audited implementation of:
 *   - ML-KEM-768 (FIPS 203, formerly CRYSTALS-Kyber)  -> key encapsulation
 *   - ML-DSA-65  (FIPS 204, formerly CRYSTALS-Dilithium) -> digital signatures
 *
 * These are the actual NIST-standardized algorithms, not RSA/ECDSA relabeled.
 * No native/WASM bridge is required because this implementation is pure JS,
 * which also means it runs identically in the browser (client-side) and on
 * the server for signature verification.
 *
 * WHY ML-KEM-768 / ML-DSA-65 specifically: these are the "level 3" / 192-bit
 * classical security parameter sets — NIST's recommended default tier,
 * balancing security margin against key/ciphertext size. They can be swapped
 * for the 512 or 1024 variants by changing the imported parameter set below.
 */

import { ml_kem768 } from '@noble/post-quantum/ml-kem.js';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { randomBytes } from '@noble/hashes/utils.js';

// ---------- ML-KEM (key encapsulation) ----------

export interface KemKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateKemKeyPair(): KemKeyPair {
  const seed = randomBytes(64);
  const keys = ml_kem768.keygen(seed);
  return { publicKey: keys.publicKey, secretKey: keys.secretKey };
}

export interface Encapsulation {
  /** Shared secret to derive the AES-256-GCM file/wrapping key from. */
  sharedSecret: Uint8Array;
  /** Ciphertext to send to the key-pair owner so they can decapsulate. */
  cipherText: Uint8Array;
}

/** Encapsulate a fresh shared secret against the recipient's ML-KEM public key. */
export function encapsulate(recipientPublicKey: Uint8Array): Encapsulation {
  const { cipherText, sharedSecret } = ml_kem768.encapsulate(recipientPublicKey);
  return { cipherText, sharedSecret };
}

/** Recover the shared secret using the recipient's ML-KEM secret key. */
export function decapsulate(cipherText: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_kem768.decapsulate(cipherText, secretKey);
}

// ---------- ML-DSA (quantum-safe digital signatures) ----------

export interface DsaKeyPair {
  publicKey: Uint8Array;
  secretKey: Uint8Array;
}

export function generateSigningKeyPair(): DsaKeyPair {
  const seed = randomBytes(32);
  const keys = ml_dsa65.keygen(seed);
  return { publicKey: keys.publicKey, secretKey: keys.secretKey };
}

/** Sign a message digest (e.g. SHA-256 of a document) with ML-DSA-65. */
export function signMessage(message: Uint8Array, secretKey: Uint8Array): Uint8Array {
  return ml_dsa65.sign(message, secretKey);
}

export function verifySignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  try {
    return ml_dsa65.verify(signature, message, publicKey);
  } catch {
    // Any malformed input must fail closed, never throw past a security check.
    return false;
  }
}
