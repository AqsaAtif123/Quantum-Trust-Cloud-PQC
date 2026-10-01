import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { Session } from '../models/Session';
import { Device } from '../models/Device';
import { User } from '../models/User';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
  did: string;
  role: 'user' | 'admin';
  mfa: boolean;
}

export interface VerifiedIdentity {
  userId: string;
  sessionId: string;
  deviceId: string;
  role: 'user' | 'admin';
  mfaVerified: boolean;
}

/**
 * The single source of truth for "is this token+session actually valid
 * right now" — used by both the HTTP `requireAuth` middleware and the
 * Socket.IO connection handshake, so a revoked session or blocked device
 * is rejected identically on both transports rather than having two
 * implementations that could silently drift apart.
 */
export async function verifyAccessToken(token: string): Promise<VerifiedIdentity | null> {
  let payload: AccessTokenPayload;
  try {
    payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
  } catch {
    return null;
  }

  const session = await Session.findById(payload.sid);
  if (!session || session.isRevoked || session.expiresAt.getTime() < Date.now()) {
    return null;
  }

  const device = await Device.findById(payload.did);
  if (!device || device.isBlocked) {
    return null;
  }

  const user = await User.findById(payload.sub);
  if (!user || !user.isActive) {
    return null;
  }

  return {
    userId: user._id.toString(),
    sessionId: session._id.toString(),
    deviceId: device._id.toString(),
    role: user.role,
    mfaVerified: payload.mfa,
  };
}
