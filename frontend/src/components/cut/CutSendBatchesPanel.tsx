'use client';

import type { Dispatch, MutableRefObject, SetStateAction } from 'react';
import { BetType, SendBatch } from '@/types';
import { cn, formatBaht } from '@/lib/utils';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { writePanelLock, STORAGE_CUT_RIGHT_PANEL_LOCK } from '@/lib/panelResize';
import type { PendingCutSlice } from '@/components/cut/cutTypes';

const BET_TYPE_SHORT: Record<BetType, string> = {
  '3digit_top': '3 ตัวบน', '3digit_tote': '3 ตัวโต็ด', '3digit_back': '3 ตัวล่าง',
  '2digit_top': '2 ตัวบน', '2digit_bottom': '2 ตัวล่าง',
  '1digit_top': 'วิ่งบน', '1digit_bottom': 'วิ่งล่าง',
};

export type PendingQueueRow = {
  key: string;
  typeLabel: string;
  number: string;
  amount: number;
};

export type CutSendBatchesPanelProps = {
  sideBySideLayout: boolean;
  rightPanelPx: number;
  sendBatches: SendBatch[];
  selectedBatchIds: Set<string>;
  setSelectedBatchIds: Dispatch<SetStateAction<Set<string>>>;
  totalSentAllBatches: number;
  deletingBatchId: string | null;
  handleDeleteAllBatches: () => void;
  fetchSendBatches: () => void | Promise<void>;
  rightPanelLocked: boolean;
  setRightPanelLocked: Dispatch<SetStateAction<boolean>>;
  setViewBatch: Dispatch<SetStateAction<SendBatch | null>>;
  selectedRoundId: string;
  selectedDealerId: string;
  savingBatch: boolean;
  stagedCuts: PendingCutSlice[];
  cutItems: { number: string; amount: number }[];
  handleSaveBatch: (dealerId: string) => void | Promise<void>;
  handleDeleteSendSelection: () => void | Promise<void>;
  handlePrintSentBatches: () => void;
  linePngBusy: boolean;
  handleDownloadSentBatchesPng: () => void | Promise<void>;
  pendingQueueRows: PendingQueueRow[];
  handleStageCurrentCuts: () => void;
  setStagedCuts: Dispatch<SetStateAction<PendingCutSlice[]>>;
  setManualThreshold: Dispatch<SetStateAction<number | null>>;
  setSelectedRowIdx: Dispatch<SetStateAction<number | null>>;
  lastManualByTypeRef: MutableRefObject<Partial<Record<BetType, number>>>;
};

export function CutSendBatchesPanel(props: CutSendBatchesPanelProps) {
  const {
    sideBySideLayout,
    rightPanelPx,
    sendBatches,
    selectedBatchIds,
    setSelectedBatchIds,
    totalSentAllBatches,
    deletingBatchId,
    handleDeleteAllBatches,
    fetchSendBatches,
    rightPanelLocked,
    setRightPanelLocked,
    setViewBatch,
    selectedRoundId,
    selectedDealerId,
    savingBatch,
    stagedCuts,
    cutItems,
    handleSaveBatch,
    handleDeleteSendSelection,
    handlePrintSentBatches,
    linePngBusy,
    handleDownloadSentBatchesPng,
    pendingQueueRows,
    handleStageCurrentCuts,
    setStagedCuts,
    setManualThreshold,
    setSelectedRowIdx,
    lastManualByTypeRef,
  } = props;

  const confirm = useConfirm();

  return (
<div
  className={cn(
    'flex flex-col min-h-0 min-w-0 overflow-hidden overflow-x-hidden bg-surface-100/50 border-border',
    sideBySideLayout
      ? 'border-t-0 border-l w-auto max-w-[min(100%,580px)] shrink-0'
      : 'border-t w-full max-w-full shrink-0',
  )}
  style={sideBySideLayout ? { width: rightPanelPx, minWidth: 260, maxWidth: 580 } : undefined}
>

  <div className="flex flex-col min-h-0 flex-1 gap-3 p-3 overflow-hidden">
    {/* ── รายการส่ง ── */}
    <div className="flex flex-col min-h-0 flex-[1.2] rounded-2xl border-0 bg-[var(--color-card-bg-solid)] overflow-hidden shadow-sm">
      <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-surface-200/20">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="text-sm font-bold text-theme-text-primary tracking-tight">รายการส่ง</span>
          <span className="text-[11px] text-theme-text-muted">
            ({sendBatches.length} ชุด)
            {selectedBatchIds.size > 0 && (
              <span className="text-accent ml-1">· เลือก {selectedBatchIds.size}</span>
            )}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px]">
          {sendBatches.length > 0 && (
            <span className="text-theme-text-muted ">
              รวม <span className=" tracking-tight font-semibold text-[var(--color-accent-hover)]">{formatBaht(totalSentAllBatches)}</span>
            </span>
          )}
          {sendBatches.length > 0 && (
            <button
              type="button"
              onClick={handleDeleteAllBatches}
              disabled={deletingBatchId === 'all'}
              className="text-risk-high/90 hover:text-loss disabled:opacity-40 transition-colors">
              {deletingBatchId === 'all' ? 'กำลังลบ…' : 'ลบทั้งหมด'}
            </button>
          )}
          <button type="button" onClick={fetchSendBatches} className="text-theme-text-muted hover:text-theme-text-secondary transition-colors" title="รีเฟรช">
            ↻
          </button>
          <button
            type="button"
            onClick={() => {
              setRightPanelLocked((v) => {
                const next = !v;
                writePanelLock(STORAGE_CUT_RIGHT_PANEL_LOCK, next);
                return next;
              });
            }}
            className={`text-[11px] px-1 rounded transition-colors ${
              rightPanelLocked
                ? 'text-theme-text-secondary hover:text-theme-text-primary'
                : 'text-theme-text-muted hover:text-theme-text-secondary'
            }`}
            title={
              rightPanelLocked
                ? 'ปลดล็อก — ลากขอบซ้ายของแผงนี้เพื่อปรับความกว้าง'
                : 'ล็อกความกว้าง — กันปรับสะดุด (ค่าที่ลากไว้ยังจำเมื่อเปิดใหม่)'
            }
            aria-pressed={rightPanelLocked}
          >
            {rightPanelLocked ? '🔒' : '🔓'}
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-[120px] overflow-auto bg-surface-200/5">
        {sendBatches.length > 0 ? (
          <table className="w-full text-xs sm:text-sm">
            <thead className="sticky top-0 z-[1] border-b border-border/70 bg-surface-300/35 ">
              <tr>
                <th className="py-2 px-2 w-7 text-center">
                  <input
                    type="checkbox"
                    className="accent-accent"
                    checked={sendBatches.length > 0 && selectedBatchIds.size === sendBatches.length}
                    onChange={(e) =>
                      setSelectedBatchIds(e.target.checked ? new Set(sendBatches.map((b) => b.id)) : new Set())
                    }
                  />
                </th>
                <th className="text-left py-2 px-2 text-theme-text-muted font-semibold w-8">ชุด</th>
                <th className="text-left py-2 px-2 text-theme-text-muted font-semibold">ประเภท</th>
                <th className="text-left py-2 px-2 text-theme-text-muted font-semibold">ส่ง</th>
                <th className="text-right py-2 px-2 text-theme-text-muted font-semibold whitespace-nowrap">จำนวนเงิน</th>
                <th className="text-right py-2 px-2 text-theme-text-muted font-semibold whitespace-nowrap">วันที่</th>
                <th className="text-center py-2 px-1 w-10 text-theme-text-muted font-semibold" />
              </tr>
            </thead>
            <tbody>
              {sendBatches.map((b, i) => (
                <tr
                  key={b.id}
                  onClick={() =>
                    setSelectedBatchIds((prev) => {
                      const next = new Set(prev);
                      next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                      return next;
                    })
                  }
                  className={`border-b border-border/25 cursor-pointer transition-colors ${
                    selectedBatchIds.has(b.id) ? 'bg-accent/20' : i % 2 === 0 ? 'bg-transparent' : 'bg-surface-200/15'
                  }`}>
                  <td className="py-2 px-2 text-center" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="accent-accent"
                      checked={selectedBatchIds.has(b.id)}
                      onChange={() =>
                        setSelectedBatchIds((prev) => {
                          const next = new Set(prev);
                          next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="py-2 px-2 tabular-nums text-theme-text-secondary text-center">{i + 1}</td>
                  <td className="py-2 px-2 text-theme-text-primary font-medium leading-tight whitespace-nowrap">
                    {BET_TYPE_SHORT[b.bet_type as BetType] ?? b.bet_type}
                  </td>
                  <td className="py-2 px-2 text-theme-text-primary leading-tight truncate max-w-[5.5rem]" title={b.dealer_name ?? undefined}>
                    {b.dealer_name ?? <span className="text-theme-text-muted italic">—</span>}
                  </td>
                  <td className="py-2 px-2 tabular-nums text-sm text-[var(--color-accent-hover)] text-right font-semibold">
                    {formatBaht(b.total)}
                  </td>
                  <td className="py-2 px-2 tabular-nums text-theme-text-muted text-right whitespace-nowrap text-xs">
                    {new Date(b.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' })}
                  </td>
                  <td className="py-2 px-1 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setViewBatch(b);
                      }}
                      className="text-[11px] font-medium text-theme-text-muted hover:text-accent transition-colors px-1"
                      title="ดูเลขที่ส่งแล้ว">
                      ดู
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="h-full min-h-[100px] flex items-center justify-center bg-surface-200/10 px-3">
            <p className="text-[11px] text-theme-text-muted italic text-center">ยังไม่มีรายการส่ง</p>
          </div>
        )}
      </div>

      <div className="shrink-0 flex flex-nowrap items-center gap-2 p-2.5 border-t border-border/60 bg-surface-200/10 overflow-x-auto">
        <button
          type="button"
          onClick={() => void handleSaveBatch(selectedDealerId)}
          disabled={!selectedRoundId || savingBatch || (stagedCuts.length === 0 && cutItems.length === 0)}
          className="btn-toolbar-glow btn-toolbar-profit !h-9 shrink-0 px-3 text-[11px] font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5">
          {savingBatch ? (
            <svg className="animate-spin h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : null}
          ทำการส่ง
        </button>
        <button
          type="button"
          className="btn-toolbar-glow btn-toolbar-danger !h-9 shrink-0 px-3 text-[11px] font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={selectedBatchIds.size === 0 || deletingBatchId === 'all'}
          onClick={() => void handleDeleteSendSelection()}>
          ลบรายการส่ง
        </button>
        <button
          type="button"
          className="btn-toolbar-glow btn-fintech-search !h-9 shrink-0 px-3 text-[11px] font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!sendBatches.length}
          onClick={handlePrintSentBatches}>
          พิมพ์รายการส่ง
        </button>
        <button
          type="button"
          className="btn-toolbar-glow !h-9 shrink-0 px-3 text-[11px] font-semibold whitespace-nowrap border-2 border-[var(--chart-primary)] disabled:opacity-40 disabled:cursor-not-allowed"
          style={{ background: 'var(--chart-primary-soft)', color: 'var(--chart-neutral-dark)' }}
          disabled={!sendBatches.length || linePngBusy}
          title="ดาวน์โหลด PNG แยกประเภทเลข (รวม Zip ถ้ามีหลายชุด)"
          onClick={() => void handleDownloadSentBatchesPng()}>
          {linePngBusy ? 'กำลังสร้าง…' : 'PNG ไลน์ (Zip)'}
        </button>
      </div>
    </div>

    {/* ── รายการรอส่ง ── */}
    <div className="flex flex-col min-h-0 flex-[0.9] rounded-2xl border-0 bg-[var(--color-card-bg-solid)] overflow-hidden shadow-sm">
      <div className="shrink-0 px-3 py-2 border-b border-border/60 bg-surface-200/20">
        <span className="text-sm font-bold text-theme-text-primary tracking-tight">รายการรอส่ง</span>
        {pendingQueueRows.length > 0 && (
          <span className="text-[11px] text-theme-text-muted ml-2">({pendingQueueRows.length} แถว)</span>
        )}
      </div>

      <div className="flex-1 min-h-[100px] overflow-auto bg-surface-200/5">
        {pendingQueueRows.length > 0 ? (
          <table className="w-full text-xs sm:text-sm ">
            <thead className="sticky top-0 z-[1] border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] shadow-[var(--shadow-soft)]">
              <tr>
                <th className="text-left py-2 px-2 text-theme-text-secondary font-semibold w-8">#</th>
                <th className="text-left py-2 px-2 text-theme-text-secondary font-semibold">ประเภท</th>
                <th className="text-center py-2 px-2 text-theme-text-primary font-semibold">เลข</th>
                <th className="text-right py-2 px-2 text-theme-text-secondary font-semibold">ราคา</th>
              </tr>
            </thead>
            <tbody>
              {pendingQueueRows.map((row, idx) => (
                <tr key={row.key} className={`border-b border-[var(--color-border)] ${idx % 2 === 0 ? 'bg-surface-50' : 'bg-[var(--color-surface)]'}`}>
                  <td className="py-1.5 px-2  tracking-tight text-theme-text-muted">{idx + 1}</td>
                  <td className="py-1.5 px-2 text-theme-text-secondary">{row.typeLabel}</td>
                  <td className="py-1.5 px-2  tracking-tight text-theme-text-primary text-center tracking-wide font-semibold">{row.number}</td>
                  <td className="py-1.5 px-2  tracking-tight text-theme-text-primary text-right  font-semibold">{formatBaht(row.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="h-full min-h-[88px] flex items-center justify-center bg-surface-200/15 px-3">
            <p className="text-[11px] text-theme-text-muted italic text-center">ไม่มีรายการรอส่ง</p>
          </div>
        )}
      </div>

      <div className="shrink-0 flex flex-nowrap items-center gap-2 p-2.5 border-t border-border/60 bg-surface-200/10 overflow-x-auto">
        <button
          type="button"
          onClick={handleStageCurrentCuts}
          disabled={!cutItems.length}
          className="btn-toolbar-glow btn-fintech-spark !h-9 shrink-0 px-3 text-[11px] font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1">
          <span aria-hidden>⏳</span>
          บันทึกรอส่ง
        </button>
        <button
          type="button"
          className="btn-toolbar-glow btn-toolbar-danger !h-9 shrink-0 px-3 text-[11px] font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!stagedCuts.length && !cutItems.length}
          onClick={async () => {
            if (!await confirm({ message: 'ลบข้อมูลรอส่งและรีเซ็ตการตัดบนกราฟ?', danger: true })) return;
            setStagedCuts([]);
            setManualThreshold(null);
            setSelectedRowIdx(null);
            lastManualByTypeRef.current = {};
          }}>
          ลบข้อมูลรอส่ง
        </button>
        <button
          type="button"
          className="btn-toolbar-glow btn-toolbar-amber !h-9 shrink-0 px-3 text-[11px] font-semibold whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
          disabled={!stagedCuts.length}
          onClick={async () => {
            if (!stagedCuts.length) return;
            if (!await confirm({ message: 'ยกเลิกรายการที่บันทึกรอส่ง (คิว) เท่านั้น?', danger: true })) return;
            setStagedCuts([]);
          }}>
          ยกเลิกการรอส่ง
        </button>
      </div>
    </div>
  </div>
</div>

  );
}
