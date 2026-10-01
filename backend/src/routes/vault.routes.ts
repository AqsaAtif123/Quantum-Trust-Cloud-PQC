import { Router } from 'express';
import { requireAuth, requireResourceAccess } from '../middleware/zeroTrust';
import { VaultDocument } from '../models/VaultDocument';
import * as vaultController from '../controllers/vault.controller';

const router = Router();

// Public: certificate verification must be checkable by anyone holding a
// certificate ID (e.g. scanned from a QR code), not just the document
// owner — this is intentionally BEFORE requireAuth.
router.get('/certificates/:certificateId/verify', vaultController.verifyCertificate);

router.use(requireAuth);

router.post('/upload-url', vaultController.requestVaultUploadUrl);
router.post('/confirm-upload', vaultController.confirmVaultUpload);
router.get('/', vaultController.listVaultDocuments);

const loadDoc = (id: string) => VaultDocument.findOne({ _id: id, isTrashed: false });

router.get('/:id/download-url', requireResourceAccess(loadDoc), vaultController.getVaultDownloadUrl);
router.post('/:id/trash', requireResourceAccess(loadDoc), vaultController.trashVaultDocument);
router.post('/:id/sign', requireResourceAccess(loadDoc), vaultController.signVaultDocument);
router.post('/:id/certificate', requireResourceAccess(loadDoc), vaultController.generateCertificate);

export default router;
