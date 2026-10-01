import { Schema, model, Document, Types } from 'mongoose';

export type NotificationType =
  | 'vault_expiring_soon'
  | 'vault_expired'
  | 'suspicious_login'
  | 'new_device'
  | 'file_shared'
  | 'permission_changed'
  | 'signature_completed'
  | 'certificate_issued'
  | 'blockchain_confirmed'
  | 'payment_status'
  | 'security_threat';

export interface INotification extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  message: string;
  relatedId?: string; // e.g. a VaultDocument id, kept as a string since it can reference different collections
  isRead: boolean;
  createdAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    relatedId: { type: String },
    isRead: { type: Boolean, default: false },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export const Notification = model<INotification>('Notification', notificationSchema);
