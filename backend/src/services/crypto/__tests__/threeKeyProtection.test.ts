import crypto from 'crypto';
import { splitKeyIntoThreeShares, reconstructKeyFromShares } from '../threeKeyProtection';

describe('three-part key protection (2-of-3 Shamir secret sharing)', () => {
  it('reconstructs the original secret from any 2 of 3 shares', () => {
    const secret = crypto.randomBytes(32);
    const { shareA, shareB, shareC } = splitKeyIntoThreeShares(secret);

    expect(reconstructKeyFromShares([shareA, shareB]).equals(secret)).toBe(true);
    expect(reconstructKeyFromShares([shareA, shareC]).equals(secret)).toBe(true);
    expect(reconstructKeyFromShares([shareB, shareC]).equals(secret)).toBe(true);
  });

  it('reconstructs correctly using all 3 shares', () => {
    const secret = crypto.randomBytes(32);
    const { shareA, shareB, shareC } = splitKeyIntoThreeShares(secret);
    expect(reconstructKeyFromShares([shareA, shareB, shareC]).equals(secret)).toBe(true);
  });

  it('refuses to reconstruct from a single share (below threshold)', () => {
    const secret = crypto.randomBytes(32);
    const { shareA } = splitKeyIntoThreeShares(secret);
    expect(() => reconstructKeyFromShares([shareA])).toThrow();
  });

  it('refuses to reconstruct from zero shares', () => {
    expect(() => reconstructKeyFromShares([])).toThrow();
  });

  it('produces three distinct shares, none equal to the secret or each other', () => {
    const secret = crypto.randomBytes(32);
    const { shareA, shareB, shareC } = splitKeyIntoThreeShares(secret);

    expect(shareA.equals(secret)).toBe(false);
    expect(shareB.equals(secret)).toBe(false);
    expect(shareC.equals(secret)).toBe(false);
    expect(shareA.equals(shareB)).toBe(false);
    expect(shareA.equals(shareC)).toBe(false);
    expect(shareB.equals(shareC)).toBe(false);
  });

  it('works for keys of different lengths', () => {
    const secret16 = crypto.randomBytes(16);
    const { shareA, shareB } = splitKeyIntoThreeShares(secret16);
    expect(reconstructKeyFromShares([shareA, shareB]).equals(secret16)).toBe(true);
  });
});
