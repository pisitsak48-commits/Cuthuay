'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';

export function CutSearchDialog({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (mode: string, value: number) => void;
}) {
  const [mode, setMode] = useState<'manual' | 'pct_win' | 'max_payout'>('manual');
  const [value, setValue] = useState(0);
  const opts = [
    { k: 'manual'     as const, label: 'กำหนดเองโดยตรง',    hint: 'บาท / เลข' },
    { k: 'pct_win'    as const, label: 'ค้นหา % ได้เสีย',   hint: '% ได้ ≥' },
    { k: 'max_payout' as const, label: 'ค้นหายอดจ่ายสูงสุด', hint: 'จ่ายสูงสุด ≤' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)] p-4">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        role="dialog" aria-modal="true" aria-labelledby="cut-search-title"
        className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-lift-hover)]">
        <div className="border-b border-[var(--color-border)] bg-gradient-to-r from-[var(--primary-50)] via-[var(--color-surface)] to-[color-mix(in_srgb,var(--primary-100)_40%,white)] px-6 py-4">
          <h3 id="cut-search-title" className="font-semibold text-[var(--text-primary)] text-lg tracking-tight">ค้นหายอดตัด</h3>
          <p className="text-xs text-[var(--text-secondary)] mt-1">เลือกวิธีแล้วกรอกค่า — ระบบจะไฮไลต์แถวในตารางกำหนดช่วงให้</p>
        </div>
        <div className="space-y-3 px-6 py-5">
          {opts.map((o) => (
            <label key={o.k} className={`flex flex-col gap-2 rounded-xl border-2 p-3.5 cursor-pointer transition-all duration-200 ease-out ${
              mode === o.k
                ? 'border-[var(--chart-primary)] bg-[var(--primary-50)] shadow-[var(--shadow-soft)] ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_18%,transparent)]'
                : 'border-[var(--color-border)] bg-[color-mix(in_srgb,var(--gray-50)_70%,white)] hover:border-[color-mix(in_srgb,var(--chart-primary)_35%,var(--color-border)))]'}`}>
              <div className="flex items-center gap-2.5">
                <input type="radio" className="h-4 w-4 accent-[var(--chart-primary)]" checked={mode === o.k} onChange={() => setMode(o.k)} />
                <span className={`text-sm font-semibold ${mode === o.k ? 'text-[var(--primary-900)]' : 'text-[var(--text-primary)]'}`}>{o.label}</span>
              </div>
              {mode === o.k && (
                <div className="flex flex-wrap items-center gap-2 pl-7">
                  <span className="text-[11px] shrink-0 font-medium text-[var(--text-secondary)]">{o.hint}</span>
                  <input type="number" min={0} value={value} onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
                    className="h-9 w-36 rounded-lg border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm tabular-nums font-semibold text-[var(--text-primary)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)]" />
                </div>
              )}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2 border-t border-[var(--color-border)] bg-[color-mix(in_srgb,var(--gray-50)_50%,var(--color-surface))] px-6 py-4">
          <button type="button" className="h-9 rounded-xl border-2 border-[var(--color-border)] bg-[var(--color-surface)] px-4 text-sm font-semibold text-[var(--text-primary)] hover:bg-[var(--bg-hover)] hover:border-[var(--color-border-strong)] transition-colors duration-200" onClick={onClose}>ยกเลิก</button>
          <button type="button" className="btn-primary-glow h-9 px-5 text-sm rounded-xl" onClick={() => onConfirm(mode, value)}>ตกลง</button>
        </div>
      </motion.div>
    </div>
  );
}
