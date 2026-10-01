import { Schema, model, Document, Types } from 'mongoose';

export interface IUser extends Document {
  _id: Types.ObjectId;
  email: string;
  passwordHash: string; // Argon2id hash, never plaintext
  displayName: string;
  role: 'user' | 'admin';

  mfaEnabled: boolean;
  mfaSecretEncrypted?: string; // TOTP secret, encrypted at rest (server-side AES-GCM)

  // PQC public keys only — secret keys never touch the server in plaintext.
  // The signing/encryption secret keys live client-side, wrapped by the
  // user's password-derived key and/or split via three-part key protection.
  kemPublicKey?: string; // base64 ML-KEM public key
  dsaPublicKey?: string; // base64 ML-DSA public key

  // Server's share (Share B) of the user's master-key Shamir split.
  // Encrypted at rest; alone it is cryptographically useless (2-of-3 threshold).
  keyShareBEncrypted?: string;

  securityScore: number;
  isActive: boolean;
  lastLoginAt?: Date;
  lastLoginIp?: string;

  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    passwordHash: { type: String, required: true, select: false },
    displayName: { type: String, required: true, trim: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user' },

    mfaEnabled: { type: Boolean, default: false },
    mfaSecretEncrypted: { type: String, select: false },

    kemPublicKey: { type: String },
    dsaPublicKey: { type: String },

    keyShareBEncrypted: { type: String, select: false },

    securityScore: { type: Number, default: 40, min: 0, max: 100 },
    isActive: { type: Boolean, default: true },
    lastLoginAt: { type: Date },
    lastLoginIp: { type: String },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true });

export const User = model<IUser>('User', userSchema);
