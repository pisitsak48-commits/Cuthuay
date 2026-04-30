import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { query, withTransaction } from '../config/database';
import { env } from '../config/env';
import { authenticate, authorize } from '../middleware/auth';
import { UserRow } from '../models/types';

const router = Router();

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
       RETURNING id, username, role`,
      [body.username.trim(), hash],
    );
    const user = result.rows[0];
    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any },
    );
    res.status(201).json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
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
router.post('/login', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { username, password } = loginSchema.parse(req.body);

    const result = await query<UserRow>(
      'SELECT * FROM users WHERE username = $1 AND is_active = true',
      [username],
    );

    const user = result.rows[0];
    if (!user) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      res.status(401).json({ error: 'Invalid credentials' });
      return;
    }

    const token = jwt.sign(
      { sub: user.id, username: user.username, role: user.role },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRES_IN as any },
    );

    // Log login event
    await query(
      'INSERT INTO audit_log (user_id, action, ip_address) VALUES ($1, $2, $3)',
      [user.id, 'login', req.ip],
    );

    res.json({
      token,
      user: { id: user.id, username: user.username, role: user.role },
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/auth/me — validate token and return user info
router.get(
  '/me',
  async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'No token provided' });
      return;
    }
    try {
      const payload = jwt.verify(header.slice(7), env.JWT_SECRET) as any;
      const result = await query<UserRow>(
        'SELECT id, username, role, is_active FROM users WHERE id = $1',
        [payload.sub],
      );
      const user = result.rows[0];
      if (!user || !user.is_active) {
        res.status(401).json({ error: 'User not found or inactive' });
        return;
      }
      res.json({ id: user.id, username: user.username, role: user.role });
    } catch {
      res.status(401).json({ error: 'Invalid token' });
    }
  },
);

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
