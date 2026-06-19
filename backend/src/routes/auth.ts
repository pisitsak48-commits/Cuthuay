import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, withTransaction } from '../config/database';
import { env } from '../config/env';
import { authenticate, authorize } from '../middleware/auth';
import { issueCsrfToken } from '../middleware/csrf';
import { UserRow } from '../models/types';

const router = Router();
const refreshSecret = env.JWT_REFRESH_SECRET ?? env.JWT_SECRET;

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1),
});
const bootstrapSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(6),
});

const bootstrapLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many bootstrap attempts, try again later.' },
});

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later.' },
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many refresh attempts, try again later.', code: 'RATE_LIMITED' },
});

function issueAccessToken(user: { id: string; username: string; role: string; token_version?: number }): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      token_type: 'access',
      tv: Number(user.token_version ?? 0),
    },
    env.JWT_SECRET,
    { expiresIn: env.JWT_EXPIRES_IN as any },
  );
}

function issueRefreshToken(user: { id: string; username: string; role: string; token_version?: number }): string {
  return jwt.sign(
    {
      sub: user.id,
      username: user.username,
      role: user.role,
      token_type: 'refresh',
      tv: Number(user.token_version ?? 0),
    },
    refreshSecret,
    { expiresIn: env.REFRESH_EXPIRES_IN as any },
  );
}

function authTokenResponse(user: { id: string; username: string; role: string; token_version?: number }) {
  const access_token = issueAccessToken(user);
  const refresh_token = issueRefreshToken(user);
  return {
    // Backward compatibility
    token: access_token,
    access_token,
    refresh_token,
    user: { id: user.id, username: user.username, role: user.role },
  };
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

function attachAuthCookies(
  res: Response,
  tokens: { access_token: string; refresh_token: string },
): void {
  if (!env.COOKIE_AUTH_ENABLED) return;
  const secure = env.COOKIE_SECURE;
  const common = { httpOnly: true as const, sameSite: 'lax' as const, secure };
  res.cookie('access_token', tokens.access_token, { ...common, maxAge: 8 * 60 * 60 * 1000 });
  res.cookie('refresh_token', tokens.refresh_token, { ...common, maxAge: 7 * 24 * 60 * 60 * 1000 });
}

function clearAuthCookies(res: Response): void {
  if (!env.COOKIE_AUTH_ENABLED) return;
  const secure = env.COOKIE_SECURE;
  const common = { httpOnly: true as const, sameSite: 'lax' as const, secure };
  res.clearCookie('access_token', common);
  res.clearCookie('refresh_token', common);
}

function sendAuthResponse(res: Response, user: { id: string; username: string; role: string; token_version?: number }, status = 200) {
  const body = authTokenResponse(user);
  attachAuthCookies(res, body);
  res.status(status).json(body);
}

// GET /api/auth/csrf — issue double-submit token (cookie + body)
router.get('/csrf', (_req, res) => {
  const csrf_token = issueCsrfToken(res);
  res.json({ csrf_token });
});

// GET /api/auth/setup-status — บอกว่าต้องสร้าง admin คนแรกหรือไม่ (ไม่ต้องล็อกอิน)
router.get('/setup-status', async (_req, res, next) => {
  try {
    const r = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users`, []);
    const n = parseInt(r.rows[0]?.c ?? '0', 10);
    res.json({ needs_first_user: n === 0, user_count: n });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/bootstrap — สร้าง admin คนแรกเมื่อยังไม่มี user ในระบบ (ใช้ครั้งเดียวหลัง deploy)
router.post('/bootstrap', bootstrapLimiter, async (req, res, next) => {
  try {
    const cnt = await query<{ c: string }>(`SELECT COUNT(*)::text AS c FROM users`, []);
    if (parseInt(cnt.rows[0]?.c ?? '1', 10) !== 0) {
      res.status(403).json({ error: 'ระบบมีผู้ใช้แล้ว — ใช้หน้าเข้าสู่ระบบ' });
      return;
    }
    const body = bootstrapSchema.parse(req.body);
    const hash = await bcrypt.hash(body.password, 10);
    const result = await query<UserRow>(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, 'admin')
       RETURNING id, username, role, token_version`,
      [body.username.trim(), hash],
    );
    const user = result.rows[0] as UserRow;
    sendAuthResponse(res, user, 201);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === '23505') {
      res.status(409).json({ error: 'ชื่อผู้ใช้นี้ถูกใช้แล้ว' });
      return;
    }
    next(err);
  }
});

// POST /api/auth/login
router.post('/login', loginLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const result = await query<UserRow>(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username],
    );

    const user = result.rows[0];
    if (!user) {
      await query(
        'INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (NULL, $1, $2, $3)',
        ['login_failed', { username, reason: 'user_not_found' }, req.ip],
      );
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await query(
        'INSERT INTO audit_log (user_id, action, details, ip_address) VALUES ($1, $2, $3, $4)',
        [user.id, 'login_failed', { username: user.username, reason: 'invalid_password' }, req.ip],
      );
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    // Log login event
    await query(
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [user.id, 'login', req.ip],
    );

    sendAuthResponse(res, user);
  } catch (err) {
    next(err);
  }
});

const refreshBodySchema = z.object({
  refresh_token: z.string().min(1).optional(),
});

// POST /api/auth/refresh — rotate access token from refresh token (body or httpOnly cookie)
router.post('/refresh', refreshLimiter, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const parsed = refreshBodySchema.safeParse(req.body ?? {});
    let refresh_token = parsed.success ? parsed.data.refresh_token : undefined;
    if (!refresh_token && env.COOKIE_AUTH_ENABLED) {
      refresh_token = readRequestCookie(req, 'refresh_token');
    }
    if (!refresh_token) {
      res.status(401).json({ error: 'Missing refresh token', code: 'INVALID_REFRESH_TOKEN' });
      return;
    }
    let payload: jwt.JwtPayload & { token_type?: string; tv?: number };
    try {
      payload = jwt.verify(refresh_token, refreshSecret) as jwt.JwtPayload & { token_type?: string; tv?: number };
    } catch {
      await query(
        'INSERT INTO audit_log (user_id, action, details, ip_address) VALUES (NULL, $1, $2, $3)',
        ['refresh_failed', { reason: 'invalid_token' }, req.ip],
      );
      res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' });
      return;
    }
    if (payload?.token_type !== 'refresh') {
      res.status(401).json({ error: 'Invalid refresh token type' });
      return;
    }
    const r = await query<UserRow>(
      'SELECT id, username, role, is_active, token_version FROM users WHERE id = $1',
      [payload.sub],
    );
    const user = r.rows[0] as (UserRow & { token_version?: number; is_active?: boolean }) | undefined;
    if (!user || user.is_active === false) {
      res.status(401).json({ error: 'User not found or inactive' });
      return;
    }
    const tokenVersion = Number(payload.tv ?? 0);
    const currentVersion = Number((user as any).token_version ?? 0);
    if (tokenVersion !== currentVersion) {
      res.status(401).json({ error: 'Refresh token revoked' });
      return;
    }
    await query(
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [user.id, 'token_refreshed', req.ip],
    );
    sendAuthResponse(res, user);
  } catch (err) {
    if (err instanceof jwt.JsonWebTokenError || err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ error: 'Invalid or expired refresh token', code: 'INVALID_REFRESH_TOKEN' });
      return;
    }
    next(err);
  }
});
router.post('/logout', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await query('UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1', [
      req.user!.sub,
    ]);
    await query(
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [req.user!.sub, 'logout', req.ip],
    );
    clearAuthCookies(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/logout-all — same strategy for phased rollout compatibility
router.post('/logout-all', authenticate, async (req: Request, res: Response, next: NextFunction) => {
  try {
    await query('UPDATE users SET token_version = token_version + 1, updated_at = NOW() WHERE id = $1', [
      req.user!.sub,
    ]);
    await query(
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [req.user!.sub, 'logout_all', req.ip],
    );
    clearAuthCookies(res);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — validate token and return user info
router.get('/me', authenticate, async (req: Request, res: Response) => {
  res.json({ id: req.user!.sub, username: req.user!.username, role: req.user!.role });
});

const registerUserSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(6),
  role: z.enum(['admin', 'operator', 'viewer']).default('operator'),
});

const patchUserSchema = z
  .object({
    role: z.enum(['admin', 'operator', 'viewer']).optional(),
    password: z.string().min(6).optional(),
    is_active: z.boolean().optional(),
  })
  .refine((b) => b.role !== undefined || b.password !== undefined || b.is_active !== undefined, {
    message: 'No fields to update',
  });

// GET /api/auth/users — admin only
router.get('/users', authenticate, authorize('admin'), async (_req, res, next) => {
  try {
    const result = await query<Pick<UserRow, 'id' | 'username' | 'role' | 'is_active' | 'created_at'>>(
      `SELECT id, username, role, is_active, created_at FROM users ORDER BY username`,
    );
    res.json({ users: result.rows });
  } catch (err) {
    next(err);
  }
});

// POST /api/auth/register — admin only (สร้างบัญชีบน production หลัง login ด้วย admin ที่มีในฐานข้อมูลจริง)
router.post('/register', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const body = registerUserSchema.parse(req.body);
    const hash = await bcrypt.hash(body.password, 10);
    const result = await query<Pick<UserRow, 'id' | 'username' | 'role' | 'is_active' | 'created_at'>>(
      `INSERT INTO users (username, password_hash, role)
       VALUES ($1, $2, $3)
       RETURNING id, username, role, is_active, created_at`,
      [body.username.trim(), hash, body.role],
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// PATCH /api/auth/users/:id — admin only
router.patch('/users/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const body = patchUserSchema.parse(req.body);

    if (body.is_active === false && id === req.user!.sub) {
      res.status(400).json({ error: 'Cannot deactivate your own account' });
      return;
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;
    if (body.role !== undefined) {
      sets.push(`role = $${i++}`);
      vals.push(body.role);
    }
    if (body.is_active !== undefined) {
      sets.push(`is_active = $${i++}`);
      vals.push(body.is_active);
    }
    if (body.password !== undefined) {
      sets.push(`password_hash = $${i++}`);
      vals.push(await bcrypt.hash(body.password, 10));
    }
    sets.push('updated_at = NOW()');
    vals.push(id);

    const result = await query<Pick<UserRow, 'id' | 'username' | 'role' | 'is_active' | 'created_at'>>(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${i}
       RETURNING id, username, role, is_active, created_at`,
      vals,
    );
    if (result.rowCount === 0) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json({ user: result.rows[0] });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/auth/users/:id — admin only (ลบถาวร; FK ที่อ้างถึง user จะถูกตั้งเป็น NULL)
router.delete('/users/:id', authenticate, authorize('admin'), async (req, res, next) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    if (id === req.user!.sub) {
      res.status(400).json({ error: 'Cannot delete your own account' });
      return;
    }

    const row = await query<{ role: string }>(`SELECT role FROM users WHERE id = $1`, [id]);
    if (!row.rows[0]) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    if (row.rows[0].role === 'admin') {
      const cnt = await query<{ c: number }>(
        `SELECT COUNT(*)::int AS c FROM users WHERE role = 'admin' AND is_active = true AND id <> $1`,
        [id],
      );
      if ((cnt.rows[0]?.c ?? 0) === 0) {
        res.status(400).json({ error: 'Cannot delete the last active admin' });
        return;
      }
    }

    await withTransaction(async (client) => {
      await client.query('UPDATE bets SET created_by = NULL WHERE created_by = $1', [id]);
      await client.query('UPDATE rounds SET created_by = NULL WHERE created_by = $1', [id]);
      await client.query('SAVEPOINT sp_cut_plans');
      try {
        await client.query('UPDATE cut_plans SET created_by = NULL WHERE created_by = $1', [id]);
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT sp_cut_plans');
      }
      await client.query('UPDATE send_batches SET created_by = NULL WHERE created_by = $1', [id]);
      await client.query('UPDATE audit_log SET user_id = NULL WHERE user_id = $1', [id]);
      const del = await client.query('DELETE FROM users WHERE id = $1', [id]);
      if (!del.rowCount) throw new Error('User not found');
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
