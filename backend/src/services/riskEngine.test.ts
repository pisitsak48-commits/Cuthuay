import { describe, expect, it } from 'vitest';
import type { BetRow } from '../models/types';
import { calculateRisk } from './riskEngine';

function bet(partial: Pick<BetRow, 'number' | 'bet_type' | 'amount' | 'payout_rate'>): BetRow {
  return {
    id: 'b1',
    round_id: 'r1',
    customer_ref: null,
    created_by: 'u1',
    created_at: new Date(),
    updated_at: new Date(),
    sort_order: null,
    import_batch_id: null,
    segment_index: 0,
    ...partial,
  };
}

describe('calculateRisk', () => {
  it('returns zeros for empty book', () => {
    const r = calculateRisk([], 'round-1');
    expect(r.total_revenue).toBe(0);
    expect(r.max_loss).toBe(0);
    expect(r.exposures).toHaveLength(0);
  });

  it('computes max loss when a number would pay out heavily', () => {
    const bets = [
      bet({ number: '12', bet_type: '2digit_top', amount: 100, payout_rate: 90 }),
      bet({ number: '34', bet_type: '2digit_top', amount: 50, payout_rate: 90 }),
    ];
    const r = calculateRisk(bets, 'round-1');
    expect(r.total_revenue).toBe(150);
    expect(r.max_loss).toBe(100 * 90 - 150);
    expect(r.exposures[0].number).toBe('12');
  });
});
