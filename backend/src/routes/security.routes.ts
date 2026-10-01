import { Router } from 'express';
import { requireAuth } from '../middleware/zeroTrust';
import * as securityController from '../controllers/security.controller';

const router = Router();

router.use(requireAuth);

router.get('/overview', securityController.getSecurityOverview);
router.get('/events', securityController.listAuditEvents);
router.get('/settings', securityController.getSecuritySettings);
router.patch('/settings', securityController.updateSecuritySettings);
router.post('/sessions/:sessionId/revoke', securityController.revokeSession);
router.post('/devices/:deviceId/block', securityController.blockDevice);
router.post('/events/:eventId/acknowledge', securityController.acknowledgeEvent);

export default router;
