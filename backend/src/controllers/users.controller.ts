import { Request, Response } from 'express';
import { z } from 'zod';
import { User } from '../models/User';

const lookupSchema = z.object({ email: z.string().email() });

/**
 * Returns only public information (id, display name, PQC PUBLIC keys) —
 * never anything that could be used to impersonate or compromise the
 * looked-up user. This exists specifically so a room inviter can wrap a
 * room key for the invitee's ML-KEM public key client-side.
 */
export async function lookupUserByEmail(req: Request, res: Response): Promise<void> {
  const parsed = lookupSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  const user = await User.findOne({ email: parsed.data.email, isActive: true });
  if (!user || !user.kemPublicKey) {
    res.status(404).json({ error: 'USER_NOT_FOUND_OR_NO_PUBLIC_KEY' });
    return;
  }

  res.json({
    userId: user._id.toString(),
    displayName: user.displayName,
    kemPublicKey: user.kemPublicKey,
    dsaPublicKey: user.dsaPublicKey,
  });
}
