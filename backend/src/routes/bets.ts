import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { BetRow, BetType, DEFAULT_PAYOUT_RATES } from '../models/types';
import { broadcast } from '../websocket/handler';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

const betTypeValues: [BetType, ...BetType[]] = [
  '2digit_top', '2digit_bottom', '3digit_top', '3digit_tote', '3digit_back', '1digit_top', '1digit_bottom',
];

const singleBetSchema = z.object({
  round_id: z.string().uuid(),
  number: z.string().regex(/^\d{1,3}$/),
  bet_type: z.enum(betTypeValues),
  amount: z.number().positive().max(10_000_000),
  payout_rate: z.number().positive().optional(),
  customer_ref: z.string().max(100).optional(),
});

const bulkBetSchema = z.object({
  round_id: z.string().uuid(),
  bets: z
    .array(
      z.object({
        number: z.string().regex(/^\d{1,3}$/),
        bet_type: z.enum(betTypeValues),
        amount: z.number().positive().max(10_000_000),
        payout_rate: z.number().positive().optional(),
        customer_id: z.string().uuid().optional().nullable(),
        customer_ref: z.string().max(100).optional().nullable(),
        sheet_no: z.number().int().min(1).max(999).optional(),
      }),
    )
    .min(1)
    .max(500),
});

// Validate number length matches bet_type
function validateNumberType(number: string, bet_type: BetType): boolean {
  const len = number.length;
  if (bet_type.startsWith('2digit') && len !== 2) return false;
  if (bet_type.startsWith('3digit') && len !== 3) return false;
  return true;
}

// ─── GET /api/bets?round_id=xxx ───────────────────────────────────────────────
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.query.round_id);
    const result = await query<BetRow>(
      `SELECT b.*, u.username as created_by_name
       FROM bets b
       LEFT JOIN users u ON b.created_by = u.id
       WHERE b.round_id = $1
       ORDER BY b.created_at ASC`,
      [roundId],
    );
    res.json({ bets: result.rows, total: result.rowCount });
  } catch (err) {
    next(err);
  }
});

// ─── POST /api/bets — single bet ─────────────────────────────────────────────
router.post(
  '/',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = singleBetSchema.parse(req.body);
      if (!validateNumberType(data.number, data.bet_type)) {
        throw createError(
          `Number "${data.number}" has wrong length for type "${data.bet_type}"`,
          400,
        );
      }

      // Check if number is blocked or over limit
      const limitResult = await query(
        `SELECT max_amount, is_blocked FROM number_limits
         WHERE round_id = $1 AND number = $2 AND bet_type = $3`,
        [data.round_id, data.number, data.bet_type],
      );
      const limit = limitResult.rows[0] as any;
      if (limit?.is_blocked) {
        throw createError(`Number ${data.number} is blocked for this round`, 400);
      }

      if (limit?.max_amount) {
        // Check current total
        const totalResult = await query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0) as total FROM bets
           WHERE round_id = $1 AND number = $2 AND bet_type = $3`,
          [data.round_id, data.number, data.bet_type],
        );
        const currentTotal = parseFloat(totalResult.rows[0]?.total ?? '0');
        if (currentTotal + data.amount > limit.max_amount) {
          throw createError(
            `Bet exceeds limit for number ${data.number}. Available: ${limit.max_amount - currentTotal}`,
            400,
          );
        }
      }

      const payoutRate = data.payout_rate ?? DEFAULT_PAYOUT_RATES[data.bet_type];
      const result = await query<BetRow>(
        `INSERT INTO bets (round_id, number, bet_type, amount, payout_rate, customer_ref, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING *`,
        [
          data.round_id, data.number, data.bet_type,
          data.amount, payoutRate, data.customer_ref ?? null, req.user!.sub,
        ],
      );

      const bet = result.rows[0];
      broadcast({ type: 'bet_added', data: bet });
      res.status(201).json(bet);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/bets/bulk — bulk import ───────────────────────────────────────
router.post(
  '/bulk',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { round_id, bets } = bulkBetSchema.parse(req.body);

      const inserted: BetRow[] = [];
      const errors: string[] = [];

      await withTransaction(async (client) => {
        for (const b of bets) {
          if (!validateNumberType(b.number, b.bet_type)) {
            errors.push(`${b.number}: wrong length for ${b.bet_type}`);
            continue;
          }
          // Check if number is blocked for this customer or globally
          const blockRes = await client.query(
            `SELECT id FROM number_limits
             WHERE round_id = $1 AND number = $2 AND bet_type = $3 AND is_blocked = true
               AND (entity_type = 'all'
                    OR (entity_type = 'customer' AND entity_id = $4))`,
            [round_id, b.number, b.bet_type, b.customer_id ?? null],
          );
          if (blockRes.rowCount && blockRes.rowCount > 0) {
            errors.push(`เลข ${b.number} (${b.bet_type}) ปิดรับแล้ว`);
            continue;
          }
          const payoutRate = b.payout_rate ?? DEFAULT_PAYOUT_RATES[b.bet_type];
          const r = await client.query<BetRow>(
            `INSERT INTO bets (round_id, number, bet_type, amount, payout_rate, customer_id, customer_ref, sheet_no, created_by, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp()) RETURNING *`,
            [round_id, b.number, b.bet_type, b.amount, payoutRate, b.customer_id ?? null, b.customer_ref ?? null, b.sheet_no ?? 1, req.user!.sub],
          );
          inserted.push(r.rows[0]);
        }
      });

      broadcast({ type: 'bets_bulk_added', data: { count: inserted.length, round_id } });
      res.status(201).json({ inserted: inserted.length, errors, bets: inserted });
    } catch (err) {
      next(err);
    }
  },
);

// ─── PATCH /api/bets/move-sheet — move bets to another sheet ─────────────────
router.patch(
  '/move-sheet',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids, sheet_no, customer_id, customer_ref } = z.object({
        ids: z.array(z.string().uuid()).min(1).max(1000),
        sheet_no: z.number().int().min(1).max(999),
        customer_id: z.string().uuid().nullable().optional(),
        customer_ref: z.string().max(100).nullable().optional(),
      }).parse(req.body);
      if (customer_id !== undefined) {
        await query(
          `UPDATE bets SET sheet_no = $1, customer_id = $2, customer_ref = $3 WHERE id = ANY($4::uuid[])`,
          [sheet_no, customer_id, customer_ref ?? null, ids],
        );
      } else {
        await query(
          `UPDATE bets SET sheet_no = $1 WHERE id = ANY($2::uuid[])`,
          [sheet_no, ids],
        );
      }
      broadcast({ type: 'bets_bulk_added', data: { count: ids.length } });
      res.json({ updated: ids.length });
    } catch (err) {
      next(err);
    }
  },
);

// ─── GET /api/bets/search — search bets in a round ───────────────────────────
router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const q = z.object({
      round_id:    z.string().uuid(),
      mode:        z.enum(['top', 'has', 'exceed']),
      bet_type:    z.string().optional(),
      limit:       z.coerce.number().int().min(1).max(1000).default(10),
      number:      z.string().max(4).optional(),
      customer_id: z.string().uuid().optional(),
      min_amount:  z.coerce.number().min(0).default(0),
    }).parse(req.query);

    const { round_id, mode, bet_type, limit, number, customer_id, min_amount } = q;
    const useType = bet_type && bet_type !== 'all';

    if (mode === 'top') {
      const params: unknown[] = [round_id];
      let idx = 2;
      let where = ' WHERE b.round_id = $1';
      if (useType) { where += ` AND b.bet_type = $${idx++}`; params.push(bet_type); }
      const sql = `
        SELECT ROW_NUMBER() OVER (ORDER BY SUM(b.amount) DESC) AS rank,
               b.number, b.bet_type,
               SUM(b.amount)::numeric AS total_amount,
               COUNT(*)::int          AS bet_count
        FROM bets b${where}
        GROUP BY b.number, b.bet_type
        ORDER BY total_amount DESC
        LIMIT $${idx}`;
      params.push(limit);
      const r = await query(sql, params as string[]);
      return res.json({ rows: r.rows, mode });

    } else if (mode === 'has') {
      const params: unknown[] = [round_id];
      let idx = 2;
      let where = ' WHERE b.round_id = $1';
      if (useType) { where += ` AND b.bet_type = $${idx++}`; params.push(bet_type); }
      if (number)  { where += ` AND b.number LIKE $${idx++}`; params.push(`%${number}%`); }
      if (customer_id) { where += ` AND b.customer_id = $${idx++}`; params.push(customer_id); }
      const sql = `
        SELECT ROW_NUMBER() OVER (ORDER BY b.created_at) AS rank,
               b.number, b.bet_type, b.amount::numeric AS total_amount,
               b.sheet_no,
               COALESCE(c.name, b.customer_ref, '') AS customer_name,
               NULL::int AS bet_count
        FROM bets b
        LEFT JOIN customers c ON b.customer_id = c.id${where}
        ORDER BY b.created_at`;
      const r = await query(sql, params as string[]);
      return res.json({ rows: r.rows, mode });

    } else {
      // exceed
      const params: unknown[] = [round_id];
      let idx = 2;
      let where = ' WHERE b.round_id = $1';
      if (useType) { where += ` AND b.bet_type = $${idx++}`; params.push(bet_type); }
      if (customer_id) { where += ` AND b.customer_id = $${idx++}`; params.push(customer_id); }
      const sql = `
        SELECT ROW_NUMBER() OVER (ORDER BY SUM(b.amount) DESC) AS rank,
               b.number, b.bet_type,
               SUM(b.amount)::numeric AS total_amount,
               COUNT(*)::int          AS bet_count
        FROM bets b${where}
        GROUP BY b.number, b.bet_type
        HAVING SUM(b.amount) > $${idx++}
        ORDER BY total_amount DESC`;
      params.push(min_amount);
      const r = await query(sql, params as string[]);
      return res.json({ rows: r.rows, mode });
    }
  } catch (err) {
    next(err);
  }
});

// ─── DELETE /api/bets/:id ─────────────────────────────────────────────────────
router.delete(
  '/:id',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const result = await query('DELETE FROM bets WHERE id = $1 RETURNING id', [id]);
      if (result.rowCount === 0) {
        throw createError('Bet not found', 404);
      }
      broadcast({ type: 'bet_deleted', data: { id } });
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
