import { Schema, model, Document, Types } from 'mongoose';

export interface ISecuritySettings extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;

  // QuantumGuard toggles — each one independently on/off, per spec's
  // "users can enable/disable supported features."
  suspiciousLoginDetection: boolean;
  impossibleTravelDetection: boolean;
  newDeviceAlerts: boolean;
  massDownloadDetection: boolean;
  suspiciousSharingDetection: boolean;

  /**
   * Threshold knobs the AI Co-Pilot's heuristics read at evaluation time,
   * rather than hard-coding magic numbers into the detection logic. Lets
   * an admin/future UI tune sensitivity without a code change.
   */
  massDownloadThreshold: number; // downloads within the window that trigger a flag
  massDownloadWindowMinutes: number;
  impossibleTravelMaxKmPerHour: number; // implied travel speed above which two logins are "impossible"

  updatedAt: Date;
}

const securitySettingsSchema = new Schema<ISecuritySettings>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },

    suspiciousLoginDetection: { type: Boolean, default: true },
    impossibleTravelDetection: { type: Boolean, default: true },
    newDeviceAlerts: { type: Boolean, default: true },
    massDownloadDetection: { type: Boolean, default: true },
    suspiciousSharingDetection: { type: Boolean, default: true },

    massDownloadThreshold: { type: Number, default: 20 },
    massDownloadWindowMinutes: { type: Number, default: 10 },
    impossibleTravelMaxKmPerHour: { type: Number, default: 900 }, // ~ commercial flight speed
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export const SecuritySettings = model<ISecuritySettings>('SecuritySettings', securitySettingsSchema);

export async function getOrCreateSecuritySettings(userId: string) {
  const existing = await SecuritySettings.findOne({ userId });
  if (existing) return existing;
  return SecuritySettings.create({ userId });
}
