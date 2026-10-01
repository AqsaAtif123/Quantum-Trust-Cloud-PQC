import { Schema, model, Document, Types } from 'mongoose';

export interface ICollaborationRoom extends Document {
  _id: Types.ObjectId;
  name: string;
  ownerId: Types.ObjectId;
  folderId?: Types.ObjectId | null;
  isActive: boolean;

  /**
   * The room's symmetric message-encryption key is never stored here in
   * any recoverable form — only a monotonically increasing epoch number.
   * Each RoomMembership row holds that member's own wrapped copy of the
   * *current* epoch's key (see RoomMembership.ts). Incrementing the epoch
   * on every membership removal is what gives this forward secrecy: a
   * removed member's old wrapped key is for a dead epoch and is deleted,
   * so they cannot decrypt messages sent after their removal, and — since
   * the key changes — cannot decrypt future messages even if they somehow
   * retained old ciphertext.
   */
  currentKeyEpoch: number;

  createdAt: Date;
  updatedAt: Date;
}

const collaborationRoomSchema = new Schema<ICollaborationRoom>(
  {
    name: { type: String, required: true, trim: true },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    folderId: { type: Schema.Types.ObjectId, ref: 'Folder', default: null },
    isActive: { type: Boolean, default: true },
    currentKeyEpoch: { type: Number, default: 1 },
  },
  { timestamps: true },
);

export const CollaborationRoom = model<ICollaborationRoom>('CollaborationRoom', collaborationRoomSchema);
