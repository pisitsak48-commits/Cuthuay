import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { query } from '../config/database';
import { authenticate, authorize } from '../middleware/auth';
import {
  BetRow,
  BetType,
  CutEntry,
  DEFAULT_DEALER_RATES,
  DealerRates,
} from '../models/types';
import { calculateRisk } from '../services/riskEngine';
import { autoCut, applyCutPlan } from '../services/cutAlgorithm';
import { createError } from '../middleware/errorHandler';

const router = Router();
router.use(authenticate);

const betTypeValues: [BetType, ...BetType[]] = [
  '2digit_top', '2digit_bottom', '3digit_top', '3digit_tote', '3digit_back', '1digit_top', '1digit_bottom',
];

const dealerRatesSchema = z.object({
  '2digit_top': z.number().positive(),
  '2digit_bottom': z.number().positive(),
  '3digit_top': z.number().positive(),
  '3digit_front': z.number().positive(),
  '3digit_back': z.number().positive(),
}).partial().optional();

// ─── helper: load dealer rates for a round (falls back to DEFAULT) ────────────
async function getDealerRatesForRound(roundId: string): Promise<DealerRates> {
  const result = await query(
    `SELECT d.rate_3top, d.rate_3tote, d.rate_3back,
            d.rate_2top, d.rate_2bottom, d.rate_1top, d.rate_1bottom
     FROM rounds r
     JOIN dealers d ON r.dealer_id = d.id
     WHERE r.id = $1`,
    [roundId],
  );
  const d = result.rows[0] as Record<string, unknown> | undefined;
  if (!d) return { ...DEFAULT_DEALER_RATES };
  return {
    '3digit_top':    Number(d.rate_3top    ?? DEFAULT_DEALER_RATES['3digit_top']),
    '3digit_tote':   Number(d.rate_3tote   ?? DEFAULT_DEALER_RATES['3digit_tote']),
    '3digit_back':   Number(d.rate_3back   ?? DEFAULT_DEALER_RATES['3digit_back']),
    '2digit_top':    Number(d.rate_2top    ?? DEFAULT_DEALER_RATES['2digit_top']),
    '2digit_bottom': Number(d.rate_2bottom ?? DEFAULT_DEALER_RATES['2digit_bottom']),
    '1digit_top':    Number(d.rate_1top    ?? DEFAULT_DEALER_RATES['1digit_top']),
    '1digit_bottom': Number(d.rate_1bottom ?? DEFAULT_DEALER_RATES['1digit_bottom']),
  };
}

interface DealerParams {
  rates:         DealerRates;           // upper payout rates per bet type
  commissions:   Record<string, number>; // forwarding commission % per bet type
  keep_net_pct:  number;                 // net retention % (alpha × 100)
}

const PCT_KEYS: Record<string, string> = {
  '3digit_top':    'pct_3top',
  '3digit_tote':   'pct_3tote',
  '3digit_back':   'pct_3back',
  '2digit_top':    'pct_2top',
  '2digit_bottom': 'pct_2bottom',
  '1digit_top':    'pct_1top',
  '1digit_bottom': 'pct_1bottom',
};

async function getDealerParamsForRound(roundId: string): Promise<DealerParams> {
  const result = await query(
    `SELECT d.rate_3top, d.rate_3tote, d.rate_3back,
            d.rate_2top, d.rate_2bottom, d.rate_1top, d.rate_1bottom,
            d.pct_3top, d.pct_3tote, d.pct_3back,
            d.pct_2top, d.pct_2bottom, d.pct_1top, d.pct_1bottom,
            d.keep_net_pct
     FROM rounds r
     JOIN dealers d ON r.dealer_id = d.id
     WHERE r.id = $1`,
    [roundId],
  );
  const d = result.rows[0] as Record<string, unknown> | undefined;
  const rates: DealerRates = !d ? { ...DEFAULT_DEALER_RATES } : {
    '3digit_top':    Number(d.rate_3top    ?? DEFAULT_DEALER_RATES['3digit_top']),
    '3digit_tote':   Number(d.rate_3tote   ?? DEFAULT_DEALER_RATES['3digit_tote']),
    '3digit_back':   Number(d.rate_3back   ?? DEFAULT_DEALER_RATES['3digit_back']),
    '2digit_top':    Number(d.rate_2top    ?? DEFAULT_DEALER_RATES['2digit_top']),
    '2digit_bottom': Number(d.rate_2bottom ?? DEFAULT_DEALER_RATES['2digit_bottom']),
    '1digit_top':    Number(d.rate_1top    ?? DEFAULT_DEALER_RATES['1digit_top']),
    '1digit_bottom': Number(d.rate_1bottom ?? DEFAULT_DEALER_RATES['1digit_bottom']),
  };
  const commissions: Record<string, number> = {};
  for (const bt of Object.keys(PCT_KEYS)) {
    commissions[bt] = d ? Number(d[PCT_KEYS[bt]] ?? 0) : 0;
  }
  return { rates, commissions, keep_net_pct: d ? Number(d.keep_net_pct ?? 100) : 100 };
}

// GET /api/cut/:roundId/dealer-rates — get effective dealer rates for round
router.get('/:roundId/dealer-rates', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const roundResult = await query(
      `SELECT r.dealer_id, d.name as dealer_name FROM rounds r LEFT JOIN dealers d ON r.dealer_id = d.id WHERE r.id = $1`,
      [roundId],
    );
    const params = await getDealerParamsForRound(roundId);
    const row = roundResult.rows[0] as any;
    res.json({
      rates:        params.rates,
      commissions:  params.commissions,
      keep_net_pct: params.keep_net_pct,
      dealer_id:    row?.dealer_id ?? null,
      dealer_name:  row?.dealer_name ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/cut/:roundId/risk — compute current risk report
router.get('/:roundId/risk', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const bets = (
      await query<BetRow>('SELECT * FROM bets WHERE round_id = $1', [roundId])
    ).rows;

    // Load custom payout rates from limits
    const limitsResult = await query(
      `SELECT number, bet_type, custom_payout FROM number_limits
       WHERE round_id = $1 AND custom_payout IS NOT NULL`,
      [roundId],
    );
    const customRates = new Map<string, number>(
      limitsResult.rows.map((r: any) => [`${r.bet_type}:${r.number}`, r.custom_payout]),
    );

    const report = calculateRisk(bets, roundId, customRates);
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// POST /api/cut/:roundId/simulate — simulate cut strategies
router.post(
  '/:roundId/simulate',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const { risk_limit, dealer_rates } = z
        .object({
          risk_limit: z.number().positive(),
          dealer_rates: dealerRatesSchema,
        })
        .parse(req.body);

      const bets = (
        await query<BetRow>('SELECT * FROM bets WHERE round_id = $1', [roundId])
      ).rows;

      // Auto-load dealer rates from round's dealer if not overridden
      const autoRates = await getDealerRatesForRound(roundId);
      const rates: DealerRates = { ...autoRates, ...dealer_rates };
      const simulations = autoCut(bets, risk_limit, rates);
      res.json({ simulations, risk_limit, dealer_rates: rates });
    } catch (err) {
      next(err);
    }
  },
);

// POST /api/cut/:roundId/apply — save chosen cut plan
router.post(
  '/:roundId/apply',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const { cuts, risk_limit, dealer_rates, strategy } = z
        .object({
          cuts: z.array(
            z.object({
              number: z.string(),
              bet_type: z.enum(betTypeValues),
              cut_amount: z.number().nonnegative(),
              dealer_rate: z.number().positive(),
              before_risk: z.number().nonnegative(),
              after_risk: z.number().nonnegative(),
              hedge_cost: z.number().nonnegative(),
              hedge_gain: z.number().nonnegative(),
            }),
          ),
          risk_limit: z.number().positive(),
          dealer_rates: dealerRatesSchema,
          strategy: z.enum(['greedy', 'min_cost', 'proportional']),
        })
        .parse(req.body);

      const bets = (
        await query<BetRow>('SELECT * FROM bets WHERE round_id = $1', [roundId])
      ).rows;

      // Auto-load dealer rates from round's dealer if not overridden
      const autoRates = await getDealerRatesForRound(roundId);
      const rates: DealerRates = { ...autoRates, ...dealer_rates };
      const { riskAfter } = applyCutPlan(bets, cuts as CutEntry[]);
      const totalCost = cuts.reduce((s, c) => s + c.hedge_cost, 0);

      const result = await query(
        `INSERT INTO cut_plans (round_id, cuts, total_cost, risk_limit, dealer_rates, created_by)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          roundId,
          JSON.stringify(cuts),
          totalCost,
          risk_limit,
          JSON.stringify(rates),
          req.user!.sub,
        ],
      );

      res.status(201).json({ ...result.rows[0], risk_after: riskAfter });
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/cut/:roundId/plans — list saved cut plans
router.get('/:roundId/plans', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const result = await query(
      `SELECT cp.*, u.username as created_by_name
       FROM cut_plans cp
       LEFT JOIN users u ON cp.created_by = u.id
       WHERE cp.round_id = $1
       ORDER BY cp.created_at DESC`,
      [roundId],
    );
    res.json({ plans: result.rows });
  } catch (err) {
    next(err);
  }
});

// ─── Helper: generate all unique permutations of a string ────────────────────
function generatePerms(str: string): string[] {
  if (str.length <= 1) return [str];
  const result = new Set<string>();
  for (let i = 0; i < str.length; i++) {
    const char = str[i];
    const rest = str.slice(0, i) + str.slice(i + 1);
    for (const perm of generatePerms(rest)) {
      result.add(char + perm);
    }
  }
  return [...result];
}

// ─── Range simulation types ───────────────────────────────────────────────────
interface RangeRow {
  row: number;
  threshold_pct: number;
  threshold: number;
  count_fully_kept: number;
  total_kept: number;
  max_gain: number;
  min_gain: number | null;
  max_loss: number | null;
  min_loss: number | null;
  avg_gain: number | null;
  avg_loss: number | null;
  pct_win: number;
  pct_lose: number;
}

const rangeSimSchema = z.object({
  bet_type: z.enum(betTypeValues),
  step_pct: z.number().positive().max(50).default(2.5),
  steps: z.number().int().positive().max(200).default(41),
});

// POST /api/cut/:roundId/range-simulation
router.post(
  '/:roundId/range-simulation',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const { bet_type, step_pct, steps } = rangeSimSchema.parse(req.body);

      // Auto-fetch dealer params (alpha, commission, upper rate) from dealer config
      const dealerParams = await getDealerParamsForRound(roundId);
      const alpha          = dealerParams.keep_net_pct / 100;
      const commissionRate = (dealerParams.commissions[bet_type] ?? 0) / 100;
      // upper_rate = dealer payout rate for this bet type
      const dealerUpperRate = dealerParams.rates[bet_type as BetType];

      const betsResult = await query<BetRow>(
        'SELECT * FROM bets WHERE round_id = $1 AND bet_type = $2',
        [roundId, bet_type],
      );
      const bets = betsResult.rows;

      if (!bets.length) {
        return res.json({
          rows: [], bet_type, total_revenue: 0, max_single_bet: 0, unique_numbers: 0, distribution: [],
          dealer_params: { upper_rate: dealerUpperRate, commission_pct: commissionRate * 100, keep_net_pct: dealerParams.keep_net_pct },
        });
      }

      // Aggregate bets by number; use max payout_rate (worst-case)
      const betMap = new Map<string, { total: number; rate: number }>();
      for (const bet of bets) {
        const existing = betMap.get(bet.number);
        const amt = Number(bet.amount);
        const rate = Number(bet.payout_rate);
        if (existing) {
          existing.total += amt;
          if (rate > existing.rate) existing.rate = rate;
        } else {
          betMap.set(bet.number, { total: amt, rate });
        }
      }

      const allNumbers = [...betMap.entries()];
      const totalRevenue = allNumbers.reduce((s, [, v]) => s + v.total, 0);
      const maxSingleBet = Math.max(...allNumbers.map(([, v]) => v.total));

      const digitLen = bet_type.startsWith('3') ? 3 : bet_type.startsWith('2') ? 2 : 1;
      const universeSize = Math.pow(10, digitLen);
      const isTote = bet_type === '3digit_tote';

      // For tote: precompute outcome → winning number list
      const toteWinMap = new Map<string, string[]>();
      if (isTote) {
        for (const [num] of allNumbers) {
          for (const perm of generatePerms(num)) {
            const arr = toteWinMap.get(perm) ?? [];
            arr.push(num);
            toteWinMap.set(perm, arr);
          }
        }
      }

      // ── Fetch per-number limits (custom payout rate + blocked status) ────────
      // entity_type 'all' = global; 'dealer' = dealer-level — both override default rate
      const limitsRes = await query<{ number: string; custom_payout: string | null; payout_pct: string; is_blocked: boolean }>(
        `SELECT number, custom_payout, payout_pct, is_blocked
         FROM number_limits
         WHERE round_id = $1 AND bet_type = $2
           AND entity_type IN ('all', 'dealer')`,
        [roundId, bet_type],
      );
      // Per-number custom payout rate (อั้นจ่าย)
      const customRateMap = new Map<string, number>();
      // Numbers that are forced-cut (ปิดรับ at dealer/global level)
      const blockedSet = new Set<string>();
      for (const row of limitsRes.rows) {
        if (row.is_blocked) blockedSet.add(row.number);
        if (row.custom_payout != null) {
          // Direct payout rate override
          customRateMap.set(row.number, Number(row.custom_payout));
        } else {
          // Compute from payout_pct (e.g. payout_pct=80 → rate × 0.8)
          const pct = Number(row.payout_pct);
          if (pct > 0 && pct < 100) {
            // Store as special marker — will resolve against effectiveRate after it's computed
            customRateMap.set(row.number, -(pct)); // negative = pct marker
          }
        }
      }

      // Distribution data for bar chart (top 100 by bet amount)
      const r = (v: number) => Math.round(v * 100) / 100;
      const distribution = allNumbers
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 100)
        .map(([number, { total }]) => ({
          number,
          total: Math.round(total * 100) / 100,
          is_blocked: blockedSet.has(number),
          custom_payout: customRateMap.get(number) ?? null,
        }));

      // Default effective rate (used when no custom_payout for a number)
      const effectiveRate = dealerUpperRate ?? (allNumbers.length ? Math.max(...allNumbers.map(([, v]) => v.rate)) : 700);

      // Resolve pct markers in customRateMap now that effectiveRate is known
      for (const [num, val] of customRateMap) {
        if (val < 0) {
          // negative value = payout_pct stored as negative marker
          const pct = -val;
          customRateMap.set(num, effectiveRate * (pct / 100));
        }
      }

      const rows: RangeRow[] = [];

      for (let i = 0; i < steps; i++) {
        const threshold_pct = i * step_pct;
        const threshold = i === 0 ? 0 : (threshold_pct / 100) * maxSingleBet;

        const keptMap = new Map<string, number>();
        let totalKept = 0;
        let countFullyKept = 0;

        for (const [num, { total }] of allNumbers) {
          // Blocked numbers: dealer/global won't accept → forced cut regardless of threshold
          let kept: number;
          if (blockedSet.has(num)) {
            kept = 0;
          } else {
            kept = threshold === 0 ? 0 : Math.min(total, threshold);
          }
          keptMap.set(num, kept);
          totalKept += kept;
          if (total <= threshold && !blockedSet.has(num)) countFullyKept++;
        }

        // P&L formula (matches reference system):
        //   base   = alpha * totalKept  +  commissionRate * forwarded
        //   winner = base − kept[winner] * winRate
        // winRate per number: use custom_payout from limits (เลขอั้น) if set, else default effectiveRate
        const forwarded = totalRevenue - totalKept;
        const base = alpha * totalKept + commissionRate * forwarded;

        const plValues: number[] = new Array(universeSize);
        for (let j = 0; j < universeSize; j++) {
          const outcome = j.toString().padStart(digitLen, '0');
          let winPayout = 0;

          if (isTote) {
            for (const num of (toteWinMap.get(outcome) ?? [])) {
              const kept = keptMap.get(num) ?? 0;
              if (kept > 0) {
                const winRate = customRateMap.get(num) ?? effectiveRate;
                winPayout += kept * winRate;
              }
            }
          } else {
            const entry = betMap.get(outcome);
            if (entry) {
              const kept = keptMap.get(outcome) ?? 0;
              if (kept > 0) {
                const winRate = customRateMap.get(outcome) ?? effectiveRate;
                winPayout = kept * winRate;
              }
            }
          }
          plValues[j] = base - winPayout;
        }

        const positivePls = plValues.filter(p => p > 0);
        const negativePls = plValues.filter(p => p < 0);

        rows.push({
          row: i + 1,
          threshold_pct,
          threshold: r(threshold),
          count_fully_kept: countFullyKept,
          total_kept: r(totalKept),
          max_gain: r(Math.max(...plValues)),
          min_gain: positivePls.length ? r(Math.min(...positivePls)) : null,
          max_loss: negativePls.length ? r(Math.min(...negativePls)) : null,
          min_loss: negativePls.length ? r(Math.max(...negativePls)) : null,
          avg_gain: positivePls.length
            ? r(positivePls.reduce((s, v) => s + v, 0) / positivePls.length) : null,
          avg_loss: negativePls.length
            ? r(negativePls.reduce((s, v) => s + v, 0) / negativePls.length) : null,
          pct_win: Math.round((positivePls.length / universeSize) * 1000) / 10,
          pct_lose: Math.round((negativePls.length / universeSize) * 1000) / 10,
        });
      }

      res.json({
        rows,
        bet_type,
        total_revenue: r(totalRevenue),
        max_single_bet: r(maxSingleBet),
        unique_numbers: allNumbers.length,
        distribution,
        dealer_params: {
          upper_rate: effectiveRate,
          commission_pct: commissionRate * 100,
          keep_net_pct: dealerParams.keep_net_pct,
        },
      });
    } catch (err) {
      next(err);
    }
  },
);

// ─── Send Batches ─────────────────────────────────────────────────────────────

const sendBatchSchema = z.object({
  bet_type:    z.enum(betTypeValues),
  threshold:   z.number().nonnegative(),
  items:       z.array(z.object({ number: z.string(), amount: z.number().nonnegative() })),
  total:       z.number().nonnegative(),
  dealer_id:   z.string().uuid().nullable().optional(),
  dealer_name: z.string().nullable().optional(),
});

// POST /api/cut/:roundId/send-batches — record a confirmed send
router.post(
  '/:roundId/send-batches',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const data = sendBatchSchema.parse(req.body);
      const result = await query(
        `INSERT INTO send_batches (round_id, bet_type, threshold, items, total, dealer_id, dealer_name, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [roundId, data.bet_type, data.threshold, JSON.stringify(data.items), data.total,
         data.dealer_id ?? null, data.dealer_name ?? null, req.user!.sub],
      );
      res.status(201).json(result.rows[0]);
    } catch (err) {
      next(err);
    }
  },
);

// GET /api/cut/:roundId/send-batches
router.get('/:roundId/send-batches', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const result = await query(
      `SELECT sb.*, u.username as created_by_name
       FROM send_batches sb
       LEFT JOIN users u ON sb.created_by = u.id
       WHERE sb.round_id = $1
       ORDER BY sb.created_at DESC`,
      [roundId],
    );
    res.json({ batches: result.rows });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/cut/:roundId/send-batches/:batchId
router.delete(
  '/:roundId/send-batches/:batchId',
  authorize('admin', 'operator'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId  = z.string().uuid().parse(req.params.roundId);
      const batchId  = z.string().uuid().parse(req.params.batchId);
      const result = await query(
        `DELETE FROM send_batches WHERE id = $1 AND round_id = $2 RETURNING id`,
        [batchId, roundId],
      );
      if (!result.rowCount) throw createError('Send batch not found', 404);
      res.json({ deleted: batchId });
    } catch (err) {
      next(err);
    }
  },
);

export default router;
