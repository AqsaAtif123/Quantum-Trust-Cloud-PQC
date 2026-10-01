import { Schema, model, Document, Types } from 'mongoose';

export interface IFileShareKey extends Document {
  _id: Types.ObjectId;
  fileId: Types.ObjectId;
  granteeUserId: Types.ObjectId;

  /**
   * The file's AES key, ML-KEM-wrapped specifically for this grantee's
   * public key — generated entirely client-side by whoever shared the
   * file (they must already hold the unwrapped file key to do this). The
   * server stores it opaquely and never has access to the unwrapped key.
   * This is separate from File.wrappedFileKey, which is wrapped only for
   * the owner — sharing requires a distinct wrapped copy per recipient
   * because ML-KEM wrapping is recipient-specific, not broadcastable.
   */
  wrappedFileKey: string;

  grantedByUserId: Types.ObjectId;
  createdAt: Date;
}

const fileShareKeySchema = new Schema<IFileShareKey>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true, index: true },
    granteeUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    wrappedFileKey: { type: String, required: true },
    grantedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

fileShareKeySchema.index({ fileId: 1, granteeUserId: 1 }, { unique: true });

export const FileShareKey = model<IFileShareKey>('FileShareKey', fileShareKeySchema);
