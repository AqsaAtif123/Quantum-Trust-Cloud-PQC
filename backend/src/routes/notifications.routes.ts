import { Router } from 'express';
import { requireAuth } from '../middleware/zeroTrust';
import * as notificationsController from '../controllers/notifications.controller';

const router = Router();

router.use(requireAuth);

router.get('/', notificationsController.listNotifications);
router.post('/:id/read', notificationsController.markRead);
router.post('/read-all', notificationsController.markAllRead);

export default router;
