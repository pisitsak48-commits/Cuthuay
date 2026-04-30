import { Router, Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
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

const roundPackSchema = z.object({
  _meta:         z.object({ version: z.number() }).passthrough().optional(),
  round:         z.record(z.unknown()),
  bets:          z.array(z.record(z.unknown())),
  number_limits: z.array(z.record(z.unknown())).optional().default([]),
  cut_plans:     z.array(z.record(z.unknown())).optional().default([]),
  send_batches:  z.array(z.record(z.unknown())).optional().default([]),
});

/** ข้อมูล export หนึ่งงวด (โครงเดียวกับ GET /rounds/:id/export) */
async function buildRoundExportBundle(roundId: string) {
  const roundRes = await query(
    `SELECT r.*, d.name as dealer_name FROM rounds r LEFT JOIN dealers d ON r.dealer_id = d.id WHERE r.id = $1`,
    [roundId],
  );
  if (!roundRes.rows[0]) return null;
  const round = roundRes.rows[0];

  const betsRes = await query(
    `SELECT id, round_id, number, bet_type, amount, payout_rate, customer_id, customer_ref, sheet_no, created_at
     FROM bets WHERE round_id = $1 ORDER BY created_at ASC`,
    [roundId],
  );

  const limitsRes = await query(
    `SELECT id, round_id, number, bet_type, max_amount, is_blocked, entity_type, entity_id, payout_pct, custom_payout
     FROM number_limits WHERE round_id = $1`,
    [roundId],
  );

  const cutsRes = await query(
    `SELECT id, round_id, cuts, total_cost, risk_limit, dealer_rates, created_at
     FROM cut_plans WHERE round_id = $1`,
    [roundId],
  );

  const batchRes = await query(
    `SELECT id, round_id, bet_type, threshold, items, total, dealer_id, dealer_name, created_at
     FROM send_batches WHERE round_id = $1`,
    [roundId],
  );

  return {
    _meta: {
      version: 1,
      exported_at: new Date().toISOString(),
      app: 'AuraX',
    },
    round,
    bets:          betsRes.rows,
    number_limits: limitsRes.rows,
    cut_plans:     cutsRes.rows,
    send_batches:  batchRes.rows,
  };
}

/** DB เก่าใช้ 3digit_front; สคีมาปัจจุบันรองรับ 3digit_tote (โต๊ด) — แมปตอนนำเข้าเพื่อไม่ให้ CHECK ล้ม */
function normalizeImportedBetType(raw: unknown): string {
  const s = String(raw ?? '');
  if (s === '3digit_front') return '3digit_tote';
  return s;
}

async function resolveDealerId(client: PoolClient, id: unknown): Promise<string | null> {
  if (id == null || id === '') return null;
  const sid = String(id);
  if (!z.string().uuid().safeParse(sid).success) return null;
  const r = await client.query('SELECT 1 FROM dealers WHERE id = $1 LIMIT 1', [sid]);
  return r.rows.length ? sid : null;
}

async function resolveCustomerId(client: PoolClient, id: unknown): Promise<string | null> {
  if (id == null || id === '') return null;
  const sid = String(id);
  if (!z.string().uuid().safeParse(sid).success) return null;
  const r = await client.query('SELECT 1 FROM customers WHERE id = $1 LIMIT 1', [sid]);
  return r.rows.length ? sid : null;
}

async function importOneRoundPack(
  body: z.infer<typeof roundPackSchema>,
  userId: string,
): Promise<{ imported: boolean; message?: string; bet_count: number; round_id: string }> {
  const r = body.round as Record<string, unknown>;
  const roundId = String(r.id);

  const existCheck = await query('SELECT id FROM rounds WHERE id = $1', [roundId]);
  if (existCheck.rows.length > 0) {
    return { imported: false, message: 'งวดนี้มีอยู่แล้วในระบบ', bet_count: 0, round_id: roundId };
  }

  return withTransaction(async (client) => {
    const dealerId = await resolveDealerId(client, r.dealer_id);

    await client.query(
      `INSERT INTO rounds (id, name, draw_date, status, dealer_id, result_number, result_data, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO NOTHING`,
      [
        r.id, r.name, r.draw_date, r.status ?? 'archived',
        dealerId, r.result_number ?? null,
        r.result_data ? JSON.stringify(r.result_data) : null,
        userId,
        r.created_at ?? new Date().toISOString(),
        r.updated_at ?? new Date().toISOString(),
      ],
    );

    let betCount = 0;
    for (const b of body.bets) {
      const bet = b as Record<string, unknown>;
      const cid = await resolveCustomerId(client, bet.customer_id);
      const sheetNo = Math.max(1, parseInt(String(bet.sheet_no ?? 1), 10) || 1);
      const betType = normalizeImportedBetType(bet.bet_type);
      const createdAt =
        bet.created_at != null && String(bet.created_at) !== ''
          ? String(bet.created_at)
          : new Date().toISOString();

      await client.query(
        `INSERT INTO bets (id, round_id, number, bet_type, amount, payout_rate, customer_id, customer_ref, sheet_no, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         ON CONFLICT (id) DO NOTHING`,
        [
          bet.id, roundId, bet.number, betType, bet.amount, bet.payout_rate,
          cid, bet.customer_ref ?? null, sheetNo,
          userId, createdAt,
        ],
      );
      betCount++;
    }

    for (const l of body.number_limits) {
      const lim = l as Record<string, unknown>;
      const betType = normalizeImportedBetType(lim.bet_type);
      await client.query(
        `INSERT INTO number_limits (id, round_id, number, bet_type, max_amount, is_blocked, entity_type, entity_id, payout_pct, custom_payout)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          lim.id, roundId, lim.number, betType, lim.max_amount ?? null,
          lim.is_blocked ?? false, lim.entity_type ?? 'all', lim.entity_id ?? null, lim.payout_pct ?? 100,
          lim.custom_payout ?? null,
        ],
      );
    }

    for (const c of body.cut_plans) {
      const cp = c as Record<string, unknown>;
      const cutsJson = JSON.stringify(cp.cuts != null ? cp.cuts : []);
      const ratesJson = JSON.stringify(cp.dealer_rates != null ? cp.dealer_rates : {});
      const cpCreated =
        cp.created_at != null && String(cp.created_at) !== ''
          ? String(cp.created_at)
          : new Date().toISOString();
      await client.query(
        `INSERT INTO cut_plans (id, round_id, cuts, total_cost, risk_limit, dealer_rates, created_by, created_at)
         VALUES ($1,$2,$3::jsonb,$4,$5,$6::jsonb,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          cp.id, roundId, cutsJson, Number(cp.total_cost ?? 0), Number(cp.risk_limit ?? 0),
          ratesJson, userId, cpCreated,
        ],
      );
    }

    for (const s of body.send_batches) {
      const sb = s as Record<string, unknown>;
      const sbDealer = await resolveDealerId(client, sb.dealer_id);
      const betType = normalizeImportedBetType(sb.bet_type);
      const itemsJson = JSON.stringify(sb.items != null ? sb.items : []);
      const sbCreated =
        sb.created_at != null && String(sb.created_at) !== ''
          ? String(sb.created_at)
          : new Date().toISOString();
      await client.query(
        `INSERT INTO send_batches (id, round_id, bet_type, threshold, items, total, dealer_id, dealer_name, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10)
         ON CONFLICT (id) DO NOTHING`,
        [
          sb.id, roundId, betType, sb.threshold, itemsJson,
          sb.total, sbDealer, sb.dealer_name ?? null, userId, sbCreated,
        ],
      );
    }

    return { imported: true, bet_count: betCount, round_id: roundId };
  });
}

type ImportPreviewStatus = 'new' | 'id_exists' | 'date_conflict' | 'invalid';

async function previewRoundRow(r: Record<string, unknown>): Promise<{
  round_id: string;
  name: string;
  draw_date: string;
  status: ImportPreviewStatus;
  message?: string;
}> {
  const roundId = r.id != null ? String(r.id) : '';
  const drawDate =
    r.draw_date != null ? String(r.draw_date).slice(0, 10) : '';
  const name = r.name != null ? String(r.name) : '';

  if (!z.string().uuid().safeParse(roundId).success) {
    return {
      round_id: roundId || '(ไม่มีรหัส)',
      name,
      draw_date: drawDate,
      status: 'invalid',
      message: 'รหัสงวดในไฟล์ไม่ใช่ UUID',
    };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(drawDate)) {
    return {
      round_id: roundId,
      name,
      draw_date: drawDate,
      status: 'invalid',
      message: 'วันออกรางวัลไม่ถูกต้อง',
    };
  }

  const byId = await query<{ id: string; name: string }>(
    'SELECT id, name FROM rounds WHERE id = $1',
    [roundId],
  );
  if (byId.rows.length > 0) {
    return {
      round_id: roundId,
      name,
      draw_date: drawDate,
      status: 'id_exists',
      message:
        'มีงวดรหัสนี้ในระบบแล้ว — นำเข้าจะถูกข้าม (ไม่ทับโพย/ข้อมูลเดิม)',
    };
  }

  const byDate = await query<{ id: string; name: string }>(
    'SELECT id, name FROM rounds WHERE draw_date = $1 AND id != $2 LIMIT 1',
    [drawDate, roundId],
  );
  if (byDate.rows.length > 0) {
    return {
      round_id: roundId,
      name,
      draw_date: drawDate,
      status: 'date_conflict',
      message: `วันออกซ้ำกับงวด «${byDate.rows[0].name}» ในระบบ — นำเข้าได้ แต่จะมีสองงวดวันเดียวกัน`,
    };
  }

  return { round_id: roundId, name, draw_date: drawDate, status: 'new' };
}

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

// POST /api/rounds/export-bulk — backup หลายงวดใน JSON เดียว (key `rounds`)
router.post(
  '/export-bulk',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { round_ids, include_archived } = z.object({
        round_ids: z.array(z.string().uuid()).optional(),
        /** ถ้าไม่ส่ง round_ids: ส่งออกทุกงวดที่ยังไม่ archived (หรือทั้งหมดถ้า true) */
        include_archived: z.boolean().optional().default(false),
      }).parse(req.body);

      let ids: string[];
      if (round_ids && round_ids.length > 0) {
        ids = round_ids;
      } else {
        const r = include_archived
          ? await query<{ id: string }>(`SELECT id FROM rounds ORDER BY draw_date DESC`, [])
          : await query<{ id: string }>(
              `SELECT id FROM rounds WHERE status != 'archived' ORDER BY draw_date DESC`,
              [],
            );
        ids = r.rows.map((row) => row.id);
      }

      const rounds: NonNullable<Awaited<ReturnType<typeof buildRoundExportBundle>>>[] = [];
      for (const id of ids) {
        const pack = await buildRoundExportBundle(id);
        if (pack) rounds.push(pack);
      }

      const payload = {
        _meta: {
          version: 2,
          export_kind: 'bulk' as const,
          exported_at: new Date().toISOString(),
          app: 'AuraX',
          round_count: rounds.length,
        },
        rounds,
      };

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="aurax-backup-${new Date().toISOString().slice(0, 10)}.json"`,
      );
      res.json(payload);
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/rounds/import-preview — ตรวจก่อนนำเข้า (ซ้ำรหัสงวด / วันออกซ้ำ)
router.post(
  '/import-preview',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.body as Record<string, unknown>;

      if (Array.isArray(raw.rounds)) {
        const rounds: Array<
          {
            index: number;
            round_id: string;
            name: string;
            draw_date: string;
            status: ImportPreviewStatus;
            message?: string;
          } | {
            index: number;
            status: 'invalid';
            message: string;
          }
        > = [];

        for (let i = 0; i < raw.rounds.length; i++) {
          const pack = raw.rounds[i] as Record<string, unknown>;
          const r = pack?.round as Record<string, unknown> | undefined;
          if (!r) {
            rounds.push({
              index: i,
              status: 'invalid',
              message: 'แพ็กไม่มีข้อมูล round',
            });
            continue;
          }
          const row = await previewRoundRow(r);
          rounds.push({ index: i, ...row });
        }

        const counts = {
          new: rounds.filter((x) => 'status' in x && x.status === 'new').length,
          id_exists: rounds.filter((x) => 'status' in x && x.status === 'id_exists').length,
          date_conflict: rounds.filter((x) => 'status' in x && x.status === 'date_conflict').length,
          invalid: rounds.filter((x) => 'status' in x && x.status === 'invalid').length,
        };

        return res.json({ ok: true, bulk: true, rounds, counts });
      }

      const r = raw.round as Record<string, unknown> | undefined;
      if (!r) {
        throw createError('ไม่พบข้อมูล round ในไฟล์', 400);
      }
      const row = await previewRoundRow(r);
      const counts = {
        new: row.status === 'new' ? 1 : 0,
        id_exists: row.status === 'id_exists' ? 1 : 0,
        date_conflict: row.status === 'date_conflict' ? 1 : 0,
        invalid: row.status === 'invalid' ? 1 : 0,
      };
      return res.json({ ok: true, bulk: false, round: row, counts });
    } catch (err) {
      next(err);
    }
  },
);

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

// POST /api/rounds — admin / operator สร้างได้; หนึ่งงวดต่อวันออก (ถ้ามีแล้วไม่ให้ซ้ำ)
router.post(
  '/',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const data = createRoundSchema.parse(req.body);
      // Check for duplicate draw_date
      const existing = await query<{ id: string }>(
        'SELECT id FROM rounds WHERE draw_date = $1 LIMIT 1',
        [data.draw_date],
      );
      if (existing.rows.length > 0) {
        throw createError(
          'มีงวดวันออกรางวัลนี้อยู่แล้ว ไม่สามารถสร้างซ้ำได้ (หากผู้ดูแลระบบสร้างไว้แล้ว ผู้ปฏิบัติงานจะเพิ่มซ้ำไม่ได้)',
          409,
        );
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
      const result_1top_all = Array.from(new Set(result_3top.split('')));
      const result_1bottom_all = Array.from(new Set(result_2bottom.split('')));

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
        '1digit_top':    new Set(result_1top_all),
        '1digit_bottom': new Set(result_1bottom_all),
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
        prize_1top:    result_1top_all,
        prize_1bottom: result_1bottom_all,
        prize_1top_legacy: result_1top,
        prize_1bottom_legacy: result_1bottom,
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

// ─── GET /api/rounds/:id/export — export full round data as JSON ──────────────
router.get(
  '/:id/export',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const id = z.string().uuid().parse(req.params.id);
      const exportData = await buildRoundExportBundle(id);
      if (!exportData) throw createError('Round not found', 404);
      const round = exportData.round as { name: string; draw_date: string };
      const roundName = String(round.name).replace(/[/\\?%*:|"<>]/g, '-');
      const drawDate  = String(round.draw_date).slice(0, 10);
      const filename  = `aurax-${drawDate}-${roundName}.json`;

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.json(exportData);
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/rounds/import — import หนึ่งงวด หรือหลายงวด (backup แบบ bulk) ───
router.post(
  '/import',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const raw = req.body as Record<string, unknown>;

      if (Array.isArray(raw.rounds)) {
        const results: Array<{
          round_id: string;
          imported: boolean;
          bet_count: number;
          message?: string;
        }> = [];
        for (const pack of raw.rounds) {
          const parsed = roundPackSchema.parse(pack);
          const r = await importOneRoundPack(parsed, req.user!.sub);
          results.push({
            round_id: r.round_id,
            imported: r.imported,
            bet_count: r.bet_count,
            message: r.message,
          });
        }
        const importedCount = results.filter((x) => x.imported).length;
        return res.json({
          ok: true,
          bulk: true,
          imported_count: importedCount,
          results,
        });
      }

      const body = roundPackSchema.parse(raw);

      const r = await importOneRoundPack(body, req.user!.sub);
      if (!r.imported) {
        return res.json({
          ok: true,
          round_id: r.round_id,
          imported: false,
          message: r.message ?? 'งวดนี้มีอยู่แล้วในระบบ',
        });
      }
      res.json({ ok: true, round_id: r.round_id, imported: true, bet_count: r.bet_count });
    } catch (err) {
      next(err);
    }
  },
);

export default router;

