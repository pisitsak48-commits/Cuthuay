import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import { REPORTS_EXPORT_ROLES, REPORTS_READ_ROLES } from '../middleware/rbac';
import { BetRow } from '../models/types';
import { calculateRisk } from '../services/riskEngine';
import { generateRoundReport } from '../services/reportService';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env';
import { buildProfitSummary } from '../services/profitSummaryService';
import { fetchProfitExtrasForRounds } from '../services/dashboardProfits';
import { moneyToNumber } from '../lib/money';

const router = Router();
router.use(authenticate);

// GET /api/reports/dashboard — overall stats
router.get('/dashboard', authorize(...REPORTS_READ_ROLES), async (req: Request, res: Response, next: NextFunction) => {
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
        LIMIT 24
      `),
    ]);

    const drawnIds = recentResult.rows
      .filter((r) => String(r.status) === 'drawn')
      .map((r) => String(r.id));
    const profit_by_round = await fetchProfitExtrasForRounds(drawnIds);

    res.json({
      round_stats: roundsResult.rows,
      active_bets: betsResult.rows[0],
      recent_rounds: recentResult.rows,
      profit_by_round,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:roundId/summary
router.get('/:roundId/summary', authorize(...REPORTS_READ_ROLES), async (req: Request, res: Response, next: NextFunction) => {
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
  authorize(...REPORTS_EXPORT_ROLES),
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
router.get('/:roundId/bet-view', authorize(...REPORTS_READ_ROLES), async (req: Request, res: Response, next: NextFunction) => {
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
      const sold = moneyToNumber(r.total_sold);
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
router.get('/:roundId/profit-summary', authorize(...REPORTS_READ_ROLES), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const summary = await buildProfitSummary(roundId);
    if (!summary) return res.status(404).json({ error: 'Round not found' });
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:roundId/dealer-wins — winning items per dealer (from send_batches)
router.get('/:roundId/dealer-wins', authorize(...REPORTS_READ_ROLES), async (req: Request, res: Response, next: NextFunction) => {
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
      if (global.custom_payout) return moneyToNumber(global.custom_payout);
      const pct = moneyToNumber(global.payout_pct);
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
router.get('/:roundId/customer-wins', authorize(...REPORTS_READ_ROLES), async (req: Request, res: Response, next: NextFunction) => {
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
      if (chosen.custom_payout) return moneyToNumber(chosen.custom_payout);
      const pct = moneyToNumber(chosen.payout_pct);
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
      const amt = moneyToNumber(bet.amount);
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
      const baseRate = (configuredRate != null && moneyToNumber(configuredRate) > 0)
        ? moneyToNumber(configuredRate)
        : moneyToNumber(bet.payout_rate);
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
