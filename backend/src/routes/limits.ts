import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { BetType, NumberLimitRow } from '../models/types';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

const betTypeValues: [BetType, ...BetType[]] = [
  '2digit_top', '2digit_bottom', '3digit_top', '3digit_tote', '3digit_back', '1digit_top', '1digit_bottom',
];

const entityTypeValues = ['all', 'customer', 'dealer'] as const;

const upsertLimitSchema = z.object({
  number:        z.string().regex(/^\d{2,3}$/),
  bet_type:      z.enum(betTypeValues),
  entity_type:   z.enum(entityTypeValues).default('all'),
  entity_id:     z.string().uuid().nullable().optional(),
  max_amount:    z.number().positive().nullable().optional(),
  custom_payout: z.number().positive().nullable().optional(),
  payout_pct:    z.number().min(0).max(100).default(100),
  is_blocked:    z.boolean().optional(),
});

/** Build ON CONFLICT clause based on entity_type */
function upsertQuery(roundId: string, data: z.infer<typeof upsertLimitSchema>) {
  const values = [
    roundId,
    data.number,
    data.bet_type,
    data.entity_type,
    data.entity_id ?? null,
    data.max_amount ?? null,
    data.custom_payout ?? null,
    data.payout_pct,
    data.is_blocked ?? false,
  ];
  // Use two different ON CONFLICT targets matching partial unique indexes
  const onConflict = data.entity_type === 'all'
    ? `ON CONFLICT (round_id, number, bet_type) WHERE entity_type = 'all'`
    : `ON CONFLICT (round_id, number, bet_type, entity_id) WHERE entity_type != 'all'`;

  const sql = `
    INSERT INTO number_limits (round_id, number, bet_type, entity_type, entity_id,
                                max_amount, custom_payout, payout_pct, is_blocked)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ${onConflict}
    DO UPDATE SET
      max_amount    = EXCLUDED.max_amount,
      custom_payout = EXCLUDED.custom_payout,
      payout_pct    = EXCLUDED.payout_pct,
      is_blocked    = EXCLUDED.is_blocked
    RETURNING *`;
  return { sql, values };
}

// GET /api/limits/:roundId — optional ?entity_type=&entity_id=
router.get('/:roundId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const params: unknown[] = [roundId];
    let where = '';
    if (req.query.entity_type) {
      params.push(String(req.query.entity_type));
      where += ` AND entity_type = $${params.length}`;
    }
    if (req.query.entity_id) {
      params.push(String(req.query.entity_id));
      where += ` AND entity_id = $${params.length}`;
    }
    const result = await query<NumberLimitRow>(
      `SELECT * FROM number_limits WHERE round_id = $1 ${where} ORDER BY number, bet_type`,
      params,
    );
    res.json({ limits: result.rows });
  } catch (err) {
    next(err);
  }
});

// PUT /api/limits/:roundId — upsert a single limit
router.put(
  '/:roundId',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const data = upsertLimitSchema.parse(req.body);
      const { sql, values } = upsertQuery(roundId, data);
      const result = await query<NumberLimitRow>(sql, values);
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

// PUT /api/limits/:roundId/bulk — set multiple limits at once
router.put(
  '/:roundId/bulk',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const { limits } = z
        .object({ limits: z.array(upsertLimitSchema).min(1).max(1000) })
        .parse(req.body);

      const inserted: NumberLimitRow[] = [];
      for (const data of limits) {
        const { sql, values } = upsertQuery(roundId, data);
        const result = await query<NumberLimitRow>(sql, values);
        inserted.push(result.rows[0]);
      }
      res.json({ updated: inserted.length, limits: inserted });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/limits/:roundId/:id — delete by primary key
router.delete(
  '/:roundId/by-id/:id',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const id = z.string().uuid().parse(req.params.id);
      const result = await query(
        'DELETE FROM number_limits WHERE round_id = $1 AND id = $2 RETURNING *',
        [roundId, id],
      );
      if (result.rowCount === 0) throw createError('Limit not found', 404);
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/limits/:roundId/:number/:betType — legacy (global only)
router.delete(
  '/:roundId/:number/:betType',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const number = z.string().regex(/^\d{2,3}$/).parse(req.params.number);
      const betType = z.enum(betTypeValues).parse(req.params.betType);

      const result = await query(
        `DELETE FROM number_limits WHERE round_id = $1 AND number = $2 AND bet_type = $3
         AND entity_type = 'all' RETURNING *`,
        [roundId, number, betType],
      );
      if (result.rowCount === 0) throw createError('Limit not found', 404);
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

