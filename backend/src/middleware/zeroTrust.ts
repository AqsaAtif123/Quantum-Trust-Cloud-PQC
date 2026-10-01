import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../services/verifyAccessToken';
import { Session } from '../models/Session';
import { logger } from '../utils/logger';

/**
 * ZERO-TRUST AUTHORIZATION CONTEXT
 * =================================
 * Attached to every request that passes `requireAuth`. This is the ONLY
 * source of truth for who the caller is — it is derived entirely from a
 * verified JWT + a live, non-revoked session record. Nothing here comes
 * from a request body, query string, or header the client could forge.
 */
export interface ZeroTrustContext {
  userId: string;
  sessionId: string;
  deviceId: string;
  role: 'user' | 'admin';
  mfaVerified: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ztx?: ZeroTrustContext;
    }
  }
}

/**
 * STEP 1-3 of zero trust: authentication, session validity, device state.
 * This must run before any handler that touches user data.
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : undefined;
    const cookieToken = (req as any).cookies?.qt_access;
    const token = bearerToken ?? cookieToken;

    if (!token) {
      res.status(401).json({ error: 'AUTHENTICATION_REQUIRED' });
      return;
    }

    const identity = await verifyAccessToken(token);
    if (!identity) {
      res.status(401).json({ error: 'SESSION_INVALID' });
      return;
    }

    // Touch last-seen on the session for activity tracking / idle timeout policies.
    await Session.findByIdAndUpdate(identity.sessionId, { lastSeenAt: new Date() });

    req.ztx = identity;
    next();
  } catch (err) {
    logger.error({ err }, 'requireAuth failed unexpectedly');
    res.status(500).json({ error: 'INTERNAL_AUTH_ERROR' });
  }
}

export function requireRole(...roles: Array<'user' | 'admin'>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.ztx || !roles.includes(req.ztx.role)) {
      res.status(403).json({ error: 'INSUFFICIENT_ROLE' });
      return;
    }
    next();
  };
}

export function requireMfa(req: Request, res: Response, next: NextFunction): void {
  if (!req.ztx?.mfaVerified) {
    res.status(403).json({ error: 'MFA_REQUIRED_FOR_THIS_ACTION' });
    return;
  }
  next();
}

/**
 * STEP 4-7 of zero trust: resource ownership, permissions, policy, action.
 * `loader` fetches the resource and returns its ownerId + any resource-
 * specific policy checks; this is generic so every route (files, folders,
 * vault docs, rooms) can reuse one authorization pattern instead of
 * hand-rolling ad hoc checks that are easy to get wrong.
 */
export function requireResourceAccess<T extends { ownerId: { toString(): string } }>(
  loader: (resourceId: string) => Promise<T | null>,
  allowedRolesBeyondOwner: string[] = [],
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const resourceId = req.params.id;
    const resource = await loader(resourceId);

    if (!resource) {
      res.status(404).json({ error: 'RESOURCE_NOT_FOUND' });
      return;
    }

    const isOwner = resource.ownerId.toString() === req.ztx!.userId;
    if (isOwner) {
      (req as any).resource = resource;
      next();
      return;
    }

    // Non-owners must have an explicit, non-expired permission grant.
    // Import is local to avoid a circular dependency with models at module load time.
    const { Permission } = await import('../models/Permission');
    const grant = await Permission.findOne({
      resourceId,
      granteeUserId: req.ztx!.userId,
      $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }],
    });

    if (!grant || (allowedRolesBeyondOwner.length && !allowedRolesBeyondOwner.includes(grant.role))) {
      res.status(403).json({ error: 'ACCESS_DENIED' });
      return;
    }

    (req as any).resource = resource;
    (req as any).grantRole = grant.role;
    next();
  };
}
