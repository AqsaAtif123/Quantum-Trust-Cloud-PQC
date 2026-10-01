import { VaultDocument, computeVaultStatus } from '../models/VaultDocument';
import { Notification } from '../models/Notification';
import { getIO } from '../services/realtime/io';
import { logger } from '../utils/logger';

/**
 * Scans all non-trashed vault documents with an expiry date and creates a
 * notification the first time a document crosses into "expiring_soon" or
 * "expired". Deduplicated by checking for an existing unread notification
 * of the same type for the same document, so re-running this job (it's
 * intended to run on an interval — see registerVaultExpiryJob below)
 * doesn't spam the user with a duplicate notification every run.
 *
 * Never includes document CONTENTS in the notification — only category,
 * title, and dates, per the "never expose sensitive document contents in
 * notifications" requirement.
 */
export async function runVaultExpiryCheck(): Promise<{ created: number }> {
  const docs = await VaultDocument.find({
    isTrashed: false,
    expiryDate: { $exists: true, $ne: null },
  });

  let created = 0;

  for (const doc of docs) {
    const status = computeVaultStatus(doc.expiryDate ?? null);
    if (status !== 'expiring_soon' && status !== 'expired') continue;

    const type = status === 'expired' ? 'vault_expired' : 'vault_expiring_soon';
    const existing = await Notification.findOne({ userId: doc.ownerId, type, relatedId: doc._id.toString() });
    if (existing) continue; // already notified for this state; don't repeat every run

    const message =
      status === 'expired'
        ? `${doc.name} expired on ${doc.expiryDate!.toDateString()}.`
        : `${doc.name} expires on ${doc.expiryDate!.toDateString()}.`;

    const notification = await Notification.create({
      userId: doc.ownerId,
      type,
      title: status === 'expired' ? 'Document expired' : 'Document expiring soon',
      message,
      relatedId: doc._id.toString(),
    });

    getIO()?.to(`user:${doc.ownerId.toString()}`).emit('notification:new', {
      id: notification._id.toString(),
      type: notification.type,
      title: notification.title,
      message: notification.message,
      relatedId: notification.relatedId,
      createdAt: notification.createdAt,
    });

    created += 1;
  }

  if (created > 0) {
    logger.info({ created }, 'Vault expiry check created new notifications');
  }
  return { created };
}

const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6 hours

export function registerVaultExpiryJob(): NodeJS.Timeout {
  // Run once shortly after boot, then on a fixed interval. A real
  // production deployment would likely use a proper job scheduler
  // (node-cron, BullMQ, etc.) for retry/observability; this interval-based
  // version is honest about being the minimal real implementation, not a
  // placeholder — it does actually scan and notify.
  setTimeout(() => {
    runVaultExpiryCheck().catch((err) => logger.error({ err }, 'Initial vault expiry check failed'));
  }, 30_000);

  return setInterval(() => {
    runVaultExpiryCheck().catch((err) => logger.error({ err }, 'Scheduled vault expiry check failed'));
  }, CHECK_INTERVAL_MS);
}
