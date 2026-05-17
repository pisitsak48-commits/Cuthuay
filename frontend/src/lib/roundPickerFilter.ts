import type { Round } from '@/types';

/** ฟิลด์ที่ใช้กรองเมนูงวดบนหน้าสรุป / ตัดหวย */
export type RoundPickerRow = Pick<Round, 'id' | 'name' | 'draw_date' | 'status'>;

/**
 * เมนูงวดหน้าสรุปและตัดหวย — โดยค่าเริ่มต้นซ่อน archived และซ่อนงวดเก่า (วันออกก่อนวันล่าสุด)
 * เหลือเฉพาะงวดที่ยังเปิดรับ และงวดที่ตรงวันออกล่าสุดในงวดที่ยังไม่ archived
 */
export function filterRoundsForSummaryCutPicker(
  rounds: RoundPickerRow[],
  opts: { includeArchivedSummaries: boolean; isAdmin: boolean },
): RoundPickerRow[] {
  const showAllHidden = Boolean(opts.isAdmin && opts.includeArchivedSummaries);
  if (showAllHidden) return [...rounds];

  const active = rounds.filter((r) => r.status !== 'archived');
  if (active.length === 0) return [];

  let maxD = active[0].draw_date;
  for (let i = 1; i < active.length; i++) {
    const d = active[i].draw_date;
    if (d > maxD) maxD = d;
  }

  return active.filter((r) => r.status === 'open' || r.draw_date >= maxD);
}
