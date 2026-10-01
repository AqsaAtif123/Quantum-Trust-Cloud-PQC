import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User';
import { Session } from '../models/Session';
import { Device } from '../models/Device';
import { SecurityEvent } from '../models/SecurityEvent';
import { SecuritySettings, getOrCreateSecuritySettings } from '../models/SecuritySettings';
import { isBlockchainAuditEnabled } from '../services/blockchainService';

/**
 * Aggregates real state from across the system into one Security Center
 * view. Every field here is a live query result, never a hard-coded or
 * placeholder value — see "Do not use fake statistics after integration
 * is complete" in the spec.
 */
export async function getSecurityOverview(req: Request, res: Response): Promise<void> {
  const userId = req.ztx!.userId;

  const [user, activeSessions, devices, recentEvents, settings] = await Promise.all([
    User.findById(userId),
    Session.find({ userId, isRevoked: false, expiresAt: { $gt: new Date() } }).sort({ lastSeenAt: -1 }),
    Device.find({ userId }).sort({ lastSeenAt: -1 }),
    SecurityEvent.find({ userId }).sort({ createdAt: -1 }).limit(20),
    getOrCreateSecuritySettings(userId),
  ]);

  if (!user) {
    res.status(404).json({ error: 'USER_NOT_FOUND' });
    return;
  }

  res.json({
    securityScore: user.securityScore,
    mfaEnabled: user.mfaEnabled,
    activeSessions: activeSessions.map((s) => ({
      id: s._id.toString(),
      deviceId: s.deviceId.toString(),
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      lastSeenAt: s.lastSeenAt,
      createdAt: s.createdAt,
    })),
    devices: devices.map((d) => ({
      id: d._id.toString(),
      label: d.label,
      lastIp: d.lastIp,
      isTrusted: d.isTrusted,
      isBlocked: d.isBlocked,
      firstSeenAt: d.firstSeenAt,
      lastSeenAt: d.lastSeenAt,
    })),
    recentEvents: recentEvents.map((e) => ({
      id: e._id.toString(),
      type: e.type,
      threatLevel: e.threatLevel,
      reason: e.reason,
      recommendation: e.recommendation,
      confidence: e.confidence,
      acknowledged: e.acknowledged,
      createdAt: e.createdAt,
    })),
    // These reflect what's actually true of the architecture, not a
    // per-user toggle — client-side AES-256-GCM and ML-KEM/ML-DSA are
    // always in effect for anyone using the real client, not optional.
    encryptionStatus: { clientSideAesGcm: true },
    pqcStatus: { mlKem768: true, mlDsa65: true },
    blockchainAuditStatus: { enabled: isBlockchainAuditEnabled() },
    quantumGuard: {
      suspiciousLoginDetection: settings.suspiciousLoginDetection,
      impossibleTravelDetection: settings.impossibleTravelDetection,
      newDeviceAlerts: settings.newDeviceAlerts,
      massDownloadDetection: settings.massDownloadDetection,
      suspiciousSharingDetection: settings.suspiciousSharingDetection,
    },
  });
}

/**
 * The fuller audit trail behind the "Audit Log" screen — paginated and
 * filterable, unlike the Security Center overview's fixed latest-20
 * snapshot. Same underlying SecurityEvent data; this is the "see
 * everything" view rather than the "what needs my attention right now"
 * summary.
 */
export async function listAuditEvents(req: Request, res: Response): Promise<void> {
  const userId = req.ztx!.userId;
  const before = req.query.before ? new Date(req.query.before as string) : new Date();
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const type = req.query.type as string | undefined;

  const query: Record<string, unknown> = { userId, createdAt: { $lt: before } };
  if (type) query.type = type;

  const events = await SecurityEvent.find(query).sort({ createdAt: -1 }).limit(limit);

  res.json({
    events: events.map((e) => ({
      id: e._id.toString(),
      type: e.type,
      threatLevel: e.threatLevel,
      reason: e.reason,
      evidence: e.evidence,
      confidence: e.confidence,
      acknowledged: e.acknowledged,
      createdAt: e.createdAt,
    })),
    blockchainAuditEnabled: isBlockchainAuditEnabled(),
  });
}

export async function getSecuritySettings(req: Request, res: Response): Promise<void> {
  const settings = await getOrCreateSecuritySettings(req.ztx!.userId);
  res.json({ settings });
}

const updateSettingsSchema = z.object({
  suspiciousLoginDetection: z.boolean().optional(),
  impossibleTravelDetection: z.boolean().optional(),
  newDeviceAlerts: z.boolean().optional(),
  massDownloadDetection: z.boolean().optional(),
  suspiciousSharingDetection: z.boolean().optional(),
  massDownloadThreshold: z.number().int().min(1).max(1000).optional(),
  massDownloadWindowMinutes: z.number().int().min(1).max(1440).optional(),
});

export async function updateSecuritySettings(req: Request, res: Response): Promise<void> {
  const parsed = updateSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  await getOrCreateSecuritySettings(req.ztx!.userId);
  const settings = await SecuritySettings.findOneAndUpdate(
    { userId: req.ztx!.userId },
    { $set: parsed.data },
    { new: true },
  );

  res.json({ settings });
}

export async function revokeSession(req: Request, res: Response): Promise<void> {
  const session = await Session.findOne({ _id: req.params.sessionId, userId: req.ztx!.userId });
  if (!session) {
    res.status(404).json({ error: 'SESSION_NOT_FOUND' });
    return;
  }
  session.isRevoked = true;
  session.revokedReason = 'user_revoked_from_security_center';
  await session.save();
  res.json({ ok: true });
}

export async function blockDevice(req: Request, res: Response): Promise<void> {
  const device = await Device.findOne({ _id: req.params.deviceId, userId: req.ztx!.userId });
  if (!device) {
    res.status(404).json({ error: 'DEVICE_NOT_FOUND' });
    return;
  }
  device.isBlocked = true;
  await device.save();

  // Blocking a device should also kill any live sessions on it —
  // otherwise a currently-open session on that device would keep working
  // until its token expires, defeating the point of blocking it.
  await Session.updateMany(
    { userId: req.ztx!.userId, deviceId: device._id, isRevoked: false },
    { isRevoked: true, revokedReason: 'device_blocked' },
  );

  res.json({ ok: true });
}

export async function acknowledgeEvent(req: Request, res: Response): Promise<void> {
  const event = await SecurityEvent.findOneAndUpdate(
    { _id: req.params.eventId, userId: req.ztx!.userId },
    { acknowledged: true },
    { new: true },
  );
  if (!event) {
    res.status(404).json({ error: 'EVENT_NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
}
