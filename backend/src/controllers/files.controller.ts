import { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { FileModel } from '../models/File';
import { FileVersion } from '../models/FileVersion';
import { SecurityEvent } from '../models/SecurityEvent';
import { Permission } from '../models/Permission';
import { FileShareKey } from '../models/FileShareKey';
import { getStorageProvider } from '../services/storage';
import {
  recordDocumentHashOnChain,
  verifyOnChainRecord,
  isBlockchainAuditEnabled,
} from '../services/blockchainService';
import { logger } from '../utils/logger';
import { recordAccessAndCheckMassDownload, recordAccessAndCheckSuspiciousSharing } from '../services/aiCoPilot';

const PRESIGN_TTL_SECONDS = 300; // 5 minutes — short-lived by design

/**
 * Step 1 of upload: client asks for a place to put its already-encrypted
 * blob. The server never sees plaintext here — it only issues a signed
 * URL scoped to one object key.
 */
export async function requestUploadUrl(req: Request, res: Response): Promise<void> {
  const schema = z.object({
    declaredMimeType: z.string().min(1),
    declaredSizeBytes: z.number().positive().max(5 * 1024 * 1024 * 1024), // 5GB ceiling, see FILE UPLOAD SECURITY
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  const storageKey = `users/${req.ztx!.userId}/${uuid()}`;
  const storage = getStorageProvider();
  const uploadUrl = await storage.getPresignedUploadUrl(storageKey, PRESIGN_TTL_SECONDS);

  res.json({ storageKey, uploadUrl, expiresInSeconds: PRESIGN_TTL_SECONDS });
}

/**
 * Step 2 of upload: after the client PUTs ciphertext to the presigned URL,
 * it registers the file record with the encryption metadata it generated
 * client-side (wrapped key, IV, auth tag, content hash). The server
 * verifies the object actually exists before trusting the record.
 */
const confirmUploadSchema = z.object({
  storageKey: z.string().min(1),
  name: z.string().min(1).max(255),
  folderId: z.string().nullable().optional(),
  declaredMimeType: z.string().min(1),
  sizeBytesEncrypted: z.number().positive(),
  wrappedFileKey: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  contentHashSha256: z.string().length(64),
  availableAfter: z.string().datetime().optional(),
  expireAfter: z.string().datetime().optional(),
  allowedCountries: z.array(z.string().length(2)).optional(),
});

export async function confirmUpload(req: Request, res: Response): Promise<void> {
  const parsed = confirmUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }
  const data = parsed.data;

  const storage = getStorageProvider();
  const exists = await storage.objectExists(data.storageKey);
  if (!exists) {
    res.status(400).json({ error: 'OBJECT_NOT_FOUND_IN_STORAGE' });
    return;
  }
  // Storage keys are namespaced by userId at issuance time; confirm the
  // caller isn't registering a blob uploaded under someone else's prefix.
  if (!data.storageKey.startsWith(`users/${req.ztx!.userId}/`)) {
    res.status(403).json({ error: 'STORAGE_KEY_OWNERSHIP_MISMATCH' });
    return;
  }

  const file = await FileModel.create({
    ownerId: req.ztx!.userId,
    folderId: data.folderId ?? null,
    name: data.name,
    storageKey: data.storageKey,
    sizeBytesEncrypted: data.sizeBytesEncrypted,
    mimeTypeDeclared: data.declaredMimeType,
    wrappedFileKey: data.wrappedFileKey,
    iv: data.iv,
    authTag: data.authTag,
    contentHashSha256: data.contentHashSha256,
    availableAfter: data.availableAfter ? new Date(data.availableAfter) : undefined,
    expireAfter: data.expireAfter ? new Date(data.expireAfter) : undefined,
    allowedCountries: data.allowedCountries,
  });

  await FileVersion.create({
    fileId: file._id,
    versionNumber: 1,
    storageKey: file.storageKey,
    contentHashSha256: file.contentHashSha256,
    wrappedFileKey: file.wrappedFileKey,
    iv: file.iv,
    authTag: file.authTag,
    createdByUserId: req.ztx!.userId,
  });

  // Fire-and-forget: the upload has already succeeded and been recorded in
  // MongoDB regardless of blockchain outcome. We never block the user's
  // response on an on-chain transaction, and we never claim a blockchain
  // confirmation happened if it didn't (see blockchainService's
  // fail-closed behavior when unconfigured).
  if (isBlockchainAuditEnabled()) {
    const dataHashBytes32 = '0x' + data.contentHashSha256;
    recordDocumentHashOnChain(file._id.toString(), dataHashBytes32).catch((err) => {
      logger.error({ err, fileId: file._id.toString() }, 'On-chain document hash recording failed');
    });
  }

  res.status(201).json({ file, blockchainAuditEnabled: isBlockchainAuditEnabled() });
}

export async function listFiles(req: Request, res: Response): Promise<void> {
  const folderId = (req.query.folderId as string) || null;
  const files = await FileModel.find({
    ownerId: req.ztx!.userId,
    folderId,
    isTrashed: false,
  }).sort({ createdAt: -1 });
  res.json({ files });
}

/** Country codes are approximated from the request IP; treated as a signal, not proof. */
function resolveRequestCountry(req: Request): string | undefined {
  const headerCountry = req.headers['x-geo-country'] as string | undefined; // set by edge/CDN in production
  return headerCountry?.toUpperCase();
}

export async function getDownloadUrl(req: Request, res: Response): Promise<void> {
  const file = (req as any).resource as InstanceType<typeof FileModel>;
  const now = new Date();

  if (file.availableAfter && now < file.availableAfter) {
    res.status(403).json({ error: 'FILE_NOT_YET_AVAILABLE', availableAfter: file.availableAfter });
    return;
  }
  if (file.expireAfter && now > file.expireAfter) {
    res.status(410).json({ error: 'FILE_EXPIRED' });
    return;
  }
  if (file.allowedCountries?.length) {
    const country = resolveRequestCountry(req);
    if (!country || !file.allowedCountries.includes(country)) {
      await SecurityEvent.create({
        userId: req.ztx!.userId,
        type: 'suspicious_download',
        threatLevel: 'medium',
        reason: 'Download blocked by geo-lock policy',
        evidence: { fileId: file._id.toString(), country: country ?? 'unknown' },
        confidence: 0.7,
      });
      res.status(403).json({ error: 'GEO_RESTRICTED' });
      return;
    }
  }

  // Each recipient can only unwrap a copy of the file key that was
  // specifically ML-KEM-wrapped for THEIR public key. The owner's copy
  // (file.wrappedFileKey) was wrapped for the owner's key alone — a
  // shared-with grantee's secret key cannot decapsulate it. Serve the
  // right one based on who's actually asking, not just "the file's key".
  const isOwner = file.ownerId.toString() === req.ztx!.userId;
  let wrappedFileKey = file.wrappedFileKey;

  if (!isOwner) {
    const shareKey = await FileShareKey.findOne({ fileId: file._id, granteeUserId: req.ztx!.userId });
    if (!shareKey) {
      // Defensive: requireResourceAccess already confirmed a Permission
      // grant exists, so this would mean the grant and the key record
      // have drifted out of sync — fail closed rather than serve the
      // wrong key.
      res.status(500).json({ error: 'SHARE_KEY_MISSING' });
      return;
    }
    wrappedFileKey = shareKey.wrappedFileKey;
  }

  const storage = getStorageProvider();
  const url = await storage.getPresignedDownloadUrl(file.storageKey, PRESIGN_TTL_SECONDS);

  recordAccessAndCheckMassDownload(req.ztx!.userId, req.ip ?? 'unknown', file._id.toString()).catch((err) => {
    logger.error({ err }, 'recordAccessAndCheckMassDownload failed');
  });

  res.json({
    downloadUrl: url,
    wrappedFileKey,
    iv: file.iv,
    authTag: file.authTag,
    contentHashSha256: file.contentHashSha256,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  });
}

const shareFileSchema = z.object({
  granteeUserId: z.string().min(1),
  role: z.enum(['viewer', 'contributor', 'editor', 'admin']),
  wrappedFileKeyForGrantee: z.string().min(1),
  expiresAt: z.string().datetime().optional(),
});

/**
 * Sharing a file requires the sharer to already hold the unwrapped file
 * key (they must be the owner or an existing grantee), unwrap it
 * client-side, and re-wrap it for the new grantee's ML-KEM public key.
 * This endpoint only stores the resulting opaque wrapped copy — it never
 * sees plaintext key material.
 */
export async function shareFile(req: Request, res: Response): Promise<void> {
  const file = (req as any).resource as InstanceType<typeof FileModel>;
  const parsed = shareFileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  if (parsed.data.granteeUserId === file.ownerId.toString()) {
    res.status(400).json({ error: 'CANNOT_SHARE_WITH_OWNER' });
    return;
  }

  await Permission.findOneAndUpdate(
    { resourceType: 'file', resourceId: file._id, granteeUserId: parsed.data.granteeUserId },
    {
      role: parsed.data.role,
      grantedByUserId: req.ztx!.userId,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : undefined,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  await FileShareKey.findOneAndUpdate(
    { fileId: file._id, granteeUserId: parsed.data.granteeUserId },
    { wrappedFileKey: parsed.data.wrappedFileKeyForGrantee, grantedByUserId: req.ztx!.userId },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );

  recordAccessAndCheckSuspiciousSharing(req.ztx!.userId, req.ip ?? 'unknown', file._id.toString()).catch((err) => {
    logger.error({ err }, 'recordAccessAndCheckSuspiciousSharing failed');
  });

  res.status(201).json({ ok: true });
}

export async function revokeFileShare(req: Request, res: Response): Promise<void> {
  const file = (req as any).resource as InstanceType<typeof FileModel>;
  const granteeUserId = req.params.userId;

  await Promise.all([
    Permission.deleteOne({ resourceType: 'file', resourceId: file._id, granteeUserId }),
    FileShareKey.deleteOne({ fileId: file._id, granteeUserId }),
  ]);

  res.json({ ok: true });
}

export async function listSharedWithMe(req: Request, res: Response): Promise<void> {
  const grants = await Permission.find({
    resourceType: 'file',
    granteeUserId: req.ztx!.userId,
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
  });

  const fileIds = grants.map((g) => g.resourceId);
  const files = await FileModel.find({ _id: { $in: fileIds }, isTrashed: false }).sort({ createdAt: -1 });

  const roleByFileId = new Map(grants.map((g) => [g.resourceId.toString(), g.role]));
  res.json({
    files: files.map((f) => ({
      ...f.toObject(),
      myRole: roleByFileId.get(f._id.toString()),
    })),
  });
}

export async function listFileShares(req: Request, res: Response): Promise<void> {
  const file = (req as any).resource as InstanceType<typeof FileModel>;
  const grants = await Permission.find({ resourceType: 'file', resourceId: file._id }).populate(
    'granteeUserId',
    'displayName email',
  );
  res.json({ shares: grants });
}

export async function trashFile(req: Request, res: Response): Promise<void> {
  const file = (req as any).resource as InstanceType<typeof FileModel>;
  file.isTrashed = true;
  file.trashedAt = new Date();
  await file.save();
  res.json({ ok: true });
}

export async function restoreFile(req: Request, res: Response): Promise<void> {
  const file = (req as any).resource as InstanceType<typeof FileModel>;
  file.isTrashed = false;
  file.trashedAt = undefined;
  await file.save();
  res.json({ ok: true });
}

export async function verifyFileOnChain(req: Request, res: Response): Promise<void> {
  const file = (req as any).resource as InstanceType<typeof FileModel>;

  if (!isBlockchainAuditEnabled()) {
    res.status(503).json({
      error: 'BLOCKCHAIN_NOT_CONFIGURED',
      message: 'Blockchain audit logging is not configured on this deployment. This file has not been notarized on-chain.',
    });
    return;
  }

  const verification = await verifyOnChainRecord('document', file._id.toString());
  if (!verification || !verification.exists) {
    res.json({ verified: false });
    return;
  }

  const expectedHash = '0x' + file.contentHashSha256;
  const hashMatches = verification.dataHash.toLowerCase() === expectedHash.toLowerCase();

  res.json({
    verified: hashMatches,
    network: 'Avalanche Fuji Testnet',
    recordedBy: verification.recordedBy,
    timestamp: new Date(verification.timestamp * 1000).toISOString(),
    onChainHash: verification.dataHash,
    expectedHash,
  });
}
