import { Router, Request, Response, NextFunction } from 'express';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { query, withTransaction } from '../config/database';
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

function num(v: unknown, def = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function optRate(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseDealerImportRow(raw: Record<string, unknown>) {
  const id = z.string().uuid().parse(raw.id);
  const name = z.string().min(1).max(100).parse(raw.name);
  const sender_name = raw.sender_name != null && String(raw.sender_name).trim() !== ''
    ? z.string().max(100).parse(String(raw.sender_name))
    : null;
  const keep = num(raw.keep_net_pct, 100);
  const keep_net_pct = keep >= 1 && keep <= 100 ? keep : 100;
  return {
    id,
    name,
    sender_name,
    pct_3top: num(raw.pct_3top, 0),
    pct_3tote: num(raw.pct_3tote, 0),
    pct_3back: num(raw.pct_3back, 0),
    pct_2top: num(raw.pct_2top, 0),
    pct_2bottom: num(raw.pct_2bottom, 0),
    pct_1top: num(raw.pct_1top, 0),
    pct_1bottom: num(raw.pct_1bottom, 0),
    rate_3top: optRate(raw.rate_3top),
    rate_3tote: optRate(raw.rate_3tote),
    rate_3back: optRate(raw.rate_3back),
    rate_2top: optRate(raw.rate_2top),
    rate_2bottom: optRate(raw.rate_2bottom),
    rate_1top: optRate(raw.rate_1top),
    rate_1bottom: optRate(raw.rate_1bottom),
    keep_net_pct,
    is_active: raw.is_active === false ? false : true,
    created_at:
      raw.created_at != null && String(raw.created_at)
        ? new Date(String(raw.created_at))
        : new Date(),
  };
}

async function upsertDealer(client: PoolClient, r: ReturnType<typeof parseDealerImportRow>) {
  const ca = Number.isNaN(r.created_at.getTime()) ? new Date() : r.created_at;
  await client.query(
    `INSERT INTO dealers (
       id, name, sender_name,
       pct_3top, pct_3tote, pct_3back, pct_2top, pct_2bottom, pct_1top, pct_1bottom,
       rate_3top, rate_3tote, rate_3back, rate_2top, rate_2bottom, rate_1top, rate_1bottom,
       keep_net_pct, is_active, created_at, updated_at
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,NOW()
     )
     ON CONFLICT (id) DO UPDATE SET
       name = EXCLUDED.name,
       sender_name = EXCLUDED.sender_name,
       pct_3top = EXCLUDED.pct_3top,
       pct_3tote = EXCLUDED.pct_3tote,
       pct_3back = EXCLUDED.pct_3back,
       pct_2top = EXCLUDED.pct_2top,
       pct_2bottom = EXCLUDED.pct_2bottom,
       pct_1top = EXCLUDED.pct_1top,
       pct_1bottom = EXCLUDED.pct_1bottom,
       rate_3top = EXCLUDED.rate_3top,
       rate_3tote = EXCLUDED.rate_3tote,
       rate_3back = EXCLUDED.rate_3back,
       rate_2top = EXCLUDED.rate_2top,
       rate_2bottom = EXCLUDED.rate_2bottom,
       rate_1top = EXCLUDED.rate_1top,
       rate_1bottom = EXCLUDED.rate_1bottom,
       keep_net_pct = EXCLUDED.keep_net_pct,
       is_active = EXCLUDED.is_active,
       updated_at = NOW()`,
    [
      r.id, r.name, r.sender_name,
      r.pct_3top, r.pct_3tote, r.pct_3back, r.pct_2top, r.pct_2bottom, r.pct_1top, r.pct_1bottom,
      r.rate_3top, r.rate_3tote, r.rate_3back, r.rate_2top, r.rate_2bottom, r.rate_1top, r.rate_1bottom,
      r.keep_net_pct, r.is_active, ca,
    ],
  );
}

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

// ─── GET /api/dealers/export — JSON สำรอง ───────────────────────────────────
// ค่าเริ่มต้นเหมือนหน้ารายการ: เฉพาะ is_active (กดลบ = soft delete ยังอยู่ในฐานข้อมูล)
// ?include_inactive=1 — ส่งออกทุกแถว (ย้ายเครื่อง / กู้คืนรายการที่ซ่อน)
router.get(
  '/export',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const all =
        req.query.include_inactive === '1' ||
        req.query.all === '1';
      const result = await query(
        all
          ? 'SELECT * FROM dealers ORDER BY name ASC'
          : 'SELECT * FROM dealers WHERE is_active = true ORDER BY name ASC',
      );
      const date = new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="aurax-dealers-${date}.json"`,
      );
      res.json({
        _meta: {
          version: 1,
          kind: 'dealers' as const,
          exported_at: new Date().toISOString(),
          app: 'AuraX',
          export_scope: all ? 'all_rows' : 'active_only',
        },
        dealers: result.rows,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── POST /api/dealers/import — upsert ตาม id ─────────────────────────────────
router.post(
  '/import',
  authorize('admin'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = z
        .object({ dealers: z.array(z.record(z.unknown())).min(1) })
        .parse(req.body);

      const errors: { index: number; message: string }[] = [];
      const rows: ReturnType<typeof parseDealerImportRow>[] = [];
      body.dealers.forEach((raw, index) => {
        try {
          rows.push(parseDealerImportRow(raw as Record<string, unknown>));
        } catch (e) {
          errors.push({
            index,
            message: e instanceof z.ZodError ? e.message : String(e),
          });
        }
      });

      if (errors.length > 0) {
        res.status(400).json({
          ok: false,
          error: 'ข้อมูลบางแถวไม่ถูกต้อง',
          errors: errors.slice(0, 20),
          error_count: errors.length,
        });
        return;
      }

      const count = await withTransaction(async (client) => {
        for (const r of rows) {
          await upsertDealer(client, r);
        }
        return rows.length;
      });

      res.json({ ok: true, imported: count });
    } catch (err) {
      next(err);
    }
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
