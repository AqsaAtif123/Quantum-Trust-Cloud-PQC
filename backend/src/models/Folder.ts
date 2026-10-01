import { Schema, model, Document, Types } from 'mongoose';

export interface IFolder extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  parentId: Types.ObjectId | null;
  name: string;
  isTrashed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const folderSchema = new Schema<IFolder>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    parentId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null, index: true },
    name: { type: String, required: true },
    isTrashed: { type: Boolean, default: false },
  },
  { timestamps: true },
);

folderSchema.index({ ownerId: 1, parentId: 1 });

export const Folder = model<IFolder>('Folder', folderSchema);
