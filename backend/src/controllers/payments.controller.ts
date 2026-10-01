import { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { z } from 'zod';
import { keccak256, toUtf8Bytes } from 'ethers';
import { Payment, PaymentProviderName } from '../models/Payment';
import { getPaymentProvider, listAvailableProviders } from '../services/payments';
import { recordPaymentReferenceOnChain, isBlockchainAuditEnabled } from '../services/blockchainService';
import { Notification } from '../models/Notification';
import { getIO } from '../services/realtime/io';
import { logger } from '../utils/logger';

const PAYMENT_EXPIRY_MINUTES = 30;

export async function listProviders(_req: Request, res: Response): Promise<void> {
  res.json({ providers: listAvailableProviders() });
}

const createPaymentSchema = z.object({
  provider: z.enum(['stablecoin', 'local_banking']).default('stablecoin'), // stablecoin is QuantumPay's default global option, per spec
  amount: z.string().regex(/^\d+(\.\d{1,8})?$/, 'Amount must be a plain decimal string'),
  currency: z.string().min(1).max(10),
  description: z.string().min(1).max(200),
  relatedResourceType: z.string().optional(),
  relatedResourceId: z.string().optional(),
});

export async function createPayment(req: Request, res: Response): Promise<void> {
  const parsed = createPaymentSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
    return;
  }

  const referenceId = `qtp_${uuid()}`;
  const provider = getPaymentProvider(parsed.data.provider as PaymentProviderName);
  const result = await provider.createPayment({
    amount: parsed.data.amount,
    currency: parsed.data.currency,
    referenceId,
  });

  const payment = await Payment.create({
    ownerId: req.ztx!.userId,
    provider: parsed.data.provider,
    status: 'pending',
    amount: parsed.data.amount,
    currency: parsed.data.currency,
    referenceId,
    depositAddress: result.depositAddress,
    description: parsed.data.description,
    relatedResourceType: parsed.data.relatedResourceType,
    relatedResourceId: parsed.data.relatedResourceId,
    expiresAt: new Date(Date.now() + PAYMENT_EXPIRY_MINUTES * 60 * 1000),
  });

  res.status(201).json({
    payment: serializePayment(payment),
    providerReady: result.providerReady,
    instructions: result.instructions,
  });
}

function serializePayment(p: InstanceType<typeof Payment>) {
  return {
    id: p._id.toString(),
    provider: p.provider,
    status: p.status,
    amount: p.amount,
    currency: p.currency,
    referenceId: p.referenceId,
    depositAddress: p.depositAddress,
    claimedTxHash: p.claimedTxHash,
    confirmedTxHash: p.confirmedTxHash,
    chainConfirmations: p.chainConfirmations,
    description: p.description,
    expiresAt: p.expiresAt,
    confirmedAt: p.confirmedAt,
    failureReason: p.failureReason,
    createdAt: p.createdAt,
  };
}

export async function listMyPayments(req: Request, res: Response): Promise<void> {
  const payments = await Payment.find({ ownerId: req.ztx!.userId }).sort({ createdAt: -1 });
  res.json({ payments: payments.map(serializePayment) });
}

export async function getPayment(req: Request, res: Response): Promise<void> {
  const payment = (req as any).resource as InstanceType<typeof Payment>;
  res.json({ payment: serializePayment(payment) });
}

const submitTxSchema = z.object({ txHash: z.string().min(1) });

/**
 * Records the transaction hash the payer CLAIMS to have sent. This alone
 * does NOT mark the payment confirmed — it only stores the claim so that
 * verifyPayment (below) has something to check against the real chain
 * state. A payment never becomes "confirmed" just because this endpoint
 * was called.
 */
export async function submitTransaction(req: Request, res: Response): Promise<void> {
  const payment = (req as any).resource as InstanceType<typeof Payment>;
  const parsed = submitTxSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  if (payment.status !== 'pending') {
    res.status(409).json({ error: 'PAYMENT_NOT_PENDING', status: payment.status });
    return;
  }
  if (payment.expiresAt.getTime() < Date.now()) {
    payment.status = 'expired';
    await payment.save();
    res.status(410).json({ error: 'PAYMENT_EXPIRED' });
    return;
  }

  payment.claimedTxHash = parsed.data.txHash;
  await payment.save();

  res.json({ ok: true, message: 'Transaction recorded. Call verify to check its on-chain status.' });
}

/**
 * The ONLY path that can mark a payment confirmed — and it does so by
 * asking the actual payment provider to check real chain/gateway state,
 * never by trusting anything the client asserts.
 */
export async function verifyPayment(req: Request, res: Response): Promise<void> {
  const payment = (req as any).resource as InstanceType<typeof Payment>;

  if (payment.status === 'confirmed') {
    res.json({ payment: serializePayment(payment) });
    return;
  }
  if (payment.expiresAt.getTime() < Date.now() && payment.status === 'pending') {
    payment.status = 'expired';
    await payment.save();
    res.status(410).json({ error: 'PAYMENT_EXPIRED' });
    return;
  }

  const provider = getPaymentProvider(payment.provider);
  const result = await provider.verifyPayment({
    referenceId: payment.referenceId,
    claimedTxHash: payment.claimedTxHash,
    depositAddress: payment.depositAddress,
    amount: payment.amount,
  });

  payment.chainConfirmations = result.confirmations;

  if (result.confirmed) {
    // The unique sparse index on confirmedTxHash means a duplicate
    // transaction hash used for a second payment will throw here rather
    // than silently double-confirm — replay protection at the database
    // level, not just application logic.
    try {
      payment.status = 'confirmed';
      payment.confirmedTxHash = payment.claimedTxHash;
      payment.confirmedAt = new Date();
      await payment.save();
    } catch (err: any) {
      if (err?.code === 11000) {
        res.status(409).json({ error: 'TRANSACTION_ALREADY_USED_FOR_ANOTHER_PAYMENT' });
        return;
      }
      throw err;
    }

    if (isBlockchainAuditEnabled()) {
      // A real content hash of the payment's identifying data — NOT a
      // truncated hex encoding of the raw referenceId, which would
      // silently discard information for any referenceId over 32 bytes
      // and wouldn't actually reflect the amount/currency at all.
      const referenceHash = keccak256(
        toUtf8Bytes(`${payment.referenceId}:${payment.amount}:${payment.currency}`),
      );
      recordPaymentReferenceOnChain(payment._id.toString(), referenceHash).catch((err) => {
        logger.error({ err, paymentId: payment._id.toString() }, 'On-chain payment reference recording failed');
      });
    }

    await Notification.create({
      userId: payment.ownerId,
      type: 'payment_status',
      title: 'Payment confirmed',
      message: `Your payment of ${payment.amount} ${payment.currency} has been confirmed.`,
      relatedId: payment._id.toString(),
    });
    getIO()?.to(`user:${payment.ownerId.toString()}`).emit('notification:new', {
      type: 'payment_status',
      title: 'Payment confirmed',
      relatedId: payment._id.toString(),
    });
  } else if (result.failureReason && result.failureReason !== 'INSUFFICIENT_CONFIRMATIONS') {
    payment.failureReason = result.failureReason;
    await payment.save();
  } else {
    await payment.save(); // persist updated confirmation count even while still pending
  }

  res.json({ payment: serializePayment(payment), verificationResult: result });
}
