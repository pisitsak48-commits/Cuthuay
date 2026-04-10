import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

const dealerSchema = z.object({
  name:         z.string().min(1).max(100),
  sender_name:  z.string().max(100).optional().nullable(),
  // ลด %
  pct_3top:     z.number().min(0).max(100).default(0),
  pct_3tote:    z.number().min(0).max(100).default(0),
  pct_3back:    z.number().min(0).max(100).default(0),
  pct_2top:     z.number().min(0).max(100).default(0),
  pct_2bottom:  z.number().min(0).max(100).default(0),
  pct_1top:     z.number().min(0).max(100).default(0),
  pct_1bottom:  z.number().min(0).max(100).default(0),
  // จ่าย rates
  rate_3top:    z.number().min(0).optional().nullable(),
  rate_3tote:   z.number().min(0).optional().nullable(),
  rate_3back:   z.number().min(0).optional().nullable(),
  rate_2top:    z.number().min(0).optional().nullable(),
  rate_2bottom: z.number().min(0).optional().nullable(),
  rate_1top:    z.number().min(0).optional().nullable(),
  rate_1bottom: z.number().min(0).optional().nullable(),
  // สัดส่วนเก็บสุทธิ % (เช่น 77 = เก็บ 77% ของยอด)
  keep_net_pct: z.number().min(1).max(100).default(100),
});

// ─── GET /api/dealers ────────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      'SELECT * FROM dealers WHERE is_active = true ORDER BY name ASC',
    );
    res.json({ dealers: result.rows });
  } catch (err) { next(err); }
});

// ─── POST /api/dealers ───────────────────────────────────────────────────────
router.post(
  '/',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = dealerSchema.parse(req.body);
      const result = await query(
        `INSERT INTO dealers
           (name, sender_name,
            pct_3top, pct_3tote, pct_3back, pct_2top, pct_2bottom, pct_1top, pct_1bottom,
            rate_3top, rate_3tote, rate_3back, rate_2top, rate_2bottom, rate_1top, rate_1bottom,
            keep_net_pct)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [d.name, d.sender_name ?? null,
         d.pct_3top, d.pct_3tote, d.pct_3back, d.pct_2top, d.pct_2bottom, d.pct_1top, d.pct_1bottom,
         d.rate_3top ?? null, d.rate_3tote ?? null, d.rate_3back ?? null,
         d.rate_2top ?? null, d.rate_2bottom ?? null, d.rate_1top ?? null, d.rate_1bottom ?? null,
         d.keep_net_pct],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
  },
);

// ─── PUT /api/dealers/:id ────────────────────────────────────────────────────
router.put(
  '/:id',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const d = dealerSchema.parse(req.body);
      const result = await query(
        `UPDATE dealers SET
           name=$1, sender_name=$2,
           pct_3top=$3, pct_3tote=$4, pct_3back=$5, pct_2top=$6, pct_2bottom=$7, pct_1top=$8, pct_1bottom=$9,
           rate_3top=$10, rate_3tote=$11, rate_3back=$12, rate_2top=$13, rate_2bottom=$14, rate_1top=$15, rate_1bottom=$16,
           keep_net_pct=$17,
           updated_at=NOW()
         WHERE id=$18 AND is_active=true
         RETURNING *`,
        [d.name, d.sender_name ?? null,
         d.pct_3top, d.pct_3tote, d.pct_3back, d.pct_2top, d.pct_2bottom, d.pct_1top, d.pct_1bottom,
         d.rate_3top ?? null, d.rate_3tote ?? null, d.rate_3back ?? null,
         d.rate_2top ?? null, d.rate_2bottom ?? null, d.rate_1top ?? null, d.rate_1bottom ?? null,
         d.keep_net_pct, id],
      );
      if (result.rowCount === 0) throw createError('Dealer not found', 404);
      res.json(result.rows[0]);
    } catch (err) { next(err); }
  },
);

// ─── DELETE /api/dealers/:id (soft delete) ───────────────────────────────────
router.delete(
  '/:id',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const result = await query(
        'UPDATE dealers SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING id',
        [id],
      );
      if (result.rowCount === 0) throw createError('Dealer not found', 404);
      res.json({ deleted: true });
    } catch (err) { next(err); }
  },
);

export default router;
