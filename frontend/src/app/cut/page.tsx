'use client';
import { useEffect, useState, useCallback, useRef, useMemo, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
  Cell, CartesianGrid, Customized,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { roundsApi, cutApi, dealersApi } from '@/lib/api';
import { cn, formatBaht } from '@/lib/utils';
import {
  readPanelWidth,
  writePanelWidth,
  readPanelLock,
  writePanelLock,
  STORAGE_CUT_RIGHT_PANEL_W,
  STORAGE_CUT_RIGHT_PANEL_LOCK,
} from '@/lib/panelResize';
import { buildPrintSlipBrandStrip, openPrintPreview, slipPagination, SLIP_PRINT_GRID_OPTS } from '@/lib/printPreview';
import {
  Round, BetType, BET_TYPE_LABELS, Dealer,
  RangeSimResponse, RangeSimRow, RiskReport, SendBatch,
} from '@/types';

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
/** ขั้น % นำของยอดสูงสุด — 0.5 ละเอียดสุดในรายการ (201 แถว), สูตร backend เดิม */
const STEP_OPTIONS = [0.5, 1, 2.5, 5] as const;

// ─── Chart types ─────────────────────────────────────────────────────────────
interface ChartBar {
  number: string;
  kept: number;
  sentCut: number;  // already committed cut (blue)
  newCut: number;   // new incremental cut (gray)
  cut: number;      // total cut = sentCut + newCut
  total: number;
}

type ChartSortMode = 'amount_desc' | 'number_asc';

/** รายการตัดที่เก็บไว้ส่งภายหลัง (รวมหลายประเภทก่อนกดบันทึกส่ง) */
type PendingCutSlice = {
  bet_type: BetType;
  threshold: number;
  items: { number: string; amount: number }[];
  total: number;
};

/** เปรียบเทียบแถวช่วง: ได้สูงสุดก่อน, เสียสูงสุด (สัมบูรณ์) ต่ำก่อน, แล้ว % ได้ */
function compareRangeRowsBetter(a: RangeSimRow, b: RangeSimRow): number {
  if (Math.abs(a.max_gain - b.max_gain) > 1e-6) return a.max_gain > b.max_gain ? 1 : -1;
  const la = a.max_loss != null ? Math.abs(a.max_loss) : -1;
  const lb = b.max_loss != null ? Math.abs(b.max_loss) : -1;
  if (la !== lb) return la < lb ? 1 : -1;
  if (Math.abs(a.pct_win - b.pct_win) > 1e-6) return a.pct_win > b.pct_win ? 1 : -1;
  return 0;
}

/** คะแนนแสดงผล (ได้สูง − สเกลเสีย) — ใช้เรียงตารางเท่านั้น */
function smartCutDisplayScore(r: RangeSimRow, revenueScale: number): number {
  const loss = r.max_loss != null ? Math.abs(r.max_loss) : 0;
  const scale = Math.max(revenueScale, 1);
  return r.max_gain - (loss / scale) * (scale * 0.15);
}

// ─── Custom X-axis tick: vertical (rotated -90°) ───────────────────────────────
function NumberTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const cx = x ?? 0;
  const cy = (y ?? 0) + 14;
  return (
    <text
      x={cx} y={cy}
      textAnchor="start"
      dominantBaseline="central"
      fontSize={10}
      fill="var(--chart-bar-new)"
      fontFamily="monospace"
      fontWeight="600"
      transform={`rotate(-90, ${cx}, ${cy})`}
    >
      {payload?.value}
    </text>
  );
}

// ─── Bar tooltip ─────────────────────────────────────────────────────────────
function BarTooltip({ active, payload, threshold }: { active?: boolean; payload?: any[]; threshold: number }) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as ChartBar;
  return (
    <div className="bg-surface-default border border-border rounded-lg px-3 py-2.5 text-xs shadow-[var(--shadow-hover)] min-w-[130px]">
      <p className="font-mono font-bold text-theme-text-primary text-sm mb-2 tracking-widest">{d.number}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-theme-text-secondary">ยอดรวม</span>
          <span className="font-mono text-theme-text-primary">{formatBaht(d.total)}</span>
        </div>
        <>
          <div className="flex justify-between gap-4">
            <span className="text-risk-medium">เก็บ</span>
            <span className="font-mono text-risk-medium">{formatBaht(d.kept)}</span>
          </div>
          {d.sentCut > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-blue-400">ส่งแล้ว</span>
              <span className="font-mono text-accent-glow">{formatBaht(d.sentCut)}</span>
            </div>
          )}
          {d.newCut > 0 && (
            <div className="flex justify-between gap-4">
              <span className="text-theme-text-secondary">ตัดเพิ่ม</span>
              <span className="font-mono text-theme-text-secondary">{formatBaht(d.newCut)}</span>
            </div>
          )}
        </>
      </div>
    </div>
  );
}

// ─── Custom reference line — rendered on top of bars via <Customized> ──────────
function ChartRefLine({
  threshold, stroke, labelText, strokeDasharray = '6 3', strokeWidth = 2,
  yAxisMap, xAxisMap, ..._
}: { threshold: number; stroke: string; labelText?: string; strokeDasharray?: string; strokeWidth?: number; yAxisMap?: any; xAxisMap?: any; [k: string]: any }) {
  if (!Number.isFinite(threshold) || threshold < 0 || !yAxisMap || !xAxisMap) return null;
  const yAxis = (Object.values(yAxisMap)[0]) as any;
  const xAxis = (Object.values(xAxisMap)[0]) as any;
  if (!yAxis?.scale || !xAxis) return null;
  const y = Math.round(yAxis.scale(threshold));
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={xAxis.x} x2={xAxis.x + xAxis.width} y1={y} y2={y}
        stroke={stroke} strokeDasharray={strokeDasharray} strokeWidth={strokeWidth} />
      {labelText && (
        <text x={xAxis.x + xAxis.width - 4} y={y - 6} fill={stroke} fontSize={11} fontWeight="700" fontFamily="monospace" textAnchor="end">{labelText}</text>
      )}
    </g>
  );
}

// ─── Scale capture helper (captures Recharts d3 scale for pixel-accurate click) ──
function ScaleCaptureCustomized({ yAxisMap, onCapture }: { yAxisMap?: any; onCapture: (scale: any, top: number) => void }) {
  const yAxis = yAxisMap ? (Object.values(yAxisMap)[0] as any) : null;
  if (yAxis?.scale) onCapture(yAxis.scale, yAxis.y ?? 4);
  return null;
}

// ─── Search dialog ────────────────────────────────────────────────────────────
function SearchDialog({ onClose, onConfirm }: {
  onClose: () => void;
  onConfirm: (mode: string, value: number) => void;
}) {
  const [mode, setMode] = useState<'manual' | 'pct_win' | 'max_payout'>('manual');
  const [value, setValue] = useState(0);
  const opts = [
    { k: 'manual'     as const, label: 'กำหนดเองโดยตรง',    hint: 'บาท / เลข' },
    { k: 'pct_win'    as const, label: 'ค้นหา % ได้เสีย',   hint: '% ได้ ≥' },
    { k: 'max_payout' as const, label: 'ค้นหายอดจ่ายสูงสุด', hint: 'จ่ายสูงสุด ≤' },
  ];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)] ">
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
        className="bg-[var(--color-card-bg-solid)] rounded-xl shadow-[var(--shadow-hover)] border border-border p-8 w-[380px]">
        <h3 className="font-semibold text-theme-text-primary text-lg mb-4">ค้นหายอดตัด</h3>
        <div className="space-y-3 mb-6">
          {opts.map((o) => (
            <label key={o.k} className={`flex flex-col gap-2 p-3 rounded-lg border cursor-pointer transition-colors duration-200 [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))] ${
              mode === o.k ? 'border-[var(--color-border-strong)] bg-[var(--color-nav-active-bg)]' : 'border-border hover:border-[var(--color-border-strong)]'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" className="accent-neutral" checked={mode === o.k} onChange={() => setMode(o.k)} />
                <span className="text-sm font-semibold text-theme-text-primary">{o.label}</span>
              </div>
              {mode === o.k && (
                <div className="flex items-center gap-2 pl-5">
                  <span className="text-xs text-theme-text-muted shrink-0">{o.hint}</span>
                  <input type="number" min={0} value={value} onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
                    className="h-8 w-32 rounded-lg bg-[var(--color-input-bg)] border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
              )}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <button className="bg-white border border-border text-theme-text-primary rounded-lg px-4 py-2 font-semibold hover:bg-[var(--bg-hover)] transition-colors duration-200 text-sm" onClick={onClose}>ยกเลิก</button>
          <button className="btn-primary-glow px-4 py-2 text-sm rounded-xl" onClick={() => onConfirm(mode, value)}>ตกลง</button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── PDF Print dialog ─────────────────────────────────────────────────────────
interface SendItem { number: string; amount: number; type: string; total?: number; alreadySent?: number }
interface PdfDialogProps {
  roundName: string;
  betType: BetType;
  dealerName: string;
  threshold: number;
  cutItems: SendItem[];
  totalSend: number;
  totalRevenue: number;
  stats: RangeSimRow | null;
  onClose: () => void;
}
function PdfDialog({ roundName, betType, dealerName, threshold, cutItems, totalSend, totalRevenue, stats, onClose }: PdfDialogProps) {
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
  const printDateStr = now.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  // ── Build HTML of one page (for print window) ─────────────────────────────
  const buildPageHtml = (pageIdx: number) => {
    const start = pageIdx * ITEMS_PER_PAGE;
    const pageItems = cutItems.slice(start, start + ITEMS_PER_PAGE);

    const thickR = 'border-right:3px solid #000;';
    const thinBorder = 'border:1px solid #aaa;';

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
      headCells += `<th style="${thinBorder}background:#f0e68c;text-align:left;width:12.5%;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}background:#f0e68c;text-align:left;width:12.5%;">ราคา</th>`;
    }

    const pn = pageIdx + 1;
    return `
      <div class="print-sheet" style="font-size:14px;color:#000;">
        ${buildPrintSlipBrandStrip()}
        <div class="print-sheet-head">
          <span>รายการส่งของลูกค้า : ${dealerName || '—'}</span>
          <span>แผ่นที่ : ${pn} · งวดประจำวันที่ : ${roundName}</span>
        </div>
        <table class="print-slip-table" style="border:3px solid #000;">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="2" style="${thinBorder}background:#fffde7;border-top:3px solid #000;padding:4px 7px;font-weight:bold;">วันที่พิมพ์ ${printDateStr}</td>
              <td colspan="4" style="${thinBorder}background:#fffde7;border-top:3px solid #000;padding:4px 7px;text-align:center;font-weight:bold;">${pn}/${totalPages}</td>
              <td colspan="2" style="${thinBorder}background:#fffde7;border-top:3px solid #000;padding:4px 7px;text-align:right;font-weight:bold;">ราคารวม&nbsp;&nbsp;&nbsp;&nbsp;${totalSend.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;
  };

  const doPrint = () => {
    const allPages = Array.from({ length: totalPages }, (_, i) => buildPageHtml(i)).join('');
    const html = `
      <div class="print-root" style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;color:#000;">
        ${allPages}
      </div>`;
    openPrintPreview(html, `รายการส่ง — ${dealerName} ${roundName}`, `รายการส่ง_${dealerName}_${roundName}`);
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
            <th key={`h${c}n`} style={{ border: '1px solid #aaa', background: '#f0e68c', padding: '5px 6px', textAlign: 'left', width: '12.5%' }}>เลข</th>,
            <th key={`h${c}p`} style={{ border: '1px solid #aaa', background: '#f0e68c', borderRight: isLast ? '1px solid #aaa' : '3px solid #000', padding: '5px 6px', textAlign: 'left', width: '12.5%' }}>ราคา</th>,
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
            <td key={`r${r}c${c}n`} style={{ border: '1px solid #aaa', padding: '3px 7px', whiteSpace: 'nowrap' as const, height: 22 }}>
              {item ? <span style={{ fontWeight: 700 }}>{prefix} {item.number}</span> : ''}
            </td>,
            <td key={`r${r}c${c}p`} style={{ border: '1px solid #aaa', borderRight: isLast ? '1px solid #aaa' : '3px solid #000', padding: '3px 7px', textAlign: 'right' }}>
              {item ? <span style={{ fontWeight: 400 }}>{item.amount.toLocaleString()}</span> : ''}
            </td>,
          ];
        }).flat()}
      </tr>
    ));

    return (
      <div style={{ marginBottom: pageIdx < totalPages - 1 ? 24 : 0, color: '#000', maxWidth: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: '6px 10px', fontWeight: 'bold', fontSize: 15, marginBottom: 6, maxWidth: '100%' }}>
          <span>รายการส่งของลูกค้า : {dealerName || '—'}</span>
          <span>แผ่นที่ : {pn} · งวดประจำวันที่ : {roundName}</span>
        </div>
        <table style={{ width: '100%', maxWidth: '100%', tableLayout: 'fixed' as const, borderCollapse: 'collapse', border: '3px solid #000', fontSize: 14 }}>
          <thead>{headerRow}</thead>
          <tbody>{bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colSpan={2} style={{ border: '1px solid #aaa', background: '#fffde7', borderTop: '3px solid #000', padding: '4px 7px', fontWeight: 'bold', whiteSpace: 'nowrap' as const }}>
                วันที่พิมพ์ {printDateStr}
              </td>
              <td colSpan={4} style={{ border: '1px solid #aaa', background: '#fffde7', borderTop: '3px solid #000', padding: '4px 7px', textAlign: 'center', fontWeight: 'bold' }}>
                {pn}/{totalPages}
              </td>
              <td colSpan={2} style={{ border: '1px solid #aaa', background: '#fffde7', borderTop: '3px solid #000', padding: '4px 7px', textAlign: 'right', fontWeight: 'bold', whiteSpace: 'nowrap' as const }}>
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
        className="bg-[var(--color-card-bg-solid)] border border-theme-card-border rounded-xl shadow-[var(--shadow-soft)]  w-full max-w-5xl max-h-[95vh] flex flex-col">

        {/* Dialog header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border bg-[var(--bg-glass)] rounded-t-xl">
          <div>
            <h3 className="font-semibold text-theme-text-primary">ตัวอย่างฟอร์มส่ง</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">{BET_TYPE_SHORT[betType]} · {cutItems.length} รายการ · {totalPages} หน้า</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 px-4 rounded-lg bg-surface-200 hover:bg-[var(--bg-hover)] text-sm text-theme-text-primary border border-border transition-all duration-theme">ปิด</button>
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

// ─── Smart Cut Dialog ─────────────────────────────────────────────────────────

function SmartCutDialog({
  rows,
  totalRevenue,
  onClose,
  onApply,
}: {
  rows: RangeSimRow[];
  totalRevenue: number;
  onClose: () => void;
  onApply: (rowIdx: number, threshold: number) => void;
}) {
  const [maxLossLimit, setMaxLossLimit] = useState(Math.round(totalRevenue * 0.5));
  const [minPctWin, setMinPctWin]       = useState(50);

  const revenueScale = Math.max(totalRevenue, 1);
  const scoreDisplay = (r: RangeSimRow) => smartCutDisplayScore(r, revenueScale);

  const working = rows;

  const passAll = working.filter(r =>
    (r.max_loss === null || Math.abs(r.max_loss) <= maxLossLimit) &&
    r.pct_win >= minPctWin
  );
  const passLossOnly = working.filter(r => r.max_loss === null || Math.abs(r.max_loss) <= maxLossLimit);

  const top5 = [...working]
    .sort((a, b) => {
      const c = compareRangeRowsBetter(a, b);
      if (c !== 0) return -c;
      return scoreDisplay(b) - scoreDisplay(a);
    })
    .slice(0, 5);

  // Primary suggestion — lexicographic: ได้สูงสุด → เสียต่ำสุด → % ได้
  let primary: { row: RangeSimRow; rowIdx: number; label: string; color: string; reason: string } | null = null;
  let secondary: { row: RangeSimRow; rowIdx: number; label: string; color: string; reason: string } | null = null;

  if (passAll.length > 0) {
    const best = passAll.reduce((a, b) => (compareRangeRowsBetter(a, b) >= 0 ? a : b));
    primary = {
      row: best, rowIdx: rows.indexOf(best),
      label: '⭐ แนะนำ (ได้สูง · เสียต่ำ ในกรอบที่ตั้ง)', color: 'emerald',
      reason: `ได้สูงสุด ${formatBaht(best.max_gain)} · เสียสูงสุด ${best.max_loss != null ? formatBaht(best.max_loss) : 'ไม่เสีย'} · %ได้ ${best.pct_win.toFixed(1)}%`,
    };
    const thrifty = passAll.reduce((a, b) => b.threshold > a.threshold ? b : a);
    if (rows.indexOf(thrifty) !== rows.indexOf(best)) {
      secondary = {
        row: thrifty, rowIdx: rows.indexOf(thrifty),
        label: '💰 ประหยัด (เก็บมาก ส่งน้อย)', color: 'violet',
        reason: `เก็บถึง ${formatBaht(thrifty.threshold)} บ/เลข · ส่งออกน้อยสุดที่ยังผ่านเงื่อนไข · %ได้ ${thrifty.pct_win.toFixed(1)}%`,
      };
    }
  } else if (passLossOnly.length > 0) {
    const best2 = passLossOnly.reduce((a, b) => (compareRangeRowsBetter(a, b) >= 0 ? a : b));
    primary = {
      row: best2, rowIdx: rows.indexOf(best2),
      label: '⚠️ ดีที่สุดในช่วงยอมรับได้ (%ได้ต่ำกว่าเป้า)', color: 'amber',
      reason: `%ได้ ${best2.pct_win.toFixed(1)}% (เป้า ≥${minPctWin}%) · เสียสูงสุด: ${best2.max_loss != null ? formatBaht(best2.max_loss) : 'ไม่เสีย'}`,
    };
  } else {
    const best3 = working.reduce((a, b) => (compareRangeRowsBetter(a, b) >= 0 ? a : b));
    primary = {
      row: best3, rowIdx: rows.indexOf(best3),
      label: '⚠️ ดีที่สุดที่มี (ยอดเสียเกิน limit)', color: 'amber',
      reason: `ได้สูงสุด ${formatBaht(best3.max_gain)} · เสียสูงสุด ${best3.max_loss != null ? formatBaht(best3.max_loss) : 'ไม่เสีย'} · ลองผ่อนปรนเพดานเสีย`,
    };
  }

  const colorMap: Record<string, { bg: string; border: string; text: string; btn: string }> = {
    emerald: { bg: 'bg-profit/10', border: 'border-profit/35', text: 'text-profit', btn: 'btn-primary-glow' },
    amber:   { bg: 'bg-surface-100', border: 'border-border', text: 'text-theme-text-secondary', btn: 'btn-primary-glow' },
    violet:  { bg: 'bg-accent/12', border: 'border-accent/35', text: 'text-accent', btn: 'btn-primary-glow' },
  };

  const SuggestionCard = ({ s }: { s: typeof primary }) => {
    if (!s) return null;
    const c = colorMap[s.color] ?? colorMap['amber'];
    return (
      <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-bold text-sm ${c.text}`}>{s.label}</p>
            <p className="text-xs text-theme-text-secondary mt-1">{s.reason}</p>
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-theme-text-muted">
              <span>เก็บตัวละ: <span className="font-mono text-risk-medium">{s.row.threshold > 0 ? formatBaht(s.row.threshold) : '0'} บ</span></span>
              <span>จำนวนเก็บ: <span className="font-mono text-accent-glow">{s.row.count_fully_kept}</span></span>
              <span>%ได้: <span className="font-mono text-profit">{s.row.pct_win.toFixed(1)}%</span></span>
              <span>%เสีย: <span className="font-mono text-loss">{s.row.pct_lose.toFixed(1)}%</span></span>
            </div>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-theme-text-muted">
              <span>ได้สูงสุด: <span className="font-mono text-profit">{formatBaht(s.row.max_gain)}</span></span>
              <span>เสียสูงสุด: <span className={`font-mono ${s.row.max_loss != null ? 'text-loss' : 'text-profit'}`}>
                {s.row.max_loss != null ? formatBaht(s.row.max_loss) : 'ไม่เสีย'}</span></span>
            </div>
          </div>
          <button
            onClick={() => { onApply(s.rowIdx, s.row.threshold); onClose(); }}
            className={`shrink-0 h-8 px-4 text-xs ${c.btn}`}>
            ใช้ค่านี้
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)]  p-4">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-theme-text-primary text-base">✨ ตัดอัจฉริยะ</h3>
              <p className="text-xs text-theme-text-muted mt-0.5">วิเคราะห์จุดตัดที่เหมาะสมโดยอัตโนมัติ — คุณแค่ปรับเงื่อนไขเล็กน้อย</p>
            </div>
            <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-secondary transition-colors text-lg leading-none mt-0.5">✕</button>
          </div>
        </div>

        {/* Explanation */}
        <div className="px-5 py-3 border-b border-border bg-surface-200/30 shrink-0">
          <p className="text-xs font-semibold text-theme-text-secondary mb-1.5">หลักการคำนวณ</p>
          <div className="flex flex-wrap gap-4 text-xs text-theme-text-secondary">
            <span>📊 <span className="text-theme-text-secondary font-semibold">เลือกแถว</span>: <span className="text-profit">ยอดได้สูงสุด</span> มากสุดก่อน หากเท่ากันให้ <span className="text-loss">ยอดเสียสูงสุด</span> (สัมบูรณ์) ต่ำสุด แล้วค่อยดู <span className="text-accent-hover">% ได้</span> — ข้อมูลชุดเดียวกับตารางกำหนดช่วง</span>
            <span>🎯 กรองด้วย <span className="text-risk-medium">เพดานยอดเสีย</span> + <span className="text-profit">%ได้ขั้นต่ำ</span></span>
            <span>✅ แถวที่ผ่านเงื่อนไข: <span className={`font-mono font-bold ${passAll.length > 0 ? 'text-profit' : 'text-loss'}`}>{passAll.length}</span>/{working.length}</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Constraints */}
          <div className="px-5 py-4 border-b border-border space-y-3">
            <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">ตั้งค่าเงื่อนไข</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-theme-text-secondary">เพดานยอดเสียที่รับได้ (บาท)</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} value={maxLossLimit}
                    onChange={e => setMaxLossLimit(Number(e.target.value) || 0)}
                    className="h-8 flex-1 rounded-lg bg-surface-300 border border-border px-3 text-sm text-theme-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                  <span className="text-xs text-theme-text-muted shrink-0">≈{((maxLossLimit / Math.max(totalRevenue, 1)) * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={0} max={totalRevenue} step={Math.ceil(totalRevenue / 100)}
                  value={Math.min(maxLossLimit, totalRevenue)}
                  onChange={e => setMaxLossLimit(Number(e.target.value))}
                  className="w-full accent-neutral h-1" />
                <p className="text-[10px] text-theme-text-muted">ยอดขาดทุนสูงสุดที่คุณยอมรับได้ถ้าเลขถูก</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-theme-text-secondary">%ได้กำไรขั้นต่ำ</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={100} value={minPctWin}
                    onChange={e => setMinPctWin(Number(e.target.value) || 0)}
                    className="h-8 flex-1 rounded-lg bg-surface-300 border border-border px-3 text-sm text-theme-text-primary font-mono focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                  <span className="text-xs text-theme-text-muted shrink-0">%</span>
                </div>
                <input type="range" min={0} max={100} step={5}
                  value={minPctWin}
                  onChange={e => setMinPctWin(Number(e.target.value))}
                  className="w-full accent h-1" />
                <p className="text-[10px] text-theme-text-muted">ใน 100 ผลลัพธ์ที่เป็นไปได้ ต้องได้กำไรกี่%</p>
              </div>
            </div>
          </div>

          {/* Suggestions */}
          <div className="px-5 py-4 space-y-3 border-b border-border">
            <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider">ผลการวิเคราะห์</p>
            <SuggestionCard s={primary} />
            {secondary && <SuggestionCard s={secondary} />}
          </div>

          {/* Top 5 scoring table */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-2">Top 5 แถว (เรียงได้สูง → เสียต่ำ → %ได้)</p>
            <div className="overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-surface-200 border-b border-border">
                  <tr>
                    {['#', 'ดัชนี', 'เก็บตัวละ', 'จำนวนเก็บ', '%ได้', '%เสีย', 'ได้สูงสุด', 'เสียสูงสุด', ''].map(h => (
                      <th key={h} className="py-2 px-2.5 text-left text-theme-text-muted font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {top5.map((row, i) => {
                    const rowIdx = rows.indexOf(row);
                    const pass = (row.max_loss === null || Math.abs(row.max_loss) <= maxLossLimit) && row.pct_win >= minPctWin;
                    return (
                      <tr key={i} className={`border-b border-border/30 ${pass ? '' : 'opacity-50'}`}>
                        <td className="py-1.5 px-2.5 text-theme-text-muted">{row.row}</td>
                        <td className="py-1.5 px-2.5 font-mono text-accent-hover font-semibold">{scoreDisplay(row).toFixed(0)}</td>
                        <td className="py-1.5 px-2.5 font-mono text-risk-medium">{formatBaht(row.threshold)}</td>
                        <td className="py-1.5 px-2.5 font-mono text-accent-glow">{row.count_fully_kept}</td>
                        <td className={`py-1.5 px-2.5 font-mono font-semibold ${row.pct_win >= minPctWin ? 'text-profit' : 'text-loss'}`}>{row.pct_win.toFixed(1)}%</td>
                        <td className="py-1.5 px-2.5 font-mono text-loss">{row.pct_lose.toFixed(1)}%</td>
                        <td className="py-1.5 px-2.5 font-mono text-profit">{formatBaht(row.max_gain)}</td>
                        <td className={`py-1.5 px-2.5 font-mono ${row.max_loss != null ? (Math.abs(row.max_loss) <= maxLossLimit ? 'text-loss' : 'text-risk-high font-bold') : 'text-profit'}`}>
                          {row.max_loss != null ? formatBaht(row.max_loss) : 'ไม่เสีย'}
                        </td>
                        <td className="py-1.5 px-1">
                          <button onClick={() => { onApply(rowIdx, row.threshold); onClose(); }}
                            className="h-6 px-2 rounded bg-surface-300 hover:bg-accent/30 text-[10px] text-theme-text-secondary hover:text-accent transition-colors border border-border">
                            ใช้
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border shrink-0 flex justify-end">
          <button onClick={onClose} className="h-8 px-4 rounded-lg bg-surface-300 hover:bg-surface-200 text-sm text-theme-text-secondary transition-colors border border-border">ปิด</button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Dealer field mapping ─────────────────────────────────────────────────────
const DEALER_RATE_KEYS: Record<BetType, keyof Dealer> = {
  '3digit_top':    'rate_3top',    '3digit_tote':   'rate_3tote',   '3digit_back':   'rate_3back',
  '2digit_top':    'rate_2top',    '2digit_bottom':  'rate_2bottom',
  '1digit_top':    'rate_1top',    '1digit_bottom':  'rate_1bottom',
};
const DEALER_PCT_KEYS: Record<BetType, keyof Dealer> = {
  '3digit_top':    'pct_3top',    '3digit_tote':   'pct_3tote',   '3digit_back':   'pct_3back',
  '2digit_top':    'pct_2top',    '2digit_bottom':  'pct_2bottom',
  '1digit_top':    'pct_1top',    '1digit_bottom':  'pct_1bottom',
};

// ─── Batch print HTML builder ─────────────────────────────────────────────────
/** พิมพ์ทีละชุดส่ง (แยกตามประเภทเลข / batch) — ไม่รวมเลขทุกประเภทในตารางเดียว */
function buildBatchPrintHtml(batches: SendBatch[], roundName: string): string {
  const COLS = 4;
  const BET_PREFIX: Record<string, string> = {
    '3digit_top': 'บน',  '3digit_tote': 'โต็ด', '3digit_back': 'ล่าง',
    '2digit_top': 'บน',  '2digit_bottom': 'ล่าง',
    '1digit_top': 'บน',  '1digit_bottom': 'ล่าง',
  };
  const now = new Date();
  const printDate = now.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
  const thickR = 'border-right:3px solid #000;';
  const thinB  = 'border:1px solid #aaa;';

  function buildGrid(items: { label: string; amount: number }[], header: string): string {
    const { rowsPerPage: ROWS, pageCapacity: ITEMS_PER_PAGE, totalPages: totalPgs } = slipPagination(
      items.length,
      COLS,
      SLIP_PRINT_GRID_OPTS,
    );
    let html = '';
    for (let p = 0; p < totalPgs; p++) {
      const pageItems = items.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
      let headCells = '';
      for (let c = 0; c < COLS; c++) {
        const sepR = c < COLS - 1 ? thickR : '';
        headCells += `<th style="${thinB}background:#f0e68c;text-align:left;width:12.5%;">เลข</th>`;
        headCells += `<th style="${thinB}${sepR}background:#f0e68c;text-align:left;width:12.5%;">ราคา</th>`;
      }
      let bodyRows = '';
      for (let r = 0; r < ROWS; r++) {
        let cells = '';
        for (let c = 0; c < COLS; c++) {
          const item = pageItems[c * ROWS + r] ?? null;
          const sepR = c < COLS - 1 ? thickR : '';
          cells += `<td style="${thinB}white-space:nowrap;">${item ? `<span style="font-weight:700">${item.label}</span>` : ''}</td>`;
          cells += `<td style="${thinB}${sepR}text-align:right;">${item ? `<span style="font-weight:400">${item.amount.toLocaleString()}</span>` : ''}</td>`;
        }
        bodyRows += `<tr>${cells}</tr>`;
      }
      const pn = p + 1;
      const grand = items.reduce((s, i) => s + i.amount, 0);
      html += `<div class="print-sheet" style="font-size:14px;color:#000;">
        ${buildPrintSlipBrandStrip()}
        <div class="print-sheet-head">
          <span>${header}</span>
          <span>แผ่นที่ ${pn} · งวด ${roundName}</span>
        </div>
        <table class="print-slip-table" style="border:3px solid #000;">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot><tr>
            <td colspan="2" style="${thinB}background:#fffde7;border-top:3px solid #000;padding:4px 7px;font-weight:bold;">วันที่พิมพ์ ${printDate}</td>
            <td colspan="4" style="${thinB}background:#fffde7;border-top:3px solid #000;padding:4px 7px;text-align:center;font-weight:bold;">${pn}/${totalPgs}</td>
            <td colspan="2" style="${thinB}background:#fffde7;border-top:3px solid #000;padding:4px 7px;text-align:right;font-weight:bold;">ยอดรวม ${grand.toLocaleString()}</td>
          </tr></tfoot>
        </table>
      </div>`;
    }
    return html;
  }

  return batches
    .map((b) => {
      const prefix = BET_PREFIX[b.bet_type] ?? '';
      const label = BET_TYPE_LABELS[b.bet_type as BetType] ?? b.bet_type;
      const header = `รายการส่ง : ${b.dealer_name ?? '—'} — ${label}`;
      const items = b.items.map((i) => ({ label: `${prefix} ${i.number}`, amount: i.amount }));
      return buildGrid(items, header);
    })
    .join('');
}

// ─── Save & Dealer selection modal ───────────────────────────────────────────
function SaveDealerModal({
  dealers,
  activeBetType,
  initialDealerId,
  betTypeLabel,
  totalSend,
  cutItemsCount,
  saving,
  onClose,
  onConfirm,
}: {
  dealers: Dealer[];
  activeBetType: BetType;
  initialDealerId: string;
  betTypeLabel: string;
  totalSend: number;
  cutItemsCount: number;
  saving: boolean;
  onClose: () => void;
  onConfirm: (dealerId: string) => void;
}) {
  const firstActiveDealerId = dealers.find(d => d.is_active)?.id ?? '';
  const [dealerId, setDealerId] = useState(initialDealerId || firstActiveDealerId);

  useEffect(() => {
    setDealerId(initialDealerId || dealers.find(d => d.is_active)?.id || '');
  }, [initialDealerId, dealers]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)]  p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-md"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-bold text-theme-text-primary text-base">บันทึกส่ง</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">
              {betTypeLabel} · {cutItemsCount} รายการ · <span className="font-mono text-blue-400">{formatBaht(totalSend)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-secondary transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Dealer list */}
        <div className="px-5 py-4 space-y-2 max-h-72 overflow-auto">
          <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider mb-3">เลือกเจ้ามือ</p>

          {dealers.filter(d => d.is_active).map(dealer => {
            const rate = (dealer as any)[DEALER_RATE_KEYS[activeBetType]];
            const pct  = (dealer as any)[DEALER_PCT_KEYS[activeBetType]];
            return (
              <label key={dealer.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                dealer.id === dealerId ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-border'}`}>
                <input type="radio" className="accent-accent mt-0.5" checked={dealer.id === dealerId} onChange={() => setDealerId(dealer.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-theme-text-primary">{dealer.name}</p>
                  <div className="flex flex-wrap gap-4 mt-1 text-xs text-theme-text-muted">
                    <span>จ่าย: <span className="font-mono text-risk-medium">{rate ?? '—'}</span></span>
                    <span>ลด: <span className="font-mono text-theme-text-secondary">{pct ?? 0}%</span></span>
                    <span>เก็บสุทธิ: <span className="font-mono text-theme-text-secondary">{dealer.keep_net_pct}%</span></span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose}
            className="h-9 px-4 rounded-lg bg-surface-300 hover:bg-surface-200 text-sm text-theme-text-secondary transition-colors border border-border">
            ยกเลิก
          </button>
          <button onClick={() => onConfirm(dealerId)} disabled={saving || !dealerId}
            className="btn-primary-glow h-9 px-5 text-sm rounded-xl disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึกส่ง'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Sent batch detail modal ────────────────────────────────────────────────
function SendBatchItemsModal({
  batch,
  onClose,
}: {
  batch: SendBatch;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)]  p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.96, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.96, opacity: 0 }}
        className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-lg max-h-[78vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-theme-text-primary">เลขที่ส่งแล้ว</h3>
            <p className="text-[11px] text-theme-text-muted mt-0.5">
              {BET_TYPE_LABELS[batch.bet_type]} · {batch.dealer_name ?? '—'} · {formatBaht(batch.total)}
            </p>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-surface-200 text-theme-text-secondary hover:text-theme-text-primary transition-colors">✕</button>
        </div>

        <div className="flex-1 overflow-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-surface-200 border-b border-border">
              <tr>
                <th className="text-left py-2 px-3 text-theme-text-muted font-medium">เลข</th>
                <th className="text-right py-2 px-3 text-theme-text-muted font-medium">ยอดส่ง</th>
              </tr>
            </thead>
            <tbody>
              {batch.items
                .slice()
                .sort((a, b) => a.number.localeCompare(b.number, 'th', { numeric: true }))
                .map((it, idx) => (
                  <tr key={`${it.number}-${idx}`} className={`border-b border-border/30 ${idx % 2 === 1 ? 'bg-surface-200/30' : ''}`}>
                    <td className="py-1.5 px-3 font-mono font-bold tracking-widest text-theme-text-primary">{it.number}</td>
                    <td className="py-1.5 px-3 text-right font-mono text-accent-glow">{formatBaht(it.amount)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
function CutPageInner() {
  const searchParams = useSearchParams();

  // ── Round / dealers
  const [rounds, setRounds]                   = useState<Round[]>([]);
  const [dealers, setDealers]                 = useState<Dealer[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState(searchParams.get('round') ?? '');
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

  // ── Chart display
  const [chartHeight, setChartHeight]         = useState<number | null>(360);
  const [chartFullscreen, setChartFullscreen] = useState(false);
  const [chartSortMode, setChartSortMode]     = useState<ChartSortMode>('number_asc');

  // ── PDF
  const [pdfOpen, setPdfOpen]                 = useState(false);
  const [rangeTableOpen, setRangeTableOpen]   = useState(false);
  const [pendingRangeIdx, setPendingRangeIdx] = useState<number | null>(null);

  // ── Fetch
  const fetchAll = useCallback(async () => {
    const [rRes, dRes] = await Promise.all([roundsApi.list(), dealersApi.list()]);
    setRounds(rRes.data.rounds);
    setDealers(dRes.data.dealers);
    if (!selectedRoundId && rRes.data.rounds.length) {
      setSelectedRoundId(rRes.data.rounds[0].id);
    }
  }, [selectedRoundId]);

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
    } catch { setDealerName(null); setSelectedDealerId(''); setDealerParams(null); }
  }, [selectedRoundId]);

  const fetchRisk = useCallback(async () => {
    if (!selectedRoundId) return;
    try { const r = await cutApi.getRisk(selectedRoundId); setRisk(r.data); } catch { /* */ }
  }, [selectedRoundId]);

  const fetchSendBatches = useCallback(async () => {
    if (!selectedRoundId) { setSendBatches([]); return; }
    try {
      const res = await cutApi.listSendBatches(selectedRoundId);
      setSendBatches(res.data.batches ?? []);
    } catch { setSendBatches([]); }
  }, [selectedRoundId]);

  useEffect(() => { fetchAll(); }, []);
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
    } catch { /* ignore */ }
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
    } catch { setRangeResult(null); }
    finally { setRangeLoading(false); }
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
  const yScaleRef = useRef<{ scale: (v: number) => number; invert?: (px: number) => number } | null>(null);
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
    } catch {
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
      `<div class="print-root" style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;color:#000;">${html}</div>`,
      `พิมพ์รายการส่ง — ${r.name}`,
      `ส่ง_${r.name}`,
    );
  }, [sendBatches, selectedBatchIds, selectedRoundId, rounds]);

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
    } catch (err: any) {
      alert('บันทึกไม่สำเร็จ: ' + (err?.response?.data?.message ?? err?.message ?? 'error'));
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
    } catch { /* ignore */ }
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
        {/* ── Top control bar (ความสูงสม่ำเสมอ h-9) ── */}
        <div className="relative flex flex-wrap gap-x-3 gap-y-2 items-center px-5 py-2.5 border-b border-border bg-surface-100/80 min-w-0 max-w-full">
          {/* Round */}
          <div className="flex items-center gap-2 h-9 shrink-0">
            <label className="text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider whitespace-nowrap leading-none">งวด</label>
            <select value={selectedRoundId} onChange={(e) => setSelectedRoundId(e.target.value)}
              className="h-9 min-w-[9.5rem] rounded-lg bg-surface-200 border border-border px-2.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
              <option value="">-- เลือกงวด --</option>
              {rounds.filter(r => r.status !== 'archived').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          {/* Dealer */}
          <div className="flex items-center gap-2 h-9 shrink-0">
            <label className="text-[10px] font-semibold text-theme-text-muted uppercase tracking-wider whitespace-nowrap leading-none">เจ้ามือ</label>
            <select
              value={selectedDealerId || dealers.find(d => d.is_active)?.id || ''}
              onChange={(e) => handleDealerChange(e.target.value)}
              disabled={!selectedRoundId}
              className="h-9 min-w-[6.5rem] rounded-lg bg-surface-200 border border-border px-2.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] disabled:opacity-50">
              {dealers.filter(d => d.is_active).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>

          {/* Dealer rates — แถวเดียวสูงเท่าเมนู */}
          {selectedDealerId && dealerParams && (() => {
            const rate = dealerParams.rates[activeBetType];
            const pct  = dealerParams.commissions[activeBetType];
            return rate != null ? (
              <div className="flex h-9 items-center gap-2 px-3 rounded-lg bg-surface-50 border border-[var(--color-border)] shrink-0">
                <span className="text-[10px] font-medium text-risk-medium/85 whitespace-nowrap leading-none">อัตราจ่าย / %ลด</span>
                <span className="text-sm font-mono font-bold text-risk-medium tabular-nums">{rate}</span>
                <span className="text-theme-text-muted text-xs">/</span>
                <span className="text-sm font-mono text-theme-text-secondary tabular-nums">{pct ?? 0}%</span>
              </div>
            ) : null;
          })()}

          {/* Bet type tabs */}
          <div className="flex min-h-9 items-center gap-0.5 flex-wrap sm:flex-nowrap rounded-xl border border-border bg-surface-200/50 px-0.5 py-0.5 min-w-0 flex-1 sm:flex-initial">
            {BET_TYPE_ORDER.map(bt => (
              <button key={bt} type="button" onClick={() => setActiveBetType(bt)}
                className={`h-8 shrink-0 px-2.5 rounded-xl text-xs font-semibold transition-all duration-theme ${
                  bt === activeBetType
                    ? 'btn-primary-glow'
                    : 'text-theme-text-secondary border border-transparent bg-transparent hover:text-theme-text-primary hover:bg-[var(--bg-glass-strong)] hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)] hover:border-[var(--color-border-strong)] active:translate-y-0'
                }`}>
                <span className="inline-flex items-center gap-1.5">
                  {BET_TYPE_SHORT[bt]}
                  {sentBetTypeSet.has(bt) && (
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${bt === activeBetType ? 'bg-white/95 shadow-[0_0_8px_rgba(255,255,255,0.45)]' : 'bg-profit'} shadow-[0_0_8px_rgba(74,222,128,0.9)]`} title="มีประวัติส่งแล้ว" />
                  )}
                </span>
              </button>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto shrink-0">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              disabled={!rangeResult?.rows.length}
              className="btn-toolbar-glow btn-fintech-search h-9 min-w-[9rem] px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
              🔍 ค้นหายอดตัด
            </button>
            <button
              type="button"
              onClick={() => setSmartCutOpen(true)}
              disabled={!rangeResult?.rows.length}
              className="btn-toolbar-glow btn-fintech-spark h-9 min-w-[7.5rem] px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
              ✨ ตัดอัจฉริยะ
            </button>
            <button
              type="button"
              onClick={() => { setRangeTableOpen(true); setPendingRangeIdx(selectedRowIdx); }}
              disabled={!rangeResult?.rows.length}
              className="btn-toolbar-glow btn-fintech-range h-9 min-w-[8.5rem] px-3 text-xs disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap">
              📊 กำหนดเป็นช่วง
            </button>
          </div>
        </div>

        {/* ── Main body: ซ้าย = กราฟ / ขวา = รายการส่ง (ลากขอบปรับความกว้างได้บนจอใหญ่) ── */}
        <div
          ref={splitLayoutRef}
          className={cn(
            'flex-1 flex flex-col min-h-0 min-w-0 w-full max-w-full overflow-hidden',
            sideBySideLayout && 'flex-row',
          )}
        >

          {/* LEFT: Chart + table — เลื่อนแนวตั้งที่คอลัมน์; เลื่อนแนวนอนเฉพาะในกราฟ (ไม่ให้การ์ดสถิติยืดตามความกว้างกราฟ) */}
          <div className="relative flex flex-col min-w-0 min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-4 gap-4">
            {/* Committed threshold info banner */}
            {committedThreshold != null && (
              <div className="flex items-center gap-2 bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2 text-xs shrink-0">
                <span className="text-loss">🔒</span>
                <span className="text-theme-text-secondary">
                  ส่งแล้วที่{' '}
                  <span className="font-mono text-risk-medium font-bold">
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
                  <span className="text-sm font-mono font-semibold text-profit">{rangeResult ? formatBaht(rangeResult.total_revenue) : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดตัด</span>
                  <span className="text-sm font-mono text-blue-400">{formatBaht(totalSend + totalAlreadySent)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">คงเหลือ</span>
                  <span className="text-sm font-mono text-theme-text-primary">{formatBaht(totalRevenue - totalSend - totalAlreadySent)}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">เก็บตัวละ</span>
                  <span className="text-sm font-mono font-bold text-risk-medium">{rangeResult ? formatBaht(activeThreshold) : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">% ได้</span>
                  <span className="text-sm font-mono font-semibold text-profit">{s ? `${s.pct_win.toFixed(1)}%` : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">% เสีย</span>
                  <span className="text-sm font-mono font-semibold text-loss">{s ? `${s.pct_lose.toFixed(1)}%` : '—'}</span>
                </div>
              </div>

              <div className="bg-surface-200 rounded-lg border border-border/30 px-2.5 py-2">
                <div className="text-xs font-bold tracking-wide text-theme-text-primary mb-2 pb-1.5 border-b border-border/50">สถานะเลข</div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">เลขยอดเกิน</span>
                  <span className="text-sm font-mono text-loss">{s ? `${overThresholdNumbers.toLocaleString('th-TH')} เลข` : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">เลขยอดไม่เกิน</span>
                  <span className="text-sm font-mono text-theme-text-secondary">{rangeResult ? `${underThresholdNumbers.toLocaleString('th-TH')} เลข` : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">เลขไม่ได้ขาย</span>
                  <span className="text-sm font-mono text-theme-text-secondary">{`${unsoldNumbers.toLocaleString('th-TH')} เลข`}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">จำนวนเลขที่ส่งแล้ว</span>
                  <span className="text-sm font-mono text-accent-glow">{`${sentNumbers.toLocaleString('th-TH')} เลข`}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">สูงสุดต่อเลข</span>
                  <span className="text-sm font-mono text-risk-medium">{rangeResult ? formatBaht(rangeResult.max_single_bet) : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">ต่ำสุดต่อเลข</span>
                  <span className="text-sm font-mono text-theme-text-secondary">{rangeResult ? formatBaht(minSingleBet) : '—'}</span>
                </div>
              </div>

              <div className="bg-surface-200 rounded-lg border border-border/30 px-2.5 py-2">
                <div className="text-xs font-bold tracking-wide text-theme-text-primary mb-2 pb-1.5 border-b border-border/50">ผลได้เสีย</div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดได้สูงสุด</span>
                  <span className="text-sm font-mono text-profit">{s ? formatBaht(s.max_gain) : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดเสียสูงสุด</span>
                  <span className={`text-sm font-mono ${s?.max_loss != null ? 'text-loss' : 'text-profit'}`}>
                    {s ? (s.max_loss != null ? formatBaht(s.max_loss) : 'ไม่เสีย') : '—'}
                  </span>
                </div>
                <div className="flex items-center justify-between py-1 border-b border-border/30">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดได้ต่ำสุด</span>
                  <span className="text-sm font-mono text-profit">{s && s.min_gain != null ? formatBaht(s.min_gain) : '—'}</span>
                </div>
                <div className="flex items-center justify-between py-1">
                  <span className="text-xs sm:text-sm text-theme-text-secondary">ยอดเสียต่ำสุด</span>
                  <span className="text-sm font-mono text-loss">{s && s.min_loss != null ? formatBaht(s.min_loss) : '—'}</span>
                </div>
              </div>
            </div>

            {/* CHART */}
            {rangeResult && chartData.length > 0 ? (
              <Card className="p-0 overflow-hidden flex-shrink-0 min-w-0 max-w-full">
              {/* eslint-disable-next-line react-hooks/exhaustive-deps */}
              {/* derive default height based on bet type */}
                <div className="px-4 pt-3 pb-1 flex flex-col gap-2 min-w-0 max-w-full">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{BET_TYPE_LABELS[activeBetType]} — การกระจายยอดแทง</CardTitle>
                    {activeThreshold > 0 && (
                      <span className="text-xs bg-risk-medium/15 text-risk-medium border border-risk-medium/40/30 rounded px-2 py-0.5 font-mono">
                        ขีด {formatBaht(activeThreshold)} บ/เลข
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-theme-text-muted">
                    {chartHasKeptSegment && (
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-neutral inline-block"/>เก็บ</span>
                    )}
                    {totalAlreadySent > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-sent)] inline-block"/>ส่งแล้ว</span>}
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-new)] inline-block"/>ตัดเพิ่ม</span>
                    {activeThreshold === 0 && <span className="italic hidden sm:inline text-profit/90">เก็บ 0 = ส่งเจ้าหมด (ยกเว้นเลขปิดรับ)</span>}
                    <span className="flex items-center gap-0.5 border-l border-border/50 pl-2 ml-0.5">
                      <button
                        onClick={() => setChartSortMode('amount_desc')}
                        className={`h-6 px-2 rounded text-[10px] font-semibold transition-colors ${
                          chartSortMode === 'amount_desc' ? 'bg-accent/30 text-accent' : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-surface-200'
                        }`}
                        title="เรียงตามยอดมากไปน้อย"
                      >
                        ยอดมาก→น้อย
                      </button>
                      <button
                        onClick={() => setChartSortMode('number_asc')}
                        className={`h-6 px-2 rounded text-[10px] font-semibold transition-colors ${
                          chartSortMode === 'number_asc' ? 'bg-accent/30 text-accent' : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-surface-200'
                        }`}
                        title="เรียงตามเลข 00-99 / 000-999"
                      >
                        เรียงตามเลข
                      </button>
                    </span>
                    {/* Zoom size buttons */}
                    {(() => { const eff = chartHeight ?? 360; return (
                    <span className="flex items-center gap-0.5 border-l border-border/50 pl-2 ml-0.5">
                      {([180, 260, 360, 480] as const).map(h => (
                        <button key={h} onClick={() => setChartHeight(h)}
                          className={`w-6 h-6 rounded text-[9px] font-bold transition-colors ${
                            eff === h ? 'bg-accent/30 text-accent' : 'hover:bg-surface-200 text-theme-text-muted'
                          }`}>
                          {h === 180 ? 'S' : h === 260 ? 'M' : h === 360 ? 'L' : 'XL'}
                        </button>
                      ))}
                    </span>
                    ); })()}
                    {/* Fullscreen button */}
                    <button onClick={() => setChartFullscreen(true)} title="ขยายเต็มจอ"
                      className="w-6 h-6 rounded hover:bg-surface-200 text-theme-text-secondary hover:text-theme-text-primary transition-colors flex items-center justify-center">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
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
                      value={manualThreshold !== null ? manualThreshold : activeThreshold}
                      placeholder="0"
                      onChange={(e) => {
                        const raw = e.target.value.trim();
                        if (raw === '') {
                          setManualThreshold(null);
                          setSelectedRowIdx(null);
                          return;
                        }
                        const v = parseInt(raw.replace(/\D/g, ''), 10);
                        if (Number.isNaN(v)) return;
                        const clamped = committedThreshold != null ? Math.min(v, committedThreshold) : v;
                        setManualThreshold(clamped);
                        if (rangeResult) {
                          const idx = rangeResult.rows.findIndex(r => r.threshold >= clamped);
                          setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
                        }
                      }}
                      onFocus={(e) => e.currentTarget.select()}
                      className="w-24 h-7 rounded bg-surface-default border border-border px-2 text-sm text-risk-medium font-mono text-right focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                    />
                  </div>
                  <span className="text-[10px] text-theme-text-muted shrink-0 order-3 max-sm:w-full max-sm:pl-0.5">
                    ซ้าย: ไม่ตัด · ขวา: ตัดมากขึ้น
                  </span>
                  {manualThreshold !== null && (
                    <button
                      type="button"
                      onClick={() => { setManualThreshold(null); setSelectedRowIdx(null); }}
                      className="text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors shrink-0 order-4"
                    >
                      รีเซ็ต
                    </button>
                  )}
                </div>
                </div>
                {/* Clickable chart area */}
                <div ref={chartContainerRef} className="cursor-crosshair overflow-x-auto w-full max-w-full min-w-0" onClick={handleChartAreaClick}>
                  {(() => {
                    const eff = chartHeight ?? 360;
                    const dense = chartData.length > 200;
                    const minW = chartData.length > 60 ? chartData.length * (dense ? 10 : 14) : undefined;
                    /** 0 = แสดงป้ายเลขทุกแท่ง (ตรงโปรแกรมอ้างอิง) */
                    const xAxisInterval = 0;
                    const barMax = dense ? 8 : 14;
                    const bottomMarg = chartData.length > 200 ? 52 : chartData.length > 80 ? 42 : 34;
                    return (
                  <ResponsiveContainer width={minW ? Math.max(minW, 300) : '100%'} height={eff}>
                    <BarChart
                      data={chartData}
                      margin={{ top: 4, right: 16, left: 8, bottom: bottomMarg }}
                      barCategoryGap={dense ? '2%' : '4%'}
                      onClick={handleChartClick}
                    >
                      <CartesianGrid strokeDasharray="2 2" stroke="rgba(148,163,184,0.18)" vertical={false} />
                      <XAxis
                        dataKey="number"
                        tick={<NumberTick />}
                        axisLine={{ stroke: 'var(--chart-axis-line)' }}
                        tickLine={false}
                        interval={xAxisInterval}
                        tickMargin={8}
                        height={chartData.length > 200 ? 48 : 38}
                      />
                      <YAxis
                        width={72}
                        tickCount={9}
                        tick={{ fontSize: 12, fill: 'var(--chart-tick-label)' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                      />
                      <Tooltip content={<BarTooltip threshold={activeThreshold} />} cursor={{ fill: 'rgba(255,255,255,0.06)', cursor: 'crosshair' }} />
                      {chartHasKeptSegment && (
                      <Bar dataKey="kept"    name="เก็บ"    stackId="a" maxBarSize={barMax} fill="var(--chart-bar-kept)" radius={[0,0,0,0]}>
                        {chartData.map((entry, i) => (
                          <Cell key={`k-${entry.number}-${i}`} fill={entry.kept > 0 ? 'var(--chart-bar-kept)' : 'transparent'} />
                        ))}
                      </Bar>
                      )}
                      <Bar dataKey="sentCut" name="ส่งแล้ว" stackId="a" maxBarSize={barMax} fill="var(--chart-bar-sent)" radius={[0,0,0,0]} />
                      <Bar dataKey="newCut"  name="ตัดเพิ่ม"  stackId="a" maxBarSize={barMax} fill="var(--chart-bar-new)" radius={[2,2,0,0]} />
                      <Customized component={(props: any) => (
                        <ScaleCaptureCustomized {...props} onCapture={(scale, top) => {
                          yScaleRef.current = scale;
                          yAxisOffsetRef.current = { top };
                        }} />
                      )} />
                      {activeThreshold > 0 && (
                        <Customized component={(props: any) => (
                          <ChartRefLine {...props} threshold={activeThreshold} stroke="var(--chart-threshold)" labelText={`เก็บ ${formatBaht(activeThreshold)}`} />
                        )} />
                      )}
                      {committedThreshold != null && committedThreshold !== activeThreshold && (
                        <Customized component={(props: any) => (
                          <ChartRefLine {...props} threshold={committedThreshold} stroke="var(--chart-commit)" labelText={`ส่งแล้ว ${committedThreshold > 0 ? formatBaht(committedThreshold) : '0'}`} strokeDasharray="4 2" strokeWidth={1.5} />
                        )} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                  );
                  })()}
                </div>
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
                    ค้างส่ง <span className="font-mono font-bold text-blue-400 tabular-nums">{formatBaht(totalSend)}</span>
                  </span>
                  <span className="text-theme-text-muted">·</span>
                  <span className="text-theme-text-muted">
                    เก็บ <span className="font-mono font-semibold text-risk-medium tabular-nums">{formatBaht(activeThreshold)}</span> บ/เลข
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
                      onClick={() => {
                        if (!confirm('ล้างรายการที่บันทึกรอส่งทั้งหมด?')) return;
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

          {/* RIGHT: รายการส่ง + รายการรอส่ง (โครงคล้ายโปรแกรมอ้างอิง) */}
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
              <div className="flex flex-col min-h-0 flex-[1.2] rounded-card border border-theme-card-border bg-[var(--bg-glass-subtle)] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="shrink-0 flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-border/60 bg-surface-200/20">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-sm font-bold text-theme-text-primary tracking-tight">รายการส่ง</span>
                    <span className="text-[10px] text-theme-text-muted">
                      ({sendBatches.length} ชุด)
                      {selectedBatchIds.size > 0 && (
                        <span className="text-accent ml-1">· เลือก {selectedBatchIds.size}</span>
                      )}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px]">
                    {sendBatches.length > 0 && (
                      <span className="text-theme-text-muted tabular-nums">
                        รวม <span className="font-mono font-semibold text-blue-400">{formatBaht(totalSentAllBatches)}</span>
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
                          <th className="py-2 px-1.5 w-7 text-center">
                            <input
                              type="checkbox"
                              className="accent-accent"
                              checked={sendBatches.length > 0 && selectedBatchIds.size === sendBatches.length}
                              onChange={(e) =>
                                setSelectedBatchIds(e.target.checked ? new Set(sendBatches.map((b) => b.id)) : new Set())
                              }
                            />
                          </th>
                          <th className="text-left py-2 px-1.5 text-theme-text-muted font-semibold w-8">ชุด</th>
                          <th className="text-left py-2 px-1.5 text-theme-text-muted font-semibold">ประเภท</th>
                          <th className="text-left py-2 px-1.5 text-theme-text-muted font-semibold">ส่ง</th>
                          <th className="text-right py-2 px-1.5 text-theme-text-muted font-semibold whitespace-nowrap">จำนวนเงิน</th>
                          <th className="text-right py-2 px-1.5 text-theme-text-muted font-semibold whitespace-nowrap">ผลตอบแทน</th>
                          <th className="text-right py-2 px-1.5 text-theme-text-muted font-semibold whitespace-nowrap">วันที่ส่ง</th>
                          <th className="text-center py-2 px-1 w-8 text-theme-text-muted font-semibold">ดู</th>
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
                            <td className="py-1.5 px-1.5 text-center" onClick={(e) => e.stopPropagation()}>
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
                            <td className="py-1.5 px-1.5 font-mono text-theme-text-secondary text-center">{i + 1}</td>
                            <td className="py-1.5 px-1.5 text-theme-text-secondary leading-tight">
                              {BET_TYPE_LABELS[b.bet_type as BetType] ?? b.bet_type}
                            </td>
                            <td className="py-1.5 px-1.5 text-theme-text-primary font-medium leading-tight">
                              {b.dealer_name ?? <span className="text-theme-text-muted italic">—</span>}
                            </td>
                            <td className="py-1.5 px-1.5 font-mono text-blue-400 text-right font-semibold tabular-nums">
                              {formatBaht(b.total)}
                            </td>
                            <td className="py-1.5 px-1.5 font-mono text-theme-text-muted text-right tabular-nums">—</td>
                            <td className="py-1.5 px-1.5 text-theme-text-muted text-right whitespace-nowrap">
                              {new Date(b.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' })}
                            </td>
                            <td className="py-1.5 px-0.5 text-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setViewBatch(b);
                                }}
                                className="text-theme-text-muted hover:text-profit transition-colors text-[11px]"
                                title="ดูเลขที่ส่งแล้ว">
                                👁
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
                </div>
              </div>

              {/* ── รายการรอส่ง ── */}
              <div className="flex flex-col min-h-0 flex-[0.9] rounded-card border border-theme-card-border bg-[var(--bg-glass-subtle)] overflow-hidden shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                <div className="shrink-0 px-3 py-2 border-b border-border/60 bg-surface-200/20">
                  <span className="text-sm font-bold text-theme-text-primary tracking-tight">รายการรอส่ง</span>
                  {pendingQueueRows.length > 0 && (
                    <span className="text-[10px] text-theme-text-muted ml-2">({pendingQueueRows.length} แถว)</span>
                  )}
                </div>

                <div className="flex-1 min-h-[100px] overflow-auto bg-surface-200/5">
                  {pendingQueueRows.length > 0 ? (
                    <table className="w-full text-xs sm:text-sm tabular-nums">
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
                          <tr key={row.key} className={`border-b border-[var(--color-border)] ${idx % 2 === 0 ? 'bg-surface-50' : 'bg-white'}`}>
                            <td className="py-1.5 px-2 font-mono text-theme-text-muted">{idx + 1}</td>
                            <td className="py-1.5 px-2 text-theme-text-secondary">{row.typeLabel}</td>
                            <td className="py-1.5 px-2 font-mono text-theme-text-primary text-center tracking-wide font-semibold">{row.number}</td>
                            <td className="py-1.5 px-2 font-mono text-theme-text-primary text-right tabular-nums font-semibold">{formatBaht(row.amount)}</td>
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
                    onClick={() => {
                      if (!confirm('ลบข้อมูลรอส่งและรีเซ็ตการตัดบนกราฟ?')) return;
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
                    onClick={() => {
                      if (!stagedCuts.length) return;
                      if (!confirm('ยกเลิกรายการที่บันทึกรอส่ง (คิว) เท่านั้น?')) return;
                      setStagedCuts([]);
                    }}>
                    ยกเลิกการรอส่ง
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Smart Cut dialog */}
      <AnimatePresence>
        {smartCutOpen && rangeResult && (
          <SmartCutDialog
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
          <SearchDialog
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
          <PdfDialog
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
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-[96vw] flex flex-col overflow-hidden"
              style={{ height: '90vh' }}
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
                <span className="font-semibold text-theme-text-primary text-sm">{BET_TYPE_LABELS[activeBetType]} — การกระจายยอดแทง (เต็มจอ)</span>
                <div className="flex items-center gap-3 text-xs">
                  {activeThreshold > 0 && (
                    <span className="bg-risk-medium/15 text-risk-medium border border-risk-medium/40/30 rounded px-2 py-0.5 font-mono">
                      ขีด {formatBaht(activeThreshold)} บ/เลข
                    </span>
                  )}
                  <button onClick={() => setChartFullscreen(false)}
                    className="text-theme-text-secondary hover:text-theme-text-primary transition-colors text-xl leading-none ml-2">✕</button>
                </div>
              </div>
              {/* Chart */}
              <div className="flex-1 min-h-0 p-4 overflow-x-auto">
                {(() => {
                  const fsDense = chartData.length > 200;
                  const fsMinW = chartData.length > 60 ? chartData.length * (fsDense ? 10 : 14) : undefined;
                  const fsXInt = 0;
                  const fsBarMax = fsDense ? 8 : 16;
                  const fsBot = chartData.length > 200 ? 56 : 44;
                  return (
                <ResponsiveContainer width={fsMinW ? Math.max(fsMinW, 400) : '100%'} height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 24, left: 12, bottom: fsBot }} barCategoryGap={fsDense ? '2%' : '3%'}>
                    <CartesianGrid strokeDasharray="2 2" stroke="rgba(148,163,184,0.18)" vertical={false} />
                    <XAxis dataKey="number" tick={<NumberTick />} axisLine={{ stroke: 'var(--chart-axis-line)' }} tickLine={false} interval={fsXInt} tickMargin={8} height={chartData.length > 200 ? 48 : 42} />
                    <YAxis width={76} tickCount={12} tick={{ fontSize: 13, fill: 'var(--chart-tick-label)' }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
                    <Tooltip content={<BarTooltip threshold={activeThreshold} />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
                    {activeThreshold > 0 && (
                      <ReferenceLine y={activeThreshold} stroke="var(--chart-threshold)" strokeDasharray="6 3" strokeWidth={2}
                        label={{ value: `เก็บ ${formatBaht(activeThreshold)}`, position: 'insideTopLeft', fill: 'var(--chart-threshold)', fontSize: 11 }} />
                    )}
                    {committedThreshold != null && committedThreshold !== activeThreshold && (
                      <ReferenceLine y={committedThreshold} stroke="var(--chart-commit)" strokeDasharray="4 2" strokeWidth={1.5}
                        label={{ value: `ส่งแล้ว ${committedThreshold > 0 ? formatBaht(committedThreshold) : '0'}`, position: 'insideTopRight', fill: 'var(--chart-commit)', fontSize: 10 }} />
                    )}
                    {chartHasKeptSegment && (
                    <Bar dataKey="kept"    name="เก็บ"    stackId="a" maxBarSize={fsBarMax} fill="var(--chart-bar-kept)" radius={[0,0,0,0]}>
                      {chartData.map((entry, i) => (
                        <Cell key={`fs-k-${entry.number}-${i}`} fill={entry.kept > 0 ? 'var(--chart-bar-kept)' : 'transparent'} />
                      ))}
                    </Bar>
                    )}
                    <Bar dataKey="sentCut" name="ส่งแล้ว" stackId="a" maxBarSize={fsBarMax} fill="var(--chart-bar-sent)" radius={[0,0,0,0]} />
                    <Bar dataKey="newCut"  name="ตัดเพิ่ม"  stackId="a" maxBarSize={fsBarMax} fill="var(--chart-bar-new)" radius={[2,2,0,0]} />
                    {activeThreshold > 0 && (
                      <Customized component={(props: any) => (
                        <ChartRefLine {...props} threshold={activeThreshold} stroke="var(--chart-threshold)" labelText={`เก็บ ${formatBaht(activeThreshold)}`} />
                      )} />
                    )}
                    {committedThreshold != null && committedThreshold !== activeThreshold && (
                      <Customized component={(props: any) => (
                        <ChartRefLine {...props} threshold={committedThreshold} stroke="var(--chart-commit)" labelText={`ส่งแล้ว ${committedThreshold > 0 ? formatBaht(committedThreshold) : '0'}`} strokeDasharray="4 2" strokeWidth={1.5} />
                      )} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
                  );
                })()}
              </div>
              {/* Footer legend */}
              <div className="px-5 py-2 border-t border-border flex items-center gap-4 text-xs text-theme-text-muted shrink-0">
                {chartHasKeptSegment && (
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-neutral inline-block"/>เก็บ</span>
                )}
                {totalAlreadySent > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-sent)] inline-block"/>ส่งแล้ว</span>}
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-[var(--chart-bar-new)] inline-block"/>ตัดเพิ่ม</span>
                <span className="ml-auto text-[10px] text-theme-text-muted">คลิกพื้นที่ด้านนอกเพื่อปิด</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Range table dialog */}
      <AnimatePresence>
        {rangeTableOpen && rangeResult && rangeResult.rows.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-backdrop-overlay)]">
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="w-full max-w-5xl max-h-[90vh] flex flex-col overflow-hidden rounded-2xl border border-theme-card-border bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-hover)]"
              onClick={e => e.stopPropagation()}>
              <div className="px-4 py-3.5 border-b border-[var(--color-border)] flex items-center justify-between shrink-0 bg-[var(--color-card-bg-solid)]">
                <div className="flex items-center gap-3 flex-wrap min-w-0">
                  <span className="text-sm font-semibold text-theme-text-primary tracking-tight">กำหนดช่วง</span>
                  <span className="text-xs text-theme-text-secondary whitespace-nowrap">เปอร์เซ็นต์</span>
                  <span className="text-[11px] font-semibold tabular-nums text-[#0b1c3f] dark:text-[#e8d79a] whitespace-nowrap rounded-md bg-[#d4af37]/15 dark:bg-[#d4af37]/20 px-2 py-0.5 border border-[#d4af37]/35">
                    ใช้ {stepPct}%
                  </span>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {STEP_OPTIONS.map((v) => {
                      const active = Math.abs(v - stepPct) < 1e-6;
                      return (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setStepPct(v)}
                          aria-pressed={active}
                          title={active ? `กำลังใช้ขั้น ${v}%` : `ใช้ขั้น ${v}%`}
                          className={`h-7 min-w-[3.35rem] px-2 rounded-xl text-xs font-semibold transition-all inline-flex items-center justify-center gap-1 ${
                            active
                              ? 'bg-[#0b1c3f] text-[#f5ebd3] border-2 border-[#d4af37] shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
                              : 'bg-[var(--color-input-bg)] text-theme-text-secondary border border-[var(--color-border)] hover:bg-[var(--bg-hover)] hover:border-[var(--color-border-strong)]'
                          }`}>
                          {active ? (
                            <span className="text-[#d4af37] font-bold leading-none select-none" aria-hidden>✓</span>
                          ) : null}
                          <span className="tabular-nums">{v}%</span>
                        </button>
                      );
                    })}
                    {rangeLoading && <span className="text-[10px] text-theme-text-muted animate-pulse ml-1">คำนวณ…</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {pendingRangeIdx !== null && (
                    <button type="button" onClick={() => setPendingRangeIdx(null)}
                      className="text-xs text-theme-text-muted hover:text-theme-text-secondary transition-colors px-2 py-1 rounded-lg hover:bg-[var(--bg-hover)]">ล้าง ×</button>
                  )}
                  <button type="button" onClick={() => setRangeTableOpen(false)}
                    className="w-8 h-8 flex items-center justify-center rounded-xl border border-[var(--color-border)] bg-white text-theme-text-secondary hover:text-theme-text-primary hover:bg-[var(--bg-hover)] transition-colors">✕</button>
                </div>
              </div>
              <div ref={tableBodyRef} className="overflow-auto flex-1 min-h-0 bg-[var(--color-bg-primary)]">
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="sticky top-0 z-10 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)]">
                    <tr>
                      {[
                        'ลำดับ',
                        `${Number.isInteger(stepPct) ? String(stepPct) : stepPct}%`,
                        'จำนวนเก็บ (บาท)',
                        'ยอดได้สูงสุด',
                        'ยอดได้ต่ำสุด',
                        'ยอดเสียสูงสุด',
                        'ยอดเสียต่ำสุด',
                        'ยอดได้เฉลี่ย',
                        'ยอดเสียเฉลี่ย',
                        '% ได้',
                        '% เสีย',
                      ].map((h) => (
                        <th key={h} className="py-2.5 px-2.5 text-left text-theme-text-secondary font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rangeResult.rows.map((row, i) => (
                      <tr key={i} data-row={i}
                        onClick={() => setPendingRangeIdx(i === pendingRangeIdx ? null : i)}
                        className={`border-b border-[var(--color-border)] cursor-pointer transition-colors ${
                          i === pendingRangeIdx
                            ? 'bg-[var(--color-nav-active-bg)] border-l-2 border-l-[#111111]'
                            : 'hover:bg-[var(--bg-hover)]'}`}>
                        <td className="py-1.5 px-2.5 text-theme-text-secondary">{row.row}</td>
                        <td className="py-1.5 px-2.5 font-mono text-theme-text-secondary tabular-nums">{row.threshold_pct.toFixed(2)}</td>
                        <td className="py-1.5 px-2.5 font-mono text-risk-medium font-semibold tabular-nums">{formatBaht(row.threshold)}</td>
                        <td className="py-1.5 px-2.5 font-mono text-profit font-semibold">{formatBaht(row.max_gain)}</td>
                        <td className="py-1.5 px-2.5 font-mono text-profit">{row.min_gain != null ? formatBaht(row.min_gain) : '—'}</td>
                        <td className="py-1.5 px-2.5 font-mono text-loss font-semibold">{row.max_loss != null ? formatBaht(row.max_loss) : <span className="text-profit text-[10px]">ไม่เสีย</span>}</td>
                        <td className="py-1.5 px-2.5 font-mono text-loss">{row.min_loss != null ? formatBaht(row.min_loss) : '—'}</td>
                        <td className="py-1.5 px-2.5 font-mono text-theme-text-secondary">{row.avg_gain != null ? formatBaht(row.avg_gain) : '—'}</td>
                        <td className="py-1.5 px-2.5 font-mono text-theme-text-secondary">{row.avg_loss != null ? formatBaht(row.avg_loss) : '—'}</td>
                        <td className={`py-1.5 px-2.5 font-mono font-semibold ${row.pct_win >= 70 ? 'text-profit' : row.pct_win >= 50 ? 'text-risk-medium' : 'text-theme-text-secondary'}`}>{row.pct_win.toFixed(1)}</td>
                        <td className={`py-1.5 px-2.5 font-mono font-semibold ${row.pct_lose > 30 ? 'text-loss' : row.pct_lose > 0 ? 'text-risk-medium' : 'text-theme-text-muted'}`}>{row.pct_lose.toFixed(1)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Footer */}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-[var(--color-border)] shrink-0 bg-[var(--color-card-bg-solid)]">
                <div className="text-xs text-theme-text-muted max-w-[min(100%,28rem)] leading-relaxed space-y-1">
                  {committedThreshold != null && (
                    <p className="text-[11px] text-amber-800 dark:text-amber-400/95">
                      มีรายการส่งแล้ว: เก็บได้ไม่เกิน <span className="font-mono font-semibold">{formatBaht(committedThreshold)}</span> บ/เลข — เลือกเกินจะถูกปรับลงให้ตรงเส้นส่งแล้ว
                    </p>
                  )}
                  <p>
                  {pendingRangeIdx !== null
                    ? <>เลือกเก็บ <span className="font-mono text-theme-text-primary font-semibold">{rangeResult.rows[pendingRangeIdx]?.threshold > 0 ? formatBaht(rangeResult.rows[pendingRangeIdx].threshold) : '0'}</span> บ/เลข · ลำดับ {rangeResult.rows[pendingRangeIdx]?.row} · นำ {rangeResult.rows[pendingRangeIdx]?.threshold_pct.toFixed(2)}%</>
                    : 'คลิกแถวเพื่อเลือกช่วง — คอลัมน์จำนวนเก็บคือยอดเงินที่เก็บต่อเลข (บาท)'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button type="button"
                    onClick={() => setRangeTableOpen(false)}
                    className="btn-toolbar-glow btn-toolbar-muted !h-9 px-4 text-sm rounded-xl">
                    ยกเลิก
                  </button>
                  <button type="button"
                    disabled={pendingRangeIdx === null}
                    onClick={() => {
                      if (pendingRangeIdx === null) return;
                      const row = rangeResult.rows[pendingRangeIdx];
                      const newT = row.threshold;
                      const clamped = committedThreshold != null ? Math.min(newT, committedThreshold) : newT;
                      setManualThreshold(clamped);
                      setSelectedRowIdx(pendingRangeIdx);
                      setRangeTableOpen(false);
                      setTimeout(() => {
                        tableBodyRef.current?.querySelector(`[data-row="${pendingRangeIdx}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                      }, 80);
                    }}
                    className="btn-toolbar-glow btn-fintech-search !h-9 px-5 text-sm rounded-xl disabled:opacity-40 disabled:cursor-not-allowed">
                    ✓ ตกลง
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
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
