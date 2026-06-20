'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useFocusTrap } from '@/lib/useFocusTrap';
import { useConfirm } from '@/components/ui/ConfirmDialog';
import { useQueryClient } from '@tanstack/react-query';
import { roundsApi, betsApi, customersApi } from '@/lib/api';
import { useRoundsQuery } from '@/hooks/queries/useRoundsQuery';
import { APP_BRAND_NAME } from '@/lib/brand';
import { Bet, Customer, BET_TYPE_LABELS } from '@/types';
import { useAppStore, useAuthStore } from '@/store/useStore';
import { wsClient } from '@/lib/websocket';
import {
  parseBetLine, expandNumberInput,
  parseLineBetsTextWithSegments, parsePdfBetsText, normalizeLinePasteText,
} from '@/lib/betParser';
import { AppShell } from '@/components/layout/AppShell';
import { BetKeyInputPanel, type BetKeyInputHandle } from '@/components/bets/BetKeyInputPanel';
import { BetSummaryPanel } from '@/components/bets/BetSummaryPanel';
import { BetSheetEditableGrid } from '@/components/bets/BetSheetEditableGrid';
import { BetLineImportModal } from '@/components/bets/BetLineImportModal';
import { BetMoveSheetModal } from '@/components/bets/BetMoveSheetModal';
import { useBetFetcher } from '@/hooks/useBetFetcher';
import { useBetsQuery, EMPTY_BETS } from '@/hooks/queries/useBetsQuery';
import { BetsErrorBoundary } from '@/components/bets/BetsErrorBoundary';
import { useBetOcr, type LineOcrEngineChoice } from '@/hooks/useBetOcr';
import { showApiError } from '@/lib/apiErrorToast';
import {
  COL_TYPES,
  buildRowFromBets,
  groupByEntry,
  sortBetSheetGroups,
  betSheetGroupKey,
  groupBetTimestamps,
  keyerChipClasses,
  aggregateKeyer,
  formatPrintItem,
  buildPrintLine,
  type BetSheetGroup,
  type PrintItem,
} from '@/lib/bets/betSheetGroups';
import { getEffectiveRate } from '@/lib/bets/betRates';
import {
  type BulkBetsResponse,
  type ChangeMarker,
  summarizeBulkBetsResponse,
  markerFromInsertedBets,
} from '@/lib/bets/betBulkResponse';
import { openBetSheetPrintPreview, exportBetSheetsCsv } from '@/lib/bets/betPrintSlip';
import {
  readVoiceAuditMode,
  writeVoiceAuditMode,
  readVoiceAuditRate,
  writeVoiceAuditRate,
  readVoiceAuditCheckpoint,
  writeVoiceAuditCheckpoint,
  clearVoiceAuditCheckpoint,
  readBetsPageZoom,
  writeBetsPageZoom,
} from '@/lib/bets/voiceAuditPrefs';
import {
  readBetSheetSort,
  writeBetSheetSort,
  type BetSheetSortOrder,
} from '@/lib/betSheetSort';
import {
  playSaveBet,
  playImportSuccess,
  playError,
  playBlockedNumberAlarm,
  playExpansionWarning,
  isBlockedBetApiMessage,
  speak,
  speakVoiceAudit,
  buildVoiceAuditLine,
  cancelSpeech,
} from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { buildWinningKeysFromResultData, groupTouchesWinningDraw } from '@/lib/drawWinning';
import {
  readPanelWidth,
  writePanelWidth,
  readPanelLock,
  STORAGE_BETS_RIGHT_PANEL_W,
  STORAGE_BETS_RIGHT_PANEL_LOCK,
} from '@/lib/panelResize';
import {
  mergeBetsIntoCache,
  removeBetsFromCache,
  replaceBetsInCache,
  invalidateRoundBets,
} from '@/lib/bets/betQueryCache';

function matchesSearch(number: string, q: string): boolean {
  const trimQ = q.trim();
  if (!trimQ) return false;
  return number === trimQ;
}

const LINE_OCR_ENGINE_STORAGE_KEY = 'cuthuay-line-ocr-engine';

function readInitialLineOcrEngine(): LineOcrEngineChoice {
  if (typeof window === 'undefined') return 'auto';
  try {
    const v = localStorage.getItem(LINE_OCR_ENGINE_STORAGE_KEY);
    if (v === 'google-vision' || v === 'paddle' || v === 'browser' || v === 'auto') return v;
  } catch {
    /* localStorage blocked */
  }
  return 'auto';
}

export default function BetsPage() {
  return (
    <AppShell>
      <BetsErrorBoundary>
        <BetsPageContent />
      </BetsErrorBoundary>
    </AppShell>
  );
}

function BetsPageContent() {
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data: rounds = [] } = useRoundsQuery();
  /** ค่าเริ่มต้น: เลือกได้เฉพาะงวด open — ติ๊กเพิ่มเพื่อแสดมงวดปิด/ออกผล (ไม่รวม archived) */
  const [roundPickerShowAll, setRoundPickerShowAll] = useState(false);
  const [selectedRoundId, setSelectedRoundId]       = useState('');
  /** โพยที่ตรงผลรางวัลแล้ว — ใช้ไฮไลต์แถวในตาราง */
  const [roundDrawWinKeys, setRoundDrawWinKeys]     = useState<Set<string>>(() => new Set());
  const [customers, setCustomers]                   = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const { queueSilentFetchFromWs: queueWsReload, invalidateBets } = useBetFetcher(selectedRoundId);
  const {
    data: roundBetsData,
    isLoading: roundBetsLoading,
    refetch: refetchRoundBets,
  } = useBetsQuery(selectedRoundId, undefined, Boolean(selectedRoundId), {
    staleTime: 30_000,
    keepPrevious: true,
  });
  const roundBets = roundBetsData ?? EMPTY_BETS;
  const {
    data: customerRoundBetsData,
    isLoading: customerBetsLoading,
    isFetching: customerBetsFetching,
    isSuccess: customerBetsSuccess,
    refetch: refetchCustomerBets,
  } = useBetsQuery(
    selectedRoundId,
    selectedCustomerId,
    Boolean(selectedRoundId && selectedCustomerId),
    { keepPrevious: true },
  );
  const customerRoundBets = customerRoundBetsData ?? EMPTY_BETS;
  const loading = roundBetsLoading || customerBetsLoading;
  const [isSaving, setIsSaving]       = useState(false);
  const setSelectedRound              = useAppStore((s) => s.setSelectedRound);
  const isAdmin                       = useAuthStore((s) => s.user?.role === 'admin');
  const canMutate                     = useAuthStore((s) => s.user?.role !== 'viewer');

  const keyInputRef = useRef<BetKeyInputHandle>(null);
  const inputActivityRef = useRef({ hasNum: false, hasAmt: false });
  const [numWidth, setNumWidth]       = useState(176);
  const [inputFs, setInputFs]         = useState(48);   // font-size px for the two main inputs
  const [rowFs]                       = useState(12);    // px — scale เพิ่มจากซูมทั้งหน้า (A− / A+)
  const [sumFs, setSumFs]             = useState(12);    // font-size px for the right summary panel
  /** ซูมทั้งหน้ารับแทง — ปุ่ม «ขนาด» A− / A+ ด้านล่างโพย (ค่าจริงโหลดจาก localStorage หลัง mount) */
  const [betsPageZoomPercent, setBetsPageZoomPercent] = useState(100);
  /** แผงขวา (สรุปยอด) — ลากขอบซ้ายของแผงปรับความกว้าง บนจอ ≥xl */
  const liveRightPanelWRef              = useRef(288);
  const [rightPanelPx, setRightPanelPx] = useState(288);
  const [rightPanelLocked, setRightPanelLocked] = useState(false);
  const [betsPrefsHydrated, setBetsPrefsHydrated] = useState(false);
  const rightResizeDrag                 = useRef<{ startX: number; startW: number } | null>(null);
  const [soundOn, setSoundOn]         = useState(true);  // เปิด/ปิดเสียง TTS
  const [speechRate, setSpeechRate]   = useState(2.2);   // ความเร็วเสียงพูด
  /** พูดเลข–ยอดเมื่อโฟกัสแถว แล้วเลื่อนถัดไปหลังพูดจบ */
  const [voiceAuditMode, setVoiceAuditMode] = useState(false);
  /** ความเร็วพูดเฉพาะโหมดตรวจด้วยเสียง (ไม่ผูกกับความเร็วตอนคีย์โพย) */
  const [voiceAuditRate, setVoiceAuditRate] = useState(2.65);
  /** หยุดชั่วคราว — ไม่เลื่อนแถวถัดไปจนกดเล่น */
  const [voiceAuditPaused, setVoiceAuditPaused] = useState(false);
  /** บังคับเริ่มพูดแถวปัจจุบันใหม่ (หลังกดเล่นเมื่อไม่มีคิว pause ค้าง) */
  const [voiceAuditNonce, setVoiceAuditNonce] = useState(0);
  const [sheet, setSheet]             = useState(1);
  const [maxSheets, setMaxSheets]     = useState(1);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const lastClickedIdxRef = useRef<number>(-1);
  const [focusedIdx, setFocusedIdx] = useState<number>(-1);
  const [editInlineKey, setEditInlineKey]       = useState<string | null>(null);
  const [editInlineCreatedAt, setEditInlineCreatedAt] = useState('');
  const skipNextScrollRef = useRef(false);
  const preserveScrollRef = useRef<number | null>(null);
  const preserveScrollPassesRef = useRef(0);
  const [moveModal, setMoveModal]     = useState(false);
  const [moveTarget, setMoveTarget]   = useState(1);
  const [moveTargetCustomerId, setMoveTargetCustomerId] = useState<string>('__same__');
  /** แผ่นสูงสุดของลูกค้าอื่น (โหลดเมื่อเปิด modal ย้าย) */
  const [moveOtherCustomerMaxSheet, setMoveOtherCustomerMaxSheet] = useState(1);
  const [lineModal, setLineModal]     = useState(false);
  const [lineText, setLineText]       = useState('');
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null);
  /** ไฮไลต์แถวจากการนำเข้าไลน์ล่าสุด (import_batch_id เดียวกัน) */
  const [lineImportHighlightBatchId, setLineImportHighlightBatchId] = useState<string | null>(null);
  /** หลังนำเข้าสำเร็จแผงไลน์หุบ — แจ้งผลที่โต๊ะหลัก */
  const [lineImportToast, setLineImportToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [lineOcrEngine, setLineOcrEngine] = useState<LineOcrEngineChoice>(() => readInitialLineOcrEngine());
  const {
    ocrLoading,
    ocrError,
    setOcrError,
    imageOcrSource,
    setImageOcrSource,
    ocrServerFallbackNote,
    setOcrServerFallbackNote,
    handleImageFile,
  } = useBetOcr(lineOcrEngine, setLineText);
  const [imgDragOver, setImgDragOver] = useState(false);
  const [pdfLoading, setPdfLoading]   = useState(false);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [searchQ, setSearchQ]         = useState('');
  const [activeSearchMatchPos, setActiveSearchMatchPos] = useState(-1);
  const [betSheetSort, setBetSheetSort] = useState<BetSheetSortOrder>('newestFirst');
  const [recentChangedMarker, setRecentChangedMarker] = useState<ChangeMarker | null>(null);
  const [recentChangedKey, setRecentChangedKey] = useState<string | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvExportMode, setCsvExportMode] = useState<'separate' | 'combined'>('separate');
  const csvDialogRef = useFocusTrap(csvModalOpen, () => setCsvModalOpen(false));
  const [slipPdfExporting, setSlipPdfExporting] = useState(false);
  /** เลขปิดรับของงวด (all + ลูกค้าที่เลือก) — ตรวจก่อนยิง API */
  const [blockedLimitKeys, setBlockedLimitKeys] = useState<Set<string>>(new Set());

  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  /** รวมรีเฟรชจาก WebSocket หลังบันทึกเอง — กันสองรอบติดกันดีด scroll / กระพริบตาราง */
  const isDragging     = useRef(false);
  const soundOnRef     = useRef(true);
  const speechRateRef  = useRef(2.2);
  const voiceAuditModeRef = useRef(false);
  const voiceAuditRateRef = useRef(2.65);
  const voiceAuditPausedRef = useRef(false);
  const voiceAuditRestoreKeyRef = useRef('');

  // keep refs in sync with state
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);
  useEffect(() => { voiceAuditModeRef.current = voiceAuditMode; }, [voiceAuditMode]);
  useEffect(() => { voiceAuditRateRef.current = voiceAuditRate; }, [voiceAuditRate]);
  useEffect(() => { voiceAuditPausedRef.current = voiceAuditPaused; }, [voiceAuditPaused]);

  /** โหลด prefs จาก localStorage หลัง mount — กัน hydration mismatch + voice audit loop ตอน refresh */
  useEffect(() => {
    const zoom = readBetsPageZoom();
    const panelW = readPanelWidth(STORAGE_BETS_RIGHT_PANEL_W, 288);
    const panelLock = readPanelLock(STORAGE_BETS_RIGHT_PANEL_LOCK);
    const auditOn = readVoiceAuditMode();
    const auditRate = readVoiceAuditRate();
    const sheetSort = readBetSheetSort();

    setBetsPageZoomPercent(zoom);
    liveRightPanelWRef.current = panelW;
    setRightPanelPx(panelW);
    setRightPanelLocked(panelLock);
    setBetSheetSort(sheetSort);
    setVoiceAuditRate(auditRate);
    voiceAuditRateRef.current = auditRate;
    setVoiceAuditMode(auditOn);
    voiceAuditModeRef.current = auditOn;
    if (auditOn) {
      voiceAuditPausedRef.current = true;
      setVoiceAuditPaused(true);
    }
    setBetsPrefsHydrated(true);
  }, []);

  /** รีเซ็ต pause เฉพาะตอนปิดโหมด (true→false) — อย่ารีเซ็ตตอน mount ก่อน hydrate ไม่งั้น paused จาก localStorage ถูกทับ */
  const prevVoiceAuditModeRef = useRef(voiceAuditMode);
  useEffect(() => {
    const prev = prevVoiceAuditModeRef.current;
    prevVoiceAuditModeRef.current = voiceAuditMode;
    if (prev && !voiceAuditMode) {
      voiceAuditPausedRef.current = false;
      setVoiceAuditPaused(false);
      setVoiceAuditNonce(0);
      voiceAuditRestoreKeyRef.current = '';
    }
  }, [voiceAuditMode]);

  useEffect(() => {
    if (!lineImportHighlightBatchId) return;
    const t = window.setTimeout(() => setLineImportHighlightBatchId(null), 3 * 60 * 1000);
    return () => clearTimeout(t);
  }, [lineImportHighlightBatchId]);

  useEffect(() => {
    if (!lineImportToast) return;
    const t = window.setTimeout(() => setLineImportToast(null), 6000);
    return () => clearTimeout(t);
  }, [lineImportToast]);

  useEffect(() => {
    if (!lineModal) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setLineModal(false);
        setImportResult(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lineModal]);

  useEffect(() => {
    liveRightPanelWRef.current = rightPanelPx;
  }, [rightPanelPx]);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = rightResizeDrag.current;
      if (!d) return;
      const next = Math.min(580, Math.max(260, Math.round(d.startW - (e.clientX - d.startX))));
      liveRightPanelWRef.current = next;
      setRightPanelPx(next);
    };
    const onUp = () => {
      const wasDrag = rightResizeDrag.current != null;
      rightResizeDrag.current = null;
      document.body.style.removeProperty('cursor');
      document.body.style.removeProperty('user-select');
      if (wasDrag) writePanelWidth(STORAGE_BETS_RIGHT_PANEL_W, liveRightPanelWRef.current);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  const sheetGroupedRef = useRef<BetSheetGroup[]>([]);
  const scrollRowIntoView = (idx: number, block: ScrollLogicalPosition = 'nearest') => {
    requestAnimationFrame(() => {
      tableScrollRef.current
        ?.querySelector<HTMLElement>(`[data-row-idx="${idx}"]`)
        ?.scrollIntoView({ block, behavior: 'auto' });
    });
  };
  const holdCurrentScrollPosition = useCallback((passes = 12) => {
    preserveScrollRef.current = tableScrollRef.current?.scrollTop ?? 0;
    preserveScrollPassesRef.current = passes;
  }, []);
  const findGroupIndexByMarker = useCallback((groups: BetSheetGroup[], marker: ChangeMarker | null) => {
    if (!marker) return -1;
    return groups.findIndex(group => {
      if (group.number !== marker.number) return false;
      const g0 = group.bets[0];
      if (marker.importBatchId != null && String(marker.importBatchId).length > 0 && g0?.import_batch_id) {
        return (
          g0.import_batch_id === marker.importBatchId &&
          Number(g0.segment_index ?? 0) === Number(marker.segmentIndex ?? 0)
        );
      }
      if (
        (marker.importBatchId == null || String(marker.importBatchId).length === 0) &&
        (g0?.import_batch_id == null || String(g0.import_batch_id).length === 0) &&
        (marker.segmentIndex ?? 0) > 0
      ) {
        return Number(g0?.segment_index ?? 0) === Number(marker.segmentIndex ?? 0);
      }
      return (
        group.sortOrder === marker.sortOrder ||
        Math.abs(Number(group.sortOrder) - Number(marker.sortOrder)) < 1e-3
      );
    });
  }, []);

  // Escape / เลื่อนแถวโฟกัส (↓↑ Enter) — อนุญาตลูกศรในช่องเลข·ราคาเพื่อไล่ตรวจทีละบรรทัด
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (editInlineKey) {
          setEditInlineKey(null);
          setEditInlineCreatedAt('');
          keyInputRef.current?.clearInputs();
        } else {
          setSelectedGroups(new Set());
          lastClickedIdxRef.current = -1;
          setFocusedIdx(-1);
        }
        return;
      }

      const ae = document.activeElement as HTMLElement | null;
      const tag = ae?.tagName ?? '';
      const inputEl = tag === 'INPUT' ? (ae as HTMLInputElement) : null;
      const inputHandle = keyInputRef.current;
      const isOurBetInput =
        inputHandle != null &&
        (ae === inputHandle.getNumElement() || ae === inputHandle.getAmtElement());
      const isSheetRowCheckbox =
        inputEl?.type === 'checkbox' &&
        ae?.closest?.('[data-bet-sheet-table]') != null;

      if (tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (tag === 'INPUT' && !isOurBetInput && !isSheetRowCheckbox) return;

      const rowNavFromKeys = () => {
        e.preventDefault();
        setFocusedIdx((prev) => {
          const len = sheetGroupedRef.current.length;
          if (len === 0) return prev;
          const delta = e.key === 'ArrowUp' ? -1 : 1;
          let base = prev;
          if (base < 0) base = delta > 0 ? -1 : 0;
          const next =
            delta > 0 ? Math.min(base + 1, len - 1) : Math.max(base - 1, 0);
          scrollRowIntoView(next);
          return next;
        });
      };

      if (
        (e.key === 'ArrowDown' || e.key === 'ArrowUp') &&
        !e.altKey &&
        !e.metaKey
      ) {
        rowNavFromKeys();
        return;
      }

      // Enter = แถวถัดไป — ยกเว้นช่องเลข/ราคา (ใช้ commit / ย้ายโฟกัสเอง)
      if (e.key === 'Enter' && !e.altKey && !e.metaKey) {
        if (isOurBetInput) return;
        rowNavFromKeys();
        return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [editInlineKey]);

  // เมื่อโหมดล่าสุดล่าง: หลังข้อมูลเปลี่ยนให้เลื่อนลงล่าง (รายการใหม่อยู่ล่าง)
  // โหมดล่าสุดบน: อย่าดึงสกอร์ไปล่าง — ให้เห็นแถวบนสุด / recentChangedMarker จัดให้
  useEffect(() => {
    if (preserveScrollRef.current !== null) {
      const top = preserveScrollRef.current;
      skipNextScrollRef.current = false;
      requestAnimationFrame(() => {
        if (tableScrollRef.current) tableScrollRef.current.scrollTop = top;
      });
      if (preserveScrollPassesRef.current > 0) preserveScrollPassesRef.current -= 1;
      if (preserveScrollPassesRef.current <= 0) preserveScrollRef.current = null;
      return;
    }
    if (skipNextScrollRef.current) { skipNextScrollRef.current = false; return; }
    if (tableScrollRef.current && betSheetSort === 'oldestFirst') {
      tableScrollRef.current.scrollTop = tableScrollRef.current.scrollHeight;
    }
  }, [customerRoundBets, betSheetSort]);

  // สลับโหมดเรียงเวลา → เลื่อนไปฝั่งที่มีรายการล่าสุด (บนหรือล่าง)
  useEffect(() => {
    requestAnimationFrame(() => {
      const el = tableScrollRef.current;
      if (!el) return;
      if (betSheetSort === 'newestFirst') {
        el.scrollTop = 0;
      } else {
        el.scrollTop = el.scrollHeight;
      }
    });
  }, [betSheetSort]);

  // สลับลูกค้าหรือแผ่น — savedBets ไม่เปลี่ยน effect ด้านบนจึงไม่เลื่อน; ค้างที่สกอร์เดิมทับโพยคนอื่น
  useEffect(() => {
    if (searchQ.trim()) return;
    preserveScrollRef.current = null;
    preserveScrollPassesRef.current = 0;
    skipNextScrollRef.current = false;
    const apply = () => {
      const el = tableScrollRef.current;
      if (!el) return;
      if (betSheetSort === 'oldestFirst') {
        el.scrollTop = el.scrollHeight;
      } else {
        el.scrollTop = 0;
      }
      const groups = sheetGroupedRef.current;
      const len = groups.length;
      if (len > 0) {
        const idx = betSheetSort === 'oldestFirst' ? len - 1 : 0;
        setFocusedIdx(idx);
      } else {
        setFocusedIdx(-1);
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(apply);
    });
  }, [selectedCustomerId, sheet, searchQ]);

  const tts = (text: string) => { if (soundOnRef.current) speak(text, speechRateRef.current); };

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startW = numWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      setNumWidth(Math.max(100, Math.min(400, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  /** งวดปิด/ออกผล — เฉพาะ admin ติ๊กได้ */
  const showClosedRoundsInPicker = Boolean(isAdmin && roundPickerShowAll);
  useEffect(() => {
    if (!isAdmin) setRoundPickerShowAll(false);
  }, [isAdmin]);

  const roundsForPicker = showClosedRoundsInPicker
    ? rounds.filter((r) => r.status !== 'archived')
    : rounds.filter((r) => r.status === 'open');

  useEffect(() => {
    const pool = showClosedRoundsInPicker
      ? rounds.filter((r) => r.status !== 'archived')
      : rounds.filter((r) => r.status === 'open');
    setSelectedRoundId((prev) => {
      if (!pool.length) return prev ? '' : prev;
      if (prev && pool.some((r) => r.id === prev)) return prev;
      return pool[0].id;
    });
  }, [rounds, showClosedRoundsInPicker]);

  const refreshBetsAfterMutation = useCallback(async () => {
    invalidateRoundBets(queryClient, selectedRoundId);
    await Promise.all([refetchRoundBets(), refetchCustomerBets()]);
  }, [queryClient, selectedRoundId, refetchRoundBets, refetchCustomerBets]);

  const patchAfterBulkInsert = useCallback(
    (apiBets: Bet[] | undefined) => {
      if (apiBets?.length) {
        mergeBetsIntoCache(queryClient, selectedRoundId, apiBets);
        return true;
      }
      return false;
    },
    [queryClient, selectedRoundId],
  );

  const patchAfterBulkDelete = useCallback(
    (ids: string[]) => {
      if (ids.length) {
        removeBetsFromCache(queryClient, selectedRoundId, ids);
        return true;
      }
      return false;
    },
    [queryClient, selectedRoundId],
  );

  const patchAfterReplace = useCallback(
    (removedIds: string[], apiBets: Bet[] | undefined) => {
      if (apiBets?.length) {
        replaceBetsInCache(queryClient, selectedRoundId, removedIds, apiBets);
        return true;
      }
      if (removedIds.length) {
        removeBetsFromCache(queryClient, selectedRoundId, removedIds);
        return true;
      }
      return false;
    },
    [queryClient, selectedRoundId],
  );

  const queueSilentFetchFromWs = useCallback(() => {
    invalidateBets();
    queueWsReload();
  }, [queueWsReload, invalidateBets]);

  const fetchCustomers = useCallback(async () => {
    const res = await customersApi.list();
    setCustomers(res.data.customers);
  }, []);

  useEffect(() => { fetchCustomers(); }, []);
  // Auto-select first customer when list loads and none is selected
  useEffect(() => {
    if (customers.length > 0 && !selectedCustomerId) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers]);
  useEffect(() => {
    const round = rounds.find(r => r.id === selectedRoundId) ?? null;
    const current = useAppStore.getState().selectedRound;
    if (current?.id === round?.id) return;
    setSelectedRound(round);
  }, [selectedRoundId, rounds, setSelectedRound]);

  const selectedRoundStatus = rounds.find((r) => r.id === selectedRoundId)?.status;

  useEffect(() => {
    if (!selectedRoundId) {
      setRoundDrawWinKeys(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await roundsApi.getResult(selectedRoundId);
        const raw = (res.data as { result_data?: unknown } | undefined)?.result_data;
        if (cancelled) return;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          setRoundDrawWinKeys(buildWinningKeysFromResultData(raw as Record<string, unknown>));
        } else {
          setRoundDrawWinKeys(new Set());
        }
      } catch {
        if (!cancelled) setRoundDrawWinKeys(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRoundId, selectedRoundStatus]);

  useEffect(() => {
    const u1 = wsClient.on('bet_added',       queueSilentFetchFromWs);
    const u2 = wsClient.on('bets_bulk_added', queueSilentFetchFromWs);
    const u3 = wsClient.on('bet_deleted',     queueSilentFetchFromWs);
    return () => {
      u1(); u2(); u3();
    };
  }, [queueSilentFetchFromWs]);

  /** เลือกแผ่นล่าสุดของลูกค้าเมื่อ «เปลี่ยนลูกค้า» เท่านั้น — อย่ากระโดดแผ่นทุกครั้งที่ refresh savedBets (แก้ไขเลข / WS)
   * เมื่อโหลดโพยครั้งแรกของลูกค้าที่เลือก (savedBets ว่างแล้วมีข้อมูล) ให้ไปแผ่นล่าสุดครั้งเดียว */
  const prevCustomerIdForSheetRef = useRef(selectedCustomerId);
  const hadCustomerBetsForSheetRef = useRef(false);
  useEffect(() => {
    if (!selectedRoundId || !selectedCustomerId) return;
    if (customerBetsFetching && !customerBetsSuccess) return;

    const customerBets = customerRoundBets;
    const latestSheet = customerBets.length
      ? Math.max(...customerBets.map(b => b.sheet_no ?? 1))
      : 1;

    const switchedCustomer = prevCustomerIdForSheetRef.current !== selectedCustomerId;
    prevCustomerIdForSheetRef.current = selectedCustomerId;

    if (switchedCustomer) {
      setSheet(latestSheet);
      setMaxSheets(latestSheet);
      setSelectedGroups(new Set());
      hadCustomerBetsForSheetRef.current = customerBets.length > 0;
      return;
    }

    setMaxSheets((m) => Math.max(m, latestSheet));

    if (customerBets.length === 0) {
      if (!customerBetsFetching) hadCustomerBetsForSheetRef.current = false;
      return;
    }

    if (!hadCustomerBetsForSheetRef.current) {
      hadCustomerBetsForSheetRef.current = true;
      setSheet(latestSheet);
      setSelectedGroups(new Set());
    }
  }, [
    selectedCustomerId,
    selectedRoundId,
    customerRoundBets,
    customerBetsFetching,
    customerBetsSuccess,
  ]);

  const currentCustomer = useMemo(
    () => customers.find(c => c.id === selectedCustomerId) ?? null,
    [customers, selectedCustomerId],
  );

  const customerIndex = customers.findIndex(c => c.id === selectedCustomerId);
  const navigateCustomer = (dir: 1 | -1) => {
    if (!customers.length) return;
    if (customerIndex < 0) {
      setSelectedCustomerId(dir === 1 ? customers[0].id : customers[customers.length - 1].id);
      return;
    }
    const next = (customerIndex + dir + customers.length) % customers.length;
    setSelectedCustomerId(customers[next].id);
  };

  const stripTrailingKlapHyphen = (s: string) => s.replace(/-+$/, '').trim();

  const commitLineWith = useCallback(async (
    num: string,
    amt: string,
    voice = 'บันทึก',
    keepAmt = false,
    insertBeforeKey?: string,
  ) => {
    if (!num.trim() || !amt.trim()) return;
    if (!selectedCustomerId) { keyInputRef.current?.setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!selectedRoundId) { keyInputRef.current?.setParseError('กรุณาเลือกงวดก่อน'); return; }
    const result = parseBetLine(num, amt);
    if (result.error || !result.bets.length) {
      keyInputRef.current?.setParseError(result.error ?? 'ไม่มีรายการ');
      return;
    }

    let insertSortOrder: number | undefined;
    if (insertBeforeKey) {
      const groups = sheetGroupedRef.current;
      const targetIdx = groups.findIndex(g => betSheetGroupKey(g) === insertBeforeKey);
      if (targetIdx >= 0) {
        const targetOrder = groups[targetIdx].sortOrder;
        if (betSheetSort === 'newestFirst') {
          if (targetIdx > 0) {
            const newerOrder = groups[targetIdx - 1].sortOrder;
            insertSortOrder = (newerOrder + targetOrder) / 2;
          } else {
            insertSortOrder = targetOrder + 2000;
          }
        } else {
          const prevOrder = targetIdx > 0 ? groups[targetIdx - 1].sortOrder : targetOrder - 2000;
          insertSortOrder = (prevOrder + targetOrder) / 2;
        }
      }
    }

    if (insertSortOrder !== undefined && betSheetSort === 'oldestFirst') {
      holdCurrentScrollPosition();
    }
    setIsSaving(true);
    try {
      const bulkRes = await betsApi.bulk(selectedRoundId, result.bets.map(bet => ({
        number: bet.number, bet_type: bet.bet_type, amount: bet.amount,
        payout_rate: getEffectiveRate(currentCustomer, bet.bet_type),
        customer_id: selectedCustomerId || null,
        customer_ref: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name ?? null) : null,
        sheet_no: sheet,
        ...(insertSortOrder !== undefined ? { sort_order: insertSortOrder } : {}),
      })));
      const sum = summarizeBulkBetsResponse(bulkRes.data as BulkBetsResponse);
      const apiBets = (bulkRes.data as BulkBetsResponse).bets;
      const lineNum = result.bets[0]?.number ?? '';
      const insertedMarker = sum.inserted > 0 && lineNum ? markerFromInsertedBets(apiBets, lineNum) : null;
      if (!patchAfterBulkInsert(apiBets)) await refreshBetsAfterMutation();
      if (insertedMarker) setRecentChangedMarker(insertedMarker);
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumberAlarm();
      else if (sum.inserted === 0 && sum.errors.length) playError();

      if (sum.inserted > 0) {
        playSaveBet();
        tts(voice);
        const stripped = stripTrailingKlapHyphen(amt);
        if (stripped) keyInputRef.current?.notifyCommittedAmt(stripped);
        const nextAmt = keepAmt ? (stripped || keyInputRef.current?.resolveAmtForCommit() || '') : '';
        keyInputRef.current?.clearInputs({ keepAmt, nextAmt, parseError: errTxt });
        setSelectedGroups(new Set());
        keyInputRef.current?.focusNum();
      } else {
        keyInputRef.current?.setParseError(errTxt || 'ไม่มีรายการถูกบันทึก (เช็คเลขปิดหรือรูปแบบ)');
        keyInputRef.current?.focusNum();
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (isBlockedBetApiMessage(msg)) playBlockedNumberAlarm();
      else playError();
      keyInputRef.current?.setParseError(msg);
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedCustomerId,
    selectedRoundId,
    betSheetSort,
    currentCustomer,
    customers,
    sheet,
    holdCurrentScrollPosition,
    patchAfterBulkInsert,
    refreshBetsAfterMutation,
  ]);

  const handleInsertBefore = useCallback((insertKey: string) => {
    const panel = keyInputRef.current;
    if (!panel) return;
    const num = panel.getNum();
    const amt = panel.resolveAmtForCommit();
    if (!num.trim() || !amt) return;
    void commitLineWith(num, amt, 'แทรก', true, insertKey);
  }, [commitLineWith]);

  const deleteSavedGroup = useCallback(async (bets: Bet[]) => {
    if (!await confirm({ message: 'ลบโพยนี้?', danger: true })) return;
    try {
      const ids = bets.map(b => b.id);
      await betsApi.bulkDelete(ids);
      if (!patchAfterBulkDelete(ids)) await refreshBetsAfterMutation();
    } catch (err: unknown) {
      playError();
      showApiError(err, 'ลบไม่สำเร็จ');
    }
  }, [patchAfterBulkDelete, refreshBetsAfterMutation]);

  const deleteSelectedGroups = useCallback(async () => {
    if (selectedGroups.size === 0) return;
    if (!await confirm({ message: `ลบ ${selectedGroups.size} รายการที่เลือก?`, danger: true })) return;
    try {
      const toDelete = sheetGroupedRef.current.filter(g => selectedGroups.has(betSheetGroupKey(g)));
      const ids = toDelete.flatMap(g => g.bets.map(b => b.id));
      await betsApi.bulkDelete(ids);
      setSelectedGroups(new Set());
      if (!patchAfterBulkDelete(ids)) await refreshBetsAfterMutation();
    } catch (err: unknown) {
      playError();
      showApiError(err, 'ลบไม่สำเร็จ');
    }
  }, [selectedGroups, patchAfterBulkDelete, refreshBetsAfterMutation]);

  const moveSelectedGroups = useCallback(async (targetSheet: number) => {
    if (selectedGroups.size === 0) return;
    const toMove = sheetGroupedRef.current.filter(g => selectedGroups.has(betSheetGroupKey(g)));
    const ids = toMove.flatMap(g => g.bets.map(b => b.id));
    const isCustomerChange = moveTargetCustomerId !== '__same__';
    try {
      if (isCustomerChange) {
        const targetCust = customers.find(c => c.id === moveTargetCustomerId);
        await betsApi.moveSheet(ids, targetSheet, moveTargetCustomerId || null, targetCust?.name ?? null);
      } else {
        await betsApi.moveSheet(ids, targetSheet);
      }
      setSelectedGroups(new Set());
      setMoveModal(false);
      await refreshBetsAfterMutation();
    } catch (err: unknown) {
      playError();
      showApiError(err, 'ย้ายแผ่นไม่สำเร็จ');
    }
  }, [selectedGroups, customers, moveTargetCustomerId, refreshBetsAfterMutation]);

  const handleAddSheet = () => {
    const next = effectiveMaxSheets + 1;
    setMaxSheets(next);
    setSheet(next);
    setSelectedGroups(new Set());
  };

  const handleRemoveSheet = () => {
    const betsInSheet = roundBets.filter(b => (b.sheet_no ?? 1) === sheet);
    if (betsInSheet.length > 0) {
      keyInputRef.current?.setParseError(`แผ่นที่ ${sheet} มีข้อมูล ${betsInSheet.length} รายการ — ลบข้อมูลในแผ่นนี้ก่อน`);
      return;
    }
    if (effectiveMaxSheets <= 1) return;
    const newMax = effectiveMaxSheets - 1;
    setMaxSheets(newMax);
    if (sheet > newMax) setSheet(newMax);
    setSelectedGroups(new Set());
  };

  const loadForEdit = useCallback(() => {
    if (selectedGroups.size !== 1) return;
    const key = Array.from(selectedGroups)[0];
    const group = sheetGroupedRef.current.find(g => betSheetGroupKey(g) === key);
    if (!group) return;
    const preserveTs = group.bets.reduce((min, b) => b.created_at < min ? b.created_at : min, group.bets[0].created_at);
    const row = buildRowFromBets(group.bets);
    const expanded = expandNumberInput(group.number);
    let amtStr = '';
    let mode: import('@/lib/betParser').BetInputMode | undefined;
    if (expanded) {
      mode = expanded.mode;
      if (mode === 'run')        amtStr = `${row['1digit_top']}+${row['1digit_bottom']}`;
      else if (mode === '2digit') amtStr = `${row['2digit_top']}+${row['2digit_bottom']}`;
      else                     amtStr = `${row['3digit_top']}+${row['3digit_tote']}+${row['3digit_back']}`;
    }
    keyInputRef.current?.setInputs(group.number, amtStr, mode);
    setEditInlineKey(key);
    setEditInlineCreatedAt(preserveTs);
    keyInputRef.current?.focusAmt();
  }, [selectedGroups]);

  const replaceGroupWithValues = useCallback(async (
    group: BetSheetGroup,
    nextNum: string,
    nextAmt: string,
    clearInputsAfter: boolean,
    preserveCreatedAt?: string,
  ) => {
    if (!selectedRoundId) return;
    if (!selectedCustomerId) { keyInputRef.current?.setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!nextNum.trim() || !nextAmt.trim()) { keyInputRef.current?.setParseError('กรอกเลขและราคาให้ครบ'); return; }

    const result = parseBetLine(nextNum, nextAmt);
    if (result.error || !result.bets.length) {
      keyInputRef.current?.setParseError(result.error ?? 'ไม่มีรายการ');
      return;
    }
    const removedIds = group.bets.map(b => b.id);
    const preserveSortOrder = group.bets.reduce((min, b) => (b.sort_order !== null && b.sort_order !== undefined) ? Math.min(min, b.sort_order) : min, group.bets[0].sort_order ?? Date.now());
    const refBet = group.bets[0];
    const preserveImport =
      refBet?.import_batch_id != null && String(refBet.import_batch_id).length > 0
        ? { import_batch_id: refBet.import_batch_id, segment_index: refBet.segment_index ?? 0 }
        : {};
    holdCurrentScrollPosition();
    setIsSaving(true);
    const removed = group.bets;
    try {
      await betsApi.bulkDelete(removedIds);
      const bulkRes = await betsApi.bulk(selectedRoundId, result.bets.map(bet => ({
        number: bet.number, bet_type: bet.bet_type, amount: bet.amount,
        payout_rate: getEffectiveRate(currentCustomer, bet.bet_type),
        customer_id: selectedCustomerId || null,
        customer_ref: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name ?? null) : null,
        sheet_no: sheet,
        sort_order: preserveSortOrder,
        ...(preserveCreatedAt ? { created_at: preserveCreatedAt } : {}),
        ...preserveImport,
      })));
      const sum = summarizeBulkBetsResponse(bulkRes.data as BulkBetsResponse);
      const apiBets = (bulkRes.data as BulkBetsResponse).bets;
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumberAlarm();
      else if (sum.inserted === 0 && sum.errors.length) playError();

      if (sum.inserted > 0) {
        setEditInlineKey(null);
        setEditInlineCreatedAt('');
        if (clearInputsAfter) keyInputRef.current?.clearInputs({ parseError: errTxt });
        else keyInputRef.current?.setParseError(errTxt);
        setSelectedGroups(new Set());
        if (!patchAfterReplace(removedIds, apiBets)) await refreshBetsAfterMutation();
        const m = markerFromInsertedBets(apiBets, result.bets[0].number);
        if (m) setRecentChangedMarker(m);
        playSaveBet();
        const isKlap = keyInputRef.current?.getIsKlap() ?? false;
        tts(isKlap || nextAmt.trim().endsWith('-') ? 'กลับ' : 'บันทึก');
        keyInputRef.current?.focusNum();
      } else {
        setEditInlineKey(null);
        setEditInlineCreatedAt('');
        keyInputRef.current?.setParseError(errTxt || 'ไม่มีรายการถูกบันทึก — โพยเดิมถูกลบแล้ว กรุณาคีย์ใหม่');
        if (!patchAfterReplace(removedIds, apiBets)) await refreshBetsAfterMutation();
        keyInputRef.current?.focusNum();
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (isBlockedBetApiMessage(msg)) playBlockedNumberAlarm();
      else playError();
      keyInputRef.current?.setParseError(msg);
      setEditInlineKey(null);
      setEditInlineCreatedAt('');
      await refreshBetsAfterMutation();
    } finally {
      setIsSaving(false);
    }
  }, [
    selectedRoundId,
    selectedCustomerId,
    currentCustomer,
    customers,
    sheet,
    holdCurrentScrollPosition,
    patchAfterReplace,
    refreshBetsAfterMutation,
  ]);

  const saveInlineEdit = useCallback(async () => {
    if (!editInlineKey || !editInlineCreatedAt || !selectedRoundId) return;
    const group = sheetGroupedRef.current.find(g => betSheetGroupKey(g) === editInlineKey);
    if (!group) return;
    const panel = keyInputRef.current;
    if (!panel) return;
    await replaceGroupWithValues(group, panel.getNum(), panel.getAmt(), true, editInlineCreatedAt);
  }, [editInlineKey, editInlineCreatedAt, selectedRoundId, replaceGroupWithValues]);

  const handleCancelEdit = useCallback(() => {
    setEditInlineKey(null);
    setEditInlineCreatedAt('');
    keyInputRef.current?.clearInputs();
  }, []);

  const handleEditAction = useCallback(() => {
    if (selectedGroups.size !== 1) return;
    const panel = keyInputRef.current;
    const num = panel?.getNum() ?? '';
    const amt = panel?.getAmt() ?? '';

    if (num.trim() && amt.trim()) {
      const key = Array.from(selectedGroups)[0];
      const group = sheetGroupedRef.current.find(g => betSheetGroupKey(g) === key);
      if (!group) return;
      const preserveTs = group.bets.reduce(
        (min, b) => (b.created_at < min ? b.created_at : min),
        group.bets[0].created_at,
      );
      void replaceGroupWithValues(group, num, amt, false, preserveTs);
      return;
    }

    loadForEdit();
  }, [selectedGroups, replaceGroupWithValues, loadForEdit]);

  const savedTotal = useMemo(
    () => roundBets.reduce((s, b) => s + Number(b.amount), 0),
    [roundBets],
  );

  const summaryByType = useMemo(() => {
    const out: Record<string, number> = {};
    COL_TYPES.forEach(c => { out[c.key] = 0; });
    roundBets.forEach(b => {
      if (out[b.bet_type] !== undefined) out[b.bet_type] += Number(b.amount);
    });
    return out;
  }, [roundBets]);

  const customerSavedByType = useMemo(() => {
    const out: Record<string, number> = {};
    COL_TYPES.forEach(c => { out[c.key] = 0; });
    if (selectedCustomerId) {
      roundBets.forEach(b => {
        if (b.customer_id === selectedCustomerId && out[b.bet_type] !== undefined) {
          out[b.bet_type] += Number(b.amount);
        }
      });
    }
    return out;
  }, [roundBets, selectedCustomerId]);

  const customerSavedTotal = useMemo(
    () => Object.values(customerSavedByType).reduce((a, v) => a + v, 0),
    [customerSavedByType],
  );

  const handleLineImport = async () => {
    if (!selectedRoundId) { setImportResult({ ok: false, msg: 'กรุณาเลือกงวดก่อน' }); return; }
    if (!selectedCustomerId) { setImportResult({ ok: false, msg: 'กรุณาเลือกลูกค้าก่อน' }); return; }
    const { bets: parsedBets, parsedCount, skippedCount } = parseLineBetsTextWithSegments(lineText);
    if (!parsedBets.length) { setImportResult({ ok: false, msg: 'ไม่พบรายการที่ถูกต้อง' }); return; }
    const importBatchId =
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `imp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
    const betsPayload = parsedBets.map(bet => ({
      number: bet.number, bet_type: bet.bet_type, amount: bet.amount,
      payout_rate: getEffectiveRate(currentCustomer, bet.bet_type),
      customer_id: selectedCustomerId || null,
      customer_ref: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name ?? null) : null,
      sheet_no: sheet,
      import_batch_id: importBatchId,
      segment_index: bet.segment_index ?? 1,
    }));
    try {
      const bulkRes = await betsApi.bulk(selectedRoundId, betsPayload);
      const sum = summarizeBulkBetsResponse(bulkRes.data as BulkBetsResponse);
      const apiBets = (bulkRes.data as BulkBetsResponse).bets;
      if (!patchAfterBulkInsert(apiBets)) await refreshBetsAfterMutation();
      if (sum.inserted > 0 && apiBets?.length) {
        const firstNum = parsedBets[0]?.number ?? '';
        const m = firstNum ? markerFromInsertedBets(apiBets, firstNum) : null;
        if (m) setRecentChangedMarker(m);
      }
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumberAlarm();
      else if (sum.inserted === 0 && sum.errors.length) playError();

      if (sum.inserted > 0) {
        playImportSuccess();
        const tail = [
          skippedCount > 0 ? `ข้าม ${skippedCount} บรรทัด` : '',
          errTxt,
        ].filter(Boolean).join(' — ');
        const msgOk = `✓ นำเข้า ${sum.inserted} รายการ${tail ? ` (${tail})` : ''}`;
        setLineImportToast({ ok: true, msg: `${msgOk} · แถวที่นำเข้าถูกไฮไลต์ในโต๊ะ (แถบสีด้านซ้าย)` });
        setLineImportHighlightBatchId(importBatchId);
        setImportResult({ ok: true, msg: msgOk });
        setLineText('');
        setImageOcrSource(null);
        setOcrServerFallbackNote(null);
      } else {
        setImportResult({ ok: false, msg: errTxt || 'นำเข้าไม่สำเร็จ (ทุกรายการถูกปิดหรือผิดรูปแบบ)' });
      }
    } catch { playError(); setImportResult({ ok: false, msg: 'นำเข้าไม่สำเร็จ กรุณาลองใหม่' }); }
  };


  const handlePdfFile = async (file: File) => {
    if (file.type !== 'application/pdf') { setOcrError('กรุณาเลือกไฟล์ PDF'); return; }
    setPdfLoading(true);
    setOcrError('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const { api } = await import('@/lib/api');
      const res = await api.post<{ text: string }>('/bets/parse-pdf', formData);
      const rawText = res.data.text;
      if (!rawText.trim()) { setOcrError('ไม่พบข้อความใน PDF'); return; }
      const { parsedCount, extractedLines } = parsePdfBetsText(rawText);
      if (parsedCount === 0) { setOcrError('ไม่พบรายการเดิมพันใน PDF'); return; }
      setLineText(prev => prev ? prev + '\n' + extractedLines : extractedLines);
    } catch (e) {
      console.error(e);
      setOcrError('อ่าน PDF ไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setPdfLoading(false);
    }
  };

  const customerBets = customerRoundBets;

  // Max sheet for current customer
  const maxSheetFromData = customerBets.length
    ? Math.max(...customerBets.map(b => b.sheet_no ?? 1))
    : 1;
  // effectiveMaxSheets = ใช้ค่า maxSheets (เพิ่มชั่วคราว) หรือ data หากมากกว่า
  const effectiveMaxSheets = Math.max(maxSheets, maxSheetFromData);

  const sheetByType = useMemo(() => {
    const out: Record<string, number> = {};
    COL_TYPES.forEach(c => { out[c.key] = 0; });
    customerBets.filter(b => (b.sheet_no ?? 1) === sheet).forEach(b => {
      if (out[b.bet_type] !== undefined) out[b.bet_type] += Number(b.amount);
    });
    return out;
  }, [customerBets, sheet]);

  const sheetTotal = useMemo(
    () => Object.values(sheetByType).reduce((a, v) => a + v, 0),
    [sheetByType],
  );

  const sheetGroupedBase = useMemo(
    () => groupByEntry(customerBets.filter(b => (b.sheet_no ?? 1) === sheet)),
    [customerBets, sheet],
  );
  const sheetGrouped = useMemo(
    () => sortBetSheetGroups(sheetGroupedBase, betSheetSort),
    [sheetGroupedBase, betSheetSort],
  );
  sheetGroupedRef.current = sheetGrouped;

  useEffect(() => {
    if (!voiceAuditMode) {
      voiceAuditRestoreKeyRef.current = '';
      return;
    }
    if (!selectedRoundId || !selectedCustomerId || sheetGrouped.length === 0) return;
    const sk = `${selectedRoundId}|${selectedCustomerId}|${sheet}|${betSheetSort}`;
    const cp = readVoiceAuditCheckpoint();
    if (
      !cp ||
      cp.roundId !== selectedRoundId ||
      cp.customerId !== selectedCustomerId ||
      cp.sheet !== sheet ||
      cp.betSheetSort !== betSheetSort
    ) {
      return;
    }
    if (voiceAuditRestoreKeyRef.current === sk) return;
    voiceAuditRestoreKeyRef.current = sk;
    const idx = Math.min(Math.max(0, cp.focusedIdx), sheetGrouped.length - 1);
    voiceAuditPausedRef.current = true;
    setVoiceAuditPaused(true);
    setFocusedIdx(idx);
    requestAnimationFrame(() => scrollRowIntoView(idx));
  }, [voiceAuditMode, sheetGrouped, selectedRoundId, selectedCustomerId, sheet, betSheetSort]);

  useEffect(() => {
    if (!voiceAuditMode || focusedIdx < 0 || !selectedRoundId || !selectedCustomerId) return;
    writeVoiceAuditCheckpoint({
      v: 1,
      roundId: selectedRoundId,
      customerId: selectedCustomerId,
      sheet,
      focusedIdx,
      betSheetSort,
      updatedAt: Date.now(),
    });
  }, [voiceAuditMode, focusedIdx, selectedRoundId, selectedCustomerId, sheet, betSheetSort]);

  useEffect(() => {
    if (!betsPrefsHydrated || !voiceAuditMode || focusedIdx < 0 || !soundOn) return;
    if (voiceAuditPausedRef.current || voiceAuditPaused) return;
    const groups = sheetGroupedRef.current;
    const group = groups[focusedIdx];
    if (!group) return;
    const row = buildRowFromBets(group.bets);
    const text = buildVoiceAuditLine(group.number, row, {
      winKeys: roundDrawWinKeys,
      bets: group.bets,
      rateLookup: (bt) => getEffectiveRate(currentCustomer, bt),
    });
    const rate = Math.min(Math.max(voiceAuditRateRef.current, 0.5), 3);
    let cancelled = false;
    speakVoiceAudit(text, rate, () => {
      if (cancelled || !voiceAuditModeRef.current || !soundOnRef.current || voiceAuditPausedRef.current) return;
      requestAnimationFrame(() => {
        if (cancelled || !voiceAuditModeRef.current || !soundOnRef.current || voiceAuditPausedRef.current) return;
        setFocusedIdx(prev => {
          const len = sheetGroupedRef.current.length;
          if (prev < 0 || prev >= len - 1) return prev;
          const next = prev + 1;
          scrollRowIntoView(next);
          return next;
        });
      });
    });
    return () => {
      cancelled = true;
      cancelSpeech();
    };
  }, [betsPrefsHydrated, focusedIdx, voiceAuditMode, voiceAuditPaused, soundOn, voiceAuditRate, voiceAuditNonce, currentCustomer?.id, roundDrawWinKeys]);

  const voiceAuditHitPause = useCallback(() => {
    cancelSpeech();
    voiceAuditPausedRef.current = true;
    setVoiceAuditPaused(true);
  }, []);

  const voiceAuditHitPlay = useCallback(() => {
    voiceAuditPausedRef.current = false;
    setVoiceAuditPaused(false);
    setVoiceAuditNonce(n => n + 1);
  }, []);

  const voiceAuditGoPrev = useCallback(() => {
    cancelSpeech();
    const len = sheetGroupedRef.current.length;
    if (len === 0) return;
    setFocusedIdx(prev => {
      const base = prev < 0 ? len - 1 : prev;
      const next = Math.max(base - 1, 0);
      scrollRowIntoView(next);
      return next;
    });
  }, []);

  const voiceAuditGoNext = useCallback(() => {
    cancelSpeech();
    const len = sheetGroupedRef.current.length;
    if (len === 0) return;
    setFocusedIdx(prev => {
      const base = prev < 0 ? 0 : prev;
      const next = Math.min(base + 1, len - 1);
      scrollRowIntoView(next);
      return next;
    });
  }, []);

  /** ลบจุดจำการอ่าน + ไปแถวแรกและเริ่มพูดใหม่ */
  const voiceAuditResetReading = useCallback(() => {
    cancelSpeech();
    clearVoiceAuditCheckpoint();
    voiceAuditRestoreKeyRef.current = '';
    const len = sheetGroupedRef.current.length;
    if (len === 0) {
      setFocusedIdx(-1);
      return;
    }
    voiceAuditPausedRef.current = false;
    setVoiceAuditPaused(false);
    setFocusedIdx(0);
    requestAnimationFrame(() => scrollRowIntoView(0));
    setVoiceAuditNonce(n => n + 1);
  }, []);

  const searchNeedle = searchQ.trim();
  const searchMatchIndexes = useMemo(() => {
    if (!searchNeedle) return [];
    return sheetGrouped.reduce<number[]>((matches, group, idx) => {
      if (matchesSearch(group.number, searchNeedle)) matches.push(idx);
      return matches;
    }, []);
  }, [sheetGrouped, searchNeedle]);

  const clearSearch = useCallback(() => {
    setSearchQ('');
    setActiveSearchMatchPos(-1);
    setFocusedIdx(-1);
    setSelectedGroups(new Set());
  }, []);

  const jumpToSearchMatch = useCallback((mode: 'first' | 'next') => {
    if (searchMatchIndexes.length === 0) {
      setActiveSearchMatchPos(-1);
      return;
    }

    setActiveSearchMatchPos(prev => {
      const nextPos = mode === 'first' || prev < 0
        ? 0
        : (prev + 1) % searchMatchIndexes.length;
      const nextIdx = searchMatchIndexes[nextPos];
      setFocusedIdx(nextIdx);
      setSelectedGroups(new Set([betSheetGroupKey(sheetGrouped[nextIdx])]));
      scrollRowIntoView(nextIdx);
      return nextPos;
    });
  }, [searchMatchIndexes, sheetGrouped]);

  useEffect(() => {
    setActiveSearchMatchPos(-1);
  }, [searchQ, selectedCustomerId, sheet]);

  useEffect(() => {
    if (!recentChangedMarker) return;
    const idx = findGroupIndexByMarker(sheetGrouped, recentChangedMarker);
    if (idx < 0) return;

    const key = betSheetGroupKey(sheetGrouped[idx]);
    setFocusedIdx(idx);
    setSelectedGroups(new Set([key]));
    setRecentChangedKey(key);
    setRecentChangedMarker(null);
    scrollRowIntoView(idx, betSheetSort === 'oldestFirst' ? 'end' : 'start');

    const timer = window.setTimeout(() => {
      setRecentChangedKey(current => current === key ? null : current);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [sheetGrouped, recentChangedMarker, findGroupIndexByMarker, betSheetSort]);

  // ── Print receipt data ───────────────────────────────────────────────────
  const printItems = useMemo(() => sheetGrouped.map(formatPrintItem), [sheetGrouped]);
  const printLines = useMemo(() => sheetGrouped.map(buildPrintLine), [sheetGrouped]);
  const printTotal = useMemo(
    () => customerBets.filter(b => (b.sheet_no ?? 1) === sheet).reduce((s, b) => s + Number(b.amount), 0),
    [customerBets, sheet],
  );
  const printRows = useMemo(() => {
    const rows: PrintItem[][] = [];
    for (let i = 0; i < printItems.length; i += 4) rows.push(printItems.slice(i, i + 4));
    return rows;
  }, [printItems]);

  const currentRound = rounds.find(r => r.id === selectedRoundId);

  const handlePrint = useCallback(() => {
    openBetSheetPrintPreview({
      printLines,
      printTotal,
      sheet,
      customerName: currentCustomer?.name ?? 'ไม่ระบุลูกค้า',
      roundName: currentRound?.name ?? 'ไม่ระบุงวด',
    });
  }, [printLines, printTotal, sheet, currentCustomer, currentRound]);

  const handleExportCsv = useCallback(() => {
    exportBetSheetsCsv({
      customerBets,
      betSheetSort,
      customerName: currentCustomer?.name ?? 'ไม่ระบุลูกค้า',
      roundName: currentRound?.name ?? 'ไม่ระบุงวด',
      mode: csvExportMode,
    });
    if (csvExportMode === 'separate') setCsvModalOpen(false);
  }, [customerBets, betSheetSort, currentCustomer, currentRound, csvExportMode]);

  const voiceAuditBarCp =
    voiceAuditMode && selectedRoundId && selectedCustomerId ? readVoiceAuditCheckpoint() : null;
  const voiceAuditCpMatches =
    !!voiceAuditBarCp &&
    voiceAuditBarCp.roundId === selectedRoundId &&
    voiceAuditBarCp.customerId === selectedCustomerId &&
    voiceAuditBarCp.sheet === sheet &&
    voiceAuditBarCp.betSheetSort === betSheetSort;

  const voiceAuditDispIdx =
    focusedIdx >= 0 && sheetGrouped.length > 0
      ? betSheetSort === 'oldestFirst'
        ? focusedIdx + 1
        : sheetGrouped.length - focusedIdx
      : null;

  return (
    <>
      <div
        className="flex flex-col h-full min-h-0 bg-surface-default overflow-hidden"
        style={{ zoom: betsPageZoomPercent / 100 }}
      >

        {/* Top bar — พื้นขาวแยกจากแถบคีย์ด้านล่าง */}
        <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-card-bg)] shadow-[var(--shadow-soft)]">
          <span className="text-theme-text-secondary text-sm font-semibold">รับแทง</span>
          <span className="md:hidden text-[11px] text-theme-text-muted">โหมดย่อสำหรับมือถือ/แท็บเล็ต</span>
          <div className="w-px h-4 bg-surface-300" />
          <select value={selectedRoundId} onChange={e => setSelectedRoundId(e.target.value)}
            aria-label="เลือกงวด"
            className="h-7 rounded bg-surface-200 border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
            {roundsForPicker.length === 0
              ? <option value="">{showClosedRoundsInPicker ? '— ไม่มีงวด (หรือซ่อนหมด) —' : '— ไม่มีงวดที่เปิดรับ —'}</option>
              : roundsForPicker.map(r => {
                  const icon = r.status === 'drawn' ? '✓ ' : r.status === 'closed' ? '■ ' : '';
                  return <option key={r.id} value={r.id}>{icon}{r.name}</option>;
                })
            }
          </select>
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-[11px] text-theme-text-muted cursor-pointer select-none shrink-0" title="เฉพาะผู้ดูแลระบบ — ดูโพยงวดที่ปิดรับหรือออกผลแล้ว">
              <input
                type="checkbox"
                checked={roundPickerShowAll}
                onChange={(e) => setRoundPickerShowAll(e.target.checked)}
                className="rounded border-border bg-surface-100 accent"
              />
              แสดงงวดปิด/ออกผล
            </label>
          )}
          <a href="/rounds" className="text-xs text-profit hover:underline">+ เริ่มงวดใหม่</a>
          <div className="flex-1" />
          <span
            className={`text-xs text-accent min-w-[6.25rem] text-right tabular-nums transition-opacity duration-150 ${isSaving ? 'opacity-100 animate-pulse' : 'opacity-0 pointer-events-none select-none'}`}
            aria-hidden={!isSaving}
          >
            กำลังบันทึก...
          </span>
        </div>

        <div
          className="bets-main-split"
          style={{ '--bets-right-panel-px': `${rightPanelPx}px` } as React.CSSProperties}
        >
          <div className="bets-main-split-inner">
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden" aria-busy={loading}>

            {/* Warning: no customer selected */}
            {!selectedCustomerId && (
              <div className="shrink-0 bg-risk-medium/18 border-b border-risk-medium/45/50 px-4 py-1.5 text-xs text-risk-medium text-center select-none">
                {customers.length === 0
                  ? <>⚠ ยังไม่มีลูกค้า — <a href="/customers" className="underline">+ เพิ่มลูกค้า</a></>
                  : '⚠ กรุณาเลือกลูกค้าก่อนคีย์โพย'}
              </div>
            )}

            <BetKeyInputPanel
              ref={keyInputRef}
              readOnly={!canMutate}
              numWidth={numWidth}
              inputFs={inputFs}
              setInputFs={setInputFs}
              voiceAuditMode={voiceAuditMode}
              selectedCustomerId={selectedCustomerId}
              editInlineKey={editInlineKey}
              soundOnRef={soundOnRef}
              speechRateRef={speechRateRef}
              inputActivityRef={inputActivityRef}
              onCommit={commitLineWith}
              onSaveInlineEdit={saveInlineEdit}
              onDividerMouseDown={onDividerMouseDown}
            />

            <BetSheetEditableGrid
              rowFs={rowFs}
              loading={loading}
              sheetGrouped={sheetGrouped}
              betSheetSort={betSheetSort}
              setBetSheetSort={setBetSheetSort}
              selectedGroups={selectedGroups}
              setSelectedGroups={setSelectedGroups}
              lastClickedIdxRef={lastClickedIdxRef}
              searchNeedle={searchNeedle}
              searchMatchIndexes={searchMatchIndexes}
              activeSearchMatchPos={activeSearchMatchPos}
              focusedIdx={focusedIdx}
              setFocusedIdx={setFocusedIdx}
              recentChangedKey={recentChangedKey}
              lineImportHighlightBatchId={lineImportHighlightBatchId}
              setLineImportHighlightBatchId={setLineImportHighlightBatchId}
              selectedCustomerId={selectedCustomerId}
              sheet={sheet}
              roundDrawWinKeys={roundDrawWinKeys}
              customerBets={customerBets}
              tableScrollRef={tableScrollRef}
              deleteSavedGroup={deleteSavedGroup}
              isAdmin={isAdmin}
              canMutate={canMutate}
              editInlineKey={editInlineKey}
              isSaving={isSaving}
              saveInlineEdit={saveInlineEdit}
              onCancelEdit={handleCancelEdit}
              inputActivityRef={inputActivityRef}
              onInsertBefore={handleInsertBefore}
              handleEditAction={handleEditAction}
              deleteSelectedGroups={deleteSelectedGroups}
              setMoveTarget={setMoveTarget}
              setMoveTargetCustomerId={setMoveTargetCustomerId}
              setMoveModal={setMoveModal}
              handlePrint={handlePrint}
              printItems={printItems}
              setCsvModalOpen={setCsvModalOpen}
              betsPageZoomPercent={betsPageZoomPercent}
              setBetsPageZoomPercent={setBetsPageZoomPercent}
            />

          </div>

          {/* แถบลากปรับความกว้างแผงสรุป (เฉพาะจอใหญ่ — เหมือนหน้าตัดส่ง) */}
          <div
            role="separator"
            aria-orientation="vertical"
            title={
              rightPanelLocked
                ? 'ปลดล็อกความกว้าง (ปุ่ม 🔓 ที่หัวสรุปยอด) เพื่อลากปรับ'
                : 'ลากซ้าย-ขวาเพื่อปรับความกว้าง · ปล่อยเมาส์แล้วจำค่าไว้'
            }
            onMouseDown={(e) => {
              if (rightPanelLocked) return;
              e.preventDefault();
              rightResizeDrag.current = { startX: e.clientX, startW: rightPanelPx };
              document.body.style.cursor = 'col-resize';
              document.body.style.userSelect = 'none';
            }}
            className={cn(
              'bets-split-resizer w-1.5 shrink-0 transition-colors select-none',
              rightPanelLocked ? 'cursor-default opacity-50' : 'cursor-col-resize',
              !rightPanelLocked && 'hover:bg-[var(--color-border-strong)] bg-border/90',
            )}
          />

          <BetSummaryPanel
            customers={customers}
            selectedCustomerId={selectedCustomerId}
            setSelectedCustomerId={setSelectedCustomerId}
            navigateCustomer={navigateCustomer}
            sheet={sheet}
            setSheet={setSheet}
            setSelectedGroups={setSelectedGroups}
            effectiveMaxSheets={effectiveMaxSheets}
            customerBets={customerBets}
            handleRemoveSheet={handleRemoveSheet}
            handleAddSheet={handleAddSheet}
            isAdmin={isAdmin}
            canMutate={canMutate}
            onOpenLineModal={() => setLineModal(true)}
            searchQ={searchQ}
            setSearchQ={setSearchQ}
            onSearch={() => jumpToSearchMatch('first')}
            onSearchNext={() => jumpToSearchMatch('next')}
            onSearchClear={clearSearch}
            searchMatchIndexes={searchMatchIndexes}
            activeSearchMatchPos={activeSearchMatchPos}
            rightPanelLocked={rightPanelLocked}
            setRightPanelLocked={setRightPanelLocked}
            sumFs={sumFs}
            setSumFs={setSumFs}
            sheetTotal={sheetTotal}
            customerSavedTotal={customerSavedTotal}
            savedTotal={savedTotal}
            sheetByType={sheetByType}
            customerSavedByType={customerSavedByType}
            summaryByType={summaryByType}
            sheetGrouped={sheetGrouped}
            focusedIdx={focusedIdx}
            voiceAuditBarProps={{
              soundOn,
              setSoundOn,
              speechRate,
              setSpeechRate,
              voiceAuditMode,
              setVoiceAuditMode,
              voiceAuditRate,
              setVoiceAuditRate,
              voiceAuditDispIdx,
              voiceAuditCpMatches,
              voiceAuditBarCp,
              voiceAuditPaused,
              voiceAuditResetReading,
              voiceAuditGoPrev,
              voiceAuditHitPause,
              voiceAuditHitPlay,
              voiceAuditGoNext,
            }}
          />
          </div>
        </div>
      </div>

      <BetMoveSheetModal
        open={moveModal}
        onClose={() => setMoveModal(false)}
        selectedGroups={selectedGroups}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        savedBets={roundBets}
        sheet={sheet}
        moveTarget={moveTarget}
        setMoveTarget={setMoveTarget}
        moveTargetCustomerId={moveTargetCustomerId}
        setMoveTargetCustomerId={setMoveTargetCustomerId}
        onMove={moveSelectedGroups}
      />

      {/* CSV Export Modal */}
      {csvModalOpen && (
        <div className="fixed inset-0 bg-[var(--color-backdrop-overlay)] flex items-center justify-center z-50" onClick={() => setCsvModalOpen(false)}>
          <div ref={csvDialogRef} role="dialog" aria-modal="true" aria-label="Export CSV ทุกแผ่น" tabIndex={-1} className="bg-surface-100 border border-border rounded-lg p-4 w-96 max-w-[calc(100vw-2rem)] flex flex-col gap-3 focus:outline-none" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-theme-text-primary">Export CSV ทุกแผ่น</div>
            <div className="space-y-2">
              <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
                <input
                  type="radio"
                  name="csv-export-mode"
                  checked={csvExportMode === 'separate'}
                  onChange={() => setCsvExportMode('separate')}
                  className="accent"
                />
                ทุกแผ่นแยกไฟล์ (ดาวน์โหลดเป็น .zip)
              </label>
              <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
                <input
                  type="radio"
                  name="csv-export-mode"
                  checked={csvExportMode === 'combined'}
                  onChange={() => setCsvExportMode('combined')}
                  className="accent"
                />
                ทุกแผ่นรวมเป็นไฟล์เดียว (.csv)
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCsvModalOpen(false)}
                className="h-8 px-4 rounded bg-surface-200 text-theme-text-secondary hover:bg-surface-300 text-sm">ยกเลิก</button>
              <button onClick={() => void handleExportCsv()}
                className="h-8 px-4 rounded bg-profit/95 hover:bg-profit/90 text-theme-btn-primary-fg text-sm font-semibold">ดาวน์โหลด</button>
            </div>
          </div>
        </div>
      )}

      {/* รับข้อมูลไลน์ — แผงดึงขวา (ไม่กั้นโต๊ะหลัก) */}
      {lineModal && (
        <BetLineImportModal
          lineText={lineText}
          setLineText={setLineText}
          onClose={() => {
            setLineModal(false);
            setImportResult(null);
          }}
          customers={customers}
          selectedCustomerId={selectedCustomerId}
          setSelectedCustomerId={setSelectedCustomerId}
          navigateCustomer={navigateCustomer}
          sheet={sheet}
          setSheet={setSheet}
          setSelectedGroups={setSelectedGroups}
          effectiveMaxSheets={effectiveMaxSheets}
          customerBets={customerBets}
          handleRemoveSheet={handleRemoveSheet}
          handleAddSheet={handleAddSheet}
          currentCustomer={currentCustomer}
          handleLineImport={handleLineImport}
          importResult={importResult}
          setImportResult={setImportResult}
          imgInputRef={imgInputRef}
          pdfInputRef={pdfInputRef}
          handleImageFile={handleImageFile}
          handlePdfFile={handlePdfFile}
          lineOcrEngine={lineOcrEngine}
          setLineOcrEngine={setLineOcrEngine}
          ocrLoading={ocrLoading}
          ocrError={ocrError}
          setOcrError={setOcrError}
          imageOcrSource={imageOcrSource}
          setImageOcrSource={setImageOcrSource}
          ocrServerFallbackNote={ocrServerFallbackNote}
          setOcrServerFallbackNote={setOcrServerFallbackNote}
          imgDragOver={imgDragOver}
          setImgDragOver={setImgDragOver}
          pdfLoading={pdfLoading}
          pdfDragOver={pdfDragOver}
          setPdfDragOver={setPdfDragOver}
          setPdfLoading={setPdfLoading}
        />
      )}

      {lineImportToast && (
        <div
          role="status"
          className={cn(
            'fixed bottom-safe-5 left-1/2 z-[60] flex max-w-[min(92vw,26rem)] -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 shadow-lg pointer-events-auto',
            lineImportToast.ok
              ? 'border-profit/45 bg-[var(--color-card-bg-solid)] text-profit'
              : 'border-loss/45 bg-[var(--color-card-bg-solid)] text-loss',
          )}
        >
          <span className="text-sm font-semibold leading-snug">{lineImportToast.msg}</span>
          <button
            type="button"
            onClick={() => setLineImportToast(null)}
            className="shrink-0 rounded-lg px-2 py-0.5 text-lg leading-none text-theme-text-muted hover:bg-[var(--bg-hover)] hover:text-theme-text-primary"
            aria-label="ปิดการแจ้งเตือน"
          >
            ×
          </button>
        </div>
      )}

      {/* ── Print Receipt (hidden screen, visible only @media print) ─────── */}
      <div id="bet-receipt" style={{ display: 'none' }}>
        <div className="receipt-header">
          <div className="receipt-title">{APP_BRAND_NAME}</div>
          <div className="receipt-meta">
            <span>รายการขายของลูกค้า: {currentCustomer?.name ?? '(ทั้งหมด)'}</span>
            <span>
              แผ่นที่: {sheet}/{effectiveMaxSheets}&nbsp;
              งวดประจำวันที่:&nbsp;
              {currentRound ? new Date(currentRound.draw_date).toLocaleDateString('th-TH') : '—'}
            </span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>เลข</th><th>ราคา</th>
              <th>เลข</th><th>ราคา</th>
              <th>เลข</th><th>ราคา</th>
              <th>เลข</th><th>ราคา</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((row, ri) => (
              <tr key={ri}>
                {[0, 1, 2, 3].map(ci => (
                  <>
                    <td key={`l${ci}`} style={{ fontWeight: 'bold' }}>{row[ci]?.label ?? ''}</td>
                    <td key={`p${ci}`}>{row[ci]?.price ?? ''}</td>
                  </>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="receipt-footer">
          <span>
            วันที่พิมพ์&nbsp;
            {new Date().toLocaleDateString('th-TH')}&nbsp;
            {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span>ราคารวม {printTotal.toLocaleString()}</span>
        </div>
      </div>
    </>
  );
}

