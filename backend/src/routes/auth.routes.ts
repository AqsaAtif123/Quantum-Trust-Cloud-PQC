import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import * as authController from '../controllers/auth.controller';
import { requireAuth } from '../middleware/zeroTrust';

const router = Router();

// Aggressive rate limiting on auth endpoints specifically, to blunt
// credential stuffing / brute force beyond the global limiter.
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'TOO_MANY_ATTEMPTS' },
});

router.post('/register', authLimiter, authController.register);
router.post('/login', authLimiter, authController.login);
router.post('/mfa/enroll', requireAuth, authController.enrollMfa);
router.post('/mfa/confirm', requireAuth, authController.confirmMfa);
router.post('/mfa/disable', requireAuth, authController.disableMfa);
router.post('/change-password', requireAuth, authLimiter, authController.changePassword);
router.patch('/profile', requireAuth, authController.updateProfile);
router.post('/logout', requireAuth, authController.logout);
router.post('/logout-all', requireAuth, authController.logoutAllDevices);
router.get('/me', requireAuth, authController.getMe);

export default router;
