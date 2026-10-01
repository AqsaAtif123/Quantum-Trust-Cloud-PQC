import { Router } from 'express';
import { requireAuth, requireResourceAccess } from '../middleware/zeroTrust';
import { FileModel } from '../models/File';
import * as filesController from '../controllers/files.controller';

const router = Router();

router.use(requireAuth);

router.post('/upload-url', filesController.requestUploadUrl);
router.post('/confirm-upload', filesController.confirmUpload);
router.get('/', filesController.listFiles);

const loadFile = (id: string) => FileModel.findById(id);

router.get('/:id/download-url', requireResourceAccess(loadFile, ['viewer', 'contributor', 'editor', 'admin']), filesController.getDownloadUrl);
router.get('/:id/verify-chain', requireResourceAccess(loadFile, ['viewer', 'contributor', 'editor', 'admin']), filesController.verifyFileOnChain);
router.post('/:id/trash', requireResourceAccess(loadFile, ['editor', 'admin']), filesController.trashFile);
router.post('/:id/restore', requireResourceAccess(loadFile, ['editor', 'admin']), filesController.restoreFile);

router.get('/shared-with-me', filesController.listSharedWithMe);
router.get('/:id/shares', requireResourceAccess(loadFile, ['admin']), filesController.listFileShares);
router.post('/:id/share', requireResourceAccess(loadFile, ['admin']), filesController.shareFile);
router.delete('/:id/share/:userId', requireResourceAccess(loadFile, ['admin']), filesController.revokeFileShare);

export default router;
