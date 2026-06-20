'use client';

import type { Dispatch, SetStateAction } from 'react';
import { BetType, Dealer } from '@/types';
import type { RangeSimResponse } from '@/types';
import type { RoundPickerRow } from '@/lib/roundPickerFilter';

const BET_TYPE_ORDER: BetType[] = [
  '3digit_top', '3digit_tote', '3digit_back',
  '2digit_top', '2digit_bottom', '1digit_top', '1digit_bottom',
];
const BET_TYPE_SHORT: Record<BetType, string> = {
  '3digit_top': '3 ตัวบน', '3digit_tote': '3 ตัวโต็ด', '3digit_back': '3 ตัวล่าง',
  '2digit_top': '2 ตัวบน', '2digit_bottom': '2 ตัวล่าง',
  '1digit_top': 'วิ่งบน',  '1digit_bottom': 'วิ่งล่าง',
};

export type CutToolbarProps = {
  roundsForPicker: RoundPickerRow[];
  selectedRoundId: string;
  setSelectedRoundId: Dispatch<SetStateAction<string>>;
  isAdmin: boolean;
  cutIncludeArchived: boolean;
  setCutIncludeArchived: Dispatch<SetStateAction<boolean>>;
  dealers: Dealer[];
  selectedDealerId: string;
  handleDealerChange: (dealerId: string) => void | Promise<void>;
  dealerParams: {
    keep_net_pct: number;
    commissions: Record<string, number>;
    rates: Record<string, number>;
  } | null;
  activeBetType: BetType;
  setActiveBetType: Dispatch<SetStateAction<BetType>>;
  sentBetTypeSet: Set<BetType>;
  rangeResult: RangeSimResponse | null;
  selectedRowIdx: number | null;
  setSearchOpen: Dispatch<SetStateAction<boolean>>;
  setSmartCutOpen: Dispatch<SetStateAction<boolean>>;
  setRangeTableOpen: Dispatch<SetStateAction<boolean>>;
  setPendingRangeIdx: Dispatch<SetStateAction<number | null>>;
};

export function CutToolbar(props: CutToolbarProps) {
  const {
    roundsForPicker,
    selectedRoundId,
    setSelectedRoundId,
    isAdmin,
    cutIncludeArchived,
    setCutIncludeArchived,
    dealers,
    selectedDealerId,
    handleDealerChange,
    dealerParams,
    activeBetType,
    setActiveBetType,
    sentBetTypeSet,
    rangeResult,
    selectedRowIdx,
    setSearchOpen,
    setSmartCutOpen,
    setRangeTableOpen,
    setPendingRangeIdx,
  } = props;

  return (
    <>
{/* ── Top control bar (ความสูงสม่ำเสมอ h-9) ── */}
<div className="relative flex flex-wrap gap-x-3 gap-y-2 items-center px-5 py-2.5 border-b border-border bg-surface-100/80 min-w-0 max-w-full">
  {/* Round */}
  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 h-auto sm:h-9 shrink-0">
    <label className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider whitespace-nowrap leading-none">งวด</label>
    <select
      value={
        roundsForPicker.some((r) => r.id === selectedRoundId)
          ? selectedRoundId
          : (roundsForPicker[0]?.id ?? '')
      }
      onChange={(e) => setSelectedRoundId(e.target.value)}
      disabled={roundsForPicker.length === 0}
      className="h-9 min-w-[9.5rem] rounded-lg bg-surface-200 border border-border px-2.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] disabled:opacity-50"
    >
      {roundsForPicker.map((r) => (
        <option key={r.id} value={r.id}>{r.name}</option>
      ))}
    </select>
    {isAdmin && (
      <label className="flex items-center gap-2 text-[11px] text-theme-text-muted cursor-pointer select-none whitespace-nowrap">
        <input
          type="checkbox"
          checked={cutIncludeArchived}
          onChange={(e) => { setCutIncludeArchived(e.target.checked); }}
          className="rounded border-border bg-surface-100 accent"
        />
        แสดงงวดเก่า / ซ่อนแล้ว (ทั้งหมด)
      </label>
    )}
  </div>

  {/* Dealer */}
  <div className="flex items-center gap-2 h-9 shrink-0">
    <label className="text-[11px] font-semibold text-theme-text-muted uppercase tracking-wider whitespace-nowrap leading-none">เจ้ามือ</label>
    <select
      value={selectedDealerId || dealers.find(d => d.is_active)?.id || ''}
      onChange={(e) => handleDealerChange(e.target.value)}
      disabled={!selectedRoundId}
      className="h-9 min-w-[6.5rem] rounded-lg bg-surface-200 border border-border px-2.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] disabled:opacity-50">
      {dealers.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
    </select>
  </div>

  {/* Dealer rates — แถวเดียวสูงเท่าเมนู */}
  {selectedDealerId && dealerParams && (() => {
    const rate = dealerParams.rates[activeBetType];
    const pct  = dealerParams.commissions[activeBetType];
    return rate != null ? (
      <div className="flex h-9 items-center gap-2 px-3 rounded-lg bg-surface-50 border border-[var(--color-border)] shrink-0">
        <span className="text-[11px] font-medium text-risk-medium/85 whitespace-nowrap leading-none">อัตราจ่าย / %ลด</span>
        <span className="text-sm tracking-tight font-bold text-risk-medium">{rate}</span>
        <span className="text-theme-text-muted text-xs">/</span>
        <span className="text-sm tracking-tight text-theme-text-secondary">{pct ?? 0}%</span>
      </div>
    ) : null;
  })()}

  {/* Bet type tabs */}
  <div className="flex min-h-9 items-center gap-0.5 flex-wrap sm:flex-nowrap rounded-xl border border-border bg-surface-200/50 px-0.5 py-0.5 min-w-0 flex-1 sm:flex-initial">
    {BET_TYPE_ORDER.map(bt => (
      <button key={bt} type="button" onClick={() => setActiveBetType(bt)}
        className={`h-8 shrink-0 px-2.5 rounded-xl text-xs font-semibold transition-all duration-theme ${
          bt === activeBetType
            ? 'btn-primary-glow'
            : 'text-theme-text-secondary border border-transparent bg-transparent hover:text-theme-text-primary hover:bg-[var(--bg-glass-strong)] hover:shadow-[var(--shadow-hover)] hover:border-[var(--color-border-strong)]'
        }`}>
        <span className="inline-flex items-center gap-1.5">
          {BET_TYPE_SHORT[bt]}
          {sentBetTypeSet.has(bt) && (
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${bt === activeBetType ? 'bg-[color-mix(in_srgb,var(--text-inverse)_95%,transparent)] shadow-[var(--shadow-soft)]' : 'bg-profit'} shadow-[var(--shadow-soft)]`} title="มีประวัติส่งแล้ว" />
          )}
        </span>
      </button>
    ))}
  </div>

  <div className="flex flex-wrap items-center gap-2 ml-auto shrink-0">
    <button
      type="button"
      onClick={() => setSearchOpen(true)}
      disabled={!rangeResult?.rows.length}
      className="btn-toolbar-glow btn-fintech-search h-9 min-w-[9rem] px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
      🔍 ค้นหายอดตัด
    </button>
    <button
      type="button"
      onClick={() => setSmartCutOpen(true)}
      disabled={!rangeResult?.rows.length}
      className="btn-toolbar-glow btn-fintech-spark h-9 min-w-[7.5rem] px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
      ✨ ตัดอัจฉริยะ
    </button>
    <button
      type="button"
      onClick={() => { setRangeTableOpen(true); setPendingRangeIdx(selectedRowIdx); }}
      disabled={!rangeResult?.rows.length}
      className="btn-toolbar-glow btn-fintech-range h-9 min-w-[8.5rem] px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
      📊 กำหนดเป็นช่วง
    </button>
  </div>
</div>

    </>
  );
}
