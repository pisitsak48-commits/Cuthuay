'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Bet, Customer } from '@/types';

export type BetMoveSheetModalProps = {
  open: boolean;
  onClose: () => void;
  selectedGroups: Set<string>;
  customers: Customer[];
  selectedCustomerId: string;
  savedBets: Bet[];
  sheet: number;
  moveTarget: number;
  setMoveTarget: Dispatch<SetStateAction<number>>;
  moveTargetCustomerId: string;
  setMoveTargetCustomerId: Dispatch<SetStateAction<string>>;
  onMove: (targetSheet: number) => void | Promise<void>;
};

export function BetMoveSheetModal({
  open,
  onClose,
  selectedGroups,
  customers,
  selectedCustomerId,
  savedBets,
  sheet,
  moveTarget,
  setMoveTarget,
  moveTargetCustomerId,
  setMoveTargetCustomerId,
  onMove,
}: BetMoveSheetModalProps) {
  if (!open) return null;

  const tCustId = moveTargetCustomerId === '__same__' ? selectedCustomerId : moveTargetCustomerId;
  const tCustBets = tCustId ? savedBets.filter(b => b.customer_id === tCustId) : savedBets.filter(b => !b.customer_id);
  const tMax = tCustBets.length ? Math.max(...tCustBets.map(b => b.sheet_no ?? 1)) : 1;
  const opts: number[] = Array.from({ length: tMax }, (_, i) => i + 1);
  if (moveTargetCustomerId === '__same__') {
    const idx = opts.indexOf(sheet);
    if (idx >= 0) opts.splice(idx, 1);
  }
  if (!opts.length) opts.push(tMax + 1);

  return (
    <div className="fixed inset-0 bg-[var(--color-backdrop-overlay)] flex items-center justify-center z-50" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="move-sheet-title" className="bg-surface-100 border border-border rounded-lg p-4 w-80 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div id="move-sheet-title" className="text-sm font-semibold text-theme-text-primary">ย้าย — {selectedGroups.size} รายการ</div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-theme-text-secondary w-16 shrink-0">ลูกค้า</span>
          <select
            value={moveTargetCustomerId}
            onChange={e => { setMoveTargetCustomerId(e.target.value); setMoveTarget(1); }}
            className="flex-1 h-8 rounded bg-surface-default border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
          >
            <option value="__same__">เดิม ({customers.find(c => c.id === selectedCustomerId)?.name ?? 'ไม่ระบุ'})</option>
            {customers.filter(c => c.id !== selectedCustomerId).map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs text-theme-text-secondary w-16 shrink-0">ย้ายไปแผ่น</span>
          <select
            value={moveTarget}
            onChange={e => setMoveTarget(Number(e.target.value))}
            className="flex-1 h-8 rounded bg-surface-default border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
          >
            {opts.map(n => (
              <option key={n} value={n}>
                แผ่น {n}{tCustBets.filter(b => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}
              </option>
            ))}
            <option value={tMax + 1}>แผ่น {tMax + 1} (ใหม่)</option>
          </select>
        </div>

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="h-8 px-4 rounded bg-surface-200 text-theme-text-secondary hover:bg-surface-300 text-sm"
          >
            ยกเลิก
          </button>
          <button
            onClick={() => void onMove(moveTarget)}
            className="h-8 px-4 rounded bg-risk-medium/95 hover:bg-risk-medium/90 text-theme-btn-primary-fg text-sm font-semibold"
          >
            ย้าย
          </button>
        </div>
      </div>
    </div>
  );
}
