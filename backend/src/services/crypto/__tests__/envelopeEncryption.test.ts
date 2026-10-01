import crypto from 'crypto';
import {
  generateRandomKey,
  encryptBuffer,
  decryptBuffer,
  serializeEncryptedPayload,
  deserializeEncryptedPayload,
  timingSafeEqual,
} from '../envelopeEncryption';

describe('envelopeEncryption (AES-256-GCM)', () => {
  it('round-trips plaintext through encrypt/decrypt', () => {
    const key = generateRandomKey();
    const plaintext = Buffer.from('This is sensitive file content');
    const payload = encryptBuffer(plaintext, key);
    const decrypted = decryptBuffer(payload, key);
    expect(decrypted.equals(plaintext)).toBe(true);
  });

  it('rejects decryption with the wrong key', () => {
    const key = generateRandomKey();
    const wrongKey = generateRandomKey();
    const payload = encryptBuffer(Buffer.from('secret'), key);
    expect(() => decryptBuffer(payload, wrongKey)).toThrow();
  });

  it('rejects a tampered auth tag (authenticated encryption)', () => {
    const key = generateRandomKey();
    const payload = encryptBuffer(Buffer.from('secret'), key);
    payload.authTag[0] ^= 0xff;
    expect(() => decryptBuffer(payload, key)).toThrow();
  });

  it('rejects a tampered ciphertext', () => {
    const key = generateRandomKey();
    const payload = encryptBuffer(Buffer.from('secret'), key);
    payload.ciphertext[0] ^= 0xff;
    expect(() => decryptBuffer(payload, key)).toThrow();
  });

  it('rejects a key of the wrong length', () => {
    const shortKey = crypto.randomBytes(16); // AES-128 length, not AES-256
    expect(() => encryptBuffer(Buffer.from('x'), shortKey)).toThrow();
  });

  it('serialize/deserialize round-trips correctly', () => {
    const key = generateRandomKey();
    const payload = encryptBuffer(Buffer.from('round trip me'), key);
    const serialized = serializeEncryptedPayload(payload);
    const restored = deserializeEncryptedPayload(serialized);
    const decrypted = decryptBuffer(restored, key);
    expect(decrypted.toString()).toBe('round trip me');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    const key = generateRandomKey();
    const plaintext = Buffer.from('same input');
    const a = encryptBuffer(plaintext, key);
    const b = encryptBuffer(plaintext, key);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.iv.equals(b.iv)).toBe(false);
  });

  describe('timingSafeEqual', () => {
    it('returns true for identical buffers', () => {
      const a = Buffer.from('identical');
      const b = Buffer.from('identical');
      expect(timingSafeEqual(a, b)).toBe(true);
    });

    it('returns false for different buffers of the same length', () => {
      expect(timingSafeEqual(Buffer.from('aaaaaaaaa'), Buffer.from('bbbbbbbbb'))).toBe(false);
    });

    it('returns false for buffers of different lengths', () => {
      expect(timingSafeEqual(Buffer.from('short'), Buffer.from('much longer input'))).toBe(false);
    });
  });
});
