import { Schema, model, Document, Types } from 'mongoose';

export type RoomRole = 'owner' | 'admin' | 'editor' | 'contributor' | 'viewer';

export interface IRoomMembership extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  userId: Types.ObjectId;
  role: RoomRole;

  /**
   * The room's AES-256-GCM message key, ML-KEM-wrapped specifically for
   * this member's public key, for the CURRENT key epoch only. Generated
   * and wrapped entirely client-side (see frontend room encryption
   * module) — the server only stores and relays this opaque blob.
   */
  wrappedRoomKey: string;
  keyEpoch: number;

  invitedByUserId: Types.ObjectId;
  joinedAt: Date;
  removedAt?: Date;
  isActive: boolean;
}

const roomMembershipSchema = new Schema<IRoomMembership>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'CollaborationRoom', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['owner', 'admin', 'editor', 'contributor', 'viewer'], required: true },
    wrappedRoomKey: { type: String, required: true },
    keyEpoch: { type: Number, required: true },
    invitedByUserId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
    removedAt: { type: Date },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: false },
);

roomMembershipSchema.index({ roomId: 1, userId: 1 }, { unique: true });
roomMembershipSchema.index({ roomId: 1, isActive: 1 });

export const RoomMembership = model<IRoomMembership>('RoomMembership', roomMembershipSchema);
