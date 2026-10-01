import { Router } from 'express';
import { requireAuth, requireResourceAccess } from '../middleware/zeroTrust';
import { Payment } from '../models/Payment';
import * as paymentsController from '../controllers/payments.controller';

const router = Router();

router.use(requireAuth);

router.get('/providers', paymentsController.listProviders);
router.post('/', paymentsController.createPayment);
router.get('/', paymentsController.listMyPayments);

const loadPayment = (id: string) => Payment.findById(id);

router.get('/:id', requireResourceAccess(loadPayment), paymentsController.getPayment);
router.post('/:id/submit-tx', requireResourceAccess(loadPayment), paymentsController.submitTransaction);
router.post('/:id/verify', requireResourceAccess(loadPayment), paymentsController.verifyPayment);

export default router;
