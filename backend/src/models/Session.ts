import { Schema, model, Document, Types } from 'mongoose';

export interface ISession extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  deviceId: Types.ObjectId;
  refreshTokenHash: string; // hash of refresh token, never the raw token
  ipAddress: string;
  userAgent: string;
  isRevoked: boolean;
  revokedReason?: string;
  expiresAt: Date;
  lastSeenAt: Date;
  createdAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device', required: true },
    refreshTokenHash: { type: String, required: true, select: false },
    ipAddress: { type: String, required: true },
    userAgent: { type: String, required: true },
    isRevoked: { type: Boolean, default: false, index: true },
    revokedReason: { type: String },
    expiresAt: { type: Date, required: true },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// TTL index: MongoDB will auto-purge sessions past expiry.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
sessionSchema.index({ userId: 1, isRevoked: 1 });

export const Session = model<ISession>('Session', sessionSchema);
