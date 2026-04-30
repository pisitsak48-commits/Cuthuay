import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { loadLineSettings, appendWebhookLog } from '../services/lineTextImport';

const router = Router();
router.use(authenticate);
router.use(authorize('admin'));

router.get('/settings', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const s = await loadLineSettings();
    const roundName = s.target_round_id
      ? (await query<{ name: string }>(`SELECT name FROM rounds WHERE id = $1`, [s.target_round_id])).rows[0]
          ?.name ?? null
      : null;
    const customerName = s.customer_id
      ? (await query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [s.customer_id])).rows[0]
          ?.name ?? null
      : null;
    const actorName = s.actor_user_id
      ? (await query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [s.actor_user_id])).rows[0]
          ?.username ?? null
      : null;

    res.json({
      ...s,
      allowed_group_ids: s.allowed_group_ids ?? [],
      target_round_name: roundName,
      customer_name: customerName,
      actor_username: actorName,
      webhook_url_hint: '/api/line/webhook',
    });
  } catch (err) {
    next(err);
  }
});

const patchSchema = z.object({
  webhook_enabled: z.boolean().optional(),
  auto_import_enabled: z.boolean().optional(),
  target_round_id: z.string().uuid().nullable().optional(),
  customer_id: z.string().uuid().nullable().optional(),
  sheet_no: z.number().int().min(1).max(999).optional(),
  allowed_group_ids: z.array(z.string().min(1).max(64)).optional(),
  actor_user_id: z.string().uuid().nullable().optional(),
});

router.patch('/settings', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const body = patchSchema.parse(req.body);
    const sets: string[] = [];
    const vals: unknown[] = [];
    let i = 1;

    if (body.webhook_enabled !== undefined) {
      sets.push(`webhook_enabled = $${i++}`);
      vals.push(body.webhook_enabled);
    }
    if (body.auto_import_enabled !== undefined) {
      sets.push(`auto_import_enabled = $${i++}`);
      vals.push(body.auto_import_enabled);
    }
    if (body.target_round_id !== undefined) {
      sets.push(`target_round_id = $${i++}`);
      vals.push(body.target_round_id);
    }
    if (body.customer_id !== undefined) {
      sets.push(`customer_id = $${i++}`);
      vals.push(body.customer_id);
    }
    if (body.sheet_no !== undefined) {
      sets.push(`sheet_no = $${i++}`);
      vals.push(body.sheet_no);
    }
    if (body.allowed_group_ids !== undefined) {
      sets.push(`allowed_group_ids = $${i++}`);
      vals.push(body.allowed_group_ids);
    }
    if (body.actor_user_id !== undefined) {
      sets.push(`actor_user_id = $${i++}`);
      vals.push(body.actor_user_id);
    }

    if (sets.length === 0) {
      const s = await loadLineSettings();
      return res.json(s);
    }

    sets.push(`updated_at = NOW()`);

    await query(`UPDATE line_integration_settings SET ${sets.join(', ')} WHERE singleton = 1`, vals);

    const s = await loadLineSettings();
    const roundName = s.target_round_id
      ? (await query<{ name: string }>(`SELECT name FROM rounds WHERE id = $1`, [s.target_round_id])).rows[0]
          ?.name ?? null
      : null;
    const customerName = s.customer_id
      ? (await query<{ name: string }>(`SELECT name FROM customers WHERE id = $1`, [s.customer_id])).rows[0]
          ?.name ?? null
      : null;
    const actorName = s.actor_user_id
      ? (await query<{ username: string }>(`SELECT username FROM users WHERE id = $1`, [s.actor_user_id])).rows[0]
          ?.username ?? null
      : null;

    res.json({
      ...s,
      allowed_group_ids: s.allowed_group_ids ?? [],
      target_round_name: roundName,
      customer_name: customerName,
      actor_username: actorName,
      webhook_url_hint: '/api/line/webhook',
    });
  } catch (err) {
    next(err);
  }
});

router.get('/logs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const limit = z.coerce.number().int().min(1).max(200).parse(req.query.limit ?? '40');
    const r = await query(
      `SELECT id, received_at, message_id, group_id, user_id, text_preview, status, inserted_count, error_detail
       FROM line_webhook_log ORDER BY received_at DESC LIMIT $1`,
      [limit],
    );
    res.json({ logs: r.rows });
  } catch (err) {
    next(err);
  }
});

export default router;
