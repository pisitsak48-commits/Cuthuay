'use client';

import dynamic from 'next/dynamic';
import { motion } from 'framer-motion';
import type { Dispatch, MutableRefObject, RefObject, SetStateAction, MouseEvent } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { BetType, BET_TYPE_LABELS, type RangeSimRow } from '@/types';
import type { RangeSimResponse } from '@/types';
import type { ChartBar } from '@/components/cut/cutChartParts';
import { formatBaht } from '@/lib/utils';
import type { PendingCutSlice } from '@/components/cut/cutTypes';

const CutStackedBarChart = dynamic(() => import('@/components/cut/CutStackedBarChart'), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded-xl bg-surface-100" />,
});

const CHART_SEG_ACTIVE =
  '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] shadow-sm font-semibold ring-1 ring-black/10';
const CHART_SEG_IDLE =
  'text-[var(--text-primary)] bg-[var(--color-card-bg-solid)]/90 hover:bg-[var(--color-nav-hover-bg)] shadow-sm ring-1 ring-[var(--chart-neutral-light)]';

const BET_TYPE_SHORT: Record<BetType, string> = {
  '3digit_top': '3 ตัวบน', '3digit_tote': '3 ตัวโต็ด', '3digit_back': '3 ตัวล่าง',
  '2digit_top': '2 ตัวบน', '2digit_bottom': '2 ตัวล่าง',
  '1digit_top': 'วิ่งบน',  '1digit_bottom': 'วิ่งล่าง',
};

function ThresholdPerNumberPill({ amount }: { amount: number }) {
  if (amount <= 0) return null;
  return (
    <span
      className="inline-flex items-baseline gap-1 rounded-lg [background:var(--color-nav-active-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-nav-active-fg)] shadow-[0_4px_14px_rgba(53,122,189,0.28)] ring-1 ring-white/25 tabular-nums tracking-tight"
      title="ยอดเก็บต่อเลข (ขีดบนกราฟ)"
    >
      <span className="text-[11px] font-semibold opacity-95">ขีด</span>
      <span className="text-xs font-bold">{formatBaht(amount)}</span>
      <span className="text-[11px] font-semibold opacity-90">บ/เลข</span>
    </span>
  );
}

type ChartSortMode = 'amount_desc' | 'number_asc';

export type CutRiskPanelProps = {
  selectedRoundId: string;
  committedThreshold: number | null;
  rangeResult: RangeSimResponse | null;
  rangeLoading: boolean;
  activeBetType: BetType;
  activeThreshold: number;
  manualThreshold: number | null;
  setManualThreshold: Dispatch<SetStateAction<number | null>>;
  selectedRowIdx: number | null;
  setSelectedRowIdx: Dispatch<SetStateAction<number | null>>;
  keepPerInputStr: string;
  setKeepPerInputStr: Dispatch<SetStateAction<string>>;
  keepPerInputFocusedRef: MutableRefObject<boolean>;
  chartData: ChartBar[];
  chartHeight: number | null;
  setChartHeight: Dispatch<SetStateAction<number | null>>;
  chartSortMode: ChartSortMode;
  setChartSortMode: Dispatch<SetStateAction<ChartSortMode>>;
  setChartFullscreen: Dispatch<SetStateAction<boolean>>;
  chartHasKeptSegment: boolean;
  totalAlreadySent: number;
  chartContainerRef: RefObject<HTMLDivElement>;
  handleChartAreaClick: (e: MouseEvent<HTMLDivElement>) => void;
  handleChartClick: (data: unknown) => void;
  avgChartTotal: number;
  topChartNumbers: Set<string>;
  lowChartNumbers: Set<string>;
  chartBarMountKey: string;
  avgLineMountKey: string;
  hoveredChartNumber: string | null;
  setHoveredChartNumber: Dispatch<SetStateAction<string | null>>;
  yScaleRef: MutableRefObject<(((v: number) => number) & { invert?: (px: number) => number }) | null>;
  yAxisOffsetRef: MutableRefObject<{ top: number }>;
  s: RangeSimRow | null;
  totalSend: number;
  totalRevenue: number;
  overThresholdNumbers: number;
  underThresholdNumbers: number;
  unsoldNumbers: number;
  sentNumbers: number;
  minSingleBet: number;
  stagedCuts: PendingCutSlice[];
  cutItems: { number: string; amount: number }[];
  linePngBusy: boolean;
  setPdfOpen: Dispatch<SetStateAction<boolean>>;
  handleDownloadPendingSlipPng: () => void | Promise<void>;
  setStagedCuts: Dispatch<SetStateAction<PendingCutSlice[]>>;
};

export function CutRiskPanel(props: CutRiskPanelProps) {
  const {
    selectedRoundId,
    committedThreshold,
    rangeResult,
    rangeLoading,
    activeBetType,
    activeThreshold,
    manualThreshold,
    setManualThreshold,
    selectedRowIdx,
    setSelectedRowIdx,
    keepPerInputStr,
    setKeepPerInputStr,
    keepPerInputFocusedRef,
    chartData,
    chartHeight,
    setChartHeight,
    chartSortMode,
    setChartSortMode,
    setChartFullscreen,
    chartHasKeptSegment,
    totalAlreadySent,
    chartContainerRef,
    handleChartAreaClick,
    handleChartClick,
    avgChartTotal,
    topChartNumbers,
    lowChartNumbers,
    chartBarMountKey,
    avgLineMountKey,
    hoveredChartNumber,
    setHoveredChartNumber,
    yScaleRef,
    yAxisOffsetRef,
    s,
    totalSend,
    totalRevenue,
    overThresholdNumbers,
    underThresholdNumbers,
    unsoldNumbers,
    sentNumbers,
    minSingleBet,
    stagedCuts,
    cutItems,
    linePngBusy,
    setPdfOpen,
    handleDownloadPendingSlipPng,
    setStagedCuts,
  } = props;

  const confirm = useConfirm();

  return (
<div className="relative flex flex-col min-w-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 gap-4">
  {/* Committed threshold info banner */}
  {committedThreshold != null && (
    <div className="flex items-center gap-2 bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2 text-xs shrink-0">
      <span className="text-loss">🔒</span>
      <span className="text-theme-text-secondary">
        ส่งแล้วที่{' '}
        <span className="tracking-tight text-risk-medium font-bold">
          {committedThreshold > 0 ? formatBaht(committedThreshold) : '0'}
        </span>{' '}
        บ/เลข
        &nbsp;&mdash;&nbsp;สามารถตัดเพิ่มได้ (ลดต่ำกว่าเดิม) แต่ไม่สามารถเพิ่มขึ้นได้
        &nbsp;·&nbsp;ลบรายการส่งเพื่อเริ่มใหม่ทั้งหมด
      </span>
    </div>
  )}

  {/* INFO + STATS BAR — compact layout close to reference */}
  <div className="grid grid-cols-1 xl:grid-cols-3 gap-2">
    <div className="bg-surface-200 rounded-lg border border-border/30 px-2.5 py-2">
      <div className="text-xs font-bold tracking-wide text-theme-text-primary mb-2 pb-1.5 border-b border-border/50">ภาพรวม</div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดขาย</span>
        <span className="text-sm tracking-tight font-semibold text-profit">{rangeResult ? formatBaht(rangeResult.total_revenue) : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดตัด</span>
        <span className="text-sm tracking-tight text-[var(--color-accent-hover)]">{formatBaht(totalSend + totalAlreadySent)}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">คงเหลือ</span>
        <span className="text-sm tracking-tight text-theme-text-primary">{formatBaht(totalRevenue - totalSend - totalAlreadySent)}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">เก็บตัวละ</span>
        <span className="text-sm tracking-tight font-bold text-risk-medium">{rangeResult ? formatBaht(activeThreshold) : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">% ได้</span>
        <span className="text-sm tracking-tight font-semibold text-profit">{s ? `${s.pct_win.toFixed(1)}%` : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1">
        <span className="text-xs sm:text-sm text-theme-text-secondary">% เสีย</span>
        <span className="text-sm tracking-tight font-semibold text-loss">{s ? `${s.pct_lose.toFixed(1)}%` : '—'}</span>
      </div>
    </div>

    <div className="bg-surface-200 rounded-lg border border-border/30 px-2.5 py-2">
      <div className="text-xs font-bold tracking-wide text-theme-text-primary mb-2 pb-1.5 border-b border-border/50">สถานะเลข</div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">เลขยอดเกิน</span>
        <span className="text-sm tracking-tight text-loss">{s ? `${overThresholdNumbers.toLocaleString('th-TH')} เลข` : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">เลขยอดไม่เกิน</span>
        <span className="text-sm tracking-tight text-theme-text-secondary">{rangeResult ? `${underThresholdNumbers.toLocaleString('th-TH')} เลข` : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">เลขไม่ได้ขาย</span>
        <span className="text-sm tracking-tight text-theme-text-secondary">{`${unsoldNumbers.toLocaleString('th-TH')} เลข`}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">จำนวนเลขที่ส่งแล้ว</span>
        <span className="text-sm tracking-tight text-accent-glow">{`${sentNumbers.toLocaleString('th-TH')} เลข`}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">สูงสุดต่อเลข</span>
        <span className="text-sm tracking-tight text-risk-medium">{rangeResult ? formatBaht(rangeResult.max_single_bet) : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1">
        <span className="text-xs sm:text-sm text-theme-text-secondary">ต่ำสุดต่อเลข</span>
        <span className="text-sm tracking-tight text-theme-text-secondary">{rangeResult ? formatBaht(minSingleBet) : '—'}</span>
      </div>
    </div>

    <div className="bg-surface-200 rounded-lg border border-border/30 px-2.5 py-2">
      <div className="text-xs font-bold tracking-wide text-theme-text-primary mb-2 pb-1.5 border-b border-border/50">ผลได้เสีย</div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดได้สูงสุด</span>
        <span className="text-sm tracking-tight text-profit">{s ? formatBaht(s.max_gain) : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดเสียสูงสุด</span>
        <span className={`text-sm tracking-tight ${s?.max_loss != null ? 'text-loss' : 'text-profit'}`}>
          {s ? (s.max_loss != null ? formatBaht(s.max_loss) : 'ไม่เสีย') : '—'}
        </span>
      </div>
      <div className="flex items-center justify-between py-1 border-b border-border/30">
        <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดได้ต่ำสุด</span>
        <span className="text-sm tracking-tight text-profit">{s && s.min_gain != null ? formatBaht(s.min_gain) : '—'}</span>
      </div>
      <div className="flex items-center justify-between py-1">
        <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดเสียต่ำสุด</span>
        <span className="text-sm tracking-tight text-loss">{s && s.min_loss != null ? formatBaht(s.min_loss) : '—'}</span>
      </div>
    </div>
  </div>

  {/* CHART */}
  {rangeResult && chartData.length > 0 ? (
    <Card className="p-0 overflow-hidden flex-shrink-0 min-w-0 max-w-full border-2 border-[var(--chart-neutral-light)] shadow-[var(--shadow-soft)] bg-[var(--color-input-bg)]">
    {/* eslint-disable-next-line react-hooks/exhaustive-deps */}
    {/* derive default height based on bet type */}
      <div className="px-4 pt-3 pb-2 flex flex-col gap-2 min-w-0 max-w-full bg-[var(--color-bg-primary)]/90">
        <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <CardTitle className="text-sm">{BET_TYPE_LABELS[activeBetType]} — การกระจายยอดแทง</CardTitle>
          {activeThreshold > 0 && <ThresholdPerNumberPill amount={activeThreshold} />}
        </div>
        <div className="flex items-center gap-2 text-xs text-[var(--chart-neutral-mid)]">
          {chartHasKeptSegment && (
          <span className="flex items-center gap-1 font-medium"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-kept)] ring-1 ring-black/10 shrink-0 inline-block"/>เก็บ</span>
          )}
          {totalAlreadySent > 0 && <span className="flex items-center gap-1 font-medium"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-sent)] ring-1 ring-black/10 shrink-0 inline-block"/>ส่งแล้ว</span>}
          <span className="flex items-center gap-1 font-medium"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-new)] ring-1 ring-[var(--chart-neutral-dark)]/15 shrink-0 inline-block"/>ตัดเพิ่ม</span>
          {activeThreshold === 0 && <span className="italic hidden sm:inline text-[var(--color-semantic-success-muted)]">เก็บ 0 = ส่งเจ้าหมด (ยกเว้นเลขปิดรับ)</span>}
          <span className="flex items-center gap-0.5 border-l border-[var(--chart-neutral-light)] pl-2 ml-0.5">
            <button
              onClick={() => setChartSortMode('amount_desc')}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold transition-[color,background-color,box-shadow] duration-200 ease-out ${
 chartSortMode === 'amount_desc' ? CHART_SEG_ACTIVE : CHART_SEG_IDLE
 }`}
              title="เรียงตามยอดมากไปน้อย"
            >
              ยอดมาก→น้อย
            </button>
            <button
              onClick={() => setChartSortMode('number_asc')}
              className={`h-6 px-2 rounded-md text-[11px] font-semibold transition-[color,background-color,box-shadow] duration-200 ease-out ${
 chartSortMode === 'number_asc' ? CHART_SEG_ACTIVE : CHART_SEG_IDLE
 }`}
              title="เรียงตามเลข 00-99 / 000-999"
            >
              เรียงตามเลข
            </button>
          </span>
          {/* Zoom size buttons */}
          {(() => { const eff = chartHeight ?? 360; return (
          <span className="flex items-center gap-0.5 border-l border-[var(--chart-neutral-light)] pl-2 ml-0.5">
            {([180, 260, 360, 480] as const).map(h => (
              <button type="button" key={h} onClick={() => setChartHeight(h)}
                className={`w-8 h-8 rounded-md text-[9px] font-bold transition-[color,background-color,box-shadow] duration-200 ease-out ${
 eff === h ? CHART_SEG_ACTIVE : `${CHART_SEG_IDLE} hover:bg-[var(--color-nav-hover-bg)]`
                }`}>
                {h === 180 ? 'S' : h === 260 ? 'M' : h === 360 ? 'L' : 'XL'}
              </button>
            ))}
          </span>
          ); })()}
          {/* Fullscreen button */}
          <button type="button" onClick={() => setChartFullscreen(true)} title="ขยายเต็มจอ"
            className="w-8 h-8 rounded-md hover:bg-[var(--color-nav-hover-bg)] text-[var(--chart-neutral-mid)] hover:text-[var(--text-primary)] transition-colors duration-200 flex items-center justify-center">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
            </svg>
          </button>
        </div>
      </div>
      <div className="flex items-center gap-3 min-w-0 w-full max-w-full flex-wrap">
        <input
          type="range"
          min={0}
          max={committedThreshold ?? rangeResult.max_single_bet}
          step={Math.max(1, Math.ceil((committedThreshold ?? rangeResult.max_single_bet) / 200))}
          value={(committedThreshold ?? rangeResult.max_single_bet) - activeThreshold}
          onChange={(e) => {
            const maxV = committedThreshold ?? rangeResult.max_single_bet;
            const v = Math.max(0, maxV - parseInt(e.target.value));
            const clamped = committedThreshold != null ? Math.min(v, committedThreshold) : v;
            setManualThreshold(clamped);
            if (rangeResult) {
              const idx = rangeResult.rows.findIndex(r => r.threshold >= clamped);
              setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
            }
          }}
          className="flex-1 min-w-[min(100%,12rem)] sm:min-w-[10rem] h-2 accent-neutral order-1"
          title="ซ้าย: ไม่ตัด · ขวา: ตัดมากขึ้น"
        />
        <div className="flex items-center gap-2 shrink-0 order-2">
          <span className="text-xs text-theme-text-muted whitespace-nowrap">เก็บตัวละ:</span>
          <input
            type="number"
            min={0}
            max={committedThreshold ?? Math.ceil(rangeResult.max_single_bet)}
            step={1}
            value={keepPerInputStr}
            placeholder={String(Math.round(activeThreshold))}
            onChange={(e) => {
              const raw = e.target.value;
              setKeepPerInputStr(raw);
              if (raw === '' || raw === '-') {
                setManualThreshold(null);
                setSelectedRowIdx(null);
                return;
              }
              const v = parseInt(raw, 10);
              if (Number.isNaN(v) || v < 0) return;
              const clamped = committedThreshold != null ? Math.min(v, committedThreshold) : v;
              setManualThreshold(clamped);
              if (rangeResult) {
                const idx = rangeResult.rows.findIndex(r => r.threshold >= clamped);
                setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
              }
            }}
            onFocus={(e) => {
              keepPerInputFocusedRef.current = true;
              e.currentTarget.select();
            }}
            onBlur={() => {
              keepPerInputFocusedRef.current = false;
              // ถ้าช่องว่างและยังมี activeThreshold — sync ให้ตรง
              if (keepPerInputStr === '' && activeThreshold > 0) {
                setKeepPerInputStr('');
              } else if (manualThreshold != null) {
                // แสดงค่า clamped จริง (เผื่อผู้ใช้พิมพ์เกิน max)
                setKeepPerInputStr(String(manualThreshold));
              }
            }}
            className="w-24 h-7 rounded-md bg-[var(--color-input-bg)] border-2 border-[var(--chart-neutral-light)] px-2 text-sm text-[var(--chart-neutral-dark)] tracking-tight font-semibold text-right focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)]"
          />
        </div>
        <span className="text-[11px] text-theme-text-muted shrink-0 order-3 max-sm:w-full max-sm:pl-0.5">
          ซ้าย: ไม่ตัด · ขวา: ตัดมากขึ้น
        </span>
        {manualThreshold !== null && (
          <button
            type="button"
            onClick={() => { setManualThreshold(null); setSelectedRowIdx(null); }}
            className="shrink-0 order-4 h-7 px-3 rounded-lg border-2 border-[var(--chart-primary)] bg-[var(--primary-100)] text-[var(--primary-800)] text-xs font-semibold shadow-sm hover:bg-[var(--primary-200)] hover:border-[var(--chart-primary-dark)] active:scale-[0.98] transition-[color,background-color,border-color,transform] duration-150"
          >
            รีเซ็ต
          </button>
        )}
      </div>
      </div>
      {/* Clickable chart area */}
      <motion.div
        ref={chartContainerRef}
        initial={false}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="cursor-crosshair overflow-x-auto w-full max-w-full min-w-0 rounded-b-xl border-t border-[var(--chart-neutral-light)] bg-[var(--color-surface)] px-3 pb-3 pt-3"
        onClick={handleChartAreaClick}
      >
        <CutStackedBarChart
          variant="panel"
          chartData={chartData}
          chartHeight={chartHeight ?? 360}
          activeThreshold={activeThreshold}
          avgChartTotal={avgChartTotal}
          committedThreshold={committedThreshold}
          topChartNumbers={topChartNumbers}
          lowChartNumbers={lowChartNumbers}
          chartHasKeptSegment={chartHasKeptSegment}
          chartBarMountKey={chartBarMountKey}
          avgLineMountKey={avgLineMountKey}
          hoveredChartNumber={hoveredChartNumber}
          setHoveredChartNumber={setHoveredChartNumber}
          onBarChartClick={handleChartClick}
          onCaptureYScale={(scale, top) => {
            yScaleRef.current = scale;
            yAxisOffsetRef.current = { top };
          }}
        />
      </motion.div>
    </Card>
  ) : rangeLoading ? (
    <div className="space-y-2">
      {[...Array(5)].map((_,i) => <div key={i} className="h-8 rounded-lg bg-surface-200 animate-pulse" />)}
    </div>
  ) : selectedRoundId ? (
    <div className="flex-1 flex items-center justify-center text-theme-text-muted text-sm">
      กำลังโหลด…
    </div>
  ) : (
    <div className="flex-1 flex items-center justify-center text-theme-text-muted text-sm">เลือกงวดก่อน</div>
  )}

  {/* แถบตัดค้างส่ง — กะทัดรัด (ไม่มีตารางรายเลข) */}
  {selectedRoundId && rangeResult && (
    <div className="shrink-0 rounded-xl border border-border/60 bg-surface-200/40 px-3 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-theme-text-muted">
          ค้างส่ง <span className="tracking-tight font-bold text-[var(--color-accent-hover)]">{formatBaht(totalSend)}</span>
        </span>
        <span className="text-theme-text-muted">·</span>
        <span className="text-theme-text-muted">
          เก็บ <span className="tracking-tight font-semibold text-risk-medium">{formatBaht(activeThreshold)}</span> บ/เลข
        </span>
        {stagedCuts.length > 0 && (
          <span className="text-[11px] text-accent-hover/95 max-w-[min(100%,28rem)] truncate" title={stagedCuts.map((s) => `${BET_TYPE_SHORT[s.bet_type]} ${formatBaht(s.total)}`).join(' · ')}>
            คิวรอส่ง: {stagedCuts.map((s) => `${BET_TYPE_SHORT[s.bet_type]} ${formatBaht(s.total)}`).join(' · ')}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 ml-auto">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => { setPdfOpen(true); }}
          disabled={!cutItems.length}
          className="h-8 border border-border/60">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1 opacity-80">
            <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
          </svg>
          พิมพ์
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void handleDownloadPendingSlipPng()}
          disabled={!cutItems.length || linePngBusy}
          title="ดาวน์โหลด PNG โพยค้างส่ง — แนบส่งไลน์เจ้ามือ"
          className="h-8 border-2 border-[var(--chart-primary)]/70 bg-[var(--chart-primary-soft)]/40 text-[var(--chart-neutral-dark)] font-semibold">
          {linePngBusy ? '…' : 'PNG ไลน์'}
        </Button>
        {(cutItems.length > 0 || manualThreshold !== null) && (
          <button
            type="button"
            onClick={() => { setManualThreshold(null); setSelectedRowIdx(null); }}
            className="h-8 px-2.5 rounded-lg text-[11px] text-theme-text-muted hover:text-theme-text-secondary hover:bg-surface-300/50 transition-colors">
            ล้างเก็บ
          </button>
        )}
        {stagedCuts.length > 0 && (
          <button
            type="button"
            onClick={async () => {
              if (!await confirm({ message: 'ล้างรายการที่บันทึกรอส่งทั้งหมด?', danger: true })) return;
              setStagedCuts([]);
            }}
            className="h-8 px-2.5 rounded-lg text-[11px] text-risk-medium/95 hover:text-risk-medium hover:bg-risk-medium/90/10 transition-colors">
            ล้างคิว
          </button>
        )}
      </div>
    </div>
  )}
</div>

  );
}
