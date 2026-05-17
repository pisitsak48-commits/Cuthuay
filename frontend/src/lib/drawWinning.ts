import type { BetType } from '@/types';

/** สร้างชุดคีย์ `${bet_type}::${number}` — ให้สอดคล้องกับการคิดผลถูกใน backend (reports customer-wins / submit result) */
export function buildWinningKeysFromResultData(rd: Record<string, unknown> | null | undefined): Set<string> {
  const keys = new Set<string>();
  if (!rd) return keys;

  const str = (v: unknown): string[] => {
    if (v == null || v === '') return [];
    if (Array.isArray(v)) return v.flatMap(str);
    const s = String(v);
    return s.length > 0 ? [s] : [];
  };

  const addAll = (betType: BetType, vals: string[]) => {
    for (const n of vals) keys.add(`${betType}::${n}`);
  };

  addAll('3digit_top', str(rd.prize_3top));
  addAll('3digit_tote', str(rd.tote_numbers));
  addAll('3digit_back', str(rd.prize_3bottom));

  addAll('2digit_top', str(rd.prize_2top));
  addAll('2digit_bottom', str(rd.prize_2bottom));

  addAll('1digit_top', str(rd.prize_1top));
  addAll('1digit_bottom', str(rd.prize_1bottom));

  return keys;
}

/** มีโพยในแถวที่ถูกรางวัลตามผลที่ออกแล้วหรือไม่ */
export function groupTouchesWinningDraw(
  bets: Array<{ bet_type: string; number: string }>,
  winKeys: Set<string>,
): boolean {
  if (winKeys.size === 0) return false;
  return bets.some((b) => winKeys.has(`${b.bet_type}::${b.number}`));
}
