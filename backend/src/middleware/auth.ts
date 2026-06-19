import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { JwtPayload, UserRole } from '../models/types';
import { query } from '../config/database';
import { logger } from '../lib/logger';

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

function readRequestCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

function extractAccessToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  if (env.COOKIE_AUTH_ENABLED) {
    const fromCookie = readRequestCookie(req, 'access_token');
    if (fromCookie) return fromCookie;
  }
  return null;
}

export async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractAccessToken(req);
  if (!token) {
    res.status(401).json({ error: 'Missing or malformed Authorization header' });
    return;
  }
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload;
    if (payload.token_type && payload.token_type !== 'access') {
      res.status(401).json({ error: 'Invalid token type' });
      return;
    }
    const userRes = await query<{ id: string; role: UserRole; is_active: boolean; token_version: number }>(
      'SELECT id, role, is_active, token_version FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = userRes.rows[0];
    if (!user || !user.is_active) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }
    const tokenVersion = payload.tv ?? 0; // phased rollout: old access tokens may not carry tv
    if (tokenVersion !== Number(user.token_version ?? 0)) {
      res.status(401).json({ error: 'Token revoked' });
      return;
    }
    req.user = payload;
    next();
  } catch (err) {
    const pg = err as { code?: string; message?: string };
    if (pg.code === '42703') {
      logger.error('auth_schema_drift', {
        message: pg.message ?? 'missing column in users table',
        hint: 'run npm run migrate && npm run migrate:verify',
      });
    }
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Unauthenticated' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
