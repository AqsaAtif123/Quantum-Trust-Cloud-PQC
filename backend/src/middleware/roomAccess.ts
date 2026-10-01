import { Request, Response, NextFunction } from 'express';
import { RoomMembership, RoomRole } from '../models/RoomMembership';
import { CollaborationRoom } from '../models/CollaborationRoom';

const ROLE_RANK: Record<RoomRole, number> = {
  viewer: 0,
  contributor: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Zero-trust check for collaboration rooms: verifies the caller is an
 * ACTIVE member of the room with at least `minRole`, using only server-side
 * state (RoomMembership). A removed member's row is inactive and this
 * always rejects them, even if they still hold a client-side reference to
 * an old room key.
 */
export function requireRoomRole(minRole: RoomRole) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const roomId = req.params.id;
    const room = await CollaborationRoom.findById(roomId);
    if (!room || !room.isActive) {
      res.status(404).json({ error: 'ROOM_NOT_FOUND' });
      return;
    }

    const membership = await RoomMembership.findOne({
      roomId,
      userId: req.ztx!.userId,
      isActive: true,
    });

    if (!membership || ROLE_RANK[membership.role] < ROLE_RANK[minRole]) {
      res.status(403).json({ error: 'INSUFFICIENT_ROOM_ROLE' });
      return;
    }

    (req as any).room = room;
    (req as any).membership = membership;
    next();
  };
}
