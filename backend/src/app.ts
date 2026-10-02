import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { env } from './config/env.js';
import { logger } from './utils/logger.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

import healthRoutes from './routes/health.routes.js';
import authRoutes from './routes/auth.routes.js';
import filesRoutes from './routes/files.routes.js';
import foldersRoutes from './routes/folders.routes.js';
import roomsRoutes from './routes/rooms.routes.js';
import usersRoutes from './routes/users.routes.js';
import vaultRoutes from './routes/vault.routes.js';
import paymentsRoutes from './routes/payments.routes.js';
import securityRoutes from './routes/security.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';

export function createApp(): Express {
  const app = express();

  // Security headers (helmet covers HSTS, X-Frame-Options, X-Content-Type-Options,
  // a reasonable default CSP, etc.)
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    }),
  );

  app.use(cookieParser(env.COOKIE_SECRET));
  app.use(compression());

  // JSON body limit — file bytes never go through this (they go straight
  // to object storage via presigned URLs), so this stays small on purpose.
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  app.use(pinoHttp({ logger }));

  // Global rate limiting as defense-in-depth; auth routes have a stricter
  // limiter layered on top (see auth.routes.ts).
  app.use(
    rateLimit({
      windowMs: env.RATE_LIMIT_WINDOW_MS,
      limit: env.RATE_LIMIT_MAX,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/files', filesRoutes);
  app.use('/api/folders', foldersRoutes);
  app.use('/api/rooms', roomsRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/vault', vaultRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/security', securityRoutes);
  app.use('/api/notifications', notificationsRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
