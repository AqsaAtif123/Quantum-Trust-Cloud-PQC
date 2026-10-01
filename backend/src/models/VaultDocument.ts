import { Schema, model, Document, Types } from 'mongoose';

export type VaultCategory =
  | 'cnic'
  | 'passport'
  | 'degree'
  | 'certificate'
  | 'license'
  | 'contract'
  | 'financial_document'
  | 'employment_document'
  | 'other';

export interface VaultSignature {
  signatureBase64: string; // ML-DSA-65 signature over the document's content hash
  dsaPublicKeyBase64: string; // the signer's public key, so the signature is self-describing for later verification
  signedByUserId: Types.ObjectId;
  signedAt: Date;
}

export interface VaultCertificate {
  certificateId: string; // uuid, used in the public verification URL / QR code
  documentHash: string; // sha256 hex — the exact value notarized
  issuedAt: Date;
  blockchainTxHash?: string; // set once/if the notarization transaction confirms
}

export interface IVaultDocument extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  category: VaultCategory;
  name: string;

  storageKey: string;
  sizeBytesEncrypted: number;
  mimeTypeDeclared: string;

  wrappedFileKey: string;
  iv: string;
  authTag: string;
  contentHashSha256: string;

  expiryDate?: Date;

  signature?: VaultSignature;
  certificate?: VaultCertificate;

  isTrashed: boolean;

  createdAt: Date;
  updatedAt: Date;
}

const vaultSignatureSchema = new Schema<VaultSignature>(
  {
    signatureBase64: { type: String, required: true },
    dsaPublicKeyBase64: { type: String, required: true },
    signedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    signedAt: { type: Date, required: true },
  },
  { _id: false },
);

const vaultCertificateSchema = new Schema<VaultCertificate>(
  {
    certificateId: { type: String, required: true },
    documentHash: { type: String, required: true },
    issuedAt: { type: Date, required: true },
    blockchainTxHash: { type: String },
  },
  { _id: false },
);

const vaultDocumentSchema = new Schema<IVaultDocument>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    category: {
      type: String,
      enum: ['cnic', 'passport', 'degree', 'certificate', 'license', 'contract', 'financial_document', 'employment_document', 'other'],
      required: true,
    },
    name: { type: String, required: true },

    storageKey: { type: String, required: true, unique: true },
    sizeBytesEncrypted: { type: Number, required: true },
    mimeTypeDeclared: { type: String, required: true },

    wrappedFileKey: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    contentHashSha256: { type: String, required: true },

    expiryDate: { type: Date },

    signature: { type: vaultSignatureSchema },
    certificate: { type: vaultCertificateSchema },

    isTrashed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

vaultDocumentSchema.index({ ownerId: 1, category: 1, isTrashed: 1 });
vaultDocumentSchema.index({ ownerId: 1, expiryDate: 1 });
vaultDocumentSchema.index({ 'certificate.certificateId': 1 });

export const VaultDocument = model<IVaultDocument>('VaultDocument', vaultDocumentSchema);

/**
 * Pure function so "Valid / Expiring Soon / Expired" is computed
 * identically everywhere it's displayed, and is never itself stored
 * (so it can't go stale relative to the actual expiryDate).
 */
export function computeVaultStatus(
  expiryDate?: Date | null,
  now: Date = new Date(),
): 'valid' | 'expiring_soon' | 'expired' | 'no_expiry' {
  if (!expiryDate) return 'no_expiry';
  const daysUntilExpiry = (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  if (daysUntilExpiry < 0) return 'expired';
  if (daysUntilExpiry <= 30) return 'expiring_soon';
  return 'valid';
}
