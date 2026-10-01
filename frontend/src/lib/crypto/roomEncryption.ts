/**
 * E2EE COLLABORATION CHAT — CLIENT-SIDE ROOM ENCRYPTION
 * =======================================================
 * Every room has a single symmetric AES-256-GCM "room key" that encrypts
 * message content. The server NEVER sees this key in plaintext — only an
 * ML-KEM-wrapped copy per member (see wrapFileKey/unwrapFileKey in
 * pqcClient.ts, which this reuses directly since the envelope-encryption
 * pattern is identical for a room key as for a file key).
 *
 * Forward secrecy on membership change: when a member is removed, the
 * server bumps the room's key epoch (see backend rooms.controller.ts
 * removeMember). An existing member must then generate a brand-new room
 * key and re-wrap it for every remaining member (rekeyRoom below) — the
 * removed member never receives the new key and cannot decrypt anything
 * sent afterward, and the old epoch's key is discarded everywhere.
 */
import { wrapFileKey, unwrapFileKey, serializeWrappedKey, deserializeWrappedKey } from './pqcClient';

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

export function generateRoomKey(): Promise<CryptoKey> {
  return window.crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Called once when creating a room: wrap the fresh room key for the creator's own public key. */
export async function wrapRoomKeyForMember(
  roomKey: CryptoKey,
  recipientKemPublicKey: Uint8Array,
): Promise<string> {
  const raw = await window.crypto.subtle.exportKey('raw', roomKey);
  const wrapped = await wrapFileKey(raw, recipientKemPublicKey);
  return serializeWrappedKey(wrapped);
}

/** Called by a member reading their own membership record to recover the usable room key. */
export async function unwrapRoomKey(wrappedSerialized: string, kemSecretKey: Uint8Array): Promise<CryptoKey> {
  const wrapped = deserializeWrappedKey(wrappedSerialized);
  const raw = await unwrapFileKey(wrapped, kemSecretKey);
  return window.crypto.subtle.importKey('raw', raw, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

/**
 * Rekey flow after a member removal: the caller (an existing admin/owner,
 * already holding the OLD room key) generates a brand new key and wraps
 * it for every remaining member's public key. The removed member's public
 * key is simply not included, so they receive nothing for the new epoch.
 */
export async function rekeyRoom(
  remainingMembers: Array<{ userId: string; kemPublicKey: Uint8Array }>,
): Promise<{ newRoomKey: CryptoKey; memberKeys: Array<{ userId: string; wrappedRoomKey: string }> }> {
  const newRoomKey = await generateRoomKey();
  const memberKeys = await Promise.all(
    remainingMembers.map(async (member) => ({
      userId: member.userId,
      wrappedRoomKey: await wrapRoomKeyForMember(newRoomKey, member.kemPublicKey),
    })),
  );
  return { newRoomKey, memberKeys };
}

export interface EncryptedChatMessage {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64 (WebCrypto AES-GCM appends the tag to the ciphertext; we split it out for the wire format the backend expects)
}

const AUTH_TAG_LENGTH_BYTES = 16;

export async function encryptChatMessage(plaintext: string, roomKey: CryptoKey): Promise<EncryptedChatMessage> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const combined = await window.crypto.subtle.encrypt({ name: 'AES-GCM', iv }, roomKey, encoded);

  const combinedBytes = new Uint8Array(combined);
  const ciphertextBytes = combinedBytes.subarray(0, combinedBytes.length - AUTH_TAG_LENGTH_BYTES);
  const authTagBytes = combinedBytes.subarray(combinedBytes.length - AUTH_TAG_LENGTH_BYTES);

  return {
    ciphertext: bufToBase64(ciphertextBytes),
    iv: bufToBase64(iv),
    authTag: bufToBase64(authTagBytes),
  };
}

export async function decryptChatMessage(message: EncryptedChatMessage, roomKey: CryptoKey): Promise<string> {
  const ciphertextBytes = base64ToBuf(message.ciphertext);
  const authTagBytes = base64ToBuf(message.authTag);
  const combined = new Uint8Array(ciphertextBytes.length + authTagBytes.length);
  combined.set(ciphertextBytes, 0);
  combined.set(authTagBytes, ciphertextBytes.length);

  const iv = base64ToBuf(message.iv);
  const plaintextBuf = await window.crypto.subtle.decrypt({ name: 'AES-GCM', iv: iv as BufferSource }, roomKey, combined);
  return new TextDecoder().decode(plaintextBuf);
}
