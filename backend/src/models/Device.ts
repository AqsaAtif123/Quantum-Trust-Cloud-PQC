import { Schema, model, Document, Types } from 'mongoose';

export interface IDevice extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  fingerprint: string; // derived client-side (not a source of truth on its own)
  label: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  lastIp: string;
  lastCountry?: string;
  isTrusted: boolean;
  isBlocked: boolean;
}

const deviceSchema = new Schema<IDevice>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    fingerprint: { type: String, required: true },
    label: { type: String, default: 'Unknown device' },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    lastIp: { type: String, required: true },
    lastCountry: { type: String },
    isTrusted: { type: Boolean, default: false },
    isBlocked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

deviceSchema.index({ userId: 1, fingerprint: 1 }, { unique: true });

export const Device = model<IDevice>('Device', deviceSchema);
