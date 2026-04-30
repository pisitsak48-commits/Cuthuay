import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate } from '../middleware/auth';
import { BetRow } from '../models/types';
import { calculateRisk } from '../services/riskEngine';
import { generateRoundReport } from '../services/reportService';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';

const router = Router();
router.use(authenticate);

/** อัตราคอมที่ตั้งในลูกค้า (หลายช่อง) → สตริงแสดงบนการ์ดสรุป เช่น "20%" หรือ "20% · 5%" */
type CustomerPctRow = {
  pct_3top: string; pct_3tote: string; pct_3back: string;
  pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
};

function formatCustomerCommissionDisplay(c: CustomerPctRow | undefined): string {
  if (!c) return '—';
  const keys = ['pct_3top', 'pct_3tote', 'pct_3back', 'pct_2top', 'pct_2bottom', 'pct_1top', 'pct_1bottom'] as const;
  const set = new Set<string>();
  for (const k of keys) {
    const v = parseFloat(c[k] ?? '0');
    if (Number.isNaN(v)) continue;
    const r = Math.round(v * 100) / 100;
    set.add(String(r));
  }
  const nums = Array.from(set).map(Number).sort((a, b) => a - b);
  if (nums.length === 0 || (nums.length === 1 && nums[0] === 0)) return '0%';
  if (nums.length === 1) return `${nums[0]}%`;
  return nums.map((n) => `${n}%`).join(' · ');
}

// GET /api/reports/dashboard — overall stats
router.get('/dashboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const [roundsResult, betsResult, recentResult] = await Promise.all([
      query(`
        SELECT status, COUNT(*) as count FROM rounds GROUP BY status
      `),
      query(`
        SELECT COUNT(*) as total_bets, COALESCE(SUM(amount), 0) as total_revenue
        FROM bets b
        JOIN rounds r ON b.round_id = r.id
        WHERE r.status = 'open'
      `),
      query(`
        SELECT r.id, r.name, r.draw_date, r.status,
               COUNT(b.id) as bet_count,
               COALESCE(SUM(b.amount), 0) as total_revenue
        FROM rounds r
        LEFT JOIN bets b ON b.round_id = r.id
        GROUP BY r.id
        ORDER BY r.draw_date DESC
        LIMIT 10
      `),
    ]);

    res.json({
      round_stats: roundsResult.rows,
      active_bets: betsResult.rows[0],
      recent_rounds: recentResult.rows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:roundId/summary
router.get('/:roundId/summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const bets = (
      await query<BetRow>('SELECT * FROM bets WHERE round_id = $1', [roundId])
    ).rows;
    const report = calculateRisk(bets, roundId);

    // Bet breakdown by type
    const breakdown = await query(
      `SELECT bet_type, COUNT(*) as count, SUM(amount) as total
       FROM bets WHERE round_id = $1 GROUP BY bet_type`,
      [roundId],
    );

    res.json({ ...report, breakdown: breakdown.rows });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:roundId/pdf — download PDF report
router.get(
  '/:roundId/pdf',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);

      const [roundResult, betsResult, limitsResult, cutPlansResult] = await Promise.all([
        query('SELECT * FROM rounds WHERE id = $1', [roundId]),
        query<BetRow>('SELECT * FROM bets WHERE round_id = $1', [roundId]),
        query('SELECT * FROM number_limits WHERE round_id = $1', [roundId]),
        query(
          'SELECT * FROM cut_plans WHERE round_id = $1 ORDER BY created_at DESC LIMIT 1',
          [roundId],
        ),
      ]);

      const round = roundResult.rows[0] as any;
      const bets = betsResult.rows;
      const riskReport = calculateRisk(bets, roundId);
      const latestCutPlan = cutPlansResult.rows[0] as any;

      const reportsDir = env.REPORTS_DIR;
      if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir, { recursive: true });

      const filePath = path.join(reportsDir, `report_${roundId}_${Date.now()}.pdf`);
      await generateRoundReport(round, riskReport, bets, latestCutPlan, filePath);

      res.download(filePath, `report_${round?.name ?? roundId}.pdf`, (err) => {
        if (err) next(err);
        // Clean up temp file
        fs.unlink(filePath, () => {});
      });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/reports/:roundId/bet-view — dense per-number view with sold/sent/remaining
router.get('/:roundId/bet-view', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const betTypeFilter = req.query.bet_type as string | undefined;

    // 1. Aggregate sold amounts — use parameterized query to avoid SQL injection
    const soldParams: unknown[] = [roundId];
    let whereExtra = '';
    if (betTypeFilter) {
      soldParams.push(betTypeFilter);
      whereExtra = `AND bet_type = $${soldParams.length}`;
    }
    const soldRes = await query<{ number: string; bet_type: string; total_sold: string }>(
      `SELECT number, bet_type, SUM(amount) as total_sold
       FROM bets WHERE round_id = $1 ${whereExtra}
       GROUP BY number, bet_type
       ORDER BY number, bet_type`,
      soldParams,
    );

    // 2. Get latest cut plan
    // NOTE: 'cuts' is jsonb — pg driver already parses it to an object, no JSON.parse needed
    const planRes = await query<{ cuts: unknown }>(
      `SELECT cuts FROM cut_plans WHERE round_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [roundId],
    );
    const cutMap: Record<string, number> = {};
    if (planRes.rows[0]?.cuts) {
      const raw = planRes.rows[0].cuts;
      const cuts = (typeof raw === 'string'
        ? JSON.parse(raw)
        : raw) as Array<{ number: string; bet_type: string; cut_amount: number }>;
      for (const c of cuts) {
        if (!betTypeFilter || c.bet_type === betTypeFilter) {
          cutMap[`${c.number}||${c.bet_type}`] = (cutMap[`${c.number}||${c.bet_type}`] ?? 0) + c.cut_amount;
        }
      }
    }

    // 3. Build rows
    const rows = soldRes.rows.map((r) => {
      const sold = parseFloat(r.total_sold);
      const sent = cutMap[`${r.number}||${r.bet_type}`] ?? 0;
      return { number: r.number, bet_type: r.bet_type, sold, sent, remaining: sold - sent };
    });

    const total_sold      = rows.reduce((s, r) => s + r.sold, 0);
    const total_sent      = rows.reduce((s, r) => s + r.sent, 0);
    const total_remaining = rows.reduce((s, r) => s + r.remaining, 0);

    res.json({ rows, total_sold, total_sent, total_remaining });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:roundId/profit-summary — full P&L summary after draw
router.get('/:roundId/profit-summary', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);

    // Fetch round + result_data
    const roundRes = await query<{
      id: string; name: string; draw_date: string; result_number: string | null;
      result_data: unknown; dealer_id: string | null;
    }>('SELECT id, name, draw_date, result_number, result_data, dealer_id FROM rounds WHERE id = $1', [roundId]);
    const round = roundRes.rows[0];
    if (!round) return res.status(404).json({ error: 'Round not found' });

    // Parse result data
    const rd = (typeof round.result_data === 'string'
      ? JSON.parse(round.result_data) : round.result_data) as Record<string, unknown> | null;

    let winSets: Record<string, Set<string>> = {};
    if (rd) {
      const str = (v: unknown) => (Array.isArray(v) ? v : [v]).map(String);
      winSets = {
        '3digit_top':    new Set(str(rd.prize_3top)),
        '3digit_tote':   new Set(str(rd.tote_numbers)),
        '3digit_back':   new Set(str(rd.prize_3bottom)),
        '2digit_top':    new Set(str(rd.prize_2top)),
        '2digit_bottom': new Set(str(rd.prize_2bottom)),
        '1digit_top':    new Set(str(rd.prize_1top)),
        '1digit_bottom': new Set(str(rd.prize_1bottom)),
      };
    }

    // Fetch number limits for this round (for payout override calculation)
    const limitsRes = await query<{
      number: string; bet_type: string; entity_type: string; entity_id: string | null;
      custom_payout: string | null; payout_pct: string; is_blocked: boolean;
    }>(
      `SELECT number, bet_type, entity_type, entity_id, custom_payout, payout_pct, is_blocked
       FROM number_limits WHERE round_id = $1`,
      [roundId],
    );
    // Build a lookup: key = `number||bet_type` → array of limits
    const limitsMap = new Map<string, typeof limitsRes.rows>();
    for (const lim of limitsRes.rows) {
      const k = `${lim.number}||${lim.bet_type}`;
      if (!limitsMap.has(k)) limitsMap.set(k, []);
      limitsMap.get(k)!.push(lim);
    }
    /** Get effective payout rate for a bet, considering number limits */
    const getEffectiveRateWithLimits = (
      cid: string | null, betType: string, number: string, baseRate: number,
    ): number => {
      const k = `${number}||${betType}`;
      const lims = limitsMap.get(k);
      if (!lims || !lims.length) return baseRate;
      // Priority: entity-specific > 'all'
      const exact = lims.find(l => l.entity_type === 'customer' && l.entity_id === cid);
      const global = lims.find(l => l.entity_type === 'all');
      const chosen = exact ?? global;
      if (!chosen) return baseRate;
      if (chosen.is_blocked) return 0; // blocked = 0 payout
      if (chosen.custom_payout) return parseFloat(chosen.custom_payout);
      const pct = parseFloat(chosen.payout_pct);
      if (pct > 0 && pct !== 100) return baseRate * pct / 100;
      return baseRate;
    };

    // Fetch all bets
    const betsRes = await query<{      id: string; number: string; bet_type: string;
      amount: string; payout_rate: string;
      customer_id: string | null; customer_ref: string | null;
      sheet_no: number;
    }>(
      `SELECT b.id, b.number, b.bet_type, b.amount, b.payout_rate,
              b.customer_id, b.customer_ref, b.sheet_no
       FROM bets b WHERE b.round_id = $1`, [roundId],
    );
    const bets = betsRes.rows;

    // Fetch customers (with their configured payout rates)
    const custRes = await query<{
      id: string; name: string;
      pct_3top: string; pct_3tote: string; pct_3back: string;
      pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
      rate_3top: string | null; rate_3tote: string | null; rate_3back: string | null;
      rate_2top: string | null; rate_2bottom: string | null;
      rate_1top: string | null; rate_1bottom: string | null;
    }>(
      `SELECT DISTINCT c.id, c.name,
              c.pct_3top, c.pct_3tote, c.pct_3back, c.pct_2top, c.pct_2bottom, c.pct_1top, c.pct_1bottom,
              c.rate_3top, c.rate_3tote, c.rate_3back,
              c.rate_2top, c.rate_2bottom, c.rate_1top, c.rate_1bottom
       FROM customers c
       INNER JOIN bets b ON b.customer_id = c.id AND b.round_id = $1`, [roundId],
    );
    const custMap = new Map(custRes.rows.map(c => [c.id, c]));

    // Per-type pct map for customers
    const PCT_MAP: Record<string, string> = {
      '3digit_top': 'pct_3top', '3digit_tote': 'pct_3tote', '3digit_back': 'pct_3back',
      '2digit_top': 'pct_2top', '2digit_bottom': 'pct_2bottom',
      '1digit_top': 'pct_1top', '1digit_bottom': 'pct_1bottom',
    };
    const getCustCommRate = (cid: string, betType: string): number => {
      const c = custMap.get(cid);
      if (!c) return 0;
      const key = PCT_MAP[betType];
      return key ? parseFloat((c as unknown as Record<string, string>)[key] ?? '0') : 0;
    };

    // Helper: get effective payout rate for a customer + bet_type
    // Uses the customer's configured rate first, falls back to the stored bet rate
    const getEffectiveRate = (
      cid: string, betType: string, storedRate: string,
    ): number => {
      const c = custMap.get(cid);
      if (c) {
        const rateMap: Record<string, string | null> = {
          '3digit_top':    c.rate_3top,
          '3digit_tote':   c.rate_3tote,
          '3digit_back':   c.rate_3back,
          '2digit_top':    c.rate_2top,
          '2digit_bottom': c.rate_2bottom,
          '1digit_top':    c.rate_1top,
          '1digit_bottom': c.rate_1bottom,
        };
        const r = rateMap[betType];
        if (r != null) {
          const v = parseFloat(r);
          if (v > 0) return v;
        }
      }
      return parseFloat(storedRate);
    };

    // Determine winning bets
    const isWin = (bet_type: string, number: string): boolean =>
      winSets[bet_type]?.has(number) ?? false;

    // Per-customer aggregation
    interface CustSummary {
      customer_id: string; name: string;
      commission_display: string;
      sold: number; pct_sold: number; remaining_sold: number;
      payout: number; net: number;
      by_type: Record<string, { sold: number; pct: number; payout: number }>;
      by_sheet: Record<number, { sold: number; pct: number; payout: number }>;
      /** แยกยอดตามแผ่น × ประเภท (คีย์แผ่นเป็น string จาก JSON) */
      by_sheet_by_type: Record<string, Record<string, { sold: number; pct: number; payout: number }>>;
    }
    const custSummaryMap = new Map<string, CustSummary>();

    const BET_TYPES = ['3digit_top','3digit_tote','3digit_back','2digit_top','2digit_bottom','1digit_top','1digit_bottom'];

    for (const bet of bets) {
      const cid = bet.customer_id ?? '__none__';
      const c = custMap.get(cid);
      const commRate = getCustCommRate(cid, bet.bet_type);
      const name = c?.name ?? (bet.customer_ref ?? 'ไม่ระบุ');
      if (!custSummaryMap.has(cid)) {
        const by_type: Record<string, { sold: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { by_type[t] = { sold: 0, pct: 0, payout: 0 }; });
        custSummaryMap.set(cid, {
          customer_id: cid, name,
          commission_display: formatCustomerCommissionDisplay(c as CustomerPctRow | undefined),
          sold: 0, pct_sold: 0, remaining_sold: 0, payout: 0, net: 0,
          by_type, by_sheet: {}, by_sheet_by_type: {},
        });
      }
      const cs = custSummaryMap.get(cid)!;
      const amt = parseFloat(bet.amount);
      const pctAmt = amt * commRate / 100;
      const won = isWin(bet.bet_type, bet.number);
      const baseRate = getEffectiveRate(cid, bet.bet_type, bet.payout_rate);
      const effectiveRate = getEffectiveRateWithLimits(bet.customer_id, bet.bet_type, bet.number, baseRate);
      const payoutAmt = won ? amt * effectiveRate : 0;

      cs.sold       += amt;
      cs.pct_sold   += pctAmt;
      cs.payout     += payoutAmt;

      if (cs.by_type[bet.bet_type]) {
        cs.by_type[bet.bet_type].sold   += amt;
        cs.by_type[bet.bet_type].pct    += pctAmt;
        cs.by_type[bet.bet_type].payout += payoutAmt;
      }

      // By sheet
      const sn = bet.sheet_no ?? 1;
      if (!cs.by_sheet[sn]) cs.by_sheet[sn] = { sold: 0, pct: 0, payout: 0 };
      cs.by_sheet[sn].sold   += amt;
      cs.by_sheet[sn].pct    += pctAmt;
      cs.by_sheet[sn].payout += payoutAmt;

      const snKey = String(sn);
      if (!cs.by_sheet_by_type[snKey]) {
        const empty: Record<string, { sold: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { empty[t] = { sold: 0, pct: 0, payout: 0 }; });
        cs.by_sheet_by_type[snKey] = empty;
      }
      const sbt = cs.by_sheet_by_type[snKey];
      if (sbt[bet.bet_type]) {
        sbt[bet.bet_type].sold += amt;
        sbt[bet.bet_type].pct += pctAmt;
        sbt[bet.bet_type].payout += payoutAmt;
      }
    }

    // All summaries (including null-customer bets) for correct totals
    const allCustSummaries = Array.from(custSummaryMap.values()).map(cs => {
      cs.remaining_sold = cs.sold - cs.pct_sold;
      cs.net = cs.remaining_sold - cs.payout;
      return cs;
    });
    // Only linked customers shown in per-customer list
    const customers = allCustSummaries.filter(cs => cs.customer_id !== '__none__');

    // Totals — selling side (includes unlinked bets)
    const totalSold       = allCustSummaries.reduce((s, c) => s + c.sold, 0);
    const totalPctSold    = allCustSummaries.reduce((s, c) => s + c.pct_sold, 0);
    const totalRemSold    = totalSold - totalPctSold;
    const totalPayoutSold = allCustSummaries.reduce((s, c) => s + c.payout, 0);
    const totalNetSold    = totalRemSold - totalPayoutSold;

    // Per-type totals (selling side, includes unlinked bets)
    const byTypeSell: Record<string, { sold: number; pct: number; payout: number; net: number }> = {};
    BET_TYPES.forEach(t => { byTypeSell[t] = { sold: 0, pct: 0, payout: 0, net: 0 }; });
    for (const cs of allCustSummaries) {
      for (const t of BET_TYPES) {
        byTypeSell[t].sold   += cs.by_type[t]?.sold   ?? 0;
        byTypeSell[t].pct    += cs.by_type[t]?.pct    ?? 0;
        byTypeSell[t].payout += cs.by_type[t]?.payout ?? 0;
      }
    }
    for (const t of BET_TYPES) {
      byTypeSell[t].net = byTypeSell[t].sold - byTypeSell[t].pct - byTypeSell[t].payout;
    }

    // Dealer / cut side
    // Fetch both send_batches (confirmed sends) and cut_plans (fallback)
    const [sendBatchesRes, planRes] = await Promise.all([
      query<{
        id: string; bet_type: string; items: unknown; total: string;
        dealer_id: string | null; dealer_name: string | null;
      }>(
        `SELECT id, bet_type, items, total, dealer_id, dealer_name
         FROM send_batches WHERE round_id = $1 ORDER BY created_at ASC`,
        [roundId],
      ),
      query<{ cuts: unknown; dealer_rates: unknown }>(
        `SELECT cuts, dealer_rates FROM cut_plans WHERE round_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [roundId],
      ),
    ]);
    const plan = planRes.rows[0];
    const sendBatches = sendBatchesRes.rows;

    interface DealerSummary {
      dealer_id: string; name: string;
      sent: number; pct_sent: number; remaining_sent: number;
      payout: number; net: number;
      by_type: Record<string, { sent: number; pct: number; payout: number }>;
    }
    const dealerSummaries: DealerSummary[] = [];

    // ── Path A: use send_batches when they exist ──────────────────────────────
    if (sendBatches.length > 0) {
      // Collect unique dealer_ids from batches; fallback to round.dealer_id
      const batchDealerIds = new Set(
        sendBatches.map(b => b.dealer_id ?? round.dealer_id ?? 'unknown'),
      );

      // Fetch dealer rate rows for those ids
      const knownIds = [...batchDealerIds].filter(id => id !== 'unknown');
      const dealerRatesMap = new Map<string, {
        name: string;
        pct_3top: number; pct_3tote: number; pct_3back: number;
        pct_2top: number; pct_2bottom: number; pct_1top: number; pct_1bottom: number;
        rate_3top: number; rate_3tote: number; rate_3back: number;
        rate_2top: number; rate_2bottom: number; rate_1top: number; rate_1bottom: number;
      }>();
      if (knownIds.length > 0) {
        // Use parameterized query with ANY($1::uuid[]) — safe, no interpolation
        const drRes = await query<{
          id: string; name: string;
          pct_3top: string; pct_3tote: string; pct_3back: string;
          pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
          rate_3top: string | null; rate_3tote: string | null; rate_3back: string | null;
          rate_2top: string | null; rate_2bottom: string | null;
          rate_1top: string | null; rate_1bottom: string | null;
        }>(
          `SELECT id, name,
                  pct_3top, pct_3tote, pct_3back, pct_2top, pct_2bottom, pct_1top, pct_1bottom,
                  rate_3top, rate_3tote, rate_3back, rate_2top, rate_2bottom, rate_1top, rate_1bottom
           FROM dealers WHERE id = ANY($1::uuid[])`,
          [knownIds],
        );
        for (const dr of drRes.rows) {
          dealerRatesMap.set(dr.id, {
            name: dr.name,
            pct_3top:    Number(dr.pct_3top    ?? 0), pct_3tote:   Number(dr.pct_3tote   ?? 0),
            pct_3back:   Number(dr.pct_3back   ?? 0), pct_2top:    Number(dr.pct_2top    ?? 0),
            pct_2bottom: Number(dr.pct_2bottom ?? 0), pct_1top:    Number(dr.pct_1top    ?? 0),
            pct_1bottom: Number(dr.pct_1bottom ?? 0),
            rate_3top:    Number(dr.rate_3top    ?? 0), rate_3tote:  Number(dr.rate_3tote  ?? 0),
            rate_3back:   Number(dr.rate_3back   ?? 0), rate_2top:   Number(dr.rate_2top   ?? 0),
            rate_2bottom: Number(dr.rate_2bottom ?? 0), rate_1top:   Number(dr.rate_1top   ?? 0),
            rate_1bottom: Number(dr.rate_1bottom ?? 0),
          });
        }
      }

      for (const did of batchDealerIds) {
        const dr = dealerRatesMap.get(did);
        // Resolve display name: from DB rates, then from any batch's dealer_name, then fallback
        const batchWithName = sendBatches.find(b => (b.dealer_id ?? round.dealer_id ?? 'unknown') === did && b.dealer_name);
        const dealerName = dr?.name ?? batchWithName?.dealer_name ?? 'เจ้ามือ';

        const pctMap: Record<string, number> = {
          '3digit_top': dr?.pct_3top ?? 0, '3digit_tote': dr?.pct_3tote ?? 0,
          '3digit_back': dr?.pct_3back ?? 0, '2digit_top': dr?.pct_2top ?? 0,
          '2digit_bottom': dr?.pct_2bottom ?? 0, '1digit_top': dr?.pct_1top ?? 0,
          '1digit_bottom': dr?.pct_1bottom ?? 0,
        };
        const rateMap: Record<string, number> = {
          '3digit_top': dr?.rate_3top ?? 0, '3digit_tote': dr?.rate_3tote ?? 0,
          '3digit_back': dr?.rate_3back ?? 0, '2digit_top': dr?.rate_2top ?? 0,
          '2digit_bottom': dr?.rate_2bottom ?? 0, '1digit_top': dr?.rate_1top ?? 0,
          '1digit_bottom': dr?.rate_1bottom ?? 0,
        };

        const by_type: Record<string, { sent: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { by_type[t] = { sent: 0, pct: 0, payout: 0 }; });

        const batchesForDealer = sendBatches.filter(
          b => (b.dealer_id ?? round.dealer_id ?? 'unknown') === did,
        );

        for (const batch of batchesForDealer) {
          const items = (typeof batch.items === 'string'
            ? JSON.parse(batch.items) : batch.items) as Array<{ number: string; amount: number }>;
          for (const item of items) {
            const sentAmt    = item.amount ?? 0;
            const pctAmt     = sentAmt * (pctMap[batch.bet_type] ?? 0) / 100;
            const won        = isWin(batch.bet_type, item.number);
            const baseRate   = rateMap[batch.bet_type] ?? 0;
            const effRate    = getEffectiveRateWithLimits(null, batch.bet_type, item.number, baseRate);
            const payAmt     = won ? sentAmt * effRate : 0;

            if (by_type[batch.bet_type]) {
              by_type[batch.bet_type].sent   += sentAmt;
              by_type[batch.bet_type].pct    += pctAmt;
              by_type[batch.bet_type].payout += payAmt;
            }
          }
        }

        let sent = 0, pct_sent = 0, payout = 0;
        for (const t of BET_TYPES) {
          sent     += by_type[t].sent;
          pct_sent += by_type[t].pct;
          payout   += by_type[t].payout;
        }
        const remaining_sent = sent - pct_sent;
        dealerSummaries.push({
          dealer_id: did, name: dealerName,
          sent, pct_sent, remaining_sent,
          payout, net: payout - remaining_sent,
          by_type,
        });
      }
    }

    // ── Path B: fallback to cut_plans when no send_batches exist ─────────────
    if (sendBatches.length === 0 && plan) {
      const parsedCuts = (typeof plan.cuts === 'string' ? JSON.parse(plan.cuts) : plan.cuts) as Array<{
        number: string; bet_type: string; cut_amount: number; dealer_id?: string;
      }>;
      const parsedRates = (typeof plan.dealer_rates === 'string'
        ? JSON.parse(plan.dealer_rates) : plan.dealer_rates) as Record<string, {
          id: string; name: string;
          pct_3top?: number; pct_3tote?: number; pct_3back?: number;
          pct_2top?: number; pct_2bottom?: number; pct_1top?: number; pct_1bottom?: number;
          rate_3top?: number; rate_3tote?: number; rate_3back?: number;
          rate_2top?: number; rate_2bottom?: number; rate_1top?: number; rate_1bottom?: number;
        }>;

      // If no dealer_id on cuts, use round.dealer_id
      const dealerIds = new Set(parsedCuts.map(c => c.dealer_id ?? round.dealer_id ?? 'unknown'));

      for (const did of dealerIds) {
        const dr = parsedRates[did] ?? Object.values(parsedRates)[0];
        const dealerName = dr?.name ?? 'เจ้ามือ';

        const pctMap: Record<string, number> = {
          '3digit_top': dr?.pct_3top ?? 0, '3digit_tote': dr?.pct_3tote ?? 0,
          '3digit_back': dr?.pct_3back ?? 0, '2digit_top': dr?.pct_2top ?? 0,
          '2digit_bottom': dr?.pct_2bottom ?? 0, '1digit_top': dr?.pct_1top ?? 0,
          '1digit_bottom': dr?.pct_1bottom ?? 0,
        };
        const rateMap: Record<string, number> = {
          '3digit_top': dr?.rate_3top ?? 0, '3digit_tote': dr?.rate_3tote ?? 0,
          '3digit_back': dr?.rate_3back ?? 0, '2digit_top': dr?.rate_2top ?? 0,
          '2digit_bottom': dr?.rate_2bottom ?? 0, '1digit_top': dr?.rate_1top ?? 0,
          '1digit_bottom': dr?.rate_1bottom ?? 0,
        };

        const by_type: Record<string, { sent: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { by_type[t] = { sent: 0, pct: 0, payout: 0 }; });

        const cutsForDealer = parsedCuts.filter(c =>
          c.dealer_id === did || (!c.dealer_id && (did === round.dealer_id || did === 'unknown')));

        for (const cut of cutsForDealer) {
          const sentAmt  = cut.cut_amount ?? 0;
          const pctAmt   = sentAmt * (pctMap[cut.bet_type] ?? 0) / 100;
          const won      = isWin(cut.bet_type, cut.number);
          const baseRate = rateMap[cut.bet_type] ?? 0;
          const effRate  = getEffectiveRateWithLimits(null, cut.bet_type, cut.number, baseRate);
          const payAmt   = won ? sentAmt * effRate : 0;

          if (by_type[cut.bet_type]) {
            by_type[cut.bet_type].sent   += sentAmt;
            by_type[cut.bet_type].pct    += pctAmt;
            by_type[cut.bet_type].payout += payAmt;
          }
        }

        let sent = 0, pct_sent = 0, payout = 0;
        for (const t of BET_TYPES) {
          sent    += by_type[t].sent;
          pct_sent += by_type[t].pct;
          payout  += by_type[t].payout;
        }
        const remaining_sent = sent - pct_sent;
        dealerSummaries.push({
          dealer_id: did, name: dealerName,
          sent, pct_sent, remaining_sent,
          payout, net: payout - remaining_sent,
          by_type,
        });
      }
    }

    const totalSent      = dealerSummaries.reduce((s, d) => s + d.sent, 0);
    const totalPctSent   = dealerSummaries.reduce((s, d) => s + d.pct_sent, 0);
    const totalRemSent   = totalSent - totalPctSent;
    const totalPaySent   = dealerSummaries.reduce((s, d) => s + d.payout, 0);
    const totalNetSent   = totalPaySent - totalRemSent;

    const profit = totalNetSold + totalNetSent;

    // ── Number-level stats ─────────────────────────────────────────────────
    const TOTAL_NUMS_BY_TYPE: Record<string, number> = {
      '3digit_top': 1000, '3digit_tote': 1000, '3digit_back': 1000,
      '2digit_top': 100,  '2digit_bottom': 100,
      '1digit_top': 10,   '1digit_bottom': 10,
    };
    const soldByType = new Map<string, Set<string>>();
    const perNumberAmt = new Map<string, number>();
    for (const bet of bets) {
      if (!soldByType.has(bet.bet_type)) soldByType.set(bet.bet_type, new Set());
      soldByType.get(bet.bet_type)!.add(bet.number);
      const k = `${bet.number}||${bet.bet_type}`;
      perNumberAmt.set(k, (perNumberAmt.get(k) ?? 0) + parseFloat(bet.amount));
    }
    // นับเฉพาะ bet_type ที่มีการแทงจริงในงวดนี้
    const unsold_by_type: Record<string, number> = {};
    let unsold_count = 0;
    for (const bt of [...soldByType.keys()]) {
      const u = (TOTAL_NUMS_BY_TYPE[bt] ?? 0) - (soldByType.get(bt)?.size ?? 0);
      unsold_by_type[bt] = u;
      unsold_count += u;
    }
    const numAmounts = [...perNumberAmt.values()];
    const min_bet_per_number = numAmounts.length > 0 ? Math.min(...numAmounts) : 0;
    const max_bet_per_number = numAmounts.length > 0 ? Math.max(...numAmounts) : 0;

    res.json({
      round: { id: round.id, name: round.name, draw_date: round.draw_date, result_data: rd },
      profit,
      sell: {
        total: totalSold, pct: totalPctSold, remaining: totalRemSold,
        payout: totalPayoutSold, net: totalNetSold,
      },
      send: {
        total: totalSent, pct: totalPctSent, remaining: totalRemSent,
        payout: totalPaySent, net: totalNetSent,
      },
      unsold_count,
      unsold_by_type,
      min_bet_per_number,
      max_bet_per_number,
      customers,
      dealers: dealerSummaries,
      by_type_sell: byTypeSell,
      limits: limitsRes.rows,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:roundId/dealer-wins — winning items per dealer (from send_batches)
router.get('/:roundId/dealer-wins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);

    const roundRes = await query<{
      id: string; name: string; draw_date: string; result_data: unknown; dealer_id: string | null;
    }>('SELECT id, name, draw_date, result_data, dealer_id FROM rounds WHERE id = $1', [roundId]);
    const round = roundRes.rows[0];
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const rd = (typeof round.result_data === 'string'
      ? JSON.parse(round.result_data) : round.result_data) as Record<string, unknown> | null;

    if (!rd) {
      return res.json({
        round: { id: round.id, name: round.name, draw_date: round.draw_date, result_data: null },
        dealers: [],
      });
    }

    const str = (v: unknown) => (Array.isArray(v) ? v : [v]).map(String);
    const winSets: Record<string, Set<string>> = {
      '3digit_top':    new Set(str(rd.prize_3top)),
      '3digit_tote':   new Set(str(rd.tote_numbers)),
      '3digit_back':   new Set(str(rd.prize_3bottom)),
      '2digit_top':    new Set(str(rd.prize_2top)),
      '2digit_bottom': new Set(str(rd.prize_2bottom)),
      '1digit_top':    new Set(str(rd.prize_1top)),
      '1digit_bottom': new Set(str(rd.prize_1bottom)),
    };
    const isWin = (betType: string, number: string) => winSets[betType]?.has(number) ?? false;

    // Fetch number limits for this round (to apply payout overrides for dealer)
    const dealerLimitsRes = await query<{
      number: string; bet_type: string; entity_type: string; entity_id: string | null;
      custom_payout: string | null; payout_pct: string; is_blocked: boolean;
    }>(
      `SELECT number, bet_type, entity_type, entity_id, custom_payout, payout_pct, is_blocked
       FROM number_limits WHERE round_id = $1`, [roundId],
    );
    const dealerLimitsMap = new Map<string, typeof dealerLimitsRes.rows>();
    for (const lim of dealerLimitsRes.rows) {
      const k = `${lim.number}||${lim.bet_type}`;
      if (!dealerLimitsMap.has(k)) dealerLimitsMap.set(k, []);
      dealerLimitsMap.get(k)!.push(lim);
    }
    const applyDealerLimit = (betType: string, number: string, baseRate: number): number => {
      const lims = dealerLimitsMap.get(`${number}||${betType}`);
      if (!lims?.length) return baseRate;
      const global = lims.find(l => l.entity_type === 'all');
      if (!global) return baseRate;
      if (global.is_blocked) return 0;
      if (global.custom_payout) return parseFloat(global.custom_payout);
      const pct = parseFloat(global.payout_pct);
      if (pct > 0 && pct !== 100) return baseRate * pct / 100;
      return baseRate;
    };

    // Fetch send_batches; fallback to cut_plans
    const [batchRes, planRes] = await Promise.all([
      query<{ id: string; bet_type: string; items: unknown; dealer_id: string | null; dealer_name: string | null }>(
        `SELECT id, bet_type, items, dealer_id, dealer_name FROM send_batches WHERE round_id = $1 ORDER BY created_at`,
        [roundId],
      ),
      query<{ cuts: unknown; dealer_rates: unknown }>(
        `SELECT cuts, dealer_rates FROM cut_plans WHERE round_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [roundId],
      ),
    ]);
    const batches = batchRes.rows;

    // Fetch dealer rates
    const dealerIds = new Set(batches.map(b => b.dealer_id ?? round.dealer_id ?? 'unknown').filter(Boolean));
    const knownIds = [...dealerIds].filter(id => id !== 'unknown');
    const dealerRatesMap = new Map<string, {
      name: string;
      rate_3top: number; rate_3tote: number; rate_3back: number;
      rate_2top: number; rate_2bottom: number; rate_1top: number; rate_1bottom: number;
    }>();
    if (knownIds.length > 0) {
      const drRes = await query<{
        id: string; name: string;
        rate_3top: string | null; rate_3tote: string | null; rate_3back: string | null;
        rate_2top: string | null; rate_2bottom: string | null;
        rate_1top: string | null; rate_1bottom: string | null;
      }>(
        `SELECT id, name, rate_3top, rate_3tote, rate_3back, rate_2top, rate_2bottom, rate_1top, rate_1bottom
         FROM dealers WHERE id = ANY($1::uuid[])`,
        [knownIds],
      );
      for (const dr of drRes.rows) {
        dealerRatesMap.set(dr.id, {
          name: dr.name,
          rate_3top:    Number(dr.rate_3top    ?? 0),
          rate_3tote:   Number(dr.rate_3tote   ?? 0),
          rate_3back:   Number(dr.rate_3back   ?? 0),
          rate_2top:    Number(dr.rate_2top    ?? 0),
          rate_2bottom: Number(dr.rate_2bottom ?? 0),
          rate_1top:    Number(dr.rate_1top    ?? 0),
          rate_1bottom: Number(dr.rate_1bottom ?? 0),
        });
      }
    }

    interface DealerWinItem { bet_type: string; number: string; amount: number; payout: number; }
    interface DealerWinResult { dealer_id: string; name: string; winning_items: DealerWinItem[]; total_amount: number; total_payout: number; }
    const dealerMap = new Map<string, DealerWinResult>();

    const buildDealer = (did: string, dname: string) => {
      if (!dealerMap.has(did)) dealerMap.set(did, { dealer_id: did, name: dname, winning_items: [], total_amount: 0, total_payout: 0 });
      return dealerMap.get(did)!;
    };

    // Path A: send_batches
    if (batches.length > 0) {
      for (const batch of batches) {
        const did = batch.dealer_id ?? round.dealer_id ?? 'unknown';
        const dr = dealerRatesMap.get(did);
        const dname = dr?.name ?? batch.dealer_name ?? 'เจ้ามือ';
        const rateMap: Record<string, number> = {
          '3digit_top': dr?.rate_3top ?? 0, '3digit_tote': dr?.rate_3tote ?? 0,
          '3digit_back': dr?.rate_3back ?? 0, '2digit_top': dr?.rate_2top ?? 0,
          '2digit_bottom': dr?.rate_2bottom ?? 0, '1digit_top': dr?.rate_1top ?? 0,
          '1digit_bottom': dr?.rate_1bottom ?? 0,
        };
        const items = (typeof batch.items === 'string' ? JSON.parse(batch.items) : batch.items) as Array<{ number: string; amount: number }>;
        for (const item of items) {
          if (!isWin(batch.bet_type, item.number)) continue;
          const amt      = item.amount ?? 0;
          const baseRate = rateMap[batch.bet_type] ?? 0;
          const rate     = applyDealerLimit(batch.bet_type, item.number, baseRate);
          const pay      = amt * rate;
          const ds = buildDealer(did, dname);
          ds.winning_items.push({ bet_type: batch.bet_type, number: item.number, amount: amt, payout: pay });
          ds.total_amount += amt;
          ds.total_payout += pay;
        }
      }
    } else if (planRes.rows[0]) {
      // Path B: cut_plans
      const plan = planRes.rows[0];
      const parsedCuts = (typeof plan.cuts === 'string' ? JSON.parse(plan.cuts) : plan.cuts) as Array<{
        number: string; bet_type: string; cut_amount: number; dealer_id?: string;
      }>;
      const parsedRates = (typeof plan.dealer_rates === 'string' ? JSON.parse(plan.dealer_rates) : plan.dealer_rates) as Record<string, {
        id: string; name: string;
        rate_3top?: number; rate_3tote?: number; rate_3back?: number;
        rate_2top?: number; rate_2bottom?: number; rate_1top?: number; rate_1bottom?: number;
      }>;

      for (const cut of parsedCuts) {
        if (!isWin(cut.bet_type, cut.number)) continue;
        const did = cut.dealer_id ?? round.dealer_id ?? 'unknown';
        const dr = parsedRates[did] ?? Object.values(parsedRates)[0];
        const dname = dr?.name ?? 'เจ้ามือ';
        const rateMap: Record<string, number> = {
          '3digit_top': dr?.rate_3top ?? 0, '3digit_tote': dr?.rate_3tote ?? 0,
          '3digit_back': dr?.rate_3back ?? 0, '2digit_top': dr?.rate_2top ?? 0,
          '2digit_bottom': dr?.rate_2bottom ?? 0, '1digit_top': dr?.rate_1top ?? 0,
          '1digit_bottom': dr?.rate_1bottom ?? 0,
        };
        const amt      = cut.cut_amount ?? 0;
        const baseRate = rateMap[cut.bet_type] ?? 0;
        const pay      = amt * applyDealerLimit(cut.bet_type, cut.number, baseRate);
        const ds = buildDealer(did, dname);
        ds.winning_items.push({ bet_type: cut.bet_type, number: cut.number, amount: amt, payout: pay });
        ds.total_amount += amt;
        ds.total_payout += pay;
      }
    }

    res.json({
      round: { id: round.id, name: round.name, draw_date: round.draw_date, result_data: rd },
      dealers: Array.from(dealerMap.values()),
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:roundId/customer-wins — winning bets per customer
router.get('/:roundId/customer-wins', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId   = z.string().uuid().parse(req.params.roundId);
    const custFilter = req.query.customer_id as string | undefined;

    const roundRes = await query<{
      id: string; name: string; draw_date: string; result_data: unknown;
    }>('SELECT id, name, draw_date, result_data FROM rounds WHERE id = $1', [roundId]);
    const round = roundRes.rows[0];
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const rd = (typeof round.result_data === 'string'
      ? JSON.parse(round.result_data) : round.result_data) as Record<string, unknown> | null;

    if (!rd) {
      return res.json({
        round: { id: round.id, name: round.name, draw_date: round.draw_date, result_data: null },
        customers: [],
      });
    }

    const str = (v: unknown) => (Array.isArray(v) ? v : [v]).map(String);
    const winSets: Record<string, Set<string>> = {
      '3digit_top':    new Set(str(rd.prize_3top)),
      '3digit_tote':   new Set(str(rd.tote_numbers)),
      '3digit_back':   new Set(str(rd.prize_3bottom)),
      '2digit_top':    new Set(str(rd.prize_2top)),
      '2digit_bottom': new Set(str(rd.prize_2bottom)),
      '1digit_top':    new Set(str(rd.prize_1top)),
      '1digit_bottom': new Set(str(rd.prize_1bottom)),
    };

    // Fetch limits for this round (to apply payout_pct overrides)
    const limitsRes2 = await query<{
      number: string; bet_type: string; entity_type: string; entity_id: string | null;
      custom_payout: string | null; payout_pct: string; is_blocked: boolean;
    }>(
      `SELECT number, bet_type, entity_type, entity_id, custom_payout, payout_pct, is_blocked
       FROM number_limits WHERE round_id = $1`, [roundId],
    );
    const limitsMap2 = new Map<string, typeof limitsRes2.rows>();
    for (const lim of limitsRes2.rows) {
      const k = `${lim.number}||${lim.bet_type}`;
      if (!limitsMap2.has(k)) limitsMap2.set(k, []);
      limitsMap2.get(k)!.push(lim);
    }
    const applyLimit2 = (cid: string | null, betType: string, number: string, baseRate: number): number => {
      const lims = limitsMap2.get(`${number}||${betType}`);
      if (!lims?.length) return baseRate;
      const exact  = lims.find(l => l.entity_type === 'customer' && l.entity_id === cid);
      const global = lims.find(l => l.entity_type === 'all');
      const chosen = exact ?? global;
      if (!chosen) return baseRate;
      if (chosen.is_blocked) return 0;
      if (chosen.custom_payout) return parseFloat(chosen.custom_payout);
      const pct = parseFloat(chosen.payout_pct);
      if (pct > 0 && pct !== 100) return baseRate * pct / 100;
      return baseRate;
    };

    const params: unknown[] = [roundId];
    let extraWhere = '';
    if (custFilter) {
      params.push(custFilter);
      extraWhere = ` AND b.customer_id = $2`;
    }

    const betsRes = await query<{
      id: string; number: string; bet_type: string;
      amount: string; payout_rate: string; sheet_no: number;
      customer_id: string | null; customer_ref: string | null;
      customer_name: string | null;
      rate_3top: string | null; rate_3tote: string | null; rate_3back: string | null;
      rate_2top: string | null; rate_2bottom: string | null;
      rate_1top: string | null; rate_1bottom: string | null;
    }>(
      `SELECT b.id, b.number, b.bet_type, b.amount, b.payout_rate, b.sheet_no,
              b.customer_id, b.customer_ref, c.name as customer_name,
              c.rate_3top, c.rate_3tote, c.rate_3back,
              c.rate_2top, c.rate_2bottom, c.rate_1top, c.rate_1bottom
       FROM bets b
       LEFT JOIN customers c ON c.id = b.customer_id
       WHERE b.round_id = $1${extraWhere}
       ORDER BY b.customer_id, b.sheet_no, b.bet_type, b.number`,
      params,
    );

    interface WinBet { sheet_no: number; bet_type: string; number: string; amount: number; payout: number; }
    interface CustWin { customer_id: string; name: string; winning_bets: WinBet[]; total_amount: number; total_payout: number; }
    const custMap = new Map<string, CustWin>();

    for (const bet of betsRes.rows) {
      const won = winSets[bet.bet_type]?.has(bet.number) ?? false;
      if (!won) continue;
      const cid  = bet.customer_id ?? '__none__';
      const name = bet.customer_name ?? bet.customer_ref ?? 'ไม่ระบุ';
      if (!custMap.has(cid)) {
        custMap.set(cid, { customer_id: cid, name, winning_bets: [], total_amount: 0, total_payout: 0 });
      }
      const cs  = custMap.get(cid)!;
      const amt = parseFloat(bet.amount);
      // Use customer's configured payout rate; fallback to stored bet rate
      const custRateMap: Record<string, string | null> = {
        '3digit_top':    bet.rate_3top,
        '3digit_tote':   bet.rate_3tote,
        '3digit_back':   bet.rate_3back,
        '2digit_top':    bet.rate_2top,
        '2digit_bottom': bet.rate_2bottom,
        '1digit_top':    bet.rate_1top,
        '1digit_bottom': bet.rate_1bottom,
      };
      const configuredRate = custRateMap[bet.bet_type];
      const baseRate = (configuredRate != null && parseFloat(configuredRate) > 0)
        ? parseFloat(configuredRate)
        : parseFloat(bet.payout_rate);
      const rate = applyLimit2(bet.customer_id, bet.bet_type, bet.number, baseRate);
      const pay = amt * rate;
      cs.winning_bets.push({ sheet_no: bet.sheet_no ?? 1, bet_type: bet.bet_type, number: bet.number, amount: amt, payout: pay });
      cs.total_amount += amt;
      cs.total_payout += pay;
    }

    res.json({
      round: { id: round.id, name: round.name, draw_date: round.draw_date, result_data: rd },
      customers: Array.from(custMap.values()).filter(c => c.customer_id !== '__none__'),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
