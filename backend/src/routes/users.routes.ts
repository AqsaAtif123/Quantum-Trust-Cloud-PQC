import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../middleware/zeroTrust';
import * as usersController from '../controllers/users.controller';

const router = Router();

router.use(requireAuth);

const lookupLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
});

router.get('/lookup', lookupLimiter, usersController.lookupUserByEmail);

export default router;
