import { describe, expect, it } from 'vitest';
import {
  expandNumberInput,
  getPermutations,
  parseBetLine,
  parseLineBetsText,
} from './betParser';

describe('expandNumberInput', () => {
  it('expands -- to all double-zero pairs', () => {
    const r = expandNumberInput('--');
    expect(r?.mode).toBe('2digit');
    expect(r?.numbers).toHaveLength(10);
    expect(r?.numbers[0]).toBe('00');
    expect(r?.numbers[9]).toBe('99');
  });

  it('expands 10-15 range', () => {
    const r = expandNumberInput('10-15');
    expect(r?.numbers).toEqual(['10', '11', '12', '13', '14', '15']);
  });

  it('parses front-run pattern 5*', () => {
    const r = expandNumberInput('5*');
    expect(r?.numbers).toHaveLength(10);
    expect(r?.numbers).toContain('50');
    expect(r?.numbers).toContain('59');
  });

  it('marks trailing dash as klap', () => {
    const r = expandNumberInput('125-');
    expect(r?.isKlap).toBe(true);
    expect(r?.mode).toBe('3digit');
    expect(r?.numbers).toEqual(['125']);
  });
});

describe('getPermutations', () => {
  it('returns unique permutations for 3-digit klap', () => {
    expect(getPermutations('114').sort()).toEqual(['114', '141', '411']);
  });
});

describe('parseBetLine', () => {
  it('splits 2-digit top and bottom amounts', () => {
    const r = parseBetLine('12', '100*50');
    expect(r.error).toBeUndefined();
    expect(r.bets).toEqual([
      { number: '12', bet_type: '2digit_top', amount: 100 },
      { number: '12', bet_type: '2digit_bottom', amount: 50 },
    ]);
  });

  it('expands klap 2-digit into permutations', () => {
    const r = parseBetLine('12-', '100*50-');
    const tops = r.bets.filter((b) => b.bet_type === '2digit_top');
    expect(tops).toHaveLength(2);
    expect(tops.map((b) => b.number).sort()).toEqual(['12', '21']);
  });
});

describe('parseLineBetsText', () => {
  it('parses LINE-style 12=100×100', () => {
    const r = parseLineBetsText('12=100×100');
    expect(r.error).toBeUndefined();
    expect(r.bets.length).toBeGreaterThanOrEqual(2);
    const top = r.bets.find((b) => b.bet_type === '2digit_top' && b.number === '12');
    const bot = r.bets.find((b) => b.bet_type === '2digit_bottom' && b.number === '12');
    expect(top?.amount).toBe(100);
    expect(bot?.amount).toBe(100);
  });
});
