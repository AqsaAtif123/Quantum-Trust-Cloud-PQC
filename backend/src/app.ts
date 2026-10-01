import express, { Express } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';

import { env } from './config/env';
import { logger } from './utils/logger';
import { notFoundHandler, errorHandler } from './middleware/errorHandler';

import healthRoutes from './routes/health.routes';
import authRoutes from './routes/auth.routes';
import filesRoutes from './routes/files.routes';
import foldersRoutes from './routes/folders.routes';
import roomsRoutes from './routes/rooms.routes';
import usersRoutes from './routes/users.routes';
import vaultRoutes from './routes/vault.routes';
import paymentsRoutes from './routes/payments.routes';
import securityRoutes from './routes/security.routes';
import notificationsRoutes from './routes/notifications.routes';

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
