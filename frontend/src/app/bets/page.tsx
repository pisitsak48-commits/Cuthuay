'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { roundsApi, betsApi, customersApi } from '@/lib/api';
import { APP_BRAND_NAME } from '@/lib/brand';
import { Bet, Round, Customer, BET_TYPE_LABELS, DEFAULT_PAYOUT_RATES } from '@/types';
import { useAppStore, useAuthStore } from '@/store/useStore';
import { wsClient } from '@/lib/websocket';
import {
  parseBetLine, expandNumberInput, describeNumberExpansion,
  parseLineBetsTextWithSegments, parsePdfBetsText, normalizeHandwrittenSlipTableOcr, normalizeLinePasteText,
  BetInputMode,
} from '@/lib/betParser';
import { preprocessImageForOcr, makeOcrUploadFile } from '@/lib/ocrImage';
import { AppShell } from '@/components/layout/AppShell';
import { buildPrintSlipBrandStrip, openPrintPreview, slipPagination, SLIP_PRINT_GRID_OPTS } from '@/lib/printPreview';
import {
  playSaveBet,
  playImportSuccess,
  playError,
  playBlockedNumber,
  isBlockedBetApiMessage,
  speak,
  speakNumber,
  speakAmounts,
  speakQueued,
  speakAppend,
} from '@/lib/sounds';
import { cn } from '@/lib/utils';
import {
  readPanelWidth,
  writePanelWidth,
  readPanelLock,
  writePanelLock,
  STORAGE_BETS_RIGHT_PANEL_W,
  STORAGE_BETS_RIGHT_PANEL_LOCK,
} from '@/lib/panelResize';

/** ลำดับแสดงในโพยหน้ารับแทง — กระทบแทรก/สกอร์หลังบันทึกเท่านั้น (จำในเครื่อง) */
type BetSheetSortOrder = 'newestFirst' | 'oldestFirst';
const STORAGE_BETS_SHEET_SORT = 'cuthuay-bets-sheet-sort';

function readBetSheetSort(): BetSheetSortOrder {
  if (typeof window === 'undefined') return 'newestFirst';
  try {
    const v = localStorage.getItem(STORAGE_BETS_SHEET_SORT);
    return v === 'oldestFirst' ? 'oldestFirst' : 'newestFirst';
  } catch {
    return 'newestFirst';
  }
}
function writeBetSheetSort(order: BetSheetSortOrder) {
  try {
    localStorage.setItem(STORAGE_BETS_SHEET_SORT, order);
  } catch { /* ignore */ }
}

function matchesSearch(number: string, q: string): boolean {
  const trimQ = q.trim();
  if (!trimQ) return false;
  return number === trimQ;
}

function getEffectiveRate(customer: Customer | null, betType: string): number {
  if (!customer) return (DEFAULT_PAYOUT_RATES as Record<string, number>)[betType] ?? 0;
  const map: Record<string, keyof Customer> = {
    '3digit_top':    'rate_3top',
    '3digit_tote':   'rate_3tote',
    '3digit_back':   'rate_3back',
    '2digit_top':    'rate_2top',
    '2digit_bottom': 'rate_2bottom',
    '1digit_top':    'rate_1top',
    '1digit_bottom': 'rate_1bottom',
  };
  const key = map[betType];
  const raw = key ? (customer[key] as number | string | null) : null;
  const custom = raw != null ? parseFloat(String(raw)) : null;
  const fallback = (DEFAULT_PAYOUT_RATES as Record<string, number>)[betType] ?? 0;
  return (custom != null && !isNaN(custom) && custom > 0) ? custom : fallback;
}

type BulkBetsResponse = { inserted: number; errors: string[]; bets?: Bet[] };

function summarizeBulkBetsResponse(data: Partial<BulkBetsResponse> | undefined): {
  inserted: number;
  errors: string[];
  hasBlocked: boolean;
} {
  const inserted = typeof data?.inserted === 'number' ? data.inserted : 0;
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  const hasBlocked = errors.some(isBlockedBetApiMessage);
  return { inserted, errors, hasBlocked };
}

const COL_TYPES = [
  { key: '3digit_top',    label: '3 ตัวบน'  },
  { key: '3digit_tote',   label: '3 ตัวโต็ด' },
  { key: '3digit_back',   label: '3 ตัวล่าง' },
  { key: '2digit_top',    label: '2 ตัวบน'  },
  { key: '2digit_bottom', label: '2 ตัวล่าง' },
  { key: '1digit_top',    label: 'วิ่งบน'   },
  { key: '1digit_bottom', label: 'วิ่งล่าง'  },
] as const;

type ColKey = typeof COL_TYPES[number]['key'];

function buildRowFromBets(bets: Bet[]): Record<ColKey, number> {
  const row: Record<string, number> = {};
  COL_TYPES.forEach(c => { row[c.key] = 0; });
  bets.forEach(b => { if (row[b.bet_type] !== undefined) row[b.bet_type] += Number(b.amount); });
  return row as Record<ColKey, number>;
}

/** สีชิปผู้คีย์ — คงที่ต่อชื่อ (หลายคนคีย์แถวเดียวกันใช้คีย์รวมเพื่อสีไม่ชนกันง่าย) */
const KEYER_PALETTE = [
  'bg-surface-50 text-theme-text-primary border-border',
  'bg-white text-theme-text-secondary border-border',
  'bg-surface-100 text-theme-text-primary border-[var(--color-border-strong)]',
  'bg-surface-50 text-theme-text-secondary border-border',
  'bg-white text-theme-text-primary border-[var(--color-border-strong)]',
  'bg-surface-100 text-theme-text-secondary border-border',
  'bg-surface-50 text-theme-text-primary border-border',
  'bg-white text-theme-text-secondary border-[var(--color-border-strong)]',
] as const;

function keyerChipClasses(colorKey: string): string {
  if (!colorKey) return 'border border-[var(--color-border)] bg-[var(--bg-glass-subtle)] text-theme-text-muted';
  let h = 0;
  for (let i = 0; i < colorKey.length; i++) h = colorKey.charCodeAt(i) + ((h << 5) - h);
  return `border ${KEYER_PALETTE[Math.abs(h) % KEYER_PALETTE.length]}`;
}

/** สรุปผู้คีย์ต่อแถว (กลุ่มเลขเดียวกันอาจมีหลายแถวถ้าคนละยูสเซอร์) */
function aggregateKeyer(group: { bets: Bet[] }): { text: string; colorKey: string; title: string } {
  const names = [
    ...new Set(
      group.bets
        .map(b => (b.created_by_name && String(b.created_by_name).trim()) || '')
        .filter(Boolean),
    ),
  ].sort((a, b) => a.localeCompare(b, 'th'));
  if (names.length === 0) return { text: '—', colorKey: '', title: '' };
  const title = names.join(', ');
  if (names.length === 1) return { text: names[0], colorKey: names[0], title };
  if (names.length === 2) return { text: `${names[0]} · ${names[1]}`, colorKey: `${names[0]}|${names[1]}`, title };
  return { text: `${names[0]} +${names.length - 1}`, colorKey: names.join('|'), title };
}

type PrintItem = { label: string; price: string };

type PrintLine = PrintItem & { lineTotal: number };

type CsvItem = { number: string; payload: string };

function formatPrintItem(group: { number: string; bets: Bet[] }): PrintItem {
  const row = buildRowFromBets(group.bets);
  const n = group.number;
  const has3top  = row['3digit_top']    > 0;
  const has3tote = row['3digit_tote']   > 0;
  const has3back = row['3digit_back']   > 0;
  const has2top  = row['2digit_top']    > 0;
  const has2bot  = row['2digit_bottom'] > 0;
  const has1top  = row['1digit_top']    > 0;
  const has1bot  = row['1digit_bottom'] > 0;

  if (has3top || has3tote || has3back) {
    const parts = [row['3digit_top'], row['3digit_tote'], row['3digit_back']];
    while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
    return { label: n, price: parts.join('*') };
  }
  if (has2top && has2bot) return { label: n,          price: `${row['2digit_top']}*${row['2digit_bottom']}` };
  if (has2top)            return { label: `บน${n}`,   price: String(row['2digit_top']) };
  if (has2bot)            return { label: `ล่าง${n}`, price: String(row['2digit_bottom']) };
  if (has1top && has1bot) return { label: `วิ่ง${n}`, price: `${row['1digit_top']}*${row['1digit_bottom']}` };
  if (has1top)            return { label: `วิ่งบน${n}`,   price: String(row['1digit_top']) };
  if (has1bot)            return { label: `วิ่งล่าง${n}`, price: String(row['1digit_bottom']) };
  return { label: n, price: '-' };
}

function buildPrintLine(group: { number: string; bets: Bet[] }): PrintLine {
  const item = formatPrintItem(group);
  const lineTotal = group.bets.reduce((s, b) => s + Number(b.amount), 0);
  return { ...item, lineTotal };
}

function formatCsvItem(group: { number: string; bets: Bet[] }): CsvItem | null {
  const row = buildRowFromBets(group.bets);
  const n = group.number;

  const formatTriple = (a: number, b: number, c: number): string => {
    const hasA = a > 0;
    const hasB = b > 0;
    const hasC = c > 0;
    if (!hasA && !hasB && !hasC) return '';
    if (hasA && !hasB && !hasC) return String(a);
    if (!hasA && hasB && !hasC) return `*${b}`;
    if (!hasA && !hasB && hasC) return `**${c}`;
    if (hasA && hasB && !hasC) return `${a}*${b}`;
    if (hasA && !hasB && hasC) return `${a}**${c}`;
    if (!hasA && hasB && hasC) return `*${b}*${c}`;
    return `${a}*${b}*${c}`;
  };

  const has3top = row['3digit_top'] > 0;
  const has3tote = row['3digit_tote'] > 0;
  const has3back = row['3digit_back'] > 0;
  if (has3top || has3tote || has3back) {
    return { number: n, payload: formatTriple(row['3digit_top'], row['3digit_tote'], row['3digit_back']) };
  }

  const has2top = row['2digit_top'] > 0;
  const has2bottom = row['2digit_bottom'] > 0;
  if (has2top || has2bottom) {
    return { number: n, payload: formatTriple(row['2digit_top'], 0, row['2digit_bottom']) };
  }

  const has1top = row['1digit_top'] > 0;
  const has1bottom = row['1digit_bottom'] > 0;
  if (has1top || has1bottom) {
    return { number: n, payload: formatTriple(row['1digit_top'], 0, row['1digit_bottom']) };
  }

  return null;
}

// ── Microsecond-precision timestamp helpers for insert-between logic ──────────
// JS Date only has ms precision but PG timestamps have μs precision.
// Rows inserted in bulk can differ by only a few μs → need sub-ms handling.
type MicroTs = { ms: number; sub: number }; // ms = epoch-ms, sub = extra-μs (0–999)
function tsToMicroTs(ts: string): MicroTs {
  // PG returns '2026-04-11 15:51:23.123456+07' — fix space→T and bare +07→+07:00
  let s = ts.replace(' ', 'T');
  s = s.replace(/([+-]\d{2})$/, '$1:00');
  const ms = Date.parse(s);
  if (isNaN(ms)) return { ms: 0, sub: 0 };
  const dotIdx = ts.indexOf('.');
  if (dotIdx < 0) return { ms, sub: 0 };
  let end = ts.length;
  for (let i = dotIdx + 1; i < ts.length; i++) {
    if (ts[i] === 'Z' || ts[i] === '+' || (ts[i] === '-' && i > dotIdx + 1)) { end = i; break; }
  }
  const frac = (ts.slice(dotIdx + 1, end) + '000000').slice(0, 6);
  return { ms, sub: parseInt(frac, 10) % 1000 };
}
function microMid(a: MicroTs, b: MicroTs): MicroTs {
  if (a.ms === b.ms) return { ms: a.ms, sub: Math.floor((a.sub + b.sub) / 2) };
  return { ms: Math.floor((a.ms + b.ms) / 2), sub: 0 };
}
function microSub1(t: MicroTs): MicroTs { return t.sub > 0 ? { ms: t.ms, sub: t.sub - 1 } : { ms: t.ms - 1, sub: 999 }; }
function microLt(a: MicroTs, b: MicroTs): boolean { return a.ms < b.ms || (a.ms === b.ms && a.sub < b.sub); }
function microToIso(t: MicroTs): string {
  return new Date(t.ms).toISOString().slice(0, -1) + t.sub.toString().padStart(3, '0') + 'Z';
}
// Normalize any PG timestamp string to ISO 8601 (for sending back to backend)
function pgTsToIso(ts: string): string {
  return microToIso(tsToMicroTs(ts));
}

type BetSheetGroup = { entryKey: string; createdAt: string; number: string; bets: Bet[]; sortOrder: number };

function groupByEntry(bets: Bet[]): BetSheetGroup[] {
  const map: Record<string, Bet[]> = {};
  const firstSeen: Record<string, string> = {};
  bets.forEach(b => {
    const batch = b.import_batch_id != null && String(b.import_batch_id).trim().length > 0
      ? String(b.import_batch_id)
      : null;
    const seg = Number(b.segment_index ?? 0);
    const key = batch
      ? `b:${batch}:s${seg}:n${b.number}`
      : seg > 0
        ? `seg:${b.created_at.slice(0, 19)}:${seg}:n${b.number}`
        : `legacy:${b.created_at.slice(0, 19)}:n${b.number}`;
    if (!map[key]) { map[key] = []; firstSeen[key] = b.created_at; }
    map[key].push(b);
    if (b.created_at < firstSeen[key]) firstSeen[key] = b.created_at;
  });
  return Object.entries(map).map(([key, grp]) => ({
    entryKey: key,
    createdAt: grp[0].created_at.slice(0, 19),
    number: grp[0].number,
    bets: grp,
    sortOrder: Math.min(...grp.map(b => b.sort_order ?? (new Date(b.created_at.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')).getTime()))),
  }));
}

function sortBetSheetGroups(groups: BetSheetGroup[], order: BetSheetSortOrder): BetSheetGroup[] {
  return [...groups].sort((a, b) =>
    order === 'newestFirst' ? b.sortOrder - a.sortOrder : a.sortOrder - b.sortOrder,
  );
}

type ChangeMarker = {
  number: string;
  sortOrder: number;
  importBatchId?: string | null;
  segmentIndex?: number;
};

/** หา marker ไฮไลต์แถวจากผล bulk insert (เลขชุดเดียวกับที่เพิ่งคีย์) */
function markerFromInsertedBets(apiBets: Bet[] | undefined, lineNumber: string): ChangeMarker | null {
  if (!apiBets?.length) return null;
  const matching = apiBets.filter(b => b.number === lineNumber);
  const list = matching.length ? matching : apiBets;
  const first = list[0];
  const orders = list
    .map(b => b.sort_order)
    .filter((x): x is number => x != null && !isNaN(Number(x)));
  const sortOrder = orders.length
    ? Math.min(...orders.map(Number))
    : (first.sort_order != null ? Number(first.sort_order) : Date.now());
  return {
    number: lineNumber,
    sortOrder,
    importBatchId: first.import_batch_id ?? null,
    segmentIndex: first.segment_index ?? 0,
  };
}

const LINE_OCR_ENGINE_STORAGE_KEY = 'cuthuay-line-ocr-engine';
type LineOcrEngineChoice = 'auto' | 'google-vision' | 'paddle' | 'browser';

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
  const [rounds, setRounds]                         = useState<Round[]>([]);
  /** ค่าเริ่มต้น: เลือกได้เฉพาะงวด open — ติ๊กเพิ่มเพื่อแสดมงวดปิด/ออกผล (ไม่รวม archived) */
  const [roundPickerShowAll, setRoundPickerShowAll] = useState(false);
  const [selectedRoundId, setSelectedRoundId]       = useState('');
  const [savedBets, setSavedBets]                   = useState<Bet[]>([]);
  const [customers, setCustomers]                   = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [loading, setLoading]         = useState(false);
  const [isSaving, setIsSaving]       = useState(false);
  const { setSelectedRound }          = useAppStore();
  const isAdmin                       = useAuthStore((s) => s.user?.role === 'admin');

  const [numInput, setNumInput]       = useState('');
  const [amtInput, setAmtInput]       = useState('');
  const [parseError, setParseError]   = useState('');
  const [numHint, setNumHint]         = useState('');
  const [inputMode, setInputMode]     = useState<BetInputMode>('2digit');
  const [isKlap, setIsKlap]           = useState(false);
  const [activeField, setActiveField] = useState<'num' | 'amt'>('num');
  const [numWidth, setNumWidth]       = useState(176);
  const [inputFs, setInputFs]         = useState(48);   // font-size px for the two main inputs
  const [rowFs, setRowFs]             = useState(12);    // font-size px for the bet list table rows
  const [sumFs, setSumFs]             = useState(12);    // font-size px for the right summary panel
  /** แผงขวา (สรุปยอด) — ลากขอบซ้ายของแผงปรับความกว้าง บนจอ ≥xl */
  const liveRightPanelWRef              = useRef(288);
  const [rightPanelPx, setRightPanelPx] = useState(() => {
    const w = readPanelWidth(STORAGE_BETS_RIGHT_PANEL_W, 288);
    liveRightPanelWRef.current = w;
    return w;
  });
  const [rightPanelLocked, setRightPanelLocked] = useState(() => readPanelLock(STORAGE_BETS_RIGHT_PANEL_LOCK));
  const rightResizeDrag                 = useRef<{ startX: number; startW: number } | null>(null);
  const [soundOn, setSoundOn]         = useState(true);  // เปิด/ปิดเสียง TTS
  const [speechRate, setSpeechRate]   = useState(2.2);   // ความเร็วเสียงพูด
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
  const [lineModal, setLineModal]     = useState(false);
  const [lineText, setLineText]       = useState('');
  const [importResult, setImportResult] = useState<{ ok: boolean; msg: string } | null>(null);
  /** ไฮไลต์แถวจากการนำเข้าไลน์ล่าสุด (import_batch_id เดียวกัน) */
  const [lineImportHighlightBatchId, setLineImportHighlightBatchId] = useState<string | null>(null);
  /** หลังนำเข้าสำเร็จแผงไลน์หุบ — แจ้งผลที่โต๊ะหลัก */
  const [lineImportToast, setLineImportToast] = useState<{ ok: boolean; msg: string } | null>(null);
  const [ocrLoading, setOcrLoading]   = useState(false);
  const [ocrError, setOcrError]       = useState('');
  /** โหมดอัตโนมัติ: เซิร์ฟเวอร์ไม่ได้ข้อความ แต่ Tesseract อ่านได้ — แสดงเหตุผลจาก API */
  const [ocrServerFallbackNote, setOcrServerFallbackNote] = useState<string | null>(null);
  /** รอบล่าสุดของอัปโหลดรูปในโมดัล — Paddle / Vision / Tesseract */
  const [imageOcrSource, setImageOcrSource] = useState<null | 'paddle' | 'google-vision' | 'tesseract'>(null);
  const [lineOcrEngine, setLineOcrEngine] = useState<LineOcrEngineChoice>(() => readInitialLineOcrEngine());
  const [imgDragOver, setImgDragOver] = useState(false);
  const [pdfLoading, setPdfLoading]   = useState(false);
  const [pdfDragOver, setPdfDragOver] = useState(false);
  const [searchQ, setSearchQ]         = useState('');
  const [activeSearchMatchPos, setActiveSearchMatchPos] = useState(-1);
  const [betSheetSort, setBetSheetSort] = useState<BetSheetSortOrder>(() => readBetSheetSort());
  const [recentChangedMarker, setRecentChangedMarker] = useState<ChangeMarker | null>(null);
  const [recentChangedKey, setRecentChangedKey] = useState<string | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvExportMode, setCsvExportMode] = useState<'separate' | 'combined'>('separate');

  const numRef      = useRef<HTMLInputElement>(null);
  const amtRef      = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  /** รวมรีเฟรชจาก WebSocket หลังบันทึกเอง — กันสองรอบติดกันดีด scroll / กระพริบตาราง */
  const wsSilentFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging     = useRef(false);
  const numSpeakTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amtSpeakTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundOnRef     = useRef(true);
  const speechRateRef  = useRef(2.2);

  // keep refs in sync with state
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);

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

  // Escape key to clear selection
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
      if (editInlineKey) {
        setEditInlineKey(null); setEditInlineCreatedAt('');
        setNumInput(''); setAmtInput(''); setParseError('');
      } else { setSelectedGroups(new Set()); lastClickedIdxRef.current = -1; setFocusedIdx(-1); }
    }
      // Arrow/Enter row navigation (only when not typing in an input)
      if (document.activeElement && ['INPUT','TEXTAREA','SELECT'].includes(document.activeElement.tagName)) return;
      if ((e.key === 'Enter' || e.key === 'ArrowDown') && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setFocusedIdx(prev => {
          const next = Math.min(prev + 1, sheetGroupedRef.current.length - 1);
          scrollRowIntoView(next);
          return next;
        });
      }
      if (e.key === 'ArrowUp' && !e.altKey && !e.metaKey) {
        e.preventDefault();
        setFocusedIdx(prev => {
          const next = Math.max(prev - 1, 0);
          scrollRowIntoView(next);
          return next;
        });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
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
  }, [savedBets, betSheetSort]);

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

  const tts = (text: string) => { if (soundOnRef.current) speak(text, speechRateRef.current); };
  const ttsNumber = (num: string) => { if (soundOnRef.current) speakNumber(num, speechRateRef.current); };
  const ttsAmounts = (amt: string, mode: 'run' | '2digit' | '3digit') => { if (soundOnRef.current) speakAmounts(amt, mode, speechRateRef.current); };

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

  const fetchRounds = useCallback(async () => {
    const res = await roundsApi.list();
    setRounds(res.data.rounds ?? []);
  }, []);

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
    if (!pool.length) {
      if (selectedRoundId) setSelectedRoundId('');
      return;
    }
    const ok = Boolean(selectedRoundId && pool.some((r) => r.id === selectedRoundId));
    if (!ok) setSelectedRoundId(pool[0].id);
  }, [rounds, showClosedRoundsInPicker, selectedRoundId]);

  const fetchBets = useCallback(async (opts?: { silent?: boolean }) => {
    if (!selectedRoundId) return;
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const res = await betsApi.list(selectedRoundId);
      setSavedBets(res.data.bets);
    } catch { /* silent refresh failure */ }
    finally {
      if (!silent) setLoading(false);
    }
  }, [selectedRoundId]);

  const queueSilentFetchFromWs = useCallback(() => {
    if (wsSilentFetchTimerRef.current) clearTimeout(wsSilentFetchTimerRef.current);
    wsSilentFetchTimerRef.current = setTimeout(() => {
      wsSilentFetchTimerRef.current = null;
      void fetchBets({ silent: true });
    }, 180);
  }, [fetchBets]);

  const fetchCustomers = useCallback(async () => {
    const res = await customersApi.list();
    setCustomers(res.data.customers);
  }, []);

  useEffect(() => { fetchRounds(); fetchCustomers(); }, []);
  // Auto-select first customer when list loads and none is selected
  useEffect(() => {
    if (customers.length > 0 && !selectedCustomerId) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers]);
  useEffect(() => {
    fetchBets();
    const round = rounds.find(r => r.id === selectedRoundId);
    setSelectedRound(round ?? null);
  }, [selectedRoundId, rounds]);

  useEffect(() => {
    const u1 = wsClient.on('bet_added',       queueSilentFetchFromWs);
    const u2 = wsClient.on('bets_bulk_added', queueSilentFetchFromWs);
    const u3 = wsClient.on('bet_deleted',     queueSilentFetchFromWs);
    return () => {
      u1(); u2(); u3();
      if (wsSilentFetchTimerRef.current) {
        clearTimeout(wsSilentFetchTimerRef.current);
        wsSilentFetchTimerRef.current = null;
      }
    };
  }, [queueSilentFetchFromWs]);

  // Default to latest sheet of selected customer
  useEffect(() => {
    const customerBets = selectedCustomerId
      ? savedBets.filter(b => b.customer_id === selectedCustomerId)
      : [];
    const latestSheet = customerBets.length
      ? Math.max(...customerBets.map(b => b.sheet_no ?? 1))
      : 1;
    setSheet(latestSheet);
    setMaxSheets(latestSheet);
    setSelectedGroups(new Set());
  }, [selectedCustomerId, savedBets]);

  const currentCustomer = customers.find(c => c.id === selectedCustomerId) ?? null;
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

  const onNumChange = (v: string) => {
    // Allow digits, *, - only (for wildcards, range, klap patterns)
    const filtered = v.replace(/[^0-9*\-]/g, '').slice(0, 3);
    const prevFiltered = numInput;
    setNumInput(filtered); setParseError('');
    if (numSpeakTimer.current) { clearTimeout(numSpeakTimer.current); numSpeakTimer.current = null; }
    if (!filtered.trim()) { setNumHint(''); setInputMode('2digit'); setIsKlap(false); return; }
    // พูดเฉพาะตัวอักษรที่เพิ่งพิมพ์ใหม่ ไม่พูดสะสม ไม่พูดตอนลบ
    if (filtered.length > prevFiltered.length) {
      const newChars = filtered.slice(prevFiltered.length).replace(/\D/g, '');
      if (newChars) numSpeakTimer.current = setTimeout(() => ttsNumber(newChars), 150);
    }
    setNumHint(describeNumberExpansion(filtered));
    const expanded = expandNumberInput(filtered);
    if (expanded) { setInputMode(expanded.mode); setIsKlap(!!expanded.isKlap); }
  };

  const onAmtChange = (v: string) => {
    // Allow digits, *, +, - only
    const filtered = v.replace(/[^0-9*+\-]/g, '');
    const klapAmt = filtered.trim().endsWith('-');
    setAmtInput(filtered);
    const klapNum = !!expandNumberInput(numInput)?.isKlap;
    setIsKlap(klapAmt || klapNum);
    if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!filtered.trim() || !numInput.trim()) { setParseError(''); return; }
    // *xxx- = กลับโต๊ด → auto-commit → speak "กลับ"
    if (klapAmt) { setTimeout(() => { void commitLineWith(numInput, filtered, 'กลับ', true); }, 0); return; }
    if (klapNum && filtered.trim() && parseFloat(filtered.trim()) > 0) {
      // number-field klap: auto-commit on Enter via onAmtKeyDown, just preview here
    }
    // เสียง: พูดเลขปัจจุบันหลังหยุดพิม, พูด "คูณ" หลังยอดก่อนหน้า (ถ้ายังไม่ทันพูดจาก debounce)
    const hadPendingAmtTts = amtSpeakTimer.current != null;
    if (amtSpeakTimer.current) { clearTimeout(amtSpeakTimer.current); amtSpeakTimer.current = null; }
    const newChar = filtered.length > amtInput.length ? filtered.slice(amtInput.length) : '';
    if (newChar === '*') {
      if (soundOnRef.current) {
        const before = filtered.slice(0, -1).replace(/-$/, '');
        const parts = before.split('*');
        const seg = parts[parts.length - 1]?.trim() ?? '';
        if (seg && /\d/.test(seg)) {
          if (hadPendingAmtTts) speakQueued(seg, 'คูณ', speechRateRef.current);
          else if (typeof window !== 'undefined' && window.speechSynthesis.speaking) {
            speakAppend('คูณ', speechRateRef.current);
          } else {
            tts('คูณ');
          }
        } else {
          tts('คูณ');
        }
      }
    } else if (filtered.length > amtInput.length) {
      const segments = filtered.replace(/-$/, '').split('*');
      const currentSeg = segments[segments.length - 1];
      if (currentSeg) amtSpeakTimer.current = setTimeout(() => { tts(currentSeg); amtSpeakTimer.current = null; }, 400);
    }
    const result = parseBetLine(numInput, filtered);
    setParseError(result.error ?? '');
  };

  const onNumKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
      if (!expandNumberInput(numInput)) { setParseError('รูปแบบเลขไม่ถูกต้อง'); return; }
      if (numSpeakTimer.current) { clearTimeout(numSpeakTimer.current); numSpeakTimer.current = null; }
      tts('ยอด');
      setActiveField('amt');
      setTimeout(() => { amtRef.current?.focus(); amtRef.current?.select(); }, 0);
    }
  };

  const onAmtKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); if (editInlineKey) { void saveInlineEdit(); } else { commitLine(); } }
    // กด - ตอนคาดดำทั้งหมด → กลับเลข (klap) ทันที
    if (e.key === '-') {
      const el = e.currentTarget;
      if (el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length) {
        e.preventDefault(); void commitLineWith(numInput, el.value + '-', 'กลับ', true); return;
      }
    }
    if (e.key === 'Tab') { e.preventDefault(); setActiveField('num'); setTimeout(() => numRef.current?.focus(), 0); }
  };

  const commitLineWith = async (num: string, amt: string, voice = 'บันทึก', keepAmt = false, insertBeforeKey?: string) => {
    if (!num.trim() || !amt.trim()) return;
    if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!selectedRoundId) { setParseError('กรุณาเลือกงวดก่อน'); return; }
    const result = parseBetLine(num, amt);
    if (result.error || !result.bets.length) { setParseError(result.error ?? 'ไม่มีรายการ'); return; }

    // Compute insert sort_order if inserting before a specific row
    let insertSortOrder: number | undefined;
    if (insertBeforeKey) {
      const targetIdx = sheetGrouped.findIndex(g => groupKey(g) === insertBeforeKey);
      if (targetIdx >= 0) {
        const targetOrder = sheetGrouped[targetIdx].sortOrder;
        if (betSheetSort === 'newestFirst') {
          if (targetIdx > 0) {
            const newerOrder = sheetGrouped[targetIdx - 1].sortOrder;
            insertSortOrder = (newerOrder + targetOrder) / 2;
          } else {
            insertSortOrder = targetOrder + 2000;
          }
        } else {
          const prevOrder = targetIdx > 0 ? sheetGrouped[targetIdx - 1].sortOrder : targetOrder - 2000;
          insertSortOrder = (prevOrder + targetOrder) / 2;
        }
      }
    }

    // เก็บตำแหน่งสกอร์เฉพาะโหมดล่าสุดล่าง — โหมดล่าสุดบนแถวใหม่อยู่บนสุด ไม่ควรคืนสกอร์กลางจอ
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
      await fetchBets({ silent: true });
      if (insertedMarker) setRecentChangedMarker(insertedMarker);
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumber();
      else if (sum.inserted === 0 && sum.errors.length) playError();

      if (sum.inserted > 0) {
        playSaveBet();
        tts(voice);
        if (numSpeakTimer.current) { clearTimeout(numSpeakTimer.current); numSpeakTimer.current = null; }
        if (amtSpeakTimer.current) { clearTimeout(amtSpeakTimer.current); amtSpeakTimer.current = null; }
        setNumInput(''); setAmtInput(keepAmt ? amt.replace(/-$/, '') : ''); setParseError(errTxt); setNumHint(''); setActiveField('num');
        setSelectedGroups(new Set());
        setTimeout(() => numRef.current?.focus(), 0);
      } else {
        setParseError(errTxt || 'ไม่มีรายการถูกบันทึก (เช็คเลขปิดหรือรูปแบบ)');
        setTimeout(() => numRef.current?.focus(), 0);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (isBlockedBetApiMessage(msg)) playBlockedNumber();
      else playError();
      setParseError(msg);
    }
    finally { setIsSaving(false); }
  };

  const commitLine = () => {
    const voice = isKlap || amtInput.trim().endsWith('-') ? 'กลับ' : 'บันทึก';
    void commitLineWith(numInput, amtInput, voice, true);
  };

  const deleteSavedGroup = async (bets: Bet[]) => {
    if (!confirm('ลบโพยนี้?')) return;
    try {
      await betsApi.bulkDelete(bets.map(b => b.id));
      await fetchBets({ silent: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string }; status?: number } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
      playError();
      alert(`ลบไม่สำเร็จ: ${msg}`);
    }
  };

  const deleteSelectedGroups = async () => {
    if (selectedGroups.size === 0) return;
    if (!confirm(`ลบ ${selectedGroups.size} รายการที่เลือก?`)) return;
    try {
      const toDelete = sheetGrouped.filter(g => selectedGroups.has(groupKey(g)));
      await betsApi.bulkDelete(toDelete.flatMap(g => g.bets.map(b => b.id)));
      setSelectedGroups(new Set());
      await fetchBets({ silent: true });
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string }; status?: number } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'ลบไม่สำเร็จ');
      playError();
      alert(`ลบไม่สำเร็จ: ${msg}`);
    }
  };

  const moveSelectedGroups = async (targetSheet: number) => {
    if (selectedGroups.size === 0) return;
    const toMove = sheetGrouped.filter(g => selectedGroups.has(groupKey(g)));
    const ids = toMove.flatMap(g => g.bets.map(b => b.id));
    const isCustomerChange = moveTargetCustomerId !== '__same__';
    if (isCustomerChange) {
      const targetCust = customers.find(c => c.id === moveTargetCustomerId);
      await betsApi.moveSheet(ids, targetSheet, moveTargetCustomerId || null, targetCust?.name ?? null);
    } else {
      await betsApi.moveSheet(ids, targetSheet);
    }
    setSelectedGroups(new Set());
    setMoveModal(false);
    await fetchBets({ silent: true });
  };

  const handleAddSheet = () => {
    const next = effectiveMaxSheets + 1;
    setMaxSheets(next);
    setSheet(next);
    setSelectedGroups(new Set());
  };

  const handleRemoveSheet = () => {
    const betsInSheet = savedBets.filter(b => (b.sheet_no ?? 1) === sheet);
    if (betsInSheet.length > 0) {
      alert(`แผ่นที่ ${sheet} มีข้อมูล ${betsInSheet.length} รายการ — ลบข้อมูลในแผ่นนี้ก่อน`);
      return;
    }
    if (effectiveMaxSheets <= 1) return;
    const newMax = effectiveMaxSheets - 1;
    setMaxSheets(newMax);
    if (sheet > newMax) setSheet(newMax);
    setSelectedGroups(new Set());
  };

  const loadForEdit = () => {
    if (selectedGroups.size !== 1) return;
    const key = Array.from(selectedGroups)[0];
    const group = sheetGrouped.find(g => groupKey(g) === key);
    if (!group) return;
    const preserveTs = group.bets.reduce((min, b) => b.created_at < min ? b.created_at : min, group.bets[0].created_at);
    const row = buildRowFromBets(group.bets);
    const expanded = expandNumberInput(group.number);
    let amtStr = '';
    if (expanded) {
      const m = expanded.mode;
      setInputMode(m);
      if (m === 'run')        amtStr = `${row['1digit_top']}+${row['1digit_bottom']}`;
      else if (m === '2digit') amtStr = `${row['2digit_top']}+${row['2digit_bottom']}`;
      else                     amtStr = `${row['3digit_top']}+${row['3digit_tote']}+${row['3digit_back']}`;
    }
    setNumInput(group.number);
    setAmtInput(amtStr);
    setEditInlineKey(key);
    setEditInlineCreatedAt(preserveTs);
    setTimeout(() => { amtRef.current?.focus(); amtRef.current?.select(); }, 0);
  };

  const saveInlineEdit = async () => {
    if (!editInlineKey || !editInlineCreatedAt || !selectedRoundId) return;
    const group = sheetGrouped.find(g => groupKey(g) === editInlineKey);
    if (!group) return;
    await replaceGroupWithValues(group, numInput, amtInput, true);
  };

  const replaceGroupWithValues = async (
    group: BetSheetGroup,
    nextNum: string,
    nextAmt: string,
    clearInputsAfter: boolean
  ) => {
    if (!selectedRoundId) return;
    if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!nextNum.trim() || !nextAmt.trim()) { setParseError('กรอกเลขและราคาให้ครบ'); return; }

    const result = parseBetLine(nextNum, nextAmt);
    if (result.error || !result.bets.length) { setParseError(result.error ?? 'ไม่มีรายการ'); return; }
    const preserveSortOrder = group.bets.reduce((min, b) => (b.sort_order !== null && b.sort_order !== undefined) ? Math.min(min, b.sort_order) : min, group.bets[0].sort_order ?? Date.now());
    const refBet = group.bets[0];
    const preserveImport =
      refBet?.import_batch_id != null && String(refBet.import_batch_id).length > 0
        ? { import_batch_id: refBet.import_batch_id, segment_index: refBet.segment_index ?? 0 }
        : {};
    holdCurrentScrollPosition();
    setIsSaving(true);
    try {
      await betsApi.bulkDelete(group.bets.map(b => b.id));
      const bulkRes = await betsApi.bulk(selectedRoundId, result.bets.map(bet => ({
        number: bet.number, bet_type: bet.bet_type, amount: bet.amount,
        payout_rate: getEffectiveRate(currentCustomer, bet.bet_type),
        customer_id: selectedCustomerId || null,
        customer_ref: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name ?? null) : null,
        sheet_no: sheet,
        sort_order: preserveSortOrder,
        ...preserveImport,
      })));
      const sum = summarizeBulkBetsResponse(bulkRes.data as BulkBetsResponse);
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumber();
      else if (sum.inserted === 0 && sum.errors.length) playError();

      if (sum.inserted > 0) {
        setEditInlineKey(null); setEditInlineCreatedAt('');
        if (clearInputsAfter) {
          setNumInput(''); setAmtInput('');
        }
        setParseError(errTxt);
        setSelectedGroups(new Set());
        await fetchBets({ silent: true });
        const m = markerFromInsertedBets((bulkRes.data as BulkBetsResponse).bets, result.bets[0].number);
        if (m) setRecentChangedMarker(m);
        playSaveBet();
        tts(isKlap || nextAmt.trim().endsWith('-') ? 'กลับ' : 'บันทึก');
        setTimeout(() => numRef.current?.focus(), 0);
      } else {
        setEditInlineKey(null); setEditInlineCreatedAt('');
        setParseError(errTxt || 'ไม่มีรายการถูกบันทึก — โพยเดิมถูกลบแล้ว กรุณาคีย์ใหม่');
        await fetchBets({ silent: true });
        setTimeout(() => numRef.current?.focus(), 0);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (isBlockedBetApiMessage(msg)) playBlockedNumber();
      else playError();
      setParseError(msg);
      setEditInlineKey(null); setEditInlineCreatedAt('');
      await fetchBets({ silent: true });
    } finally { setIsSaving(false); }
  };

  const handleEditAction = () => {
    if (selectedGroups.size !== 1) return;

    if (numInput.trim() && amtInput.trim()) {
      const key = Array.from(selectedGroups)[0];
      const group = sheetGrouped.find(g => groupKey(g) === key);
      if (!group) return;
      void replaceGroupWithValues(group, numInput, amtInput, false);
      return;
    }

    loadForEdit();
  };

  const savedTotal = savedBets.reduce((s, b) => s + Number(b.amount), 0);

  const summaryByType: Record<string, number> = {};
  COL_TYPES.forEach(c => { summaryByType[c.key] = 0; });
  savedBets.forEach(b => { if (summaryByType[b.bet_type] !== undefined) summaryByType[b.bet_type] += Number(b.amount); });

  const customerSavedByType: Record<string, number> = {};
  COL_TYPES.forEach(c => { customerSavedByType[c.key] = 0; });
  if (selectedCustomerId) {
    savedBets.forEach(b => {
      if (b.customer_id === selectedCustomerId && customerSavedByType[b.bet_type] !== undefined) {
        customerSavedByType[b.bet_type] += Number(b.amount);
      }
    });
  }
  const customerSavedTotal = Object.values(customerSavedByType).reduce((a, v) => a + v, 0);

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
      await fetchBets({ silent: true });
      if (sum.inserted > 0 && apiBets?.length) {
        const firstNum = parsedBets[0]?.number ?? '';
        const m = firstNum ? markerFromInsertedBets(apiBets, firstNum) : null;
        if (m) setRecentChangedMarker(m);
      }
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumber();
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

  const applyOcrRawToLineText = (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) return false;
    const tableNorm = normalizeHandwrittenSlipTableOcr(trimmed);
    let { parsedCount, extractedLines } = parsePdfBetsText(tableNorm);
    if (parsedCount === 0) ({ parsedCount, extractedLines } = parsePdfBetsText(trimmed));
    if (parsedCount === 0) {
      setLineText(prev => (prev ? prev + '\n' + trimmed : trimmed));
    } else {
      setLineText(prev => (prev ? prev + '\n' + extractedLines : extractedLines));
    }
    return true;
  };

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { setOcrError('กรุณาเลือกไฟล์รูปภาพ'); return; }
    setOcrLoading(true);
    setOcrError('');
    setImageOcrSource(null);
    setOcrServerFallbackNote(null);
    /** โหมด Vision/Paddle เท่านั้น = ไม่สำรองด้วย Tesseract (ไม่งั้นจะดูเหมือน “เลือก Vision แต่ตัวอื่นทำงาน”) */
    const allowLocalTesseract = lineOcrEngine === 'auto' || lineOcrEngine === 'browser';
    let serverHint = '';
    let serverEmptyDetail = '';
    try {
      let raw = '';
      let serverLabel: null | 'paddle' | 'google-vision' = null;
      let rawFromTesseract = false;
      if (lineOcrEngine !== 'browser') {
        try {
          const { api } = await import('@/lib/api');
          const formData = new FormData();
          const uploadFile = await makeOcrUploadFile(file);
          formData.append('file', uploadFile);
          formData.append('ocrEngine', lineOcrEngine);
          /** ส่งพารามิเตอร์ใน query ด้วย — กันบางพร็อกซีตัดฟิลด์ใน multipart */
          const ocrQ = `?ocrEngine=${encodeURIComponent(lineOcrEngine)}`;
          const res = await api.post<{ text?: string; engine?: string; message?: string; error?: string }>(
            `/bets/ocr-image${ocrQ}`,
            formData,
            {
              timeout: 120_000,
              transformRequest: [
                (data, headers) => {
                  if (typeof FormData !== 'undefined' && data instanceof FormData) {
                    const h = headers as unknown as { delete?: (name: string) => void };
                    if (typeof h?.delete === 'function') h.delete('Content-Type');
                  }
                  return data;
                },
              ],
            },
          );
          const payload = res.data ?? {};
          raw = String(payload.text ?? '').trim();
          const eng = String(payload.engine ?? '');
          const srvMsg = [payload.message, payload.error].find((x) => typeof x === 'string' && x.trim()) as
            | string
            | undefined;
          if (raw.length > 0) {
            if (eng && eng !== 'none') {
              if (eng === 'google-vision') serverLabel = 'google-vision';
              else if (eng.includes('paddle')) serverLabel = 'paddle';
            } else if (lineOcrEngine === 'google-vision') {
              serverLabel = 'google-vision';
            } else if (lineOcrEngine === 'paddle') {
              serverLabel = 'paddle';
            }
          } else if (srvMsg) {
            serverHint = srvMsg;
            serverEmptyDetail = srvMsg;
          }
        } catch (e: unknown) {
          const ax = e as { response?: { data?: { message?: string; error?: string } }; message?: string };
          const d = ax.response?.data;
          const fromBody = [d?.message, d?.error].find((x) => typeof x === 'string' && x.trim()) as string | undefined;
          if (!allowLocalTesseract) {
            serverHint =
              fromBody ||
              ax.message ||
              'เชื่อมต่อ API ไม่สำเร็จ (เครือข่าย/ล็อกอินหมดอายุ/เซิร์ฟเวอร์)';
          } else {
            serverHint = fromBody || ax.message || '';
          }
        }
      }

      if (!raw && allowLocalTesseract) {
        const blob = await preprocessImageForOcr(file);
        const { createWorker, PSM } = await import('tesseract.js');
        const worker = await createWorker('eng');
        await worker.setParameters({
          tessedit_pageseg_mode: PSM.SPARSE_TEXT,
          user_defined_dpi: '360',
          tessedit_char_whitelist: '0123456789=+*-xX×.:_/|\\{}# ',
        });
        const { data: { text } } = await worker.recognize(blob);
        await worker.terminate();
        raw = text.trim();
        rawFromTesseract = true;
      }

      if (!raw) {
        playError();
        if (!allowLocalTesseract) {
          setOcrError(
            serverHint
              ? `${serverHint} · โหมดนี้ใช้เซิร์ฟเวอร์เท่านั้น — ไม่ได้เรียก Tesseract ในเครื่อง (ถ้าต้องการสำรองอัตโนมัติให้เลือก “อัตโนมัติ”)`
              : 'เซิร์ฟเวอร์ OCR ไม่คืนข้อความหรือเชื่อมต่อ API ไม่สำเร็จ · โหมดนี้ไม่สำรองด้วย Tesseract — ตรวจ GOOGLE_APPLICATION_CREDENTIALS / เครือข่าย หรือเลือก “อัตโนมัติ”',
          );
        } else {
          setOcrError(
            serverHint
              ? `${serverHint} · ลอง Tesseract แล้วไม่พบข้อความ`
              : 'ไม่พบข้อความในรูป (เซิร์ฟเวอร์และ Tesseract ไม่ได้ข้อความ)',
          );
        }
        return;
      }
      applyOcrRawToLineText(raw);
      setImageOcrSource(serverLabel ?? 'tesseract');
      if (rawFromTesseract && allowLocalTesseract && serverEmptyDetail) {
        setOcrServerFallbackNote(serverEmptyDetail);
      } else {
        setOcrServerFallbackNote(null);
      }
    } catch {
      playError();
      setOcrError('อ่านรูปไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setOcrLoading(false);
    }
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

  // Customer-specific bets — memo กันสร้างอาร์เรย์ใหม่ทุก keystroke (ลดรีเรนเดอร์ตารางโพย)
  const customerBets = useMemo(() => {
    if (!selectedCustomerId) return savedBets;
    return savedBets.filter(b => b.customer_id === selectedCustomerId);
  }, [savedBets, selectedCustomerId]);

  // Max sheet for current customer
  const maxSheetFromData = customerBets.length
    ? Math.max(...customerBets.map(b => b.sheet_no ?? 1))
    : 1;
  // effectiveMaxSheets = ใช้ค่า maxSheets (เพิ่มชั่วคราว) หรือ data หากมากกว่า
  const effectiveMaxSheets = Math.max(maxSheets, maxSheetFromData);

  const sheetByType: Record<string, number> = {};
  COL_TYPES.forEach(c => { sheetByType[c.key] = 0; });
  customerBets.filter(b => (b.sheet_no ?? 1) === sheet).forEach(b => {
    if (sheetByType[b.bet_type] !== undefined) sheetByType[b.bet_type] += Number(b.amount);
  });
  const sheetTotal = Object.values(sheetByType).reduce((a, v) => a + v, 0);

  // Filter grouped by current sheet AND current customer
  const groupKey = (g: BetSheetGroup) => g.entryKey;
  const sheetGroupedBase = useMemo(
    () => groupByEntry(customerBets.filter(b => (b.sheet_no ?? 1) === sheet)),
    [customerBets, sheet],
  );
  const sheetGrouped = useMemo(
    () => sortBetSheetGroups(sheetGroupedBase, betSheetSort),
    [sheetGroupedBase, betSheetSort],
  );
  sheetGroupedRef.current = sheetGrouped;
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
      setSelectedGroups(new Set([groupKey(sheetGrouped[nextIdx])]));
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

    const key = groupKey(sheetGrouped[idx]);
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
  const printItems = sheetGrouped.map(formatPrintItem);
  const printLines = sheetGrouped.map(buildPrintLine);
  const printTotal = customerBets.filter(b => (b.sheet_no ?? 1) === sheet)
    .reduce((s, b) => s + Number(b.amount), 0);
  const currentRound = rounds.find(r => r.id === selectedRoundId);
  const printRows: PrintItem[][] = [];
  for (let i = 0; i < printItems.length; i += 4) printRows.push(printItems.slice(i, i + 4));

  const handlePrint = () => {
    if (!printLines.length) return;
    const customerName = currentCustomer?.name ?? 'ไม่ระบุลูกค้า';
    const roundName   = currentRound?.name ?? 'ไม่ระบุงวด';
    const printDate   = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const COLS = 4;
    const FONT_PX = 14;
    const total = printLines.length;
    const { rowsPerPage, pageCapacity, totalPages } = slipPagination(total, COLS, {
      ...SLIP_PRINT_GRID_OPTS,
      fontPx: FONT_PX,
    });
    const thinBorder = 'border:1px solid rgba(0,0,0,0.1);';
    const thickR     = 'border-right:3px solid rgba(0,0,0,0.14);';
    const headBg     = 'background:#f3f4f6;';

    let headCells = '';
    for (let c = 0; c < COLS; c++) {
      const sepR = c < COLS - 1 ? thickR : '';
      headCells += `<th style="${thinBorder}${headBg}text-align:left;min-width:70px;color:#141820;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}${headBg}text-align:left;min-width:55px;color:#141820;">ราคา</th>`;
    }

    const pages: string[] = [];
    for (let pageStart = 0; pageStart < total; pageStart += pageCapacity) {
      const pageItems = printLines.slice(pageStart, pageStart + pageCapacity);
      const pageSum = pageItems.reduce((s, it) => s + it.lineTotal, 0);
      let bodyRows = '';
      for (let row = 0; row < rowsPerPage; row++) {
        let cells = '';
        for (let col = 0; col < COLS; col++) {
          const item = pageItems[col * rowsPerPage + row];
          const sepR = col < COLS - 1 ? thickR : '';
          cells += `<td style="${thinBorder}">${item ? `<span style="font-weight:700">${item.label}</span>` : ''}</td>`;
          cells += `<td style="${thinBorder}${sepR}text-align:right;">${item ? `<span style="font-weight:400">${item.price}</span>` : ''}</td>`;
        }
        bodyRows += `<tr${row % 2 === 1 ? ' style="background:rgba(248,250,252,0.78);"' : ''}>${cells}</tr>`;
      }

      const isLastPage = pageStart + pageCapacity >= total;
      const pageNo = Math.floor(pageStart / pageCapacity) + 1;
      const grandNote = isLastPage
        ? ` <span style="font-weight:600">· รวมทั้งแผ่น ${printTotal.toLocaleString()}</span>`
        : '';
      pages.push(`
      <div class="print-sheet" style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;font-size:${FONT_PX}px;color:#1a1c1e;">
        ${buildPrintSlipBrandStrip()}
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-weight:bold;font-size:16px;margin-bottom:6px;">
          <span>ลูกค้า : ${customerName}</span>
          <span>แผ่นที่ : ${sheet} &nbsp;&nbsp; งวด : ${roundName} &nbsp;&nbsp; หน้า ${pageNo}/${totalPages}</span>
        </div>
        <table class="print-slip-table" style="border:2px solid rgba(0,0,0,0.12);border-radius:4px;overflow:hidden;box-shadow:0 2px 12px rgba(15,23,42,0.06);">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="5" style="${thinBorder}background:#f3f4f6;border-top:2px solid rgba(0,0,0,0.14);font-weight:600;">วันที่พิมพ์ ${printDate}</td>
              <td colspan="3" style="${thinBorder}background:#f3f4f6;border-top:2px solid rgba(0,0,0,0.14);text-align:right;font-weight:600;">
                รวมหน้านี้ ${pageSum.toLocaleString()}${grandNote}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>`);
    }

    const html = `<div class="print-root" style="color:#000;">${pages.join('')}</div>`;

    openPrintPreview(html, `โพย — ${customerName} แผ่น${sheet} — ${roundName}`, `โพย_${customerName}_แผ่น${sheet}_${roundName}`);
  };

  const handleExportCsv = () => {
    const customerName = (currentCustomer?.name ?? 'ไม่ระบุลูกค้า').replace(/[\\/:*?"<>|]/g, '_');
    const roundName = (currentRound?.name ?? 'ไม่ระบุงวด').replace(/[\\/:*?"<>|]/g, '_');
    const sheetsWithData = Array.from(new Set(customerBets.map(b => b.sheet_no ?? 1))).sort((a, b) => a - b);
    if (!sheetsWithData.length) return;

    if (csvExportMode === 'combined') {
      const lines: string[] = [];
      lines.push('sheet,number,payload');

      for (const sh of sheetsWithData) {
        const groups = sortBetSheetGroups(
          groupByEntry(customerBets.filter(b => (b.sheet_no ?? 1) === sh)),
          betSheetSort,
        );
        const items = groups.map(formatCsvItem).filter((item): item is CsvItem => item !== null);
        for (const item of items) {
          lines.push(`${sh},${item.number},${item.payload}`);
        }
      }

      const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `โพย_${customerName}_ทุกแผ่น_${roundName}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return;
    }

    // separate mode: auto-download one CSV per sheet
    for (const sh of sheetsWithData) {
      const groups = sortBetSheetGroups(
        groupByEntry(customerBets.filter(b => (b.sheet_no ?? 1) === sh)),
        betSheetSort,
      );
      const items = groups.map(formatCsvItem).filter((item): item is CsvItem => item !== null);
      if (!items.length) continue;

      const text = items.map(item => `${item.number}=${item.payload}`).join('\n');
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `โพย_${customerName}_แผ่น${sh}_${roundName}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
    setCsvModalOpen(false);
  };

  return (
    <AppShell>
      <div className="flex flex-col h-full min-h-0 bg-surface-default overflow-hidden">

        {/* Top bar — พื้นขาวแยกจากแถบคีย์ด้านล่าง */}
        <div className="flex items-center gap-3 px-4 py-2 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-card-bg)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
          <span className="text-theme-text-secondary text-sm font-semibold">รับแทง</span>
          <div className="w-px h-4 bg-surface-300" />
          <select value={selectedRoundId} onChange={e => setSelectedRoundId(e.target.value)}
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
          <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">

            {/* Warning: no customer selected */}
            {!selectedCustomerId && (
              <div className="shrink-0 bg-risk-medium/18 border-b border-risk-medium/45/50 px-4 py-1.5 text-xs text-risk-medium text-center select-none">
                {customers.length === 0
                  ? <>⚠ ยังไม่มีลูกค้า — <a href="/customers" className="underline">+ เพิ่มลูกค้า</a></>
                  : '⚠ กรุณาเลือกลูกค้าก่อนคีย์โพย'}
              </div>
            )}

            {/* ช่องคีย์ — พื้นเทาเป็น “ถาด” ช่องเลข/ราคาเป็นการ์ดขาวไม่กลืนกับหัวตาราง */}
            <div className="flex min-w-0 max-w-full items-stretch gap-2 border-b border-[var(--color-border)] bg-surface-200/50 px-2 py-2 sm:px-2.5 sm:py-2.5 shrink-0 select-none z-[1] overflow-x-auto">
              <div style={{ width: numWidth, minWidth: 100, maxWidth: 400 }}
                className="flex flex-col items-center justify-center rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg)] px-4 py-2 shadow-[var(--shadow-soft)] shrink-0 overflow-hidden">
                <span className="text-theme-text-secondary text-xs mb-1 tracking-widest uppercase">เลข</span>
                <input ref={numRef} value={numInput} onChange={e => onNumChange(e.target.value)}
                  onKeyDown={onNumKeyDown} onFocus={() => setActiveField('num')} autoFocus placeholder="123"
                  style={{ fontSize: inputFs, lineHeight: 1.1 }}
                  className={`w-full text-center font-bold font-mono bg-transparent text-theme-text-primary placeholder:text-theme-text-muted placeholder:text-xl focus:outline-none caret-accent ${activeField === 'num' ? 'border-b-2 border-accent' : 'border-b-2 border-transparent'}`} />
                <span className={`text-xs mt-1 h-4 leading-4 block text-center ${numHint ? 'text-theme-text-muted' : 'invisible'}`}>{numHint || '·'}</span>
              </div>
              <div onMouseDown={onDividerMouseDown}
                className="w-1.5 shrink-0 cursor-col-resize self-stretch rounded-full bg-[var(--color-border-strong)]/50 hover:bg-accent/45 active:bg-accent/35 transition-colors my-1.5" />
              <div className="relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg)] px-3 py-2 shadow-[var(--shadow-soft)] sm:px-6">
                <span className="text-theme-text-secondary text-xs mb-1 tracking-widest uppercase">ราคา</span>
                <input ref={amtRef} value={amtInput} onChange={e => onAmtChange(e.target.value)}
                  onKeyDown={onAmtKeyDown} onFocus={() => setActiveField('amt')}
                  placeholder={inputMode === 'run' ? 'วิ่งบน*ล่าง' : inputMode === '2digit' ? 'บน*ล่าง หรือ 100-' : '3บน*โต็ด*3ล่าง'}
                  style={{ fontSize: inputFs, lineHeight: 1.1 }}
                  className={`w-full text-center font-bold font-mono bg-transparent text-theme-text-primary placeholder:text-theme-text-muted placeholder:text-xl focus:outline-none caret-accent ${activeField === 'amt' ? 'border-b-2 border-accent' : 'border-b-2 border-transparent'}`} />
                <div className="h-4 mt-1 flex items-center justify-center">
                  {parseError
                    ? <span className="text-xs text-loss leading-4">{parseError}</span>
                    : (!parseError && isKlap) ? (() => {
                        const v = amtInput.trim();
                        const isKlapTote = inputMode === '3digit' && v.startsWith('*') && v.endsWith('-') && !v.slice(1).includes('*');
                        const isKlapBoth = inputMode === '3digit' && v.endsWith('-') && !isKlapTote && !!v.slice(0,-1).match(/^\d+\*\d+$/);
                        const label = isKlapBoth ? 'กลับบน+โต็ด' : isKlapTote ? 'กลับโต็ด' : 'กลับเลข';
                        const cls   = isKlapBoth ? 'text-accent-glow' : isKlapTote ? 'text-accent-glow' : 'text-risk-medium';
                        return <span className={`text-xs leading-4 ${cls}`}>{label}</span>;
                      })()
                    : <span className="invisible text-xs leading-4">·</span>
                  }
                </div>
                <div className="absolute top-2 right-3 flex gap-1.5">
                  {inputMode === 'run'    && <span className="text-xs px-1.5 py-0.5 rounded bg-accent/12 text-accent-hover border border-accent/30">วิ่ง</span>}
                  {inputMode === '2digit' && <span className="text-xs px-1.5 py-0.5 rounded bg-accent/15 text-accent border border-accent/30">2 ตัว</span>}
                  {inputMode === '3digit' && <span className="text-xs px-1.5 py-0.5 rounded bg-profit/15 text-profit border border-profit/30">3 ตัว</span>}
                  {isKlap && (() => {
                    const v = amtInput.trim();
                    const isKlapTote = inputMode === '3digit' && v.startsWith('*') && v.endsWith('-') && !v.slice(1).includes('*');
                    const isKlapBoth = inputMode === '3digit' && v.endsWith('-') && !isKlapTote && !!v.slice(0,-1).match(/^\d+\*\d+$/);
                    const label = isKlapBoth ? 'กลับบน+โต็ด' : isKlapTote ? 'กลับโต็ด' : 'กลับ';
                    const cls   = isKlapBoth ? 'bg-accent-glow/12 text-accent-hover border-accent-glow/25'
                                : isKlapTote ? 'bg-accent-glow/12 text-accent-hover border-accent-glow/25'
                                : 'bg-risk-medium/15 text-risk-medium border-risk-medium/40/30';
                    return <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>;
                  })()}
                </div>
              </div>
              <div className="flex shrink-0 flex-col justify-center gap-2 border-l border-[var(--color-border)]/80 py-1 pl-2 sm:pl-2.5">
                <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg)] px-2 py-1.5 shadow-[var(--shadow-soft)]">
                  <button type="button" title="ลดขนาดตัวเลข"
                    className="btn-toolbar-glow btn-toolbar-muted !h-8 !min-w-[2rem] !px-0 !text-[11px] rounded-xl font-bold"
                    onClick={() => setInputFs(s => Math.max(24, s - 8))}>A−</button>
                  <button type="button" title="ขยายขนาดตัวเลข"
                    className="btn-toolbar-glow btn-fintech-search !h-8 !min-w-[2rem] !px-0 !text-[11px] rounded-xl font-bold"
                    onClick={() => setInputFs(s => Math.min(80, s + 8))}>A+</button>
                  <div className="w-px h-5 bg-white/10 shrink-0" />
                  <button type="button" title="ล้างช่อง"
                    className="btn-toolbar-glow btn-fintech-spark !h-8 !min-w-[2rem] !px-0 !text-[11px] rounded-xl font-bold"
                    onClick={() => { setNumInput(''); setAmtInput(''); setParseError(''); setNumHint(''); setTimeout(() => numRef.current?.focus(), 0); }}>C</button>
                </div>
                <div className="flex items-center gap-1.5 rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg)] px-2 py-1.5 shadow-[var(--shadow-soft)]">
                  <button type="button" title={soundOn ? 'ปิดเสียงพูด' : 'เปิดเสียงพูด'} onClick={() => setSoundOn(v => !v)}
                    className={`btn-toolbar-glow !h-8 !min-w-[2rem] !px-0 flex items-center justify-center text-sm rounded-xl ${soundOn ? 'btn-fintech-range' : 'btn-toolbar-muted'}`}>
                    {soundOn ? '🔊' : '🔇'}
                  </button>
                  <div className="w-px h-5 bg-white/10 shrink-0" />
                  <button type="button" title="ช้าลง" disabled={!soundOn}
                    onClick={() => setSpeechRate(r => Math.max(0.8, parseFloat((r - 0.2).toFixed(1))))}
                    className="btn-toolbar-glow btn-toolbar-muted !h-8 !min-w-[1.75rem] !px-0 !text-sm rounded-xl font-bold disabled:opacity-35">−</button>
                  <span className={`text-[11px] w-8 text-center tabular-nums font-mono font-semibold ${soundOn ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>{speechRate.toFixed(1)}</span>
                  <button type="button" title="เร็วขึ้น" disabled={!soundOn}
                    onClick={() => setSpeechRate(r => Math.min(3.0, parseFloat((r + 0.2).toFixed(1))))}
                    className="btn-toolbar-glow btn-fintech-search !h-8 !min-w-[1.75rem] !px-0 !text-sm rounded-xl font-bold disabled:opacity-35">+</button>
                </div>
              </div>
            </div>

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
                    <th className="text-left py-1.5 px-3 text-theme-text-primary font-semibold w-[4.5rem]">เลข</th>
                    {COL_TYPES.map(c => (
                      <th key={c.key} className="text-right py-1.5 px-2 text-theme-text-muted font-normal">{c.label}</th>
                    ))}
                    <th
                      scope="col"
                      tabIndex={0}
                      title={betSheetSort === 'newestFirst' ? 'คลิก: เรียงให้รายการล่าสุดอยู่ล่าง (ตามเวลา)' : 'คลิก: เรียงให้รายการล่าสุดอยู่บน'}
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
                      className="text-left py-1.5 px-2 text-theme-text-muted w-[3.75rem] whitespace-nowrap cursor-pointer select-none hover:text-theme-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded-sm transition-colors">
                      <span className="inline-flex flex-col gap-0.5 leading-tight">
                        <span>เวลา</span>
                        <span className="text-[9px] font-semibold text-theme-text-secondary tracking-tight">
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
            <div ref={tableScrollRef} className="flex-1 overflow-y-auto">
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
                    const timeStr = new Date(firstBet.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
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
                    return (
                      <tr key={key}
                        data-row-idx={idx}
                        className={`border-b border-border/30 cursor-pointer relative ${isActiveSearchMatch ? 'bg-surface-100 outline outline-2 outline-[var(--color-border-strong)]' : isLineImportHighlight ? 'bg-accent/12 shadow-[inset_5px_0_0_var(--color-accent)] ring-1 ring-inset ring-accent/35' : isRecentChanged ? 'bg-surface-50 shadow-[inset_4px_0_0_#111111] ring-1 ring-inset ring-[var(--color-border-strong)]' : focusedIdx === idx ? 'bg-profit/10 outline outline-1 outline-profit/35' : isSelected ? 'bg-[var(--color-nav-active-bg)]' : isSearchMatch ? 'bg-surface-100 hover:bg-surface-200/50' : idx % 2 === 0 ? 'bg-surface-50/80 hover:bg-surface-100/80' : 'hover:bg-surface-100/60'}`}
                        onClick={() => setFocusedIdx(idx)}>
                        <td className="py-1 px-1 w-7 text-center">
                          <input type="checkbox" className="accent"
                            checked={isSelected}
                            onClick={e => {
                              e.stopPropagation();
                              if (e.shiftKey && lastClickedIdxRef.current >= 0) {
                                e.preventDefault(); // prevent checkbox from toggling
                                const from = Math.min(lastClickedIdxRef.current, idx);
                                const to   = Math.max(lastClickedIdxRef.current, idx);
                                const next = new Set(selectedGroups);
                                for (let i = from; i <= to; i++) next.add(groupKey(sheetGrouped[i]));
                                setSelectedGroups(next);
                              } else {
                                lastClickedIdxRef.current = idx;
                              }
                            }}
                            onChange={e => {
                              if (e.nativeEvent instanceof MouseEvent && e.nativeEvent.shiftKey) return;
                              const next = new Set(selectedGroups);
                              if (e.target.checked) next.add(key); else next.delete(key);
                              setSelectedGroups(next);
                            }} />
                        </td>
                        <td className="py-1 px-3 text-theme-text-muted w-10 text-right pr-4">
                          <span className="inline-flex flex-col items-end gap-0.5">
                            <span>{rowDisplayNum}</span>
                            {isLineImportHighlight && (
                              <span className="text-[9px] font-bold text-profit leading-none whitespace-nowrap">ไลน์</span>
                            )}
                            {isRecentChanged && (
                              <span className="text-[9px] font-bold uppercase tracking-tight text-theme-text-secondary leading-none whitespace-nowrap">ล่าสุด</span>
                            )}
                          </span>
                        </td>
                        <td className="py-1 pl-3 pr-2 w-[4.5rem] align-middle">
                          <span className="inline-flex min-w-[2.75rem] justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-input-bg)] px-1.5 py-0.5 font-mono text-[0.95em] font-extrabold tabular-nums tracking-wider text-theme-text-primary shadow-[var(--shadow-soft)]">
                            {group.number}
                          </span>
                        </td>
                        {COL_TYPES.map(c => (
                          <td key={c.key} className="py-1 px-2 text-right font-mono tabular-nums align-middle text-theme-text-secondary">
                            {row[c.key] > 0 ? (
                              <span className="text-theme-text-primary">{row[c.key].toLocaleString()}</span>
                            ) : (
                              <span className="text-theme-text-muted/20 select-none inline-block min-w-[0.6em] text-center">·</span>
                            )}
                          </td>
                        ))}
                        <td className="py-1 px-2 text-theme-text-muted font-mono text-[11px] w-[3.75rem] whitespace-nowrap">{timeStr}</td>
                        <td className="py-1 px-2 w-[5.25rem] max-w-[6.5rem] align-middle">
                          <span
                            className={`inline-flex max-w-full truncate rounded-md px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${keyerChipClasses(keyer.colorKey)}`}
                            title={keyer.title || undefined}
                          >
                            {keyer.text}
                          </span>
                        </td>
                        <td className="py-1 px-2 text-theme-text-secondary text-[11px] w-20 min-w-0 truncate" title={firstBet.customer_ref ?? undefined}>
                          {firstBet.customer_ref ?? '—'}
                        </td>
                        <td className="py-1 px-1 w-6" onClick={e => e.stopPropagation()}>
                          <button onClick={() => deleteSavedGroup(group.bets)} className="text-theme-text-muted hover:text-loss">×</button>
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
              <span className="font-mono text-profit">{customerBets.filter(b => (b.sheet_no ?? 1) === sheet).reduce((s, b) => s + Number(b.amount), 0).toLocaleString()}</span>
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
                  <span className="text-[10px] text-theme-text-muted">(หายเองใน ~3 นาที · นำเข้ารอบใหม่จะเปลี่ยนชุดไฮไลต์)</span>
                </>
              )}
            </div>

            {/* Toolbar — ใต้ตาราง */}
            <div className={`shrink-0 border-t px-2 py-1.5 flex items-center gap-1.5 transition-colors duration-200 ${editInlineKey ? 'bg-risk-medium/15 border-risk-medium/50' : 'bg-surface-100 border-border'}`}>
              {editInlineKey ? (
                <>
                  <span className="text-xs text-risk-medium font-semibold mr-1">✏️ โหมดแก้ไข</span>
                  <button
                    onClick={() => void saveInlineEdit()}
                    disabled={isSaving}
                    className="btn-toolbar-glow btn-toolbar-profit disabled:shadow-none">
                    <span>✓</span><span>บันทึก</span>
                  </button>
                  <button
                    onClick={() => { setEditInlineKey(null); setEditInlineCreatedAt(''); setNumInput(''); setAmtInput(''); setParseError(''); }}
                    className="btn-toolbar-glow btn-toolbar-muted">
                    <span>✕</span><span>ยกเลิก</span>
                  </button>
                </>
              ) : (
                <>
                  <button
                    disabled={selectedGroups.size !== 1 || !numInput.trim() || !amtInput.trim()}
                    onClick={() => {
                      const [insertKey] = [...selectedGroups];
                      void commitLineWith(numInput, amtInput, 'แทรก', true, insertKey);
                    }}
                    className="btn-toolbar-glow btn-toolbar-profit">
                    <span>↑</span><span>แทรก</span>
                  </button>
                  <button
                    disabled={selectedGroups.size !== 1}
                    onClick={handleEditAction}
                    className="btn-toolbar-glow btn-fintech-search !h-7 px-3 text-xs gap-1"
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
              {isAdmin && <div className="w-px h-5 bg-white/15 mx-0.5 shrink-0" />}
              <span className="text-xs text-theme-text-muted shrink-0">ขนาด</span>
              <button
                type="button"
                title="ลดขนาดตาราง"
                className="btn-toolbar-glow btn-toolbar-muted !h-7 !min-w-[2rem] !px-2 !text-[11px] rounded-xl font-bold"
                onClick={() => setRowFs(s => Math.max(9, s - 2))}
              >
                A−
              </button>
              <button
                type="button"
                title="ขยายขนาดตาราง"
                className="btn-toolbar-glow btn-fintech-search !h-7 !min-w-[2rem] !px-2 !text-[11px] rounded-xl font-bold"
                onClick={() => setRowFs(s => Math.min(22, s + 2))}
              >
                A+
              </button>
              <button
                type="button"
                onClick={() => {
                  if (selectedGroups.size === sheetGrouped.length) setSelectedGroups(new Set());
                  else setSelectedGroups(new Set(sheetGrouped.map(g => groupKey(g))));
                }}
                className="btn-toolbar-glow btn-fintech-spark !h-7 !px-2.5 !text-[11px] rounded-xl font-semibold max-sm:max-w-[9rem] truncate"
              >
                {selectedGroups.size === sheetGrouped.length && sheetGrouped.length > 0 ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
              </button>
            </div>
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

          {/* RIGHT: Summary Panel — glass stack สมดุลกับธีม */}
          <div className="bets-right-shell flex flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden bg-[var(--color-bg-primary)]">

            {/* Customer navigator + แผ่น selector */}
            <div className="p-3 shrink-0">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-soft)] p-3 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-theme-text-muted shrink-0 w-11">ลูกค้า</span>
                  <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}
                    className="flex-1 h-8 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] min-w-0">
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => navigateCustomer(-1)}
                    className="btn-toolbar-glow btn-toolbar-muted !h-8 !px-2.5 !text-[11px] rounded-xl font-semibold shrink-0">ขึ้น</button>
                  <button type="button" onClick={() => navigateCustomer(1)}
                    className="btn-toolbar-glow btn-fintech-search !h-8 !px-2.5 !text-[11px] rounded-xl font-semibold shrink-0">ลง</button>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-theme-text-muted shrink-0 w-11">แผ่น</span>
                  <select value={sheet} onChange={e => { setSheet(Number(e.target.value)); setSelectedGroups(new Set()); }}
                    className="flex-1 h-8 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] font-mono">
                    {Array.from({ length: effectiveMaxSheets }, (_, i) => effectiveMaxSheets - i)
                      .map(n => (
                        <option key={n} value={n}>
                          {n}{customerBets.filter(b => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}
                        </option>
                      ))}
                  </select>
                  <button type="button" onClick={handleRemoveSheet}
                    className="btn-toolbar-glow btn-toolbar-danger !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-xl shrink-0"
                    title="ลบแผ่น (ลบได้เมื่อไม่มีข้อมูล)">−</button>
                  <button type="button" onClick={handleAddSheet}
                    className="btn-toolbar-glow btn-toolbar-profit !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-xl shrink-0"
                    title="เพิ่มแผ่นใหม่">+</button>
                </div>
                {isAdmin && (
                  <button type="button" onClick={() => setLineModal(true)}
                    className="btn-toolbar-glow btn-fintech-spark w-full !h-9 !text-xs rounded-xl font-semibold">
                    รับข้อมูลไลน์
                  </button>
                )}
              </div>
            </div>

            {/* ค้นหา */}
            <div className="px-3 pb-3 shrink-0">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-soft)] p-3">
                <SearchPanel
                  q={searchQ}
                  setQ={setSearchQ}
                  onSearch={() => jumpToSearchMatch('first')}
                  onNext={() => jumpToSearchMatch('next')}
                  onClear={clearSearch}
                  matchCount={searchMatchIndexes.length}
                  activeIndex={activeSearchMatchPos}
                />
              </div>
            </div>

            {/* Summary table */}
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
                      className={`text-[11px] w-7 h-7 rounded-lg border border-[var(--color-border)] flex items-center justify-center transition-colors ${
                        rightPanelLocked
                          ? 'text-theme-text-primary bg-[var(--color-nav-active-bg)] hover:bg-[var(--bg-hover)]'
                          : 'text-theme-text-muted bg-white hover:bg-[var(--bg-hover)]'
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
                    <button type="button" title="ลดขนาดตารางสรุป" onClick={() => setSumFs(s => Math.max(9, s - 2))}
                      className="btn-toolbar-glow btn-toolbar-muted !h-7 !min-w-[2rem] !px-0 !text-[11px] rounded-xl font-bold">A−</button>
                    <button type="button" title="ขยายขนาดตารางสรุป" onClick={() => setSumFs(s => Math.min(22, s + 2))}
                      className="btn-toolbar-glow btn-fintech-search !h-7 !min-w-[2rem] !px-0 !text-[11px] rounded-xl font-bold">A+</button>
                  </div>
                </div>
                <div className="overflow-auto px-2 py-2 flex-1 min-h-0">
                  <table className="w-full" style={{ fontSize: sumFs }}>
                    <thead>
                      <tr className="border-b border-[var(--color-border)]">
                        <th className="text-left py-1.5 pl-1 text-[11px] text-theme-text-muted font-medium">เลข</th>
                        <th className="text-right py-1.5 px-1 text-[11px] text-theme-text-muted font-medium">แผ่น</th>
                        <th className="text-right py-1.5 px-1 text-[11px] text-theme-text-muted font-medium">ลูกค้า</th>
                        <th className="text-right py-1.5 pr-1 text-[11px] text-theme-text-muted font-medium">รวม</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-[var(--color-border)] font-semibold bg-[var(--bg-glass-subtle)]">
                        <td className="py-1.5 pl-1 text-theme-text-secondary">รวม</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-theme-text-secondary">{sheetTotal > 0 ? sheetTotal.toLocaleString() : '—'}</td>
                        <td className="py-1.5 text-right font-mono tabular-nums text-neutral">{customerSavedTotal > 0 ? customerSavedTotal.toLocaleString() : '—'}</td>
                        <td className="py-1.5 pr-1 text-right font-mono tabular-nums text-theme-text-primary">{savedTotal > 0 ? savedTotal.toLocaleString() : '—'}</td>
                      </tr>
                      {COL_TYPES.map(c => {
                        const sheetAmt = sheetByType[c.key] ?? 0;
                        const custAmt = customerSavedByType[c.key] ?? 0;
                        const total = summaryByType[c.key] ?? 0;
                        return (
                          <tr key={c.key} className="border-b border-[var(--color-border)] hover:bg-[var(--bg-hover)]">
                            <td className={`py-1 pl-1 text-[0.92em] ${total > 0 ? 'text-theme-text-secondary' : 'text-theme-text-muted'}`}>{c.label}</td>
                            <td className={`py-1 text-right font-mono tabular-nums text-[0.92em] ${sheetAmt > 0 ? 'text-theme-text-secondary' : 'text-theme-text-muted/35'}`}>
                              {sheetAmt > 0 ? sheetAmt.toLocaleString() : '·'}
                            </td>
                            <td className={`py-1 text-right font-mono tabular-nums text-[0.92em] ${custAmt > 0 ? 'text-neutral' : 'text-theme-text-muted/35'}`}>
                              {custAmt > 0 ? custAmt.toLocaleString() : '·'}
                            </td>
                            <td className={`py-1 pr-1 text-right font-mono tabular-nums text-[0.92em] ${total > 0 ? 'text-theme-text-primary' : 'text-theme-text-muted/35'}`}>
                              {total > 0 ? total.toLocaleString() : '·'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>
      </div>

      {/* Move Sheet Modal */}
      {moveModal && (
        <div className="fixed inset-0 bg-[var(--color-backdrop-overlay)] flex items-center justify-center z-50" onClick={() => setMoveModal(false)}>
          <div className="bg-surface-100 border border-border rounded-lg p-4 w-80 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-theme-text-primary">ย้าย — {selectedGroups.size} รายการ</div>

            {/* Target customer */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-secondary w-16 shrink-0">ลูกค้า</span>
              <select value={moveTargetCustomerId} onChange={e => { setMoveTargetCustomerId(e.target.value); setMoveTarget(1); }}
                className="flex-1 h-8 rounded bg-surface-default border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
                <option value="__same__">เดิม ({customers.find(c => c.id === selectedCustomerId)?.name ?? 'ไม่ระบุ'})</option>
                {customers.filter(c => c.id !== selectedCustomerId).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Target sheet */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-secondary w-16 shrink-0">ย้ายไปแผ่น</span>
              <select value={moveTarget} onChange={e => setMoveTarget(Number(e.target.value))}
                className="flex-1 h-8 rounded bg-surface-default border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
                {(() => {
                  const tCustId = moveTargetCustomerId === '__same__' ? selectedCustomerId : moveTargetCustomerId;
                  const tCustBets = tCustId ? savedBets.filter(b => b.customer_id === tCustId) : savedBets.filter(b => !b.customer_id);
                  const tMax = tCustBets.length ? Math.max(...tCustBets.map(b => b.sheet_no ?? 1)) : 1;
                  const opts: number[] = Array.from({ length: tMax }, (_, i) => i + 1);
                  if (moveTargetCustomerId === '__same__') opts.splice(opts.indexOf(sheet), 1); // remove current sheet if same customer
                  if (!opts.length) opts.push(tMax + 1);
                  const showNew = true;
                  return [
                    ...opts.map(n => <option key={n} value={n}>แผ่น {n}{tCustBets.filter(b => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}</option>),
                    <option key="new" value={tMax + 1}>แผ่น {tMax + 1} (ใหม่)</option>,
                  ];
                })()}
              </select>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setMoveModal(false)}
                className="h-8 px-4 rounded bg-surface-200 text-theme-text-secondary hover:bg-surface-300 text-sm">ยกเลิก</button>
              <button onClick={async () => { await moveSelectedGroups(moveTarget); }}
                className="h-8 px-4 rounded bg-risk-medium/95 hover:bg-risk-medium/90 text-theme-btn-primary-fg text-sm font-semibold">ย้าย</button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Export Modal */}
      {csvModalOpen && (
        <div className="fixed inset-0 bg-[var(--color-backdrop-overlay)] flex items-center justify-center z-50" onClick={() => setCsvModalOpen(false)}>
          <div className="bg-surface-100 border border-border rounded-lg p-4 w-96 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
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
                ทุกแผ่นแยกไฟล์
              </label>
              <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
                <input
                  type="radio"
                  name="csv-export-mode"
                  checked={csvExportMode === 'combined'}
                  onChange={() => setCsvExportMode('combined')}
                  className="accent"
                />
                ทุกแผ่นรวมเป็นไฟล์เดียว
              </label>
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setCsvModalOpen(false)}
                className="h-8 px-4 rounded bg-surface-200 text-theme-text-secondary hover:bg-surface-300 text-sm">ยกเลิก</button>
              <button onClick={handleExportCsv}
                className="h-8 px-4 rounded bg-profit/95 hover:bg-profit/90 text-theme-btn-primary-fg text-sm font-semibold">ดาวน์โหลด</button>
            </div>
          </div>
        </div>
      )}

      {/* รับข้อมูลไลน์ — แผงดึงขวา (ไม่กั้นโต๊ะหลัก) */}
      {lineModal && (() => {
        const preview = lineText.trim() ? parseLineBetsTextWithSegments(lineText) : null;

        // แยกแถวตาม segment (ข้อความไลน์ตามเวลา) + เลข — ไม่รวมยอดข้ามข้อความ
        type PreviewRow = { number: string; amounts: Record<string, number> };
        const groupedPreview: PreviewRow[] = [];
        if (preview?.bets.length) {
          const map = new Map<string, PreviewRow>();
          for (const b of preview.bets) {
            const rk = `${String(b.segment_index ?? 0)}|${b.number}`;
            if (!map.has(rk)) {
              const row: PreviewRow = { number: b.number, amounts: {} };
              map.set(rk, row);
              groupedPreview.push(row);
            }
            const row = map.get(rk)!;
            row.amounts[b.bet_type] = (row.amounts[b.bet_type] ?? 0) + b.amount;
          }
        }

        return (
          <div
            className="fixed inset-y-0 right-0 z-50 flex w-full justify-end pointer-events-none"
            aria-hidden={false}
          >
            <div
              className="pointer-events-auto flex h-full max-h-[100dvh] w-full max-w-[min(100vw,720px)] flex-col border-l border-theme-card-border bg-[var(--color-card-bg-solid)] shadow-[-12px_0_40px_rgba(0,0,0,0.14)] sm:rounded-l-2xl overflow-hidden"
              role="dialog"
              aria-modal="false"
              aria-labelledby="line-import-title"
            >
              <div className="shrink-0 px-4 sm:px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--color-card-bg-solid)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <h2 id="line-import-title" className="text-base font-semibold text-theme-text-primary tracking-tight">รับข้อมูลไลน์</h2>
                  <p className="text-xs text-theme-text-muted mt-1 leading-relaxed">
                    แผงด้านขวานี้ไม่บังโต๊ะคีย์ — คลิกพื้นที่ซ้ายยังคีย์โพยได้ · preview อัปเดตตามข้อความ · นำเข้าสำเร็จแล้วปิดแผงเมื่อเสร็จงาน (ปุ่มปิด หรือ Esc)
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-end gap-2 shrink-0 w-full sm:w-auto sm:pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setLineModal(false);
                      setLineText('');
                      setOcrError('');
                      setOcrServerFallbackNote(null);
                      setImageOcrSource(null);
                      setPdfLoading(false);
                      setPdfDragOver(false);
                      setImportResult(null);
                    }}
                    className="btn-toolbar-glow btn-toolbar-muted !h-9 px-4 text-sm rounded-xl"
                  >
                    ปิด
                  </button>
                </div>
              </div>

              {/* Body: มือถือ = คอลัมน์รับข้อความบน / preview ล่าง · lg = preview 60% + รับข้อความ 40% */}
              <div className="flex flex-col lg:flex-row gap-4 flex-1 min-h-0 overflow-hidden px-4 sm:px-5 py-4">
                {/* Preview */}
                <div className="flex flex-1 flex-col gap-2 min-h-0 min-w-0 lg:min-h-[min(420px,50dvh)] lg:flex-[1.5] order-2 lg:order-1">
                  <div className="text-[11px] sm:text-xs shrink-0 flex flex-wrap items-center gap-2">
                    {!preview && <span className="text-theme-text-muted">ยังไม่มีข้อความ — วางในช่องข้อความด้านขวาบน</span>}
                    {preview && preview.parsedCount > 0 && (
                      <>
                        <span className="text-profit font-semibold">✓ พบ {preview.parsedCount} รายการ ({groupedPreview.length} แถว)</span>
                        {preview.skippedCount > 0 && <span className="text-theme-text-secondary">⚠ ข้าม {preview.skippedCount} บรรทัด</span>}
                      </>
                    )}
                    {preview && preview.parsedCount === 0 && (
                      <span className="text-theme-text-muted">ไม่พบรายการที่ถูกต้อง{preview.skippedCount > 0 ? ` (ข้าม ${preview.skippedCount} บรรทัด)` : ''}</span>
                    )}
                  </div>

                  <div className="flex-1 min-h-[200px] lg:min-h-0 flex flex-col rounded-xl border border-[var(--color-border)] bg-[var(--color-bg-primary)] overflow-hidden">
                    <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)]">
                      <table className="w-full table-fixed text-[11px] sm:text-xs">
                        <thead>
                          <tr>
                            <th className="text-left py-2 px-2 text-theme-text-muted w-7">#</th>
                            <th className="text-center py-2 px-2 text-theme-text-primary font-semibold w-14">เลข</th>
                            {COL_TYPES.map(c => (
                              <th key={c.key} className="text-right py-2 px-1.5 text-theme-text-muted font-medium">{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                      </table>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0">
                      <table className="w-full table-fixed text-[11px] sm:text-xs">
                        <tbody>
                          {groupedPreview.length === 0 ? (
                            <tr>
                              <td colSpan={2 + COL_TYPES.length} className="py-14 text-center text-theme-text-muted/55 text-xs">
                                ยังไม่มีแถว preview
                              </td>
                            </tr>
                          ) : groupedPreview.map((row, idx) => (
                            <tr
                              key={row.number + idx}
                              className={`border-b border-[var(--color-border)] ${idx % 2 === 0 ? 'bg-surface-50' : 'bg-transparent'} hover:bg-[var(--bg-hover)]`}
                            >
                              <td className="py-1.5 px-2 text-theme-text-muted w-7 tabular-nums">{idx + 1}</td>
                              <td className="py-1.5 px-2 w-14 align-middle text-center">
                                <span className="inline-flex min-w-[2.25rem] justify-center rounded-md border border-[var(--color-border)] bg-[var(--color-input-bg)] px-1 py-0.5 font-mono text-[0.85em] font-extrabold tabular-nums text-theme-text-primary">
                                  {row.number}
                                </span>
                              </td>
                              {COL_TYPES.map(c => (
                                <td key={c.key} className="py-1.5 px-1.5 text-right font-mono text-theme-text-primary tabular-nums">
                                  {(row.amounts[c.key] ?? 0) > 0
                                    ? row.amounts[c.key].toLocaleString()
                                    : <span className="text-theme-text-muted">·</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {preview && preview.parsedCount > 0 && (
                    <div className="text-[11px] text-theme-text-muted shrink-0">
                      นำเข้าให้ <span className="text-theme-text-primary font-medium">{currentCustomer?.name ?? '(ไม่ระบุลูกค้า)'}</span>
                      <span className="text-theme-text-muted"> · แผ่น {sheet}</span>
                    </div>
                  )}
                </div>

                {/* รับข้อความ / OCR — lg แถวขวา ~40% */}
                <div className="w-full flex flex-1 flex-col gap-2.5 min-h-0 min-w-0 lg:flex-1 lg:min-w-[240px] order-1 lg:order-2 overflow-y-auto pr-0.5">
                  <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
                  <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = ''; }} />

                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--bg-glass-subtle)] p-2.5 space-y-2 shrink-0">
                    <div className="text-[11px] font-semibold text-theme-text-secondary tracking-wide">นำเข้าไปที่</div>
                    {customers.length === 0 ? (
                      <p className="text-[11px] text-theme-text-muted leading-snug">
                        ยังไม่มีลูกค้าในระบบ — เพิ่มที่เมนูลูกค้าก่อน
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-theme-text-muted shrink-0 w-11">ลูกค้า</span>
                          <select
                            value={selectedCustomerId}
                            onChange={(e) => setSelectedCustomerId(e.target.value)}
                            className="flex-1 h-8 min-w-0 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                          >
                            {customers.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => navigateCustomer(-1)}
                            className="btn-toolbar-glow btn-toolbar-muted !h-8 !px-2 !text-[10px] rounded-lg font-semibold shrink-0"
                          >
                            ขึ้น
                          </button>
                          <button
                            type="button"
                            onClick={() => navigateCustomer(1)}
                            className="btn-toolbar-glow btn-fintech-search !h-8 !px-2 !text-[10px] rounded-lg font-semibold shrink-0"
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
                            disabled={!selectedCustomerId}
                            className="flex-1 h-8 min-w-0 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] font-mono disabled:opacity-45"
                          >
                            {Array.from({ length: effectiveMaxSheets }, (_, i) => effectiveMaxSheets - i).map((n) => (
                              <option key={n} value={n}>
                                {n}{customerBets.filter((b) => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={handleRemoveSheet}
                            className="btn-toolbar-glow btn-toolbar-danger !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-lg shrink-0"
                            title="ลบแผ่น (ลบได้เมื่อไม่มีข้อมูล)"
                          >
                            −
                          </button>
                          <button
                            type="button"
                            onClick={handleAddSheet}
                            className="btn-toolbar-glow btn-toolbar-profit !h-8 !w-8 !min-w-[2rem] !p-0 flex items-center justify-center text-base font-bold rounded-lg shrink-0"
                            title="เพิ่มแผ่นใหม่"
                          >
                            +
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setLineText(normalizeLinePasteText(lineText))}
                      disabled={!lineText.trim()}
                      className="text-[11px] px-2.5 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-input-bg)] text-theme-text-secondary hover:bg-[var(--bg-hover)] hover:text-theme-text-primary disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      ตัดคำนำหน้าไลน์
                    </button>
                    <span className="text-[10px] text-theme-text-muted">ลบเวลา Mo / ชื่อผู้ส่ง / บรรทัดแทรก — จัด × &quot; เป็น *</span>
                  </div>

                  <textarea
                    value={lineText}
                    onChange={e => setLineText(e.target.value)}
                    onPaste={e => {
                      const pasted = e.clipboardData.getData('text/plain');
                      if (pasted === '') return;
                      e.preventDefault();
                      const normalized = normalizeLinePasteText(pasted);
                      const el = e.currentTarget;
                      const start = el.selectionStart ?? 0;
                      const end = el.selectionEnd ?? 0;
                      setLineText(prev => {
                        const before = prev.slice(0, start);
                        const after = prev.slice(end);
                        const headSep =
                          before.length > 0 && !before.endsWith('\n') && normalized.length > 0 ? '\n' : '';
                        const tailSep =
                          normalized.length > 0 && after.length > 0 && !after.startsWith('\n') ? '\n' : '';
                        const insert = headSep + normalized + tailSep;
                        const next = before + insert + after;
                        requestAnimationFrame(() => {
                          const pos = before.length + insert.length;
                          el.selectionStart = el.selectionEnd = Math.min(pos, next.length);
                          el.scrollTop = el.scrollHeight;
                        });
                        return next;
                      });
                    }}
                    placeholder={"วางข้อความจากไลน์\nเช่น:\n12=100×100\n38=50×50\n470 บ50 ต50\n\n21\n26\n60=50×50"}
                    className="flex-1 min-h-[140px] lg:min-h-[200px] max-h-[40dvh] lg:max-h-none rounded-xl bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-3 py-2.5 text-sm text-theme-text-primary placeholder:text-theme-text-muted font-mono resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                  />

                  <div className="flex gap-2 shrink-0 items-stretch">
                    <button
                      type="button"
                      onClick={handleLineImport}
                      disabled={!preview || preview.parsedCount === 0 || !selectedCustomerId || customers.length === 0}
                      className="btn-toolbar-glow btn-fintech-search flex-1 min-w-0 !h-10 text-sm rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      นำเข้า{preview && preview.parsedCount > 0 ? ` (${preview.parsedCount})` : ''}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setLineText('');
                        setImportResult(null);
                        setOcrError('');
                        setOcrServerFallbackNote(null);
                        setImageOcrSource(null);
                      }}
                      disabled={!lineText.trim()}
                      title="ล้างข้อความในกล่อง (กรณี OCR ผิด)"
                      className="shrink-0 px-3 !h-10 text-[11px] font-medium rounded-xl border border-[var(--color-border)] bg-[var(--color-input-bg)]/70 text-theme-text-muted hover:text-theme-text-secondary hover:bg-[var(--bg-hover)] hover:border-[var(--color-border-strong)] disabled:opacity-35 disabled:cursor-not-allowed transition-colors"
                    >
                      เคลียร์
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-theme-text-muted">
                    <div className="flex-1 border-t border-[var(--color-border)]" />
                    <span>หรืออัปโหลดรูป / PDF</span>
                    <div className="flex-1 border-t border-[var(--color-border)]" />
                  </div>

                  <label className="flex flex-col gap-1 text-[10px] text-theme-text-muted px-0.5">
                    <span className="font-semibold text-theme-text-secondary">OCR รูปโพย</span>
                    <select
                      value={lineOcrEngine}
                      onChange={(e) => {
                        const v = e.target.value as LineOcrEngineChoice;
                        setLineOcrEngine(v);
                        try {
                          localStorage.setItem(LINE_OCR_ENGINE_STORAGE_KEY, v);
                        } catch {
                          /* noop */
                        }
                      }}
                      className="rounded-lg border border-[var(--color-input-border)] bg-[var(--color-input-bg)] px-2 py-1.5 text-xs text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                    >
                      <option value="auto">อัตโนมัติ — Paddle ก่อน แล้ว Google Vision (ประหยัดโควตา Vision; ปรับที่ API: OCR_IMAGE_AUTO_ORDER)</option>
                      <option value="google-vision">Google Cloud Vision เท่านั้น</option>
                      <option value="paddle">PaddleOCR บนเซิร์ฟเวอร์เท่านั้น</option>
                      <option value="browser">ไม่เรียก API — ใช้ Tesseract ในเบราว์เซอร์</option>
                    </select>
                  </label>

                  <div
                    onDragOver={e => { e.preventDefault(); setImgDragOver(true); }}
                    onDragLeave={() => setImgDragOver(false)}
                    onDrop={e => { e.preventDefault(); setImgDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
                    onClick={() => imgInputRef.current?.click()}
                    className={`flex items-center justify-center min-h-[3.25rem] rounded-xl border-2 border-dashed px-3 cursor-pointer text-xs transition-colors select-none
                      ${imgDragOver ? 'border-[var(--color-border-strong)] bg-[var(--bg-hover)] text-theme-text-primary' : 'border-[var(--color-border)] bg-[var(--bg-glass-subtle)] hover:border-[var(--color-border-strong)] text-theme-text-muted hover:text-theme-text-secondary'}`}
                  >
                    {ocrLoading
                      ? <span className="text-theme-text-secondary animate-pulse">กำลังอ่านรูป…</span>
                      : <span>ลากรูปหรือคลิกเลือกไฟล์</span>}
                  </div>
                  {ocrError && (
                    <div className="text-xs text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-2 py-1.5 shrink-0">
                      {ocrError}
                    </div>
                  )}
                  {ocrServerFallbackNote && !ocrError && (
                    <div className="text-[10px] leading-snug text-amber-800 dark:text-amber-200/95 bg-amber-500/15 border border-amber-500/35 rounded-lg px-2 py-1.5 shrink-0">
                      <span className="font-semibold">เซิร์ฟเวอร์ OCR ไม่ได้ข้อความ</span>
                      {' — '}
                      {ocrServerFallbackNote}
                      {' · '}
                      <span className="italic">ใช้ Tesseract ในเครื่องแทน — ตรวจสอบ credentials / Paddle บน API ถ้าต้องการให้อ่านจากเซิร์ฟเวอร์</span>
                    </div>
                  )}
                  {imageOcrSource && (
                    <p className="text-[10px] text-theme-text-secondary px-0.5 -mt-1">
                      <span className="font-semibold text-profit">OCR รอบนี้:</span>{' '}
                      {imageOcrSource === 'paddle'
                        ? 'PaddleOCR บนเซิร์ฟเวอร์'
                        : imageOcrSource === 'google-vision'
                          ? 'Google Cloud Vision (Document Text Detection)'
                          : 'Tesseract ในเบราว์เซอร์ (สำรอง / หรือเลือกไม่เรียก API)'}
                    </p>
                  )}
                  <p className="text-[10px] leading-snug text-theme-text-muted px-0.5">
                    รูปจะถูกประมวลผลก่อนส่ง OCR (ขยายความละเอียด เน้นหมึกน้ำเงิน/ลดพื้นหลังตาราง) — Paddle บนเซิร์ฟเวอร์ก็ใช้ขั้นตอนคล้ายกันหลังอัปโหลด · อัตโนมัติหรือเบราว์เซอร์ — สำรอง Tesseract ได้
                  </p>

                  <div
                    onDragOver={e => { e.preventDefault(); setPdfDragOver(true); }}
                    onDragLeave={() => setPdfDragOver(false)}
                    onDrop={e => {
                      e.preventDefault(); setPdfDragOver(false);
                      const f = e.dataTransfer.files[0];
                      if (f) handlePdfFile(f);
                    }}
                    onClick={() => pdfInputRef.current?.click()}
                    className={`flex items-center justify-center min-h-[3.25rem] rounded-xl border-2 border-dashed px-3 cursor-pointer text-xs transition-colors select-none
                      ${pdfDragOver ? 'border-[var(--color-border-strong)] bg-[var(--bg-hover)] text-theme-text-primary' : 'border-[var(--color-border)] bg-[var(--bg-glass-subtle)] hover:border-[var(--color-border-strong)] text-theme-text-muted hover:text-theme-text-secondary'}`}
                  >
                    {pdfLoading
                      ? <span className="text-theme-text-secondary animate-pulse">กำลังอ่าน PDF…</span>
                      : <span>ลาก PDF หรือคลิกเลือกไฟล์</span>}
                  </div>
                </div>
              </div>

              {importResult && (
                <div className="shrink-0 px-4 sm:px-5 py-2.5 border-t border-[var(--color-border)] bg-[var(--color-card-bg-solid)] safe-area-pb">
                  <span className={`text-sm font-semibold ${importResult.ok ? 'text-profit' : 'text-loss'}`}>
                    {importResult.msg}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {lineImportToast && (
        <div
          role="status"
          className={cn(
            'fixed bottom-5 left-1/2 z-[60] flex max-w-[min(92vw,26rem)] -translate-x-1/2 items-center gap-2 rounded-xl border px-4 py-3 shadow-lg pointer-events-auto',
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

    </AppShell>
  );
}

function SearchPanel({
  q,
  setQ,
  onSearch,
  onNext,
  onClear,
  matchCount,
  activeIndex,
}: {
  q: string;
  setQ: (v: string) => void;
  onSearch: () => void;
  onNext: () => void;
  onClear: () => void;
  matchCount: number;
  activeIndex: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-1.5">
        <input
          value={q}
          onChange={e => setQ(e.target.value.replace(/\s+/g, ''))}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!q.trim()) return;
            if (activeIndex >= 0) onNext();
            else onSearch();
          }}
          placeholder="ค้นหาเลขตรงตัว..."
          className="h-8 w-full min-w-0 flex-1 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2.5 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] font-mono" />
        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:justify-start">
          <button
            onClick={() => {
              if (!q.trim()) return;
              if (activeIndex >= 0) onNext();
              else onSearch();
            }}
            className="btn-toolbar-glow btn-fintech-search h-7 shrink-0 px-3 text-xs">
            ค้นหา
          </button>
          <button
            onClick={onClear}
            className="btn-toolbar-glow btn-fintech-spark h-7 shrink-0 px-3 text-xs">
            เคลียร์
          </button>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-theme-text-muted">
        {q.trim()
          ? matchCount > 0
            ? `พบ ${matchCount} รายการในแผ่นนี้${activeIndex >= 0 ? ` • ลำดับ ${activeIndex + 1}/${matchCount}` : ''}`
            : 'ไม่พบเลขนี้ในแผ่นนี้'
          : 'ค้นหาเฉพาะลูกค้าและแผ่นที่เลือกอยู่เท่านั้น'}
      </div>
    </div>
  );
}
