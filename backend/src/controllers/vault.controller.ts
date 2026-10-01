import { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import crypto from 'crypto';
import { VaultDocument, computeVaultStatus } from '../models/VaultDocument';
import { User } from '../models/User';
import { getStorageProvider } from '../services/storage';
import { verifySignature as verifyMlDsaSignature } from '../services/crypto/pqc';
import {
  recordNotarizationOnChain,
  verifyOnChainRecord,
  isBlockchainAuditEnabled,
} from '../services/blockchainService';
import { logger } from '../utils/logger';

const PRESIGN_TTL_SECONDS = 300;

export async function requestVaultUploadUrl(req: Request, res: Response): Promise<void> {
  const schema = z.object({
    declaredMimeType: z.string().min(1),
    declaredSizeBytes: z.number().positive().max(500 * 1024 * 1024), // vault documents are typically small scans/PDFs, not bulk files
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  const storageKey = `vault/${req.ztx!.userId}/${uuid()}`;
  const storage = getStorageProvider();
  const uploadUrl = await storage.getPresignedUploadUrl(storageKey, PRESIGN_TTL_SECONDS);
  res.json({ storageKey, uploadUrl, expiresInSeconds: PRESIGN_TTL_SECONDS });
}

const confirmSchema = z.object({
  storageKey: z.string().min(1),
  name: z.string().min(1).max(255),
  category: z.enum(['cnic', 'passport', 'degree', 'certificate', 'license', 'contract', 'financial_document', 'employment_document', 'other']),
  declaredMimeType: z.string().min(1),
  sizeBytesEncrypted: z.number().positive(),
  wrappedFileKey: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  contentHashSha256: z.string().length(64),
  expiryDate: z.string().datetime().optional(),
});

export async function confirmVaultUpload(req: Request, res: Response): Promise<void> {
  const parsed = confirmSchema.safeParse(req.body);
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
  if (!data.storageKey.startsWith(`vault/${req.ztx!.userId}/`)) {
    res.status(403).json({ error: 'STORAGE_KEY_OWNERSHIP_MISMATCH' });
    return;
  }

  const doc = await VaultDocument.create({
    ownerId: req.ztx!.userId,
    category: data.category,
    name: data.name,
    storageKey: data.storageKey,
    sizeBytesEncrypted: data.sizeBytesEncrypted,
    mimeTypeDeclared: data.declaredMimeType,
    wrappedFileKey: data.wrappedFileKey,
    iv: data.iv,
    authTag: data.authTag,
    contentHashSha256: data.contentHashSha256,
    expiryDate: data.expiryDate ? new Date(data.expiryDate) : undefined,
  });

  res.status(201).json({ document: serializeDocument(doc) });
}

function serializeDocument(doc: InstanceType<typeof VaultDocument>) {
  return {
    id: doc._id.toString(),
    category: doc.category,
    name: doc.name,
    sizeBytesEncrypted: doc.sizeBytesEncrypted,
    mimeTypeDeclared: doc.mimeTypeDeclared,
    contentHashSha256: doc.contentHashSha256,
    expiryDate: doc.expiryDate,
    status: computeVaultStatus(doc.expiryDate ?? null),
    hasSignature: !!doc.signature,
    hasCertificate: !!doc.certificate,
    createdAt: doc.createdAt,
  };
}

export async function listVaultDocuments(req: Request, res: Response): Promise<void> {
  const category = req.query.category as string | undefined;
  const query: Record<string, unknown> = { ownerId: req.ztx!.userId, isTrashed: false };
  if (category) query.category = category;

  const docs = await VaultDocument.find(query).sort({ createdAt: -1 });
  res.json({ documents: docs.map(serializeDocument) });
}

export async function getVaultDownloadUrl(req: Request, res: Response): Promise<void> {
  const doc = (req as any).resource as InstanceType<typeof VaultDocument>;
  const storage = getStorageProvider();
  const url = await storage.getPresignedDownloadUrl(doc.storageKey, PRESIGN_TTL_SECONDS);
  res.json({
    downloadUrl: url,
    wrappedFileKey: doc.wrappedFileKey,
    iv: doc.iv,
    authTag: doc.authTag,
    contentHashSha256: doc.contentHashSha256,
    expiresInSeconds: PRESIGN_TTL_SECONDS,
  });
}

export async function trashVaultDocument(req: Request, res: Response): Promise<void> {
  const doc = (req as any).resource as InstanceType<typeof VaultDocument>;
  doc.isTrashed = true;
  await doc.save();
  res.json({ ok: true });
}

/**
 * Records a client-generated ML-DSA-65 signature over the document's
 * content hash. The signature itself is produced entirely client-side
 * (see frontend pqcClient.ts signDocumentHash) — the server's job here is
 * to VERIFY it actually validates against the claimed signer's stored
 * public key before accepting it, so a malformed or forged submission is
 * rejected rather than silently stored as if it were valid.
 */
const signSchema = z.object({
  signatureBase64: z.string().min(1),
});

export async function signVaultDocument(req: Request, res: Response): Promise<void> {
  const doc = (req as any).resource as InstanceType<typeof VaultDocument>;
  const parsed = signSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  const signer = await User.findById(req.ztx!.userId);
  if (!signer?.dsaPublicKey) {
    res.status(400).json({ error: 'SIGNER_HAS_NO_DSA_PUBLIC_KEY' });
    return;
  }

  const hashBytes = Buffer.from(doc.contentHashSha256, 'hex');
  const signatureBytes = Buffer.from(parsed.data.signatureBase64, 'base64');
  const publicKeyBytes = Buffer.from(signer.dsaPublicKey, 'base64');

  const valid = verifyMlDsaSignature(hashBytes, signatureBytes, publicKeyBytes);
  if (!valid) {
    res.status(400).json({
      error: 'INVALID_SIGNATURE',
      message: 'The submitted signature does not verify against the content hash and your registered ML-DSA public key.',
    });
    return;
  }

  doc.signature = {
    signatureBase64: parsed.data.signatureBase64,
    dsaPublicKeyBase64: signer.dsaPublicKey,
    signedByUserId: signer._id,
    signedAt: new Date(),
  };
  await doc.save();

  res.json({ ok: true, verified: true });
}

/**
 * Generates an integrity certificate and, if blockchain audit logging is
 * configured, notarizes the document hash on-chain. Honestly reports
 * whether the on-chain step actually happened — never claims notarization
 * succeeded when it didn't run.
 */
export async function generateCertificate(req: Request, res: Response): Promise<void> {
  const doc = (req as any).resource as InstanceType<typeof VaultDocument>;

  const certificateId = uuid();
  let blockchainTxHash: string | undefined;

  if (isBlockchainAuditEnabled()) {
    try {
      const dataHashBytes32 = '0x' + doc.contentHashSha256;
      const result = await recordNotarizationOnChain(doc._id.toString(), dataHashBytes32);
      blockchainTxHash = result?.transactionHash;
    } catch (err) {
      logger.error({ err, docId: doc._id.toString() }, 'On-chain notarization failed during certificate generation');
      // Certificate is still issued — it just won't have a blockchain
      // reference until a retry succeeds. This is surfaced honestly via
      // the response, not hidden.
    }
  }

  doc.certificate = {
    certificateId,
    documentHash: doc.contentHashSha256,
    issuedAt: new Date(),
    blockchainTxHash,
  };
  await doc.save();

  res.status(201).json({
    certificate: doc.certificate,
    blockchainNotarized: !!blockchainTxHash,
    verificationPath: `/api/vault/certificates/${certificateId}/verify`,
  });
}

/**
 * PUBLIC verification endpoint (no auth required — this is the whole
 * point of a certificate: anyone with the certificate ID, e.g. from a
 * scanned QR code, can independently verify it) — but it deliberately
 * returns only the hash/metadata needed for verification, never the
 * document's encrypted content or owner's identifying details beyond
 * what's needed to confirm authenticity.
 */
export async function verifyCertificate(req: Request, res: Response): Promise<void> {
  const doc = await VaultDocument.findOne({ 'certificate.certificateId': req.params.certificateId });
  if (!doc?.certificate) {
    res.status(404).json({ verified: false, error: 'CERTIFICATE_NOT_FOUND' });
    return;
  }

  let onChainStatus: Awaited<ReturnType<typeof verifyOnChainRecord>> = null;
  if (doc.certificate.blockchainTxHash && isBlockchainAuditEnabled()) {
    onChainStatus = await verifyOnChainRecord('notarization', doc._id.toString());
  }

  res.json({
    verified: true,
    certificateId: doc.certificate.certificateId,
    documentHash: doc.certificate.documentHash,
    issuedAt: doc.certificate.issuedAt,
    hasSignature: !!doc.signature,
    blockchain: doc.certificate.blockchainTxHash
      ? {
          network: 'Avalanche Fuji Testnet',
          transactionHash: doc.certificate.blockchainTxHash,
          onChainConfirmed: !!onChainStatus?.exists,
          hashMatchesOnChainRecord: onChainStatus?.exists
            ? onChainStatus.dataHash.toLowerCase() === ('0x' + doc.certificate.documentHash).toLowerCase()
            : false,
        }
      : null,
  });
}

export function computeContentHashSha256(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}
