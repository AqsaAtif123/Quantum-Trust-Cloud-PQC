import { Request, Response, NextFunction } from 'express';
import { logger } from '../utils/logger';

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: 'ROUTE_NOT_FOUND' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: any, req: Request, res: Response, next: NextFunction): void {
  logger.error({ err, path: req.path, method: req.method }, 'unhandled error');

  // Never leak stack traces or internal details to the client.
  const status = err.status ?? 500;
  const message = status < 500 ? err.message : 'INTERNAL_SERVER_ERROR';
  res.status(status).json({ error: message });
}
