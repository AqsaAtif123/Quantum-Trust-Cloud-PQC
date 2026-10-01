import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { SecurityEvent } from '../models/SecurityEvent';
import { evaluateNewDeviceLogin, evaluateImpossibleTravel } from '../services/aiCoPilot';
import {
  hashPassword,
  verifyPassword,
  issueAccessToken,
  createSessionAndDevice,
  generateMfaSecret,
  generateMfaOtpAuthUrl,
  verifyMfaToken,
  encryptServerMetadata,
  decryptServerMetadata,
} from '../services/authService';
import { logger } from '../utils/logger';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(12, 'Password must be at least 12 characters'),
  displayName: z.string().min(1).max(80),
  // Client-generated PQC public keys (secret keys never leave the client).
  kemPublicKey: z.string().optional(),
  dsaPublicKey: z.string().optional(),
});

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const { email, password, displayName, kemPublicKey, dsaPublicKey } = parsed.data;

  const existing = await User.findOne({ email });
  if (existing) {
    // Same response regardless of whether the account exists, to avoid
    // user-enumeration via registration.
    res.status(202).json({ message: 'If this email can be registered, check your inbox.' });
    return;
  }

  const passwordHash = await hashPassword(password);
  const user = await User.create({
    email,
    passwordHash,
    displayName,
    kemPublicKey,
    dsaPublicKey,
  });

  logger.info({ userId: user._id.toString() }, 'user registered');
  res.status(201).json({ userId: user._id.toString() });
}

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceFingerprint: z.string().min(1),
  mfaToken: z.string().optional(),
});

export async function login(req: Request, res: Response): Promise<void> {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  const { email, password, deviceFingerprint, mfaToken } = parsed.data;
  const ipAddress = req.ip ?? 'unknown';
  const userAgent = req.headers['user-agent'] ?? 'unknown';

  const user = await User.findOne({ email }).select('+passwordHash +mfaSecretEncrypted');
  const genericFailure = () => res.status(401).json({ error: 'INVALID_CREDENTIALS' });

  if (!user || !user.isActive) {
    genericFailure();
    return;
  }

  const passwordOk = await verifyPassword(user.passwordHash, password);
  if (!passwordOk) {
    await SecurityEvent.create({
      userId: user._id,
      type: 'login_failure',
      threatLevel: 'low',
      reason: 'Incorrect password',
      evidence: { ipAddress },
      confidence: 0.9,
      ipAddress,
    });
    genericFailure();
    return;
  }

  if (user.mfaEnabled) {
    if (!mfaToken) {
      res.status(401).json({ error: 'MFA_TOKEN_REQUIRED' });
      return;
    }
    const secret = decryptServerMetadata(user.mfaSecretEncrypted!).toString('utf8');
    if (!verifyMfaToken(secret, mfaToken)) {
      await SecurityEvent.create({
        userId: user._id,
        type: 'login_failure',
        threatLevel: 'medium',
        reason: 'Incorrect MFA token',
        evidence: { ipAddress },
        confidence: 0.85,
        ipAddress,
      });
      genericFailure();
      return;
    }
  }

  const { sessionId, deviceId, refreshToken, isNewDevice } = await createSessionAndDevice({
    userId: user._id.toString(),
    deviceFingerprint,
    ipAddress,
    userAgent: String(userAgent),
  });

  const accessToken = issueAccessToken({
    user,
    sessionId,
    deviceId,
    mfaVerified: user.mfaEnabled, // true only if MFA was actually required & passed above
  });

  // Capture the PREVIOUS login's state before overwriting it, so the AI
  // Co-Pilot's impossible-travel check has something real to compare
  // against instead of comparing this login to itself.
  const previousIp = user.lastLoginIp ?? null;
  const previousLoginAt = user.lastLoginAt ?? null;

  user.lastLoginAt = new Date();
  user.lastLoginIp = ipAddress;
  await user.save();

  await SecurityEvent.create({
    userId: user._id,
    type: 'login_success',
    threatLevel: 'info',
    reason: 'Successful login',
    evidence: { ipAddress },
    confidence: 1,
    ipAddress,
  });

  // Fire-and-forget: these checks may create their own SecurityEvent +
  // notification, but they must never block or fail the login itself.
  evaluateNewDeviceLogin(user._id.toString(), isNewDevice, ipAddress).catch((err) =>
    logger.error({ err }, 'evaluateNewDeviceLogin failed'),
  );
  evaluateImpossibleTravel(user._id.toString(), ipAddress, previousIp, previousLoginAt).catch((err) =>
    logger.error({ err }, 'evaluateImpossibleTravel failed'),
  );

  res
    .cookie('qt_access', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60 * 1000,
    })
    .json({
      accessToken,
      refreshToken,
      userId: user._id.toString(),
      kemPublicKey: user.kemPublicKey,
      dsaPublicKey: user.dsaPublicKey,
    });
}

export async function enrollMfa(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.ztx!.userId);
  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return;
  }
  const secret = generateMfaSecret();
  user.mfaSecretEncrypted = encryptServerMetadata(Buffer.from(secret, 'utf8'));
  await user.save();

  const otpAuthUrl = generateMfaOtpAuthUrl(user.email, secret);
  // Returned once; the frontend renders it as a QR code. Enabling MFA
  // requires a subsequent successful /mfa/confirm call with a live token.
  res.json({ otpAuthUrl, secret });
}

const confirmMfaSchema = z.object({ token: z.string().length(6) });

export async function confirmMfa(req: Request, res: Response): Promise<void> {
  const parsed = confirmMfaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  const user = await User.findById(req.ztx!.userId).select('+mfaSecretEncrypted');
  if (!user?.mfaSecretEncrypted) {
    res.status(400).json({ error: 'MFA_NOT_ENROLLED' });
    return;
  }
  const secret = decryptServerMetadata(user.mfaSecretEncrypted).toString('utf8');
  if (!verifyMfaToken(secret, parsed.data.token)) {
    res.status(400).json({ error: 'INVALID_MFA_TOKEN' });
    return;
  }
  user.mfaEnabled = true;
  user.securityScore = Math.min(100, user.securityScore + 25);
  await user.save();
  res.json({ mfaEnabled: true });
}

const disableMfaSchema = z.object({ token: z.string().length(6) });

/**
 * Disabling MFA requires a LIVE, valid MFA token — not just an active
 * session. If a stolen session cookie alone were enough to turn off a
 * user's second factor, MFA would provide no protection against exactly
 * the scenario (session/token theft) it exists to mitigate.
 */
export async function disableMfa(req: Request, res: Response): Promise<void> {
  const parsed = disableMfaSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  const user = await User.findById(req.ztx!.userId).select('+mfaSecretEncrypted');
  if (!user?.mfaEnabled || !user.mfaSecretEncrypted) {
    res.status(400).json({ error: 'MFA_NOT_ENABLED' });
    return;
  }
  const secret = decryptServerMetadata(user.mfaSecretEncrypted).toString('utf8');
  if (!verifyMfaToken(secret, parsed.data.token)) {
    res.status(400).json({ error: 'INVALID_MFA_TOKEN' });
    return;
  }
  user.mfaEnabled = false;
  user.mfaSecretEncrypted = undefined;
  user.securityScore = Math.max(0, user.securityScore - 25);
  await user.save();
  res.json({ mfaEnabled: false });
}

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

/**
 * IMPORTANT CLIENT-SIDE CONSEQUENCE: the frontend's PQC secret keys are
 * encrypted at rest under a key derived from the password (see
 * secretKeyStore.ts). Changing the password here does NOT automatically
 * re-encrypt that local record — the client must re-persist its local
 * key store under the new password as part of this same flow, or the
 * user will be unable to unlock their own keys with the new password on
 * next login. This endpoint only changes the server-side auth credential.
 */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const parsed = changePasswordSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const user = await User.findById(req.ztx!.userId).select('+passwordHash');
  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return;
  }
  const currentOk = await verifyPassword(user.passwordHash, parsed.data.currentPassword);
  if (!currentOk) {
    res.status(401).json({ error: 'INCORRECT_CURRENT_PASSWORD' });
    return;
  }
  user.passwordHash = await hashPassword(parsed.data.newPassword);
  await user.save();

  // Revoke every other session on password change — a classic and
  // important security control: if the password was changed because it
  // may have been compromised, any session an attacker already holds
  // should not survive the change.
  await Session.updateMany(
    { userId: user._id, _id: { $ne: req.ztx!.sessionId } },
    { isRevoked: true, revokedReason: 'password_changed' },
  );

  res.json({ ok: true });
}

const updateProfileSchema = z.object({ displayName: z.string().min(1).max(80) });

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  const user = await User.findByIdAndUpdate(req.ztx!.userId, { displayName: parsed.data.displayName }, { new: true });
  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return;
  }
  res.json({ displayName: user.displayName });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await Session.findByIdAndUpdate(req.ztx!.sessionId, { isRevoked: true, revokedReason: 'user_logout' });
  res.clearCookie('qt_access').json({ ok: true });
}

export async function logoutAllDevices(req: Request, res: Response): Promise<void> {
  await Session.updateMany({ userId: req.ztx!.userId }, { isRevoked: true, revokedReason: 'logout_all' });
  res.clearCookie('qt_access').json({ ok: true });
}

export async function getMe(req: Request, res: Response): Promise<void> {
  const user = await User.findById(req.ztx!.userId);
  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return;
  }
  res.json({
    userId: user._id.toString(),
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    mfaEnabled: user.mfaEnabled,
    kemPublicKey: user.kemPublicKey,
    dsaPublicKey: user.dsaPublicKey,
    securityScore: user.securityScore,
  });
}
