import { Router } from 'express';
import { requireAuth } from '../middleware/zeroTrust.js';
import * as foldersController from '../controllers/folders.controller.js';

const router = Router();

router.use(requireAuth);

router.post('/', foldersController.createFolder);
router.get('/', foldersController.listFolders);
router.get('/:id/path', foldersController.getFolderPath);
router.patch('/:id', foldersController.renameFolder);
router.post('/:id/trash', foldersController.trashFolder);

export default router;
