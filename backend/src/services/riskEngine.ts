/**
 * Risk Calculation Engine
 *
 * Computes exposure metrics for a bookmaker holding a portfolio of lottery bets.
 * Each number that wins triggers a payout; the engine finds the worst-case scenario
 * across all possible winning numbers.
 *
 * Analogy to trading: every unique number is an "underlying asset". If it "expires
 * in-the-money" (i.e., is drawn), the bookmaker pays out. The risk engine measures
 * delta, max drawdown, and expected value of the portfolio.
 */

import { BetRow, BetType, NumberExposure, RiskReport } from '../models/types';

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface AggregatedPosition {
  number: string;
  bet_type: BetType;
  total_bet: number;
  payout_rate: number;
}

/**
 * Aggregate raw bet rows into per-number positions, applying custom limits/rates.
 */
function aggregatePositions(
  bets: BetRow[],
  customRates: Map<string, number> = new Map(),
): Map<string, AggregatedPosition> {
  const positions = new Map<string, AggregatedPosition>();

  for (const bet of bets) {
    const key = `${bet.bet_type}:${bet.number}`;
    const existing = positions.get(key);
    const rate = customRates.get(key) ?? bet.payout_rate;

    if (existing) {
      existing.total_bet += Number(bet.amount);
      existing.payout_rate = rate; // take the latest/custom rate
    } else {
      positions.set(key, {
        number: bet.number,
        bet_type: bet.bet_type,
        total_bet: Number(bet.amount),
        payout_rate: rate,
      });
    }
  }

  return positions;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * calculateRisk
 *
 * @param bets        - All active bets for the round.
 * @param customRates - Override payout rates per key ("bet_type:number").
 * @returns RiskReport with max loss, max profit, risk%, and per-number exposures.
 */
export function calculateRisk(
  bets: BetRow[],
  roundId: string,
  customRates: Map<string, number> = new Map(),
): RiskReport {
  if (bets.length === 0) {
    return {
      round_id: roundId,
      total_revenue: 0,
      max_loss: 0,
      max_profit: 0,
      risk_percent: 0,
      expected_pl: 0,
      exposures: [],
      generated_at: new Date(),
    };
  }

  const positions = aggregatePositions(bets, customRates);
  const totalRevenue = bets.reduce((sum, b) => sum + Number(b.amount), 0);

  const exposures: NumberExposure[] = [];
  let worstNetPL = totalRevenue; // best possible = keep everything
  let totalExpectedLoss = 0;
  const N = positions.size; // number of distinct outcomes (for uniform distribution)

  for (const pos of positions.values()) {
    // If this number is drawn:
    //   - Bookmaker pays: pos.total_bet * pos.payout_rate
    //   - Bookmaker collected: totalRevenue (from all bets)
    //   - Net P&L = totalRevenue - pos.total_bet * pos.payout_rate
    const grossLiability = pos.total_bet * pos.payout_rate;
    const netPL = totalRevenue - grossLiability;

    if (netPL < worstNetPL) worstNetPL = netPL;

    // Expected value (uniform distribution across all possible outcomes)
    totalExpectedLoss += netPL;

    exposures.push({
      number: pos.number,
      bet_type: pos.bet_type,
      total_bet: pos.total_bet,
      payout_rate: pos.payout_rate,
      gross_liability: grossLiability,
      net_pl: netPL,
    });
  }

  // Sort by net_pl ascending (most dangerous first)
  exposures.sort((a, b) => a.net_pl - b.net_pl);

  const maxLoss = Math.max(0, -worstNetPL);
  const maxProfit = totalRevenue; // if the drawn number has zero bets placed
  const riskPercent = totalRevenue > 0 ? (maxLoss / totalRevenue) * 100 : 0;
  const expectedPL = N > 0 ? totalExpectedLoss / N : 0;

  return {
    round_id: roundId,
    total_revenue: totalRevenue,
    max_loss: maxLoss,
    max_profit: maxProfit,
    risk_percent: riskPercent,
    expected_pl: expectedPL,
    exposures,
    generated_at: new Date(),
  };
}

/**
 * getTopRiskyNumbers
 * Returns the top N most dangerous numbers (highest potential loss).
 */
export function getTopRiskyNumbers(report: RiskReport, topN = 10): NumberExposure[] {
  return report.exposures.slice(0, topN);
}

/**
 * simulateResult
 * Given a specific winning number, compute actual P&L.
 */
export function simulateResult(
  bets: BetRow[],
  winningNumber: string,
  winningType: BetType,
): number {
  const totalRevenue = bets.reduce((sum, b) => sum + Number(b.amount), 0);
  const matchingBets = bets.filter(
    (b) => b.number === winningNumber && b.bet_type === winningType,
  );
  const totalPayout = matchingBets.reduce(
    (sum, b) => sum + Number(b.amount) * Number(b.payout_rate),
    0,
  );
  return totalRevenue - totalPayout;
}
