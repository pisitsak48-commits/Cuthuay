'use client';

import type { RefObject } from 'react';
import { motion } from 'framer-motion';
import { useFocusTrap } from '@/lib/useFocusTrap';
import type { RangeSimResponse } from '@/types';
import { cn, formatBaht } from '@/lib/utils';

const STEP_OPTIONS = [0.5, 1, 2.5, 5] as const;

export type CutRangeTableModalProps = {
  rangeResult: RangeSimResponse;
  stepPct: number;
  setStepPct: (v: number) => void;
  rangeLoading: boolean;
  pendingRangeIdx: number | null;
  setPendingRangeIdx: (v: number | null) => void;
  committedThreshold: number | null | undefined;
  tableBodyRef: RefObject<HTMLDivElement>;
  onClose: () => void;
  onConfirm: (rowIdx: number, threshold: number) => void;
};

export function CutRangeTableModal({
  rangeResult,
  stepPct,
  setStepPct,
  rangeLoading,
  pendingRangeIdx,
  setPendingRangeIdx,
  committedThreshold,
  tableBodyRef,
  onClose,
  onConfirm,
}: CutRangeTableModalProps) {
  const panelRef = useFocusTrap(true, onClose);
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-backdrop-overlay)]"
    >
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        ref={panelRef}
        role="dialog" aria-modal="true" aria-label="กำหนดช่วง"
        tabIndex={-1}
        className="w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lift-hover)] focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between shrink-0 bg-[var(--color-surface)]">
          <div className="flex items-center gap-3 flex-wrap min-w-0">
            <span className="text-sm font-semibold text-[var(--text-primary)] tracking-tight">กำหนดช่วง</span>
            <span className="text-xs text-[var(--text-secondary)] whitespace-nowrap">เปอร์เซ็นต์</span>
            <span className="text-[11px] font-semibold text-[var(--primary-800)] whitespace-nowrap rounded-lg bg-[var(--primary-100)] px-2.5 py-1 border border-[var(--chart-primary)]/30">
              ใช้ {stepPct}%
            </span>
            <div className="flex items-center gap-1.5 flex-wrap">
              {STEP_OPTIONS.map((v) => {
                const active = Math.abs(v - stepPct) < 1e-6;
                return (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setStepPct(v)}
                    aria-pressed={active}
                    title={active ? `กำลังใช้ขั้น ${v}%` : `ใช้ขั้น ${v}%`}
                    className={`h-8 min-w-[3.5rem] px-2.5 rounded-xl text-xs font-semibold transition-[background-color,color,border-color,box-shadow] inline-flex items-center justify-center gap-1 ${
                      active
                        ? '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] shadow-md ring-1 ring-white/25'
                        : 'bg-[var(--color-surface)] text-[var(--text-secondary)] border-2 border-[var(--color-border)] hover:bg-[var(--primary-50)] hover:border-[color-mix(in_srgb,var(--chart-primary)_40%,var(--color-border))]'
                    }`}
                  >
                    {active ? (
                      <span className="font-bold leading-none select-none opacity-95" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                    <span className="tabular-nums">{v}%</span>
                  </button>
                );
              })}
              {rangeLoading && (
                <span className="text-[11px] text-[var(--text-muted)] animate-pulse ml-1">คำนวณ…</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {pendingRangeIdx !== null && (
              <button
                type="button"
                onClick={() => setPendingRangeIdx(null)}
                className="h-8 rounded-lg border-2 border-[var(--chart-primary)] bg-[var(--primary-100)] px-2.5 text-[11px] font-semibold text-[var(--primary-800)] hover:bg-[var(--primary-200)] transition-colors"
              >
                ล้าง ×
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--color-border-strong)] transition-colors text-base leading-none"
              aria-label="ปิด"
            >
              ✕
            </button>
          </div>
        </div>
        <div
          ref={tableBodyRef}
          className="overflow-auto flex-1 min-h-0 bg-[color-mix(in_srgb,var(--gray-50)_40%,var(--color-surface))]"
        >
          <table className="w-full text-xs whitespace-nowrap">
            <thead className="sticky top-0 z-10 border-b border-[color-mix(in_srgb,var(--chart-primary)_22%,var(--color-border))] bg-gradient-to-r from-[var(--primary-700)] via-[var(--primary-600)] to-[var(--primary-800)]">
              <tr>
                {[
                  'ลำดับ',
                  `${Number.isInteger(stepPct) ? String(stepPct) : stepPct}%`,
                  'จำนวนเก็บ (บาท)',
                  'ยอดได้สูงสุด',
                  'ยอดได้ต่ำสุด',
                  'ยอดเสียสูงสุด',
                  'ยอดเสียต่ำสุด',
                  'ยอดได้เฉลี่ย',
                  'ยอดเสียเฉลี่ย',
                  '% ได้',
                  '% เสีย',
                ].map((h) => (
                  <th
                    key={h}
                    className="py-2.5 px-2.5 text-left text-[color-mix(in_srgb,var(--text-inverse)_90%,transparent)] font-semibold"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rangeResult.rows.map((row, i) => {
                const rowSelected = i === pendingRangeIdx;
                const tdSel = rowSelected
                  ? '!bg-[color-mix(in_srgb,var(--primary-100)_82%,var(--color-surface))] hover:!bg-[color-mix(in_srgb,var(--primary-200)_48%,var(--primary-100))]'
                  : '';
                return (
                  <tr
                    key={i}
                    data-row={i}
                    onClick={() => setPendingRangeIdx(i === pendingRangeIdx ? null : i)}
                    className="border-b border-[var(--color-border)] cursor-pointer transition-colors"
                  >
                    <td
                      className={cn(
                        'py-1.5 px-2.5 text-[var(--text-muted)] tabular-nums',
                        tdSel,
                      )}
                    >
                      {row.row}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums text-[var(--text-secondary)]', tdSel)}>
                      {row.threshold_pct.toFixed(2)}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums font-bold text-[var(--chart-primary-dark)]', tdSel)}>
                      {formatBaht(row.threshold)}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums text-profit font-semibold', tdSel)}>
                      {formatBaht(row.max_gain)}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums text-profit', tdSel)}>
                      {row.min_gain != null ? formatBaht(row.min_gain) : '—'}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums text-loss font-semibold', tdSel)}>
                      {row.max_loss != null ? (
                        formatBaht(row.max_loss)
                      ) : (
                        <span className="text-profit text-[11px]">ไม่เสีย</span>
                      )}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums text-loss', tdSel)}>
                      {row.min_loss != null ? formatBaht(row.min_loss) : '—'}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums text-[var(--gray-800)] font-medium', tdSel)}>
                      {row.avg_gain != null ? formatBaht(row.avg_gain) : '—'}
                    </td>
                    <td className={cn('py-1.5 px-2.5 tabular-nums text-[var(--gray-700)]', tdSel)}>
                      {row.avg_loss != null ? formatBaht(row.avg_loss) : '—'}
                    </td>
                    <td
                      className={cn(
                        `py-1.5 px-2.5 tabular-nums font-semibold ${row.pct_win >= 70 ? 'text-profit' : row.pct_win >= 50 ? 'text-risk-medium' : 'text-[var(--text-secondary)]'}`,
                        tdSel,
                      )}
                    >
                      {row.pct_win.toFixed(1)}
                    </td>
                    <td
                      className={cn(
                        `py-1.5 px-2.5 tabular-nums font-semibold ${row.pct_lose > 30 ? 'text-loss' : row.pct_lose > 0 ? 'text-risk-medium' : 'text-[var(--text-muted)]'}`,
                        tdSel,
                      )}
                    >
                      {row.pct_lose.toFixed(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-t border-[var(--color-border)] shrink-0 bg-[color-mix(in_srgb,var(--gray-50)_35%,var(--color-surface))]">
          <div className="text-xs text-[var(--text-secondary)] max-w-[min(100%,28rem)] leading-relaxed space-y-1.5">
            {committedThreshold != null && (
              <p className="text-[11px] text-[var(--text-accent)]">
                มีรายการส่งแล้ว: เก็บได้ไม่เกิน{' '}
                <span className="tabular-nums font-semibold">{formatBaht(committedThreshold)}</span> บ/เลข —
                เลือกเกินจะถูกปรับลงให้ตรงเส้นส่งแล้ว
              </p>
            )}
            <p>
              {pendingRangeIdx !== null ? (
                <>
                  เลือกเก็บ{' '}
                  <span className="inline-flex items-baseline gap-0.5 rounded-lg [background:var(--color-nav-active-bg)] px-2 py-0.5 text-[var(--color-nav-active-fg)] shadow-sm tabular-nums font-bold text-xs ring-1 ring-white/20">
                    {rangeResult.rows[pendingRangeIdx]?.threshold > 0
                      ? formatBaht(rangeResult.rows[pendingRangeIdx].threshold)
                      : '0'}
                  </span>
                  <span className="text-[var(--text-muted)] font-medium"> บ/เลข</span>
                  {' · '}ลำดับ{' '}
                  <span className="tabular-nums font-semibold text-[var(--gray-800)]">
                    {rangeResult.rows[pendingRangeIdx]?.row}
                  </span>
                  {' · นำ '}
                  <span className="tabular-nums font-medium text-[var(--chart-primary)]">
                    {rangeResult.rows[pendingRangeIdx]?.threshold_pct.toFixed(2)}%
                  </span>
                </>
              ) : (
                <span className="text-[var(--text-muted)]">
                  คลิกแถวเพื่อเลือกช่วง —{' '}
                  <span className="text-[var(--chart-primary-dark)] font-semibold">จำนวนเก็บ</span>คือยอดเก็บต่อเลข
                  (บาท) · <span className="text-[var(--gray-800)] font-semibold">ยอดได้/เสีย</span>ดูได้จากคอลัมน์ถัดไป
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-10 rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
            >
              ยกเลิก
            </button>
            <button
              type="button"
              disabled={pendingRangeIdx === null}
              onClick={() => {
                if (pendingRangeIdx === null) return;
                const row = rangeResult.rows[pendingRangeIdx];
                const clamped =
                  committedThreshold != null ? Math.min(row.threshold, committedThreshold) : row.threshold;
                onConfirm(pendingRangeIdx, clamped);
              }}
              className="btn-primary-glow h-10 px-6 text-sm rounded-xl disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
            >
              ✓ ตกลง
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
