/**
 * PDF print preview helper
 *
 * Opens a full-screen in-page modal overlay with a print button.
 * No auto-print. Uses an iframe srcdoc for clear rendering.
 */

import { APP_BRAND_NAME, APP_BRAND_TAGLINE, getBrandLogoAbsoluteUrl } from '@/lib/brand';
import { PRINT_STYLE_ROOT, previewChrome, themeHex } from '@/lib/printColorTokens';
import type { BetType } from '@/types';
import { PRINT_FONT_FAMILY, PRINT_FONT_HEAD_LINKS } from '@/lib/printTypography';

/** margin แนวตั้ง — ใช้คำนวณความสูงพื้นที่พิมพ์ */
const PAGE_MARGIN_V_MM = 11;
/** margin แนวนอน — ลดซ้าย/ขวาให้ตารางกว้างเต็มแผ่น (Safari ยังพอมีที่ว่าง) */
const PAGE_MARGIN_H_MM = 7;

export const PRINT_DOCUMENT_STYLES = `
${PRINT_STYLE_ROOT}
  @page {
    size: A4 portrait;
    margin: ${PAGE_MARGIN_V_MM}mm ${PAGE_MARGIN_H_MM}mm;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    height: auto;
    min-height: 0;
    max-width: 100%;
  }
  body {
    font-family: var(--p-font-sans);
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'kern' 1, 'liga' 1, 'tnum' 1, 'lnum' 1;
    margin: 0;
    font-size: 13px;
    color: var(--p-text);
    background: var(--p-body-bg);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /*
   * One printed page per .print-sheet — never use min-height: 297mm inside @page margin;
   * that overflows and creates a blank second page in Chrome/Safari.
   */
  .print-root {
    font-family: var(--p-font-sans);
    font-variant-numeric: tabular-nums;
    font-feature-settings: 'kern' 1, 'liga' 1, 'tnum' 1, 'lnum' 1;
    padding: 4px 2px;
    width: 100%;
    max-width: 100%;
    margin: 0;
    overflow-x: hidden;
  }
  .print-sheet {
    width: 100%;
    max-width: 100%;
    box-sizing: border-box;
    margin: 0;
    page-break-after: always;
    break-after: page;
  }
  .print-sheet:last-child {
    page-break-after: auto;
    break-after: auto;
  }
  .print-sheet-head {
    display: block;
    max-width: 100%;
    margin-bottom: 10px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--p-border-soft);
  }
  .print-sheet-head-primary {
    font-size: 15px;
    font-weight: 700;
    line-height: 1.35;
    color: var(--p-text);
    margin-bottom: 4px;
  }
  .print-sheet-head-meta {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.3;
    color: var(--p-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .print-slip-num {
    font-weight: 700;
    text-align: center;
    white-space: nowrap;
  }
  .print-slip-price {
    display: inline-block;
    max-width: 100%;
    text-align: right;
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    font-weight: 500;
    overflow: hidden;
    text-overflow: clip;
  }
  .print-slip-price--compact { font-size: 0.82em; letter-spacing: -0.03em; }
  .print-slip-price--dense { font-size: 0.68em; letter-spacing: -0.05em; }
  .print-slip-td-num { overflow: hidden; }
  .print-slip-td-price { overflow: hidden; text-align: right; }
  .print-slip-table tbody tr:nth-child(even) td { background: var(--p-stripe); }
  /* 4-column bet / send slips — larger type fills A4 better; keep slipGridRowsPerPage fontPx in sync */
  .print-slip-table {
    width: 100% !important;
    max-width: 100% !important;
    border-collapse: collapse;
    table-layout: fixed;
    font-size: 14px;
    line-height: 1.35;
  }
  .print-slip-table thead th {
    padding: 6px 6px;
    font-size: 12px;
    word-break: break-word;
    overflow-wrap: anywhere;
    background: var(--p-header-shade);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
    border: 1px solid var(--p-border-soft);
  }
  .print-slip-table tbody td {
    padding: 6px 6px;
    overflow-wrap: anywhere;
    background: var(--p-surface-muted);
    border: 1px solid var(--p-border-soft);
  }
  .print-slip-table tfoot td {
    padding: 6px 6px;
    font-size: 12px;
  }
  h2  { font-size: 17px; margin: 0 0 4px; color: var(--p-text); }
  .sub { font-size: 13px; color: var(--p-text-secondary); margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  thead tr {
    background: var(--p-header-shade-strong);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  }
  th {
    border: 1px solid var(--p-border);
    padding: 6px 10px;
    font-weight: bold;
    text-align: center;
    color: var(--p-text);
  }
  td {
    border: 1px solid var(--p-border-soft);
    padding: 5px 10px;
    color: var(--p-text);
    background: var(--p-surface-muted);
  }
  tfoot tr td {
    background: linear-gradient(180deg, var(--p-accent-soft), var(--p-accent-mid));
    font-weight: bold;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
  }
  .num  {
    text-align: right;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    color: var(--p-num);
  }
  .l    { text-align: left; }
  .section-title {
    font-size: 14px; font-weight: bold;
    margin: 16px 0 6px;
    border-bottom: 2px solid var(--p-section-border);
    padding-bottom: 3px;
    color: var(--p-text);
  }
  .kpi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 14px; }
  .kpi-box  {
    padding: 8px;
    border: 1px solid var(--p-border-soft);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.58);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75), 0 2px 8px var(--p-shadow);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .kpi-label { font-size: 11px; color: var(--p-text-secondary); }
  .kpi-value { font-size: 16px; font-weight: bold; color: var(--p-accent-dark); font-variant-numeric: tabular-nums; }
  .stripe-even { background: var(--p-stripe); }
  .total-row td {
    background: linear-gradient(180deg, var(--p-accent-soft), var(--p-accent-mid));
    font-weight: bold;
  }
  .neg { color: var(--p-danger) !important; font-weight: bold; }
  .pos { color: var(--p-success) !important; font-weight: bold; }
  .result-box {
    margin-bottom: 10px;
    padding: 8px 10px;
    background: linear-gradient(165deg, var(--p-accent-soft), var(--p-accent-mid));
    border: 1px solid var(--p-border-soft);
    border-radius: 10px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 2px 10px var(--p-shadow);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .print-ts  { margin-top: 12px; font-size: 11px; color: var(--p-text-muted); }
  /* ── รายงานสรุปผลกำไร (ฟอร์มขาว / แถบเหลือง) ─────────────────────────── */
  .print-formal-doc {
    background: var(--p-surface) !important;
    padding: 4px 2px 8px;
    border-radius: 0;
  }
  .print-report-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 14px;
    margin-bottom: 10px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--p-formal-border);
  }
  .print-report-header-left {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    min-width: 0;
  }
  .print-report-logo {
    height: 52px;
    width: auto;
    max-width: 160px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .print-report-brand-block { min-width: 0; }
  .print-report-brand { font-size: 17px; font-weight: 800; letter-spacing: 0.03em; color: var(--p-brand); }
  .print-report-tagline {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: var(--p-brand);
    margin-top: 4px;
    text-transform: uppercase;
  }
  .print-slip-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid var(--p-brand);
  }
  .print-slip-brand-logo {
    height: 34px;
    width: auto;
    max-width: 120px;
    object-fit: contain;
    flex-shrink: 0;
  }
  .print-slip-brand-text { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .print-slip-brand-name {
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 0.04em;
    color: var(--p-brand);
    line-height: 1.2;
  }
  .print-slip-brand-tagline {
    font-size: 7px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--p-brand-muted);
    text-transform: uppercase;
  }
  .print-report-title { font-size: 15px; font-weight: 700; margin-top: 4px; color: var(--p-text); }
  .print-report-sub { font-size: 12px; color: var(--p-text-secondary); margin-top: 3px; }
  .print-report-meta { text-align: right; font-size: 12px; line-height: 1.55; color: var(--p-text); white-space: nowrap; }
  .print-u { border-bottom: 1px solid var(--p-formal-border); padding: 0 3px 1px; }
  .print-profit-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    background: var(--p-banner);
    border: 1px solid var(--p-formal-border);
    margin-bottom: 12px;
    font-weight: 700;
    color: var(--p-text);
  }
  .print-profit-banner .pp-label { font-size: 14px; flex-shrink: 0; }
  .print-profit-banner .pp-value {
    flex: 1;
    text-align: center;
    font-size: 24px;
    font-weight: 800;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
  }
  .print-profit-banner .pp-unit { font-size: 14px; flex-shrink: 0; }
  .print-yellow-bar {
    background: var(--p-banner);
    border: 1px solid var(--p-formal-border);
    border-bottom: none;
    padding: 7px 10px;
    font-weight: 700;
    font-size: 13px;
    margin-top: 14px;
    margin-bottom: 0;
    color: var(--p-text);
  }
  .print-yellow-bar + table { margin-top: 0; }
  table.print-formal {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    border: 1px solid var(--p-formal-border);
  }
  table.print-formal th,
  table.print-formal td {
    border: 1px solid var(--p-formal-border);
    padding: 5px 8px;
    font-size: 12px;
    background: var(--p-surface);
  }
  table.print-formal thead th {
    background: var(--p-formal-header);
    font-weight: 700;
  }
  table.print-formal tbody th {
    background: var(--p-formal-sub);
    font-weight: 700;
    text-align: left;
  }
  .print-result-box {
    margin-bottom: 10px;
    padding: 8px 10px;
    background: var(--p-accent-soft);
    border: 1px solid var(--p-formal-border);
    font-size: 12px;
    line-height: 1.45;
  }
  /* ── ผลถูกฉลาก: สองคอลัมน์ (ตารางซ้าย + สรุปขวา) ตามหน้าจอสรุปผล ───────── */
  .print-wins-pack {
    margin-bottom: 22px;
  }
  .print-wins-grid {
    display: grid;
    grid-template-columns: 1fr minmax(252px, 300px);
    gap: 16px;
    align-items: start;
  }
  .print-wins-main {
    min-width: 0;
  }
  .print-wins-main table {
    margin-bottom: 0;
  }
  .print-wins-main th {
    padding: 5px 8px;
    font-size: 11.5px;
  }
  .print-wins-main td {
    padding: 4.5px 8px;
    font-size: 12px;
  }
  /* ผลถูกเจ้ามือหลายราย — ซ้ายซ้อนตาราง, ขวาแผงรวม (ตรงหน้าจอ ทุกเจ้ามือ) */
  .print-wins-mega-grid {
    display: grid;
    grid-template-columns: 1fr minmax(252px, 300px);
    gap: 16px;
    align-items: start;
  }
  .print-wins-left-stack {
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .print-wins-side {
    border: 1px solid var(--p-formal-border);
    background: linear-gradient(165deg, var(--p-surface), var(--p-surface-muted));
    padding: 12px 14px;
    border-radius: 10px;
    box-shadow: 0 2px 10px var(--p-shadow);
  }
  .print-wins-side-title {
    font-size: 16px;
    font-weight: 800;
    margin: 0 0 10px;
    padding-bottom: 8px;
    border-bottom: 2px solid var(--p-formal-border);
    color: var(--p-text);
  }
  .print-wins-kpi-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 10px;
    font-size: 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--p-border-soft);
  }
  .print-wins-kpi-label {
    color: var(--p-text-secondary);
    font-weight: 600;
  }
  .print-wins-kpi-val {
    font-weight: 700;
    font-variant-numeric: tabular-nums;
  }
  .print-wins-type-grid {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) repeat(3, minmax(0, 1fr));
    gap: 6px 8px;
    font-size: 11px;
    align-items: center;
  }
  .print-wins-type-head {
    margin-top: 10px;
    padding-top: 8px;
    border-top: 2px solid var(--p-formal-border);
    font-weight: 700;
    color: var(--p-text);
  }
  .print-wins-type-row {
    padding: 4px 0;
    border-bottom: 1px solid var(--p-border-soft);
  }
  .print-wins-type-row:last-child {
    border-bottom: none;
  }
  .print-wins-type-name {
    min-width: 0;
    word-break: break-word;
  }
  /* ── ผลถูกฉลาก (พิมพ์/PNG): เลขเด่น + สีประเภท — ใช้ data-bet-type เพราะชื่อประเภทขึ้นต้นด้วยเลข ─ */
  .win-p-num {
    display: inline-block;
    font-weight: 700;
    font-size: 0.82rem;
    min-width: 1.95rem;
    padding: 0.14em 0.32em;
    border-radius: 5px;
    border: 1px solid;
    font-family: inherit;
    font-variant-numeric: tabular-nums;
    line-height: 1.18;
  }
  .win-p-num[data-bet-type] { color: var(--p-accent-dark); background: var(--p-accent-soft); border-color: var(--p-accent-mid); }
  .win-p-num[data-bet-type="3digit_tote"],
  .win-p-num[data-bet-type="2digit_top"] { color: var(--p-text); background: var(--p-surface-muted); border-color: var(--p-border); }
  .win-p-num[data-bet-type="3digit_back"] { color: var(--p-success); background: var(--p-surface-muted); border-color: var(--p-border); }
  .win-p-num[data-bet-type="2digit_bottom"] { color: var(--p-danger); background: var(--p-surface-muted); border-color: var(--p-border); }
  .win-p-lbl { font-size: 11.5px; font-weight: 600; color: var(--p-text-secondary); }
  .win-p-lbl[data-bet-type] { color: var(--p-accent-dark); }
  .win-p-lbl[data-bet-type="3digit_back"] { color: var(--p-success); }
  .win-p-lbl[data-bet-type="2digit_bottom"] { color: var(--p-danger); }
  @media print {
    html, body {
      width: 100%;
      margin: 0 !important;
      padding: 0 !important;
    }
    .print-root {
      padding: 0 !important;
      width: 100% !important;
      max-width: 100% !important;
    }
    .print-slip-table { font-size: 12.5px; }
    .print-slip-table thead th,
    .print-slip-table tbody td { padding: 5px 4px; }
    .print-ts { display: none !important; }
    .no-print { display: none !important; }
    body:has(.print-formal-doc) {
      background: var(--p-surface) !important;
    }
    .print-wins-grid {
      grid-template-columns: 1fr minmax(220px, 260px);
      gap: 12px;
    }
    .print-wins-mega-grid {
      grid-template-columns: 1fr minmax(220px, 260px);
      gap: 12px;
    }
  }
`;

/** Printable body height inside @page margins (A4 portrait). */
const A4_INNER_MM = 297 - PAGE_MARGIN_V_MM * 2;

/** Defaults for 4-col slip PDFs — balance fill vs Chrome splitting one table across pages. */
export const SLIP_PRINT_GRID_OPTS = {
  fontPx: 14,
  topBlockMm: 28,
  reserveFooterMm: 24,
  safetyDeduction: 2,
  rowLineExtraMm: 1,
} as const;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** กันปี พ.ศ. หลุดบรรทัดทับหัวตาราง (พิมพ์ / PNG) */
export function roundNameNoBreakHtml(name: string): string {
  const e = escapeHtml(name);
  return e.replace(/\s+(\d{4})$/, '&nbsp;$1');
}

export function buildPrintSheetHeadHtml(primary: string, metaLine: string): string {
  return `<div class="print-sheet-head">
  <div class="print-sheet-head-primary">${primary}</div>
  <div class="print-sheet-head-meta">${metaLine}</div>
</div>`;
}

/** ความกว้างเลข vs ราคา ในแต่ละคู่คอลัมน์ (ราคา 3 ช่วงเช่น 100*100*100 ต้องการพื้นที่มากกว่า) */
function slipPairColumnWidths(cols: number): { numPct: string; pricePct: string } {
  const pairPct = 100 / cols;
  return {
    numPct: (pairPct * 0.34).toFixed(2),
    pricePct: (pairPct * 0.66).toFixed(2),
  };
}

function slipPriceHtml(price: string): string {
  const parts = price.split('*').filter(Boolean).length;
  const len = price.length;
  let tier = '';
  if (len >= 11 || parts >= 3) tier = ' print-slip-price--dense';
  else if (len >= 8 || parts >= 2) tier = ' print-slip-price--compact';
  return `<span class="print-slip-price${tier}">${escapeHtml(price)}</span>`;
}

/** ตำแหน่งในตาราง → index แบบเต็มคอลัมน์ก่อน (แนวตั้ง) */
function slipColumnMajorIndex(row: number, col: number, rowsPerPage: number): number {
  return col * rowsPerPage + row;
}

export type SlipGridRowOpts = {
  fontPx?: number;
  topBlockMm?: number;
  reserveFooterMm?: number;
  /** Subtract this many rows after the mm estimate (Chrome print variance). */
  safetyDeduction?: number;
  /** Extra mm per data row (borders, padding drift vs theory). */
  rowLineExtraMm?: number;
};

/**
 * Approximate tbody data rows per A4 page for 4-column number/price grids
 * (title + thead + tfoot reserved via topBlockMm / reserveFooterMm).
 */
export function slipGridRowsPerPage(opts?: SlipGridRowOpts): number {
  const fontPx = opts?.fontPx ?? 12;
  const topBlockMm = opts?.topBlockMm ?? 13;
  const reserveFooterMm = opts?.reserveFooterMm ?? 10;
  const safetyDeduction = opts?.safetyDeduction ?? 0;
  const rowLineExtraMm = opts?.rowLineExtraMm ?? 0;
  /* +12 ≈ tbody padding (8+8px) + line box; keep in sync with .print-slip-table tbody */
  const rowMm = (fontPx * 1.3 + 12 + rowLineExtraMm) * 0.264583;
  const raw = Math.floor((A4_INNER_MM - topBlockMm - reserveFooterMm) / rowMm);
  return Math.max(6, raw - safetyDeduction);
}

/**
 * Rows per page + page capacity for slip grids, with tail rebalance and a print-safety shrink
 * so one physical sheet rarely splits one table across two printed pages.
 */
export function slipPagination(
  total: number,
  cols: number,
  gridOpts: SlipGridRowOpts = SLIP_PRINT_GRID_OPTS,
): { rowsPerPage: number; pageCapacity: number; totalPages: number } {
  const rowsDense = slipGridRowsPerPage(gridOpts);
  const rowsCompact = Math.max(4, Math.ceil(total / cols) + 2);
  let rowsPerPage = total <= cols * 8 ? Math.min(rowsDense, rowsCompact) : rowsDense;
  const MIN_TAIL = cols * 2;

  const rebalanceTail = (rpp: number): number => {
    let r = rpp;
    let cap = r * cols;
    if (total <= cap) return r;
    let nFull = Math.floor(total / cap);
    let lastCount = total - nFull * cap;
    while (nFull >= 1 && lastCount > 0 && lastCount < MIN_TAIL && r > 6) {
      r -= 1;
      cap = r * cols;
      nFull = Math.floor(total / cap);
      lastCount = total - nFull * cap;
    }
    return r;
  };

  rowsPerPage = rebalanceTail(rowsPerPage);
  let pageCapacity = rowsPerPage * cols;
  if (total > pageCapacity && Math.ceil(total / pageCapacity) > 1) {
    rowsPerPage = rebalanceTail(Math.max(6, rowsPerPage - 1));
    pageCapacity = rowsPerPage * cols;
  }
  return {
    rowsPerPage,
    pageCapacity,
    totalPages: Math.max(1, Math.ceil(total / pageCapacity)),
  };
}

export type SendSlipPrintItem = { number: string; amount: number };

export type BuildSendSlipSheetsOpts = {
  /** บรรทัดหัวซ้าย เช่น รายการส่ง : พี่นุ — 2 ตัวบน */
  headerTitle: string;
  roundName: string;
  items: SendSlipPrintItem[];
  totalAmount: number;
  betType?: BetType;
};

/** จำนวนคอลัมน์ + ความหนาแน่น — เลขเยอะ (โดยเฉพาะ 3 ตัวบน) ใช้ 5 คอลัมน์ */
export function getSendSlipLayout(itemCount: number, betType?: BetType) {
  const { cols, fontPx, gridOpts } = resolveSendSlipGrid(itemCount, betType);
  const pag = slipPagination(itemCount, cols, gridOpts);
  return { cols, fontPx, ...pag };
}

function resolveSendSlipGrid(itemCount: number, betType?: BetType) {
  const many = itemCount > 32;
  const denseTypes: BetType[] = ['3digit_top', '2digit_top', '2digit_bottom', '3digit_back', '3digit_tote'];
  if (many && betType && denseTypes.includes(betType)) {
    return {
      cols: 5,
      fontPx: 13,
      gridOpts: {
        ...SLIP_PRINT_GRID_OPTS,
        fontPx: 13,
        topBlockMm: 28,
        reserveFooterMm: 22,
      } satisfies SlipGridRowOpts,
    };
  }
  return { cols: 4, fontPx: 14, gridOpts: SLIP_PRINT_GRID_OPTS };
}

/**
 * โพยรายการส่ง (พิมพ์ / PNG ไลน์) — layout เดียวกันทุกประเภท
 * - ประเภทอยู่ที่หัวกระดาษ ช่องเลขแสดงเฉพาะตัวเลข
 * - เรียงแบบแถว (ซ้าย→ขวา) ไม่ให้คอลัมน์แรกเต็มคนละแบบ
 */
export function buildSendSlipSheetsHtml(opts: BuildSendSlipSheetsOpts): string {
  const { headerTitle, roundName, items, totalAmount, betType } = opts;
  const { cols: COLS, fontPx, gridOpts } = resolveSendSlipGrid(items.length, betType);
  const { rowsPerPage: ROWS, pageCapacity: ITEMS_PER_PAGE, totalPages } = slipPagination(
    items.length,
    COLS,
    gridOpts,
  );

  const now = new Date();
  const printDateStr =
    now.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' +
    now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const thickR = `border-right:3px solid ${themeHex.borderFormal};`;
  const thinBorder = `border:1px solid ${themeHex.gray400};`;
  const colPct = (100 / (COLS * 2)).toFixed(2);

  let all = '';
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const start = pageIdx * ITEMS_PER_PAGE;
    const pageItems = items.slice(start, start + ITEMS_PER_PAGE);
    const pn = pageIdx + 1;

    let headCells = '';
    for (let c = 0; c < COLS; c++) {
      const sepR = c < COLS - 1 ? thickR : '';
      headCells += `<th style="${thinBorder}background:${themeHex.slipHeaderBg};text-align:left;width:${colPct}%;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}background:${themeHex.slipHeaderBg};text-align:left;width:${colPct}%;">ราคา</th>`;
    }

    let bodyRows = '';
    for (let r = 0; r < ROWS; r++) {
      let cells = '';
      for (let c = 0; c < COLS; c++) {
        const item = pageItems[r * COLS + c] ?? null;
        const sepR = c < COLS - 1 ? thickR : '';
        cells += `<td style="${thinBorder}">${item ? `<span class="print-slip-num">${escapeHtml(item.number)}</span>` : ''}</td>`;
        cells += `<td style="${thinBorder}${sepR}">${item ? `<span class="print-slip-price">${item.amount.toLocaleString()}</span>` : ''}</td>`;
      }
      bodyRows += `<tr>${cells}</tr>`;
    }

    const footColSpanMid = Math.max(2, COLS * 2 - 4);
    all += `
      <div class="print-sheet" style="font-size:${fontPx}px;color:${themeHex.textPrimary};">
        ${buildPrintSlipBrandStrip()}
        ${buildPrintSheetHeadHtml(
          escapeHtml(headerTitle),
          `แผ่นที่ ${pn} · งวด ${roundNameNoBreakHtml(roundName)}`,
        )}
        <table class="print-slip-table" style="border:3px solid ${themeHex.borderFormal};">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;font-weight:bold;">วันที่พิมพ์ ${printDateStr}</td>
              <td colspan="${footColSpanMid}" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;text-align:center;font-weight:bold;">${pn}/${totalPages}</td>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;text-align:right;font-weight:bold;">ยอดรวม&nbsp;&nbsp;&nbsp;&nbsp;${totalAmount.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }
  return all;
}

export type BetSlipPrintLine = { label: string; price: string; lineTotal: number };

export type BuildBetSlipSheetsOpts = {
  customerName: string;
  roundName: string;
  sheetNo: number;
  lines: BetSlipPrintLine[];
  sheetTotal: number;
};

function resolveBetSlipGrid(itemCount: number) {
  const betGridBase = { ...SLIP_PRINT_GRID_OPTS, topBlockMm: 32 } satisfies SlipGridRowOpts;
  if (itemCount > 40) {
    return {
      cols: 5,
      fontPx: 13,
      gridOpts: { ...betGridBase, fontPx: 13 } satisfies SlipGridRowOpts,
    };
  }
  return { cols: 4, fontPx: 14, gridOpts: betGridBase };
}

/**
 * โพยรับแทง (พิมพ์ / PDF)
 * - เรียงแนวตั้ง: เต็มคอลัมน์แรกบน→ล่าง แล้วค่อยไปคอลัมน์ถัดไป
 * - เต็มหน้าแล้วขึ้นหน้าใหม่
 */
export function buildBetSlipSheetsHtml(opts: BuildBetSlipSheetsOpts): string {
  const { customerName, roundName, sheetNo, lines, sheetTotal } = opts;
  const { cols: COLS, fontPx, gridOpts } = resolveBetSlipGrid(lines.length);
  const { rowsPerPage: ROWS, pageCapacity: ITEMS_PER_PAGE, totalPages } = slipPagination(
    lines.length,
    COLS,
    gridOpts,
  );

  const printDateStr = new Date().toLocaleDateString('th-TH', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const thinBorder = `border:1px solid ${themeHex.gray400};`;
  const thickR = `border-right:3px solid ${themeHex.borderFormal};`;
  const { numPct, pricePct } = slipPairColumnWidths(COLS);

  let all = '';
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const start = pageIdx * ITEMS_PER_PAGE;
    const pageItems = lines.slice(start, start + ITEMS_PER_PAGE);
    const pageSum = pageItems.reduce((s, it) => s + it.lineTotal, 0);
    const pn = pageIdx + 1;
    const isLast = pn === totalPages;

    let headCells = '';
    for (let c = 0; c < COLS; c++) {
      const sepR = c < COLS - 1 ? thickR : '';
      headCells += `<th style="${thinBorder}background:${themeHex.slipHeaderBg};text-align:center;width:${numPct}%;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}background:${themeHex.slipHeaderBg};text-align:center;width:${pricePct}%;">ราคา</th>`;
    }

    let bodyRows = '';
    for (let r = 0; r < ROWS; r++) {
      let cells = '';
      for (let c = 0; c < COLS; c++) {
        const idx = slipColumnMajorIndex(r, c, ROWS);
        const item = pageItems[idx] ?? null;
        const sepR = c < COLS - 1 ? thickR : '';
        cells += `<td class="print-slip-td-num" style="${thinBorder}">${item ? `<span class="print-slip-num">${escapeHtml(item.label)}</span>` : ''}</td>`;
        cells += `<td class="print-slip-td-price" style="${thinBorder}${sepR}">${item ? slipPriceHtml(item.price) : ''}</td>`;
      }
      bodyRows += `<tr>${cells}</tr>`;
    }

    const footColSpanMid = Math.max(2, COLS * 2 - 4);
    const footRight = isLast
      ? `รวมหน้านี้ ${pageSum.toLocaleString()} · รวมทั้งแผ่น ${sheetTotal.toLocaleString()}`
      : `รวมหน้านี้ ${pageSum.toLocaleString()}`;

    all += `
      <div class="print-sheet" style="font-size:${fontPx}px;color:${themeHex.textPrimary};">
        ${buildPrintSlipBrandStrip()}
        ${buildPrintSheetHeadHtml(
          `ลูกค้า : ${escapeHtml(customerName)}`,
          `แผ่น ${sheetNo} · งวด ${roundNameNoBreakHtml(roundName)} · หน้า ${pn}/${totalPages}`,
        )}
        <table class="print-slip-table" style="border:3px solid ${themeHex.borderFormal};">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:5px 8px;font-weight:700;font-size:11px;">วันที่พิมพ์ ${escapeHtml(printDateStr)}</td>
              <td colspan="${footColSpanMid}" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:5px 8px;text-align:center;font-weight:700;font-size:11px;">${pn}/${totalPages}</td>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:5px 8px;text-align:right;font-weight:700;font-size:11px;white-space:nowrap;">${footRight}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }
  return all;
}

export type PrintReportHeaderOpts = {
  brand?: string;
  reportTitle: string;
  roundName: string;
  /** เช่น 24/04/2026 */
  drawDateDdMmYyyy: string;
  pageNum?: number;
};

/** แถบโลโก้ + ชื่อแบรนด์ สำหรับโพย / รายการส่ง (ทุกหน้า print-sheet) */
export function buildPrintSlipBrandStrip(): string {
  const src = getBrandLogoAbsoluteUrl();
  const logo = src
    ? `<img class="print-slip-brand-logo" src="${src}" alt="${APP_BRAND_NAME}" />`
    : '';
  return `<div class="print-slip-brand">
  ${logo}
  <div class="print-slip-brand-text">
    <span class="print-slip-brand-name">${APP_BRAND_NAME}</span>
    <span class="print-slip-brand-tagline">${APP_BRAND_TAGLINE}</span>
  </div>
</div>`;
}

/** หัวรายงานมาตรฐาน (แบรนด์ + ชื่อรายงาน + งวด / วันที่ / แผ่นที่) */
export function buildPrintReportHeader(opts: PrintReportHeaderOpts): string {
  const brand = opts.brand ?? APP_BRAND_NAME;
  const page = opts.pageNum ?? 1;
  const logoSrc = getBrandLogoAbsoluteUrl();
  const logoHtml = logoSrc
    ? `<img class="print-report-logo" src="${logoSrc}" alt="" />`
    : '';
  return `<div class="print-report-header">
  <div class="print-report-header-left">
    ${logoHtml}
    <div class="print-report-brand-block">
      <div class="print-report-brand">${brand}</div>
      <div class="print-report-tagline">${APP_BRAND_TAGLINE}</div>
      <div class="print-report-title">${opts.reportTitle}</div>
      <div class="print-report-sub">งวด ${opts.roundName}</div>
    </div>
  </div>
  <div class="print-report-meta">
    <div>งวดประจำวันที่: <span class="print-u">${opts.drawDateDdMmYyyy}</span></div>
    <div>แผ่นที่: <span class="print-u">${page}</span></div>
  </div>
</div>`;
}

/** Build a complete HTML document string (no auto-print) */
export function buildHtmlDoc(bodyHtml: string, title: string): string {
  const ts = new Date().toLocaleString('th-TH');
  const docTitle = `${APP_BRAND_NAME} — ${title}`;
  return `<!DOCTYPE html>
<html lang="th">
<head>
  <meta charset="UTF-8">
  <title>${docTitle}</title>
  ${PRINT_FONT_HEAD_LINKS}
  <style>${PRINT_DOCUMENT_STYLES}</style>
</head>
<body>
${bodyHtml}
<div class="print-ts">${APP_BRAND_NAME} · พิมพ์เมื่อ ${ts}</div>
</body>
</html>`;
}

/**
 * Open an in-page full-screen preview overlay.
 * Renders the document in an iframe for perfect fidelity.
 * Print button uses iframe.contentWindow.print().
 * Escape key and backdrop click close the overlay.
 */
export function openPrintPreview(bodyHtml: string, title: string, filename: string): void {
  const fullHtml = buildHtmlDoc(bodyHtml, title);

  // ── Build overlay DOM ────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = '__print-preview-overlay__';
  Object.assign(overlay.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '99999',
    background: previewChrome.overlayBg,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    backdropFilter: 'blur(4px)',
    WebkitBackdropFilter: 'blur(4px)',
    animation: 'ppFadeIn 0.18s ease',
  });

  // Inject keyframe once
  if (!document.getElementById('__pp-keyframes__')) {
    const style = document.createElement('style');
    style.id = '__pp-keyframes__';
    style.textContent = `
      @keyframes ppFadeIn { from { opacity:0; } to { opacity:1; } }
      @keyframes ppSlideUp { from { transform:translateY(24px) scale(0.98); opacity:0; } to { transform:none; opacity:1; } }
    `;
    document.head.appendChild(style);
  }

  // ── Modal card ───────────────────────────────────────────────────────────
  const card = document.createElement('div');
  Object.assign(card.style, {
    width: '92vw',
    height: '92vh',
    maxWidth: '1100px',
    background: previewChrome.cardBg,
    borderRadius: '14px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
    border: `1px solid ${previewChrome.toolbarBorder}`,
    animation: 'ppSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
  });

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px',
    background: previewChrome.toolbarBg,
    borderBottom: `1px solid ${previewChrome.toolbarBorder}`,
    flexShrink: '0',
    fontFamily: PRINT_FONT_FAMILY,
  });

  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    flex: '1',
    fontSize: '13px',
    fontWeight: '600',
    color: previewChrome.titleColor,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  titleEl.textContent = `📄 ${title}`;

  const makeBtn = (label: string, bg: string, color: string, hoverBg: string) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    Object.assign(btn.style, {
      padding: '6px 18px',
      background: bg,
      color,
      border: 'none',
      borderRadius: '7px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: PRINT_FONT_FAMILY,
      transition: 'background 0.15s',
      whiteSpace: 'nowrap',
    });
    btn.textContent = label;
    btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; });
    btn.addEventListener('mouseleave', () => { btn.style.background = bg; });
    return btn;
  };

  const printBtn = makeBtn(
    '🖨 พิมพ์',
    previewChrome.printBtnBg,
    previewChrome.printBtnFg,
    previewChrome.printBtnHover,
  );
  const pdfBtn = makeBtn(
    '⇩ บันทึก PDF',
    previewChrome.closeBtnBg,
    previewChrome.printBtnFg,
    previewChrome.closeBtnHover,
  );
  const closeBtn = makeBtn(
    '✕ ปิด',
    previewChrome.closeBtnBg,
    previewChrome.closeBtnFg,
    previewChrome.closeBtnHover,
  );

  const close = () => {
    overlay.style.opacity = '0';
    overlay.style.transition = 'opacity 0.15s';
    setTimeout(() => { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 160);
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); }
  });

  // ── iframe ───────────────────────────────────────────────────────────────
  const iframe = document.createElement('iframe') as HTMLIFrameElement;
  Object.assign(iframe.style, {
    flex: '1',
    border: 'none',
    background: previewChrome.iframeBg,
    borderRadius: '0 0 14px 14px',
  });

  const runPrint = () => {
    (iframe as HTMLIFrameElement).contentWindow?.print();
  };
  printBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    runPrint();
  });

  const pdfLabel = '⇩ บันทึก PDF';
  pdfBtn.addEventListener(
    'click',
    async (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      pdfBtn.disabled = true;
      pdfBtn.textContent = 'กำลังสร้าง…';
      try {
        const { downloadHtmlAsPdf } = await import('@/lib/htmlToPdf');
        await downloadHtmlAsPdf({ bodyHtml, filenameBase: filename });
      } catch (err) {
        console.error('[AuraX] PDF export failed', err);
        window.alert('สร้าง PDF ไม่สำเร็จ — ลองกดปุ่ม PDF บนแถบเครื่องมือแทน');
      } finally {
        pdfBtn.disabled = false;
        pdfBtn.textContent = pdfLabel;
      }
    },
    true,
  );

  toolbar.appendChild(titleEl);
  toolbar.appendChild(printBtn);
  toolbar.appendChild(pdfBtn);
  toolbar.appendChild(closeBtn);
  card.appendChild(toolbar);
  card.appendChild(iframe);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Write content after iframe is in DOM
  iframe.srcdoc = fullHtml;
}

/** ดาวน์โหลด PDF โดยตรง (ไม่เปิดกล่องพิมพ์) */
export async function downloadPrintAsPdf(bodyHtml: string, filenameBase: string): Promise<void> {
  const { downloadHtmlAsPdf } = await import('@/lib/htmlToPdf');
  await downloadHtmlAsPdf({ bodyHtml, filenameBase });
}
