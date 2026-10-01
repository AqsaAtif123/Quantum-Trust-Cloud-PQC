import { SecurityEvent, SecurityEventType, ThreatLevel } from '../models/SecurityEvent';
import { AccessLog, AccessAction } from '../models/AccessLog';
import { getOrCreateSecuritySettings } from '../models/SecuritySettings';
import { getGeoResolver, haversineDistanceKm } from './geoResolver';
import { getIO } from './realtime/io';
import { Notification } from '../models/Notification';
import { logger } from '../utils/logger';

/**
 * AI SECURITY CO-PILOT
 * ====================
 * This is a rule-based heuristic engine, not a trained ML model — that's
 * an honest description, not a limitation to apologize for. Each check
 * below is independently toggleable via SecuritySettings (QuantumGuard),
 * reads real signals (login history, device records, access logs), and
 * produces the same {threatLevel, reason, evidence, recommendation,
 * confidence} shape the spec asks for. It does NOT autonomously take
 * destructive action — every check only creates a SecurityEvent and a
 * notification; blocking a session or device requires a separate,
 * explicit user/admin action elsewhere in the API.
 */

interface DetectionResult {
  triggered: boolean;
  threatLevel: ThreatLevel;
  reason: string;
  evidence: Record<string, unknown>;
  recommendation: string;
  confidence: number;
}

async function emitSecurityEvent(
  userId: string,
  type: SecurityEventType,
  result: DetectionResult,
  ipAddress?: string,
): Promise<void> {
  const event = await SecurityEvent.create({
    userId,
    type,
    threatLevel: result.threatLevel,
    reason: result.reason,
    evidence: result.evidence,
    recommendation: result.recommendation,
    confidence: result.confidence,
    ipAddress,
  });

  const notification = await Notification.create({
    userId,
    type: 'security_threat',
    title: `Security alert: ${result.reason}`,
    message: result.recommendation,
    relatedId: event._id.toString(),
  });

  getIO()?.to(`user:${userId}`).emit('notification:new', {
    id: notification._id.toString(),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    relatedId: notification.relatedId,
    createdAt: notification.createdAt,
  });
  getIO()?.to(`user:${userId}`).emit('security:event', {
    type,
    threatLevel: result.threatLevel,
    reason: result.reason,
    createdAt: event.createdAt,
  });
}

/** Called from the login flow, after createSessionAndDevice reports whether this device was newly seen. */
export async function evaluateNewDeviceLogin(userId: string, isNewDevice: boolean, ipAddress: string): Promise<void> {
  if (!isNewDevice) return;
  const settings = await getOrCreateSecuritySettings(userId);
  if (!settings.newDeviceAlerts) return;

  await emitSecurityEvent(
    userId,
    'new_device',
    {
      triggered: true,
      threatLevel: 'medium',
      reason: 'Login from a new device',
      evidence: { ipAddress },
      recommendation: "If this wasn't you, revoke this session from Security Center and enable MFA if you haven't already.",
      confidence: 1, // this is a direct fact (device record didn't exist before), not an inference
    },
    ipAddress,
  );
}

/**
 * Impossible travel: compares the current login's IP-derived location
 * against the user's most recent prior login. Structurally complete, but
 * stays inert (never fires) until a real GeoResolver is configured — see
 * geoResolver.ts for why, and how to make it real.
 */
export async function evaluateImpossibleTravel(
  userId: string,
  currentIp: string,
  previousIp: string | null,
  previousLoginAt: Date | null,
): Promise<void> {
  if (!previousIp || !previousLoginAt) return;
  const settings = await getOrCreateSecuritySettings(userId);
  if (!settings.impossibleTravelDetection) return;

  const resolver = getGeoResolver();
  const [currentLoc, previousLoc] = await Promise.all([resolver.resolve(currentIp), resolver.resolve(previousIp)]);

  if (!currentLoc || !previousLoc) {
    // Honest no-op: we don't have real location data to compare, so we
    // don't guess. Logged at debug level for operator visibility, not
    // surfaced to the user as a finding.
    logger.debug({ userId }, 'Impossible travel check skipped: no geo resolver configured');
    return;
  }

  const distanceKm = haversineDistanceKm(currentLoc, previousLoc);
  const hoursSincePrevious = Math.max((Date.now() - previousLoginAt.getTime()) / (1000 * 60 * 60), 0.01);
  const impliedSpeedKmh = distanceKm / hoursSincePrevious;

  if (impliedSpeedKmh > settings.impossibleTravelMaxKmPerHour && distanceKm > 100) {
    const confidence = Math.min(0.95, 0.5 + (impliedSpeedKmh - settings.impossibleTravelMaxKmPerHour) / 5000);
    await emitSecurityEvent(
      userId,
      'impossible_travel',
      {
        triggered: true,
        threatLevel: 'high',
        reason: `Login locations imply ${Math.round(impliedSpeedKmh)} km/h travel, which isn't physically plausible`,
        evidence: {
          distanceKm: Math.round(distanceKm),
          hoursSincePrevious: Math.round(hoursSincePrevious * 10) / 10,
          previousCountry: previousLoc.country,
          currentCountry: currentLoc.country,
        },
        recommendation: 'Verify this was you. If not, revoke all sessions immediately and change your password.',
        confidence,
      },
      currentIp,
    );
  }
}

/** Called after issuing a file/vault download URL. */
export async function recordAccessAndCheckMassDownload(userId: string, ipAddress: string, resourceId: string): Promise<void> {
  await AccessLog.create({ userId, action: 'download' as AccessAction, resourceId, ipAddress });

  const settings = await getOrCreateSecuritySettings(userId);
  if (!settings.massDownloadDetection) return;

  const windowStart = new Date(Date.now() - settings.massDownloadWindowMinutes * 60 * 1000);
  const count = await AccessLog.countDocuments({ userId, action: 'download', createdAt: { $gte: windowStart } });

  if (count === settings.massDownloadThreshold) {
    // Fire exactly once when the threshold is first crossed, not on every
    // subsequent download past it.
    await emitSecurityEvent(
      userId,
      'mass_file_access',
      {
        triggered: true,
        threatLevel: 'medium',
        reason: `${count} downloads in the last ${settings.massDownloadWindowMinutes} minutes`,
        evidence: { count, windowMinutes: settings.massDownloadWindowMinutes },
        recommendation: 'If this is expected (e.g. bulk export), you can dismiss this. If not, review recent activity in the Audit Log.',
        confidence: 0.7,
      },
      ipAddress,
    );
  }
}

/** Called after granting a room/file permission. */
export async function recordAccessAndCheckSuspiciousSharing(userId: string, ipAddress: string, resourceId: string): Promise<void> {
  await AccessLog.create({ userId, action: 'share_grant' as AccessAction, resourceId, ipAddress });

  const settings = await getOrCreateSecuritySettings(userId);
  if (!settings.suspiciousSharingDetection) return;

  const SHARE_WINDOW_MINUTES = 5;
  const SHARE_THRESHOLD = 10;
  const windowStart = new Date(Date.now() - SHARE_WINDOW_MINUTES * 60 * 1000);
  const count = await AccessLog.countDocuments({ userId, action: 'share_grant', createdAt: { $gte: windowStart } });

  if (count === SHARE_THRESHOLD) {
    await emitSecurityEvent(
      userId,
      'suspicious_sharing',
      {
        triggered: true,
        threatLevel: 'medium',
        reason: `${count} sharing/permission grants in ${SHARE_WINDOW_MINUTES} minutes`,
        evidence: { count, windowMinutes: SHARE_WINDOW_MINUTES },
        recommendation: "If this wasn't intentional bulk sharing, review recent permission grants and revoke any unintended ones.",
        confidence: 0.6,
      },
      ipAddress,
    );
  }
}
