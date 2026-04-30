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

function roundHalfToEven(value: number): number {
  const eps = 1e-9;
  const floor = Math.floor(value);
  const frac = value - floor;
  if (frac < 0.5 - eps) return floor;
  if (frac > 0.5 + eps) return floor + 1;
  return floor % 2 === 0 ? floor : floor + 1;
}

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

// GET /api/cut/:roundId/bet-scope — แผ่นโพยที่มีในงวด (สำหรับตัวกรองตัดหวย)
router.get('/:roundId/bet-scope', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const roundId = z.string().uuid().parse(req.params.roundId);
    const r = await query<{ sn: number }>(
      `SELECT DISTINCT COALESCE(sheet_no, 1)::int AS sn FROM bets WHERE round_id = $1 ORDER BY 1`,
      [roundId],
    );
    res.json({ sheets: r.rows.map(row => Number(row.sn)) });
  } catch (err) {
    next(err);
  }
});

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

function normalizeToteNumber(num: string): string {
  return num.split('').sort().join('');
}

/** 3 ตัวโต๊ด: ชุดเลขแบบเรียงหลัก (a≤b≤c) ครบ 220 ช่อง — ใช้กราฟ/นับสถานะเหมือน 3 ตัวบน 1,000 ช่อง */
function allToteCanonicalNumbers(): string[] {
  const out: string[] = [];
  for (let a = 0; a <= 9; a++) {
    for (let b = a; b <= 9; b++) {
      for (let c = b; c <= 9; c++) {
        out.push(`${a}${b}${c}`);
      }
    }
  }
  return out;
}

/** เรทจ่ายเฉลี่ยถ่วงน้ำหนักต่อเลข (สำคัญเมื่อหลายบรรทัดเรทต่างกัน) */
function weightedPayoutRate(v: { total: number; rateWeighted: number }): number {
  return v.total > 0 ? v.rateWeighted / v.total : 0;
}

/** 3 ตัวบน: คีย์เดียวต่อช่อง 000–999 (รวม 42 กับ 042) ให้ตรงโปรแกรมอ้างอิง */
function normalize3TopNumber(num: string): string {
  const digits = String(num).replace(/\D/g, '');
  if (!digits) return '000';
  const core = digits.length > 3 ? digits.slice(-3) : digits;
  let v = parseInt(core, 10);
  if (Number.isNaN(v)) return '000';
  v = ((v % 1000) + 1000) % 1000;
  return String(v).padStart(3, '0');
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
  /** 0.5% → 201 แถว — ต้องรองรับให้ละเอียดกว่า 2.5% โดยสูตรเดิม */
  steps: z.number().int().positive().max(500).default(41),
  /** คำนวณผลได้เสียที่ยอดเก็บตัวละนี้โดยตรง (เช่น 500) — ไม่ snap ไปแถว % ที่ threshold ใกล้เคียง */
  active_threshold: z.number().nonnegative().optional(),
  /** จำกัดเฉพาะแผ่นโพย (มักตรง "ผู้ส่ง 1" = แผ่น 1 ในโปรแกรมอ้างอิง) */
  sheet_no: z.number().int().min(1).max(999).optional(),
  /** จำกัดเฉพาะลูกค้า (ถ้ามี) */
  customer_id: z.string().uuid().optional().nullable(),
});

// POST /api/cut/:roundId/range-simulation
router.post(
  '/:roundId/range-simulation',
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const roundId = z.string().uuid().parse(req.params.roundId);
      const {
        bet_type,
        step_pct,
        steps,
        active_threshold: activeThresholdBody,
        sheet_no: sheetNoBody,
        customer_id: customerIdBody,
      } = rangeSimSchema.parse(req.body);

      // Auto-fetch dealer params from dealer config
      const dealerParams = await getDealerParamsForRound(roundId);
      // dealer commission % (ลด% ที่ dealer ให้เรา)
      const dealerPct = dealerParams.commissions[bet_type] ?? 0;
      const dealerUpperRate = dealerParams.rates[bet_type as BetType];

      // PCT_KEY mapping for customers table
      const custPctKey: Record<string, string> = {
        '2digit_top':    'pct_2top',
        '2digit_bottom': 'pct_2bottom',
        '3digit_top':    'pct_3top',
        '3digit_tote':   'pct_3tote',
        '3digit_back':   'pct_3back',
        '1digit_top':    'pct_1top',
        '1digit_bottom': 'pct_1bottom',
      };
      const pctField = custPctKey[bet_type] ?? 'pct_2top';

      const scopeParts: string[] = [];
      const scopePartsB: string[] = [];
      const scopeParams: unknown[] = [roundId, bet_type];
      let scopeIdx = 3;
      if (sheetNoBody != null) {
        scopeParts.push(`COALESCE(sheet_no, 1) = $${scopeIdx}`);
        scopePartsB.push(`COALESCE(b.sheet_no, 1) = $${scopeIdx}`);
        scopeParams.push(sheetNoBody);
        scopeIdx++;
      }
      if (customerIdBody) {
        scopeParts.push(`customer_id = $${scopeIdx}`);
        scopePartsB.push(`b.customer_id = $${scopeIdx}`);
        scopeParams.push(customerIdBody);
        scopeIdx++;
      }
      const scopeSql = scopeParts.length ? ` AND ${scopeParts.join(' AND ')}` : '';
      const scopeSqlB = scopePartsB.length ? ` AND ${scopePartsB.join(' AND ')}` : '';

      const betsResult = await query<BetRow>(
        `SELECT * FROM bets WHERE round_id = $1 AND bet_type = $2${scopeSql}`,
        scopeParams,
      );
      const bets = betsResult.rows;

      if (!bets.length) {
        return res.json({
          rows: [],
          at_threshold: null,
          bet_type,
          cut_scope: { sheet_no: sheetNoBody ?? null, customer_id: customerIdBody ?? null },
          total_revenue: 0,
          max_single_bet: 0,
          min_single_bet: 0,
          unique_numbers: 0,
          distribution: [],
          dealer_params: { upper_rate: dealerUpperRate, dealer_pct: dealerPct, customer_pct: 0, net_comm_pct: dealerPct },
        });
      }

      // Compute weighted-average customer pct (ลด% ที่เราให้ลูกค้า) across all bets in this round
      // Join bets → customers to get each bet's customer pct, weight by bet amount
      const custPctResult = await query<{ customer_id: string | null; pct: string; total_amount: string }>(
        `SELECT b.customer_id,
                COALESCE(c.${pctField}, 0) AS pct,
                SUM(b.amount) AS total_amount
         FROM bets b
         LEFT JOIN customers c ON b.customer_id = c.id
         WHERE b.round_id = $1 AND b.bet_type = $2${scopeSqlB}
         GROUP BY b.customer_id, c.${pctField}`,
        scopeParams,
      );
      let totalRevForPct = 0;
      let weightedCustPct = 0;
      for (const row of custPctResult.rows) {
        const amt = Number(row.total_amount);
        const pct = Number(row.pct);
        totalRevForPct += amt;
        weightedCustPct += amt * pct;
      }
      const avgCustPct = totalRevForPct > 0 ? weightedCustPct / totalRevForPct : 0;

      // P&L formula derived from reference system:
      //   net_comm_rate = (dealer_pct − avg_customer_pct) / 100
      //   alpha         = 1 − dealer_pct / 100
      //   base          = net_comm_rate × R + alpha × totalKept
      //   P&L(j)        = base − kept_j × payoutRate_j
      const netCommRate = (dealerPct - avgCustPct) / 100;
      const alpha       = 1 - dealerPct / 100;
      const isPermutationWinType = bet_type === '3digit_tote';
      const is3Back = bet_type === '3digit_back';
      const is3Top = bet_type === '3digit_top';

      // Aggregate bets by number; for permutation-win types, normalize into one canonical bucket.
      // Example: 112,121,211 -> 112 (merged before threshold simulation)
      const betMap = new Map<string, { total: number; rateWeighted: number }>();
      for (const bet of bets) {
        const num = isPermutationWinType
          ? normalizeToteNumber(bet.number)
          : is3Top || is3Back
            ? normalize3TopNumber(bet.number)
            : bet.number;
        const existing = betMap.get(num);
        const amt = Number(bet.amount);
        const rate = Number(bet.payout_rate);
        if (existing) {
          existing.total += amt;
          existing.rateWeighted += amt * rate;
        } else {
          betMap.set(num, { total: amt, rateWeighted: amt * rate });
        }
      }

      const allNumbers = [...betMap.entries()];
      const totalRevenue = allNumbers.reduce((s, [, v]) => s + v.total, 0);
      const maxSingleBet = Math.max(...allNumbers.map(([, v]) => v.total));
      const minSingleBet = Math.min(...allNumbers.map(([, v]) => v.total));

      // Universe size: 1digit uses 10 outcomes (single digit 0-9), matching the reference program
      const digitLen = bet_type.startsWith('3') ? 3 : bet_type.startsWith('2') ? 2 : 1;
      const universeSize = Math.pow(10, digitLen);
      const is1Digit = bet_type === '1digit_top' || bet_type === '1digit_bottom';

      // For tote: precompute outcome → winning number list
      const toteWinMap = new Map<string, string[]>();
      if (isPermutationWinType) {
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
        const num = isPermutationWinType
          ? normalizeToteNumber(row.number)
          : is3Top || is3Back
            ? normalize3TopNumber(row.number)
            : row.number;
        if (row.is_blocked) blockedSet.add(num);
        if (row.custom_payout != null) {
          // Direct payout rate override
          const nextRate = Number(row.custom_payout);
          const prevRate = customRateMap.get(num);
          if (prevRate == null || prevRate < 0 || nextRate > prevRate) {
            customRateMap.set(num, nextRate);
          }
        } else {
          // Compute from payout_pct (e.g. payout_pct=80 → rate × 0.8)
          const pct = Number(row.payout_pct);
          if (pct > 0 && pct < 100) {
            // Store as special marker — will resolve against effectiveRate after it's computed
            const marker = -pct;
            const prev = customRateMap.get(num);
            if (prev == null) {
              customRateMap.set(num, marker);
            } else if (prev < 0) {
              // choose higher payout_pct (more costly) as worst-case
              customRateMap.set(num, Math.min(prev, marker));
            }
          }
        }
      }

      const r = (v: number) => Math.round(v * 100) / 100;
      const TOTE_UNIVERSE = 220;
      /** กราฟ/รายการตัด: ครบทุกช่องผลลัพธ์ของประเภทนั้น (ไม่ slice แค่ 100 เลขตามยอด — ตรงโปรแกรมอ้างอิง) */
      const distribution =
        bet_type === '3digit_top' || bet_type === '3digit_back'
          ? Array.from({ length: 1000 }, (_, j) => {
              const number = j.toString().padStart(3, '0');
              const entry = betMap.get(number);
              const total = entry?.total ?? 0;
              return {
                number,
                total: r(total),
                is_blocked: blockedSet.has(number),
                custom_payout: customRateMap.get(number) ?? null,
              };
            })
          : bet_type === '3digit_tote'
            ? allToteCanonicalNumbers().map((number) => {
                const entry = betMap.get(number);
                const total = entry?.total ?? 0;
                return {
                  number,
                  total: r(total),
                  is_blocked: blockedSet.has(number),
                  custom_payout: customRateMap.get(number) ?? null,
                };
              })
            : bet_type === '2digit_top' || bet_type === '2digit_bottom'
              ? Array.from({ length: 100 }, (_, j) => {
                  const number = j.toString().padStart(2, '0');
                  const entry = betMap.get(number);
                  const total = entry?.total ?? 0;
                  return {
                    number,
                    total: r(total),
                    is_blocked: blockedSet.has(number),
                    custom_payout: customRateMap.get(number) ?? null,
                  };
                })
              : bet_type === '1digit_top' || bet_type === '1digit_bottom'
                ? Array.from({ length: 10 }, (_, j) => {
                    const number = String(j);
                    const entry = betMap.get(number);
                    const total = entry?.total ?? 0;
                    return {
                      number,
                      total: r(total),
                      is_blocked: blockedSet.has(number),
                      custom_payout: customRateMap.get(number) ?? null,
                    };
                  })
                : allNumbers
                    .sort((a, b) => b[1].total - a[1].total)
                    .map(([number, { total }]) => ({
                      number,
                      total: r(total),
                      is_blocked: blockedSet.has(number),
                      custom_payout: customRateMap.get(number) ?? null,
                    }));

      // Base payout rate used for resolving per-number payout_pct overrides.
      // For 1digit we must use dealer rate directly (not customer fallback 3.2/4.2)
      // to match the selected dealer configuration used in cut simulation.
      const effectiveRate = allNumbers.length
        ? Math.max(...allNumbers.map(([, v]) => weightedPayoutRate(v)))
        : 700;
      // อั้นจ่ายแบบ payout_pct: ใช้เรท dealer เป็นฐานสำหรับ 3 ตัวบน/โต๊ด/1 หลัก
      const resolvedBaseRate =
        is1Digit || is3Top || is3Back || isPermutationWinType
          ? (dealerUpperRate ?? effectiveRate)
          : effectiveRate;

      // Resolve pct markers in customRateMap using the selected base rate
      for (const [num, val] of customRateMap) {
        if (val < 0) {
          // negative value = payout_pct stored as negative marker
          const pct = -val;
          customRateMap.set(num, resolvedBaseRate * (pct / 100));
        }
      }

      const rows: RangeRow[] = [];

      /**
       * 3 ตัวโต๊ด: โปรแกรมอ้างอิงนับจักรวาล **220 ช่องเรียงหลัก** (a≤b≤c) ไม่ใช่ 1,000 ผล — ถ้าวน 1,000 จะได้ %ได้/%เสียผิด (เช่น 17% vs 80.91%)
       */
      const toteSimOutcomes = isPermutationWinType ? allToteCanonicalNumbers() : [];
      const toteSimUniverse = toteSimOutcomes.length;

      /** แถวเดียวของตารางช่วง / snapshot ที่ยอดเก็บตัวละกำหนดเอง */
      const buildRangeRow = (
        threshold: number,
        threshold_pct: number,
        rowNum: number,
      ): RangeRow => {
        const keptMap = new Map<string, number>();
        let totalKept = 0;
        let countFullyKept = 0;

        for (const [num, { total }] of allNumbers) {
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

        const base = netCommRate * totalRevenue + alpha * totalKept;

        const plUniverseSize = isPermutationWinType ? toteSimUniverse : universeSize;
        const plValues: number[] = new Array(plUniverseSize);

        if (isPermutationWinType) {
          for (let j = 0; j < toteSimOutcomes.length; j++) {
            const outcome = toteSimOutcomes[j];
            let winPayout = 0;
            for (const num of (toteWinMap.get(outcome) ?? [])) {
              const kept = keptMap.get(num) ?? 0;
              if (kept > 0) {
                const winRate =
                  customRateMap.get(num) ?? weightedPayoutRate(betMap.get(num)!);
                winPayout += kept * winRate;
              }
            }
            plValues[j] = base - winPayout;
          }
        } else {
          for (let j = 0; j < universeSize; j++) {
            const outcome = j.toString().padStart(digitLen, '0');
            let winPayout = 0;

            if (is1Digit) {
              const entry = betMap.get(outcome);
              if (entry) {
                const kept = keptMap.get(outcome) ?? 0;
                if (kept > 0) {
                  const simRate =
                    dealerUpperRate ??
                    (customRateMap.get(outcome) ?? weightedPayoutRate(entry));
                  winPayout = kept * simRate;
                }
              }
            } else {
              // 3digit_top, 3digit_back, 2digit: จ่ายตามเรทบิลถ่วงน้ำหนัก + อั้นจ่าย (ตรงโปรแกรมอ้างอิง)
              const entry = betMap.get(outcome);
              if (entry) {
                const kept = keptMap.get(outcome) ?? 0;
                if (kept > 0) {
                  const winRate =
                    customRateMap.get(outcome) ?? weightedPayoutRate(entry);
                  winPayout = kept * winRate;
                }
              }
            }
            plValues[j] = base - winPayout;
          }
        }

        const positivePls = plValues.filter(p => p > 0);
        const negativePls = plValues.filter(p => p < 0);

        let computedMaxLoss: number | null = negativePls.length ? r(Math.min(...negativePls)) : null;
        if (is3Back) {
          const winAmounts = allNumbers.map(([num, v]) => {
            const kept = keptMap.get(num) ?? 0;
            const winRate = customRateMap.get(num) ?? weightedPayoutRate(v);
            return kept * winRate;
          }).sort((a, b) => b - a);
          const top4sum = winAmounts.slice(0, 4).reduce((s, v) => s + v, 0);
          if (top4sum > base) {
            computedMaxLoss = r(base - top4sum);
          }
        } else if (is1Digit) {
          const simRateFn = (num: string) =>
            dealerUpperRate ??
            (customRateMap.get(num) ?? weightedPayoutRate(betMap.get(num)!));
          if (negativePls.length === 0) {
            const maxSinglePayout = Math.max(
              ...allNumbers.map(([num]) => (keptMap.get(num) ?? 0) * simRateFn(num)),
            );
            computedMaxLoss = maxSinglePayout > 0 ? r(-maxSinglePayout) : null;
          } else {
            const totalAllPayout = allNumbers.reduce((s, [num]) =>
              s + (keptMap.get(num) ?? 0) * simRateFn(num), 0);
            computedMaxLoss = r(base - totalAllPayout);
          }
        }

        // จำนวนเก็บใน UI = % ของจำนวนผลลัพธ์ของประเภทนั้น (3 หลัก = 1000 ช่อง 000–999 ไม่ใช่ 1010)
        const countKeptDisplay =
          is3Top || is3Back
            ? roundHalfToEven((threshold_pct / 100) * universeSize)
            : isPermutationWinType
              ? Math.min(TOTE_UNIVERSE, roundHalfToEven((threshold_pct / 100) * TOTE_UNIVERSE))
              : countFullyKept;

        return {
          row: rowNum,
          threshold_pct,
          threshold: r(threshold),
          count_fully_kept: countKeptDisplay,
          total_kept: r(totalKept),
          max_gain: r(Math.max(...plValues)),
          min_gain: positivePls.length ? r(Math.min(...positivePls)) : null,
          max_loss: computedMaxLoss,
          min_loss: negativePls.length ? r(Math.max(...negativePls)) : null,
          avg_gain: positivePls.length
            ? r(positivePls.reduce((s, v) => s + v, 0) / positivePls.length) : null,
          avg_loss: negativePls.length
            ? r(negativePls.reduce((s, v) => s + v, 0) / negativePls.length) : null,
          pct_win: Math.round((positivePls.length / plUniverseSize) * 1000) / 10,
          pct_lose: Math.round((negativePls.length / plUniverseSize) * 1000) / 10,
        };
      };

      for (let i = 0; i < steps; i++) {
        const threshold_pct = i * step_pct;
        let threshold = 0;
        if (i > 0) {
          threshold = roundHalfToEven((threshold_pct / 100) * maxSingleBet);
          threshold = Math.min(threshold, maxSingleBet);
        }
        rows.push(buildRangeRow(threshold, threshold_pct, i + 1));
      }

      let atThreshold: RangeRow | null = null;
      if (activeThresholdBody != null && maxSingleBet > 0) {
        const tCap = Math.min(activeThresholdBody, maxSingleBet);
        const pctForRow = (tCap / maxSingleBet) * 100;
        atThreshold = buildRangeRow(tCap, pctForRow, 0);
      }

      res.json({
        rows,
        at_threshold: atThreshold,
        bet_type,
        cut_scope: { sheet_no: sheetNoBody ?? null, customer_id: customerIdBody ?? null },
        total_revenue: r(totalRevenue),
        max_single_bet: r(maxSingleBet),
        min_single_bet: r(minSingleBet),
        unique_numbers: allNumbers.length,
        distribution,
        dealer_params: {
          upper_rate: dealerUpperRate ?? effectiveRate,
          effective_rate: resolvedBaseRate,
          dealer_pct: dealerPct,
          customer_pct: Math.round(avgCustPct * 100) / 100,
          net_comm_pct: Math.round(netCommRate * 10000) / 100,
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
