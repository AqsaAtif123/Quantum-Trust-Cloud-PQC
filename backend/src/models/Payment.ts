import { Schema, model, Document, Types } from 'mongoose';

export type PaymentProviderName = 'stablecoin' | 'local_banking';
export type PaymentStatus = 'pending' | 'confirmed' | 'failed' | 'expired' | 'refunded';

export interface IPayment extends Document {
  _id: Types.ObjectId;
  ownerId: Types.ObjectId;
  provider: PaymentProviderName;
  status: PaymentStatus;

  amount: string; // decimal string, never a float, to avoid rounding errors
  currency: string; // e.g. 'USDC', 'PKR'
  referenceId: string; // unique reference the payer includes to identify this specific payment

  // Stablecoin-specific verification fields — only meaningful once the
  // payer has actually broadcast a transaction and submitted its hash.
  depositAddress?: string;
  claimedTxHash?: string;
  confirmedTxHash?: string;
  chainConfirmations?: number;

  description: string;
  relatedResourceType?: string; // e.g. 'notarization', 'subscription'
  relatedResourceId?: string;

  expiresAt: Date;
  confirmedAt?: Date;
  failureReason?: string;

  createdAt: Date;
  updatedAt: Date;
}

const paymentSchema = new Schema<IPayment>(
  {
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    provider: { type: String, enum: ['stablecoin', 'local_banking'], required: true },
    status: { type: String, enum: ['pending', 'confirmed', 'failed', 'expired', 'refunded'], default: 'pending', index: true },

    amount: { type: String, required: true },
    currency: { type: String, required: true },
    referenceId: { type: String, required: true, unique: true },

    depositAddress: { type: String },
    claimedTxHash: { type: String },
    confirmedTxHash: { type: String },
    chainConfirmations: { type: Number },

    description: { type: String, required: true },
    relatedResourceType: { type: String },
    relatedResourceId: { type: String },

    expiresAt: { type: Date, required: true },
    confirmedAt: { type: Date },
    failureReason: { type: String },
  },
  { timestamps: true },
);

paymentSchema.index({ ownerId: 1, createdAt: -1 });
paymentSchema.index({ confirmedTxHash: 1 }, { unique: true, sparse: true }); // a confirmed on-chain tx can only ever settle ONE payment — prevents replay

export const Payment = model<IPayment>('Payment', paymentSchema);
