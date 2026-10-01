import { Schema, model, Document, Types } from 'mongoose';

export interface IFile extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  folderId: Types.ObjectId | null;

  name: string; // encrypted metadata could go further; kept plain here for search/sort, hardened at rest via disk-level encryption
  storageKey: string; // object storage key of the ciphertext blob
  sizeBytesEncrypted: number;
  mimeTypeDeclared: string; // browser-declared MIME; never trusted alone (see upload validation middleware)

  // Envelope encryption metadata (client-generated, server-opaque):
  wrappedFileKey: string; // file's unique AES key, wrapped under the owner's KEM/public-key material
  encryptionAlgorithm: 'AES-256-GCM';
  iv: string; // base64
  authTag: string; // base64

  contentHashSha256: string; // for integrity verification / blockchain notarization
  currentVersion: number;

  isTrashed: boolean;
  trashedAt?: Date;

  // Time / geo lock policies (enforced server-side in access control, see zeroTrust middleware)
  availableAfter?: Date;
  expireAfter?: Date;
  allowedCountries?: string[];

  createdAt: Date;
  updatedAt: Date;
}

const fileSchema = new Schema<IFile>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    folderId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null, index: true },

    name: { type: String, required: true },
    storageKey: { type: String, required: true, unique: true },
    sizeBytesEncrypted: { type: Number, required: true },
    mimeTypeDeclared: { type: String, required: true },

    wrappedFileKey: { type: String, required: true },
    encryptionAlgorithm: { type: String, enum: ['AES-256-GCM'], default: 'AES-256-GCM' },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },

    contentHashSha256: { type: String, required: true, index: true },
    currentVersion: { type: Number, default: 1 },

    isTrashed: { type: Boolean, default: false, index: true },
    trashedAt: { type: Date },

    availableAfter: { type: Date },
    expireAfter: { type: Date },
    allowedCountries: [{ type: String }],
  },
  { timestamps: true },
);

fileSchema.index({ ownerId: 1, folderId: 1, isTrashed: 1 });
fileSchema.index({ ownerId: 1, name: 'text' });

export const FileModel = model<IFile>('File', fileSchema);
