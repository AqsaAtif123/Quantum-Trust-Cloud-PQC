import {
  generateKemKeyPair,
  encapsulate,
  decapsulate,
  generateSigningKeyPair,
  signMessage,
  verifySignature,
} from '../pqc';

describe('ML-KEM-768 key encapsulation', () => {
  it('produces matching shared secrets between encapsulation and decapsulation', () => {
    const { publicKey, secretKey } = generateKemKeyPair();
    const { sharedSecret, cipherText } = encapsulate(publicKey);
    const recovered = decapsulate(cipherText, secretKey);
    expect(Buffer.from(recovered).equals(Buffer.from(sharedSecret))).toBe(true);
  });

  it('produces a different shared secret on each encapsulation (fresh randomness)', () => {
    const { publicKey } = generateKemKeyPair();
    const first = encapsulate(publicKey);
    const second = encapsulate(publicKey);
    expect(Buffer.from(first.sharedSecret).equals(Buffer.from(second.sharedSecret))).toBe(false);
  });

  it('produces a different shared secret when decapsulated with the wrong secret key', () => {
    const alice = generateKemKeyPair();
    const bob = generateKemKeyPair();
    const { sharedSecret, cipherText } = encapsulate(alice.publicKey);
    const wrongRecovered = decapsulate(cipherText, bob.secretKey);
    expect(Buffer.from(wrongRecovered).equals(Buffer.from(sharedSecret))).toBe(false);
  });
});

describe('ML-DSA-65 digital signatures', () => {
  it('verifies a signature produced with the matching secret key', () => {
    const { publicKey, secretKey } = generateSigningKeyPair();
    const message = Buffer.from('QuantumTrust integrity check');
    const signature = signMessage(message, secretKey);
    expect(verifySignature(message, signature, publicKey)).toBe(true);
  });

  it('rejects a signature against a tampered message', () => {
    const { publicKey, secretKey } = generateSigningKeyPair();
    const signature = signMessage(Buffer.from('original message'), secretKey);
    expect(verifySignature(Buffer.from('tampered message'), signature, publicKey)).toBe(false);
  });

  it('rejects a signature verified against the wrong public key', () => {
    const signer = generateSigningKeyPair();
    const impostor = generateSigningKeyPair();
    const message = Buffer.from('some document');
    const signature = signMessage(message, signer.secretKey);
    expect(verifySignature(message, signature, impostor.publicKey)).toBe(false);
  });

  it('fails closed (returns false, does not throw) on a malformed signature', () => {
    const { publicKey } = generateSigningKeyPair();
    const garbageSignature = new Uint8Array([1, 2, 3]);
    expect(() => verifySignature(Buffer.from('message'), garbageSignature, publicKey)).not.toThrow();
    expect(verifySignature(Buffer.from('message'), garbageSignature, publicKey)).toBe(false);
  });
});
