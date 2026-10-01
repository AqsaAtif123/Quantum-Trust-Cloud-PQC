import sss from 'shamirs-secret-sharing';

/**
 * THREE-PART KEY PROTECTION
 * =========================
 * This implements a genuine (2-of-3) Shamir's Secret Sharing threshold
 * scheme over GF(256), via the audited `shamirs-secret-sharing` library
 * (a Node binding around a standard SSS implementation). It is NOT key
 * duplication — no single share, and no two shares chosen the wrong way,
 * reveal any information about the secret; only a quorum of `threshold`
 * shares can reconstruct it (information-theoretic security below threshold).
 *
 * Share custody model:
 *   Share A -> stored encrypted, tied to the user's password-derived key
 *              (never leaves client in plaintext form)
 *   Share B -> held by QuantumTrust server (encrypted at rest), released
 *              only after zero-trust authorization checks pass
 *   Share C -> user-controlled recovery share (downloaded once at
 *              enrollment, e.g. printed / stored offline by the user)
 *
 * Threshold = 2: any two of the three shares reconstruct the key. This
 * means the server alone (holding only Share B) can NEVER reconstruct a
 * user's master key — satisfying "the server must not independently
 * possess enough information to reconstruct sensitive keys."
 */

const DEFAULT_SHARES = 3;
const DEFAULT_THRESHOLD = 2;

export interface KeyShares {
  shareA: Buffer;
  shareB: Buffer;
  shareC: Buffer;
}

export function splitKeyIntoThreeShares(
  secret: Buffer,
  threshold: number = DEFAULT_THRESHOLD,
): KeyShares {
  const shares: Buffer[] = sss.split(secret, { shares: DEFAULT_SHARES, threshold });
  if (shares.length !== DEFAULT_SHARES) {
    throw new Error('Unexpected number of shares produced');
  }
  const [shareA, shareB, shareC] = shares;
  return { shareA, shareB, shareC };
}

/**
 * Reconstructs the secret from any `threshold` (>=2) of the three shares.
 * Callers must never pass in only the server's own share plus a fabricated
 * one — reconstruction should only be invoked as part of an authorized
 * recovery flow with a genuine second share supplied by the client/user.
 */
export function reconstructKeyFromShares(shares: Buffer[]): Buffer {
  if (shares.length < DEFAULT_THRESHOLD) {
    throw new Error(`At least ${DEFAULT_THRESHOLD} shares are required to reconstruct the key`);
  }
  return sss.combine(shares);
}
