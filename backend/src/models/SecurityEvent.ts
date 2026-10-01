import { Schema, model, Document, Types } from 'mongoose';

export type SecurityEventType =
  | 'login_success'
  | 'login_failure'
  | 'mfa_challenge'
  | 'new_device'
  | 'impossible_travel'
  | 'suspicious_download'
  | 'mass_file_access'
  | 'suspicious_sharing'
  | 'permission_change'
  | 'policy_change';

export type ThreatLevel = 'info' | 'low' | 'medium' | 'high' | 'critical';

export interface ISecurityEvent extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: SecurityEventType;
  threatLevel: ThreatLevel;
  reason: string;
  evidence: Record<string, unknown>;
  recommendation?: string;
  confidence: number; // 0-1
  ipAddress?: string;
  deviceId?: Types.ObjectId;
  acknowledged: boolean;
  createdAt: Date;
}

const securityEventSchema = new Schema<ISecurityEvent>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    threatLevel: { type: String, enum: ['info', 'low', 'medium', 'high', 'critical'], default: 'info' },
    reason: { type: String, required: true },
    evidence: { type: Schema.Types.Mixed, default: {} },
    recommendation: { type: String },
    confidence: { type: Number, min: 0, max: 1, default: 0.5 },
    ipAddress: { type: String },
    deviceId: { type: Schema.Types.ObjectId, ref: 'Device' },
    acknowledged: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

securityEventSchema.index({ userId: 1, createdAt: -1 });
securityEventSchema.index({ threatLevel: 1, createdAt: -1 });

export const SecurityEvent = model<ISecurityEvent>('SecurityEvent', securityEventSchema);
