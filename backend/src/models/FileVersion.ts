import { Schema, model, Document, Types } from 'mongoose';

export interface IFileVersion extends Document {
  _id: Types.ObjectId;
  fileId: Types.ObjectId;
  versionNumber: number;
  storageKey: string;
  contentHashSha256: string;
  wrappedFileKey: string;
  iv: string;
  authTag: string;
  createdByUserId: Types.ObjectId;
  createdAt: Date;
}

const fileVersionSchema = new Schema<IFileVersion>(
  {
    fileId: { type: Schema.Types.ObjectId, ref: 'File', required: true, index: true },
    versionNumber: { type: Number, required: true },
    storageKey: { type: String, required: true },
    contentHashSha256: { type: String, required: true },
    wrappedFileKey: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    createdByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

fileVersionSchema.index({ fileId: 1, versionNumber: -1 }, { unique: true });

export const FileVersion = model<IFileVersion>('FileVersion', fileVersionSchema);
