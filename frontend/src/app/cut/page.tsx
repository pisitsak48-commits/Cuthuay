'use client';
import { useEffect, useLayoutEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import type { ChartBar } from '@/components/cut/cutChartParts';
import { CutSearchDialog } from '@/components/cut/CutSearchDialog';
import { CutToolbar } from '@/components/cut/CutToolbar';
import { CutRiskPanel } from '@/components/cut/CutRiskPanel';
import { CutSendBatchesPanel } from '@/components/cut/CutSendBatchesPanel';
import { CutRangeTableModal } from '@/components/cut/CutRangeTableModal';
import type { PendingCutSlice } from '@/components/cut/cutTypes';
import { buildBatchPrintHtml, buildSingleBatchSlipHtml, batchPngFilename } from '@/lib/cut/cutBatchPrint';
import { CutPdfDialog, buildCutSlipSheetsHtml } from '@/components/cut/CutPdfDialog';
import { CutSmartCutDialog } from '@/components/cut/CutSmartCutDialog';
import { SaveDealerModal, SendBatchItemsModal } from '@/components/cut/CutSendModals';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { useRoundsQuery } from '@/hooks/queries/useRoundsQuery';
import { showApiError } from '@/lib/apiErrorToast';
import { roundsApi, cutApi, dealersApi } from '@/lib/api';
import { filterRoundsForSummaryCutPicker } from '@/lib/roundPickerFilter';
import { cn, formatBaht } from '@/lib/utils';
import { useAuthStore } from '@/store/useStore';
import {
  readPanelWidth,
  writePanelWidth,
  readPanelLock,
  STORAGE_CUT_RIGHT_PANEL_W,
  STORAGE_CUT_RIGHT_PANEL_LOCK,
} from '@/lib/panelResize';
import { openPrintPreview } from '@/lib/printPreview';
import { downloadHtmlAsPng, downloadPngZip, downloadDataUrlAsFile, renderHtmlToPngDataUrl } from '@/lib/htmlToPng';
import { PRINT_ROOT_INLINE_STYLE } from '@/lib/printTypography';
import { themeHex } from '@/lib/printColorTokens';
import {
  Round, BetType, BET_TYPE_LABELS, Dealer,
  RangeSimResponse, RangeSimRow, RiskReport, SendBatch,
} from '@/types';

const CutStackedBarChart = dynamic(() => import('@/components/cut/CutStackedBarChart'), {
  ssr: false,
  loading: () => <div className="h-[360px] animate-pulse rounded-xl bg-surface-100" />,
});

/** แยกคอลัมน์กราฟ | รายการส่งเมื่อกล่อง layout กว้างพอ (วัดจริงหลัง sidebar) */
const CUT_LAYOUT_SPLIT_MIN_PX = 1260;

// ─── Constants ───────────────────────────────────────────────────────────────
const BET_TYPE_ORDER: BetType[] = [
  '3digit_top', '3digit_tote', '3digit_back',
  '2digit_top', '2digit_bottom', '1digit_top', '1digit_bottom',
];
const BET_TYPE_SHORT: Record<BetType, string> = {
  '3digit_top': '3 ตัวบน', '3digit_tote': '3 ตัวโต็ด', '3digit_back': '3 ตัวล่าง',
  '2digit_top': '2 ตัวบน', '2digit_bottom': '2 ตัวล่าง',
  '1digit_top': 'วิ่งบน',  '1digit_bottom': 'วิ่งล่าง',
};
/** ขั้น % นำของยอดสูงสุด — 0.5 ละเอียดสุดในรายการ (201 แถว), สูตร backend เดิม (UI ใน CutRangeTableModal) */

type ChartSortMode = 'amount_desc' | 'number_asc';

const CHART_SEG_ACTIVE =
  '[background:var(--color-nav-active-bg)] text-[var(--color-nav-active-fg)] shadow-sm font-semibold ring-1 ring-black/10';
/** idle: ข้อความสีเข้มบนพื้นอ่อน — ห้ามใช้สีขาวบน bg อ่อน (เคยพังเมื่อ gradient ไปอยู่ background-color) */
const CHART_SEG_IDLE =
  'text-[var(--text-primary)] bg-[var(--color-card-bg-solid)]/90 hover:bg-[var(--color-nav-hover-bg)] shadow-sm ring-1 ring-[var(--chart-neutral-light)]';

/** ป้าย «ขีด xxx บ/เลข» — ใช้ gradient นำทางเดียวกับปุ่มเรียงกราฟ */
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

/** รายการตัดที่เก็บไว้ส่งภายหลัง (รวมหลายประเภทก่อนกดบันทึกส่ง) — type ใน cutTypes.ts */

// ─── Main page ────────────────────────────────────────────────────────────────
function CutPageInner() {
  const searchParams = useSearchParams();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  /** ซ่อน archived และงวดเก่าตามวันออก — admin ติ๊กเพื่อโชว์ทั้งหมด */
  const [cutIncludeArchived, setCutIncludeArchived] = useState(false);
  const roundFromUrl = searchParams.get('round') ?? '';

  // ── Round / dealers
  const { data: rounds = [] } = useRoundsQuery();
  const [dealers, setDealers]                 = useState<Dealer[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState(roundFromUrl);
  const [selectedDealerId, setSelectedDealerId] = useState<string>('');
  const [dealerName, setDealerName]           = useState<string | null>(null);

  // ── Bet type & step
  const [activeBetType, setActiveBetType]     = useState<BetType>('3digit_top');
  const [stepPct, setStepPct]                 = useState(2.5);
  // ── Dealer params (fetched from API, not manually set)
  const [dealerParams, setDealerParams]       = useState<{
    keep_net_pct: number;
    commissions: Record<string, number>;
    rates: Record<string, number>;
  } | null>(null);

  // ── Range simulation
  const [rangeLoading, setRangeLoading]       = useState(false);
  const [rangeResult, setRangeResult]         = useState<RangeSimResponse | null>(null);
  const [selectedRowIdx, setSelectedRowIdx]   = useState<number | null>(null);
  const tableBodyRef                          = useRef<HTMLDivElement>(null);
  const [searchOpen, setSearchOpen]           = useState(false);
  const [smartCutOpen, setSmartCutOpen]       = useState(false);

  // ── Threshold set via click on chart or row
  const [manualThreshold, setManualThreshold] = useState<number | null>(null);
  /** Raw string ที่แสดงในช่อง "เก็บตัวละ" — แยกจาก manualThreshold เพื่อให้ลบเลขได้ทั้งหมดก่อนพิมพ์ใหม่ */
  const [keepPerInputStr, setKeepPerInputStr] = useState('');
  const keepPerInputFocusedRef = useRef(false);

  // ── Risk data
  const [risk, setRisk]                       = useState<RiskReport | null>(null);

  // ── Send batches (confirmed sends stored in DB)
  const [sendBatches, setSendBatches]         = useState<SendBatch[]>([]);
  const [savingBatch, setSavingBatch]         = useState(false);
  const [deletingBatchId, setDeletingBatchId] = useState<string | null>(null);
  const [selectedBatchIds, setSelectedBatchIds] = useState<Set<string>>(new Set());
  const [showSaveModal, setShowSaveModal]     = useState(false);
  const [viewBatch, setViewBatch]             = useState<SendBatch | null>(null);
  /** รวมหลายประเภทก่อนกดบันทึกส่งครั้งเดียว */
  const [stagedCuts, setStagedCuts]           = useState<PendingCutSlice[]>([]);
  const stagedCutsRef                         = useRef<PendingCutSlice[]>(stagedCuts);
  stagedCutsRef.current = stagedCuts;
  /** ยอดเก็บล่าสุดต่อประเภท — ใช้ตอนสลับแท็บเมื่อยังไม่มีในคิวรอส่ง */
  const lastManualByTypeRef                   = useRef<Partial<Record<BetType, number>>>({});
  /** ความกว้างแผงขวา (รายการส่ง) — ลากขอบซ้ายของแผงเพื่อปรับ */
  const liveRightPanelWRef                    = useRef(360);
  const [rightPanelPx, setRightPanelPx]       = useState(() => {
    const w = readPanelWidth(STORAGE_CUT_RIGHT_PANEL_W, 360);
    liveRightPanelWRef.current = w;
    return w;
  });
  const [rightPanelLocked, setRightPanelLocked] = useState(() => readPanelLock(STORAGE_CUT_RIGHT_PANEL_LOCK));
  const rightResizeDrag                       = useRef<{ startX: number; startW: number } | null>(null);
  const splitLayoutRef                        = useRef<HTMLDivElement>(null);
  const [splitLayoutWide, setSplitLayoutWide] = useState(false);
  const [prefersTouchUi, setPrefersTouchUi]   = useState(false);

  const totalSentAllBatches = useMemo(
    () => sendBatches.reduce((s, b) => s + Number(b.total), 0),
    [sendBatches],
  );

  useEffect(() => {
    if (!isAdmin) setCutIncludeArchived(false);
  }, [isAdmin]);

  const roundsForPicker = useMemo(
    () => filterRoundsForSummaryCutPicker(rounds, { includeArchivedSummaries: cutIncludeArchived, isAdmin }),
    [rounds, isAdmin, cutIncludeArchived],
  );

  // ── Chart display
  const [chartHeight, setChartHeight]         = useState<number | null>(360);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const closeChartDialog = useCallback(() => setChartFullscreen(false), []);
  const chartDialogRef = useFocusTrap(chartFullscreen, closeChartDialog);
  const [chartSortMode, setChartSortMode]     = useState<ChartSortMode>('number_asc');
  const [hoveredChartNumber, setHoveredChartNumber] = useState<string | null>(null);

  // ── PDF / LINE PNG
  const [pdfOpen, setPdfOpen]                 = useState(false);
  const [linePngBusy, setLinePngBusy]         = useState(false);
  const [rangeTableOpen, setRangeTableOpen]   = useState(false);
  const [pendingRangeIdx, setPendingRangeIdx] = useState<number | null>(null);

  // ── Fetch
  const fetchAll = useCallback(async () => {
    const dRes = await dealersApi.list();
    setDealers(dRes.data.dealers);
  }, []);

  const fetchRoundDealer = useCallback(async () => {
    if (!selectedRoundId) { setDealerName(null); setSelectedDealerId(''); setDealerParams(null); return; }
    try {
      const res = await cutApi.getDealerRates(selectedRoundId);
      setDealerName(res.data.dealer_name ?? null);
      setSelectedDealerId(res.data.dealer_id ?? '');
      if (res.data.rates && res.data.commissions) {
        setDealerParams({
          keep_net_pct: res.data.keep_net_pct ?? 100,
          commissions: res.data.commissions,
          rates: res.data.rates,
        });
      }
    } catch (err) {
      showApiError(err, 'โหลดอัตราเจ้ามือไม่สำเร็จ');
      setDealerName(null);
      setSelectedDealerId('');
      setDealerParams(null);
    }
  }, [selectedRoundId]);

  const fetchRisk = useCallback(async () => {
    if (!selectedRoundId) return;
    try { const r = await cutApi.getRisk(selectedRoundId); setRisk(r.data); }
    catch (err) { showApiError(err, 'โหลดรายงานความเสี่ยงไม่สำเร็จ'); }
  }, [selectedRoundId]);

  const fetchSendBatches = useCallback(async () => {
    if (!selectedRoundId) { setSendBatches([]); return; }
    try {
      const res = await cutApi.listSendBatches(selectedRoundId);
      setSendBatches(res.data.batches ?? []);
    } catch (err) {
      showApiError(err, 'โหลดรายการส่งไม่สำเร็จ');
      setSendBatches([]);
    }
  }, [selectedRoundId]);

  useEffect(() => { void fetchAll(); }, [fetchAll]);

  useLayoutEffect(() => {
    if (!rounds.length) return;
    const urlId = roundFromUrl.trim();
    const urlExists = urlId && rounds.some((r) => r.id === urlId);
    setSelectedRoundId((prev) => {
      const pool = roundsForPicker;
      const inPool = (id: string) => Boolean(id && pool.some((r) => r.id === id));
      if (urlExists && inPool(urlId)) return urlId;
      if (prev && inPool(prev)) return prev;
      return pool[0]?.id ?? '';
    });
  }, [rounds, roundsForPicker, roundFromUrl]);
  useEffect(() => {
    const el = splitLayoutRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setSplitLayoutWide(w >= CUT_LAYOUT_SPLIT_MIN_PX);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const mq = window.matchMedia('(hover: none), (pointer: coarse)');
    const sync = () => setPrefersTouchUi(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  const sideBySideLayout = splitLayoutWide && !prefersTouchUi;
  useEffect(() => {
    liveRightPanelWRef.current = rightPanelPx;
  }, [rightPanelPx]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = rightResizeDrag.current;
      if (!d) return;
      /** ลากขอบไปทางซ้าย = แผงขวากว้างขึ้น (สอดคล้องทิศมือ) */
      const next = Math.min(580, Math.max(260, Math.round(d.startW - (e.clientX - d.startX))));
      liveRightPanelWRef.current = next;
      setRightPanelPx(next);
    };
    const onUp = () => {
      const wasDrag = rightResizeDrag.current != null;
      rightResizeDrag.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      if (wasDrag) writePanelWidth(STORAGE_CUT_RIGHT_PANEL_W, liveRightPanelWRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);
  useEffect(() => {
    fetchRoundDealer(); fetchRisk(); fetchSendBatches();
    setManualThreshold(null); setRangeResult(null); setSelectedRowIdx(null);
    setStagedCuts([]);
    lastManualByTypeRef.current = {};
  }, [selectedRoundId]);

  /** debounce ยอดเก็บตัวละที่พิมพ์/ลาก — ลดการยิง range-simulation (รวม 0 = ไม่เก็บ ส่งหมด) */
  const [debouncedManualThreshold, setDebouncedManualThreshold] = useState<number | null>(null);
  useEffect(() => {
    if (manualThreshold == null) {
      setDebouncedManualThreshold(null);
      return;
    }
    const id = window.setTimeout(() => setDebouncedManualThreshold(manualThreshold), 180);
    return () => window.clearTimeout(id);
  }, [manualThreshold]);

  /** sync ช่อง "เก็บตัวละ" เมื่อ threshold เปลี่ยนจากภายนอก (slider / click แถว) — ไม่ override ขณะที่ผู้ใช้กำลังพิมพ์ */
  useEffect(() => {
    if (keepPerInputFocusedRef.current) return;
    setKeepPerInputStr(manualThreshold != null ? String(manualThreshold) : '');
  }, [manualThreshold]);

  /** หลีกเลี่ยงเขียน ref ผิดประเภทช่วง 1 เฟรมหลังสลับ activeBetType (manual ยังเป็นของแท็บเดิม) */
  const prevBetTypeForPersistRef = useRef(activeBetType);
  useEffect(() => {
    const typeChanged = prevBetTypeForPersistRef.current !== activeBetType;
    prevBetTypeForPersistRef.current = activeBetType;
    if (typeChanged) return;
    if (manualThreshold != null && manualThreshold > 0) {
      lastManualByTypeRef.current[activeBetType] = manualThreshold;
    } else {
      delete lastManualByTypeRef.current[activeBetType];
    }
  }, [manualThreshold, activeBetType]);

  /** เฉพาะเมื่อเปลี่ยนประเภทหวย: คืนยอดจากคิว/ความจำ — ห้ามรีเซ็ตเมื่อเปลี่ยนแค่ stepPct (เดิมทำให้ manual หลุด → โชว์ max_single เช่น 114) */
  const prevBetTypeForResetRef = useRef<BetType | null>(null);
  useEffect(() => {
    const typeChanged = prevBetTypeForResetRef.current !== activeBetType;
    prevBetTypeForResetRef.current = activeBetType;
    if (!typeChanged) return;

    const slice = stagedCutsRef.current.find((s) => s.bet_type === activeBetType);
    let next: number | null = null;
    if (slice && slice.threshold > 0) {
      next = slice.threshold;
    } else {
      const last = lastManualByTypeRef.current[activeBetType];
      if (last != null && last > 0) next = last;
    }
    if (next != null && next > 0) {
      lastManualByTypeRef.current[activeBetType] = next;
    } else {
      delete lastManualByTypeRef.current[activeBetType];
    }
    setManualThreshold(next);
    setDebouncedManualThreshold(next);
    setSelectedRowIdx(null);
  }, [activeBetType]);

  /** หลัง range คำนวณใหม่: จับแถวในตารางให้ตรงยอดเก็บ (บาท) ที่เลือก */
  useEffect(() => {
    if (!rangeResult?.rows?.length || manualThreshold === null || manualThreshold < 0) return;
    const idx = rangeResult.rows.findIndex(r => r.threshold >= manualThreshold);
    setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
  }, [rangeResult, manualThreshold]);

  useEffect(() => {
    setChartSortMode(
      activeBetType === '3digit_top' || activeBetType === '3digit_tote' || activeBetType === '3digit_back'
        ? 'number_asc'
        : 'amount_desc',
    );
  }, [activeBetType]);

  // ── Delete a saved send batch
  const handleDeleteBatch = async (batchId: string) => {
    if (!confirm('ลบรายการส่งนี้?')) return;
    setDeletingBatchId(batchId);
    try {
      await cutApi.deleteSendBatch(selectedRoundId, batchId);
      setSendBatches(prev => prev.filter(b => b.id !== batchId));
      setSelectedBatchIds(prev => { const next = new Set(prev); next.delete(batchId); return next; });
    } catch (err) {
      showApiError(err, 'ลบรายการส่งไม่สำเร็จ');
    }
    finally { setDeletingBatchId(null); }
  };

  // ── Delete ALL saved batches (recalculation is automatic: alreadySentMap / committedThreshold re-derive from sendBatches state)
  const handleDeleteAllBatches = async () => {
    if (!sendBatches.length) return;
    if (!confirm(`ลบรายการส่งทั้งหมด ${sendBatches.length} รายการ? ระบบจะคำนวณใหม่อัตโนมัติ`)) return;
    setDeletingBatchId('all');
    try {
      await Promise.all(sendBatches.map(b => cutApi.deleteSendBatch(selectedRoundId, b.id)));
      setSendBatches([]);
      setSelectedBatchIds(new Set());
    } catch { await fetchSendBatches(); }
    finally { setDeletingBatchId(null); }
  };

  // ── Committed threshold: lowest threshold in saved batches for this type
  // User can only lower threshold (cut more), not raise (would undo already-sent items)
  const batchesForType = sendBatches.filter(b => b.bet_type === activeBetType);
  const committedThreshold: number | null = batchesForType.length > 0
    ? Math.min(...batchesForType.map(b => b.threshold))
    : null;

  // ── Already-sent amounts per number across all saved batches
  const alreadySentMap = new Map<string, number>();
  for (const b of batchesForType) {
    for (const item of b.items) {
      alreadySentMap.set(item.number, (alreadySentMap.get(item.number) ?? 0) + item.amount);
    }
  }
  const totalAlreadySent = batchesForType.reduce((s, b) => s + b.total, 0);

  // ── Threshold: จำกัดไม่เกินขีด “ส่งแล้ว” (รวมกรณีส่งที่เก็บ 0 — committed = 0)
  const selectedRow: RangeSimRow | null = rangeResult?.rows[selectedRowIdx ?? -1] ?? null;
  const fallbackThreshold = rangeResult?.max_single_bet ?? 0;
  const rawThreshold = manualThreshold ?? selectedRow?.threshold ?? fallbackThreshold;
  /** บังคับไม่ให้เกิน “ส่งแล้ว” — รวมกรณีส่งที่เก็บ 0 (threshold ล็อก = 0); เดิมใช้แค่ committed > 0 ทำให้หลังส่งแล้ว active หลุดเป็น max เหมือนมีเก็บ */
  const activeThreshold =
    committedThreshold != null ? Math.min(rawThreshold, committedThreshold) : rawThreshold;

  const maxSingleForActiveRef = useRef(0);
  maxSingleForActiveRef.current = rangeResult?.max_single_bet ?? 0;

  const fetchRangeSim = useCallback(async () => {
    if (!selectedRoundId) return;
    setRangeLoading(true);
    try {
      const steps = Math.ceil(100 / stepPct) + 1;
      const payload: Record<string, unknown> = {
        bet_type: activeBetType,
        step_pct: stepPct,
        steps,
      };
      if (debouncedManualThreshold != null) {
        let cap = debouncedManualThreshold;
        if (committedThreshold != null) {
          cap = Math.min(cap, committedThreshold);
        }
        const ms = maxSingleForActiveRef.current;
        if (ms > 0) {
          cap = Math.min(cap, ms);
        }
        payload.active_threshold = cap;
      }
      const res = await cutApi.rangeSim(selectedRoundId, payload);
      setRangeResult(res.data);
    } catch (err: unknown) {
      setRangeResult(null);
      showApiError(err, 'โหลดจำลองตัดไม่สำเร็จ');
    } finally { setRangeLoading(false); }
  }, [selectedRoundId, activeBetType, stepPct, debouncedManualThreshold, committedThreshold]);

  useEffect(() => { fetchRangeSim(); }, [fetchRangeSim]);

  // ── Chart: compute kept/sentCut/newCut from threshold + alreadySentMap
  // เลขปิดรับ (is_blocked): ไม่เก็บ — ยอดทั้งหมดเป็นตัด/ส่งเมื่อมีเส้นเก็บ (สอดคล้อง simulation ใน API)
  const chartDataBase: ChartBar[] = (rangeResult?.distribution ?? []).map(d => {
    const alreadySent = alreadySentMap.get(d.number) ?? 0;
    const blocked = d.is_blocked === true;
    let kept: number;
    let totalCut: number;
    if (activeThreshold <= 0) {
      kept = 0;
      totalCut = d.total;
    } else if (blocked) {
      kept = 0;
      totalCut = d.total;
    } else {
      kept = Math.min(d.total, activeThreshold);
      totalCut = Math.max(0, d.total - activeThreshold);
    }
    const sentCut  = Math.min(alreadySent, totalCut);
    const newCut   = Math.max(0, totalCut - sentCut);
    return { number: d.number, kept, sentCut, newCut, cut: totalCut, total: d.total };
  });
  /** ถ้าไม่มีเลขใดเก็บเลย (เก็บ 0 / เลขปิดรับทั้งหมด ฯลฯ) อย่าเรนเดอร์ Bar ชั้นเก็บ — Recharts จะทาสีดำที่ชั้นล่างแม้ค่าเป็น 0 */
  const chartHasKeptSegment = chartDataBase.some(b => b.kept > 0);
  const numberDigits = activeBetType.startsWith('3') ? 3 : activeBetType.startsWith('2') ? 2 : 1;
  const chartData: ChartBar[] = [...chartDataBase].sort((a, b) => {
    if (chartSortMode === 'number_asc') {
      const aPad = a.number.padStart(numberDigits, '0');
      const bPad = b.number.padStart(numberDigits, '0');
      return aPad.localeCompare(bPad, 'th', { numeric: true });
    }
    return b.total - a.total;
  });
  const { topChartNumbers, lowChartNumbers } = useMemo(() => {
    const top = new Set<string>();
    const low = new Set<string>();
    if (!chartData.length) return { topChartNumbers: top, lowChartNumbers: low };
    const desc = [...chartData].sort((a, b) => b.total - a.total);
    for (let i = 0; i < Math.min(5, desc.length); i++) top.add(desc[i].number);
    const asc = [...chartData].sort((a, b) => a.total - b.total);
    for (const d of asc) {
      if (low.size >= 5) break;
      if (!top.has(d.number)) low.add(d.number);
    }
    return { topChartNumbers: top, lowChartNumbers: low };
  }, [chartData]);
  const avgChartTotal = useMemo(
    () => (chartData.length ? chartData.reduce((s, d) => s + d.total, 0) / chartData.length : 0),
    [chartData],
  );
  const chartBarMountKey = useMemo(
    () => [selectedRoundId, activeBetType, chartSortMode].join('::'),
    [selectedRoundId, activeBetType, chartSortMode],
  );
  const avgLineMountKey = useMemo(() => `avg-${avgChartTotal.toFixed(2)}`, [avgChartTotal]);

  // ── Click on bar chart: set threshold to the Y value clicked
  const handleChartClick = useCallback((data: any) => {
    if (!data?.activePayload?.length || !rangeResult) return;
    const bar = data.activePayload[0]?.payload as ChartBar;
    // Set threshold = value of kept (= total of this bar, user clicks to "set line here")
    const clickedY = bar.total;
    setManualThreshold(clickedY);
    // Also sync to nearest table row
    const idx = rangeResult.rows.findIndex(r => r.threshold >= clickedY);
    setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
  }, [rangeResult]);

  // ── Click on Y axis coordinates to set threshold (Recharts customized)
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const yScaleRef = useRef<((v: number) => number) & { invert?: (px: number) => number } | null>(null);
  const yAxisOffsetRef = useRef<{ top: number }>({ top: 4 });
  const handleChartAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!rangeResult || !chartContainerRef.current) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    let clickedThreshold: number;
    if (yScaleRef.current?.invert) {
      // Use recharts d3 scale invert for pixel-exact value
      const svgOffsetY = offsetY - yAxisOffsetRef.current.top;
      clickedThreshold = Math.max(0, Math.round(yScaleRef.current.invert(svgOffsetY)));
    } else {
      const chartH = rect.height;
      const topMargin = 4;
      const bottomMargin = 40;
      const plotH = chartH - topMargin - bottomMargin;
      const yRatio = Math.max(0, Math.min(1, 1 - (offsetY - topMargin) / plotH));
      const maxY = rangeResult.max_single_bet * 1.05;
      clickedThreshold = Math.round(yRatio * maxY);
    }
    const clamped = committedThreshold != null ? Math.min(clickedThreshold, committedThreshold) : clickedThreshold;
    setManualThreshold(clamped);
    const idx = rangeResult.rows.findIndex(r => r.threshold >= clamped);
    setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
  }, [rangeResult, committedThreshold]);

  // ── Search
  const handleSearch = (mode: string, value: number) => {
    if (!rangeResult?.rows.length) return;
    let idx = -1;
    if (mode === 'manual') {
      // หาแถวแรกที่ threshold >= ค่าที่ใส่
      idx = rangeResult.rows.findIndex(r => r.threshold >= value);
    } else if (mode === 'pct_win') {
      // หาแถวที่ pct_win ใกล้เคียงกับค่าที่ใส่ที่สุด (closest match)
      idx = rangeResult.rows.reduce<number>((best, r, i) => {
        const diff = Math.abs(r.pct_win - value);
        const bestDiff = Math.abs(rangeResult.rows[best].pct_win - value);
        return diff < bestDiff ? i : best;
      }, 0);
    } else if (mode === 'max_payout') {
      // หาแถวที่ max_loss ใกล้เคียงงบที่ใส่ที่สุด (closest match)
      idx = rangeResult.rows.reduce<number>((best, r, i) => {
        const v = r.max_loss != null ? Math.abs(r.max_loss) : 0;
        const bestV = rangeResult.rows[best].max_loss != null ? Math.abs(rangeResult.rows[best].max_loss) : 0;
        return Math.abs(v - value) < Math.abs(bestV - value) ? i : best;
      }, 0);
    }
    const final = idx >= 0 ? idx : 0;
    const row = rangeResult.rows[final];
    // apply ตรงเป็น threshold โดยไม่ต้องเปิดตาราง range
    setManualThreshold(row.threshold);
    setSelectedRowIdx(final);
  };

  const stagedMapForType = useMemo(() => {
    const ent = stagedCuts.find((s) => s.bet_type === activeBetType);
    const m = new Map<string, number>();
    if (!ent) return m;
    for (const it of ent.items) m.set(it.number, it.amount);
    return m;
  }, [stagedCuts, activeBetType]);

  // ── Cut items (incremental: เฉพาะยอดที่ยังไม่ได้บันทึกในชุดส่ง — ไม่ใช่รายการ “เกินเส้น” ทั้งหมด)
  const cutItems = chartData
    .map(d => {
      const alreadySent = alreadySentMap.get(d.number) ?? 0;
      const staged = stagedMapForType.get(d.number) ?? 0;
      const pending = Math.max(0, Math.round((d.newCut - staged) * 100) / 100);
      return {
        number: d.number,
        amount: pending,
        total: d.total,
        alreadySent,
        type: BET_TYPE_LABELS[activeBetType],
      };
    })
    .filter(d => d.amount > 0);
  const sentBetTypeSet = new Set(sendBatches.map(b => b.bet_type));
  const totalSend = cutItems.reduce((s, d) => s + d.amount, 0);
  const totalRevenue = rangeResult?.total_revenue ?? 0;

  /** แถวในตารางรายการรอส่ง: คิวบันทึกแล้ว + ยอดค้างส่งของประเภทที่กำลังดู */
  const pendingQueueRows = useMemo(() => {
    const rows: { key: string; typeLabel: string; number: string; amount: number }[] = [];
    let i = 0;
    for (const s of stagedCuts) {
      for (const it of s.items) {
        rows.push({
          key: `st-${i++}`,
          typeLabel: BET_TYPE_SHORT[s.bet_type],
          number: it.number,
          amount: it.amount,
        });
      }
    }
    for (const d of cutItems) {
      rows.push({
        key: `pd-${i++}`,
        typeLabel: BET_TYPE_SHORT[activeBetType],
        number: d.number,
        amount: d.amount,
      });
    }
    return rows;
  }, [stagedCuts, cutItems, activeBetType]);

  const handleDeleteSendSelection = useCallback(async () => {
    if (!selectedRoundId || selectedBatchIds.size === 0) return;
    const ids = [...selectedBatchIds];
    if (!confirm(`ลบรายการส่งที่เลือก ${ids.length} รายการ?`)) return;
    setDeletingBatchId('all');
    try {
      await Promise.all(ids.map((id) => cutApi.deleteSendBatch(selectedRoundId, id)));
      setSendBatches((prev) => prev.filter((b) => !ids.includes(b.id)));
      setSelectedBatchIds(new Set());
      await fetchRangeSim();
    } catch (err: unknown) {
      showApiError(err, 'ลบรายการส่งไม่สำเร็จ');
      await fetchSendBatches();
    } finally {
      setDeletingBatchId(null);
    }
  }, [selectedRoundId, selectedBatchIds, fetchSendBatches, fetchRangeSim]);

  const handlePrintSentBatches = useCallback(() => {
    if (!sendBatches.length || !selectedRoundId) return;
    const r = rounds.find((x) => x.id === selectedRoundId);
    if (!r) return;
    const batches =
      selectedBatchIds.size > 0
        ? sendBatches.filter((b) => selectedBatchIds.has(b.id))
        : sendBatches;
    const html = buildBatchPrintHtml(batches, r.name);
    openPrintPreview(
      `<div class="print-root" style="${PRINT_ROOT_INLINE_STYLE};color:${themeHex.textPrimary};">${html}</div>`,
      `พิมพ์รายการส่ง — ${r.name}`,
      `ส่ง_${r.name}`,
    );
  }, [sendBatches, selectedBatchIds, selectedRoundId, rounds]);

  const handleDownloadSentBatchesPng = useCallback(async () => {
    if (!sendBatches.length || !selectedRoundId) return;
    const r = rounds.find((x) => x.id === selectedRoundId);
    if (!r) return;
    const batches =
      selectedBatchIds.size > 0
        ? sendBatches.filter((b) => selectedBatchIds.has(b.id))
        : sendBatches;
    setLinePngBusy(true);
    try {
      const pngEntries = await Promise.all(
        batches.map(async (batch) => ({
          dataUrl: await renderHtmlToPngDataUrl({
            bodyHtml: buildSingleBatchSlipHtml(batch, r.name),
            widthPx: 900,
            pixelRatio: 2,
          }),
          filename: batchPngFilename(batch, r.name),
        })),
      );
      if (pngEntries.length === 1) {
        downloadDataUrlAsFile(pngEntries[0].dataUrl, pngEntries[0].filename);
      } else {
        const zipBase = selectedBatchIds.size > 0
          ? `ส่ง_เลือก${selectedBatchIds.size}ชุด_${r.name}`
          : `ส่ง_${r.name}`;
        await downloadPngZip(pngEntries, zipBase);
      }
    } catch (err: unknown) {
      showApiError(err, 'สร้าง PNG ไม่สำเร็จ — ลองใช้พิมพ์รายการส่งแล้วบันทึก PDF แทน');
    } finally {
      setLinePngBusy(false);
    }
  }, [sendBatches, selectedBatchIds, selectedRoundId, rounds]);

  const handleDownloadPendingSlipPng = useCallback(async () => {
    if (!cutItems.length || !selectedRoundId) return;
    const r = rounds.find((x) => x.id === selectedRoundId);
    if (!r) return;
    const sheets = buildCutSlipSheetsHtml(r.name, activeBetType, dealerName ?? '—', cutItems, totalSend);
    setLinePngBusy(true);
    try {
      await downloadHtmlAsPng({
        bodyHtml: sheets,
        filenameBase: `LINE_รายการส่งค้าง_${BET_TYPE_SHORT[activeBetType]}_${r.name}`,
      });
    } catch (err: unknown) {
      showApiError(err, 'สร้าง PNG ไม่สำเร็จโปรดลองอีกครั้ง');
    } finally {
      setLinePngBusy(false);
    }
  }, [cutItems, selectedRoundId, rounds, activeBetType, dealerName, totalSend]);

  const handleStageCurrentCuts = useCallback(() => {
    if (!cutItems.length) return;
    setStagedCuts((prev) => {
      const next = prev.filter((p) => p.bet_type !== activeBetType);
      next.push({
        bet_type: activeBetType,
        threshold: activeThreshold,
        items: cutItems.map((d) => ({ number: d.number, amount: d.amount })),
        total: totalSend,
      });
      return next;
    });
  }, [cutItems, activeBetType, activeThreshold, totalSend]);

  const handleSaveBatch = async (dealerId: string) => {
    if (!selectedRoundId) return;
    const byType = new Map<BetType, PendingCutSlice>();
    for (const s of stagedCuts) byType.set(s.bet_type, s);
    if (cutItems.length > 0) {
      byType.set(activeBetType, {
        bet_type: activeBetType,
        threshold: activeThreshold,
        items: cutItems.map((d) => ({ number: d.number, amount: d.amount })),
        total: totalSend,
      });
    }
    const toFlush = [...byType.values()];
    if (!toFlush.length) return;
    setSavingBatch(true);
    try {
      if (dealerId !== selectedDealerId) {
        await roundsApi.setDealer(selectedRoundId, dealerId || null);
        const found = dealers.find((x) => x.id === dealerId);
        setDealerName(found?.name ?? null);
        setSelectedDealerId(dealerId);
        await fetchRoundDealer();
      }
      const found = dealers.find((x) => x.id === dealerId);
      const dname = found?.name ?? dealerName ?? null;
      for (const slice of toFlush) {
        await cutApi.createSendBatch(selectedRoundId, {
          bet_type: slice.bet_type,
          threshold: slice.threshold,
          items: slice.items,
          total: slice.total,
          dealer_id: dealerId || null,
          dealer_name: dname,
        });
      }
      setStagedCuts([]);
      setManualThreshold(null);
      setSelectedRowIdx(null);
      lastManualByTypeRef.current = {};
      await fetchSendBatches();
      fetchRangeSim();
      setShowSaveModal(false);
    } catch (err: unknown) {
      showApiError(err, 'บันทึกไม่สำเร็จ');
    } finally {
      setSavingBatch(false);
    }
  };

  // ── ผลได้เสีย: ถ้าตั้งเก็บตัวละเอง ใช้ snapshot จาก API (at_threshold) ไม่ใช่แถว % ที่ threshold ปัด
  const manualCap =
    manualThreshold != null ? activeThreshold : 0;
  const snapshotMatchesManual =
    rangeResult?.at_threshold != null &&
    manualThreshold != null &&
    debouncedManualThreshold === manualThreshold &&
    Math.abs(rangeResult.at_threshold.threshold - manualCap) < 0.02;
  const effectiveStats: RangeSimRow | null = snapshotMatchesManual
    ? rangeResult!.at_threshold!
    : selectedRow;

  const s = effectiveStats ?? rangeResult?.rows[0] ?? null;
  const totalNumbersByType =
    activeBetType === '3digit_tote'
      ? 220
      : activeBetType.startsWith('3')
        ? 1000
        : activeBetType.startsWith('2')
          ? 100
          : 10;
  const rawDist = rangeResult?.distribution ?? [];
  /** เลขไม่ได้ขาย = ช่องที่มียอดรวม 0 และไม่ใช่ช่องปิดรับ (ตรงโปรแกรมอ้างอิง) */
  const unsoldNumbers = rawDist.filter(d => d.total <= 0 && !d.is_blocked).length;
  const sentNumbers = chartData.filter(d => (d.newCut + d.sentCut) > 0).length;
  /** เลขยอดเกิน / ไม่เกิน = เทียบยอดรวมต่อเลขกับเส้นเก็บ ครบทุกช่องใน distribution (ไม่ใช่คอลัมน์จำนวนเก็บในตาราง %) */
  const overThresholdNumbers =
    activeThreshold > 0
      ? rawDist.filter((d) => d.total > activeThreshold).length
      : rawDist.filter((d) => d.total > 0 && !d.is_blocked).length;
  const underThresholdNumbers =
    activeThreshold > 0
      ? rawDist.filter((d) => d.total <= activeThreshold).length
      : rawDist.filter((d) => d.total <= 0 || d.is_blocked).length;
  const minSingleBet = rangeResult?.min_single_bet ?? 0;

  // ── Dealer change handler (from cut page top bar)
  const handleDealerChange = useCallback(async (dealerId: string) => {
    if (!selectedRoundId) return;
    try {
      await roundsApi.setDealer(selectedRoundId, dealerId || null);
      const found = dealers.find(x => x.id === dealerId);
      setDealerName(found?.name ?? null);
      setSelectedDealerId(dealerId);
      await fetchRoundDealer();
      fetchRangeSim();
    } catch (err) {
      showApiError(err, 'เปลี่ยนเจ้ามือไม่สำเร็จ');
    }
  }, [selectedRoundId, dealers, fetchRoundDealer, fetchRangeSim]);

  useEffect(() => {
    if (!selectedRoundId || selectedDealerId) return;
    const firstActive = dealers.find(d => d.is_active);
    if (!firstActive) return;
    handleDealerChange(firstActive.id);
  }, [selectedRoundId, selectedDealerId, dealers, handleDealerChange]);

  // ── Header stats
  const round = rounds.find(r => r.id === selectedRoundId);

  return (
    <AppShell>
      <div className="h-full min-h-0 flex flex-col overflow-hidden min-w-0 w-full max-w-full">
      <Header title="ตัดหวย" subtitle={round ? `งวด ${round.name}` : 'เลือกงวดเพื่อเริ่ม'} />

      <main className="flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden">
        <CutToolbar
          roundsForPicker={roundsForPicker}
          selectedRoundId={selectedRoundId}
          setSelectedRoundId={setSelectedRoundId}
          isAdmin={isAdmin}
          cutIncludeArchived={cutIncludeArchived}
          setCutIncludeArchived={setCutIncludeArchived}
          dealers={dealers}
          selectedDealerId={selectedDealerId}
          handleDealerChange={handleDealerChange}
          dealerParams={dealerParams}
          activeBetType={activeBetType}
          setActiveBetType={setActiveBetType}
          sentBetTypeSet={sentBetTypeSet}
          rangeResult={rangeResult}
          selectedRowIdx={selectedRowIdx}
          setSearchOpen={setSearchOpen}
          setSmartCutOpen={setSmartCutOpen}
          setRangeTableOpen={setRangeTableOpen}
          setPendingRangeIdx={setPendingRangeIdx}
        />
        {/* ── Main body: ซ้าย = กราฟ / ขวา = รายการส่ง (ลากขอบปรับความกว้างได้บนจอใหญ่) ── */}
        <div
          ref={splitLayoutRef}
          className={cn(
            'flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden',
            sideBySideLayout && 'flex-row',
          )}
        >

          <CutRiskPanel
            selectedRoundId={selectedRoundId}
            committedThreshold={committedThreshold}
            rangeResult={rangeResult}
            rangeLoading={rangeLoading}
            activeBetType={activeBetType}
            activeThreshold={activeThreshold}
            manualThreshold={manualThreshold}
            setManualThreshold={setManualThreshold}
            selectedRowIdx={selectedRowIdx}
            setSelectedRowIdx={setSelectedRowIdx}
            keepPerInputStr={keepPerInputStr}
            setKeepPerInputStr={setKeepPerInputStr}
            keepPerInputFocusedRef={keepPerInputFocusedRef}
            chartData={chartData}
            chartHeight={chartHeight}
            setChartHeight={setChartHeight}
            chartSortMode={chartSortMode}
            setChartSortMode={setChartSortMode}
            setChartFullscreen={setChartFullscreen}
            chartHasKeptSegment={chartHasKeptSegment}
            totalAlreadySent={totalAlreadySent}
            chartContainerRef={chartContainerRef}
            handleChartAreaClick={handleChartAreaClick}
            handleChartClick={handleChartClick}
            avgChartTotal={avgChartTotal}
            topChartNumbers={topChartNumbers}
            lowChartNumbers={lowChartNumbers}
            chartBarMountKey={chartBarMountKey}
            avgLineMountKey={avgLineMountKey}
            hoveredChartNumber={hoveredChartNumber}
            setHoveredChartNumber={setHoveredChartNumber}
            yScaleRef={yScaleRef}
            yAxisOffsetRef={yAxisOffsetRef}
            s={s}
            totalSend={totalSend}
            totalRevenue={totalRevenue}
            overThresholdNumbers={overThresholdNumbers}
            underThresholdNumbers={underThresholdNumbers}
            unsoldNumbers={unsoldNumbers}
            sentNumbers={sentNumbers}
            minSingleBet={minSingleBet}
            stagedCuts={stagedCuts}
            cutItems={cutItems}
            linePngBusy={linePngBusy}
            setPdfOpen={setPdfOpen}
            handleDownloadPendingSlipPng={handleDownloadPendingSlipPng}
            setStagedCuts={setStagedCuts}
          />
          {/* แถบลากปรับความกว้าง */}
          <div
            role="separator"
            aria-orientation="vertical"
            title={
              rightPanelLocked
                ? 'ปลดล็อกความกว้าง (ปุ่ม 🔓 ด้านบน) เพื่อลากปรับ'
                : 'ลากซ้าย-ขวาเพื่อปรับความกว้าง · ปล่อยเมาส์แล้วจำค่าไว้'
            }
            onMouseDown={(e) => {
              if (!sideBySideLayout || rightPanelLocked) return;
              e.preventDefault();
              rightResizeDrag.current = { startX: e.clientX, startW: rightPanelPx };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            className={cn(
              'w-1.5 shrink-0 transition-colors select-none',
              sideBySideLayout ? 'block' : 'hidden',
              rightPanelLocked ? 'cursor-default opacity-50' : 'cursor-col-resize',
              sideBySideLayout && !rightPanelLocked ? 'hover:bg-accent/35 bg-border/90' : 'bg-border/90',
            )}
          />

          <CutSendBatchesPanel
            sideBySideLayout={sideBySideLayout}
            rightPanelPx={rightPanelPx}
            sendBatches={sendBatches}
            selectedBatchIds={selectedBatchIds}
            setSelectedBatchIds={setSelectedBatchIds}
            totalSentAllBatches={totalSentAllBatches}
            deletingBatchId={deletingBatchId}
            handleDeleteAllBatches={handleDeleteAllBatches}
            fetchSendBatches={fetchSendBatches}
            rightPanelLocked={rightPanelLocked}
            setRightPanelLocked={setRightPanelLocked}
            setViewBatch={setViewBatch}
            selectedRoundId={selectedRoundId}
            selectedDealerId={selectedDealerId}
            savingBatch={savingBatch}
            stagedCuts={stagedCuts}
            cutItems={cutItems}
            handleSaveBatch={handleSaveBatch}
            handleDeleteSendSelection={handleDeleteSendSelection}
            handlePrintSentBatches={handlePrintSentBatches}
            linePngBusy={linePngBusy}
            handleDownloadSentBatchesPng={handleDownloadSentBatchesPng}
            pendingQueueRows={pendingQueueRows}
            handleStageCurrentCuts={handleStageCurrentCuts}
            setStagedCuts={setStagedCuts}
            setManualThreshold={setManualThreshold}
            setSelectedRowIdx={setSelectedRowIdx}
            lastManualByTypeRef={lastManualByTypeRef}
          />
        </div>
      </main>

      {/* Smart Cut dialog */}
      <AnimatePresence>
        {smartCutOpen && rangeResult && (
          <CutSmartCutDialog
            rows={rangeResult.rows}
            totalRevenue={rangeResult.total_revenue}
            onClose={() => setSmartCutOpen(false)}
            onApply={(rowIdx, threshold) => {
              setSelectedRowIdx(rowIdx);
              setManualThreshold(threshold);
              setTimeout(() => {
                tableBodyRef.current?.querySelector(`[data-row="${rowIdx}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 80);
            }}
          />
        )}
      </AnimatePresence>

      {/* Search dialog */}
      <AnimatePresence>
        {searchOpen && (
          <CutSearchDialog
            onClose={() => setSearchOpen(false)}
            onConfirm={(mode, value) => { handleSearch(mode, value); setSearchOpen(false); }}
          />
        )}
      </AnimatePresence>

      {/* Save + dealer selection modal */}
      <AnimatePresence>
        {showSaveModal && (
          <SaveDealerModal
            dealers={dealers}
            activeBetType={activeBetType}
            initialDealerId={selectedDealerId}
            betTypeLabel={BET_TYPE_SHORT[activeBetType]}
            totalSend={totalSend}
            cutItemsCount={cutItems.length}
            saving={savingBatch}
            onClose={() => setShowSaveModal(false)}
            onConfirm={handleSaveBatch}
          />
        )}
      </AnimatePresence>

      {/* PDF dialog — always prints current pending list */}
      <AnimatePresence>
        {pdfOpen && (
          <CutPdfDialog
            roundName={round?.name ?? ''}
            betType={activeBetType}
            dealerName={dealerName ?? '—'}
            threshold={activeThreshold}
            cutItems={cutItems}
            totalSend={totalSend}
            totalRevenue={totalRevenue}
            stats={effectiveStats}
            onClose={() => setPdfOpen(false)}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {viewBatch && (
          <SendBatchItemsModal
            batch={viewBatch}
            onClose={() => setViewBatch(null)}
          />
        )}
      </AnimatePresence>
      {/* Chart fullscreen overlay */}
      <AnimatePresence>
        {chartFullscreen && rangeResult && chartData.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-[var(--color-backdrop-overlay)] flex items-center justify-center p-4"
            onClick={() => setChartFullscreen(false)}>
            <motion.div
              ref={chartDialogRef}
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              role="dialog" aria-modal="true" aria-label="การกระจายยอดแทง — เต็มจอ"
              tabIndex={-1}
              className="border border-[var(--chart-neutral-light)] rounded-xl shadow-[var(--shadow-hover)] w-full max-w-[96vw] flex flex-col overflow-hidden bg-[var(--color-surface)] focus:outline-none"
              style={{ height: '90vh' }}
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-5 py-3 border-b border-[var(--chart-neutral-light)] flex items-center justify-between shrink-0 bg-[var(--bg-glass-subtle)]">
                <span className="font-semibold text-[var(--text-primary)] text-sm" style={{ fontFamily: 'var(--font-inter), var(--font-thai), system-ui, sans-serif' }}>{BET_TYPE_LABELS[activeBetType]} — การกระจายยอดแทง (เต็มจอ)</span>
                <div className="flex items-center gap-3 text-xs">
                  {activeThreshold > 0 && <ThresholdPerNumberPill amount={activeThreshold} />}
                  <button type="button" onClick={() => setChartFullscreen(false)} aria-label="ปิด"
                    className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors text-xl leading-none ml-2">✕</button>
                </div>
              </div>
              {/* Chart */}
              <div className="flex-1 min-h-0 p-4 overflow-x-auto bg-[var(--color-surface)] rounded-b-xl">
                <CutStackedBarChart
                  variant="fullscreen"
                  chartData={chartData}
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
                />
              </div>
              {/* Footer legend */}
              <div className="px-5 py-2.5 border-t border-[var(--chart-neutral-light)] flex items-center gap-4 text-xs text-[var(--text-secondary)] font-medium shrink-0 bg-[var(--bg-glass-subtle)]">
                {chartHasKeptSegment && (
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-kept)] ring-1 ring-black/10 inline-block"/>เก็บ</span>
                )}
                {totalAlreadySent > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-sent)] ring-1 ring-black/10 inline-block"/>ส่งแล้ว</span>}
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-new)] ring-1 ring-black/10 inline-block"/>ตัดเพิ่ม</span>
                <span className="ml-auto text-[11px] text-[var(--text-secondary)]">คลิกพื้นที่ด้านนอกเพื่อปิด</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Range table dialog */}
      <AnimatePresence>
        {rangeTableOpen && rangeResult && rangeResult.rows.length > 0 && (
          <CutRangeTableModal
            rangeResult={rangeResult}
            stepPct={stepPct}
            setStepPct={setStepPct}
            rangeLoading={rangeLoading}
            pendingRangeIdx={pendingRangeIdx}
            setPendingRangeIdx={setPendingRangeIdx}
            committedThreshold={committedThreshold}
            tableBodyRef={tableBodyRef}
            onClose={() => setRangeTableOpen(false)}
            onConfirm={(rowIdx, clamped) => {
              setManualThreshold(clamped);
              setSelectedRowIdx(rowIdx);
              setRangeTableOpen(false);
              setTimeout(() => {
                tableBodyRef.current?.querySelector(`[data-row="${rowIdx}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
              }, 80);
            }}
          />
        )}
      </AnimatePresence>
      </div>
    </AppShell>
  );
}

export default function CutPage() {
  return (
    <Suspense>
      <CutPageInner />
    </Suspense>
  );
}
