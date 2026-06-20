'use client';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { useFocusTrap } from '@/lib/useFocusTrap';
import type { BetType, RangeSimRow } from '@/types';
import { buildPrintSlipBrandStrip, openPrintPreview, slipPagination, SLIP_PRINT_GRID_OPTS } from '@/lib/printPreview';
import { downloadHtmlAsPng } from '@/lib/htmlToPng';
import { PRINT_ROOT_INLINE_STYLE } from '@/lib/printTypography';
import { themeHex } from '@/lib/printColorTokens';
import { showApiError } from '@/lib/apiErrorToast';

const BET_TYPE_SHORT: Record<BetType, string> = {
  '3digit_top': '3 ตัวบน', '3digit_tote': '3 ตัวโต็ด', '3digit_back': '3 ตัวล่าง',
  '2digit_top': '2 ตัวบน', '2digit_bottom': '2 ตัวล่าง',
  '1digit_top': 'วิ่งบน',  '1digit_bottom': 'วิ่งล่าง',
};

export type CutSendItem = { number: string; amount: number; type: string; total?: number; alreadySent?: number };

/** HTML หลายหน้า (.print-sheet ต่อกัน) สำหรับโพยรายการส่งค้าง — พิมพ์ / PNG ไลน์ */
export function buildCutSlipSheetsHtml(
  roundName: string,
  betType: BetType,
  dealerName: string,
  cutItems: CutSendItem[],
  totalSend: number,
): string {
  const COLS = 4;
  const { rowsPerPage: ROWS, pageCapacity: ITEMS_PER_PAGE, totalPages } = slipPagination(
    cutItems.length,
    COLS,
    SLIP_PRINT_GRID_OPTS,
  );
  const BET_PREFIX: Record<string, string> = {
    '3digit_top': 'บน', '3digit_tote': 'โต็ด', '3digit_back': 'ล่าง',
    '2digit_top': 'บน', '2digit_bottom': 'ล่าง',
    '1digit_top': 'บน', '1digit_bottom': 'ล่าง',
  };
  const prefix = BET_PREFIX[betType] ?? '';
  const now = new Date();
  const printDateStr =
    now.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' +
    now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  let all = '';
  for (let pageIdx = 0; pageIdx < totalPages; pageIdx++) {
    const start = pageIdx * ITEMS_PER_PAGE;
    const pageItems = cutItems.slice(start, start + ITEMS_PER_PAGE);
    const thickR = `border-right:3px solid ${themeHex.borderFormal};`;
    const thinBorder = `border:1px solid ${themeHex.gray400};`;
    let bodyRows = '';
    for (let r = 0; r < ROWS; r++) {
      let cells = '';
      for (let c = 0; c < COLS; c++) {
        const item = pageItems[c * ROWS + r] ?? null;
        const sepR = c < COLS - 1 ? thickR : '';
        cells += `<td style="${thinBorder}white-space:nowrap;">${item ? `<span style="font-weight:700">${prefix} ${item.number}</span>` : ''}</td>`;
        cells += `<td style="${thinBorder}${sepR}text-align:right;">${item ? `<span style="font-weight:400">${item.amount.toLocaleString()}</span>` : ''}</td>`;
      }
      bodyRows += `<tr>${cells}</tr>`;
    }
    let headCells = '';
    for (let c = 0; c < COLS; c++) {
      const sepR = c < COLS - 1 ? thickR : '';
      headCells += `<th style="${thinBorder}background:${themeHex.slipHeaderBg};text-align:left;width:12.5%;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}background:${themeHex.slipHeaderBg};text-align:left;width:12.5%;">ราคา</th>`;
    }
    const pn = pageIdx + 1;
    all += `
      <div class="print-sheet" style="font-size:14px;color:${themeHex.textPrimary};">
        ${buildPrintSlipBrandStrip()}
        <div class="print-sheet-head">
          <span>รายการส่งของลูกค้า : ${dealerName || '—'}</span>
          <span>แผ่นที่ : ${pn} · งวดประจำวันที่ : ${roundName}</span>
        </div>
        <table class="print-slip-table" style="border:3px solid ${themeHex.borderFormal};">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;font-weight:bold;">วันที่พิมพ์ ${printDateStr}</td>
              <td colspan="4" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;text-align:center;font-weight:bold;">${pn}/${totalPages}</td>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;text-align:right;font-weight:bold;">ราคารวม&nbsp;&nbsp;&nbsp;&nbsp;${totalSend.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  }
  return all;
}

interface PdfDialogProps {
  roundName: string;
  betType: BetType;
  dealerName: string;
  threshold: number;
  cutItems: CutSendItem[];
  totalSend: number;
  totalRevenue: number;
  stats: RangeSimRow | null;
  onClose: () => void;
}
export function CutPdfDialog({ roundName, betType, dealerName, threshold, cutItems, totalSend, totalRevenue, stats, onClose }: PdfDialogProps) {
  const COLS = 4;
  const { rowsPerPage: ROWS, pageCapacity: ITEMS_PER_PAGE, totalPages } = slipPagination(
    cutItems.length,
    COLS,
    SLIP_PRINT_GRID_OPTS,
  );
  const panelRef = useFocusTrap(true, onClose);
  const [pngBusy, setPngBusy] = useState(false);

  const BET_PREFIX: Record<string, string> = {
    '3digit_top': 'บน', '3digit_tote': 'โต็ด', '3digit_back': 'ล่าง',
    '2digit_top': 'บน', '2digit_bottom': 'ล่าง',
    '1digit_top': 'บน', '1digit_bottom': 'ล่าง',
  };
  const prefix = BET_PREFIX[betType] ?? '';

  const now = new Date();
  const printDateStr = now.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  // ── Build HTML of one page (for print window) ─────────────────────────────
  const buildPageHtml = (pageIdx: number) => {
    const start = pageIdx * ITEMS_PER_PAGE;
    const pageItems = cutItems.slice(start, start + ITEMS_PER_PAGE);

    const thickR = `border-right:3px solid ${themeHex.borderFormal};`;
    const thinBorder = `border:1px solid ${themeHex.gray400};`;

    let bodyRows = '';
    for (let r = 0; r < ROWS; r++) {
      let cells = '';
      for (let c = 0; c < COLS; c++) {
        const item = pageItems[c * ROWS + r] ?? null;
        const sepR = c < COLS - 1 ? thickR : '';
        cells += `<td style="${thinBorder}white-space:nowrap;">${item ? `<span style="font-weight:700">${prefix} ${item.number}</span>` : ''}</td>`;
        cells += `<td style="${thinBorder}${sepR}text-align:right;">${item ? `<span style="font-weight:400">${item.amount.toLocaleString()}</span>` : ''}</td>`;
      }
      bodyRows += `<tr>${cells}</tr>`;
    }

    let headCells = '';
    for (let c = 0; c < COLS; c++) {
      const sepR = c < COLS - 1 ? thickR : '';
      headCells += `<th style="${thinBorder}background:${themeHex.slipHeaderBg};text-align:left;width:12.5%;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}background:${themeHex.slipHeaderBg};text-align:left;width:12.5%;">ราคา</th>`;
    }

    const pn = pageIdx + 1;
    return `
      <div class="print-sheet" style="font-size:14px;color:${themeHex.textPrimary};">
        ${buildPrintSlipBrandStrip()}
        <div class="print-sheet-head">
          <span>รายการส่งของลูกค้า : ${dealerName || '—'}</span>
          <span>แผ่นที่ : ${pn} · งวดประจำวันที่ : ${roundName}</span>
        </div>
        <table class="print-slip-table" style="border:3px solid ${themeHex.borderFormal};">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;font-weight:bold;">วันที่พิมพ์ ${printDateStr}</td>
              <td colspan="4" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;text-align:center;font-weight:bold;">${pn}/${totalPages}</td>
              <td colspan="2" style="${thinBorder}background:${themeHex.slipFooterBg};border-top:3px solid ${themeHex.borderFormal};padding:4px 7px;text-align:right;font-weight:bold;">ราคารวม&nbsp;&nbsp;&nbsp;&nbsp;${totalSend.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  };

  const doPrint = () => {
    const sheets = buildCutSlipSheetsHtml(roundName, betType, dealerName, cutItems, totalSend);
    const html = `
      <div class="print-root" style="${PRINT_ROOT_INLINE_STYLE};color:${themeHex.textPrimary};">
        ${sheets}
      </div>`;
    openPrintPreview(html, `รายการส่ง — ${dealerName} ${roundName}`, `รายการส่ง_${dealerName}_${roundName}`);
  };

  const doDownloadPng = async () => {
    const sheets = buildCutSlipSheetsHtml(roundName, betType, dealerName, cutItems, totalSend);
    setPngBusy(true);
    try {
      await downloadHtmlAsPng({
        bodyHtml: sheets,
        filenameBase: `LINE_รายการส่งค้าง_${dealerName}_${roundName}_${BET_TYPE_SHORT[betType]}`,
      });
    } catch (err: unknown) {
      showApiError(err, 'สร้าง PNG ไม่สำเร็จ — ลองใช้ปุ่มพิมพ์ / PDF แทน');
    } finally {
      setPngBusy(false);
    }
  };

  // ── React preview of a single page ────────────────────────────────────────
  const PreviewPage = ({ pageIdx }: { pageIdx: number }) => {
    const start = pageIdx * ITEMS_PER_PAGE;
    const pageItems = cutItems.slice(start, start + ITEMS_PER_PAGE);
    const pn = pageIdx + 1;

    const headerRow = (
      <tr>
        {Array.from({ length: COLS }, (_, c) => {
          const isLast = c === COLS - 1;
          return [
            <th key={`h${c}n`} style={{ border: `1px solid ${themeHex.gray400}`, background: themeHex.slipHeaderBg, padding: '5px 6px', textAlign: 'left', width: '12.5%' }}>เลข</th>,
            <th key={`h${c}p`} style={{ border: `1px solid ${themeHex.gray400}`, background: themeHex.slipHeaderBg, borderRight: isLast ? `1px solid ${themeHex.gray400}` : `3px solid ${themeHex.borderFormal}`, padding: '5px 6px', textAlign: 'left', width: '12.5%' }}>ราคา</th>,
          ];
        }).flat()}
      </tr>
    );

    const bodyRows = Array.from({ length: ROWS }, (_, r) => (
      <tr key={r}>
        {Array.from({ length: COLS }, (_, c) => {
          const item = pageItems[c * ROWS + r] ?? null;
          const isLast = c === COLS - 1;
          return [
            <td key={`r${r}c${c}n`} style={{ border: `1px solid ${themeHex.gray400}`, padding: '3px 7px', whiteSpace: 'nowrap' as const, height: 22 }}>
              {item ? <span style={{ fontWeight: 700 }}>{prefix} {item.number}</span> : ''}
            </td>,
            <td key={`r${r}c${c}p`} style={{ border: `1px solid ${themeHex.gray400}`, borderRight: isLast ? `1px solid ${themeHex.gray400}` : `3px solid ${themeHex.borderFormal}`, padding: '3px 7px', textAlign: 'right' }}>
              {item ? <span style={{ fontWeight: 400 }}>{item.amount.toLocaleString()}</span> : ''}
            </td>,
          ];
        }).flat()}
      </tr>
    ));

    return (
      <div style={{ marginBottom: pageIdx < totalPages - 1 ? 24 : 0, color: themeHex.textPrimary, maxWidth: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px 10px', fontWeight: 'bold', fontSize: 15, marginBottom: 6, maxWidth: '100%' }}>
          <span>รายการส่งของลูกค้า : {dealerName || '—'}</span>
          <span>แผ่นที่ : {pn} · งวดประจำวันที่ : {roundName}</span>
        </div>
        <table style={{ width: '100%', maxWidth: '100%', tableLayout: 'fixed' as const, borderCollapse: 'collapse', border: `3px solid ${themeHex.borderFormal}`, fontSize: 14 }}>
          <thead>{headerRow}</thead>
          <tbody>{bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ border: `1px solid ${themeHex.gray400}`, background: themeHex.slipFooterBg, borderTop: `3px solid ${themeHex.borderFormal}`, padding: '4px 7px', fontWeight: 'bold', whiteSpace: 'nowrap' as const }}>
                วันที่พิมพ์ {printDateStr}
              </td>
              <td colSpan={4} style={{ border: `1px solid ${themeHex.gray400}`, background: themeHex.slipFooterBg, borderTop: `3px solid ${themeHex.borderFormal}`, padding: '4px 7px', textAlign: 'center', fontWeight: 'bold' }}>
                {pn}/{totalPages}
              </td>
              <td colSpan={2} style={{ border: `1px solid ${themeHex.gray400}`, background: themeHex.slipFooterBg, borderTop: `3px solid ${themeHex.borderFormal}`, padding: '4px 7px', textAlign: 'right', fontWeight: 'bold', whiteSpace: 'nowrap' as const }}>
                ราคารวม&nbsp;&nbsp;&nbsp;&nbsp;{totalSend.toLocaleString()}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)]  p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        ref={panelRef}
        role="dialog" aria-modal="true" aria-labelledby="pdf-dialog-title"
        tabIndex={-1}
        className="bg-[var(--color-card-bg-solid)] border-0 rounded-2xl shadow-lg w-full max-w-5xl max-h-[95vh] flex flex-col focus:outline-none">

        {/* Dialog header */}
        <div className="flex flex-wrap items-center gap-3 px-5 py-3 border-b border-border bg-[var(--bg-glass)] rounded-t-xl">
          <div className="flex-1 min-w-0">
            <h3 id="pdf-dialog-title" className="font-semibold text-theme-text-primary">ตัวอย่างฟอร์มส่ง</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">{BET_TYPE_SHORT[betType]} · {cutItems.length} รายการ · {totalPages} หน้า</p>
          </div>
          <div className="flex flex-wrap gap-2 shrink-0">
            <button onClick={onClose} className="h-8 px-4 rounded-lg bg-surface-200 hover:bg-[var(--bg-hover)] text-sm text-theme-text-primary border border-border transition-all duration-theme">ปิด</button>
            <button
              type="button"
              onClick={() => void doDownloadPng()}
              disabled={pngBusy || cutItems.length === 0}
              className="h-8 px-4 text-sm rounded-xl border-2 border-[var(--chart-primary)] bg-[var(--chart-primary-soft)] text-[var(--chart-neutral-dark)] font-semibold hover:brightness-95 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              {pngBusy ? 'กำลังสร้าง PNG…' : 'ดาวน์โหลด PNG (ส่งไลน์)'}
            </button>
            <button onClick={doPrint} className="btn-primary-glow h-8 px-4 text-sm rounded-xl flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
              </svg>
              พิมพ์ / PDF
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto p-6 bg-surface-default/50">
          <div className="bg-[var(--color-card-bg-solid)] border border-border shadow-card rounded p-5 min-w-[700px]">
            {Array.from({ length: totalPages }, (_, i) => <PreviewPage key={i} pageIdx={i} />)}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
