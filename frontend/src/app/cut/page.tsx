'use client';
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
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
import { formatBaht } from '@/lib/utils';
import { openPrintPreview } from '@/lib/printPreview';
import {
  Round, BetType, BET_TYPE_LABELS, Dealer,
  RangeSimResponse, RangeSimRow, RiskReport, SendBatch,
} from '@/types';

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
const STEP_OPTIONS = [2.5, 5];

// ─── Chart types ─────────────────────────────────────────────────────────────
interface ChartBar {
  number: string;
  kept: number;
  sentCut: number;  // already committed cut (blue)
  newCut: number;   // new incremental cut (gray)
  cut: number;      // total cut = sentCut + newCut
  total: number;
}

// ─── Custom X-axis tick: vertical (rotated -90°) ───────────────────────────────
function NumberTick({ x, y, payload }: { x?: number; y?: number; payload?: { value: string } }) {
  const cx = x ?? 0;
  const cy = (y ?? 0) + 4;
  return (
    <text
      x={cx} y={cy}
      textAnchor="start"
      dominantBaseline="central"
      fontSize={8}
      fill="#64748b"
      fontFamily="monospace"
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
    <div className="bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-xs shadow-2xl min-w-[130px]">
      <p className="font-mono font-bold text-white text-sm mb-2 tracking-widest">{d.number}</p>
      <div className="space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-slate-400">ยอดรวม</span>
          <span className="font-mono text-slate-200">{formatBaht(d.total)}</span>
        </div>
        {threshold > 0 && (
          <>
            <div className="flex justify-between gap-4">
              <span className="text-amber-400">เก็บ</span>
              <span className="font-mono text-amber-300">{formatBaht(d.kept)}</span>
            </div>
            {d.sentCut > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-blue-400">ส่งแล้ว</span>
                <span className="font-mono text-blue-300">{formatBaht(d.sentCut)}</span>
              </div>
            )}
            {d.newCut > 0 && (
              <div className="flex justify-between gap-4">
                <span className="text-slate-400">ตัดเพิ่ม</span>
                <span className="font-mono text-slate-300">{formatBaht(d.newCut)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Custom reference line — rendered on top of bars via <Customized> ──────────
function ChartRefLine({
  threshold, stroke, labelText, strokeDasharray = '6 3', strokeWidth = 2,
  yAxisMap, xAxisMap, ..._
}: { threshold: number; stroke: string; labelText?: string; strokeDasharray?: string; strokeWidth?: number; yAxisMap?: any; xAxisMap?: any; [k: string]: any }) {
  if (!threshold || !yAxisMap || !xAxisMap) return null;
  const yAxis = (Object.values(yAxisMap)[0]) as any;
  const xAxis = (Object.values(xAxisMap)[0]) as any;
  if (!yAxis?.scale || !xAxis) return null;
  const y = Math.round(yAxis.scale(threshold));
  return (
    <g style={{ pointerEvents: 'none' }}>
      <line x1={xAxis.x} x2={xAxis.x + xAxis.width} y1={y} y2={y}
        stroke={stroke} strokeDasharray={strokeDasharray} strokeWidth={strokeWidth} />
      {labelText && (
        <text x={xAxis.x + 4} y={y - 4} fill={stroke} fontSize={10} fontFamily="monospace">{labelText}</text>
      )}
    </g>
  );
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
        className="bg-surface-100 border border-border rounded-xl p-6 w-[380px] shadow-2xl">
        <h3 className="font-semibold text-slate-100 text-base mb-4">ค้นหายอดตัด</h3>
        <div className="space-y-2.5 mb-5">
          {opts.map((o) => (
            <label key={o.k} className={`flex flex-col gap-1.5 p-3 rounded-lg border cursor-pointer transition-colors ${
              mode === o.k ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-slate-600'}`}>
              <div className="flex items-center gap-2">
                <input type="radio" className="accent-accent" checked={mode === o.k} onChange={() => setMode(o.k)} />
                <span className="text-sm font-medium text-slate-200">{o.label}</span>
              </div>
              {mode === o.k && (
                <div className="flex items-center gap-2 pl-5">
                  <span className="text-xs text-slate-500 shrink-0">{o.hint}</span>
                  <input type="number" min={0} value={value} onChange={(e) => setValue(parseFloat(e.target.value) || 0)}
                    className="h-8 w-32 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
              )}
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>ยกเลิก</Button>
          <Button onClick={() => onConfirm(mode, value)}>ตกลง</Button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── PDF Print dialog ─────────────────────────────────────────────────────────
interface SendItem { number: string; amount: number; type: string }
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
  // Compact layout when few items (hide empty rows); full grid when dense
  const ROWS = cutItems.length <= COLS * 8
    ? Math.max(Math.ceil(cutItems.length / COLS) + 2, 4)
    : 20;

  const BET_PREFIX: Record<string, string> = {
    '3digit_top': 'บน', '3digit_tote': 'โต็ด', '3digit_back': 'ล่าง',
    '2digit_top': 'บน', '2digit_bottom': 'ล่าง',
    '1digit_top': 'บน', '1digit_bottom': 'ล่าง',
  };
  const prefix = BET_PREFIX[betType] ?? '';

  const now = new Date();
  const printDateStr = now.toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit', year: 'numeric' })
    + ' ' + now.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });

  const ITEMS_PER_PAGE = COLS * ROWS;
  const totalPages = Math.max(1, Math.ceil(cutItems.length / ITEMS_PER_PAGE));

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
        cells += `<td style="${thinBorder}padding:3px 7px;white-space:nowrap;">${item ? `${prefix} ${item.number}` : ''}</td>`;
        cells += `<td style="${thinBorder}${sepR}padding:3px 7px;text-align:right;">${item ? item.amount.toLocaleString() : ''}</td>`;
      }
      bodyRows += `<tr>${cells}</tr>`;
    }

    let headCells = '';
    for (let c = 0; c < COLS; c++) {
      const sepR = c < COLS - 1 ? thickR : '';
      headCells += `<th style="${thinBorder}background:#f0e68c;padding:5px 7px;text-align:left;min-width:80px;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}background:#f0e68c;padding:5px 7px;text-align:left;min-width:60px;">ราคา</th>`;
    }

    const pn = pageIdx + 1;
    return `
      <div class="page" style="margin-bottom:${pageIdx < totalPages - 1 ? '0' : '0'};">
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-weight:bold;font-size:15px;margin-bottom:5px;">
          <span>รายการส่งของลูกค้า : ${dealerName || '—'}</span>
          <span>แผ่นที่ : ${pn}&nbsp;&nbsp;&nbsp;งวดประจำวันที่ : ${roundName}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;border:3px solid #000;">
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
      <div style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;font-size:12px;color:#000;padding:12px">
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
            <th key={`h${c}n`} style={{ border: '1px solid #aaa', background: '#f0e68c', padding: '5px 7px', textAlign: 'left', minWidth: 75, whiteSpace: 'nowrap' as const }}>เลข</th>,
            <th key={`h${c}p`} style={{ border: '1px solid #aaa', background: '#f0e68c', borderRight: isLast ? '1px solid #aaa' : '3px solid #000', padding: '5px 7px', textAlign: 'left', minWidth: 55 }}>ราคา</th>,
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
              {item ? `${prefix} ${item.number}` : ''}
            </td>,
            <td key={`r${r}c${c}p`} style={{ border: '1px solid #aaa', borderRight: isLast ? '1px solid #aaa' : '3px solid #000', padding: '3px 7px', textAlign: 'right' }}>
              {item ? item.amount.toLocaleString() : ''}
            </td>,
          ];
        }).flat()}
      </tr>
    ));

    return (
      <div style={{ marginBottom: pageIdx < totalPages - 1 ? 24 : 0, color: '#000' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 'bold', fontSize: 14, marginBottom: 4 }}>
          <span>รายการส่งของลูกค้า : {dealerName || '—'}</span>
          <span>แผ่นที่ : {pn}&nbsp;&nbsp;&nbsp;งวดประจำวันที่ : {roundName}</span>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', border: '3px solid #000', fontSize: 12 }}>
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
        className="bg-white border border-gray-300 rounded-xl shadow-2xl w-full max-w-5xl max-h-[95vh] flex flex-col">

        {/* Dialog header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-200 bg-gray-50 rounded-t-xl">
          <div>
            <h3 className="font-semibold text-gray-800">ตัวอย่างฟอร์มส่ง</h3>
            <p className="text-xs text-gray-500 mt-0.5">{BET_TYPE_SHORT[betType]} · {cutItems.length} รายการ · {totalPages} หน้า</p>
          </div>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 text-sm text-gray-700 transition-colors">ปิด</button>
            <button onClick={doPrint} className="h-8 px-4 rounded-lg bg-blue-600 hover:bg-blue-700 text-sm text-white font-semibold transition-colors flex items-center gap-1.5">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <polyline points="6 9 6 2 18 2 18 9" /><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" /><rect x="6" y="14" width="12" height="8" />
              </svg>
              พิมพ์ / PDF
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto p-6 bg-gray-100">
          <div className="bg-white shadow-md rounded p-5 min-w-[700px]">
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

  // Score = (%ได้ × ยอดได้สูงสุด) — higher is better
  const score = (r: RangeSimRow) => (r.pct_win / 100) * r.max_gain;

  const nonZero = rows.filter(r => r.threshold > 0);
  const working = nonZero.length > 0 ? nonZero : rows;

  const passAll = working.filter(r =>
    (r.max_loss === null || Math.abs(r.max_loss) <= maxLossLimit) &&
    r.pct_win >= minPctWin
  );
  const passLossOnly = working.filter(r => r.max_loss === null || Math.abs(r.max_loss) <= maxLossLimit);

  // Top 5 rows by score (from all non-zero rows)
  const top5 = [...working].sort((a, b) => score(b) - score(a)).slice(0, 5);

  // Primary suggestion
  let primary: { row: RangeSimRow; rowIdx: number; label: string; color: string; reason: string } | null = null;
  let secondary: { row: RangeSimRow; rowIdx: number; label: string; color: string; reason: string } | null = null;

  if (passAll.length > 0) {
    const best = passAll.reduce((a, b) => score(b) > score(a) ? b : a);
    primary = {
      row: best, rowIdx: rows.indexOf(best),
      label: '⭐ แนะนำ (คุ้มค่าสูงสุด)', color: 'emerald',
      reason: `คะแนน ${score(best).toFixed(0)} · %ได้ ${best.pct_win.toFixed(1)}% · ได้สูงสุด ${formatBaht(best.max_gain)}`,
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
    const best2 = passLossOnly.reduce((a, b) => score(b) > score(a) ? b : a);
    primary = {
      row: best2, rowIdx: rows.indexOf(best2),
      label: '⚠️ ดีที่สุดในช่วงยอมรับได้ (%ได้ต่ำกว่าเป้า)', color: 'amber',
      reason: `%ได้ ${best2.pct_win.toFixed(1)}% (เป้า ≥${minPctWin}%) · เสียสูงสุด: ${best2.max_loss != null ? formatBaht(best2.max_loss) : 'ไม่เสีย'}`,
    };
  } else {
    const best3 = working.reduce((a, b) => score(b) > score(a) ? b : a);
    primary = {
      row: best3, rowIdx: rows.indexOf(best3),
      label: '⚠️ ดีที่สุดที่มี (ยอดเสียเกิน limit)', color: 'amber',
      reason: `%ได้ ${best3.pct_win.toFixed(1)}% · เสียสูงสุด ${best3.max_loss != null ? formatBaht(best3.max_loss) : 'ไม่เสีย'} · ลองผ่อนปรน constraint`,
    };
  }

  const colorMap: Record<string, { bg: string; border: string; text: string; btn: string }> = {
    emerald: { bg: 'bg-emerald-900/20', border: 'border-emerald-500/40', text: 'text-emerald-300', btn: 'bg-emerald-600 hover:bg-emerald-500' },
    amber:   { bg: 'bg-amber-900/20',   border: 'border-amber-500/40',   text: 'text-amber-300',   btn: 'bg-amber-600 hover:bg-amber-500' },
    violet:  { bg: 'bg-violet-900/20',  border: 'border-violet-500/40',  text: 'text-violet-300',  btn: 'bg-violet-600 hover:bg-violet-500' },
  };

  const SuggestionCard = ({ s }: { s: typeof primary }) => {
    if (!s) return null;
    const c = colorMap[s.color] ?? colorMap['amber'];
    return (
      <div className={`${c.bg} border ${c.border} rounded-xl p-4`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={`font-bold text-sm ${c.text}`}>{s.label}</p>
            <p className="text-xs text-slate-400 mt-1">{s.reason}</p>
            <div className="flex flex-wrap gap-3 mt-2 text-xs text-slate-500">
              <span>เก็บตัวละ: <span className="font-mono text-amber-300">{s.row.threshold > 0 ? formatBaht(s.row.threshold) : '0'} บ</span></span>
              <span>จำนวนเก็บ: <span className="font-mono text-blue-300">{s.row.count_fully_kept}</span></span>
              <span>%ได้: <span className="font-mono text-emerald-400">{s.row.pct_win.toFixed(1)}%</span></span>
              <span>%เสีย: <span className="font-mono text-rose-400">{s.row.pct_lose.toFixed(1)}%</span></span>
            </div>
            <div className="flex flex-wrap gap-3 mt-1 text-xs text-slate-500">
              <span>ได้สูงสุด: <span className="font-mono text-emerald-400">{formatBaht(s.row.max_gain)}</span></span>
              <span>เสียสูงสุด: <span className={`font-mono ${s.row.max_loss != null ? 'text-rose-400' : 'text-emerald-400'}`}>
                {s.row.max_loss != null ? formatBaht(s.row.max_loss) : 'ไม่เสีย'}</span></span>
            </div>
          </div>
          <button
            onClick={() => { onApply(s.rowIdx, s.row.threshold); onClose(); }}
            className={`shrink-0 h-8 px-4 rounded-lg ${c.btn} text-white text-xs font-semibold transition-colors`}>
            ใช้ค่านี้
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-surface-100 border border-border rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* Header */}
        <div className="px-5 py-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="font-bold text-slate-100 text-base">✨ ตัดอัจฉริยะ</h3>
              <p className="text-xs text-slate-500 mt-0.5">วิเคราะห์จุดตัดที่เหมาะสมโดยอัตโนมัติ — คุณแค่ปรับเงื่อนไขเล็กน้อย</p>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none mt-0.5">✕</button>
          </div>
        </div>

        {/* Explanation */}
        <div className="px-5 py-3 border-b border-border bg-surface-200/30 shrink-0">
          <p className="text-xs font-semibold text-slate-400 mb-1.5">หลักการคำนวณ</p>
          <div className="flex flex-wrap gap-4 text-xs text-slate-400">
            <span>📊 <span className="text-slate-300 font-semibold">คะแนน</span> = <span className="text-violet-300">%ได้กำไร</span> × <span className="text-emerald-300">ยอดได้สูงสุด</span> → ยิ่งสูงยิ่งดี</span>
            <span>🎯 กรองด้วย <span className="text-amber-300">เพดานยอดเสีย</span> + <span className="text-emerald-300">%ได้ขั้นต่ำ</span></span>
            <span>✅ แถวที่ผ่านเงื่อนไข: <span className={`font-mono font-bold ${passAll.length > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>{passAll.length}</span>/{working.length}</span>
          </div>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Constraints */}
          <div className="px-5 py-4 border-b border-border space-y-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ตั้งค่าเงื่อนไข</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">เพดานยอดเสียที่รับได้ (บาท)</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} value={maxLossLimit}
                    onChange={e => setMaxLossLimit(Number(e.target.value) || 0)}
                    className="h-8 flex-1 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
                  <span className="text-xs text-slate-600 shrink-0">≈{((maxLossLimit / Math.max(totalRevenue, 1)) * 100).toFixed(0)}%</span>
                </div>
                <input type="range" min={0} max={totalRevenue} step={Math.ceil(totalRevenue / 100)}
                  value={Math.min(maxLossLimit, totalRevenue)}
                  onChange={e => setMaxLossLimit(Number(e.target.value))}
                  className="w-full accent-rose-400 h-1" />
                <p className="text-[10px] text-slate-600">ยอดขาดทุนสูงสุดที่คุณยอมรับได้ถ้าเลขถูก</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400">%ได้กำไรขั้นต่ำ</label>
                <div className="flex items-center gap-2">
                  <input type="number" min={0} max={100} value={minPctWin}
                    onChange={e => setMinPctWin(Number(e.target.value) || 0)}
                    className="h-8 flex-1 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-accent" />
                  <span className="text-xs text-slate-600 shrink-0">%</span>
                </div>
                <input type="range" min={0} max={100} step={5}
                  value={minPctWin}
                  onChange={e => setMinPctWin(Number(e.target.value))}
                  className="w-full accent-emerald-400 h-1" />
                <p className="text-[10px] text-slate-600">ใน 100 ผลลัพธ์ที่เป็นไปได้ ต้องได้กำไรกี่%</p>
              </div>
            </div>
          </div>

          {/* Suggestions */}
          <div className="px-5 py-4 space-y-3 border-b border-border">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">ผลการวิเคราะห์</p>
            <SuggestionCard s={primary} />
            {secondary && <SuggestionCard s={secondary} />}
          </div>

          {/* Top 5 scoring table */}
          <div className="px-5 py-4">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Top 5 แถวตามคะแนน (scroll ตารางใหญ่เพื่อดูทั้งหมด)</p>
            <div className="overflow-auto rounded-lg border border-border">
              <table className="w-full text-xs whitespace-nowrap">
                <thead className="bg-surface-200 border-b border-border">
                  <tr>
                    {['#', 'คะแนน', 'เก็บตัวละ', 'จำนวนเก็บ', '%ได้', '%เสีย', 'ได้สูงสุด', 'เสียสูงสุด', ''].map(h => (
                      <th key={h} className="py-2 px-2.5 text-left text-slate-500 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {top5.map((row, i) => {
                    const rowIdx = rows.indexOf(row);
                    const pass = (row.max_loss === null || Math.abs(row.max_loss) <= maxLossLimit) && row.pct_win >= minPctWin;
                    return (
                      <tr key={i} className={`border-b border-border/30 ${pass ? '' : 'opacity-50'}`}>
                        <td className="py-1.5 px-2.5 text-slate-500">{row.row}</td>
                        <td className="py-1.5 px-2.5 font-mono text-violet-300 font-semibold">{score(row).toFixed(0)}</td>
                        <td className="py-1.5 px-2.5 font-mono text-amber-300">{formatBaht(row.threshold)}</td>
                        <td className="py-1.5 px-2.5 font-mono text-blue-300">{row.count_fully_kept}</td>
                        <td className={`py-1.5 px-2.5 font-mono font-semibold ${row.pct_win >= minPctWin ? 'text-emerald-400' : 'text-rose-400'}`}>{row.pct_win.toFixed(1)}%</td>
                        <td className="py-1.5 px-2.5 font-mono text-rose-300">{row.pct_lose.toFixed(1)}%</td>
                        <td className="py-1.5 px-2.5 font-mono text-emerald-300">{formatBaht(row.max_gain)}</td>
                        <td className={`py-1.5 px-2.5 font-mono ${row.max_loss != null ? (Math.abs(row.max_loss) <= maxLossLimit ? 'text-rose-300' : 'text-rose-500 font-bold') : 'text-emerald-400'}`}>
                          {row.max_loss != null ? formatBaht(row.max_loss) : 'ไม่เสีย'}
                        </td>
                        <td className="py-1.5 px-1">
                          <button onClick={() => { onApply(rowIdx, row.threshold); onClose(); }}
                            className="h-6 px-2 rounded bg-surface-300 hover:bg-accent/30 text-[10px] text-slate-400 hover:text-accent transition-colors border border-border">
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
          <button onClick={onClose} className="h-8 px-4 rounded-lg bg-surface-300 hover:bg-surface-200 text-sm text-slate-300 transition-colors border border-border">ปิด</button>
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
function buildBatchPrintHtml(batches: SendBatch[], mode: 'each' | 'combined', roundName: string): string {
  const COLS = 4;
  const ROWS = 20;
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
    // Compact layout when few items; full grid when dense
    const ROWS = items.length <= COLS * 8
      ? Math.max(Math.ceil(items.length / COLS) + 2, 4)
      : 20;
    const ITEMS_PER_PAGE = COLS * ROWS;
    const totalPgs = Math.max(1, Math.ceil(items.length / ITEMS_PER_PAGE));
    let html = '';
    for (let p = 0; p < totalPgs; p++) {
      const pageItems = items.slice(p * ITEMS_PER_PAGE, (p + 1) * ITEMS_PER_PAGE);
      let headCells = '';
      for (let c = 0; c < COLS; c++) {
        const sepR = c < COLS - 1 ? thickR : '';
        headCells += `<th style="${thinB}background:#f0e68c;padding:5px 7px;text-align:left;min-width:80px;">เลข</th>`;
        headCells += `<th style="${thinB}${sepR}background:#f0e68c;padding:5px 7px;text-align:left;min-width:60px;">ราคา</th>`;
      }
      let bodyRows = '';
      for (let r = 0; r < ROWS; r++) {
        let cells = '';
        for (let c = 0; c < COLS; c++) {
          const item = pageItems[c * ROWS + r] ?? null;
          const sepR = c < COLS - 1 ? thickR : '';
          cells += `<td style="${thinB}padding:3px 7px;white-space:nowrap;">${item ? item.label : ''}</td>`;
          cells += `<td style="${thinB}${sepR}padding:3px 7px;text-align:right;">${item ? item.amount.toLocaleString() : ''}</td>`;
        }
        bodyRows += `<tr>${cells}</tr>`;
      }
      const pn = p + 1;
      const grand = items.reduce((s, i) => s + i.amount, 0);
      html += `<div>
        <div style="display:flex;justify-content:space-between;font-weight:bold;font-size:15px;margin-bottom:5px;">
          <span>${header}</span>
          <span>แผ่นที่ ${pn} · งวด ${roundName}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;border:3px solid #000;">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot><tr>
            <td colspan="2" style="${thinB}background:#fffde7;border-top:3px solid #000;padding:4px 7px;font-weight:bold;">วันที่พิมพ์ ${printDate}</td>
            <td colspan="4" style="${thinB}background:#fffde7;border-top:3px solid #000;padding:4px 7px;text-align:center;font-weight:bold;">${pn}/${totalPgs}</td>
            <td colspan="2" style="${thinB}background:#fffde7;border-top:3px solid #000;padding:4px 7px;text-align:right;font-weight:bold;">ยอดรวม ${grand.toLocaleString()}</td>
          </tr></tfoot>
        </table>
      </div>`;
      if (p < totalPgs - 1) html += '<div style="page-break-after:always"></div>';
    }
    return html;
  }

  if (mode === 'each') {
    const sections = batches.map((b, bi) => {
      const prefix = BET_PREFIX[b.bet_type] ?? '';
      const label  = BET_TYPE_LABELS[b.bet_type as BetType] ?? b.bet_type;
      const header = `รายการส่ง : ${b.dealer_name ?? '—'} — ${label}`;
      const items  = b.items.map(i => ({ label: `${prefix} ${i.number}`, amount: i.amount }));
      return buildGrid(items, header);
    });
    return sections.join('<div style="page-break-after:always"></div>');
  } else {
    const merged = batches.flatMap(b => {
      const prefix = BET_PREFIX[b.bet_type] ?? '';
      return b.items.map(i => ({ label: `${prefix} ${i.number}`, amount: i.amount }));
    });
    const dealerNames = [...new Set(batches.map(b => b.dealer_name).filter(Boolean))].join(', ');
    const header = `รายการส่งรวม ${batches.length} ชีต : ${dealerNames || '—'}`;
    return buildGrid(merged, header);
  }
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
  const [dealerId, setDealerId] = useState(initialDealerId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.92, opacity: 0 }}
        className="bg-surface-100 border border-border rounded-xl shadow-2xl w-full max-w-md"
        onClick={(e) => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h3 className="font-bold text-slate-100 text-base">บันทึกส่ง</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              {betTypeLabel} · {cutItemsCount} รายการ · <span className="font-mono text-blue-400">{formatBaht(totalSend)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Dealer list */}
        <div className="px-5 py-4 space-y-2 max-h-72 overflow-auto">
          <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">เลือกเจ้ามือ</p>

          {/* No dealer option */}
          <label className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
            !dealerId ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-slate-600'}`}>
            <input type="radio" className="accent-accent" checked={!dealerId} onChange={() => setDealerId('')} />
            <span className="text-sm text-slate-400">— ไม่ระบุเจ้ามือ —</span>
          </label>

          {dealers.filter(d => d.is_active).map(dealer => {
            const rate = (dealer as any)[DEALER_RATE_KEYS[activeBetType]];
            const pct  = (dealer as any)[DEALER_PCT_KEYS[activeBetType]];
            return (
              <label key={dealer.id} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                dealer.id === dealerId ? 'border-accent/50 bg-accent/10' : 'border-border hover:border-slate-600'}`}>
                <input type="radio" className="accent-accent mt-0.5" checked={dealer.id === dealerId} onChange={() => setDealerId(dealer.id)} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-slate-100">{dealer.name}</p>
                  <div className="flex flex-wrap gap-4 mt-1 text-xs text-slate-500">
                    <span>จ่าย: <span className="font-mono text-amber-300">{rate ?? '—'}</span></span>
                    <span>ลด: <span className="font-mono text-slate-300">{pct ?? 0}%</span></span>
                    <span>เก็บสุทธิ: <span className="font-mono text-slate-300">{dealer.keep_net_pct}%</span></span>
                  </div>
                </div>
              </label>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex justify-end gap-2">
          <button onClick={onClose}
            className="h-9 px-4 rounded-lg bg-surface-300 hover:bg-surface-200 text-sm text-slate-300 transition-colors border border-border">
            ยกเลิก
          </button>
          <button onClick={() => onConfirm(dealerId)} disabled={saving}
            className="h-9 px-5 rounded-lg bg-accent hover:bg-accent/90 text-sm text-white font-semibold transition-colors disabled:opacity-50">
            {saving ? 'กำลังบันทึก…' : 'บันทึกส่ง'}
          </button>
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

  // ── Chart display
  const [chartHeight, setChartHeight]         = useState(260);
  const [chartFullscreen, setChartFullscreen] = useState(false);

  // ── PDF
  const [pdfOpen, setPdfOpen]                 = useState(false);

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
    fetchRoundDealer(); fetchRisk(); fetchSendBatches();
    setManualThreshold(null); setRangeResult(null); setSelectedRowIdx(null);
  }, [selectedRoundId]);

  const fetchRangeSim = useCallback(async () => {
    if (!selectedRoundId) return;
    setRangeLoading(true);
    setSelectedRowIdx(null);
    setManualThreshold(null);
    try {
      const steps = Math.ceil(100 / stepPct) + 1;
      const res = await cutApi.rangeSim(selectedRoundId, {
        bet_type: activeBetType,
        step_pct: stepPct,
        steps,
      });
      setRangeResult(res.data);
    } catch { setRangeResult(null); }
    finally { setRangeLoading(false); }
  }, [selectedRoundId, activeBetType, stepPct]);

  useEffect(() => { fetchRangeSim(); }, [selectedRoundId, activeBetType, stepPct]);

  // ── Dealer change (called from save modal)
  const handleSaveBatch = async (dealerId: string) => {
    if (!selectedRoundId || !cutItems.length) return;
    setSavingBatch(true);
    try {
      // Update round's dealer if changed
      if (dealerId !== selectedDealerId) {
        await roundsApi.setDealer(selectedRoundId, dealerId || null);
        const found = dealers.find(x => x.id === dealerId);
        setDealerName(found?.name ?? null);
        setSelectedDealerId(dealerId);
        await fetchRoundDealer();
        fetchRangeSim();
      }
      const found = dealers.find(x => x.id === dealerId);
      await cutApi.createSendBatch(selectedRoundId, {
        bet_type: activeBetType,
        threshold: activeThreshold,
        items: cutItems.map(d => ({ number: d.number, amount: d.amount })),
        total: totalSend,
        dealer_id: dealerId || null,
        dealer_name: found?.name ?? dealerName ?? null,
      });
      await fetchSendBatches();
      setShowSaveModal(false);
    } catch (err: any) {
      alert('บันทึกไม่สำเร็จ: ' + (err?.response?.data?.message ?? err?.message ?? 'error'));
    } finally { setSavingBatch(false); }
  };

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

  // ── Threshold: clamped so user cannot raise above committedThreshold
  const selectedRow: RangeSimRow | null = rangeResult?.rows[selectedRowIdx ?? -1] ?? null;
  const rawThreshold = manualThreshold ?? selectedRow?.threshold ?? 0;
  const activeThreshold = (committedThreshold != null && committedThreshold > 0)
    ? Math.min(rawThreshold, committedThreshold)
    : rawThreshold;

  // ── Chart: compute kept/sentCut/newCut from threshold + alreadySentMap
  const chartData: ChartBar[] = (rangeResult?.distribution ?? []).map(d => {
    const alreadySent = alreadySentMap.get(d.number) ?? 0;
    const kept     = activeThreshold > 0 ? Math.min(d.total, activeThreshold) : d.total;
    const totalCut = activeThreshold > 0 ? Math.max(0, d.total - activeThreshold) : 0;
    const sentCut  = Math.min(alreadySent, totalCut);
    const newCut   = Math.max(0, totalCut - sentCut);
    return { number: d.number, kept, sentCut, newCut, cut: totalCut, total: d.total };
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
  const handleChartAreaClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!rangeResult || !chartContainerRef.current) return;
    const rect = chartContainerRef.current.getBoundingClientRect();
    const offsetY = e.clientY - rect.top;
    const chartH = rect.height;
    const topMargin = 4;
    const bottomMargin = 36; // X-axis area
    const plotH = chartH - topMargin - bottomMargin;
    const yRatio = Math.max(0, Math.min(1, 1 - (offsetY - topMargin) / plotH));
    const maxY = rangeResult.max_single_bet * 1.05;
    const clickedThreshold = Math.round(yRatio * maxY);
    setManualThreshold(clickedThreshold);
    const idx = rangeResult.rows.findIndex(r => r.threshold >= clickedThreshold);
    setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
  }, [rangeResult]);

  // ── Search
  const handleSearch = (mode: string, value: number) => {
    if (!rangeResult?.rows.length) return;
    let idx = -1;
    if (mode === 'manual')      idx = rangeResult.rows.findIndex(r => r.threshold >= value);
    if (mode === 'pct_win')     idx = rangeResult.rows.findIndex(r => r.pct_win >= value);
    if (mode === 'max_payout')  idx = rangeResult.rows.findIndex(r => r.max_loss === null || Math.abs(r.max_loss) <= value);
    const final = idx >= 0 ? idx : rangeResult.rows.length - 1;
    setSelectedRowIdx(final);
    setManualThreshold(null);
    setTimeout(() => {
      tableBodyRef.current?.querySelector(`[data-row="${final}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
  };

  // ── Cut items (incremental: only amounts not yet in a saved batch)
  const cutItems = chartData
    .map(d => {
      const alreadySent = alreadySentMap.get(d.number) ?? 0;
      const additional = Math.max(0, d.cut - alreadySent);
      return { number: d.number, amount: additional, type: BET_TYPE_LABELS[activeBetType] };
    })
    .filter(d => d.amount > 0);
  const totalSend = cutItems.reduce((s, d) => s + d.amount, 0);
  const totalRevenue = rangeResult?.total_revenue ?? 0;

  // ── Effective stats row from slider/click
  const effectiveStats: RangeSimRow | null = selectedRow;

  // ── Header stats
  const round = rounds.find(r => r.id === selectedRoundId);

  return (
    <AppShell>
      <Header title="ตัดหวย" subtitle={round ? `งวด ${round.name}` : 'เลือกงวดเพื่อเริ่ม'} />

      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">
        {/* ── Top control bar ── */}
        <div className="relative flex flex-wrap gap-3 items-end px-5 py-3 border-b border-border bg-surface-100/80">
          {/* Round */}
          <div className="flex flex-col gap-1">
            <label className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider">งวด</label>
            <select value={selectedRoundId} onChange={(e) => setSelectedRoundId(e.target.value)}
              className="h-8 rounded-lg bg-surface-200 border border-border px-2.5 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
              <option value="">-- เลือกงวด --</option>
              {rounds.filter(r => r.status !== 'archived').map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>

          {/* Bet type tabs */}
          <div className="flex gap-1 flex-wrap">
            {BET_TYPE_ORDER.map(bt => (
              <button key={bt} onClick={() => setActiveBetType(bt)}
                className={`h-8 px-3 rounded-lg text-xs font-semibold transition-all border ${
                  bt === activeBetType ? 'bg-accent/20 text-accent border-accent/40' : 'text-slate-400 border-transparent hover:text-slate-200 hover:bg-surface-200'
                }`}>
                {BET_TYPE_SHORT[bt]}
              </button>
            ))}
          </div>

          <Button variant="ghost" size="sm" onClick={() => setSearchOpen(true)} disabled={!rangeResult?.rows.length}>ค้นหายอดตัด</Button>
          <button
            onClick={() => setSmartCutOpen(true)}
            disabled={!rangeResult?.rows.length}
            className="h-8 px-3 rounded-lg text-xs font-semibold border border-violet-500/40 bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
            ✨ ตัดอัจฉริยะ
          </button>

          {/* Dealer info (read-only, shows currently assigned dealer) */}
          {dealerName && (
            <div className="flex items-center gap-2 text-[10px] text-slate-500 bg-surface-200 rounded-lg px-2.5 py-1.5 border border-border">
              <span className="text-slate-400">เจ้ามือ:</span>
              <span className="text-slate-200 font-semibold">{dealerName}</span>
              {dealerParams && (
                <>
                  <span>·</span>
                  <span>จ่าย: <span className="text-slate-300 font-mono">{(dealerParams.rates as any)[activeBetType] ?? '—'}</span></span>
                  <span>·</span>
                  <span>ลด: <span className="text-slate-300 font-mono">{(dealerParams.commissions as any)[activeBetType] ?? 0}%</span></span>
                </>
              )}
            </div>
          )}
        </div>

        {/* ── Main body: 2-column layout ── */}
        <div className="flex-1 grid grid-cols-1 xl:grid-cols-[1fr_340px] min-h-0 overflow-hidden">

          {/* LEFT: Chart + table */}
          <div className="relative flex flex-col min-h-0 overflow-auto p-4 gap-4">
            {/* Committed threshold info banner */}
            {committedThreshold != null && committedThreshold > 0 && (
              <div className="flex items-center gap-2 bg-rose-900/20 border border-rose-500/30 rounded-lg px-3 py-2 text-xs shrink-0">
                <span className="text-rose-400">🔒</span>
                <span className="text-slate-300">
                  ส่งแล้วที่ <span className="font-mono text-amber-300 font-bold">{formatBaht(committedThreshold)}</span> บ/เลข
                  &nbsp;&mdash;&nbsp;สามารถตัดเพิ่มได้ (ลดต่ำกว่าเดิม) แต่ไม่สามารถเพิ่มขึ้นได้
                  &nbsp;·&nbsp;ลบรายการส่งเพื่อเริ่มใหม่ทั้งหมด
                </span>
              </div>
            )}

            {/* INFO + STATS BAR — เหมือนรูปอ้างอิง */}
            {rangeResult && (
              <div className="space-y-2">
                {/* Row 1: ยอดขาย + เลขที่มีโพย + สูงสุดต่อเลข + เก็บตัวละ */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {[
                    { label: 'ยอดขาย',      val: formatBaht(rangeResult.total_revenue),  cls: 'text-emerald-400' },
                    { label: 'เลขที่มีโพย',  val: rangeResult.unique_numbers.toString(),  cls: 'text-slate-200'   },
                    { label: 'สูงสุดต่อเลข', val: formatBaht(rangeResult.max_single_bet), cls: 'text-amber-400'   },
                    { label: 'เก็บตัวละ',   val: activeThreshold > 0 ? formatBaht(activeThreshold) : '—', cls: 'text-amber-300 font-bold' },
                  ].map(({ label, val, cls }) => (
                    <div key={label} className="bg-surface-200 rounded-lg px-3 py-2 flex flex-col">
                      <span className="text-[10px] text-slate-500 mb-0.5">{label}</span>
                      <span className={`text-sm font-mono font-bold ${cls}`}>{val}</span>
                    </div>
                  ))}
                </div>

                {/* Row 2 (only when threshold set): ยอดตัด + คงเหลือ + ส่งแล้ว + %ได้/%เสีย */}
                {effectiveStats && activeThreshold > 0 && (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {[
                      { label: 'ยอดได้สูงสุด',  val: formatBaht(effectiveStats.max_gain),  cls: 'text-emerald-400 font-bold' },
                      { label: 'ยอดได้ต่ำสุด',  val: effectiveStats.min_gain != null ? formatBaht(effectiveStats.min_gain) : '—', cls: 'text-emerald-300' },
                      { label: 'ยอดเสียสูงสุด', val: effectiveStats.max_loss != null ? formatBaht(effectiveStats.max_loss) : 'ไม่เสีย', cls: effectiveStats.max_loss != null ? 'text-rose-400 font-bold' : 'text-emerald-400' },
                      { label: 'ยอดเสียต่ำสุด', val: effectiveStats.min_loss != null ? formatBaht(effectiveStats.min_loss) : '—', cls: 'text-rose-300' },
                    ].map(({ label, val, cls }) => (
                      <div key={label} className="bg-surface-200 rounded-lg px-3 py-2 flex flex-col">
                        <span className="text-[10px] text-slate-500 mb-0.5">{label}</span>
                        <span className={`text-sm font-mono ${cls}`}>{val}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Row 3: %ได้/%เสีย + ยอดตัด + คงเหลือ */}
                {effectiveStats && activeThreshold > 0 && (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    <div className="bg-emerald-900/25 border border-emerald-600/20 rounded-lg px-3 py-2 text-center">
                      <span className="text-[10px] text-slate-500 block mb-0.5">% ได้กำไร</span>
                      <span className="text-base font-bold font-mono text-emerald-400">{effectiveStats.pct_win.toFixed(1)}<span className="text-xs">%</span></span>
                    </div>
                    <div className="bg-rose-900/25 border border-rose-600/20 rounded-lg px-3 py-2 text-center">
                      <span className="text-[10px] text-slate-500 block mb-0.5">% ขาดทุน</span>
                      <span className="text-base font-bold font-mono text-rose-400">{effectiveStats.pct_lose.toFixed(1)}<span className="text-xs">%</span></span>
                    </div>
                    <div className="bg-surface-200 rounded-lg px-3 py-2 flex flex-col">
                      <span className="text-[10px] text-slate-500 mb-0.5">ยอดตัดออก{totalAlreadySent > 0 ? ' (รวมส่งแล้ว)' : ''}</span>
                      <span className="text-sm font-mono font-bold text-blue-400">{formatBaht(totalSend + totalAlreadySent)}</span>
                    </div>
                    <div className="bg-surface-200 rounded-lg px-3 py-2 flex flex-col">
                      <span className="text-[10px] text-slate-500 mb-0.5">คงเหลือ</span>
                      <span className="text-sm font-mono font-bold text-slate-200">{formatBaht(totalRevenue - totalSend - totalAlreadySent)}</span>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* CHART */}
            {rangeResult && chartData.length > 0 ? (
              <Card className="p-0 overflow-hidden flex-shrink-0">
                <div className="px-4 pt-3 pb-1 flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-sm">{BET_TYPE_LABELS[activeBetType]} — การกระจายยอดแทง</CardTitle>
                    {activeThreshold > 0 && (
                      <span className="text-xs bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded px-2 py-0.5 font-mono">
                        ขีด {formatBaht(activeThreshold)} บ/เลข
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block"/>เก็บ</span>
                    {totalAlreadySent > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block"/>ส่งแล้ว</span>}
                    <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-400 inline-block"/>ตัดเพิ่ม</span>
                    {activeThreshold === 0 && <span className="italic hidden sm:inline">คลิกที่กราฟเพื่อตั้งยอดตัด</span>}
                    {/* Zoom size buttons */}
                    <span className="flex items-center gap-0.5 border-l border-border/50 pl-2 ml-0.5">
                      {([180, 260, 360, 480] as const).map(h => (
                        <button key={h} onClick={() => setChartHeight(h)}
                          className={`w-6 h-6 rounded text-[9px] font-bold transition-colors ${
                            chartHeight === h ? 'bg-accent/30 text-accent' : 'hover:bg-surface-200 text-slate-600'
                          }`}>
                          {h === 180 ? 'S' : h === 260 ? 'M' : h === 360 ? 'L' : 'XL'}
                        </button>
                      ))}
                    </span>
                    {/* Fullscreen button */}
                    <button onClick={() => setChartFullscreen(true)} title="ขยายเต็มจอ"
                      className="w-6 h-6 rounded hover:bg-surface-200 text-slate-400 hover:text-slate-200 transition-colors flex items-center justify-center">
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M8 3H5a2 2 0 00-2 2v3m18 0V5a2 2 0 00-2-2h-3m0 18h3a2 2 0 002-2v-3M3 16v3a2 2 0 002 2h3"/>
                      </svg>
                    </button>
                  </div>
                </div>
                {/* Clickable chart area */}
                <div ref={chartContainerRef} className="cursor-crosshair" onClick={handleChartAreaClick}>
                  <ResponsiveContainer width="100%" height={chartHeight}>
                    <BarChart
                      data={chartData}
                      margin={{ top: 4, right: 8, left: 4, bottom: 32 }}
                      barCategoryGap="4%"
                      onClick={handleChartClick}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
                      <XAxis
                        dataKey="number"
                        tick={<NumberTick />}
                        axisLine={{ stroke: '#334155' }}
                        tickLine={false}
                        interval={0}
                        height={32}
                      />
                      <YAxis
                        width={60}
                        tickCount={9}
                        tick={{ fontSize: 10, fill: '#64748b' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)}
                      />
                      <Tooltip content={<BarTooltip threshold={activeThreshold} />} cursor={{ fill: 'rgba(255,255,255,0.06)', cursor: 'crosshair' }} />
                      <Bar dataKey="kept"    name="เก็บ"    stackId="a" maxBarSize={14} fill="#f59e0b" radius={[0,0,0,0]} />
                      <Bar dataKey="sentCut" name="ส่งแล้ว" stackId="a" maxBarSize={14} fill="#3b82f6" radius={[0,0,0,0]} />
                      <Bar dataKey="newCut"  name="ตัดเพิ่ม"  stackId="a" maxBarSize={14} fill="#94a3b8" radius={[2,2,0,0]} />
                      {activeThreshold > 0 && (
                        <Customized component={(props: any) => (
                          <ChartRefLine {...props} threshold={activeThreshold} stroke="#f59e0b" labelText={`เก็บ ${formatBaht(activeThreshold)}`} />
                        )} />
                      )}
                      {committedThreshold != null && committedThreshold > 0 && committedThreshold !== activeThreshold && (
                        <Customized component={(props: any) => (
                          <ChartRefLine {...props} threshold={committedThreshold} stroke="#f43f5e" labelText={`ส่งแล้ว ${formatBaht(committedThreshold)}`} strokeDasharray="4 2" strokeWidth={1.5} />
                        )} />
                      )}
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="px-4 pb-3 flex items-center gap-3">
                    <span className="text-xs text-slate-500 shrink-0">เก็บตัวละ:</span>
                    <input
                      type="number"
                      min={0}
                      max={committedThreshold ?? Math.ceil(rangeResult.max_single_bet)}
                      step={1}
                      value={activeThreshold || ''}
                      placeholder="0"
                      onChange={(e) => {
                        const v = parseInt(e.target.value) || 0;
                        const clamped = committedThreshold != null ? Math.min(v, committedThreshold) : v;
                        setManualThreshold(clamped || null);
                        if (rangeResult) {
                          const idx = rangeResult.rows.findIndex(r => r.threshold >= clamped);
                          setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
                        }
                      }}
                      className="w-24 h-7 rounded bg-slate-900 border border-slate-600 px-2 text-sm text-amber-400 font-mono text-right focus:outline-none focus:ring-1 focus:ring-amber-500"
                    />
                    <input
                      type="range"
                      min={0}
                      max={committedThreshold ?? rangeResult.max_single_bet}
                      step={Math.ceil((committedThreshold ?? rangeResult.max_single_bet) / 200)}
                      value={activeThreshold}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        const clamped = committedThreshold != null ? Math.min(v, committedThreshold) : v;
                        setManualThreshold(clamped);
                        if (rangeResult) {
                          const idx = rangeResult.rows.findIndex(r => r.threshold >= clamped);
                          setSelectedRowIdx(idx >= 0 ? idx : rangeResult.rows.length - 1);
                        }
                      }}
                      className="flex-1 accent-amber-400"
                    />
                    {activeThreshold > 0 && (
                      <button onClick={() => { setManualThreshold(null); setSelectedRowIdx(null); }}
                        className="text-xs text-slate-500 hover:text-slate-300 transition-colors shrink-0">ล้าง</button>
                    )}
                  </div>
                {/* Step % selector — below slider */}
                <div className="px-4 pb-3 flex items-center gap-2 border-t border-border/30 pt-2">
                  <span className="text-[10px] text-slate-500 shrink-0 uppercase tracking-wider">ขั้น %</span>
                  {STEP_OPTIONS.map(v => (
                    <button key={v}
                      onClick={() => setStepPct(v)}
                      className={`h-6 px-3 rounded text-xs font-semibold transition-all border ${
                        v === stepPct
                          ? 'bg-accent/20 text-accent border-accent/40'
                          : 'text-slate-400 border-slate-600/50 hover:text-slate-200 hover:bg-surface-200'
                      }`}>
                      {v}%
                    </button>
                  ))}
                  {rangeLoading && <span className="text-[10px] text-slate-500 animate-pulse ml-1">กำลังคำนวณ…</span>}
                </div>
              </Card>
            ) : rangeLoading ? (
              <div className="space-y-2">
                {[...Array(5)].map((_,i) => <div key={i} className="h-8 rounded-lg bg-surface-200 animate-pulse" />)}
              </div>
            ) : selectedRoundId ? (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">
                กำลังโหลด…
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-slate-500 text-sm">เลือกงวดก่อน</div>
            )}

            {/* RANGE TABLE — always visible */}
            {rangeResult && rangeResult.rows.length > 0 && (
              <Card className="p-0 overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-300">กำหนดเป็นช่วง — step {stepPct}%</span>
                  {selectedRowIdx !== null && (
                    <button
                      onClick={() => { setSelectedRowIdx(null); setManualThreshold(null); }}
                      className="text-xs text-slate-500 hover:text-slate-300 transition-colors">ล้าง ×</button>
                  )}
                </div>
                <div ref={tableBodyRef} className="overflow-auto max-h-64">
                    <table className="w-full text-xs whitespace-nowrap">
                      <thead className="sticky top-0 bg-surface-100 z-10 border-b border-border">
                        <tr>
                          {['#', `${stepPct}%`, 'จำนวนเก็บ', 'เก็บตัวละ(บ)', 'ยอดได้สูงสุด', 'ยอดได้ต่ำสุด', 'ยอดเสียสูงสุด', 'ยอดเสียต่ำสุด', 'ยอดได้เฉลี่ย', 'ยอดเสียเฉลี่ย', '%ได้', '%เสีย'].map(h => (
                            <th key={h} className="py-2 px-2.5 text-left text-slate-500 font-medium">{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rangeResult.rows.map((row, i) => (
                          <tr key={i} data-row={i}
                            onClick={() => {
                              const newIdx = i === selectedRowIdx ? null : i;
                              setSelectedRowIdx(newIdx);
                              const newT = newIdx !== null ? row.threshold : null;
                              const clamped = (committedThreshold != null && newT != null)
                                ? Math.min(newT, committedThreshold) : newT;
                              setManualThreshold(clamped);
                            }}
                            className={`border-b border-border/30 cursor-pointer transition-colors ${
                              i === selectedRowIdx ? 'bg-amber-500/15 text-slate-100' : 'hover:bg-surface-200/50'}`}>
                            <td className="py-1.5 px-2.5 text-slate-400">{row.row}</td>
                            <td className="py-1.5 px-2.5 font-mono text-slate-300">{row.threshold_pct.toFixed(2)}</td>
                            <td className="py-1.5 px-2.5 font-mono text-blue-300 font-semibold">{row.count_fully_kept}</td>
                            <td className="py-1.5 px-2.5 font-mono text-amber-300 font-semibold">{row.threshold > 0 ? Math.round(row.threshold) : 0}</td>
                            <td className="py-1.5 px-2.5 font-mono text-emerald-400 font-semibold">{formatBaht(row.max_gain)}</td>
                            <td className="py-1.5 px-2.5 font-mono text-emerald-300">{row.min_gain != null ? formatBaht(row.min_gain) : '—'}</td>
                            <td className="py-1.5 px-2.5 font-mono text-rose-400 font-semibold">{row.max_loss != null ? formatBaht(row.max_loss) : <span className="text-emerald-400 text-[10px]">ไม่เสีย</span>}</td>
                            <td className="py-1.5 px-2.5 font-mono text-rose-300">{row.min_loss != null ? formatBaht(row.min_loss) : '—'}</td>
                            <td className="py-1.5 px-2.5 font-mono text-slate-300">{row.avg_gain != null ? formatBaht(row.avg_gain) : '—'}</td>
                            <td className="py-1.5 px-2.5 font-mono text-slate-400">{row.avg_loss != null ? formatBaht(row.avg_loss) : '—'}</td>
                            <td className={`py-1.5 px-2.5 font-mono font-semibold ${row.pct_win >= 70 ? 'text-emerald-400' : row.pct_win >= 50 ? 'text-amber-400' : 'text-slate-400'}`}>{row.pct_win.toFixed(1)}</td>
                            <td className={`py-1.5 px-2.5 font-mono font-semibold ${row.pct_lose > 30 ? 'text-rose-400' : row.pct_lose > 0 ? 'text-amber-400' : 'text-slate-500'}`}>{row.pct_lose.toFixed(1)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
              </Card>
            )}
          </div>

          {/* RIGHT: Summary + Send panel */}
          <div className="flex flex-col border-l border-border bg-surface-100/50 min-h-0 overflow-hidden">

            {/* ── รายการส่ง (sent history from DB) ── */}
            <div className="shrink-0 border-b border-border">
              <div className="flex items-center justify-between px-3 py-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  รายการส่ง ({sendBatches.length})
                  {selectedBatchIds.size > 0 && <span className="ml-2 text-accent normal-case">เลือก {selectedBatchIds.size}</span>}
                </p>
                <div className="flex items-center gap-2">
                  {sendBatches.length > 0 && (
                    <button
                      onClick={handleDeleteAllBatches}
                      disabled={deletingBatchId === 'all'}
                      className="text-[10px] text-rose-600 hover:text-rose-400 disabled:opacity-40 transition-colors">
                      {deletingBatchId === 'all' ? 'กำลังลบ…' : 'ลบทั้งหมด'}
                    </button>
                  )}
                  <button onClick={fetchSendBatches} className="text-[10px] text-slate-600 hover:text-slate-400 transition-colors">↻ รีเฟรช</button>
                </div>
              </div>

              {sendBatches.length > 0 ? (
                <div className="max-h-[150px] overflow-auto">
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-surface-200 border-y border-border">
                      <tr>
                        <th className="py-1.5 px-2 w-6">
                          <input type="checkbox"
                            className="accent-accent"
                            checked={sendBatches.length > 0 && selectedBatchIds.size === sendBatches.length}
                            onChange={(e) => setSelectedBatchIds(e.target.checked ? new Set(sendBatches.map(b => b.id)) : new Set())} />
                        </th>
                        <th className="text-left py-1.5 px-2 text-slate-500 font-medium">ประเภท</th>
                        <th className="text-right py-1.5 px-2 text-slate-500 font-medium">ยอด</th>
                        <th className="text-right py-1.5 px-2 text-slate-500 font-medium">วันที่</th>
                        <th className="py-1.5 px-1 w-6" />
                      </tr>
                    </thead>
                    <tbody>
                      {sendBatches.map((b, i) => (
                        <tr key={b.id}
                          onClick={() => setSelectedBatchIds(prev => {
                            const next = new Set(prev);
                            next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                            return next;
                          })}
                          className={`border-b border-border/30 cursor-pointer transition-colors ${
                            selectedBatchIds.has(b.id) ? 'bg-indigo-900/30' : i % 2 === 0 ? '' : 'bg-surface-200/30'
                          }`}>
                          <td className="py-1.5 px-2" onClick={(e) => e.stopPropagation()}>
                            <input type="checkbox" className="accent-accent"
                              checked={selectedBatchIds.has(b.id)}
                              onChange={() => setSelectedBatchIds(prev => {
                                const next = new Set(prev);
                                next.has(b.id) ? next.delete(b.id) : next.add(b.id);
                                return next;
                              })} />
                          </td>
                          <td className="py-1.5 px-2 text-slate-300">{BET_TYPE_LABELS[b.bet_type as BetType] ?? b.bet_type}</td>
                          <td className="py-1.5 px-2 font-mono text-blue-400 text-right font-semibold">{formatBaht(b.total)}</td>
                          <td className="py-1.5 px-2 text-slate-500 text-right text-[10px]">
                            {new Date(b.created_at).toLocaleDateString('th-TH', { day: '2-digit', month: '2-digit' })}
                          </td>
                          <td className="py-1.5 px-1">
                            <button
                              onClick={(e) => { e.stopPropagation(); handleDeleteBatch(b.id); }}
                              disabled={deletingBatchId === b.id}
                              className="text-slate-600 hover:text-rose-400 disabled:opacity-40 transition-colors text-[11px]">✕</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="text-[11px] text-slate-600 italic px-3 pb-2">ยังไม่มีรายการที่บันทึก</p>
              )}

              {/* Print buttons for saved batches */}
              {selectedBatchIds.size > 0 && (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                  <button
                    onClick={() => {
                      const selected = sendBatches.filter(b => selectedBatchIds.has(b.id));
                      const html = buildBatchPrintHtml(selected, 'each', round?.name ?? '');
                      openPrintPreview(`<div style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;font-size:12px;color:#000;padding:12px">${html}</div>`,
                        `พิมพ์แยกชีต — ${round?.name}`, `แยกชีต_${round?.name}`);
                    }}
                    className="h-7 px-3 rounded-lg bg-surface-200 hover:bg-surface-300 text-[11px] text-slate-300 border border-border transition-colors flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                    </svg>
                    แยกชีต
                  </button>
                  <button
                    onClick={() => {
                      const selected = sendBatches.filter(b => selectedBatchIds.has(b.id));
                      const html = buildBatchPrintHtml(selected, 'combined', round?.name ?? '');
                      openPrintPreview(`<div style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;font-size:12px;color:#000;padding:12px">${html}</div>`,
                        `พิมพ์รวม — ${round?.name}`, `รวมชีต_${round?.name}`);
                    }}
                    className="h-7 px-3 rounded-lg bg-surface-200 hover:bg-surface-300 text-[11px] text-slate-300 border border-border transition-colors flex items-center gap-1">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                    </svg>
                    รวม
                  </button>
                </div>
              )}
              {sendBatches.length > 0 && selectedBatchIds.size < sendBatches.length && (
                <div className="px-3 pb-2">
                  <button
                    onClick={() => {
                      setSelectedBatchIds(new Set(sendBatches.map(b => b.id)));
                      const html = buildBatchPrintHtml(sendBatches, 'each', round?.name ?? '');
                      openPrintPreview(`<div style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;font-size:12px;color:#000;padding:12px">${html}</div>`,
                        `ทุกชีต — ${round?.name}`, `ทุกชีต_${round?.name}`);
                    }}
                    className="h-7 px-3 rounded-lg bg-slate-700 hover:bg-slate-600 text-[11px] text-slate-300 border border-border transition-colors">
                    พิมพ์ทุกชีต
                  </button>
                </div>
              )}
            </div>

            {/* ── รายการรอส่ง (current computed cut items) ── */}
            <div className="flex-1 min-h-0 flex flex-col p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
                  รายการรอส่ง{batchesForType.length > 0 ? ' (เพิ่มเติม)' : ''} ({cutItems.length} รายการ)
                  {activeThreshold > 0 && <span className="ml-2 text-amber-400 font-mono normal-case">เก็บ {formatBaht(activeThreshold)} บ/เลข</span>}
                </p>
                {totalAlreadySent > 0 && (
                  <span className="text-[10px] text-slate-500 font-mono">
                    ส่งแล้ว <span className="text-rose-400 font-semibold">{formatBaht(totalAlreadySent)}</span>
                  </span>
                )}
              </div>

              {cutItems.length > 0 ? (
                <>
                  <div className="flex-1 overflow-auto rounded-lg border border-border">
                    <table className="w-full text-xs">
                      <thead className="sticky top-0 bg-surface-200 border-b border-border">
                        <tr>
                          <th className="text-left py-1.5 px-2.5 text-slate-500 font-medium">ประเภท</th>
                          <th className="text-left py-1.5 px-2.5 text-slate-500 font-medium">เลข</th>
                          <th className="text-right py-1.5 px-2.5 text-slate-500 font-medium">ราคา</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cutItems.map((item, i) => (
                          <tr key={i} className={`border-b border-border/40 ${i % 2 === 0 ? '' : 'bg-surface-200/30'}`}>
                            <td className="py-1.5 px-2.5 text-slate-400 text-[10px]">{BET_TYPE_LABELS[activeBetType]}</td>
                            <td className="py-1.5 px-2.5 font-mono font-bold text-slate-100 tracking-widest">{item.number}</td>
                            <td className="py-1.5 px-2.5 font-mono text-blue-400 text-right font-semibold">{formatBaht(item.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="mt-1.5 flex justify-between items-center px-0.5">
                    <span className="text-[10px] text-slate-500">รวมยอดส่ง</span>
                    <span className="font-mono font-bold text-blue-400 text-sm">{formatBaht(totalSend)}</span>
                  </div>
                </>
              ) : (
                <div className="flex-1 flex items-center justify-center border border-dashed border-border rounded-lg">
                  <p className="text-xs text-slate-600 italic">
                    {activeThreshold > 0 ? 'ไม่มีเลขที่ต้องตัด' : 'ตั้งยอดเก็บก่อนเพื่อดูรายการ'}
                  </p>
                </div>
              )}

              {/* Action buttons */}
              <div className="flex gap-1.5 mt-2 flex-wrap">
                <Button
                  size="sm"
                  onClick={() => setShowSaveModal(true)}
                  loading={savingBatch}
                  disabled={!cutItems.length || !selectedRoundId}>
                  บันทึกส่ง
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => { setPdfOpen(true); }}
                  disabled={!cutItems.length}>
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="mr-1">
                    <polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>
                  </svg>
                  พิมพ์
                </Button>
                {cutItems.length > 0 && activeThreshold > 0 && (
                  <button
                    onClick={() => { setManualThreshold(null); setSelectedRowIdx(null); }}
                    className="text-xs text-slate-500 hover:text-slate-300 transition-colors px-2">
                    ล้าง
                  </button>
                )}
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
      {/* Chart fullscreen overlay */}
      <AnimatePresence>
        {chartFullscreen && rangeResult && chartData.length > 0 && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setChartFullscreen(false)}>
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.96, opacity: 0 }}
              className="bg-surface-100 border border-border rounded-xl shadow-2xl w-full max-w-[96vw] flex flex-col overflow-hidden"
              style={{ height: '90vh' }}
              onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
                <span className="font-semibold text-slate-200 text-sm">{BET_TYPE_LABELS[activeBetType]} — การกระจายยอดแทง (เต็มจอ)</span>
                <div className="flex items-center gap-3 text-xs">
                  {activeThreshold > 0 && (
                    <span className="bg-amber-500/20 text-amber-300 border border-amber-500/30 rounded px-2 py-0.5 font-mono">
                      ขีด {formatBaht(activeThreshold)} บ/เลข
                    </span>
                  )}
                  <button onClick={() => setChartFullscreen(false)}
                    className="text-slate-400 hover:text-slate-200 transition-colors text-xl leading-none ml-2">✕</button>
                </div>
              </div>
              {/* Chart */}
              <div className="flex-1 min-h-0 p-4">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 20, left: 8, bottom: 44 }} barCategoryGap="3%">
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" vertical={false} />
                    <XAxis dataKey="number" tick={<NumberTick />} axisLine={{ stroke: '#334155' }} tickLine={false} interval={0} height={44} />
                    <YAxis width={68} tickCount={12} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false}
                      tickFormatter={(v) => v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)} />
                    <Tooltip content={<BarTooltip threshold={activeThreshold} />} cursor={{ fill: 'rgba(255,255,255,0.06)' }} />
                    {activeThreshold > 0 && (
                      <ReferenceLine y={activeThreshold} stroke="#f59e0b" strokeDasharray="6 3" strokeWidth={2}
                        label={{ value: `เก็บ ${formatBaht(activeThreshold)}`, position: 'insideTopLeft', fill: '#f59e0b', fontSize: 11 }} />
                    )}
                    {committedThreshold != null && committedThreshold > 0 && committedThreshold !== activeThreshold && (
                      <ReferenceLine y={committedThreshold} stroke="#f43f5e" strokeDasharray="4 2" strokeWidth={1.5}
                        label={{ value: `ส่งแล้ว ${formatBaht(committedThreshold)}`, position: 'insideTopRight', fill: '#f43f5e', fontSize: 10 }} />
                    )}
                    <Bar dataKey="kept"    name="เก็บ"    stackId="a" maxBarSize={16} fill="#f59e0b" radius={[0,0,0,0]} />
                    <Bar dataKey="sentCut" name="ส่งแล้ว" stackId="a" maxBarSize={16} fill="#3b82f6" radius={[0,0,0,0]} />
                    <Bar dataKey="newCut"  name="ตัดเพิ่ม"  stackId="a" maxBarSize={16} fill="#94a3b8" radius={[2,2,0,0]} />
                    {activeThreshold > 0 && (
                      <Customized component={(props: any) => (
                        <ChartRefLine {...props} threshold={activeThreshold} stroke="#f59e0b" labelText={`เก็บ ${formatBaht(activeThreshold)}`} />
                      )} />
                    )}
                    {committedThreshold != null && committedThreshold > 0 && committedThreshold !== activeThreshold && (
                      <Customized component={(props: any) => (
                        <ChartRefLine {...props} threshold={committedThreshold} stroke="#f43f5e" labelText={`ส่งแล้ว ${formatBaht(committedThreshold)}`} strokeDasharray="4 2" strokeWidth={1.5} />
                      )} />
                    )}
                  </BarChart>
                </ResponsiveContainer>
              </div>
              {/* Footer legend */}
              <div className="px-5 py-2 border-t border-border flex items-center gap-4 text-xs text-slate-500 shrink-0">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block"/>เก็บ</span>
                {totalAlreadySent > 0 && <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block"/>ส่งแล้ว</span>}
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-slate-400 inline-block"/>ตัดเพิ่ม</span>
                <span className="ml-auto text-[10px] text-slate-600">คลิกพื้นที่ด้านนอกเพื่อปิด</span>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
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
