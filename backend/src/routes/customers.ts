import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

const customerSchema = z.object({
  name:                 z.string().min(1).max(100),
  phone:                z.string().max(20).optional().nullable(),
  note:                 z.string().max(500).optional().nullable(),
  commission_rate:      z.number().min(0).max(100).default(0),
  commission_rate_run:  z.number().min(0).max(100).default(0),
  pct_3top:     z.number().min(0).max(100).default(0),
  pct_3tote:    z.number().min(0).max(100).default(0),
  pct_3back:    z.number().min(0).max(100).default(0),
  pct_2top:     z.number().min(0).max(100).default(0),
  pct_2bottom:  z.number().min(0).max(100).default(0),
  pct_1top:     z.number().min(0).max(100).default(0),
  pct_1bottom:  z.number().min(0).max(100).default(0),
  rate_3top:            z.number().min(0).optional().nullable(),
  rate_3tote:           z.number().min(0).optional().nullable(),
  rate_3back:           z.number().min(0).optional().nullable(),
  rate_2top:            z.number().min(0).optional().nullable(),
  rate_2bottom:         z.number().min(0).optional().nullable(),
  rate_1top:            z.number().min(0).optional().nullable(),
  rate_1bottom:         z.number().min(0).optional().nullable(),
});

// ─── GET /api/customers ───────────────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await query(
      'SELECT * FROM customers WHERE is_active = true ORDER BY name ASC',
    );
    res.json({ customers: result.rows });
  } catch (err) { next(err); }
});

// ─── POST /api/customers ──────────────────────────────────────────────────────
router.post(
  '/',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const d = customerSchema.parse(req.body);
      const result = await query(
        `INSERT INTO customers
           (name, phone, note, commission_rate, commission_rate_run,
            pct_3top, pct_3tote, pct_3back, pct_2top, pct_2bottom, pct_1top, pct_1bottom,
            rate_3top, rate_3tote, rate_3back, rate_2top, rate_2bottom, rate_1top, rate_1bottom)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
         RETURNING *`,
        [d.name, d.phone ?? null, d.note ?? null, d.commission_rate, d.commission_rate_run,
         d.pct_3top, d.pct_3tote, d.pct_3back, d.pct_2top, d.pct_2bottom, d.pct_1top, d.pct_1bottom,
         d.rate_3top ?? null, d.rate_3tote ?? null, d.rate_3back ?? null,
         d.rate_2top ?? null, d.rate_2bottom ?? null, d.rate_1top ?? null, d.rate_1bottom ?? null],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) { next(err); }
  },
);

// ─── PUT /api/customers/:id ───────────────────────────────────────────────────
router.put(
  '/:id',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const d = customerSchema.parse(req.body);
      const result = await query(
        `UPDATE customers SET
           name=$1, phone=$2, note=$3, commission_rate=$4, commission_rate_run=$5,
           pct_3top=$6, pct_3tote=$7, pct_3back=$8, pct_2top=$9, pct_2bottom=$10, pct_1top=$11, pct_1bottom=$12,
           rate_3top=$13, rate_3tote=$14, rate_3back=$15,
           rate_2top=$16, rate_2bottom=$17, rate_1top=$18, rate_1bottom=$19,
           updated_at=NOW()
         WHERE id=$20 AND is_active=true
         RETURNING *`,
        [d.name, d.phone ?? null, d.note ?? null, d.commission_rate, d.commission_rate_run,
         d.pct_3top, d.pct_3tote, d.pct_3back, d.pct_2top, d.pct_2bottom, d.pct_1top, d.pct_1bottom,
         d.rate_3top ?? null, d.rate_3tote ?? null, d.rate_3back ?? null,
         d.rate_2top ?? null, d.rate_2bottom ?? null, d.rate_1top ?? null, d.rate_1bottom ?? null, id],
      );
      if (result.rowCount === 0) throw createError('Customer not found', 404);
      res.json(result.rows[0]);
    } catch (err) { next(err); }
  },
);

// ─── DELETE /api/customers/:id (soft delete) ──────────────────────────────────
router.delete(
  '/:id',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const result = await query(
        'UPDATE customers SET is_active=false, updated_at=NOW() WHERE id=$1 RETURNING id',
        [id],
      );
      if (result.rowCount === 0) throw createError('Customer not found', 404);
      res.json({ deleted: true });
    } catch (err) { next(err); }
  },
);

export default router;
