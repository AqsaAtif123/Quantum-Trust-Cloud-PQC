import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { authenticator } from 'otplib';
import { env } from '../config/env';
import { IUser } from '../models/User';
import { Session } from '../models/Session';
import { Device } from '../models/Device';
import { encryptBuffer, decryptBuffer, serializeEncryptedPayload, deserializeEncryptedPayload, generateRandomKey } from './crypto/envelopeEncryption';

// Argon2id parameters — memory-hard, tuned for a reasonable server cost
// (not the mobile-friendly minimum). Tune upward as hardware allows.
export async function hashPassword(plaintext: string): Promise<string> {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19456, // ~19 MB
    timeCost: 2,
    parallelism: 1,
  });
}

export async function verifyPassword(hash: string, plaintext: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plaintext);
  } catch {
    return false;
  }
}

// Server-held secret used only to encrypt-at-rest small server metadata
// (MFA secrets, the server's Shamir share). This is NOT a master key for
// user file content — it never touches file encryption.
function getServerMetadataKey(): Buffer {
  // Derived from JWT_ACCESS_SECRET via HKDF-like construction so we don't
  // need yet another required env var, while keeping domain separation
  // from the JWT signing use.
  return crypto.createHash('sha256').update(`qt-metadata:${env.JWT_ACCESS_SECRET}`).digest();
}

export function encryptServerMetadata(plaintext: Buffer): string {
  const payload = encryptBuffer(plaintext, getServerMetadataKey());
  return serializeEncryptedPayload(payload);
}

export function decryptServerMetadata(serialized: string): Buffer {
  const payload = deserializeEncryptedPayload(serialized);
  return decryptBuffer(payload, getServerMetadataKey());
}

// ---------- MFA (TOTP) ----------

export function generateMfaSecret(): string {
  return authenticator.generateSecret();
}

export function generateMfaOtpAuthUrl(email: string, secret: string): string {
  return authenticator.keyuri(email, 'QuantumTrust Cloud', secret);
}

export function verifyMfaToken(secret: string, token: string): boolean {
  return authenticator.verify({ token, secret });
}

// ---------- JWT issuance ----------

interface IssueTokensParams {
  user: IUser;
  sessionId: string;
  deviceId: string;
  mfaVerified: boolean;
}

export function issueAccessToken({ user, sessionId, deviceId, mfaVerified }: IssueTokensParams): string {
  const options: jwt.SignOptions = { expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'] };
  return jwt.sign(
    { sub: user._id.toString(), sid: sessionId, did: deviceId, role: user.role, mfa: mfaVerified },
    env.JWT_ACCESS_SECRET,
    options,
  );
}

export function generateRefreshToken(): string {
  return crypto.randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function createSessionAndDevice(params: {
  userId: string;
  deviceFingerprint: string;
  ipAddress: string;
  userAgent: string;
}): Promise<{ sessionId: string; deviceId: string; refreshToken: string; isNewDevice: boolean }> {
  const existingDevice = await Device.findOne({ userId: params.userId, fingerprint: params.deviceFingerprint });
  const isNewDevice = !existingDevice;

  const device = await Device.findOneAndUpdate(
    { userId: params.userId, fingerprint: params.deviceFingerprint },
    {
      $set: { lastSeenAt: new Date(), lastIp: params.ipAddress },
      $setOnInsert: { firstSeenAt: new Date(), label: 'New device', isTrusted: false },
    },
    { upsert: true, new: true },
  );

  const refreshToken = generateRefreshToken();
  const session = await Session.create({
    userId: params.userId,
    deviceId: device._id,
    refreshTokenHash: hashRefreshToken(refreshToken),
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  return {
    sessionId: session._id.toString(),
    deviceId: device._id.toString(),
    refreshToken,
    isNewDevice,
  };
}

export function generateRandomFileKey(): Buffer {
  return generateRandomKey(32);
}
