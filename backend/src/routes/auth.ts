import { Router, Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { query } from '../config/database';
import { env } from '../config/env';
import { UserRow } from '../models/types';

const router = Router();

const loginSchema = z.object({
  username: z.string().min(1).max(50),
  password: z.string().min(1),
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

export default router;
