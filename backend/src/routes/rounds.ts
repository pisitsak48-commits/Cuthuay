import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { RoundRow } from '../models/types';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

const createRoundSchema = z.object({
  name: z.string().min(1).max(100),
  draw_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

const updateStatusSchema = z.object({
  status: z.enum(['open', 'closed', 'drawn', 'archived']),
  result_number: z.string().optional(),
});

// GET /api/rounds
router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const status = req.query.status as string | undefined;
    const params: unknown[] = [];
    let where = '';
    if (status) {
      where = 'WHERE r.status = $1';
      params.push(status);
    }
    const result = await query<RoundRow>(
      `SELECT r.*, u.username as created_by_name, d.name as dealer_name,
              COUNT(b.id) as bet_count,
              COALESCE(SUM(b.amount), 0) as total_revenue
       FROM rounds r
       LEFT JOIN users u ON r.created_by = u.id
       LEFT JOIN dealers d ON r.dealer_id = d.id
       LEFT JOIN bets b ON b.round_id = r.id
       ${where}
       GROUP BY r.id, u.username, d.name
       ORDER BY r.draw_date DESC`,
      params,
    );
    res.json({ rounds: result.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/rounds/:id
router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const result = await query<RoundRow>(
      `SELECT r.*, u.username as created_by_name, d.name as dealer_name,
              COUNT(b.id) as bet_count,
              COALESCE(SUM(b.amount), 0) as total_revenue
       FROM rounds r
       LEFT JOIN users u ON r.created_by = u.id
       LEFT JOIN dealers d ON r.dealer_id = d.id
       LEFT JOIN bets b ON b.round_id = r.id
       WHERE r.id = $1
       GROUP BY r.id, u.username, d.name`,
      [id],
    );
    if (!result.rows[0]) throw createError('Round not found', 404);
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// POST /api/rounds
router.post(
  '/',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createRoundSchema.parse(req.body);
      // Check for duplicate draw_date
      const existing = await query<{ id: string }>(
        'SELECT id FROM rounds WHERE draw_date = $1 LIMIT 1',
        [data.draw_date],
      );
      if (existing.rows.length > 0) {
        throw createError('มีงวดในวันที่นี้อยู่แล้ว กรุณาเลือกวันที่อื่น', 409);
      }
      const result = await query<RoundRow>(
        `INSERT INTO rounds (name, draw_date, created_by) VALUES ($1, $2, $3) RETURNING *`,
        [data.name, data.draw_date, req.user!.sub],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /api/rounds/:id
router.delete(
  '/:id',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      // Cascade: delete bets, send_batches, etc. handled by DB FK or here manually
      await query('DELETE FROM send_batches WHERE round_id = $1', [id]);
      await query('DELETE FROM bets WHERE round_id = $1', [id]);
      const result = await query<RoundRow>('DELETE FROM rounds WHERE id = $1 RETURNING id', [id]);
      if (!result.rows[0]) throw createError('Round not found', 404);
      res.json({ ok: true, id });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/rounds/:id/reset-result — clear result and set status back to closed
router.post(
  '/:id/reset-result',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const result = await query<RoundRow>(
        `UPDATE rounds SET status = 'closed', result_number = NULL, result_data = NULL, updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [id],
      );
      if (!result.rows[0]) throw createError('Round not found', 404);
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/rounds/:id/dealer
router.patch(
  '/:id/dealer',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const { dealer_id } = z.object({
        dealer_id: z.string().uuid().nullable(),
      }).parse(req.body);
      const result = await query<RoundRow>(
        `UPDATE rounds SET dealer_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [dealer_id, id],
      );
      if (!result.rows[0]) throw createError('Round not found', 404);
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

// PATCH /api/rounds/:id/status
router.patch(
  '/:id/status',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const data = updateStatusSchema.parse(req.body);

      // Only require result_number when going to 'drawn' for the first time.
      // If current status is already 'archived', the round was previously drawn
      // and result_number may or may not exist — allow it through regardless.
      if (data.status === 'drawn' && !data.result_number) {
        const existing = await query<RoundRow>('SELECT result_number, status FROM rounds WHERE id = $1', [id]);
        const isUnarchiving = existing.rows[0]?.status === 'archived';
        if (!isUnarchiving && !existing.rows[0]?.result_number) {
          throw createError('result_number is required when status is drawn', 400);
        }
      }

      const result = await query<RoundRow>(
        `UPDATE rounds SET status = $1,
                           result_number = COALESCE($2, result_number),
                           updated_at = NOW()
         WHERE id = $3 RETURNING *`,
        [data.status, data.result_number ?? null, id],
      );
      if (!result.rows[0]) throw createError('Round not found', 404);
      res.json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

// Helper: compute all permutations of a 3-digit string
function totePerms(num: string): string[] {
  const d = num.split('');
  const set = new Set<string>();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
    if (i !== j && j !== k && i !== k) set.add(d[i] + d[j] + d[k]);
  }
  return Array.from(set);
}

// Helper: compute all 2-digit permutations from digits of a 3-digit number
function tote2dFromTop(top3: string): string[] {
  const d = top3.split('');
  const set = new Set<string>();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    if (i !== j) set.add(d[i] + d[j]);
  }
  return Array.from(set);
}

// POST /api/rounds/:id/result — enter draw result and calculate payouts
router.post(
  '/:id/result',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const body = z.object({
        result_prize_1st: z.string().regex(/^\d{6}$/).optional(),
        result_3top:      z.string().regex(/^\d{3}$/, 'ต้องเป็นตัวเลข 3 หลัก'),
        result_2bottom:   z.string().regex(/^\d{2}$/, 'ต้องเป็นตัวเลข 2 หลัก'),
        result_3bottom:   z.union([
          z.array(z.string().regex(/^\d{1,3}$/)),
          z.string(),                             // comma-sep fallback
        ]).optional(),
        result_3front:    z.union([
          z.array(z.string().regex(/^\d{1,3}$/)),
          z.string(),
        ]).optional(),
      }).parse(req.body);

      const result_3top    = body.result_3top;
      const result_2bottom = body.result_2bottom;
      const result_prize_1st = body.result_prize_1st ?? '';

      const result_2top    = result_3top.slice(-2);
      const result_1top    = result_2top.slice(-1);
      const result_1bottom = result_2bottom.slice(-1);

      // Parse multi-number fields
      const parse3List = (v: string[] | string | undefined): string[] => {
        if (!v) return [];
        if (Array.isArray(v)) return v.map(s => s.trim()).filter(s => s.length > 0);
        return v.split(',').map(s => s.trim()).filter(s => s.length > 0);
      };
      const result_3bottom = parse3List(body.result_3bottom);
      const result_3front  = parse3List(body.result_3front);

      const toteNumbers  = totePerms(result_3top);
      const tote2dNumbers = tote2dFromTop(result_3top);

      // Winning sets per bet_type
      const winSets: Record<string, Set<string>> = {
        '3digit_top':    new Set([result_3top]),
        '3digit_tote':   new Set(toteNumbers),
        '3digit_back':   new Set(result_3bottom),
        '2digit_top':    new Set([result_2top]),
        '2digit_bottom': new Set([result_2bottom]),
        '1digit_top':    new Set([result_1top]),
        '1digit_bottom': new Set([result_1bottom]),
      };

      // Fetch all bets for this round
      const betsRes = await query<{
        id: string; number: string; bet_type: string;
        amount: string; payout_rate: string;
        customer_ref: string | null; customer_id: string | null;
        sheet_no: number;
      }>(
        `SELECT id, number, bet_type, amount, payout_rate, customer_ref, customer_id, sheet_no
         FROM bets WHERE round_id = $1`,
        [id],
      );
      const bets = betsRes.rows;

      let totalRevenue = 0;
      let totalPayout  = 0;
      const winningBets: {
        number: string; bet_type: string; amount: number; payout: number;
        customer_ref: string | null; customer_id: string | null; sheet_no: number;
      }[] = [];

      for (const bet of bets) {
        const amt  = parseFloat(bet.amount);
        const rate = parseFloat(bet.payout_rate);
        totalRevenue += amt;
        const won = winSets[bet.bet_type]?.has(bet.number) ?? false;
        if (won) {
          const payout = amt * rate;
          totalPayout += payout;
          winningBets.push({
            number: bet.number, bet_type: bet.bet_type, amount: amt, payout,
            customer_ref: bet.customer_ref, customer_id: bet.customer_id,
            sheet_no: bet.sheet_no,
          });
        }
      }

      const netPl = totalRevenue - totalPayout;

      // Store full result data
      const resultData = {
        prize_1st:  result_prize_1st,
        prize_3top: result_3top,
        tote_numbers: toteNumbers,
        tote_2d_numbers: tote2dNumbers,
        prize_3bottom: result_3bottom,
        prize_3front:  result_3front,
        prize_2top:    result_2top,
        prize_2bottom: result_2bottom,
        prize_1top:    result_1top,
        prize_1bottom: result_1bottom,
      };

      const resultNumber = result_prize_1st
        ? `${result_prize_1st}/${result_2bottom}`
        : `${result_3top}/${result_2bottom}`;

      await query(
        `UPDATE rounds SET status = 'drawn', result_number = $1, result_data = $2, updated_at = NOW()
         WHERE id = $3`,
        [resultNumber, JSON.stringify(resultData), id],
      );

      res.json({
        round_id: id,
        result_data: resultData,
        total_revenue: totalRevenue,
        total_payout:  totalPayout,
        net_pl:        netPl,
        winning_bets:  winningBets,
        total_bets:    bets.length,
        winning_count: winningBets.length,
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/rounds/:id/result — fetch stored result
router.get('/:id/result', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = z.string().uuid().parse(req.params.id);
    const roundRes = await query<RoundRow & { result_data?: unknown }>(
      'SELECT * FROM rounds WHERE id = $1', [id]);
    const round = roundRes.rows[0];
    if (!round) throw createError('Round not found', 404);
    if (!round.result_number) return res.json({ round_id: id, result_number: null });

    // Return stored result_data if available
    if (round.result_data) {
      return res.json({ round_id: id, result_number: round.result_number, result_data: round.result_data });
    }

    // Fallback: parse legacy "XXX/YY" format
    const parts = round.result_number.split('/');
    const result_3top    = parts[0]?.slice(-3) ?? '';
    const result_2bottom = parts[parts.length - 1]?.slice(0, 2) ?? '';
    const result_2top    = result_3top.slice(-2);
    const result_1top    = result_2top.slice(-1);
    const result_1bottom = result_2bottom.slice(-1);

    return res.json({
      round_id: id, result_number: round.result_number,
      result_data: {
        prize_1st: parts[0] ?? '',
        prize_3top: result_3top, prize_3bottom: [], prize_3front: [],
        tote_numbers: totePerms(result_3top),
        tote_2d_numbers: tote2dFromTop(result_3top),
        prize_2top: result_2top, prize_2bottom: result_2bottom,
        prize_1top: result_1top, prize_1bottom: result_1bottom,
      },
    });
  } catch (err) {
    next(err);
  }
});

export default router;

