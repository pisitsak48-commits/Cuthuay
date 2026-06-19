'use client';

import type { Dispatch, SetStateAction } from 'react';
import { BetSearchPanel } from '@/components/bets/BetSearchPanel';
import { BetVoiceAuditBar, type BetVoiceAuditBarProps } from '@/components/bets/BetVoiceAuditBar';
import { COL_TYPES } from '@/lib/bets/betSheetGroups';
import { writePanelLock, STORAGE_BETS_RIGHT_PANEL_LOCK } from '@/lib/panelResize';
import type { Bet, Customer } from '@/types';

export type BetSummaryPanelProps = {
  customers: Customer[];
  selectedCustomerId: string;
  setSelectedCustomerId: (id: string) => void;
  navigateCustomer: (dir: 1 | -1) => void;
  sheet: number;
  setSheet: (n: number) => void;
  setSelectedGroups: Dispatch<SetStateAction<Set<string>>>;
  effectiveMaxSheets: number;
  customerBets: Bet[];
  handleRemoveSheet: () => void;
  handleAddSheet: () => void;
  isAdmin: boolean;
  canMutate?: boolean;
  onOpenLineModal: () => void;
  searchQ: string;
  setSearchQ: (q: string) => void;
  onSearch: () => void;
  onSearchNext: () => void;
  onSearchClear: () => void;
  searchMatchIndexes: number[];
  activeSearchMatchPos: number;
  rightPanelLocked: boolean;
  setRightPanelLocked: Dispatch<SetStateAction<boolean>>;
  sumFs: number;
  setSumFs: Dispatch<SetStateAction<number>>;
  sheetTotal: number;
  customerSavedTotal: number;
  savedTotal: number;
  sheetByType: Record<string, number>;
  customerSavedByType: Record<string, number>;
  summaryByType: Record<string, number>;
  voiceAuditBarProps: Omit<BetVoiceAuditBarProps, 'sheetGrouped' | 'focusedIdx'>;
  sheetGrouped: BetVoiceAuditBarProps['sheetGrouped'];
  focusedIdx: number;
};

export function BetSummaryPanel(props: BetSummaryPanelProps) {
  const {
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    navigateCustomer,
    sheet,
    setSheet,
    setSelectedGroups,
    effectiveMaxSheets,
    customerBets,
    handleRemoveSheet,
    handleAddSheet,
    isAdmin,
    canMutate = true,
    onOpenLineModal,
    searchQ,
    setSearchQ,
    onSearch,
    onSearchNext,
    onSearchClear,
    searchMatchIndexes,
    activeSearchMatchPos,
    rightPanelLocked,
    setRightPanelLocked,
    sumFs,
    setSumFs,
    sheetTotal,
    customerSavedTotal,
    savedTotal,
    sheetByType,
    customerSavedByType,
    summaryByType,
    voiceAuditBarProps,
    sheetGrouped,
    focusedIdx,
  } = props;

  return (
    <div className="bets-right-shell flex flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-[var(--color-bg-primary)]">
      <div className="p-3 shrink-0">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-soft)] p-3 space-y-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-theme-text-muted shrink-0 w-11">ลูกค้า</span>
            <select
              value={selectedCustomerId}
              onChange={(e) => setSelectedCustomerId(e.target.value)}
              className="flex-1 h-8 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] min-w-0"
            >
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => navigateCustomer(-1)}
              className="btn-toolbar-glow btn-toolbar-muted !h-8 !px-2.5 !text-[11px] rounded-xl font-semibold shrink-0"
            >
              ขึ้น
            </button>
            <button
              type="button"
              onClick={() => navigateCustomer(1)}
              className="btn-toolbar-glow btn-fintech-search !h-8 !px-2.5 !text-[11px] rounded-xl font-semibold shrink-0"
            >
              ลง
            </button>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] text-theme-text-muted shrink-0 w-11">แผ่น</span>
            <select
              value={sheet}
              onChange={(e) => {
                setSheet(Number(e.target.value));
                setSelectedGroups(new Set());
              }}
              className="flex-1 h-8 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] tracking-tight"
            >
              {Array.from({ length: effectiveMaxSheets }, (_, i) => effectiveMaxSheets - i).map((n) => (
                <option key={n} value={n}>
                  {n}
                  {customerBets.filter((b) => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleRemoveSheet}
              disabled={!canMutate}
              className="btn-toolbar-glow btn-toolbar-danger !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-xl shrink-0 disabled:opacity-30 disabled:pointer-events-none"
              title="ลบแผ่น (ลบได้เมื่อไม่มีข้อมูล)"
            >
              −
            </button>
            <button
              type="button"
              onClick={handleAddSheet}
              disabled={!canMutate}
              className="btn-toolbar-glow btn-toolbar-profit !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-xl shrink-0 disabled:opacity-30 disabled:pointer-events-none"
              title="เพิ่มแผ่นใหม่"
            >
              +
            </button>
          </div>
          {isAdmin && (
            <button
              type="button"
              onClick={onOpenLineModal}
              className="btn-primary-glow w-full !h-9 !text-xs !rounded-xl !font-semibold shadow-[var(--shadow-btn-primary)]"
            >
              รับข้อมูลไลน์
            </button>
          )}
        </div>
      </div>

      <div className="px-3 pb-3 shrink-0">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-soft)] p-3">
          <BetSearchPanel
            q={searchQ}
            setQ={setSearchQ}
            onSearch={onSearch}
            onNext={onSearchNext}
            onClear={onSearchClear}
            matchCount={searchMatchIndexes.length}
            activeIndex={activeSearchMatchPos}
          />
        </div>
      </div>

      <div className="px-3 pb-3 flex-1 min-h-0 flex flex-col">
        <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-soft)] flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center justify-between gap-2 px-3 py-2.5 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] shrink-0">
            <span className="text-xs font-semibold text-theme-text-secondary tracking-wider">สรุปยอด</span>
            <div className="flex gap-1.5 shrink-0 items-center">
              <button
                type="button"
                onClick={() => {
                  setRightPanelLocked((v) => {
                    const next = !v;
                    writePanelLock(STORAGE_BETS_RIGHT_PANEL_LOCK, next);
                    return next;
                  });
                }}
                className={`text-[11px] w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${
                  rightPanelLocked
                    ? 'text-[var(--color-nav-active-fg)] [background:var(--color-nav-active-bg)] border-transparent shadow-sm hover:brightness-105'
                    : 'text-theme-text-muted bg-[var(--color-surface)] border-[var(--color-border)] hover:bg-[var(--bg-hover)]'
                }`}
                title={
                  rightPanelLocked
                    ? 'ปลดล็อก — ลากขอบซ้ายของแผงสรุปเพื่อปรับความกว้าง'
                    : 'ล็อกความกว้างแผง (ค่าที่ลากไว้จำเมื่อเปิดใหม่)'
                }
                aria-pressed={rightPanelLocked}
              >
                {rightPanelLocked ? '🔒' : '🔓'}
              </button>
              <button
                type="button"
                title="ลดขนาดตารางสรุป"
                onClick={() => setSumFs((s) => Math.max(9, s - 2))}
                className="btn-toolbar-glow btn-toolbar-muted !h-9 !min-w-[2rem] !px-0 !text-[11px] rounded-xl font-bold"
              >
                A−
              </button>
              <button
                type="button"
                title="ขยายขนาดตารางสรุป"
                onClick={() => setSumFs((s) => Math.min(22, s + 2))}
                className="btn-toolbar-glow btn-fintech-search !h-9 !min-w-[2rem] !px-0 !text-[11px] rounded-xl font-bold"
              >
                A+
              </button>
            </div>
          </div>
          <div className="overflow-auto px-2 py-2 flex-1 min-h-0">
            <table className="w-full" style={{ fontSize: sumFs }}>
              <thead>
                <tr className="border-b border-[var(--color-border)]">
                  <th className="text-left py-1.5 pl-1 text-theme-text-muted font-medium">เลข</th>
                  <th className="text-right py-1.5 px-1 text-theme-text-muted font-medium">แผ่น</th>
                  <th className="text-right py-1.5 px-1 text-theme-text-muted font-medium">ลูกค้า</th>
                  <th className="text-right py-1.5 pr-1 text-theme-text-muted font-medium">รวม</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-[var(--color-border)] font-semibold bg-[color-mix(in_srgb,var(--primary-50)_65%,var(--bg-glass-subtle))]">
                  <td className="py-1.5 pl-1 text-[var(--text-secondary)]">รวม</td>
                  <td className="py-1.5 text-right tabular-nums tracking-tight text-[var(--gray-800)] font-semibold">
                    {sheetTotal > 0 ? sheetTotal.toLocaleString() : '—'}
                  </td>
                  <td className="py-1.5 text-right tabular-nums tracking-tight text-[var(--chart-primary-dark)] font-semibold">
                    {customerSavedTotal > 0 ? customerSavedTotal.toLocaleString() : '—'}
                  </td>
                  <td className="py-1.5 pr-1 text-right tabular-nums tracking-tight text-[var(--gray-900)] font-bold">
                    {savedTotal > 0 ? savedTotal.toLocaleString() : '—'}
                  </td>
                </tr>
                {COL_TYPES.map((c) => {
                  const sheetAmt = sheetByType[c.key] ?? 0;
                  const custAmt = customerSavedByType[c.key] ?? 0;
                  const total = summaryByType[c.key] ?? 0;
                  return (
                    <tr key={c.key} className="border-b border-[var(--color-border)] hover:bg-[var(--bg-hover)]">
                      <td className={`py-1 pl-1 text-[0.92em] ${total > 0 ? 'text-[var(--text-secondary)]' : 'text-theme-text-muted'}`}>
                        {c.label}
                      </td>
                      <td
                        className={`py-1 text-right tabular-nums tracking-tight text-[0.92em] font-medium ${sheetAmt > 0 ? 'text-[var(--gray-800)]' : 'text-theme-text-muted/35'}`}
                      >
                        {sheetAmt > 0 ? sheetAmt.toLocaleString() : '·'}
                      </td>
                      <td
                        className={`py-1 text-right tabular-nums tracking-tight text-[0.92em] font-medium ${custAmt > 0 ? 'text-[var(--chart-primary-dark)]' : 'text-theme-text-muted/35'}`}
                      >
                        {custAmt > 0 ? custAmt.toLocaleString() : '·'}
                      </td>
                      <td
                        className={`py-1 pr-1 text-right tabular-nums tracking-tight text-[0.92em] font-semibold ${total > 0 ? 'text-[var(--gray-900)]' : 'text-theme-text-muted/35'}`}
                      >
                        {total > 0 ? total.toLocaleString() : '·'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <BetVoiceAuditBar {...voiceAuditBarProps} sheetGrouped={sheetGrouped} focusedIdx={focusedIdx} />
        </div>
      </div>
    </div>
  );
}
