'use client';
import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { flushSync } from 'react-dom';
import { roundsApi, betsApi, customersApi, limitsApi, type RoundBetsSummary } from '@/lib/api';
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
import { buildBetSlipSheetsHtml, openPrintPreview } from '@/lib/printPreview';
import { downloadHtmlAsPdf } from '@/lib/htmlToPdf';
import {
  playSaveBet,
  playImportSuccess,
  playError,
  playBlockedNumberAlarm,
  playExpansionWarning,
  isBlockedBetApiMessage,
  speak,
  speakNumber,
  speakAmounts,
  speakQueued,
  speakAppend,
  cancelSpeech,
  speakVoiceAudit,
  buildVoiceAuditLine,
} from '@/lib/sounds';
import { cn } from '@/lib/utils';
import { CSV_UTF8_BOM, formatBetCsvLine, downloadTextFile } from '@/lib/csvExport';
import { downloadZip } from '@/lib/downloadZip';
import {
  analyzeBetKeyWarning,
  previewBetKeyWarning,
  findBlockedBetsInParsed,
} from '@/lib/betKeyWarnings';
import { buildWinningKeysFromResultData, groupTouchesWinningDraw } from '@/lib/drawWinning';
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

/** โหมดตรวจด้วยเสียงบนตารางโพย — จำในเครื่อง */
const STORAGE_BETS_VOICE_AUDIT = 'cuthuay-bets-voice-audit';
const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function readVoiceAuditMode(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(STORAGE_BETS_VOICE_AUDIT) === '1';
  } catch {
    return false;
  }
}

function writeVoiceAuditMode(on: boolean) {
  try {
    localStorage.setItem(STORAGE_BETS_VOICE_AUDIT, on ? '1' : '0');
  } catch { /* ignore */ }
}

const STORAGE_BETS_VOICE_AUDIT_RATE = 'cuthuay-bets-voice-audit-rate';

function readVoiceAuditRate(): number {
  if (typeof window === 'undefined') return 2.65;
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_BETS_VOICE_AUDIT_RATE) ?? '');
    if (!isNaN(v) && v >= 0.5 && v <= 3) return Math.round(v * 100) / 100;
  } catch { /* ignore */ }
  return 2.65;
}

function writeVoiceAuditRate(rate: number) {
  try {
    localStorage.setItem(STORAGE_BETS_VOICE_AUDIT_RATE, String(rate));
  } catch { /* ignore */ }
}

const STORAGE_BETS_VOICE_AUDIT_CP = 'cuthuay-bets-voice-audit-checkpoint';

type VoiceAuditCheckpointV1 = {
  v: 1;
  roundId: string;
  customerId: string;
  sheet: number;
  focusedIdx: number;
  betSheetSort: BetSheetSortOrder;
  updatedAt: number;
};

function readVoiceAuditCheckpoint(): VoiceAuditCheckpointV1 | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_BETS_VOICE_AUDIT_CP);
    if (!raw) return null;
    const j = JSON.parse(raw) as VoiceAuditCheckpointV1;
    if (j?.v !== 1 || typeof j.focusedIdx !== 'number') return null;
    return j;
  } catch {
    return null;
  }
}

function writeVoiceAuditCheckpoint(cp: VoiceAuditCheckpointV1) {
  try {
    localStorage.setItem(STORAGE_BETS_VOICE_AUDIT_CP, JSON.stringify(cp));
  } catch { /* ignore */ }
}

function clearVoiceAuditCheckpoint(): void {
  try {
    localStorage.removeItem(STORAGE_BETS_VOICE_AUDIT_CP);
  } catch { /* ignore */ }
}

/** ซูมทั้งหน้ารับแทง (แผงซ้าย + ขวา + แถบเลือกงวด) — A− / A+ ด้านล่างโพย */
const STORAGE_BETS_PAGE_ZOOM = 'cuthuay-bets-page-zoom';

function readBetsPageZoom(): number {
  if (typeof window === 'undefined') return 100;
  try {
    const v = parseFloat(localStorage.getItem(STORAGE_BETS_PAGE_ZOOM) ?? '');
    if (!isNaN(v)) return Math.min(155, Math.max(75, Math.round(v)));
  } catch { /* ignore */ }
  return 100;
}

function writeBetsPageZoom(z: number): void {
  try {
    localStorage.setItem(STORAGE_BETS_PAGE_ZOOM, String(z));
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

const EMPTY_ROUND_SUMMARY: RoundBetsSummary = { by_type: {}, total: 0 };

/** รวมแถวโพยใน state — ไม่ต้อง GET ทั้งงวดหลังบันทึกแต่ละบรรทัด */
function mergeBetsInState(prev: Bet[], add: Bet[], removeIds: string[] = []): Bet[] {
  const remove = new Set(removeIds);
  const byId = new Map<string, Bet>();
  for (const b of prev) {
    if (!remove.has(b.id)) byId.set(b.id, b);
  }
  for (const b of add) byId.set(b.id, b);
  return [...byId.values()];
}

function patchRoundSummary(
  prev: RoundBetsSummary,
  added: Bet[],
  removed: Bet[],
): RoundBetsSummary {
  const by_type = { ...prev.by_type };
  let total = prev.total;
  const apply = (b: Bet, sign: 1 | -1) => {
    const amt = Number(b.amount);
    const key = b.bet_type;
    by_type[key] = (by_type[key] ?? 0) + sign * amt;
    total += sign * amt;
  };
  for (const b of removed) apply(b, -1);
  for (const b of added) apply(b, 1);
  return { by_type, total };
}

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
  'bg-[var(--color-surface)] text-theme-text-secondary border-border',
  'bg-surface-100 text-theme-text-primary border-[var(--color-border-strong)]',
  'bg-surface-50 text-theme-text-secondary border-border',
  'bg-[var(--color-surface)] text-theme-text-primary border-[var(--color-border-strong)]',
  'bg-surface-100 text-theme-text-secondary border-border',
  'bg-surface-50 text-theme-text-primary border-border',
  'bg-[var(--color-surface)] text-theme-text-secondary border-[var(--color-border-strong)]',
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

function parseBetTs(raw: string): Date {
  const s = raw.includes('T') ? raw : raw.replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00');
  return new Date(s);
}

/** รูปแบบเวลาในตารางโพย — แสดงชั่วโมง:นาที:วินาที */
const BET_TABLE_TIME_OPTS: Intl.DateTimeFormatOptions = {
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
};

function formatBetTableTime(d: Date): string {
  return d.toLocaleTimeString('th-TH', BET_TABLE_TIME_OPTS);
}

/** HH:mm:ss + .มิลลิวินาที ถ้า timestamp จาก DB มีเศษวินาที */
function formatBetTableTimeFromRaw(raw: string, d: Date): string {
  const base = Number.isNaN(d.getTime()) ? pgTimeFallback(raw, 8) : formatBetTableTime(d);
  const frac = raw.match(/[T ]\d{2}:\d{2}:\d{2}\.(\d{1,6})/);
  if (!frac) return base;
  const ms = frac[1].padEnd(3, '0').slice(0, 3);
  return `${base}.${ms}`;
}

function pgTimeFallback(raw: string, len: number): string {
  const tIdx = raw.includes('T') ? raw.indexOf('T') + 1 : raw.indexOf(' ') + 1;
  if (tIdx <= 0) return raw.slice(0, len);
  return raw.slice(tIdx, tIdx + len);
}

/** เวลาคีย์ครั้งแรกในตาราง + ป้ายแก้ไขเมื่อมีการแก้โพยหลังคีย์ (ใช้ updated_at จาก DB) */
function groupBetTimestamps(group: BetSheetGroup): {
  keyedAt: string;
  timeShort: string;
  keyedTooltip: string;
  keyedSubtitle: string;
  editBadge: { short: string; tip: string } | null;
} {
  const bets = group.bets;
  if (!bets.length) {
    return { keyedAt: '', timeShort: '', keyedTooltip: '', keyedSubtitle: '', editBadge: null };
  }

  const keyedAt = bets.reduce((min, b) => (b.created_at < min ? b.created_at : min), bets[0].created_at);
  const dk = parseBetTs(keyedAt);
  const timeShort = formatBetTableTimeFromRaw(keyedAt, dk);

  const keyedTooltip = Number.isNaN(dk.getTime())
    ? `คีย์ครั้งแรก ${keyedAt}`
    : `คีย์ครั้งแรก ${dk.toLocaleString('th-TH', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...BET_TABLE_TIME_OPTS,
      })}`;

  const keyedSubtitle = Number.isNaN(dk.getTime())
    ? pgTimeFallback(keyedAt, 12)
    : `${dk.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${timeShort}`;

  const hasUpdated = bets.some(
    (b) => b.updated_at != null && String(b.updated_at).trim().length > 0,
  );
  if (!hasUpdated) {
    return { keyedAt, timeShort, keyedTooltip, keyedSubtitle, editBadge: null };
  }

  let editedMaxStr = keyedAt;
  for (const b of bets) {
    const u = b.updated_at ?? b.created_at;
    if (u > editedMaxStr) editedMaxStr = u;
  }

  const tKey = dk.getTime();
  const de = parseBetTs(editedMaxStr);
  const tEdit = de.getTime();
  if (Number.isNaN(tKey) || Number.isNaN(tEdit)) {
    return { keyedAt, timeShort, keyedTooltip, keyedSubtitle, editBadge: null };
  }

  const sameCalendarDay =
    dk.getFullYear() === de.getFullYear() &&
    dk.getMonth() === de.getMonth() &&
    dk.getDate() === de.getDate();

  /** ไม่โชว์ถ้าเพิ่งคีย์ใหม่ (created_at ≈ updated_at ในวันเดียวกัน) */
  const EDIT_SHOW_EPSILON_MS = 8_000;
  if (sameCalendarDay && tEdit - tKey < EDIT_SHOW_EPSILON_MS) {
    return { keyedAt, timeShort, keyedTooltip, keyedSubtitle, editBadge: null };
  }

  const tipDate = de.toLocaleDateString('th-TH', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const tipTime = formatBetTableTimeFromRaw(editedMaxStr, de);
  const tip = `แก้ไขเมื่อ ${tipDate} ${tipTime}`;
  const short = sameCalendarDay
    ? tipTime
    : `${de.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' })} ${tipTime}`;

  return { keyedAt, timeShort, keyedTooltip, keyedSubtitle, editBadge: { short, tip } };
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
  /** ยอดรวมทั้งงวด — โหลดแยกจากโพยลูกค้า (เบา, ไม่กระทบ logic คำนวณ) */
  const [roundSummary, setRoundSummary]             = useState<RoundBetsSummary>(EMPTY_ROUND_SUMMARY);
  /** โพยที่ตรงผลรางวัลแล้ว — ใช้ไฮไลต์แถวในตาราง */
  const [roundDrawWinKeys, setRoundDrawWinKeys]     = useState<Set<string>>(() => new Set());
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
  const [rowFs]                       = useState(12);    // px — scale เพิ่มจากซูมทั้งหน้า (A− / A+)
  const [sumFs, setSumFs]             = useState(12);    // font-size px for the right summary panel
  /** ซูมทั้งหน้ารับแทง — ปุ่ม «ขนาด» A− / A+ ด้านล่างโพย */
  const [betsPageZoomPercent, setBetsPageZoomPercent] = useState(readBetsPageZoom);
  const [soundOn, setSoundOn]         = useState(true);  // เปิด/ปิดเสียง TTS
  const [speechRate, setSpeechRate]   = useState(2.2);   // ความเร็วเสียงพูด
  /** พูดเลข–ยอดเมื่อโฟกัสแถว แล้วเลื่อนถัดไปหลังพูดจบ */
  const [voiceAuditMode, setVoiceAuditMode] = useState(readVoiceAuditMode);
  /** ความเร็วพูดเฉพาะโหมดตรวจด้วยเสียง (ไม่ผูกกับความเร็วตอนคีย์โพย) */
  const [voiceAuditRate, setVoiceAuditRate] = useState(readVoiceAuditRate);
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
  const [slipPdfExporting, setSlipPdfExporting] = useState(false);
  /** เลขปิดรับของงวด (all + ลูกค้าที่เลือก) — ตรวจก่อนยิง API */
  const [blockedLimitKeys, setBlockedLimitKeys] = useState<Set<string>>(new Set());

  const numRef      = useRef<HTMLInputElement>(null);
  const amtRef      = useRef<HTMLInputElement>(null);
  /** ราคาที่บันทึกสำเร็จล่าสุด (ไม่รวมท้าย -) — ใช้เมื่อช่องราคาว่างแต่ต้องการ Enter บันทึกเลขใหม่เร็ว */
  const lastCommittedAmtTemplateRef = useRef<string>('');
  const imgInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const tableScrollRef = useRef<HTMLDivElement>(null);
  const moveDialogRef = useRef<HTMLDivElement>(null);
  const csvDialogRef = useRef<HTMLDivElement>(null);
  const lineDialogRef = useRef<HTMLDivElement>(null);
  /** รวมรีเฟรชจาก WebSocket หลังบันทึกเอง — กันสองรอบติดกันดีด scroll / กระพริบตาราง */
  const wsSilentFetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDragging     = useRef(false);
  const numSpeakTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const amtSpeakTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundOnRef     = useRef(true);
  const speechRateRef  = useRef(2.2);
  const voiceAuditModeRef = useRef(false);
  const voiceAuditRateRef = useRef(readVoiceAuditRate());
  const voiceAuditPausedRef = useRef(false);
  const voiceAuditRestoreKeyRef = useRef('');

  // keep refs in sync with state
  useEffect(() => { soundOnRef.current = soundOn; }, [soundOn]);
  useEffect(() => { speechRateRef.current = speechRate; }, [speechRate]);
  useEffect(() => { voiceAuditModeRef.current = voiceAuditMode; }, [voiceAuditMode]);
  useEffect(() => { voiceAuditRateRef.current = voiceAuditRate; }, [voiceAuditRate]);
  useEffect(() => { voiceAuditPausedRef.current = voiceAuditPaused; }, [voiceAuditPaused]);

  useEffect(() => {
    if (!voiceAuditMode) {
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
    const activeDialog = lineModal
      ? lineDialogRef.current
      : moveModal
        ? moveDialogRef.current
        : csvModalOpen
          ? csvDialogRef.current
          : null;
    if (!activeDialog) return;

    const focusable = activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable[0]?.focus();

    const closeActiveDialog = () => {
      if (lineModal) {
        setLineModal(false);
        setImportResult(null);
        return;
      }
      if (moveModal) {
        setMoveModal(false);
        return;
      }
      if (csvModalOpen) setCsvModalOpen(false);
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeActiveDialog();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = activeDialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const current = document.activeElement as HTMLElement | null;
      if (e.shiftKey && current === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault();
        first.focus();
      }
    };

    activeDialog.addEventListener('keydown', onKeyDown);
    return () => activeDialog.removeEventListener('keydown', onKeyDown);
  }, [csvModalOpen, lineModal, moveModal]);

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
          setNumInput('');
          setAmtInput('');
          setParseError('');
          setNumHint('');
          setTimeout(() => numRef.current?.focus(), 0);
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
      const isOurBetInput = ae === numRef.current || ae === amtRef.current;
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

  const fetchRoundSummary = useCallback(async () => {
    if (!selectedRoundId) {
      setRoundSummary(EMPTY_ROUND_SUMMARY);
      return;
    }
    try {
      const res = await betsApi.roundSummary(selectedRoundId);
      setRoundSummary(res.data);
    } catch {
      /* แผงสรุปงวด — ไม่บล็อกการคีย์ */
    }
  }, [selectedRoundId]);

  useEffect(() => {
    if (!selectedRoundId) {
      setBlockedLimitKeys(new Set());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const reqs = [
          limitsApi.list(selectedRoundId, { entity_type: 'all' }),
          ...(selectedCustomerId
            ? [limitsApi.list(selectedRoundId, { entity_type: 'customer', entity_id: selectedCustomerId })]
            : []),
        ];
        const results = await Promise.all(reqs);
        if (cancelled) return;
        const keys = new Set<string>();
        for (const res of results) {
          const rows = (res.data as { limits?: { number: string; bet_type: string; is_blocked: boolean }[] }).limits ?? [];
          for (const row of rows) {
            if (row.is_blocked) keys.add(`${row.number}::${row.bet_type}`);
          }
        }
        setBlockedLimitKeys(keys);
      } catch {
        if (!cancelled) setBlockedLimitKeys(new Set());
      }
    })();
    return () => { cancelled = true; };
  }, [selectedRoundId, selectedCustomerId]);

  const fetchBets = useCallback(async (opts?: { silent?: boolean }) => {
    if (!selectedRoundId) return;
    const silent = opts?.silent === true;
    if (!silent) setLoading(true);
    try {
      const res = await betsApi.list(
        selectedRoundId,
        selectedCustomerId || undefined,
      );
      setSavedBets(res.data.bets ?? []);
    } catch { /* silent refresh failure */ }
    finally {
      if (!silent) setLoading(false);
    }
  }, [selectedRoundId, selectedCustomerId]);

  const refreshBetsFromServer = useCallback(
    async (opts?: { silent?: boolean }) => {
      await Promise.all([fetchBets(opts), fetchRoundSummary()]);
    },
    [fetchBets, fetchRoundSummary],
  );

  const applyLocalBetsPatch = useCallback(
    (patch: { add?: Bet[]; remove?: Bet[] }) => {
      const add = patch.add ?? [];
      const remove = patch.remove ?? [];
      const removeIds = remove.map((b) => b.id);
      setSavedBets((prev) => mergeBetsInState(prev, add, removeIds));
      if (remove.length || add.length) {
        setRoundSummary((prev) => patchRoundSummary(prev, add, remove));
      }
    },
    [],
  );

  const queueSilentFetchFromWs = useCallback(() => {
    if (wsSilentFetchTimerRef.current) clearTimeout(wsSilentFetchTimerRef.current);
    wsSilentFetchTimerRef.current = setTimeout(() => {
      wsSilentFetchTimerRef.current = null;
      void refreshBetsFromServer({ silent: true });
    }, 180);
  }, [refreshBetsFromServer]);

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
    void refreshBetsFromServer();
    const round = rounds.find(r => r.id === selectedRoundId);
    setSelectedRound(round ?? null);
  }, [selectedRoundId, selectedCustomerId, rounds, refreshBetsFromServer]);

  useEffect(() => {
    if (!moveModal || !selectedRoundId) return;
    const targetId =
      moveTargetCustomerId === '__same__' ? selectedCustomerId : moveTargetCustomerId;
    if (!targetId || targetId === selectedCustomerId) {
      setMoveOtherCustomerMaxSheet(1);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await betsApi.list(selectedRoundId, targetId);
        if (cancelled) return;
        const bets = res.data.bets ?? [];
        const max = bets.length ? Math.max(...bets.map((b) => b.sheet_no ?? 1)) : 1;
        setMoveOtherCustomerMaxSheet(max);
      } catch {
        if (!cancelled) setMoveOtherCustomerMaxSheet(1);
      }
    })();
    return () => { cancelled = true; };
  }, [moveModal, moveTargetCustomerId, selectedRoundId, selectedCustomerId]);

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
      if (wsSilentFetchTimerRef.current) {
        clearTimeout(wsSilentFetchTimerRef.current);
        wsSilentFetchTimerRef.current = null;
      }
    };
  }, [queueSilentFetchFromWs]);

  /** เลือกแผ่นล่าสุดของลูกค้าเมื่อ «เปลี่ยนลูกค้า» เท่านั้น — อย่ากระโดดแผ่นทุกครั้งที่ refresh savedBets (แก้ไขเลข / WS)
   * เมื่อโหลดโพยครั้งแรกของลูกค้าที่เลือก (savedBets ว่างแล้วมีข้อมูล) ให้ไปแผ่นล่าสุดครั้งเดียว */
  const prevCustomerIdForSheetRef = useRef(selectedCustomerId);
  const hadCustomerBetsForSheetRef = useRef(false);
  useEffect(() => {
    const customerBets = selectedCustomerId
      ? savedBets.filter(b => b.customer_id === selectedCustomerId)
      : [];
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
      hadCustomerBetsForSheetRef.current = false;
      return;
    }

    if (!hadCustomerBetsForSheetRef.current) {
      hadCustomerBetsForSheetRef.current = true;
      setSheet(latestSheet);
      setSelectedGroups(new Set());
    }
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
    const expansionHint = describeNumberExpansion(filtered);
    const keyWarn = previewBetKeyWarning(filtered, amtInput);
    setNumHint(keyWarn ?? expansionHint);
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
    // *xxx- = กลับโต๊ด → auto-commit — ถ้าช่องเหลือแค่ "-" ให้ใช้ราคาค้างจากครั้งล่าสุด
    if (klapAmt) {
      const core = stripTrailingKlapHyphen(filtered);
      const payload = core ? filtered : (lastCommittedAmtTemplateRef.current ? `${lastCommittedAmtTemplateRef.current}-` : '');
      if (!payload || !stripTrailingKlapHyphen(payload)) {
        setParseError('ไม่มีราคาสำหรับกลับ — คีย์ยอดก่อน');
        return;
      }
      setTimeout(() => { void commitLineWith(numInput, payload, 'กลับ', true); }, 0);
      return;
    }
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
    const keyWarn = previewBetKeyWarning(numInput, filtered);
    setParseError(keyWarn ?? result.error ?? '');
  };

  /** ราคาที่จะใช้บันทึก — ช่องว่างให้ดึงจากครั้งล่าสุดที่สำเร็จ */
  const resolveAmtForCommit = () => (amtInput.trim() || lastCommittedAmtTemplateRef.current).trim();

  /** ตัดท้าย - (สัญญาณกลับ) — ถ้าเหลือแค่ '-' จากการลากดำแล้วกด - จะได้ '' */
  const stripTrailingKlapHyphen = (s: string) => s.replace(/-+$/, '').trim();

  const onNumKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
      if (!expandNumberInput(numInput)) { setParseError('รูปแบบเลขไม่ถูกต้อง'); return; }
      if (numSpeakTimer.current) { clearTimeout(numSpeakTimer.current); numSpeakTimer.current = null; }
      tts('ยอด');
      setActiveField('amt');
      if (!amtInput.trim() && lastCommittedAmtTemplateRef.current) {
        const fill = lastCommittedAmtTemplateRef.current;
        setAmtInput(fill);
        const pv = parseBetLine(numInput, fill);
        setParseError(pv.error ?? '');
      }
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

    const keyWarn = analyzeBetKeyWarning(num, amt, result);
    if (keyWarn) {
      playExpansionWarning(keyWarn.kind);
      setParseError(keyWarn.message);
      if (keyWarn.blockCommit) {
        setTimeout(() => numRef.current?.focus(), 0);
        return;
      }
    }

    const blockedNums = findBlockedBetsInParsed(result.bets, blockedLimitKeys);
    if (blockedNums.length > 0) {
      playBlockedNumberAlarm();
      setParseError(`เลขปิดรับแล้ว: ${blockedNums.join(', ')} — แก้เลขหรือปลดอั้นก่อนคีย์`);
      setTimeout(() => numRef.current?.focus(), 0);
      return;
    }

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
      if (apiBets?.length) applyLocalBetsPatch({ add: apiBets });
      else await fetchBets({ silent: true });
      if (insertedMarker) setRecentChangedMarker(insertedMarker);
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumberAlarm();
      else if (sum.inserted === 0 && sum.errors.length) playError();

      if (sum.inserted > 0) {
        playSaveBet();
        tts(voice);
        if (numSpeakTimer.current) { clearTimeout(numSpeakTimer.current); numSpeakTimer.current = null; }
        if (amtSpeakTimer.current) { clearTimeout(amtSpeakTimer.current); amtSpeakTimer.current = null; }
        const stripped = stripTrailingKlapHyphen(amt);
        if (stripped) lastCommittedAmtTemplateRef.current = stripped;
        const nextAmt = keepAmt ? (stripped || lastCommittedAmtTemplateRef.current) : '';
        setNumInput(''); setAmtInput(nextAmt); setParseError(errTxt); setNumHint(''); setActiveField('num');
        setSelectedGroups(new Set());
        setTimeout(() => numRef.current?.focus(), 0);
      } else {
        setParseError(errTxt || 'ไม่มีรายการถูกบันทึก (เช็คเลขปิดหรือรูปแบบ)');
        setTimeout(() => numRef.current?.focus(), 0);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (isBlockedBetApiMessage(msg)) playBlockedNumberAlarm();
      else playError();
      setParseError(msg);
    }
    finally { setIsSaving(false); }
  };

  const commitLine = () => {
    const amtSrc = resolveAmtForCommit();
    if (!numInput.trim() || !amtSrc) return;
    const voice = isKlap || amtSrc.endsWith('-') ? 'กลับ' : 'บันทึก';
    void commitLineWith(numInput, amtSrc, voice, true);
  };

  const deleteSavedGroup = async (bets: Bet[]) => {
    if (!confirm('ลบโพยนี้?')) return;
    try {
      await betsApi.bulkDelete(bets.map(b => b.id));
      applyLocalBetsPatch({ remove: bets });
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
      const removed = toDelete.flatMap(g => g.bets);
      await betsApi.bulkDelete(removed.map(b => b.id));
      setSelectedGroups(new Set());
      applyLocalBetsPatch({ remove: removed });
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
    const moved = toMove.flatMap(g => g.bets);
    if (isCustomerChange) {
      applyLocalBetsPatch({ remove: moved });
    } else {
      setSavedBets((prev) =>
        prev.map((b) =>
          ids.includes(b.id) ? { ...b, sheet_no: targetSheet } : b,
        ),
      );
    }
  };

  const handleAddSheet = () => {
    const next = effectiveMaxSheets + 1;
    setMaxSheets(next);
    setSheet(next);
    setSelectedGroups(new Set());
  };

  const handleRemoveSheet = () => {
    const betsInSheet = savedBets.filter(
      b => (b.sheet_no ?? 1) === sheet && (!selectedCustomerId || b.customer_id === selectedCustomerId),
    );
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

  const exitEditMode = useCallback((opts?: { clearInputs?: boolean }) => {
    setEditInlineKey(null);
    setEditInlineCreatedAt('');
    if (opts?.clearInputs) {
      setNumInput('');
      setAmtInput('');
      setParseError('');
      setNumHint('');
    }
    setTimeout(() => numRef.current?.focus(), 0);
  }, []);

  const loadGroupForEdit = useCallback((group: BetSheetGroup) => {
    const key = groupKey(group);
    const preserveTs = group.bets.reduce(
      (min, b) => (b.created_at < min ? b.created_at : min),
      group.bets[0].created_at,
    );
    const row = buildRowFromBets(group.bets);
    const expanded = expandNumberInput(group.number);
    let amtStr = '';
    if (expanded) {
      const m = expanded.mode;
      setInputMode(m);
      if (m === 'run') amtStr = `${row['1digit_top']}+${row['1digit_bottom']}`;
      else if (m === '2digit') amtStr = `${row['2digit_top']}+${row['2digit_bottom']}`;
      else amtStr = `${row['3digit_top']}+${row['3digit_tote']}+${row['3digit_back']}`;
    }
    setNumInput(group.number);
    setAmtInput(amtStr);
    setEditInlineKey(key);
    setEditInlineCreatedAt(preserveTs);
    setParseError('');
    setTimeout(() => { amtRef.current?.focus(); amtRef.current?.select(); }, 0);
  }, []);

  const loadForEdit = () => {
    if (selectedGroups.size !== 1) return;
    const key = Array.from(selectedGroups)[0];
    const group = sheetGroupedRef.current.find(g => groupKey(g) === key);
    if (!group) return;
    loadGroupForEdit(group);
  };

  const saveInlineEdit = async () => {
    if (!editInlineKey || !editInlineCreatedAt || !selectedRoundId) return;
    const group = sheetGrouped.find(g => groupKey(g) === editInlineKey);
    if (!group) return;
    await replaceGroupWithValues(group, numInput, amtInput, true, editInlineCreatedAt);
  };

  const replaceGroupWithValues = async (
    group: BetSheetGroup,
    nextNum: string,
    nextAmt: string,
    clearInputsAfter: boolean,
    preserveCreatedAt?: string,
  ) => {
    if (!selectedRoundId) return;
    if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!nextNum.trim() || !nextAmt.trim()) { setParseError('กรอกเลขและราคาให้ครบ'); return; }

    const result = parseBetLine(nextNum, nextAmt);
    if (result.error || !result.bets.length) { setParseError(result.error ?? 'ไม่มีรายการ'); return; }

    const keyWarn = analyzeBetKeyWarning(nextNum, nextAmt, result);
    if (keyWarn) {
      playExpansionWarning(keyWarn.kind);
      setParseError(keyWarn.message);
      if (keyWarn.blockCommit) return;
    }
    const blockedNums = findBlockedBetsInParsed(result.bets, blockedLimitKeys);
    if (blockedNums.length > 0) {
      playBlockedNumberAlarm();
      setParseError(`เลขปิดรับแล้ว: ${blockedNums.join(', ')} — แก้เลขหรือปลดอั้นก่อนคีย์`);
      return;
    }

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
      await betsApi.bulkDelete(removed.map(b => b.id));
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
      const errTxt = sum.errors.join(' · ');
      if (sum.hasBlocked) playBlockedNumberAlarm();
      else if (sum.inserted === 0 && sum.errors.length) playError();

      if (sum.inserted > 0) {
        setEditInlineKey(null); setEditInlineCreatedAt('');
        if (clearInputsAfter) {
          setNumInput(''); setAmtInput('');
        }
        setParseError(errTxt);
        setSelectedGroups(new Set());
        const inserted = (bulkRes.data as BulkBetsResponse).bets ?? [];
        applyLocalBetsPatch({ add: inserted, remove: removed });
        const m = markerFromInsertedBets(inserted, result.bets[0].number);
        if (m) setRecentChangedMarker(m);
        playSaveBet();
        tts(isKlap || nextAmt.trim().endsWith('-') ? 'กลับ' : 'บันทึก');
        setTimeout(() => numRef.current?.focus(), 0);
      } else {
        setEditInlineKey(null); setEditInlineCreatedAt('');
        setParseError(errTxt || 'ไม่มีรายการถูกบันทึก — โพยเดิมถูกลบแล้ว กรุณาคีย์ใหม่');
        applyLocalBetsPatch({ remove: removed });
        setTimeout(() => numRef.current?.focus(), 0);
      }
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      if (isBlockedBetApiMessage(msg)) playBlockedNumberAlarm();
      else playError();
      setParseError(msg);
      setEditInlineKey(null); setEditInlineCreatedAt('');
      await refreshBetsFromServer({ silent: true });
    } finally { setIsSaving(false); }
  };

  const handleEditAction = () => {
    if (selectedGroups.size !== 1) return;

    if (numInput.trim() && amtInput.trim()) {
      const key = Array.from(selectedGroups)[0];
      const group = sheetGrouped.find(g => groupKey(g) === key);
      if (!group) return;
      const preserveTs = group.bets.reduce((min, b) => (b.created_at < min ? b.created_at : min), group.bets[0].created_at);
      void replaceGroupWithValues(group, numInput, amtInput, false, preserveTs);
      return;
    }

    loadForEdit();
  };

  const savedTotal = roundSummary.total;

  const summaryByType: Record<string, number> = {};
  COL_TYPES.forEach(c => { summaryByType[c.key] = roundSummary.by_type[c.key] ?? 0; });

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
      if (apiBets?.length) applyLocalBetsPatch({ add: apiBets });
      else await refreshBetsFromServer({ silent: true });
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

  const selectRowForEdit = useCallback(
    (idx: number, group: BetSheetGroup, e: React.MouseEvent<HTMLTableRowElement>) => {
      const key = groupKey(group);
      const native = e.nativeEvent;

      if (!voiceAuditMode && native.shiftKey && lastClickedIdxRef.current >= 0) {
        const anchor = lastClickedIdxRef.current;
        const from = Math.min(anchor, idx);
        const to = Math.max(anchor, idx);
        const next = new Set<string>();
        for (let i = from; i <= to; i++) next.add(groupKey(sheetGroupedRef.current[i]));
        setSelectedGroups(next);
        setFocusedIdx(idx);
        lastClickedIdxRef.current = idx;
        return;
      }

      setFocusedIdx(idx);
      lastClickedIdxRef.current = idx;

      if (voiceAuditMode) return;

      if (native.metaKey || native.ctrlKey) {
        const next = new Set(selectedGroups);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        setSelectedGroups(next);
        if (next.size !== 1) exitEditMode();
        return;
      }

      setSelectedGroups(new Set([key]));
    },
    [voiceAuditMode, exitEditMode],
  );

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
    if (!voiceAuditMode || focusedIdx < 0 || !soundOn) return;
    if (voiceAuditPausedRef.current) return;
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
      setFocusedIdx(prev => {
        const len = sheetGroupedRef.current.length;
        if (prev < 0 || prev >= len - 1) return prev;
        const next = prev + 1;
        scrollRowIntoView(next);
        return next;
      });
    });
    return () => {
      cancelled = true;
      cancelSpeech();
    };
  }, [focusedIdx, voiceAuditMode, soundOn, voiceAuditRate, voiceAuditNonce, currentCustomer, roundDrawWinKeys]);

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

  const buildBetSlipPrintHtml = () => {
    const customerName = currentCustomer?.name ?? 'ไม่ระบุลูกค้า';
    const roundName = currentRound?.name ?? 'ไม่ระบุงวด';
    const sheetsHtml = buildBetSlipSheetsHtml({
      customerName,
      roundName,
      sheetNo: sheet,
      lines: printLines,
      sheetTotal: printTotal,
    });
    return `<div class="print-root">${sheetsHtml}</div>`;
  };

  const handlePrint = () => {
    if (!printLines.length) return;
    const customerName = currentCustomer?.name ?? 'ไม่ระบุลูกค้า';
    const roundName = currentRound?.name ?? 'ไม่ระบุงวด';
    openPrintPreview(
      buildBetSlipPrintHtml(),
      `โพย — ${customerName} แผ่น${sheet} — ${roundName}`,
      `โพย_${customerName}_แผ่น${sheet}_${roundName}`,
    );
  };

  const handleDownloadPdf = async () => {
    if (!printLines.length || slipPdfExporting) return;
    const customerName = currentCustomer?.name ?? 'ไม่ระบุลูกค้า';
    const roundName = currentRound?.name ?? 'ไม่ระบุงวด';
    const filenameBase = `โพย_${customerName}_แผ่น${sheet}_${roundName}`.replace(/[\\/:*?"<>|]/g, '_');
    setSlipPdfExporting(true);
    try {
      await downloadHtmlAsPdf({ bodyHtml: buildBetSlipPrintHtml(), filenameBase });
    } catch {
      window.alert('สร้าง PDF ไม่สำเร็จ — ลองพิมพ์โพยแล้วบันทึกเป็น PDF แทน');
    } finally {
      setSlipPdfExporting(false);
    }
  };

  const handleExportCsv = async () => {
    const customerName = (currentCustomer?.name ?? 'ไม่ระบุลูกค้า').replace(/[\\/:*?"<>|]/g, '_');
    const roundName = (currentRound?.name ?? 'ไม่ระบุงวด').replace(/[\\/:*?"<>|]/g, '_');
    const sheetsWithData = Array.from(new Set(customerBets.map(b => b.sheet_no ?? 1))).sort((a, b) => a - b);
    if (!sheetsWithData.length) return;

    if (csvExportMode === 'combined') {
      const lines: string[] = [];
      for (const sh of sheetsWithData) {
        const groups = sortBetSheetGroups(
          groupByEntry(customerBets.filter(b => (b.sheet_no ?? 1) === sh)),
          betSheetSort,
        );
        const items = groups.map(formatCsvItem).filter((item): item is CsvItem => item !== null);
        for (const item of items) {
          lines.push(formatBetCsvLine(item.number, item.payload));
        }
      }

      downloadTextFile(
        CSV_UTF8_BOM + lines.join('\n'),
        `โพย_${customerName}_ทุกแผ่น_${roundName}.csv`,
      );
      setCsvModalOpen(false);
      return;
    }

    // แยกไฟล์ต่อแผ่น → รวมเป็น .zip (Safari โหลดหลายไฟล์พร้อมกันไม่ได้)
    const zipEntries: { path: string; content: string }[] = [];
    for (const sh of sheetsWithData) {
      const groups = sortBetSheetGroups(
        groupByEntry(customerBets.filter(b => (b.sheet_no ?? 1) === sh)),
        betSheetSort,
      );
      const items = groups.map(formatCsvItem).filter((item): item is CsvItem => item !== null);
      if (!items.length) continue;

      const text =
        CSV_UTF8_BOM + items.map((item) => formatBetCsvLine(item.number, item.payload)).join('\n');
      zipEntries.push({
        path: `โพย_${customerName}_แผ่น${sh}_${roundName}.csv`,
        content: text,
      });
    }

    if (zipEntries.length === 1) {
      downloadTextFile(zipEntries[0].content, zipEntries[0].path);
    } else if (zipEntries.length > 1) {
      await downloadZip(zipEntries, `โพย_${customerName}_ทุกแผ่น_${roundName}`);
    }
    setCsvModalOpen(false);
  };

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
    <AppShell>
      <div
        className="adapt-readable adapt-touch flex flex-col h-full min-h-0 bg-surface-default overflow-hidden"
        style={{ zoom: betsPageZoomPercent / 100 }}
      >

        {/* Top bar — พื้นขาวแยกจากแถบคีย์ด้านล่าง */}
        <div className="flex flex-wrap items-center gap-3 px-4 py-2 shrink-0 border-b border-[var(--color-border)] bg-[var(--color-card-bg)] shadow-[var(--shadow-soft)]">
          <span className="text-theme-text-secondary text-sm font-semibold">รับแทง</span>
          <div className="w-px h-4 bg-surface-300" />
          <select value={selectedRoundId} onChange={e => setSelectedRoundId(e.target.value)}
            className="ui-field bg-surface-200 border-border text-theme-text-primary">
            {roundsForPicker.length === 0
              ? <option value="">{showClosedRoundsInPicker ? '— ไม่มีงวด (หรือซ่อนหมด) —' : '— ไม่มีงวดที่เปิดรับ —'}</option>
              : roundsForPicker.map(r => {
                  const icon = r.status === 'drawn' ? '✓ ' : r.status === 'closed' ? '■ ' : '';
                  return <option key={r.id} value={r.id}>{icon}{r.name}</option>;
                })
            }
          </select>
          {isAdmin && (
            <label className="flex items-center gap-1.5 text-sm text-theme-text-muted cursor-pointer select-none shrink-0" title="เฉพาะผู้ดูแลระบบ — ดูโพยงวดที่ปิดรับหรือออกผลแล้ว">
              <input
                type="checkbox"
                checked={roundPickerShowAll}
                onChange={(e) => setRoundPickerShowAll(e.target.checked)}
                className="rounded border-border bg-surface-100 accent"
              />
              แสดงงวดปิด/ออกผล
            </label>
          )}
          <a href="/rounds" className="text-sm text-profit hover:underline">+ เริ่มงวดใหม่</a>
          <div className="flex-1" />
          <span
            className={`text-xs text-accent min-w-[6.25rem] text-right tabular-nums transition-opacity duration-150 ${isSaving ? 'opacity-100 animate-pulse' : 'opacity-0 pointer-events-none select-none'}`}
            aria-hidden={!isSaving}
          >
            กำลังบันทึก...
          </span>
        </div>

        <div
          className="app-page-split"
        >
          <div className="app-page-split-main flex flex-col min-w-0 min-h-0 overflow-hidden">

            {/* Warning: no customer selected */}
            {!selectedCustomerId && (
              <div className="shrink-0 bg-risk-medium/18 border-b border-risk-medium/45/50 px-4 py-1.5 text-xs text-risk-medium text-center select-none">
                {customers.length === 0
                  ? <>⚠ ยังไม่มีลูกค้า — <a href="/customers" className="underline">+ เพิ่มลูกค้า</a></>
                  : '⚠ กรุณาเลือกลูกค้าก่อนคีย์โพย'}
              </div>
            )}

            {/* ช่องคีย์ — premium entry tray */}
            <div className="flex min-w-0 max-w-full items-stretch gap-2.5 border-b border-[var(--color-border)] bg-white px-3 py-3 shrink-0 select-none z-[1] overflow-x-auto">
              {/* ── ช่องเลข ── */}
              <div
                style={{ width: numWidth, minWidth: 100, maxWidth: 400 }}
                className={[
                  'relative flex flex-col items-center justify-center rounded-2xl px-4 py-3 shrink-0 overflow-hidden',
                  'transition-all duration-150 ease-out',
                  activeField === 'num'
                    ? 'bg-white ring-2 ring-[var(--color-accent)] border border-[var(--color-accent)]'
                    : 'bg-white border border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
                ].join(' ')}
              >
                <span className={`text-sm font-medium mb-1.5 transition-colors duration-150 ${activeField === 'num' ? 'text-[var(--color-accent)]' : 'text-theme-text-muted'}`}>เลข</span>
                <input ref={numRef} value={numInput} onChange={e => onNumChange(e.target.value)}
                  onKeyDown={onNumKeyDown}
                  onFocus={() => {
                    setActiveField('num');
                    if (voiceAuditMode) cancelSpeech();
                  }}
                  autoFocus placeholder="123"
                  title="Enter → ไปช่องราคา (ถ้าว่างจะใส่ราคาจากครั้งล่าสุดให้เห็น)"
                  style={{ fontSize: inputFs, lineHeight: 1.1 }}
                  className="w-full text-center font-bold tracking-tight bg-transparent text-theme-text-primary placeholder:text-[var(--gray-300)] placeholder:text-xl focus:outline-none caret-accent" />
                <span className={`text-xs mt-1.5 h-4 leading-4 block text-center ${numHint ? 'text-theme-text-muted' : 'invisible'}`}>{numHint || '·'}</span>
              </div>
              {/* ── resize handle ── */}
              <div onMouseDown={onDividerMouseDown}
                className="w-1 shrink-0 cursor-col-resize self-stretch rounded-full bg-[var(--color-border)]/60 hover:bg-[var(--color-accent)]/50 active:bg-[var(--color-accent)]/70 transition-colors my-2" />
              {/* ── ช่องราคา ── */}
              <div className={[
                'relative flex min-w-0 flex-1 flex-col items-center justify-center overflow-hidden rounded-2xl px-3 py-2.5 sm:px-6',
                'transition-all duration-150 ease-out',
                activeField === 'amt'
                  ? 'bg-white ring-2 ring-[var(--color-accent)] border border-[var(--color-accent)]'
                  : 'bg-white border border-[var(--color-border)] hover:border-[var(--color-border-strong)]',
              ].join(' ')}>
                <span className={`text-sm font-medium mb-1.5 transition-colors duration-150 ${activeField === 'amt' ? 'text-[var(--color-accent)]' : 'text-theme-text-muted'}`}>ราคา</span>
                <input ref={amtRef} value={amtInput} onChange={e => onAmtChange(e.target.value)}
                  onKeyDown={onAmtKeyDown}
                  onFocus={() => {
                    setActiveField('amt');
                    if (voiceAuditMode) cancelSpeech();
                  }}
                  placeholder={inputMode === 'run' ? 'วิ่งบน*ล่าง' : inputMode === '2digit' ? 'บน*ล่าง หรือ 100-' : '3บน*โต็ด*3ล่าง'}
                  style={{ fontSize: inputFs, lineHeight: 1.1 }}
                  className="w-full text-center font-bold tracking-tight bg-transparent text-theme-text-primary placeholder:font-semibold placeholder:text-[color-mix(in_srgb,var(--primary-700)_70%,var(--gray-400)_30%)] placeholder:opacity-75 focus:outline-none caret-accent" />
                <div className="h-4 mt-1.5 flex items-center justify-center">
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
                {/* Mode + klap badges */}
                <div className="absolute top-2.5 right-3 flex gap-1.5 items-center">
                  {inputMode === 'run'    && <span className="text-sm px-2 py-1 rounded-full bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)] font-semibold">วิ่ง</span>}
                  {inputMode === '2digit' && <span className="text-sm px-2 py-1 rounded-full bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)] font-semibold">2 ตัว</span>}
                  {inputMode === '3digit' && <span className="text-sm px-2 py-1 rounded-full bg-[var(--color-badge-success-bg)] text-[var(--color-badge-success-text)] border border-[var(--color-badge-success-border)] font-semibold">3 ตัว</span>}
                  {isKlap && (() => {
                    const v = amtInput.trim();
                    const isKlapTote = inputMode === '3digit' && v.startsWith('*') && v.endsWith('-') && !v.slice(1).includes('*');
                    const isKlapBoth = inputMode === '3digit' && v.endsWith('-') && !isKlapTote && !!v.slice(0,-1).match(/^\d+\*\d+$/);
                    const label = isKlapBoth ? 'กลับบน+โต็ด' : isKlapTote ? 'กลับโต็ด' : 'กลับ';
                    return <span className="text-sm px-2 py-1 rounded-full border bg-[var(--color-badge-warning-bg)] text-[var(--color-badge-warning-text)] border-[var(--color-badge-warning-border)] font-semibold">{label}</span>;
                  })()}
                </div>
              </div>
              {/* ── Toolbar ── */}
              <div className="flex shrink-0 flex-col justify-center gap-2 border-l border-[var(--color-border)]/60 py-0.5 pl-2.5">
                {/* Font size + clear */}
                <div className="flex items-center gap-1 rounded-xl border border-[var(--color-border)] bg-white px-2 py-2 shadow-[0_1px_4px_rgba(15,23,42,0.06)]">
                  <button type="button" title="ลดขนาดตัวเลขในช่องคีย์เลข–ราคา"
                    className="btn-toolbar-glow btn-toolbar-muted ui-control !px-0 !min-w-10 rounded-lg font-bold"
                    onClick={() => setInputFs(s => Math.max(24, s - 8))}>A−</button>
                  <button type="button" title="ขยายขนาดตัวเลขในช่องคีย์เลข–ราคา"
                    className="btn-toolbar-glow btn-fintech-search ui-control !px-0 !min-w-10 rounded-lg font-bold"
                    onClick={() => setInputFs(s => Math.min(80, s + 8))}>A+</button>
                  <div className="w-px h-4 bg-[var(--color-border-muted)] mx-0.5 shrink-0" />
                  <button type="button" title="ล้างช่องเลข/ราคา"
                    className="ui-control !px-0 !min-w-10 rounded-lg border border-[var(--color-border)] bg-white font-bold text-[var(--primary-800)] hover:bg-[var(--bg-hover)] active:scale-[0.95] transition-colors duration-100"
                    onClick={() => {
                      lastCommittedAmtTemplateRef.current = '';
                      setNumInput('');
                      setAmtInput('');
                      setParseError('');
                      setNumHint('');
                      setTimeout(() => numRef.current?.focus(), 0);
                    }}>C</button>
                </div>
              </div>
            </div>

            {/* Column headers — โทนแยกจากแถบคีย์ */}
            <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)]">
              <table className="w-full min-w-[58rem] table-fixed" style={{ fontSize: rowFs }}>
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
                      aria-sort={betSheetSort === 'newestFirst' ? 'descending' : 'ascending'}
                      className="text-left py-1.5 px-2 text-theme-text-muted w-[6.25rem] whitespace-normal"
                    >
                      <button
                      type="button"
                      title={
                        betSheetSort === 'newestFirst'
                          ? 'คลิก: เรียงให้รายการล่าสุดอยู่ล่าง (ตามเวลา). เมื่อแก้โพยแล้ว คอลัมน์นี้จะโชว์เวลาแก้ไขเป็นหลัก และเวลาคีย์เดิมด้านล่าง'
                          : 'คลิก: เรียงให้รายการล่าสุดอยู่บน. เมื่อแก้โพยแล้ว คอลัมน์นี้จะโชว์เวลาแก้ไขเป็นหลัก และเวลาคีย์เดิมด้านล่าง'
                      }
                      aria-label={`เรียงคอลัมน์เวลา ตอนนี้ ${betSheetSort === 'newestFirst' ? 'ล่าสุดบน' : 'ล่าสุดล่าง'}`}
                      onClick={() => {
                        setBetSheetSort(prev => {
                          const next = prev === 'newestFirst' ? 'oldestFirst' : 'newestFirst';
                          writeBetSheetSort(next);
                          return next;
                        });
                      }}
                      className="w-full text-left cursor-pointer select-none hover:text-theme-text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-ring)] rounded-sm transition-colors">
                      <span className="inline-flex flex-col gap-0.5 leading-tight">
                        <span>เวลา</span>
                        <span className="text-[0.72em] font-semibold text-theme-text-secondary tracking-tight">
                          {betSheetSort === 'newestFirst' ? 'ล่าสุดบน' : 'ล่าสุดล่าง'}
                        </span>
                      </span>
                      </button>
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
              <table className="w-full min-w-[58rem] table-fixed" style={{ fontSize: rowFs }}>
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
                        onClick={(e) => selectRowForEdit(idx, group, e)}
                        onDoubleClick={(e) => {
                          e.preventDefault();
                          if (voiceAuditMode) return;
                          setSelectedGroups(new Set([groupKey(group)]));
                          loadGroupForEdit(group);
                        }}>
                        <td className="py-1 px-1 w-7 text-center">
                          <input type="checkbox" className="accent"
                            checked={isSelected}
                            onClick={e => { e.stopPropagation(); }}
                            title="เลือกหลายแถว (ลบ/ย้าย) — ดับเบิ้ลคลิกแถวเพื่อแก้ไข"
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
                            {editInlineKey === key && (
                              <span className="text-[0.72em] font-bold text-risk-medium leading-none whitespace-nowrap">แก้</span>
                            )}
                            {focusedIdx === idx && editInlineKey !== key && !isActiveSearchMatch && (
                              <span className="text-[0.72em] font-bold text-[var(--chart-primary-dark)] leading-none whitespace-nowrap">เลือก</span>
                            )}
                            {isLineImportHighlight && (
                              <span className="text-[0.72em] font-bold text-profit leading-none whitespace-nowrap">ไลน์</span>
                            )}
                            {isDrawWinner && (
                              <span className="text-[0.72em] font-bold text-[var(--color-badge-warning-text)] leading-none whitespace-nowrap">ถูก</span>
                            )}
                            {isRecentChanged && (
                              <span className="text-xs font-medium text-theme-text-secondary leading-none whitespace-nowrap">ล่าสุด</span>
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
                          className={`py-1 px-2 tracking-tight text-[0.92em] w-[6.25rem] tabular-nums align-top leading-snug ${
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
              <span className=" tracking-tight text-profit">{customerBets.filter(b => (b.sheet_no ?? 1) === sheet).reduce((s, b) => s + Number(b.amount), 0).toLocaleString()}</span>
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
                  <span className="text-[10px] text-theme-text-muted">(หายเองใน ~3 นาที · นำเข้ารอบใหม่จะเปลี่ยนชุดไฮไลต์)</span>
                </>
              )}
            </div>

            {/* Toolbar — ใต้ตาราง (แถบเดียว — ปุ่มแทรกไม่ถูกบัง) */}
            <div
              className={cn(
                'shrink-0 border-t px-2 py-2 min-h-[2.75rem] flex flex-wrap items-center gap-1.5 transition-colors duration-200',
                editInlineKey
                  ? 'bg-risk-medium/15 border-risk-medium/50'
                  : 'bg-surface-100 border-border',
              )}
            >
              {editInlineKey && (
                <>
                  <span className="text-xs text-risk-medium font-semibold shrink-0 whitespace-nowrap">
                    ✏️ โหมดแก้ไข
                  </span>
                  <button
                    type="button"
                    title="ปิดโหมดแก้ไข (Esc)"
                    onClick={() => exitEditMode({ clearInputs: true })}
                    className="btn-toolbar-glow btn-toolbar-danger ui-control px-3 shrink-0"
                  >
                    <span>⊗</span><span>ปิดการแก้ไข</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => void saveInlineEdit()}
                    disabled={isSaving}
                    className="btn-toolbar-glow btn-toolbar-profit disabled:shadow-none shrink-0"
                  >
                    <span>✓</span><span>บันทึก</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => exitEditMode({ clearInputs: true })}
                    className="btn-toolbar-glow btn-toolbar-muted shrink-0"
                  >
                    <span>✕</span><span>ยกเลิก</span>
                  </button>
                  <div className="hidden sm:block w-px h-6 bg-border shrink-0" aria-hidden />
                </>
              )}
              {!editInlineKey && selectedGroups.size === 1 && (
                <span className="text-[10px] text-theme-text-muted shrink-0 hidden md:inline">
                  ดับเบิ้ลคลิกแถว = แก้ไข
                </span>
              )}
              <button
                type="button"
                disabled={Boolean(editInlineKey) || selectedGroups.size !== 1 || !numInput.trim() || !resolveAmtForCommit()}
                title={editInlineKey ? 'ปิดโหมดแก้ไขก่อน' : undefined}
                onClick={() => {
                  const [insertKey] = [...selectedGroups];
                  void commitLineWith(numInput, resolveAmtForCommit(), 'แทรก', true, insertKey);
                }}
                className="btn-toolbar-glow btn-toolbar-profit shrink-0"
              >
                <span>↑</span><span>แทรก</span>
              </button>
              <button
                type="button"
                disabled={Boolean(editInlineKey) || selectedGroups.size !== 1}
                title={editInlineKey ? 'ปิดโหมดแก้ไขก่อน' : 'ดับเบิ้ลคลิกแถวก็ได้'}
                onClick={handleEditAction}
                className="btn-toolbar-glow btn-fintech-search ui-control px-3 gap-1 shrink-0"
              >
                <span>✏</span><span>แก้ไข</span>
              </button>
              <button
                type="button"
                disabled={selectedGroups.size === 0 || Boolean(editInlineKey)}
                onClick={deleteSelectedGroups}
                className="btn-toolbar-glow btn-toolbar-danger shrink-0"
              >
                <span>×</span><span>ลบ</span>
              </button>
              <button
                type="button"
                disabled={selectedGroups.size === 0 || Boolean(editInlineKey)}
                onClick={() => {
                  setSelectedGroups(new Set());
                  lastClickedIdxRef.current = -1;
                  exitEditMode();
                }}
                className="btn-toolbar-glow btn-toolbar-muted disabled:opacity-40 shrink-0"
              >
                <span>✕</span><span>ยกเลิกเลือก</span>
              </button>
              <button
                type="button"
                disabled={selectedGroups.size === 0 || Boolean(editInlineKey)}
                onClick={() => { setMoveTarget(1); setMoveTargetCustomerId('__same__'); setMoveModal(true); }}
                className="btn-toolbar-glow btn-toolbar-amber shrink-0"
              >
                <span>→</span><span>ย้ายแผ่น</span>
              </button>
              <span className="ml-auto text-theme-text-muted text-xs">{sheetGrouped.length} รายการ {selectedGroups.size > 0 && `(เลือก ${selectedGroups.size})`}</span>
              <button
                onClick={handlePrint}
                disabled={printItems.length === 0}
                className="btn-toolbar-glow btn-toolbar-amber"
                title="เปิดตัวอย่างก่อนพิมพ์"
              >
                <span>🖨</span><span>พิมพ์โพย</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadPdf}
                disabled={printItems.length === 0 || slipPdfExporting}
                className="btn-toolbar-glow btn-toolbar-profit shrink-0"
                title="ดาวน์โหลดไฟล์ PDF"
              >
                <span>⇩</span><span>{slipPdfExporting ? 'กำลังสร้าง…' : 'PDF'}</span>
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
                className="btn-toolbar-glow btn-toolbar-muted ui-control !px-2 rounded-xl font-bold"
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
                className="btn-toolbar-glow btn-fintech-search ui-control !px-2 rounded-xl font-bold"
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
                className="btn-toolbar-glow btn-fintech-spark ui-control !px-3 rounded-xl font-semibold max-sm:max-w-[11rem] truncate"
              >
                {selectedGroups.size === sheetGrouped.length && sheetGrouped.length > 0 ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
              </button>
            </div>
          </div>

          {/* แผงขวา: สรุปยอด / ลูกค้า / ค้นหา */}
          <div className="app-page-split-aside flex flex-col min-h-0 min-w-0 overflow-y-auto overflow-x-hidden">

            {/* Customer navigator + แผ่น selector */}
            <div className="p-3 shrink-0">
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-soft)] p-3 space-y-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-theme-text-muted shrink-0 w-12">ลูกค้า</span>
                  <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}
                    className="ui-field flex-1 min-w-0 bg-[var(--color-input-bg)] border-[var(--color-input-border)] text-theme-text-primary">
                    {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <button type="button" onClick={() => navigateCustomer(-1)}
                    className="btn-toolbar-glow btn-toolbar-muted ui-control !px-3 rounded-xl font-semibold shrink-0">ขึ้น</button>
                  <button type="button" onClick={() => navigateCustomer(1)}
                    className="btn-toolbar-glow btn-fintech-search ui-control !px-3 rounded-xl font-semibold shrink-0">ลง</button>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-theme-text-muted shrink-0 w-12">แผ่น</span>
                  <select value={sheet} onChange={e => { setSheet(Number(e.target.value)); setSelectedGroups(new Set()); }}
                    className="ui-field flex-1 min-w-0 bg-[var(--color-input-bg)] border-[var(--color-input-border)] text-theme-text-primary tracking-tight">
                    {Array.from({ length: effectiveMaxSheets }, (_, i) => effectiveMaxSheets - i)
                      .map(n => (
                        <option key={n} value={n}>
                          {n}{customerBets.filter(b => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}
                        </option>
                      ))}
                  </select>
                  <button type="button" onClick={handleRemoveSheet}
                    className="btn-toolbar-glow btn-toolbar-danger ui-control !w-10 !min-w-10 !p-0 text-base font-bold rounded-xl shrink-0"
                    title="ลบแผ่น (ลบได้เมื่อไม่มีข้อมูล)">−</button>
                  <button type="button" onClick={handleAddSheet}
                    className="btn-toolbar-glow btn-toolbar-profit ui-control !w-10 !min-w-10 !p-0 text-base font-bold rounded-xl shrink-0"
                    title="เพิ่มแผ่นใหม่">+</button>
                </div>
                {isAdmin && (
                  <button type="button" onClick={() => setLineModal(true)}
                    className="btn-primary-glow ui-control w-full !rounded-xl !font-semibold shadow-[var(--shadow-btn-primary)]">
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
                    <button type="button" title="ลดขนาดตารางสรุป" onClick={() => setSumFs(s => Math.max(9, s - 2))}
                      className="btn-toolbar-glow btn-toolbar-muted ui-control !px-0 !min-w-10 rounded-xl font-bold">A−</button>
                    <button type="button" title="ขยายขนาดตารางสรุป" onClick={() => setSumFs(s => Math.min(22, s + 2))}
                      className="btn-toolbar-glow btn-fintech-search ui-control !px-0 !min-w-10 rounded-xl font-bold">A+</button>
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
                        <td className="py-1.5 text-right tabular-nums tracking-tight text-[var(--gray-800)] font-semibold">{sheetTotal > 0 ? sheetTotal.toLocaleString() : '—'}</td>
                        <td className="py-1.5 text-right tabular-nums tracking-tight text-[var(--chart-primary-dark)] font-semibold">{customerSavedTotal > 0 ? customerSavedTotal.toLocaleString() : '—'}</td>
                        <td className="py-1.5 pr-1 text-right tabular-nums tracking-tight text-[var(--gray-900)] font-bold">{savedTotal > 0 ? savedTotal.toLocaleString() : '—'}</td>
                      </tr>
                      {COL_TYPES.map(c => {
                        const sheetAmt = sheetByType[c.key] ?? 0;
                        const custAmt = customerSavedByType[c.key] ?? 0;
                        const total = summaryByType[c.key] ?? 0;
                        return (
                          <tr key={c.key} className="border-b border-[var(--color-border)] hover:bg-[var(--bg-hover)]">
                            <td className={`py-1 pl-1 text-[0.92em] ${total > 0 ? 'text-[var(--text-secondary)]' : 'text-theme-text-muted'}`}>{c.label}</td>
                            <td className={`py-1 text-right tabular-nums tracking-tight text-[0.92em] font-medium ${sheetAmt > 0 ? 'text-[var(--gray-800)]' : 'text-theme-text-muted/35'}`}>
                              {sheetAmt > 0 ? sheetAmt.toLocaleString() : '·'}
                            </td>
                            <td className={`py-1 text-right tabular-nums tracking-tight text-[0.92em] font-medium ${custAmt > 0 ? 'text-[var(--chart-primary-dark)]' : 'text-theme-text-muted/35'}`}>
                              {custAmt > 0 ? custAmt.toLocaleString() : '·'}
                            </td>
                            <td className={`py-1 pr-1 text-right tabular-nums tracking-tight text-[0.92em] font-semibold ${total > 0 ? 'text-[var(--gray-900)]' : 'text-theme-text-muted/35'}`}>
                              {total > 0 ? total.toLocaleString() : '·'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* เสียง + ตรวจด้วยเสียง — แผงพรีเมียมใต้ตารางสรุป */}
                <div
                  className={cn(
                    'shrink-0 border-t border-[color-mix(in_srgb,var(--chart-primary)_24%,var(--color-border))]',
                    'bg-gradient-to-b from-[color-mix(in_srgb,var(--primary-50)_72%,var(--color-surface))] via-[var(--color-surface)] to-[color-mix(in_srgb,var(--gray-50)_38%,var(--color-surface))]',
                    'px-3 pb-3 pt-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]',
                  )}
                >
                  <div className="mb-3 flex items-center gap-2">
                    <span className="h-[2px] flex-1 rounded-full bg-gradient-to-r from-transparent via-[color-mix(in_srgb,var(--chart-primary)_40%,transparent)] to-transparent" />
                    <span className="whitespace-nowrap text-sm font-medium text-theme-text-secondary">
                      ควบคุมเสียง
                    </span>
                    <span className="h-[2px] flex-1 rounded-full bg-gradient-to-l from-transparent via-[color-mix(in_srgb,var(--chart-primary)_40%,transparent)] to-transparent" />
                  </div>

                  <div
                    className={cn(
                      'rounded-2xl border border-[color-mix(in_srgb,var(--chart-primary)_18%,var(--color-border))]',
                      'bg-[var(--color-card-bg)]',
                      'shadow-[0_12px_32px_-18px_rgba(15,23,42,0.42),inset_0_1px_0_rgba(255,255,255,0.72)]',
                      'p-2.5 space-y-3',
                    )}
                  >
                    {/* พูดตอนคีย์ */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="shrink-0 text-[10px] font-bold text-theme-text-muted">เสียงคีย์</span>
                      <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--gray-900)_3.5%,var(--color-surface))] px-1.5 py-1 ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_10%,var(--color-border))] shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
                        <button type="button" title={soundOn ? 'ปิดเสียงพูด' : 'เปิดเสียงพูด'} onClick={() => setSoundOn(v => !v)}
                          className={cn(
                            'ui-control !min-w-10 !px-0 rounded-lg text-base shadow-sm transition-all duration-150 shrink-0',
                            soundOn
                              ? 'bg-gradient-to-b from-[color-mix(in_srgb,var(--chart-primary)_22%,white)] to-[color-mix(in_srgb,var(--primary-100)_55%,white)] text-[var(--primary-800)] ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_28%,transparent)]'
                              : 'bg-[var(--color-surface)] text-theme-text-muted ring-1 ring-[var(--color-border)] hover:bg-[var(--bg-hover)]',
                          )}
                        >
                          {soundOn ? '🔊' : '🔇'}
                        </button>
                        <div className="mx-0.5 h-5 w-px shrink-0 bg-[var(--color-border-muted)]" />
                        <button type="button" title="ช้าลง" disabled={!soundOn}
                          onClick={() => setSpeechRate(r => Math.max(0.8, parseFloat((r - 0.2).toFixed(1))))}
                          className="ui-control !min-w-10 rounded-lg bg-[var(--color-surface)] font-bold text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] hover:bg-[var(--bg-hover)] disabled:opacity-35 shrink-0">
                          −
                        </button>
                        <span className={`min-w-[2.25rem] flex-1 text-center text-[11px] font-bold tabular-nums tracking-tight ${soundOn ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>
                          {speechRate.toFixed(1)}
                        </span>
                        <button type="button" title="เร็วขึ้น" disabled={!soundOn}
                          onClick={() => setSpeechRate(r => Math.min(3.0, parseFloat((r + 0.2).toFixed(1))))}
                          className="ui-control !min-w-10 rounded-lg bg-gradient-to-b from-[var(--primary-200)] to-[var(--primary-300)] font-bold text-[var(--primary-900)] shadow-sm ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_35%,transparent)] hover:brightness-[1.03] disabled:opacity-35 shrink-0">
                          +
                        </button>
                      </div>
                    </div>

                    <button type="button"
                      title={
                        !soundOn
                          ? 'เปิดเสียงพูดก่อน ถึงจะใช้ตรวจด้วยเสียงได้'
                          : voiceAuditMode
                            ? 'ปิดโหมดตรวจด้วยเสียง'
                            : 'เปิดโหมดตรวจด้วยเสียง — พูดเลขและยอดตามแถวที่เลื่อนถึง'
                      }
                      disabled={!soundOn}
                      onClick={() => {
                        setVoiceAuditMode(v => {
                          const next = !v;
                          writeVoiceAuditMode(next);
                          if (!next) cancelSpeech();
                          return next;
                        });
                      }}
                      className={cn(
                        'ui-control relative w-full overflow-hidden rounded-xl !px-3 text-sm font-extrabold tracking-wide shadow-md transition-all duration-200 disabled:opacity-35',
                        voiceAuditMode
                          ? 'border border-transparent bg-gradient-to-r from-[var(--primary-600)] via-[var(--chart-primary)] to-[var(--primary-600)] text-white shadow-[0_8px_22px_-10px_color-mix(in_srgb,var(--chart-primary)_65%,transparent)] hover:brightness-[1.06]'
                          : 'border border-[color-mix(in_srgb,var(--chart-primary)_22%,var(--color-border))] bg-[color-mix(in_srgb,var(--color-surface)_96%,var(--primary-50))] text-[var(--primary-800)] hover:bg-[color-mix(in_srgb,var(--primary-50)_75%,var(--color-surface))]',
                      )}
                    >
                      <span className="relative z-[1]">ตรวจด้วยเสียง{voiceAuditMode ? ' ✓' : ''}</span>
                    </button>

                    {voiceAuditMode && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 text-[10px] font-bold text-theme-text-muted">ความเร็วตรวจ</span>
                        <div className="flex min-w-0 flex-1 items-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--gray-900)_3.5%,var(--color-surface))] px-1 py-1 ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_10%,var(--color-border))] shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)]">
                          <button type="button" title="ช้าลง" disabled={!soundOn}
                            onClick={() => {
                              setVoiceAuditRate(r => {
                                const next = Math.max(0.5, parseFloat((r - 0.1).toFixed(2)));
                                writeVoiceAuditRate(next);
                                return next;
                              });
                            }}
                            className="ui-control !min-w-10 rounded-lg bg-[var(--color-surface)] font-bold shadow-sm ring-1 ring-[var(--color-border)] hover:bg-[var(--bg-hover)] disabled:opacity-35">
                            −
                          </button>
                          <span className={`flex-1 text-center text-[11px] font-bold tabular-nums ${soundOn ? 'text-theme-text-primary' : 'text-theme-text-muted'}`}>{voiceAuditRate.toFixed(1)}</span>
                          <button type="button" title="เร็วขึ้น" disabled={!soundOn}
                            onClick={() => {
                              setVoiceAuditRate(r => {
                                const next = Math.min(3, parseFloat((r + 0.1).toFixed(2)));
                                writeVoiceAuditRate(next);
                                return next;
                              });
                            }}
                            className="ui-control !min-w-10 rounded-lg bg-gradient-to-b from-[var(--primary-200)] to-[var(--primary-300)] font-bold text-[var(--primary-900)] shadow-sm ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_35%,transparent)] hover:brightness-[1.03] disabled:opacity-35">
                            +
                          </button>
                        </div>
                      </div>
                    )}

                    {voiceAuditMode && sheetGrouped.length > 0 && (
                      <div
                        role="toolbar"
                        aria-label="ควบคุมตรวจด้วยเสียง"
                        className={cn(
                          'rounded-xl border border-[color-mix(in_srgb,var(--chart-primary)_14%,var(--color-border))]',
                          'bg-gradient-to-br from-[color-mix(in_srgb,var(--primary-50)_55%,var(--color-surface))] to-[var(--color-surface)]',
                          'px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] space-y-2.5',
                        )}
                      >
                        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                          <div className="min-w-0 flex-1 text-center text-[11px] font-semibold tabular-nums leading-snug text-theme-text-secondary sm:text-left">
                            <span className="font-bold text-[var(--chart-primary-dark)]">
                              {voiceAuditDispIdx != null ? `แถว ${voiceAuditDispIdx} / ${sheetGrouped.length}` : 'เลือกแถวในโพย'}
                            </span>
                            {voiceAuditCpMatches && voiceAuditBarCp ? (
                              <span className="block truncate font-medium normal-case text-theme-text-muted sm:inline sm:ml-1">
                                · จำจุด{' '}
                                {new Date(voiceAuditBarCp.updatedAt).toLocaleTimeString('th-TH', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                  second: '2-digit',
                                })}
                              </span>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            title="ลบจุดจำและเริ่มอ่านจากแถวแรกใหม่"
                            disabled={!voiceAuditMode || sheetGrouped.length === 0}
                            onClick={voiceAuditResetReading}
                            className="ui-control shrink-0 rounded-lg border border-[color-mix(in_srgb,var(--chart-primary)_25%,var(--color-border))] bg-[var(--color-surface)] px-2 font-bold text-[var(--chart-primary-dark)] shadow-sm transition-colors hover:bg-[color-mix(in_srgb,var(--primary-50)_80%,var(--color-surface))] disabled:opacity-35"
                          >
                            เริ่มใหม่
                          </button>
                        </div>
                        <div className="flex items-center justify-center gap-1 rounded-xl bg-[color-mix(in_srgb,var(--gray-900)_4%,var(--color-surface))] p-1 ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_12%,var(--color-border))]">
                          <button
                            type="button"
                            title="แถวก่อนหน้า"
                            disabled={!soundOn || sheetGrouped.length === 0 || focusedIdx === 0}
                            onClick={voiceAuditGoPrev}
                            className="ui-control !w-10 !min-w-10 !p-0 shrink-0 rounded-lg bg-[var(--color-surface)] text-base font-bold text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--bg-hover)] disabled:opacity-35"
                            aria-label="แถวก่อนหน้า"
                          >
                            ◀
                          </button>
                          <button
                            type="button"
                            title="หยุดชั่วคราว"
                            disabled={!soundOn || focusedIdx < 0 || voiceAuditPaused}
                            onClick={voiceAuditHitPause}
                            className="ui-control !w-10 !min-w-10 !p-0 shrink-0 rounded-lg bg-[var(--color-surface)] text-base text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--bg-hover)] disabled:opacity-35"
                            aria-label="หยุดชั่วคราว"
                          >
                            ⏸
                          </button>
                          <button
                            type="button"
                            title="เล่นต่อหรือพูดแถวนี้ใหม่"
                            disabled={!soundOn || focusedIdx < 0 || !voiceAuditPaused}
                            onClick={voiceAuditHitPlay}
                            className="ui-control !w-10 !min-w-10 !p-0 shrink-0 rounded-lg bg-gradient-to-b from-[var(--primary-500)] to-[var(--chart-primary)] text-base text-white shadow-md ring-1 ring-[color-mix(in_srgb,var(--chart-primary)_45%,transparent)] transition hover:brightness-[1.07] disabled:opacity-35"
                            aria-label="เล่นต่อ"
                          >
                            ▶
                          </button>
                          <button
                            type="button"
                            title="แถวถัดไป"
                            disabled={
                              !soundOn ||
                              sheetGrouped.length === 0 ||
                              (focusedIdx >= 0 && focusedIdx >= sheetGrouped.length - 1)
                            }
                            onClick={voiceAuditGoNext}
                            className="ui-control !w-10 !min-w-10 !p-0 shrink-0 rounded-lg bg-[var(--color-surface)] text-base font-bold text-theme-text-secondary shadow-sm ring-1 ring-[var(--color-border)] transition hover:bg-[var(--bg-hover)] disabled:opacity-35"
                            aria-label="แถวถัดไป"
                          >
                            »
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

      {/* Move Sheet Modal */}
      {moveModal && (
        <div className="fixed inset-0 bg-[var(--color-backdrop-overlay)] flex items-center justify-center z-50" onClick={() => setMoveModal(false)} role="presentation">
          <div
            ref={moveDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="move-dialog-title"
            className="bg-surface-100 border border-border rounded-lg p-4 w-80 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div id="move-dialog-title" className="text-sm font-semibold text-theme-text-primary">ย้าย — {selectedGroups.size} รายการ</div>

            {/* Target customer */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-secondary w-16 shrink-0">ลูกค้า</span>
              <select value={moveTargetCustomerId} onChange={e => { setMoveTargetCustomerId(e.target.value); setMoveTarget(1); }} aria-label="เลือกลูกค้าปลายทาง"
                className="ui-field flex-1 bg-surface-default border-border text-theme-text-primary">
                <option value="__same__">เดิม ({customers.find(c => c.id === selectedCustomerId)?.name ?? 'ไม่ระบุ'})</option>
                {customers.filter(c => c.id !== selectedCustomerId).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Target sheet */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-theme-text-secondary w-16 shrink-0">ย้ายไปแผ่น</span>
              <select value={moveTarget} onChange={e => setMoveTarget(Number(e.target.value))} aria-label="เลือกแผ่นปลายทาง"
                className="ui-field flex-1 bg-surface-default border-border text-theme-text-primary">
                {(() => {
                  const tCustId = moveTargetCustomerId === '__same__' ? selectedCustomerId : moveTargetCustomerId;
                  const tCustBets =
                    tCustId && tCustId === selectedCustomerId
                      ? savedBets
                      : [];
                  const tMax =
                    tCustId && tCustId !== selectedCustomerId
                      ? moveOtherCustomerMaxSheet
                      : tCustBets.length
                        ? Math.max(...tCustBets.map(b => b.sheet_no ?? 1))
                        : 1;
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
                className="ui-control px-4 rounded bg-surface-200 text-theme-text-secondary hover:bg-surface-300">ยกเลิก</button>
              <button onClick={async () => { await moveSelectedGroups(moveTarget); }}
                className="ui-control px-4 rounded bg-risk-medium/95 hover:bg-risk-medium/90 text-theme-btn-primary-fg font-semibold">ย้าย</button>
            </div>
          </div>
        </div>
      )}

      {/* CSV Export Modal */}
      {csvModalOpen && (
        <div className="fixed inset-0 bg-[var(--color-backdrop-overlay)] flex items-center justify-center z-50" onClick={() => setCsvModalOpen(false)} role="presentation">
          <div
            ref={csvDialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="csv-dialog-title"
            className="bg-surface-100 border border-border rounded-lg p-4 w-96 flex flex-col gap-3"
            onClick={e => e.stopPropagation()}
          >
            <div id="csv-dialog-title" className="text-sm font-semibold text-theme-text-primary">Export CSV ทุกแผ่น</div>
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
                className="ui-control px-4 rounded bg-surface-200 text-theme-text-secondary hover:bg-surface-300">ยกเลิก</button>
              <button onClick={() => void handleExportCsv()}
                className="ui-control px-4 rounded bg-profit/95 hover:bg-profit/90 text-theme-btn-primary-fg font-semibold">ดาวน์โหลด</button>
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
              ref={lineDialogRef}
              className="pointer-events-auto flex h-full max-h-[100dvh] w-full max-w-[min(100vw,720px)] flex-col ui-surface overflow-hidden rounded-none border-y-0 border-r-0 sm:rounded-l-xl sm:rounded-r-none"
              role="dialog"
              aria-modal="true"
              aria-labelledby="line-import-title"
            >
              <div className="shrink-0 px-4 sm:px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                <div className="min-w-0 flex-1">
                  <h2 id="line-import-title" className="text-base font-semibold text-[var(--text-primary)] tracking-tight">รับข้อมูลไลน์</h2>
                  <p className="text-xs text-[var(--text-secondary)] mt-1 leading-relaxed max-w-[40rem]">
                    แผงด้านขวาไม่บังโต๊ะคีย์ · พิมพ์ซ้ายได้ตามปกติ · preview อัปเดตทันที · ปิดเมื่อเสร็จ (ปุ่มปิด หรือ Esc)
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
                    className="btn-toolbar-glow btn-toolbar-muted ui-control px-4 rounded-xl"
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
                    {!preview && <span className="text-[var(--chart-neutral-mid)] font-medium">ยังไม่มีข้อความ — วางในช่องข้อความด้านขวาบน</span>}
                    {preview && preview.parsedCount > 0 && (
                      <>
                        <span className="text-[var(--color-semantic-success-muted)] font-semibold">✓ พบ {preview.parsedCount} รายการ ({groupedPreview.length} แถว)</span>
                        {preview.skippedCount > 0 && <span className="text-[var(--chart-neutral-dark)] font-medium">⚠ ข้าม {preview.skippedCount} บรรทัด</span>}
                      </>
                    )}
                    {preview && preview.parsedCount === 0 && (
                      <span className="text-[var(--chart-neutral-mid)]">ไม่พบรายการที่ถูกต้อง{preview.skippedCount > 0 ? ` (ข้าม ${preview.skippedCount} บรรทัด)` : ''}</span>
                    )}
                  </div>

                  <div className="flex-1 min-h-[200px] lg:min-h-0 flex flex-col ui-surface overflow-hidden">
                    <div className="shrink-0 border-b border-[var(--color-border)] bg-[var(--gray-100)]">
                      <table className="w-full table-fixed text-[11px] sm:text-xs">
                        <thead>
                          <tr>
                            <th className="text-left py-2.5 px-2 text-theme-text-secondary font-medium w-7">#</th>
                            <th className="text-center py-2.5 px-2 text-theme-text-secondary font-semibold w-14">เลข</th>
                            {COL_TYPES.map(c => (
                              <th key={c.key} className="text-right py-2.5 px-1.5 text-theme-text-secondary font-medium">{c.label}</th>
                            ))}
                          </tr>
                        </thead>
                      </table>
                    </div>
                    <div className="flex-1 overflow-y-auto min-h-0 bg-[color-mix(in_srgb,var(--gray-50)_55%,var(--color-surface))]">
                      <table className="w-full table-fixed text-[11px] sm:text-xs">
                        <tbody>
                          {groupedPreview.length === 0 ? (
                            <tr>
                              <td colSpan={2 + COL_TYPES.length} className="py-14 text-center text-[var(--chart-neutral-mid)] text-xs font-medium">
                                ยังไม่มีแถว preview
                              </td>
                            </tr>
                          ) : groupedPreview.map((row, idx) => (
                            <tr
                              key={row.number + idx}
                              className={`border-b border-[var(--chart-neutral-light)] ${idx % 2 === 0 ? 'bg-[var(--bg-glass-subtle)]' : 'bg-transparent'} hover:bg-[var(--color-nav-hover-bg)] transition-colors`}
                            >
                              <td className="py-1.5 px-2 text-[var(--chart-neutral-mid)] w-7  font-medium">{idx + 1}</td>
                              <td className="py-1.5 px-2 w-14 align-middle text-center">
                                <span className="inline-flex min-w-[2.25rem] justify-center rounded-md border border-[var(--chart-neutral-light)] bg-[var(--color-input-bg)] px-1 py-0.5  tracking-tight text-[0.85em] font-extrabold  text-[var(--chart-neutral-dark)] shadow-[inset_0_1px_0_var(--color-border-strong)]">
                                  {row.number}
                                </span>
                              </td>
                              {COL_TYPES.map(c => (
                                <td key={c.key} className="py-1.5 px-1.5 text-right  tracking-tight text-[var(--chart-neutral-dark)]  font-medium">
                                  {(row.amounts[c.key] ?? 0) > 0
                                    ? row.amounts[c.key].toLocaleString()
                                    : <span className="text-[var(--chart-neutral-mid)]">·</span>}
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {preview && preview.parsedCount > 0 && (
                    <div className="text-[11px] text-[var(--chart-neutral-mid)] shrink-0">
                      นำเข้าให้ <span className="text-[var(--chart-neutral-dark)] font-semibold">{currentCustomer?.name ?? '(ไม่ระบุลูกค้า)'}</span>
                      <span> · แผ่น </span><span className=" tracking-tight text-[var(--chart-neutral-dark)] font-semibold">{sheet}</span>
                    </div>
                  )}
                </div>

                {/* รับข้อความ / OCR — lg แถวขวา ~40% */}
                <div className="w-full flex flex-1 flex-col gap-2.5 min-h-0 min-w-0 lg:flex-1 lg:min-w-[240px] order-1 lg:order-2 overflow-y-auto pr-0.5">
                  <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
                  <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = ''; }} />

                  <div className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-2.5 space-y-2 shrink-0 shadow-[var(--shadow-soft)]">
                    <div className="text-[11px] font-bold text-[var(--text-primary)] tracking-wide">นำเข้าไปที่</div>
                    {customers.length === 0 ? (
                      <p className="text-[11px] text-[var(--chart-neutral-mid)] leading-snug font-medium">
                        ยังไม่มีลูกค้าในระบบ — เพิ่มที่เมนูลูกค้าก่อน
                      </p>
                    ) : (
                      <>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[var(--chart-neutral-mid)] shrink-0 w-11 font-medium">ลูกค้า</span>
                          <select
                            value={selectedCustomerId}
                            onChange={(e) => setSelectedCustomerId(e.target.value)}
                            className="ui-field flex-1 min-w-0 bg-[var(--color-input-bg)] border-2 border-[var(--chart-neutral-light)] text-[var(--chart-neutral-dark)] focus:border-[var(--chart-primary)]"
                          >
                            {customers.map((c) => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => navigateCustomer(-1)}
                            className="btn-toolbar-glow btn-toolbar-muted ui-control !px-2 rounded-lg font-semibold shrink-0"
                          >
                            ขึ้น
                          </button>
                          <button
                            type="button"
                            onClick={() => navigateCustomer(1)}
                            className="btn-toolbar-glow btn-fintech-search ui-control !px-2 rounded-lg font-semibold shrink-0"
                          >
                            ลง
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-[11px] text-[var(--chart-neutral-mid)] shrink-0 w-11 font-medium">แผ่น</span>
                          <select
                            value={sheet}
                            onChange={(e) => {
                              setSheet(Number(e.target.value));
                              setSelectedGroups(new Set());
                            }}
                            disabled={!selectedCustomerId}
                            className="ui-field flex-1 min-w-0 bg-[var(--color-input-bg)] border-2 border-[var(--chart-neutral-light)] text-[var(--chart-neutral-dark)] focus:border-[var(--chart-primary)] tracking-tight disabled:opacity-45"
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
                            className="btn-toolbar-glow btn-toolbar-danger ui-control !w-10 !min-w-10 !p-0 text-base font-bold rounded-lg shrink-0"
                            title="ลบแผ่น (ลบได้เมื่อไม่มีข้อมูล)"
                          >
                            −
                          </button>
                          <button
                            type="button"
                            onClick={handleAddSheet}
                            className="btn-toolbar-glow btn-toolbar-profit ui-control !w-10 !min-w-10 !p-0 text-base font-bold rounded-lg shrink-0"
                            title="เพิ่มแผ่นใหม่"
                          >
                            +
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch sm:flex-wrap">
                    <button
                      type="button"
                      onClick={() => setLineText(normalizeLinePasteText(lineText))}
                      disabled={!lineText.trim()}
                      className="ui-control px-3 rounded-lg border border-[var(--chart-primary)]/35 bg-[var(--primary-50)] text-[var(--primary-800)] font-semibold hover:bg-[var(--primary-100)] hover:border-[var(--chart-primary)]/55 disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 shrink-0"
                    >
                      ตัดคำนำหน้าไลน์
                    </button>
                    <div className="flex-1 min-w-[12rem] rounded-lg border border-[var(--color-badge-info-border)] bg-[var(--color-badge-info-bg)] px-3 py-2 text-[11px] leading-snug text-[var(--color-badge-info-text)]">
                      <span className="font-semibold text-[var(--primary-800)]">ลบสิ่งรบกวน:</span>{' '}
                      เวลา Mo · ชื่อผู้ส่ง · บรรทัดแทรก — จัดเครื่องหมาย &quot;×&quot; เป็น *
                    </div>
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
                    className="flex-1 min-h-[140px] lg:min-h-[200px] max-h-[40dvh] lg:max-h-none rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] px-3 py-2.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)]  tracking-tight resize-y focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--chart-primary)] shadow-[var(--shadow-input-inner)]"
                  />

                  <div className="flex gap-2 shrink-0 items-stretch">
                    <button
                      type="button"
                      onClick={handleLineImport}
                      disabled={!preview || preview.parsedCount === 0 || !selectedCustomerId || customers.length === 0}
                      className="btn-primary-glow ui-control flex-1 min-w-0 rounded-xl font-semibold disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:translate-y-0"
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
                      className="ui-control shrink-0 px-3 rounded-xl border-2 border-[var(--chart-primary)] bg-[var(--primary-100)] text-[var(--primary-800)] hover:bg-[var(--primary-200)] hover:border-[var(--chart-primary-dark)] disabled:opacity-40 disabled:cursor-not-allowed transition-colors duration-200 shadow-sm"
                    >
                      เคลียร์
                    </button>
                  </div>

                  <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] font-medium">
                    <div className="flex-1 border-t border-[var(--color-border)]" />
                    <span className="text-[var(--text-primary)]">หรืออัปโหลดรูป / PDF</span>
                    <div className="flex-1 border-t border-[var(--color-border)]" />
                  </div>

                  <label className="flex flex-col gap-1 text-[10px] text-[var(--chart-neutral-mid)] px-0.5">
                    <span className="font-bold text-[var(--chart-neutral-dark)]">OCR รูปโพย</span>
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
                      className="ui-field border-2 border-[var(--chart-neutral-light)] bg-[var(--color-input-bg)] text-[var(--chart-neutral-dark)] focus:border-[var(--chart-primary)]"
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
                    className={`flex items-center justify-center min-h-[3.25rem] rounded-xl border-2 border-dashed px-3 cursor-pointer text-xs transition-colors duration-200 select-none font-medium
                      ${imgDragOver ? 'border-[var(--chart-primary)] bg-[var(--chart-primary-soft)] text-[var(--chart-neutral-dark)]' : 'border-[var(--chart-neutral-mid)]/45 bg-[var(--color-input-bg)] hover:border-[var(--chart-primary)] hover:bg-[var(--color-nav-hover-bg)] text-[var(--chart-neutral-mid)] hover:text-[var(--chart-neutral-dark)]'}`}
                  >
                    {ocrLoading
                      ? <span className="text-[var(--chart-neutral-dark)] animate-pulse">กำลังอ่านรูป…</span>
                      : <span>ลากรูปหรือคลิกเลือกไฟล์</span>}
                  </div>
                  {ocrError && (
                    <div className="text-xs text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-2 py-1.5 shrink-0">
                      {ocrError}
                    </div>
                  )}
                  {ocrServerFallbackNote && !ocrError && (
                    <div className="text-[10px] leading-snug text-[var(--text-accent)] bg-[var(--color-badge-warning-bg)] border border-[var(--color-badge-warning-border)] rounded-lg px-2 py-1.5 shrink-0">
                      <span className="font-semibold">เซิร์ฟเวอร์ OCR ไม่ได้ข้อความ</span>
                      {' — '}
                      {ocrServerFallbackNote}
                      {' · '}
                      <span className="italic">ใช้ Tesseract ในเครื่องแทน — ตรวจสอบ credentials / Paddle บน API ถ้าต้องการให้อ่านจากเซิร์ฟเวอร์</span>
                    </div>
                  )}
                  {imageOcrSource && (
                    <p className="text-[10px] text-[var(--chart-neutral-mid)] px-0.5 -mt-1 leading-relaxed">
                      <span className="font-bold text-[var(--color-semantic-success-muted)]">OCR รอบนี้:</span>{' '}
                      {imageOcrSource === 'paddle'
                        ? 'PaddleOCR บนเซิร์ฟเวอร์'
                        : imageOcrSource === 'google-vision'
                          ? 'Google Cloud Vision (Document Text Detection)'
                          : 'Tesseract ในเบราว์เซอร์ (สำรอง / หรือเลือกไม่เรียก API)'}
                    </p>
                  )}
                  <p className="text-[10px] leading-relaxed text-[var(--chart-neutral-mid)] px-0.5 font-medium">
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
                    className={`flex items-center justify-center min-h-[3.25rem] rounded-xl border-2 border-dashed px-3 cursor-pointer text-xs transition-colors duration-200 select-none font-medium
                      ${pdfDragOver ? 'border-[var(--chart-primary)] bg-[var(--chart-primary-soft)] text-[var(--chart-neutral-dark)]' : 'border-[var(--chart-neutral-mid)]/45 bg-[var(--color-input-bg)] hover:border-[var(--chart-primary)] hover:bg-[var(--color-nav-hover-bg)] text-[var(--chart-neutral-mid)] hover:text-[var(--chart-neutral-dark)]'}`}
                  >
                    {pdfLoading
                      ? <span className="text-[var(--chart-neutral-dark)] animate-pulse">กำลังอ่าน PDF…</span>
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
            className="ui-control shrink-0 !w-10 !min-w-10 !p-0 text-lg leading-none text-theme-text-muted hover:bg-[var(--bg-hover)] hover:text-theme-text-primary"
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
          className="ui-field w-full min-w-0 flex-1 bg-[var(--color-input-bg)] border-[var(--color-input-border)] text-theme-text-primary placeholder:text-theme-text-muted tracking-tight" />
        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:justify-start">
          <button
            onClick={() => {
              if (!q.trim()) return;
              if (activeIndex >= 0) onNext();
              else onSearch();
            }}
            className="btn-toolbar-glow btn-fintech-search ui-control shrink-0 px-3">
            ค้นหา
          </button>
          <button
            onClick={onClear}
            className="btn-toolbar-glow btn-fintech-spark ui-control shrink-0 px-3">
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
