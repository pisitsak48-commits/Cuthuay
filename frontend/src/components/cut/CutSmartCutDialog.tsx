'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import type { RangeSimRow } from '@/types';
import { formatBaht } from '@/lib/utils';
import { compareRangeRowsBetter, smartCutDisplayScore } from '@/lib/cut/rangeSimSort';

export function CutSmartCutDialog({
  rows,
  totalRevenue,
  onClose,
  onApply,
}: {
  rows: RangeSimRow[];
  totalRevenue: number;
  onClose: () => void;
  onApply: (rowIdx: number, threshold: number) => void;
}) {
  const [maxLossLimit, setMaxLossLimit] = useState(Math.round(totalRevenue * 0.5));
  const [minPctWin, setMinPctWin]       = useState(50);
  const resetConstraints = () => {
    setMaxLossLimit(Math.round(totalRevenue * 0.5));
    setMinPctWin(50);
  };

  const revenueScale = Math.max(totalRevenue, 1);
  const scoreDisplay = (r: RangeSimRow) => smartCutDisplayScore(r, revenueScale);

  const working = rows;

  const passAll = working.filter(r =>
    (r.max_loss === null || Math.abs(r.max_loss) <= maxLossLimit) &&
    r.pct_win >= minPctWin
  );
  const passLossOnly = working.filter(r => r.max_loss === null || Math.abs(r.max_loss) <= maxLossLimit);

  const top5 = [...working]
    .sort((a, b) => {
      const c = compareRangeRowsBetter(a, b);
      if (c !== 0) return -c;
      return scoreDisplay(b) - scoreDisplay(a);
    })
    .slice(0, 5);

  // Primary suggestion — lexicographic: ได้สูงสุด → เสียต่ำสุด → % ได้
  let primary: { row: RangeSimRow; rowIdx: number; label: string; color: string; reason: string } | null = null;
  let secondary: { row: RangeSimRow; rowIdx: number; label: string; color: string; reason: string } | null = null;

  if (passAll.length > 0) {
    const best = passAll.reduce((a, b) => (compareRangeRowsBetter(a, b) >= 0 ? a : b));
    primary = {
      row: best, rowIdx: rows.indexOf(best),
      label: '⭐ แนะนำ (ได้สูง · เสียต่ำ ในกรอบที่ตั้ง)', color: 'emerald',
      reason: `ได้สูงสุด ${formatBaht(best.max_gain)} · เสียสูงสุด ${best.max_loss != null ? formatBaht(best.max_loss) : 'ไม่เสีย'} · %ได้ ${best.pct_win.toFixed(1)}%`,
    };
    const thrifty = passAll.reduce((a, b) => b.threshold > a.threshold ? b : a);
    if (rows.indexOf(thrifty) !== rows.indexOf(best)) {
      secondary = {
        row: thrifty, rowIdx: rows.indexOf(thrifty),
        label: '💰 ประหยัด (เก็บมาก ส่งน้อย)', color: 'violet',
        reason: `เก็บถึง ${formatBaht(thrifty.threshold)} บ/เลข · ส่งออกน้อยสุดที่ยังผ่านเงื่อนไข · %ได้ ${thrifty.pct_win.toFixed(1)}%`,
      };
    }
  } else if (passLossOnly.length > 0) {
    const best2 = passLossOnly.reduce((a, b) => (compareRangeRowsBetter(a, b) >= 0 ? a : b));
    primary = {
      row: best2, rowIdx: rows.indexOf(best2),
      label: '⚠️ ดีที่สุดในช่วงยอมรับได้ (%ได้ต่ำกว่าเป้า)', color: 'amber',
      reason: `%ได้ ${best2.pct_win.toFixed(1)}% (เป้า ≥${minPctWin}%) · เสียสูงสุด: ${best2.max_loss != null ? formatBaht(best2.max_loss) : 'ไม่เสีย'}`,
    };
  } else {
    const best3 = working.reduce((a, b) => (compareRangeRowsBetter(a, b) >= 0 ? a : b));
    primary = {
      row: best3, rowIdx: rows.indexOf(best3),
      label: '⚠️ ดีที่สุดที่มี (ยอดเสียเกิน limit)', color: 'amber',
      reason: `ได้สูงสุด ${formatBaht(best3.max_gain)} · เสียสูงสุด ${best3.max_loss != null ? formatBaht(best3.max_loss) : 'ไม่เสีย'} · ลองผ่อนปรนเพดานเสีย`,
    };
  }

  const colorMap: Record<string, { bg: string; border: string; text: string; btn: string }> = {
    emerald: { bg: 'bg-profit/10', border: 'border-profit/35', text: 'text-profit', btn: 'btn-primary-glow' },
    amber:   { bg: 'bg-[var(--primary-50)]', border: 'border-[var(--color-badge-info-border)]', text: 'text-[var(--primary-900)]', btn: 'btn-primary-glow' },
    violet:  { bg: 'bg-[color-mix(in_srgb,var(--primary-400)_12%,transparent)]', border: 'border-[var(--chart-primary)]/35', text: 'text-[var(--primary-800)]', btn: 'btn-primary-glow' },
  };

  const SuggestionCard = ({ s }: { s: typeof primary }) => {
    if (!s) return null;
    const c = colorMap[s.color] ?? colorMap['amber'];
    return (
      <div className={`${c.bg} border-2 ${c.border} rounded-xl p-4 shadow-[var(--shadow-soft)]`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-bold text-sm ${c.text}`}>{s.label}</p>
            <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed">{s.reason}</p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs">
              <span className="text-[var(--text-secondary)]">เก็บตัวละ:{' '}
                <span className="tabular-nums font-bold text-[var(--chart-primary-dark)]">{s.row.threshold > 0 ? formatBaht(s.row.threshold) : '0'}</span>
                <span className="text-[var(--text-muted)] font-medium"> บ/เลข</span>
              </span>
              <span className="text-[var(--text-secondary)]">จำนวนเก็บ:{' '}
                <span className="tabular-nums font-semibold text-[var(--gray-800)]">{s.row.count_fully_kept}</span>
              </span>
              <span className="text-[var(--text-secondary)]">%ได้: <span className="tabular-nums font-semibold text-profit">{s.row.pct_win.toFixed(1)}%</span></span>
              <span className="text-[var(--text-secondary)]">%เสีย: <span className="tabular-nums font-semibold text-loss">{s.row.pct_lose.toFixed(1)}%</span></span>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1.5 text-xs">
              <span className="text-[var(--text-secondary)]">ได้สูงสุด: <span className="tabular-nums font-semibold text-profit">{formatBaht(s.row.max_gain)}</span></span>
              <span className="text-[var(--text-secondary)]">เสียสูงสุด: <span className={`tabular-nums font-semibold ${s.row.max_loss != null ? 'text-loss' : 'text-profit'}`}>
                {s.row.max_loss != null ? formatBaht(s.row.max_loss) : 'ไม่เสีย'}</span>
              </span>
            </div>
          </div>
          <button type="button"
            onClick={() => { onApply(s.rowIdx, s.row.threshold); onClose(); }}
            className={`shrink-0 h-9 rounded-xl px-4 text-xs font-semibold ${c.btn}`}>
            ใช้ค่านี้
          </button>
        </div>
      </div>
    );
  };

  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)] p-4">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        role="dialog" aria-modal="true" aria-labelledby="smart-cut-title"
        className="w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lift-hover)]">

        {/* Header */}
        <div className="shrink-0 border-b border-[var(--color-border)] bg-gradient-to-r from-[var(--primary-50)] via-[var(--color-surface)] to-[color-mix(in_srgb,var(--primary-100)_35%,white)] px-5 py-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 id="smart-cut-title" className="font-bold text-[var(--text-primary)] text-base tracking-tight">✨ ตัดอัจฉริยะ</h3>
              <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed max-w-xl">วิเคราะห์จุดตัดที่เหมาะสมโดยอัตโนมัติ — ปรับเพดานเสียกับ % ได้ขั้นต่ำแล้วเลือกค่าที่แนะนำ</p>
            </div>
            <button type="button" onClick={onClose} className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-secondary)] hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)] transition-colors text-lg leading-none" aria-label="ปิด">✕</button>
          </div>
        </div>

        {/* Explanation */}
        <div className="shrink-0 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--primary-50)_45%,var(--color-surface))] px-5 py-3">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--primary-800)] mb-1.5">หลักการคำนวณ</p>
          <div className="flex flex-col gap-2 text-xs text-[var(--text-secondary)] leading-relaxed">
            <p><span className="font-semibold text-[var(--text-primary)]">เรียงแถว:</span> <span className="text-profit font-medium">ยอดได้สูงสุด</span> มากสุดก่อน · ถ้าเท่ากันดู <span className="text-loss font-medium">ยอดเสียสูงสุด</span> (ต่ำกว่าดีกว่า) · แล้วค่อย <span className="text-[var(--chart-primary)] font-medium">% ได้</span> — ชุดข้อมูลเดียวกับตารางกำหนดช่วง</p>
            <p><span className="font-semibold text-[var(--text-primary)]">กรอง:</span> <span className="text-loss/90">เพดานยอดเสีย</span> + <span className="text-profit">% ได้ ขั้นต่ำ</span> · แถวที่ผ่าน: <span className={`font-bold tabular-nums ${passAll.length > 0 ? 'text-profit' : 'text-loss'}`}>{passAll.length}</span><span className="text-[var(--text-muted)]">/{working.length}</span></p>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Constraints */}
          <div className="px-5 py-4 border-b border-[var(--color-border)] space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">ตั้งค่าเงื่อนไข</p>
              <button type="button" onClick={resetConstraints} className="h-8 rounded-lg border-2 border-[var(--chart-primary)] bg-[var(--primary-100)] px-3 text-[11px] font-semibold text-[var(--primary-800)] hover:bg-[var(--primary-200)] transition-colors">
                รีเซ็ตเงื่อนไข
              </button>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">เพดานยอดเสียที่รับได้ (บาท)</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} value={maxLossLimit}
                    onChange={e => setMaxLossLimit(Number(e.target.value) || 0)}
                    className="h-9 flex-1 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm tabular-nums text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)]" />
                  <span className="text-xs text-[var(--text-muted)] shrink-0 tabular-nums">≈{((maxLossLimit / Math.max(totalRevenue, 1)) * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={0} max={totalRevenue} step={Math.ceil(totalRevenue / 100)}
                  value={Math.min(maxLossLimit, totalRevenue)}
                  onChange={e => setMaxLossLimit(Number(e.target.value))}
                  className="w-full h-2 rounded-full accent-[var(--chart-primary)]" />
                <p className="text-[11px] text-[var(--text-muted)]">ยอดขาดทุนสูงสุดที่ยอมรับได้ถ้าเลขถูก</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--text-secondary)]">% ได้กำไรขั้นต่ำ</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={100} value={minPctWin}
                    onChange={e => setMinPctWin(Number(e.target.value) || 0)}
                    className="h-9 flex-1 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm tabular-nums text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)]" />
                  <span className="text-xs text-[var(--text-muted)] shrink-0">%</span>
                </div>
                <input type="range" min={0} max={100} step={5}
                  value={minPctWin}
                  onChange={e => setMinPctWin(Number(e.target.value))}
                  className="w-full h-2 rounded-full accent-[var(--chart-primary)]" />
                <p className="text-[11px] text-[var(--text-muted)]">จาก 100 ผลที่เป็นไปต้องได้กำไรอย่างน้อยกี่ %</p>
              </div>
            </div>
          </div>

          {/* Suggestions */}
          <div className="px-5 py-4 space-y-3 border-b border-[var(--color-border)]">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)]">ผลการวิเคราะห์</p>
            <SuggestionCard s={primary} />
            {secondary && <SuggestionCard s={secondary} />}
          </div>

          {/* Top 5 scoring table */}
          <div className="px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-secondary)] mb-2">Top 5 แถว (เรียงได้สูง → เสียต่ำ → %ได้)</p>
            <div className="overflow-auto rounded-xl border border-[var(--color-border)] shadow-[var(--shadow-soft)]">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="border-b border-[color-mix(in_srgb,var(--chart-primary)_28%,var(--color-border))] bg-gradient-to-r from-[var(--primary-700)] via-[var(--primary-600)] to-[var(--primary-800)]">
                  <tr>
                    {['#', 'ดัชนี', 'เก็บตัวละ', 'จำนวนเก็บ', '%ได้', '%เสีย', 'ได้สูงสุด', 'เสียสูงสุด', ''].map(h => (
                      <th key={h} className="py-2.5 px-2.5 text-left text-[color-mix(in_srgb,var(--text-inverse)_92%,transparent)] font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-[var(--color-surface)]">
                  {top5.map((row, i) => {
                    const rowIdx = rows.indexOf(row);
                    const pass = (row.max_loss === null || Math.abs(row.max_loss) <= maxLossLimit) && row.pct_win >= minPctWin;
                    return (
                      <tr key={i} className={`border-b border-[var(--color-border)]/80 ${pass ? '' : 'opacity-45'} hover:bg-[var(--primary-50)]/80 transition-colors`}>
                        <td className="py-1.5 px-2.5 text-[var(--text-muted)] tabular-nums">{row.row}</td>
                        <td className="py-1.5 px-2.5 tabular-nums text-[var(--chart-primary)] font-semibold">{scoreDisplay(row).toFixed(0)}</td>
                        <td className="py-1.5 px-2.5 tabular-nums font-semibold text-[var(--chart-primary-dark)]">{formatBaht(row.threshold)}</td>
                        <td className="py-1.5 px-2.5 tabular-nums font-medium text-[var(--gray-800)]">{row.count_fully_kept}</td>
                        <td className={`py-1.5 px-2.5 tabular-nums font-semibold ${row.pct_win >= minPctWin ? 'text-profit' : 'text-loss'}`}>{row.pct_win.toFixed(1)}%</td>
                        <td className="py-1.5 px-2.5 tabular-nums text-loss">{row.pct_lose.toFixed(1)}%</td>
                        <td className="py-1.5 px-2.5 tabular-nums text-profit font-medium">{formatBaht(row.max_gain)}</td>
                        <td className={`py-1.5 px-2.5 tabular-nums ${row.max_loss != null ? (Math.abs(row.max_loss) <= maxLossLimit ? 'text-loss' : 'text-loss font-bold') : 'text-profit'}`}>
                          {row.max_loss != null ? formatBaht(row.max_loss) : 'ไม่เสีย'}
                        </td>
                        <td className="py-1.5 px-1">
                          <button type="button" onClick={() => { onApply(rowIdx, row.threshold); onClose(); }}
                            className="h-7 rounded-lg border border-[var(--chart-primary)] bg-[var(--primary-100)] px-2.5 text-[11px] font-semibold text-[var(--primary-800)] hover:bg-[var(--primary-200)] transition-colors">
                            ใช้
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 flex justify-end gap-2 border-t border-[var(--color-border)] bg-[color-mix(in_srgb,var(--gray-50)_45%,var(--color-surface))] px-5 py-3">
          <button type="button" onClick={onClose} className="h-9 rounded-xl border-2 border-[var(--chart-primary)] bg-[var(--primary-100)] px-5 text-sm font-semibold text-[var(--primary-800)] hover:bg-[var(--primary-200)] transition-colors">ปิด</button>
        </div>
      </motion.div>
    </div>
  );
}
