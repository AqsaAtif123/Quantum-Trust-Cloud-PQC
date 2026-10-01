import { Schema, model, Document, Types } from 'mongoose';

export interface IRoomMessage extends Document {
  _id: Types.ObjectId;
  roomId: Types.ObjectId;
  senderId: Types.ObjectId;

  ciphertext: string; // base64, AES-256-GCM encrypted client-side under the room key
  iv: string; // base64
  authTag: string; // base64
  keyEpoch: number; // which epoch's room key this was encrypted under

  hasAttachment: boolean;
  attachmentFileId?: Types.ObjectId; // references an already-encrypted File document

  createdAt: Date;
}

const roomMessageSchema = new Schema<IRoomMessage>(
  {
    roomId: { type: Schema.Types.ObjectId, ref: 'CollaborationRoom', required: true, index: true },
    senderId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    ciphertext: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    keyEpoch: { type: Number, required: true },
    hasAttachment: { type: Boolean, default: false },
    attachmentFileId: { type: Schema.Types.ObjectId, ref: 'File' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

roomMessageSchema.index({ roomId: 1, createdAt: -1 });

export const RoomMessage = model<IRoomMessage>('RoomMessage', roomMessageSchema);
