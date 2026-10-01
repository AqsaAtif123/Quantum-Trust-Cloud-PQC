import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import { createApp } from './app';
import { connectDatabase, disconnectDatabase } from './config/db';
import { env } from './config/env';
import { logger } from './utils/logger';
import { verifyAccessToken, VerifiedIdentity } from './services/verifyAccessToken';
import { RoomMembership } from './models/RoomMembership';
import { setIO } from './services/realtime/io';
import { registerVaultExpiryJob } from './jobs/vaultExpiryCheck';

declare module 'socket.io' {
  interface Socket {
    identity?: VerifiedIdentity;
  }
}

async function main(): Promise<void> {
  await connectDatabase();

  const app = createApp();
  const server = http.createServer(app);

  const io = new SocketIOServer(server, {
    cors: { origin: env.CORS_ORIGIN, credentials: true },
  });

  // Real authentication: the same verifyAccessToken used by the HTTP
  // requireAuth middleware, so a revoked session or blocked device is
  // rejected identically here — this is not a placeholder that trusts
  // any token shape.
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token as string | undefined;
    if (!token) {
      next(new Error('AUTHENTICATION_REQUIRED'));
      return;
    }
    const identity = await verifyAccessToken(token);
    if (!identity) {
      next(new Error('SESSION_INVALID'));
      return;
    }
    socket.identity = identity;
    next();
  });

  io.on('connection', (socket) => {
    const identity = socket.identity!;
    // Personal channel for direct notifications (security alerts, vault
    // expiry reminders, etc.) that don't belong to any collaboration room.
    socket.join(`user:${identity.userId}`);

    socket.on('room:join', async (roomId: string, ack?: (result: { ok: boolean; error?: string }) => void) => {
      const membership = await RoomMembership.findOne({ roomId, userId: identity.userId, isActive: true });
      if (!membership) {
        ack?.({ ok: false, error: 'NOT_A_ROOM_MEMBER' });
        return;
      }
      socket.join(`room:${roomId}`);
      ack?.({ ok: true });
    });

    socket.on('room:leave', (roomId: string) => {
      socket.leave(`room:${roomId}`);
    });

    socket.on('disconnect', () => {
      logger.debug({ userId: identity.userId }, 'socket disconnected');
    });
  });

  setIO(io);
  const vaultExpiryTimer = registerVaultExpiryJob();

  server.listen(env.PORT, () => {
    logger.info(`QuantumTrust backend listening on port ${env.PORT} [${env.NODE_ENV}]`);
  });

  const shutdown = async (signal: string) => {
    logger.info(`${signal} received, shutting down gracefully`);
    clearInterval(vaultExpiryTimer);
    server.close();
    await disconnectDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal startup error:', err);
  process.exit(1);
});
