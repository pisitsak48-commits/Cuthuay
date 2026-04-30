import { Router, Request, Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import multer from 'multer';
import pdfParse = require('pdf-parse');
import { query, withTransaction } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { BetRow, BetType, DEFAULT_PAYOUT_RATES } from '../models/types';
import { broadcast } from '../websocket/handler';
import { createError } from '../middleware/errorHandler';
import { runServerImageOcr } from '../services/imageOcr';

// ─── Helper: load dealer payout rates for a round ────────────────────────────
// Returns dealer's configured rate per bet_type for the given round.
// Falls back to DEFAULT_PAYOUT_RATES if the round has no dealer or rate not set.
// No cache — always query DB fresh so any rate changes take effect immediately.
// No cache — always query DB fresh so rate changes take effect immediately
async function getRoundPayoutRates(roundId: string): Promise<Record<BetType, number>> {
  const res = await query(
    `SELECT d.rate_2top, d.rate_2bottom, d.rate_3top, d.rate_3tote,
            d.rate_3back, d.rate_1top, d.rate_1bottom
     FROM rounds r JOIN dealers d ON r.dealer_id = d.id
     WHERE r.id = $1`,
    [roundId],
  );
  const d = res.rows[0] as Record<string, unknown> | undefined;
  if (!d) return { ...DEFAULT_PAYOUT_RATES };
  return {
    '2digit_top':    Number(d.rate_2top    ?? DEFAULT_PAYOUT_RATES['2digit_top']),
    '2digit_bottom': Number(d.rate_2bottom ?? DEFAULT_PAYOUT_RATES['2digit_bottom']),
    '3digit_top':    Number(d.rate_3top    ?? DEFAULT_PAYOUT_RATES['3digit_top']),
    '3digit_tote':   Number(d.rate_3tote   ?? DEFAULT_PAYOUT_RATES['3digit_tote']),
    '3digit_back':   Number(d.rate_3back   ?? DEFAULT_PAYOUT_RATES['3digit_back']),
    '1digit_top':    Number(d.rate_1top    ?? DEFAULT_PAYOUT_RATES['1digit_top']),
    '1digit_bottom': Number(d.rate_1bottom ?? DEFAULT_PAYOUT_RATES['1digit_bottom']),
  };
}

const router = Router();
router.use(authenticate);

// ─── PDF parse endpoint ────────────────────────────────────────────────────────
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') cb(null, true);
    else cb(new Error('Only PDF files are allowed'));
  },
});

router.post('/parse-pdf', upload.single('file'), async (req: Request, res: Response) => {
  if (!req.file) { res.status(400).json({ error: 'No PDF file uploaded' }); return; }
  try {
    const data = await pdfParse(req.file.buffer);
    res.json({ text: data.text });
  } catch {
    res.status(422).json({ error: 'Failed to parse PDF' });
  }
});

/** รูปโพย → ข้อความ: Google Vision / PaddleOCR / อัตโนมัติ (Paddle → Vision ตามค่าเริ่ม; ปรับ OCR_IMAGE_AUTO_ORDER) */
const uploadImageOcr = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

router.post('/ocr-image', uploadImageOcr.single('file'), async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ error: 'No image uploaded', text: '', engine: 'none' });
    return;
  }
  const body = req.body as { ocrEngine?: string };
  const q = req.query as { ocrEngine?: string | string[] };
  const rawEngine = body?.ocrEngine ?? (Array.isArray(q?.ocrEngine) ? q.ocrEngine[0] : q?.ocrEngine);
  const ocrEngine = typeof rawEngine === 'string' ? rawEngine : undefined;
  const out = await runServerImageOcr(req.file.buffer, req.file.mimetype, ocrEngine);
  if (!out.text) {
    res.json({
      text: '',
      lines: [] as string[],
      engine: out.engine,
      message: out.message,
    });
    return;
  }
  res.json({
    text: out.text,
    lines: out.lines,
    engine: out.engine,
  });
});

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
        created_at: z.string().optional(),
        sort_order: z.number().optional(),
        import_batch_id: z.string().uuid().optional().nullable(),
        segment_index: z.number().int().min(0).max(1_000_000).optional(),
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
       ORDER BY COALESCE(b.sort_order, EXTRACT(EPOCH FROM b.created_at) * 1000) ASC`,
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

      // Use dealer's configured rate for this round, not hardcoded DEFAULT
      const roundRates = await getRoundPayoutRates(data.round_id);
      const payoutRate = data.payout_rate ?? roundRates[data.bet_type];
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
      const defaultImportBatchId = randomUUID();

      const inserted: BetRow[] = [];
      const errors: string[] = [];

      await withTransaction(async (client) => {
        for (const b of bets) {
          const importBatchId = b.import_batch_id ?? defaultImportBatchId;
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
          // Use dealer's configured rate for this round, not hardcoded DEFAULT
          const roundRates = await getRoundPayoutRates(round_id);
          const payoutRate = b.payout_rate ?? roundRates[b.bet_type];
          const r = await client.query<BetRow>(
            `INSERT INTO bets (round_id, number, bet_type, amount, payout_rate, customer_id, customer_ref, sheet_no, created_by, sort_order, import_batch_id, segment_index)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, EXTRACT(EPOCH FROM clock_timestamp()) * 1000), $11, COALESCE($12, 0)) RETURNING *`,
            [
              round_id,
              b.number,
              b.bet_type,
              b.amount,
              payoutRate,
              b.customer_id ?? null,
              b.customer_ref ?? null,
              b.sheet_no ?? 1,
              req.user!.sub,
              b.sort_order ?? null,
              importBatchId,
              b.segment_index ?? null,
            ],
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
      // exceed: รายการรายบรรทัดที่ยอดแถวนั้น > min_amount (ตรงโปรแกรมอ้างอิม — ไม่รวมเป็นยอดต่อเลข)
      const params: unknown[] = [round_id];
      let idx = 2;
      let where = ' WHERE b.round_id = $1';
      if (useType) { where += ` AND b.bet_type = $${idx++}`; params.push(bet_type); }
      if (customer_id) { where += ` AND b.customer_id = $${idx++}`; params.push(customer_id); }
      where += ` AND b.amount > $${idx}`;
      params.push(min_amount);
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
      await query('DELETE FROM bets WHERE id = $1', [id]);
      broadcast({ type: 'bet_deleted', data: { id } });
      res.json({ deleted: true });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/bets/bulk-delete — delete multiple bets at once ────────────────
router.post(
  '/bulk-delete',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { ids } = z.object({ ids: z.array(z.string().uuid()).min(1) }).parse(req.body);
      await query('DELETE FROM bets WHERE id = ANY($1::uuid[])', [ids]);
      broadcast({ type: 'bet_deleted', data: { ids } });
      res.json({ deleted: ids.length });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
