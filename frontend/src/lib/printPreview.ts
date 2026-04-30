/**
 * PDF print preview helper
 *
 * Opens a full-screen in-page modal overlay with a print button.
 * No auto-print. Uses an iframe srcdoc for clear rendering.
 */

import { APP_BRAND_NAME, APP_BRAND_TAGLINE, getBrandLogoAbsoluteUrl } from '@/lib/brand';

/** margin แนวตั้ง — ใช้คำนวณความสูงพื้นที่พิมพ์ */
const PAGE_MARGIN_V_MM = 11;
/** margin แนวนอน — ลดซ้าย/ขวาให้ตารางกว้างเต็มแผ่น (Safari ยังพอมีที่ว่าง) */
const PAGE_MARGIN_H_MM = 7;

const PREVIEW_STYLE = `
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
    font-family: 'Sarabun', 'TH Sarabun New', Arial, sans-serif;
    margin: 0;
    font-size: 13px;
    color: #1a1c1e;
    background: linear-gradient(165deg, rgba(255, 255, 255, 0.97) 0%, rgba(248, 250, 252, 0.94) 40%, rgba(232, 241, 255, 0.52) 100%);
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  /*
   * One printed page per .print-sheet — never use min-height: 297mm inside @page margin;
   * that overflows and creates a blank second page in Chrome/Safari.
   */
  .print-root {
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
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 6px 10px;
    max-width: 100%;
    font-weight: bold;
    font-size: 15px;
    margin-bottom: 6px;
  }
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
    background: linear-gradient(180deg, rgba(255, 252, 230, 0.9), rgba(240, 230, 140, 0.42));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8);
    border: 1px solid rgba(0, 0, 0, 0.09);
  }
  .print-slip-table tbody td {
    padding: 6px 6px;
    overflow-wrap: anywhere;
    background: rgba(255, 255, 255, 0.48);
    border: 1px solid rgba(0, 0, 0, 0.07);
  }
  .print-slip-table tfoot td {
    padding: 6px 6px;
    font-size: 12px;
  }
  h2  { font-size: 17px; margin: 0 0 4px; color: #111; }
  .sub { font-size: 13px; color: #444; margin-bottom: 12px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 14px; }
  thead { display: table-header-group; }
  tfoot { display: table-footer-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  thead tr {
    background: linear-gradient(180deg, rgba(255, 252, 230, 0.92), rgba(240, 230, 140, 0.48));
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.82);
  }
  th {
    border: 1px solid rgba(0, 0, 0, 0.1);
    padding: 6px 10px;
    font-weight: bold;
    text-align: center;
    color: #141820;
  }
  td {
    border: 1px solid rgba(0, 0, 0, 0.07);
    padding: 5px 10px;
    color: #1a1c1e;
    background: rgba(255, 255, 255, 0.52);
  }
  tfoot tr td {
    background: linear-gradient(180deg, rgba(255, 253, 240, 0.95), rgba(255, 250, 220, 0.55));
    font-weight: bold;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.65);
  }
  .num  { text-align: right; font-family: monospace; color: #003580; }
  .l    { text-align: left; }
  .section-title {
    font-size: 14px; font-weight: bold;
    margin: 16px 0 6px;
    border-bottom: 2px solid #bbb;
    padding-bottom: 3px;
    color: #111;
  }
  .kpi-grid { display: grid; grid-template-columns: repeat(3,1fr); gap: 10px; margin-bottom: 14px; }
  .kpi-box  {
    padding: 8px;
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.58);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.75), 0 2px 8px rgba(15, 23, 42, 0.06);
    backdrop-filter: blur(6px);
    -webkit-backdrop-filter: blur(6px);
  }
  .kpi-label { font-size: 11px; color: #555; }
  .kpi-value { font-size: 16px; font-weight: bold; color: #003580; }
  .stripe-even { background: rgba(248, 250, 252, 0.72); }
  .total-row td {
    background: linear-gradient(180deg, rgba(255, 253, 235, 0.92), rgba(255, 248, 210, 0.5));
    font-weight: bold;
  }
  .neg { color: #a50000 !important; font-weight: bold; }
  .pos { color: #1a6f27 !important; font-weight: bold; }
  .result-box {
    margin-bottom: 10px;
    padding: 8px 10px;
    background: linear-gradient(165deg, rgba(255, 253, 235, 0.9), rgba(255, 250, 220, 0.45));
    border: 1px solid rgba(0, 0, 0, 0.08);
    border-radius: 10px;
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.7), 0 2px 10px rgba(15, 23, 42, 0.05);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
  }
  .print-ts  { margin-top: 12px; font-size: 11px; color: #999; }
  /* ── รายงานสรุปผลกำไร (ฟอร์มขาว / แถบเหลือง) ─────────────────────────── */
  .print-formal-doc {
    background: #fff !important;
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
    border-bottom: 2px solid #000;
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
  .print-report-brand { font-size: 17px; font-weight: 800; letter-spacing: 0.03em; color: #0b1c3f; }
  .print-report-tagline {
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.14em;
    color: #0b1c3f;
    margin-top: 4px;
    text-transform: uppercase;
  }
  .print-slip-brand {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
    padding-bottom: 6px;
    border-bottom: 1px solid #0b1c3f;
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
    color: #0b1c3f;
    line-height: 1.2;
  }
  .print-slip-brand-tagline {
    font-size: 7px;
    font-weight: 600;
    letter-spacing: 0.1em;
    color: #5a6a85;
    text-transform: uppercase;
  }
  .print-report-title { font-size: 15px; font-weight: 700; margin-top: 4px; color: #111; }
  .print-report-sub { font-size: 12px; color: #333; margin-top: 3px; }
  .print-report-meta { text-align: right; font-size: 12px; line-height: 1.55; color: #111; white-space: nowrap; }
  .print-u { border-bottom: 1px solid #000; padding: 0 3px 1px; }
  .print-profit-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    background: #fdf2b3;
    border: 1px solid #000;
    margin-bottom: 12px;
    font-weight: 700;
    color: #111;
  }
  .print-profit-banner .pp-label { font-size: 14px; flex-shrink: 0; }
  .print-profit-banner .pp-value {
    flex: 1;
    text-align: center;
    font-size: 24px;
    font-weight: 800;
    font-family: ui-monospace, monospace;
  }
  .print-profit-banner .pp-unit { font-size: 14px; flex-shrink: 0; }
  .print-yellow-bar {
    background: #fdf2b3;
    border: 1px solid #000;
    border-bottom: none;
    padding: 7px 10px;
    font-weight: 700;
    font-size: 13px;
    margin-top: 14px;
    margin-bottom: 0;
    color: #111;
  }
  .print-yellow-bar + table { margin-top: 0; }
  table.print-formal {
    width: 100%;
    border-collapse: collapse;
    margin-bottom: 4px;
    border: 1px solid #000;
  }
  table.print-formal th,
  table.print-formal td {
    border: 1px solid #000;
    padding: 5px 8px;
    font-size: 12px;
    background: #fff;
  }
  table.print-formal thead th {
    background: #fdf2b3;
    font-weight: 700;
  }
  table.print-formal tbody th {
    background: #fff8dc;
    font-weight: 700;
    text-align: left;
  }
  .print-result-box {
    margin-bottom: 10px;
    padding: 8px 10px;
    background: #fffef5;
    border: 1px solid #000;
    font-size: 12px;
    line-height: 1.45;
  }
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
      background: #fff !important;
    }
  }
`;

/** Printable body height inside @page margins (A4 portrait). */
const A4_INNER_MM = 297 - PAGE_MARGIN_V_MM * 2;

/** Defaults for 4-col slip PDFs — balance fill vs Chrome splitting one table across pages. */
export const SLIP_PRINT_GRID_OPTS = {
  fontPx: 14,
  topBlockMm: 22,
  reserveFooterMm: 24,
  safetyDeduction: 2,
  rowLineExtraMm: 1,
} as const;

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
  <style>${PREVIEW_STYLE}</style>
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
    background: 'rgba(0,0,0,0.72)',
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
    background: '#1e2535',
    borderRadius: '14px',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
    border: '1px solid rgba(255,255,255,0.1)',
    animation: 'ppSlideUp 0.22s cubic-bezier(0.34,1.56,0.64,1)',
  });

  // ── Toolbar ──────────────────────────────────────────────────────────────
  const toolbar = document.createElement('div');
  Object.assign(toolbar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '10px 16px',
    background: '#151c2c',
    borderBottom: '1px solid rgba(255,255,255,0.08)',
    flexShrink: '0',
    fontFamily: "'Sarabun', Arial, sans-serif",
  });

  const titleEl = document.createElement('div');
  Object.assign(titleEl.style, {
    flex: '1',
    fontSize: '13px',
    fontWeight: '600',
    color: '#e2e8f0',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  });
  titleEl.textContent = `📄 ${title}`;

  const makeBtn = (label: string, bg: string, color: string, hoverBg: string) => {
    const btn = document.createElement('button');
    Object.assign(btn.style, {
      padding: '6px 18px',
      background: bg,
      color,
      border: 'none',
      borderRadius: '7px',
      cursor: 'pointer',
      fontSize: '13px',
      fontWeight: '600',
      fontFamily: "'Sarabun', Arial, sans-serif",
      transition: 'background 0.15s',
      whiteSpace: 'nowrap',
    });
    btn.textContent = label;
    btn.addEventListener('mouseenter', () => { btn.style.background = hoverBg; });
    btn.addEventListener('mouseleave', () => { btn.style.background = bg; });
    return btn;
  };

  const printBtn = makeBtn('🖨 พิมพ์ / บันทึก PDF', '#f0e68c', '#111', '#e2d43a');
  const closeBtn = makeBtn('✕ ปิด', '#374151', '#e2e8f0', '#4b5563');

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
    background: 'linear-gradient(180deg, #f1f5f9 0%, #e8eef7 100%)',
    borderRadius: '0 0 14px 14px',
  });

  printBtn.addEventListener('click', () => {
    (iframe as HTMLIFrameElement).contentWindow?.print();
  });

  toolbar.appendChild(titleEl);
  toolbar.appendChild(printBtn);
  toolbar.appendChild(closeBtn);
  card.appendChild(toolbar);
  card.appendChild(iframe);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  // Write content after iframe is in DOM
  iframe.srcdoc = fullHtml;
}
