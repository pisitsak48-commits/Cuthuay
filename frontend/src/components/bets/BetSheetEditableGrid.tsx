'use client';

import { flushSync } from 'react-dom';
import { memo, useState, type Dispatch, type MutableRefObject, type RefObject, type SetStateAction } from 'react';
import { Bet } from '@/types';
import {
  COL_TYPES,
  buildRowFromBets,
  groupBetTimestamps,
  keyerChipClasses,
  aggregateKeyer,
  betSheetGroupKey,
  type BetSheetGroup,
} from '@/lib/bets/betSheetGroups';
import type { BetKeyInputActivity } from '@/components/bets/BetKeyInputPanel';
import { writeBetSheetSort, type BetSheetSortOrder } from '@/lib/betSheetSort';
import { writeBetsPageZoom } from '@/lib/bets/voiceAuditPrefs';
import { groupTouchesWinningDraw } from '@/lib/drawWinning';
import { cn } from '@/lib/utils';
import type { PrintItem } from '@/lib/bets/betSheetGroups';

function matchesSearch(number: string, q: string): boolean {
  const trimQ = q.trim();
  if (!trimQ) return false;
  return number === trimQ;
}

export type BetSheetEditableGridProps = {
  rowFs: number;
  loading: boolean;
  sheetGrouped: BetSheetGroup[];
  betSheetSort: BetSheetSortOrder;
  setBetSheetSort: Dispatch<SetStateAction<BetSheetSortOrder>>;
  selectedGroups: Set<string>;
  setSelectedGroups: Dispatch<SetStateAction<Set<string>>>;
  lastClickedIdxRef: MutableRefObject<number>;
  searchNeedle: string;
  searchMatchIndexes: number[];
  activeSearchMatchPos: number;
  focusedIdx: number;
  setFocusedIdx: Dispatch<SetStateAction<number>>;
  recentChangedKey: string | null;
  lineImportHighlightBatchId: string | null;
  setLineImportHighlightBatchId: Dispatch<SetStateAction<string | null>>;
  selectedCustomerId: string;
  sheet: number;
  roundDrawWinKeys: Set<string>;
  customerBets: Bet[];
  tableScrollRef: RefObject<HTMLDivElement>;
  deleteSavedGroup: (bets: Bet[]) => void;
  isAdmin: boolean;
  editInlineKey: string | null;
  isSaving: boolean;
  saveInlineEdit: () => void | Promise<void>;
  onCancelEdit: () => void;
  inputActivityRef: MutableRefObject<BetKeyInputActivity>;
  onInsertBefore: (insertKey: string) => void;
  handleEditAction: () => void;
  deleteSelectedGroups: () => void;
  setMoveTarget: Dispatch<SetStateAction<number>>;
  setMoveTargetCustomerId: Dispatch<SetStateAction<string>>;
  setMoveModal: Dispatch<SetStateAction<boolean>>;
  handlePrint: () => void;
  printItems: PrintItem[];
  setCsvModalOpen: Dispatch<SetStateAction<boolean>>;
  betsPageZoomPercent: number;
  setBetsPageZoomPercent: Dispatch<SetStateAction<number>>;
  canMutate?: boolean;
};

function BetSheetEditableGridInner(props: BetSheetEditableGridProps) {
  const groupKey = betSheetGroupKey;
  const [insertReady, setInsertReady] = useState(false);

  const refreshInsertReady = () => {
    const a = props.inputActivityRef.current;
    setInsertReady(a.hasNum && a.hasAmt);
  };
  const {
    rowFs,
    loading,
    sheetGrouped,
    betSheetSort,
    setBetSheetSort,
    selectedGroups,
    setSelectedGroups,
    lastClickedIdxRef,
    searchNeedle,
    searchMatchIndexes,
    activeSearchMatchPos,
    focusedIdx,
    setFocusedIdx,
    recentChangedKey,
    lineImportHighlightBatchId,
    setLineImportHighlightBatchId,
    selectedCustomerId,
    sheet,
    roundDrawWinKeys,
    customerBets,
    tableScrollRef,
    deleteSavedGroup,
    isAdmin,
    editInlineKey,
    isSaving,
    saveInlineEdit,
    onCancelEdit,
    inputActivityRef,
    onInsertBefore,
    handleEditAction,
    deleteSelectedGroups,
    setMoveTarget,
    setMoveTargetCustomerId,
    setMoveModal,
    handlePrint,
    printItems,
    setCsvModalOpen,
    betsPageZoomPercent,
    setBetsPageZoomPercent,
    canMutate = true,
  } = props;

  return (
    <>
{/* Column headers — โทนแยกจากแถบคีย์ */}
<div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)]">
  <table className="w-full table-fixed" style={{ fontSize: rowFs }}>
    <thead>
      <tr>
        <th className="text-center py-1.5 px-1 text-theme-text-muted w-7">
          <input type="checkbox" className="accent"
            checked={sheetGrouped.length > 0 && selectedGroups.size === sheetGrouped.length}
            onChange={e => {
              if (e.target.checked) setSelectedGroups(new Set(sheetGrouped.map(g => groupKey(g))));
              else setSelectedGroups(new Set());
            }} />
        </th>
        <th className="text-left py-1.5 px-3 text-theme-text-muted w-7">#</th>
        <th className="text-left py-1.5 px-3 text-theme-text-primary font-semibold w-[8rem]">เลข</th>
        {COL_TYPES.map(c => (
          <th key={c.key} className="text-right py-1.5 px-2 text-theme-text-muted font-normal">{c.label}</th>
        ))}
        <th
          scope="col"
          tabIndex={0}
          title={
            betSheetSort === 'newestFirst'
              ? 'คลิก: เรียงให้รายการล่าสุดอยู่ล่าง (ตามเวลา). เมื่อแก้โพยแล้ว คอลัมน์นี้จะโชว์เวลาแก้ไขเป็นหลัก และเวลาคีย์เดิมด้านล่าง'
              : 'คลิก: เรียงให้รายการล่าสุดอยู่บน. เมื่อแก้โพยแล้ว คอลัมน์นี้จะโชว์เวลาแก้ไขเป็นหลัก และเวลาคีย์เดิมด้านล่าง'
          }
          onClick={() => {
            setBetSheetSort(prev => {
              const next = prev === 'newestFirst' ? 'oldestFirst' : 'newestFirst';
              writeBetSheetSort(next);
              return next;
            });
          }}
          onKeyDown={e => {
            if (e.key !== 'Enter' && e.key !== ' ') return;
            e.preventDefault();
            setBetSheetSort(prev => {
              const next = prev === 'newestFirst' ? 'oldestFirst' : 'newestFirst';
              writeBetSheetSort(next);
              return next;
            });
          }}
          className="text-left py-1.5 px-2 text-theme-text-muted w-[4.75rem] whitespace-normal cursor-pointer select-none hover:text-theme-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded-sm transition-colors">
          <span className="inline-flex flex-col gap-0.5 leading-tight">
            <span>เวลา</span>
            <span className="text-[0.72em] font-semibold text-theme-text-secondary tracking-tight">
              {betSheetSort === 'newestFirst' ? 'ล่าสุดบน' : 'ล่าสุดล่าง'}
            </span>
          </span>
        </th>
        <th className="text-left py-1.5 px-2 text-theme-text-muted w-[5.25rem] max-w-[6rem]">ผู้คีย์</th>
        <th className="text-left py-1.5 px-2 text-theme-text-muted w-20 min-w-0">ลูกค้า</th>
        <th className="w-6"></th>
      </tr>
    </thead>
  </table>
</div>

{/* Rows */}
<div ref={tableScrollRef} data-bet-sheet-table className="flex-1 overflow-y-auto">
  <table className="w-full table-fixed" style={{ fontSize: rowFs }}>
    <tbody>
      {loading ? (
        <tr><td colSpan={COL_TYPES.length + 7} className="py-6 text-center text-theme-text-muted">กำลังโหลด...</td></tr>
      ) : sheetGrouped.map((group, idx) => {
        const key = groupKey(group);
        /** ลำดับตามเวลาจริง: เก่าสุด=1 ใหม่สุด=N — สลับเมื่อสลับ ล่าสุดบน/ล่าง */
        const rowDisplayNum =
          sheetGrouped.length === 0 ? 0 : betSheetSort === 'oldestFirst' ? idx + 1 : sheetGrouped.length - idx;
        const row = buildRowFromBets(group.bets);
        const firstBet = group.bets[0];
        const tsDisp = groupBetTimestamps(group);
        const timeStr = tsDisp.timeShort;
        const editBadge = tsDisp.editBadge;
        const keyer = aggregateKeyer(group);
        const isSelected = selectedGroups.has(key);
        const isSearchMatch = matchesSearch(group.number, searchNeedle);
        const isActiveSearchMatch = activeSearchMatchPos >= 0 && searchMatchIndexes[activeSearchMatchPos] === idx;
        const isRecentChanged = recentChangedKey === key;
        const isLineImportHighlight =
          lineImportHighlightBatchId != null &&
          group.bets.some((b) => {
            if ((b.sheet_no ?? 1) !== sheet) return false;
            if (selectedCustomerId && b.customer_id !== selectedCustomerId) return false;
            return (
              b.import_batch_id != null &&
              String(b.import_batch_id) === lineImportHighlightBatchId
            );
          });
        const isDrawWinner =
          roundDrawWinKeys.size > 0 && groupTouchesWinningDraw(group.bets, roundDrawWinKeys);
        return (
          <tr key={key}
            data-row-idx={idx}
            className={`border-b border-border/30 cursor-pointer relative transition-[background-color,box-shadow] duration-150 ${isActiveSearchMatch ? 'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--primary-400)_28%,var(--primary-100))_0%,color-mix(in_srgb,var(--primary-300)_12%,var(--primary-50))_100%)] shadow-[inset_6px_0_0_var(--chart-primary)] ring-2 ring-inset ring-[color-mix(in_srgb,var(--chart-primary)_50%,transparent)] z-[2]' : isLineImportHighlight ? 'bg-accent/12 shadow-[inset_5px_0_0_var(--color-accent)] ring-1 ring-inset ring-accent/35' : isRecentChanged ? 'bg-surface-50 shadow-[inset_4px_0_0_var(--color-accent-dark)] ring-1 ring-inset ring-[var(--color-border-strong)]' : focusedIdx === idx ? 'bg-[linear-gradient(90deg,color-mix(in_srgb,var(--primary-500)_26%,var(--primary-100))_0%,color-mix(in_srgb,var(--primary-300)_22%,var(--primary-50))_50%,color-mix(in_srgb,var(--primary-200)_15%,var(--color-surface))_100%)] shadow-[inset_6px_0_0_var(--chart-primary)] ring-2 ring-inset ring-[color-mix(in_srgb,var(--chart-primary)_55%,transparent)] z-[1]' : isSelected ? 'bg-[color-mix(in_srgb,var(--primary-200)_28%,var(--color-surface))] shadow-[inset_4px_0_0_var(--primary-500)]' : isDrawWinner ? 'bg-[color-mix(in_srgb,var(--color-badge-warning-bg)_48%,var(--color-surface))] shadow-[inset_5px_0_0_var(--color-badge-warning-border)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--color-badge-warning-border)_32%,transparent)] z-[1] hover:bg-[color-mix(in_srgb,var(--color-badge-warning-bg)_56%,var(--color-surface))]' : isSearchMatch && searchNeedle.trim() ? 'bg-[color-mix(in_srgb,var(--primary-400)_14%,var(--primary-50))] shadow-[inset_4px_0_0_color-mix(in_srgb,var(--chart-primary)_70%,var(--primary-300))] ring-1 ring-inset ring-[color-mix(in_srgb,var(--chart-primary)_28%,transparent)] hover:bg-[color-mix(in_srgb,var(--primary-400)_20%,var(--primary-100))]' : idx % 2 === 0 ? 'bg-surface-50/80 hover:bg-surface-100/80' : 'hover:bg-surface-100/60'}`}
            onClick={() => setFocusedIdx(idx)}>
            <td className="py-1 px-1 w-7 text-center">
              <input type="checkbox" className="accent"
                checked={isSelected}
                onClick={e => { e.stopPropagation(); }}
                onChange={e => {
                  const native = e.nativeEvent as MouseEvent | KeyboardEvent;
                  const shiftRange =
                    native.shiftKey && lastClickedIdxRef.current >= 0;
                  if (shiftRange) {
                    const anchor = lastClickedIdxRef.current;
                    const from = Math.min(anchor, idx);
                    const to = Math.max(anchor, idx);
                    const next = new Set(selectedGroups);
                    for (let i = from; i <= to; i++) next.add(groupKey(sheetGrouped[i]));
                    flushSync(() => {
                      setSelectedGroups(next);
                    });
                    lastClickedIdxRef.current = idx;
                    return;
                  }
                  const next = new Set(selectedGroups);
                  if (e.target.checked) next.add(key); else next.delete(key);
                  setSelectedGroups(next);
                  lastClickedIdxRef.current = idx;
                }} />
            </td>
            <td className="py-1 px-3 text-theme-text-muted w-10 text-right pr-4">
              <span className="inline-flex flex-col items-end gap-0.5">
                <span className={(isActiveSearchMatch || focusedIdx === idx) ? 'font-bold text-[var(--chart-primary)] tabular-nums' : ''}>{rowDisplayNum}</span>
                {isActiveSearchMatch && searchNeedle.trim() && (
                  <span className="text-[0.72em] font-bold text-[var(--chart-primary)] leading-none whitespace-nowrap">ค้นหา</span>
                )}
                {focusedIdx === idx && !isActiveSearchMatch && (
                  <span className="text-[0.72em] font-bold text-[var(--chart-primary-dark)] leading-none whitespace-nowrap">ตรวจ</span>
                )}
                {isLineImportHighlight && (
                  <span className="text-[0.72em] font-bold text-profit leading-none whitespace-nowrap">ไลน์</span>
                )}
                {isDrawWinner && (
                  <span className="text-[0.72em] font-bold text-[var(--color-badge-warning-text)] leading-none whitespace-nowrap">ถูก</span>
                )}
                {isRecentChanged && (
                  <span className="text-[0.72em] font-bold uppercase tracking-tight text-theme-text-secondary leading-none whitespace-nowrap">ล่าสุด</span>
                )}
              </span>
            </td>
            <td className="py-1 pl-3 pr-2 min-w-0 align-middle">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span
                className={cn(
                  'inline-flex min-w-[2.75rem] justify-center rounded-md px-1.5 py-0.5 tracking-tight text-[0.95em] font-extrabold tracking-wider shadow-[var(--shadow-soft)] border',
                  isActiveSearchMatch && searchNeedle.trim()
                    ? 'border-[var(--chart-primary)] bg-[var(--color-surface)] text-[var(--chart-primary-dark)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--chart-primary)_45%,transparent),var(--shadow-soft)]'
                    : focusedIdx === idx && !isActiveSearchMatch
                      ? 'border-[var(--chart-primary)] bg-[var(--color-surface)] text-[var(--chart-primary-dark)] shadow-[0_0_0_3px_color-mix(in_srgb,var(--chart-primary)_55%,transparent),var(--shadow-soft)]'
                      : isSearchMatch && searchNeedle.trim()
                        ? 'border-[color-mix(in_srgb,var(--chart-primary)_55%,var(--color-border))] bg-[color-mix(in_srgb,var(--primary-100)_65%,var(--color-input-bg))] text-theme-text-primary'
                        : isDrawWinner
                          ? 'border-[var(--color-badge-warning-border)] bg-[color-mix(in_srgb,var(--color-badge-warning-bg)_42%,var(--color-input-bg))] text-[var(--color-badge-warning-text)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-badge-warning-border)_45%,transparent)]'
                          : 'border-[var(--color-border)] bg-[var(--color-input-bg)] text-theme-text-primary',
                )}
              >
                {group.number}
              </span>
              {editBadge && (
                <span
                  title={editBadge.tip}
                  className="inline-flex shrink-0 cursor-help select-none text-[0.92em] font-bold leading-none text-risk-medium"
                  aria-label={editBadge.tip}
                >
                  ✎
                </span>
              )}
              </div>
            </td>
            {COL_TYPES.map(c => {
              const amt = row[c.key];
              const hiPrices =
                focusedIdx === idx ||
                (isActiveSearchMatch && searchNeedle.trim().length > 0);
              return (
              <td key={c.key} className={`py-1 px-2 text-right tracking-tight align-middle ${hiPrices ? '' : 'text-theme-text-secondary'}`}>
                {amt > 0 ? (
                  <span className={hiPrices
                    ? 'inline-block min-w-[2.75rem] rounded-md px-1.5 py-0.5 tabular-nums font-semibold text-[var(--chart-primary-dark)] bg-[color-mix(in_srgb,var(--primary-100)_88%,white)] ring-1 ring-inset ring-[color-mix(in_srgb,var(--chart-primary)_42%,transparent)] shadow-[var(--shadow-soft)]'
                    : 'text-theme-text-primary'}>
                    {amt.toLocaleString()}
                  </span>
                ) : (
                  <span className={hiPrices
                    ? 'text-theme-text-muted/50 select-none inline-flex min-w-[2.75rem] items-center justify-center rounded-md px-1 py-0.5 ring-1 ring-inset ring-[color-mix(in_srgb,var(--chart-primary)_22%,transparent)] bg-[color-mix(in_srgb,var(--primary-50)_70%,transparent)]'
                    : 'text-theme-text-muted/20 select-none inline-block min-w-[0.6em] text-center'}>
                    ·
                  </span>
                )}
              </td>
              );
            })}
            <td
              className={`py-1 px-2 tracking-tight text-[0.92em] w-[4.75rem] align-top leading-snug ${
                editBadge
                  ? 'text-theme-text-primary whitespace-normal'
                  : 'text-theme-text-muted whitespace-nowrap'
              }`}
            >
              {editBadge ? (
                <span className="inline-flex flex-col gap-0.5">
                  <span
                    className="font-semibold tabular-nums text-risk-medium"
                    title={editBadge.tip}
                  >
                    ✎ {editBadge.short}
                  </span>
                  <span
                    className="text-[0.85em] font-normal text-theme-text-muted tabular-nums"
                    title={tsDisp.keyedTooltip}
                  >
                    คีย์ {tsDisp.keyedSubtitle}
                  </span>
                </span>
              ) : (
                <span title={tsDisp.keyedTooltip}>{timeStr}</span>
              )}
            </td>
            <td className="py-1 px-2 w-[5.25rem] max-w-[6.5rem] align-middle">
              <span
                className={`inline-flex max-w-full truncate rounded-md px-1.5 py-0.5 text-[0.85em] font-semibold leading-tight ${keyerChipClasses(keyer.colorKey)}`}
                title={keyer.title || undefined}
              >
                {keyer.text}
              </span>
            </td>
            <td className="py-1 px-2 text-theme-text-secondary text-[0.92em] w-20 min-w-0 truncate" title={firstBet.customer_ref ?? undefined}>
              {firstBet.customer_ref ?? '—'}
            </td>
            <td className="py-1 px-1 w-6" onClick={e => e.stopPropagation()}>
              {canMutate && (
                <button type="button" onClick={() => deleteSavedGroup(group.bets)} className="text-theme-text-muted hover:text-loss">×</button>
              )}
            </td>
          </tr>
        );
      })}
    </tbody>
  </table>
</div>

{/* Bottom status bar */}
<div className="shrink-0 bg-surface-default border-t border-border px-3 py-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-theme-text-muted">
  <span>แผ่น {sheet}</span>
  <span className="text-theme-text-muted">|</span>
  <span className="tracking-tight text-profit">{customerBets.filter(b => (b.sheet_no ?? 1) === sheet).reduce((s, b) => s + Number(b.amount), 0).toLocaleString()}</span>
  {roundDrawWinKeys.size > 0 && (
    <>
      <span className="text-theme-text-muted hidden sm:inline">|</span>
      <span className="text-[11px] font-semibold text-[var(--color-badge-warning-text)]">ผลออกแล้ว · แถวถูกรางวัลมีแถบทอง</span>
    </>
  )}
  {lineImportHighlightBatchId && (
    <>
      <span className="text-theme-text-muted hidden sm:inline">|</span>
      <button
        type="button"
        onClick={() => setLineImportHighlightBatchId(null)}
        className="text-[11px] font-semibold text-accent hover:underline"
      >
        เคลียร์ไฮไลต์นำเข้าไลน์
      </button>
      <span className="text-[11px] text-theme-text-muted">(หายเองใน ~3 นาที · นำเข้ารอบใหม่จะเปลี่ยนชุดไฮไลต์)</span>
    </>
  )}
</div>

{/* Toolbar — ใต้ตาราง */}
<div className={`shrink-0 border-t px-2 py-1.5 flex items-center gap-1.5 transition-colors duration-200 ${editInlineKey ? 'bg-risk-medium/15 border-risk-medium/50' : 'bg-surface-100 border-border'}`}>
  {editInlineKey && canMutate ? (
    <>
      <span className="text-xs text-risk-medium font-semibold mr-1">✏️ โหมดแก้ไข</span>
      <button
        onClick={() => { void saveInlineEdit(); }}
        disabled={isSaving}
        className="btn-toolbar-glow btn-toolbar-profit disabled:shadow-none">
        <span>✓</span><span>บันทึก</span>
      </button>
      <button
        onClick={onCancelEdit}
        className="btn-toolbar-glow btn-toolbar-muted">
        <span>✕</span><span>ยกเลิก</span>
      </button>
    </>
  ) : canMutate ? (
    <>
      <button
        disabled={selectedGroups.size !== 1 || !insertReady}
        onMouseEnter={refreshInsertReady}
        onFocus={refreshInsertReady}
        onClick={() => {
          refreshInsertReady();
          const [insertKey] = [...selectedGroups];
          onInsertBefore(insertKey);
        }}
        className="btn-toolbar-glow btn-toolbar-profit">
        <span>↑</span><span>แทรก</span>
      </button>
      <button
        disabled={selectedGroups.size !== 1}
        onClick={handleEditAction}
        className="btn-toolbar-glow btn-fintech-search !h-9 px-3 text-xs gap-1"
      >
        <span>✏</span><span>แก้ไข</span>
      </button>
      <button
        disabled={selectedGroups.size === 0}
        onClick={deleteSelectedGroups}
        className="btn-toolbar-glow btn-toolbar-danger">
        <span>×</span><span>ลบ</span>
      </button>
      <button
        disabled={selectedGroups.size === 0}
        onClick={() => { setSelectedGroups(new Set()); lastClickedIdxRef.current = -1; }}
        className="btn-toolbar-glow btn-toolbar-muted disabled:opacity-40">
        <span>✕</span><span>ยกเลิกเลือก</span>
      </button>
      <button
        disabled={selectedGroups.size === 0}
        onClick={() => { setMoveTarget(1); setMoveTargetCustomerId('__same__'); setMoveModal(true); }}
        className="btn-toolbar-glow btn-toolbar-amber">
        <span>→</span><span>ย้ายแผ่น</span>
      </button>
    </>
  ) : (
    <span className="text-xs text-theme-text-muted">โหมดดูอย่างเดียว</span>
  )}
  <span className="ml-auto text-theme-text-muted text-xs">{sheetGrouped.length} รายการ {selectedGroups.size > 0 && `(เลือก ${selectedGroups.size})`}</span>
  <button
    onClick={handlePrint}
    disabled={printItems.length === 0}
    className="btn-toolbar-glow btn-toolbar-amber">
    <span>🖨</span><span>พิมพ์โพย</span>
  </button>
  {isAdmin && (
    <button
      onClick={() => setCsvModalOpen(true)}
      disabled={customerBets.length === 0}
      className="btn-toolbar-glow btn-toolbar-profit">
      <span>⇩</span><span>Export CSV</span>
    </button>
  )}
  {isAdmin && <div className="w-px h-5 bg-[var(--color-border)] mx-0.5 shrink-0" />}
  <span className="text-xs text-theme-text-muted shrink-0">ขนาด</span>
  <span className="text-[11px] tabular-nums font-semibold text-theme-text-secondary shrink-0 min-w-[2.75rem] text-center">{betsPageZoomPercent}%</span>
  <button
    type="button"
    title="ย่อทั้งหน้ารับแทง (แผงซ้าย + ขวา + แถบบน)"
    className="btn-toolbar-glow btn-toolbar-muted !h-9 !min-w-[2rem] !px-2 !text-[11px] rounded-xl font-bold"
    onClick={() => {
      setBetsPageZoomPercent((z) => {
        const next = Math.max(75, z - 5);
        writeBetsPageZoom(next);
        return next;
      });
    }}
  >
    A−
  </button>
  <button
    type="button"
    title="ขยายทั้งหน้ารับแทง (แผงซ้าย + ขวา + แถบบน)"
    className="btn-toolbar-glow btn-fintech-search !h-9 !min-w-[2rem] !px-2 !text-[11px] rounded-xl font-bold"
    onClick={() => {
      setBetsPageZoomPercent((z) => {
        const next = Math.min(155, z + 5);
        writeBetsPageZoom(next);
        return next;
      });
    }}
  >
    A+
  </button>
  <button
    type="button"
    onClick={() => {
      if (selectedGroups.size === sheetGrouped.length) setSelectedGroups(new Set());
      else setSelectedGroups(new Set(sheetGrouped.map(g => groupKey(g))));
    }}
    className="btn-toolbar-glow btn-fintech-spark !h-9 !px-2.5 !text-[11px] rounded-xl font-semibold max-sm:max-w-[9rem] truncate"
  >
    {selectedGroups.size === sheetGrouped.length && sheetGrouped.length > 0 ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
  </button>
</div>

    </>
  );
}

export const BetSheetEditableGrid = memo(BetSheetEditableGridInner);
