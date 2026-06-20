'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useFocusTrap } from '@/lib/useFocusTrap';
import type { BetType, Dealer, SendBatch } from '@/types';
import { BET_TYPE_LABELS } from '@/types';
import { formatBaht } from '@/lib/utils';

const DEALER_RATE_KEYS: Record<BetType, keyof Dealer> = {
  '3digit_top':    'rate_3top',    '3digit_tote':   'rate_3tote',   '3digit_back':   'rate_3back',
  '2digit_top':    'rate_2top',    '2digit_bottom':  'rate_2bottom',
  '1digit_top':    'rate_1top',    '1digit_bottom':  'rate_1bottom',
};
const DEALER_PCT_KEYS: Record<BetType, keyof Dealer> = {
  '3digit_top':    'pct_3top',    '3digit_tote':   'pct_3tote',   '3digit_back':   'pct_3back',
  '2digit_top':    'pct_2top',    '2digit_bottom':  'pct_2bottom',
  '1digit_top':    'pct_1top',    '1digit_bottom':  'pct_1bottom',
};

export function SaveDealerModal({
  dealers,
  activeBetType,
  initialDealerId,
  betTypeLabel,
  totalSend,
  cutItemsCount,
  saving,
  onClose,
  onConfirm,
}: {
  dealers: Dealer[];
  activeBetType: BetType;
  initialDealerId: string;
  betTypeLabel: string;
  totalSend: number;
  cutItemsCount: number;
  saving: boolean;
  onClose: () => void;
  onConfirm: (dealerId: string) => void;
}) {
  const panelRef = useFocusTrap(true, onClose);
  const firstActiveDealerId = dealers.find(d => d.is_active)?.id ?? '';
  const [dealerId, setDealerId] = useState(initialDealerId || firstActiveDealerId);

  useEffect(() => {
    setDealerId(initialDealerId || dealers.find(d => d.is_active)?.id || '');
  }, [initialDealerId, dealers]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)]  p-4" onClick={onClose}>
      <motion.div
        ref={panelRef}
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        role="dialog" aria-modal="true" aria-labelledby="send-confirm-title"
        tabIndex={-1}
        className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-md focus:outline-none"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 id="send-confirm-title" className="font-bold text-theme-text-primary text-base">บันทึกส่ง</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {betTypeLabel} · {cutItemsCount} รายการ · <span className=" tracking-tight text-[var(--color-accent-hover)]">{formatBaht(totalSend)}</span>
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="w-8 h-8 flex items-center justify-center rounded-lg text-theme-text-muted hover:text-theme-text-secondary hover:bg-surface-200 transition-colors">✕</button>
        </div>

        {/* Dealer list */}
        <div className="px-5 py-4 space-y-2 max-h-72 overflow-auto">
          <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">เลือกเจ้ามือ</p>

          {dealers.filter(d => d.is_active).map(dealer => {
            const rate = (dealer as any)[DEALER_RATE_KEYS[activeBetType]];
            const pct  = (dealer as any)[DEALER_PCT_KEYS[activeBetType]];
            return (
              <label key={dealer.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                dealer.id === dealerId ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-border'}`}>
                <input type="radio" name="cut-send-dealer" className="accent-accent mt-0.5" checked={dealer.id === dealerId} onChange={() => setDealerId(dealer.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-theme-text-primary">{dealer.name}</p>
                  <div className="flex flex-wrap gap-4 mt-1 text-xs text-theme-text-muted">
                    <span>จ่าย: <span className=" tracking-tight text-risk-medium">{rate ?? '—'}</span></span>
                    <span>ลด: <span className=" tracking-tight text-theme-text-secondary">{pct ?? 0}%</span></span>
                    <span>เก็บสุทธิ: <span className=" tracking-tight text-theme-text-secondary">{dealer.keep_net_pct}%</span></span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose}
            className="h-9 px-4 rounded-lg bg-surface-300 hover:bg-surface-200 text-sm text-theme-text-secondary transition-colors border border-border">
            ยกเลิก
          </button>
          <button onClick={() => onConfirm(dealerId)} disabled={saving || !dealerId}
            className="btn-primary-glow h-9 px-5 text-sm rounded-xl disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึกส่ง'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Sent batch detail modal ────────────────────────────────────────────────
export function SendBatchItemsModal({
  batch,
  onClose,
}: {
  batch: SendBatch;
  onClose: () => void;
}) {
  const panelRef = useFocusTrap(true, onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)]  p-4" onClick={onClose}>
      <motion.div
        ref={panelRef}
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        role="dialog" aria-modal="true" aria-labelledby="sent-numbers-title"
        tabIndex={-1}
        className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-lg max-h-[78vh] flex flex-col focus:outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 id="sent-numbers-title" className="text-sm font-semibold text-theme-text-primary">เลขที่ส่งแล้ว</h3>
            <p className="text-[11px] text-theme-text-muted mt-0.5">
              {BET_TYPE_LABELS[batch.bet_type]} · {batch.dealer_name ?? '—'} · {formatBaht(batch.total)}
            </p>
          </div>
          <button type="button" onClick={onClose} aria-label="ปิด" className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-200 text-theme-text-secondary hover:text-theme-text-primary transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-200 border-b border-border">
              <tr>
                <th className="text-left py-2 px-3 text-theme-text-muted font-medium">เลข</th>
                <th className="text-right py-2 px-3 text-theme-text-muted font-medium">ยอดส่ง</th>
              </tr>
            </thead>
            <tbody>
              {batch.items
                .slice()
                .sort((a, b) => a.number.localeCompare(b.number, 'th', { numeric: true }))
                .map((it, idx) => (
                  <tr key={`${it.number}-${idx}`} className={`border-b border-border/30 ${idx % 2 === 1 ? 'bg-surface-200/30' : ''}`}>
                    <td className="py-1.5 px-3  tracking-tight font-bold tracking-widest text-theme-text-primary">{it.number}</td>
                    <td className="py-1.5 px-3 text-right  tracking-tight text-accent-glow">{formatBaht(it.amount)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
