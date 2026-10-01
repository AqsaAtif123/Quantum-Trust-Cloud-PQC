import { Request, Response } from 'express';
import { Notification } from '../models/Notification';

export async function listNotifications(req: Request, res: Response): Promise<void> {
  const unreadOnly = req.query.unreadOnly === 'true';
  const query: Record<string, unknown> = { userId: req.ztx!.userId };
  if (unreadOnly) query.isRead = false;

  const notifications = await Notification.find(query).sort({ createdAt: -1 }).limit(100);
  const unreadCount = await Notification.countDocuments({ userId: req.ztx!.userId, isRead: false });

  res.json({ notifications, unreadCount });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  const notification = await Notification.findOneAndUpdate(
    { _id: req.params.id, userId: req.ztx!.userId },
    { isRead: true },
    { new: true },
  );
  if (!notification) {
    res.status(404).json({ error: 'NOTIFICATION_NOT_FOUND' });
    return;
  }
  res.json({ ok: true });
}

export async function markAllRead(req: Request, res: Response): Promise<void> {
  await Notification.updateMany({ userId: req.ztx!.userId, isRead: false }, { isRead: true });
  res.json({ ok: true });
}
