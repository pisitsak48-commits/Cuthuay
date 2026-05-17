/**
 * Cut Algorithm — Hedge Trading Engine
 *
 * Objective: Minimize worst-case loss while preserving profit potential.
 *
 * Analogy to hedge trading:
 *   - Each "number" is an underlying asset.
 *   - A number with heavy bets is equivalent to a deeply short position.
 *   - "Cutting" (ตัด/ส่งออก) to a dealer is buying a long position (hedge).
 *   - Dealer rate < customer rate → hedging has a cost (like buying options).
 *   - We solve: minimize total hedge premium s.t. max portfolio loss ≤ riskLimit.
 *
 * Strategies:
 *   1. greedy     — sort by exposure desc, cut each to limit. O(n log n). Fast.
 *   2. min_cost   — greedy + re-allocate minimum over-hedging. Saves premium.
 *   3. proportional — spread cuts proportionally. Useful when dealer supply is limited.
 */

import { BetRow, BetType, CutEntry, CutSimulation, DealerRates } from '../models/types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface Position {
  key: string; // "bet_type:number"
  number: string;
  bet_type: BetType;
  total_bet: number;
  payout_rate: number;
  gross_liability: number; // total_bet * payout_rate
  net_pl: number;          // totalRevenue - gross_liability (negative = loss)
}

function buildPositions(bets: BetRow[]): { positions: Position[]; totalRevenue: number } {
  const totalRevenue = bets.reduce((sum, b) => sum + Number(b.amount), 0);
  const map = new Map<string, Position>();

  for (const bet of bets) {
    const key = `${bet.bet_type}:${bet.number}`;
    const existing = map.get(key);
    if (existing) {
      existing.total_bet += Number(bet.amount);
      existing.gross_liability = existing.total_bet * existing.payout_rate;
      existing.net_pl = totalRevenue - existing.gross_liability;
    } else {
      const total_bet = Number(bet.amount);
      const payout_rate = Number(bet.payout_rate);
      const gross_liability = total_bet * payout_rate;
      map.set(key, {
        key,
        number: bet.number,
        bet_type: bet.bet_type,
        total_bet,
        payout_rate,
        gross_liability,
        net_pl: totalRevenue - gross_liability,
      });
    }
  }

  // Recalculate net_pl now that totalRevenue is final
  for (const pos of map.values()) {
    pos.net_pl = totalRevenue - pos.gross_liability;
  }

  return { positions: [...map.values()], totalRevenue };
}

/**
 * For a single over-limit position, compute the minimum cut amount.
 *
 * Derivation:
 *   After cutting C baht (sending to dealer at dealer_rate D):
 *     - We pay C to dealer upfront (net).
 *     - If number wins: dealer pays us C * D.
 *     - Our new net P&L when this number wins:
 *         newNetPL = totalRevenue - gross_liability + C * D - C
 *                  = currentNetPL + C * (D - 1)
 *
 *   We want: newNetPL ≥ -riskLimit
 *     currentNetPL + C * (D - 1) ≥ -riskLimit
 *     C ≥ (-riskLimit - currentNetPL) / (D - 1)
 *
 *   Since D > 1 always, direction holds.
 */
function minCutAmount(
  currentNetPL: number,
  riskLimit: number,
  dealerRate: number,
): number {
  if (currentNetPL >= -riskLimit) return 0; // already within limit — no cut needed
  const deficit = -riskLimit - currentNetPL; // how much more loss than allowed
  return deficit / (dealerRate - 1);
}

/**
 * After applying a cut, recompute net P&L for this position.
 * Also adjusts total_fund (bookmaker kept cash decreases by cut_amount).
 */
function applyHedge(pos: Position, cutAmount: number, dealerRate: number): number {
  // From bookmaker's perspective after cut, this position's net PL if it wins:
  return pos.net_pl + cutAmount * (dealerRate - 1);
}

function profitScenarios(
  positions: Position[],
  cuts: CutEntry[],
  totalRevenue: number,
): Array<{ label: string; pl: number }> {
  const cutMap = new Map<string, CutEntry>();
  for (const c of cuts) cutMap.set(`${c.bet_type}:${c.number}`, c);

  const scenarios: Array<{ label: string; pl: number }> = [
    { label: 'No number wins (theory max)', pl: totalRevenue },
  ];

  for (const pos of positions.slice(0, 5)) {
    const cut = cutMap.get(pos.key);
    const netPL = cut
      ? pos.net_pl + cut.cut_amount * (cut.dealer_rate - 1)
      : pos.net_pl;
    scenarios.push({ label: `${pos.bet_type} ${pos.number} wins`, pl: netPL });
  }

  return scenarios;
}

// ─── Strategy Implementations ────────────────────────────────────────────────

/**
 * Strategy: Greedy (Sort by worst exposure, cut each number to exactly riskLimit).
 * Fastest. May slightly over-hedge due to ignoring interaction between numbers.
 */
function strategyGreedy(
  positions: Position[],
  totalRevenue: number,
  riskLimit: number,
  dealerRates: DealerRates,
): CutEntry[] {
  const cuts: CutEntry[] = [];
  const sorted = [...positions].sort((a, b) => a.net_pl - b.net_pl); // worst first

  for (const pos of sorted) {
    if (pos.net_pl >= -riskLimit) continue; // within limit

    const dealerRate = dealerRates[pos.bet_type];
    const cutAmt = minCutAmount(pos.net_pl, riskLimit, dealerRate);

    const afterNetPL = applyHedge(pos, cutAmt, dealerRate);

    cuts.push({
      number: pos.number,
      bet_type: pos.bet_type,
      cut_amount: Math.round(cutAmt * 100) / 100,
      dealer_rate: dealerRate,
      before_risk: Math.max(0, -pos.net_pl),
      after_risk: Math.max(0, -afterNetPL),
      hedge_cost: Math.round(cutAmt * 100) / 100,
      hedge_gain: Math.round(cutAmt * dealerRate * 100) / 100,
    });
  }

  return cuts;
}

/**
 * Strategy: Minimum Cost (Greedy + over-hedge elimination).
 * Re-examines each cut and reduces to exact required amount, avoiding waste.
 */
function strategyMinCost(
  positions: Position[],
  totalRevenue: number,
  riskLimit: number,
  dealerRates: DealerRates,
): CutEntry[] {
  // Start with greedy, then prune over-hedging
  const cuts = strategyGreedy(positions, totalRevenue, riskLimit, dealerRates);

  return cuts.map((cut) => {
    const pos = positions.find(
      (p) => p.number === cut.number && p.bet_type === cut.bet_type,
    );
    if (!pos) return cut;

    const exactCut = minCutAmount(pos.net_pl, riskLimit, cut.dealer_rate);
    const exactRounded = Math.ceil(exactCut); // ceiling ensures we stay within limit

    return {
      ...cut,
      cut_amount: exactRounded,
      hedge_cost: exactRounded,
      hedge_gain: Math.round(exactRounded * cut.dealer_rate * 100) / 100,
      after_risk: Math.max(
        0,
        -(pos.net_pl + exactRounded * (cut.dealer_rate - 1)),
      ),
    };
  });
}

/**
 * Strategy: Proportional
 * Spread cuts proportionally across all over-limit numbers.
 * Useful when total cut budget is constrained.
 */
function strategyProportional(
  positions: Position[],
  totalRevenue: number,
  riskLimit: number,
  dealerRates: DealerRates,
): CutEntry[] {
  const overLimit = positions.filter((p) => p.net_pl < -riskLimit);
  if (overLimit.length === 0) return [];

  const totalDeficit = overLimit.reduce((sum, p) => sum + (-riskLimit - p.net_pl), 0);

  return overLimit.map((pos) => {
    const dealerRate = dealerRates[pos.bet_type];
    const deficit = -riskLimit - pos.net_pl;
    const proportion = deficit / totalDeficit;
    // Allocate proportional share of total required hedging
    const totalRequired = overLimit.reduce((sum, p) => {
      return sum + minCutAmount(p.net_pl, riskLimit, dealerRates[p.bet_type]);
    }, 0);

    const cutAmt = Math.ceil(proportion * totalRequired);
    const afterNetPL = applyHedge(pos, cutAmt, dealerRate);

    return {
      number: pos.number,
      bet_type: pos.bet_type,
      cut_amount: cutAmt,
      dealer_rate: dealerRate,
      before_risk: Math.max(0, -pos.net_pl),
      after_risk: Math.max(0, -afterNetPL),
      hedge_cost: cutAmt,
      hedge_gain: Math.round(cutAmt * dealerRate * 100) / 100,
    };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * autoCut — Main hedging optimizer
 *
 * Returns all three strategy simulations so the user can pick the best fit.
 *
 * @param bets        - Active bets for the round.
 * @param riskLimit   - Maximum acceptable loss in baht.
 * @param dealerRates - Payout rates offered by the upper dealer (< customer rates).
 */
export function autoCut(
  bets: BetRow[],
  riskLimit: number,
  dealerRates: DealerRates,
): CutSimulation[] {
  const { positions, totalRevenue } = buildPositions(bets);

  if (positions.length === 0) return [];

  const worstNetPL = Math.min(...positions.map((p) => p.net_pl));
  const riskBefore = Math.max(0, -worstNetPL);

  const strategies: Array<{
    strategy: CutSimulation['strategy'];
    cuts: CutEntry[];
  }> = [
    { strategy: 'greedy', cuts: strategyGreedy(positions, totalRevenue, riskLimit, dealerRates) },
    { strategy: 'min_cost', cuts: strategyMinCost(positions, totalRevenue, riskLimit, dealerRates) },
    { strategy: 'proportional', cuts: strategyProportional(positions, totalRevenue, riskLimit, dealerRates) },
  ];

  return strategies.map(({ strategy, cuts }) => {
    const totalCutAmount = cuts.reduce((s, c) => s + c.cut_amount, 0);
    const totalHedgeCost = cuts.reduce((s, c) => s + c.hedge_cost, 0);

    // Recalculate worst case after cuts
    const cutMap = new Map(cuts.map((c) => [`${c.bet_type}:${c.number}`, c]));
    let worstAfter = totalRevenue;
    for (const pos of positions) {
      const cut = cutMap.get(pos.key);
      const netPL = cut ? applyHedge(pos, cut.cut_amount, cut.dealer_rate) : pos.net_pl;
      if (netPL < worstAfter) worstAfter = netPL;
    }

    const riskAfter = Math.max(0, -worstAfter);
    const riskReduction = riskBefore > 0 ? ((riskBefore - riskAfter) / riskBefore) * 100 : 0;

    return {
      strategy,
      cuts,
      total_cut_amount: totalCutAmount,
      total_hedge_cost: totalHedgeCost,
      risk_before: riskBefore,
      risk_after: riskAfter,
      risk_reduction_percent: Math.round(riskReduction * 100) / 100,
      profit_scenarios: profitScenarios(positions, cuts, totalRevenue),
    };
  });
}

/**
 * applyCutPlan — Applies a specific cut plan to verify resulting risk.
 * Used for "what-if" simulations in the frontend.
 */
export function applyCutPlan(
  bets: BetRow[],
  cuts: CutEntry[],
): { positions: Position[]; totalRevenue: number; riskAfter: number } {
  const { positions, totalRevenue } = buildPositions(bets);
  const cutMap = new Map(cuts.map((c) => [`${c.bet_type}:${c.number}`, c]));

  let worstNetPL = totalRevenue;
  for (const pos of positions) {
    const cut = cutMap.get(pos.key);
    const netPL = cut ? applyHedge(pos, cut.cut_amount, cut.dealer_rate) : pos.net_pl;
    if (netPL < worstNetPL) worstNetPL = netPL;
  }

  return {
    positions,
    totalRevenue,
    riskAfter: Math.max(0, -worstNetPL),
  };
}
