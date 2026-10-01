import { Router } from 'express';
import { requireAuth } from '../middleware/zeroTrust';
import { requireRoomRole } from '../middleware/roomAccess';
import * as roomsController from '../controllers/rooms.controller';

const router = Router();

router.use(requireAuth);

router.post('/', roomsController.createRoom);
router.get('/', roomsController.listMyRooms);

router.get('/:id/my-key', requireRoomRole('viewer'), roomsController.getMyRoomKey);
router.get('/:id/members', requireRoomRole('viewer'), roomsController.listMembers);
router.post('/:id/invite', requireRoomRole('admin'), roomsController.inviteMember);
router.delete('/:id/members/:userId', requireRoomRole('admin'), roomsController.removeMember);
router.post('/:id/rekey', requireRoomRole('admin'), roomsController.rekey);

router.get('/:id/messages', requireRoomRole('viewer'), roomsController.listMessages);
router.post('/:id/messages', requireRoomRole('contributor'), roomsController.postMessage);

export default router;
