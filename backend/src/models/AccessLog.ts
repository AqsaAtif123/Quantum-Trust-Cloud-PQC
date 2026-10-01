import { Schema, model, Document, Types } from 'mongoose';

export type AccessAction = 'download' | 'share_grant';

export interface IAccessLog extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  action: AccessAction;
  resourceId?: string;
  ipAddress: string;
  createdAt: Date;
}

const accessLogSchema = new Schema<IAccessLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    action: { type: String, enum: ['download', 'share_grant'], required: true },
    resourceId: { type: String },
    ipAddress: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

accessLogSchema.index({ userId: 1, action: 1, createdAt: -1 });
// Auto-expire after 30 days — this is a rolling behavioral signal for the
// AI Co-Pilot's heuristics, not a permanent audit trail (that's what
// SecurityEvent + the blockchain audit log are for).
accessLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 });

export const AccessLog = model<IAccessLog>('AccessLog', accessLogSchema);
