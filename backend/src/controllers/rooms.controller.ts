import { Request, Response } from 'express';
import { z } from 'zod';
import { CollaborationRoom } from '../models/CollaborationRoom';
import { RoomMembership, RoomRole } from '../models/RoomMembership';
import { RoomMessage } from '../models/RoomMessage';
import { SecurityEvent } from '../models/SecurityEvent';
import { getIO } from '../services/realtime/io';
import { recordAccessAndCheckSuspiciousSharing } from '../services/aiCoPilot';
import { logger } from '../utils/logger';

const createRoomSchema = z.object({
  name: z.string().min(1).max(120),
  folderId: z.string().nullable().optional(),
  ownerWrappedRoomKey: z.string().min(1), // room key wrapped for the creator's own KEM public key
});

export async function createRoom(req: Request, res: Response): Promise<void> {
  const parsed = createRoomSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  const room = await CollaborationRoom.create({
    name: parsed.data.name,
    ownerId: req.ztx!.userId,
    folderId: parsed.data.folderId ?? null,
    currentKeyEpoch: 1,
  });

  await RoomMembership.create({
    roomId: room._id,
    userId: req.ztx!.userId,
    role: 'owner' as RoomRole,
    wrappedRoomKey: parsed.data.ownerWrappedRoomKey,
    keyEpoch: 1,
    invitedByUserId: req.ztx!.userId,
  });

  res.status(201).json({ room });
}

export async function listMyRooms(req: Request, res: Response): Promise<void> {
  const memberships = await RoomMembership.find({ userId: req.ztx!.userId, isActive: true }).populate('roomId');
  const rooms = memberships
    .map((m) => m.roomId)
    .filter((room: any) => room && room.isActive);
  res.json({ rooms });
}

/** Returns the caller's own wrapped room key for the room's current epoch — never anyone else's. */
export async function getMyRoomKey(req: Request, res: Response): Promise<void> {
  const membership = (req as any).membership as InstanceType<typeof RoomMembership>;
  res.json({ wrappedRoomKey: membership.wrappedRoomKey, keyEpoch: membership.keyEpoch });
}

export async function listMembers(req: Request, res: Response): Promise<void> {
  const room = (req as any).room as InstanceType<typeof CollaborationRoom>;
  const members = await RoomMembership.find({ roomId: room._id, isActive: true })
    .select('userId role joinedAt')
    .populate('userId', 'displayName email');
  res.json({ members });
}

const inviteSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(['admin', 'editor', 'contributor', 'viewer']),
  wrappedRoomKey: z.string().min(1), // room key wrapped for the invitee's KEM public key, at the CURRENT epoch
});

export async function inviteMember(req: Request, res: Response): Promise<void> {
  const room = (req as any).room as InstanceType<typeof CollaborationRoom>;
  const parsed = inviteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  const existing = await RoomMembership.findOne({ roomId: room._id, userId: parsed.data.userId });
  if (existing?.isActive) {
    res.status(409).json({ error: 'ALREADY_A_MEMBER' });
    return;
  }

  const membership = existing
    ? await RoomMembership.findOneAndUpdate(
        { _id: existing._id },
        {
          isActive: true,
          role: parsed.data.role,
          wrappedRoomKey: parsed.data.wrappedRoomKey,
          keyEpoch: room.currentKeyEpoch,
          removedAt: undefined,
        },
        { new: true },
      )
    : await RoomMembership.create({
        roomId: room._id,
        userId: parsed.data.userId,
        role: parsed.data.role,
        wrappedRoomKey: parsed.data.wrappedRoomKey,
        keyEpoch: room.currentKeyEpoch,
        invitedByUserId: req.ztx!.userId,
      });

  getIO()?.to(`room:${room._id.toString()}`).emit('room:member_joined', {
    roomId: room._id.toString(),
    userId: parsed.data.userId,
    role: parsed.data.role,
  });

  recordAccessAndCheckSuspiciousSharing(req.ztx!.userId, req.ip ?? 'unknown', room._id.toString()).catch((err) => {
    logger.error({ err }, 'recordAccessAndCheckSuspiciousSharing failed');
  });

  res.status(201).json({ membership });
}

/**
 * Removing a member bumps the room's key epoch immediately, which makes
 * every remaining member's *stored* wrapped key stale. The client that
 * initiates this call is responsible for immediately following up with
 * POST /rooms/:id/rekey once it has generated a new room key and wrapped
 * it for every still-active member — see rekey() below. Until that
 * completes, the room is left in a "needs rekey" state where new messages
 * cannot be posted (see postMessage's epoch check).
 */
export async function removeMember(req: Request, res: Response): Promise<void> {
  const room = (req as any).room as InstanceType<typeof CollaborationRoom>;
  const targetUserId = req.params.userId;

  const target = await RoomMembership.findOne({ roomId: room._id, userId: targetUserId, isActive: true });
  if (!target) {
    res.status(404).json({ error: 'MEMBER_NOT_FOUND' });
    return;
  }
  if (target.role === 'owner') {
    res.status(400).json({ error: 'CANNOT_REMOVE_OWNER' });
    return;
  }

  target.isActive = false;
  target.removedAt = new Date();
  await target.save();

  room.currentKeyEpoch += 1;
  await room.save();

  await SecurityEvent.create({
    userId: req.ztx!.userId,
    type: 'permission_change',
    threatLevel: 'info',
    reason: 'Room member removed; key epoch rotated for forward secrecy',
    evidence: { roomId: room._id.toString(), removedUserId: targetUserId, newEpoch: room.currentKeyEpoch },
    confidence: 1,
  });

  getIO()?.to(`room:${room._id.toString()}`).emit('room:member_removed', {
    roomId: room._id.toString(),
    userId: targetUserId,
    newEpoch: room.currentKeyEpoch,
  });

  res.json({ ok: true, newEpoch: room.currentKeyEpoch, rekeyRequired: true });
}

const rekeySchema = z.object({
  epoch: z.number().int().positive(),
  memberKeys: z.array(z.object({ userId: z.string().min(1), wrappedRoomKey: z.string().min(1) })).min(1),
});

export async function rekey(req: Request, res: Response): Promise<void> {
  const room = (req as any).room as InstanceType<typeof CollaborationRoom>;
  const parsed = rekeySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }
  if (parsed.data.epoch !== room.currentKeyEpoch) {
    res.status(409).json({ error: 'EPOCH_MISMATCH', currentEpoch: room.currentKeyEpoch });
    return;
  }

  const activeMembers = await RoomMembership.find({ roomId: room._id, isActive: true });
  const activeUserIds = new Set(activeMembers.map((m) => m.userId.toString()));
  const providedUserIds = new Set(parsed.data.memberKeys.map((m) => m.userId));

  const missing = [...activeUserIds].filter((id) => !providedUserIds.has(id));
  if (missing.length > 0) {
    res.status(400).json({ error: 'REKEY_INCOMPLETE', missingUserIds: missing });
    return;
  }

  await Promise.all(
    parsed.data.memberKeys.map((mk) =>
      RoomMembership.updateOne(
        { roomId: room._id, userId: mk.userId, isActive: true },
        { wrappedRoomKey: mk.wrappedRoomKey, keyEpoch: parsed.data.epoch },
      ),
    ),
  );

  getIO()?.to(`room:${room._id.toString()}`).emit('room:rekeyed', { roomId: room._id.toString(), epoch: parsed.data.epoch });

  res.json({ ok: true });
}

const postMessageSchema = z.object({
  ciphertext: z.string().min(1),
  iv: z.string().min(1),
  authTag: z.string().min(1),
  keyEpoch: z.number().int().positive(),
});

export async function postMessage(req: Request, res: Response): Promise<void> {
  const room = (req as any).room as InstanceType<typeof CollaborationRoom>;
  const parsed = postMessageSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'VALIDATION_ERROR' });
    return;
  }

  if (parsed.data.keyEpoch !== room.currentKeyEpoch) {
    // The client is encrypting under a stale key — most likely a rekey
    // happened after they last synced. Reject rather than accept a
    // message under a dead epoch.
    res.status(409).json({ error: 'STALE_KEY_EPOCH', currentEpoch: room.currentKeyEpoch });
    return;
  }

  const message = await RoomMessage.create({
    roomId: room._id,
    senderId: req.ztx!.userId,
    ciphertext: parsed.data.ciphertext,
    iv: parsed.data.iv,
    authTag: parsed.data.authTag,
    keyEpoch: parsed.data.keyEpoch,
  });

  getIO()?.to(`room:${room._id.toString()}`).emit('room:message', {
    roomId: room._id.toString(),
    messageId: message._id.toString(),
    senderId: req.ztx!.userId,
    ciphertext: message.ciphertext,
    iv: message.iv,
    authTag: message.authTag,
    keyEpoch: message.keyEpoch,
    createdAt: message.createdAt,
  });

  res.status(201).json({ message });
}

export async function listMessages(req: Request, res: Response): Promise<void> {
  const room = (req as any).room as InstanceType<typeof CollaborationRoom>;
  const before = req.query.before ? new Date(req.query.before as string) : new Date();
  const limit = Math.min(Number(req.query.limit) || 50, 100);

  const messages = await RoomMessage.find({ roomId: room._id, createdAt: { $lt: before } })
    .sort({ createdAt: -1 })
    .limit(limit);

  res.json({ messages: messages.reverse() });
}
