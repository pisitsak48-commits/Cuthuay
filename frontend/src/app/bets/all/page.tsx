'use client';
import { useEffect, useState, useRef, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { roundsApi, reportsApi } from '@/lib/api';
import { useAuthStore } from '@/store/useStore';
import { buildPrintSlipBrandStrip, openPrintPreview } from '@/lib/printPreview';
import { themeHex } from '@/lib/printColorTokens';
import { PRINT_FONT_FAMILY, PRINT_GOOGLE_FONTS_HREF, PRINT_ROOT_INLINE_STYLE } from '@/lib/printTypography';
import { BET_TYPE_LABELS, BetType, Round } from '@/types';

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ─── Types ────────────────────────────────────────────────────────────────────
interface BetViewRow { number: string; bet_type: string; sold: number; sent: number; remaining: number }
interface BetViewResult { rows: BetViewRow[]; total_sold: number; total_sent: number; total_remaining: number }

interface Threshold { id: number; amount: number; color: string }

/** โทนระดับความเสี่ยงยอดขาย: เย็น → ร้อน — ยอดสูงใช้แดงเข้มให้เห็นชัดว่าต้องระวัง */
const PRESET_COLORS = [
  { label: 'เย็น · เทาน้ำเงิน', value: '#475569' },
  { label: 'เย็น · ฟ้าเข้ม', value: '#0369a1' },
  { label: 'กลางเย็น · มรกต', value: '#0f766e' },
  { label: 'กลาง · ทองเหลือง', value: '#a16207' },
  { label: 'ร้อน · ส้ม', value: '#c2410c' },
  { label: 'เตือน · แดง', value: '#dc2626' },
  { label: 'เสี่ยงสูง · แดงเข้ม', value: '#7f1d1d' },
];

const DEFAULT_THRESHOLDS: Threshold[] = [
  { id: 1, amount: 1000, color: '#475569' },
  { id: 2, amount: 1500, color: '#dc2626' },
];

function loadThresholds(): Threshold[] {
  if (typeof window === 'undefined') return DEFAULT_THRESHOLDS;
  try {
    const raw = localStorage.getItem('betview_thresholds');
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_THRESHOLDS;
}

function saveThresholds(t: Threshold[]) {
  try { localStorage.setItem('betview_thresholds', JSON.stringify(t)); } catch { /* ignore */ }
}

function getThresholdColor(sold: number, thresholds: Threshold[]): string | null {
  // Find highest threshold that is <= sold
  const sorted = [...thresholds].sort((a, b) => b.amount - a.amount);
  for (const t of sorted) {
    if (sold >= t.amount) return t.color;
  }
  return null;
}

const BET_TYPE_ORDER: BetType[] = [
  '3digit_top', '3digit_tote', '3digit_back',
  '2digit_top', '2digit_bottom', '1digit_top', '1digit_bottom',
];

type SortMode = 'number_asc' | 'number_desc' | 'sold_desc' | 'remaining_desc';
const SORT_LABELS: Record<SortMode, string> = {
  number_asc: 'เรียงตามเลข ↑', number_desc: 'เรียงตามเลข ↓',
  sold_desc: 'ยอดขายมากสุด', remaining_desc: 'ยอดเหลือมากสุด',
};

function formatN(v: number): string {
  return v === 0 ? '0' : v.toLocaleString('th-TH', { maximumFractionDigits: 0 });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildBetTableHtml(
  title: string,
  rows: BetViewRow[],
  totalSold: number,
  totalSent: number,
  totalRemaining: number,
  prependInnerHtml?: string,
): string {
  const body = rows.map((row, idx) => `
    <tr class="${idx % 2 === 0 ? 'even' : 'odd'}">
      <td class="num" style="text-align:center;color:${themeHex.primary600};font-weight:700;letter-spacing:0.06em">${escapeHtml(row.number)}</td>
      <td class="num blue"><span style="font-weight:600;color:${themeHex.textPrimary}">${formatN(row.sold)}</span></td>
      <td class="num neg"><span style="font-weight:400">${formatN(row.sent)}</span></td>
      <td class="num pos"><span style="font-weight:400">${formatN(row.remaining)}</span></td>
    </tr>
  `).join('');

  return `
    <div class="print-sheet" style="margin:0 0 18px 0;${PRINT_ROOT_INLINE_STYLE};">
      <style>
        @import url('${PRINT_GOOGLE_FONTS_HREF}');
        table { width:100%; border-collapse:collapse; font-size:13px; background:${themeHex.surface}; margin-bottom:12px; }
        th, td { border:1px solid ${themeHex.gray200}; padding:6px 8px; }
        th { background:${themeHex.gray100}; color:${themeHex.textPrimary}; font-family:${PRINT_FONT_FAMILY}; font-size:13px; font-weight:600; }
        td { font-family:${PRINT_FONT_FAMILY}; font-variant-numeric:tabular-nums; font-size:13px; color:${themeHex.textPrimary}; }
        .num { text-align:right; font-family:inherit; font-variant-numeric:tabular-nums; font-size:13px; }
        .blue { color:${themeHex.textPrimary}; }
        .neg { color:${themeHex.textSecondary}; }
        .pos { color:${themeHex.textPrimary}; font-weight:600; }
        .even { background:${themeHex.gray50}; }
        .odd { background:${themeHex.surface}; }
        tfoot td { background:${themeHex.gray100}; font-weight:600; font-family:${PRINT_FONT_FAMILY}; color:${themeHex.textPrimary}; }
      </style>
      ${prependInnerHtml ?? ''}
      <div style="font-weight:700;font-size:16px;margin:0 0 6px 0;">${escapeHtml(title)}</div>
      <table>
        <thead>
          <tr>
            <th>เลข</th>
            <th>ขาย</th>
            <th>ส่ง</th>
            <th>เหลือ</th>
          </tr>
        </thead>
        <tbody>
          ${body || `<tr><td colspan="4" style="border:1px solid ${themeHex.gray200};padding:8px;text-align:center;color:${themeHex.textSecondary};font-family:${PRINT_FONT_FAMILY};">ไม่มีข้อมูล</td></tr>`}
        </tbody>
        <tfoot>
          <tr>
            <td>รวม</td>
            <td class="num blue"><span style="font-weight:400">${formatN(totalSold)}</span></td>
            <td class="num neg"><span style="font-weight:400">${formatN(totalSent)}</span></td>
            <td class="num pos"><span style="font-weight:400">${formatN(totalRemaining)}</span></td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

/** คอลัมน์กว้างขึ้นเล็กน้อย + ตัวเลขอ่านง่ายขึ้น */
const CELL_GRID_TEMPLATE = 'minmax(4.25rem,0.42fr) minmax(5rem,1fr) minmax(4.5rem,1fr) minmax(5rem,1fr)';

// ─── One cell in the grid ─────────────────────────────────────────────────────
function GridCell({ row, rowIndex, fontSize, thresholds }: { row: BetViewRow; rowIndex: number; fontSize: number; thresholds: Threshold[] }) {
  const soldColor = getThresholdColor(row.sold, thresholds);
  const rowBg = rowIndex % 2 === 0 ? 'bg-surface-50' : 'bg-[var(--color-surface)]';
  const padY = fontSize >= 13 ? 'py-2' : 'py-1.5';
  return (
    <div
      className={`grid border-b border-[var(--color-border)] hover:bg-[var(--bg-hover)] transition-colors duration-200 [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))] ${rowBg}`}
      style={{ fontSize, gridTemplateColumns: CELL_GRID_TEMPLATE, lineHeight: 1.35 }}
    >
      <div
        className={`px-2 sm:px-2.5 ${padY} tabular-nums font-bold tracking-widest text-[var(--color-accent-hover)] border-r border-[var(--color-border)] text-center bg-[var(--bg-glass-subtle)]`}
      >
        {row.number}
      </div>
      <div
        className={`px-2 sm:px-2.5 ${padY} text-right tracking-tight font-semibold border-r border-[var(--color-border)] ${
          soldColor ? '' : 'text-theme-text-secondary'
        }`}
        style={soldColor ? { color: soldColor } : undefined}
      >
        {formatN(row.sold)}
      </div>
      <div className={`px-2 sm:px-2.5 ${padY} text-right  tracking-tight font-semibold border-r border-[var(--color-border)] ${row.sent > 0 ? 'text-neutral' : 'text-theme-text-muted'}`}>
        {formatN(row.sent)}
      </div>
      <div className={`px-2 sm:px-2.5 ${padY} text-right  tracking-tight font-semibold border-r-0 sm:border-r border-[var(--color-border)] ${row.remaining > 0 ? 'text-theme-text-primary font-bold' : 'text-theme-text-muted'}`}>
        {formatN(row.remaining)}
      </div>
    </div>
  );
}

// ─── Column header ─────────────────────────────────────────────────────────────
function ColHeader({ fontSize }: { fontSize: number }) {
  return (
    <div
      className="grid border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] sticky top-0 z-10 select-none shadow-[var(--shadow-soft)]"
      style={{ fontSize: Math.max(fontSize, 11), gridTemplateColumns: CELL_GRID_TEMPLATE }}
    >
      <div className="px-2 sm:px-2.5 py-2 text-[var(--color-accent-hover)] font-semibold border-r border-[var(--color-border)] text-center tracking-wide">
        เลข
      </div>
      <div className="px-2 sm:px-2.5 py-2 text-theme-text-secondary font-semibold text-right border-r border-[var(--color-border)]">ขาย</div>
      <div className="px-2 sm:px-2.5 py-2 text-theme-text-secondary font-semibold text-right border-r border-[var(--color-border)]">ส่ง</div>
      <div className="px-2 sm:px-2.5 py-2 text-theme-text-secondary font-semibold text-right border-r-0 sm:border-r border-[var(--color-border)]">เหลือ</div>
    </div>
  );
}

// ─── Threshold Settings Modal ─────────────────────────────────────────────────
function ThresholdPanel({ thresholds, onChange, onClose }: { thresholds: Threshold[]; onChange: (t: Threshold[]) => void; onClose: () => void }) {
  const nextId = useRef(Math.max(0, ...thresholds.map(t => t.id)) + 1);
  const panelRef = useRef<HTMLDivElement>(null);
  // local draft amounts (string) to allow free typing without mid-sort jumps
  const [draftAmounts, setDraftAmounts] = useState<Record<number, string>>(() =>
    Object.fromEntries(thresholds.map(t => [t.id, String(t.amount)]))
  );

  const addRow = () => {
    const newT: Threshold = { id: nextId.current++, amount: 500, color: PRESET_COLORS[3]!.value };
    setDraftAmounts(d => ({ ...d, [newT.id]: '500' }));
    onChange([...thresholds, newT].sort((a, b) => a.amount - b.amount));
  };

  // update color immediately, update amount only on blur
  const updateColor = (id: number, color: string) => {
    onChange(thresholds.map(t => t.id === id ? { ...t, color } : t).sort((a, b) => a.amount - b.amount));
  };
  const commitAmount = (id: number) => {
    const val = parseInt(draftAmounts[id] ?? '') || 0;
    onChange(thresholds.map(t => t.id === id ? { ...t, amount: val } : t).sort((a, b) => a.amount - b.amount));
  };

  const update = (id: number, patch: Partial<Threshold>) => {
    onChange(thresholds.map(t => t.id === id ? { ...t, ...patch } : t).sort((a, b) => a.amount - b.amount));
  };

  const remove = (id: number) => onChange(thresholds.filter(t => t.id !== id));

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
    focusable[0]?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const nodes = panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR);
      if (!nodes.length) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      const active = document.activeElement as HTMLElement | null;
      if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };

    panel.addEventListener('keydown', onKeyDown);
    return () => panel.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 bg-[var(--color-backdrop-overlay)] flex items-center justify-center z-50"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="threshold-panel-title"
        aria-describedby="threshold-panel-desc"
        className="ui-surface p-5 w-[380px] flex flex-col gap-3"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <div>
            <div id="threshold-panel-title" className="text-sm font-semibold text-theme-text-primary">ตั้งค่าสีแจ้งเตือนยอดขาย</div>
            <div id="threshold-panel-desc" className="text-sm text-theme-text-muted mt-0.5 leading-snug">
              ไล่โทนจากเย็นไปร้อนตามความเสี่ยง — ยอดสูงควรเป็นโทนร้อน/แดงเข้ม · คอลัมน์ขายเปลี่ยนสีเมื่อถึงขั้นที่กำหนด
            </div>
          </div>
          <button onClick={onClose} aria-label="ปิดหน้าต่างตั้งค่าสี" className="text-theme-text-muted hover:text-theme-text-secondary text-xl leading-none ml-4">×</button>
        </div>

        <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
          {thresholds.length === 0 && (
            <div className="text-sm text-theme-text-muted text-center py-3">ยังไม่มีการกำหนดยอด</div>
          )}
          {[...thresholds].sort((a, b) => a.amount - b.amount).map((t) => (
            <div key={t.id} className="flex items-center gap-2 bg-surface-50/60 rounded px-3 py-2">
              <span className="text-sm text-theme-text-muted w-10 shrink-0">ถึง</span>
              <input
                type="number" min={1} value={draftAmounts[t.id] ?? t.amount}
                onChange={e => setDraftAmounts(d => ({ ...d, [t.id]: e.target.value }))}
                onBlur={() => commitAmount(t.id)}
                className="w-28 h-11 bg-surface-default border border-border rounded px-3 text-sm tracking-tight text-theme-text-primary text-right focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
              />
              <span className="text-sm text-theme-text-muted shrink-0">สี</span>
              <div className="flex gap-1.5 flex-wrap flex-1">
                {PRESET_COLORS.map(pc => (
                  <button key={pc.value} title={pc.label}
                    onClick={() => updateColor(t.id, pc.value)}
                    aria-label={`เลือกสี ${pc.label}`}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${t.color === pc.value ? 'border-[var(--text-inverse)] scale-110' : 'border-transparent hover:border-border-bright'}`}
                    style={{ backgroundColor: pc.value }}
                  />
                ))}
              </div>
              <button onClick={() => remove(t.id)}
                aria-label={`ลบเงื่อนไขยอด ${t.amount.toLocaleString()}`}
                className="text-theme-text-muted hover:text-loss text-lg leading-none shrink-0">×</button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-border">
          <button onClick={addRow}
            className="btn-primary-glow h-11 px-4 text-sm rounded-xl">
            + เพิ่มยอด
          </button>
          {thresholds.length > 0 && (
            <div className="flex gap-1.5 items-center flex-1 flex-wrap">
              <span className="text-sm text-theme-text-muted">ตัวอย่าง:</span>
              {[...thresholds].sort((a, b) => a.amount - b.amount).map(t => (
                <span key={t.id} className="text-sm tracking-tight font-semibold px-2 py-0.5 rounded"
                  style={{ color: t.color, backgroundColor: `${t.color}22` }}>
                  {t.amount.toLocaleString()}
                </span>
              ))}
            </div>
          )}
          <button onClick={onClose}
            className="btn-toolbar-glow btn-toolbar-muted !h-11 px-4 text-sm ml-auto rounded-2xl">
            ปิด
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
function BetsAllInner() {
  const searchParams = useSearchParams();
  const roundFromUrl = searchParams.get('round') ?? '';
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

  const [rounds, setRounds]             = useState<Array<{ id: string; name: string }>>([]);
  const [roundId, setRoundId]           = useState(searchParams.get('round') ?? '');
  const [activeBetType, setActiveBetType] = useState<BetType | 'all'>('3digit_top');
  const [sortMode, setSortMode]         = useState<SortMode>('number_asc');
  const [fontSize, setFontSize]         = useState(13);
  const [autoRefreshMin, setAutoRefreshMin] = useState(5);
  const [loading, setLoading]           = useState(false);
  const [data, setData]                 = useState<BetViewResult | null>(null);
  const [tab, setTab]                   = useState<'by_type' | 'total'>('by_type');
  const [cols, setCols]                 = useState(4);
  const [thresholds, setThresholds]     = useState<Threshold[]>(DEFAULT_THRESHOLDS);
  const [showThresholdPanel, setShowThresholdPanel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const intervalRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch rounds (ผู้ปฏิบัติงาน: เลือกได้เฉพาะงวดเปิดรับ)
  useEffect(() => {
    roundsApi.list().then(r => {
      const full: Round[] = r.data.rounds ?? [];
      const list = isAdmin ? full : full.filter((x: Round) => x.status === 'open');
      setRounds(list.map(({ id, name }) => ({ id, name })));
      setRoundId((prev) => {
        if (prev && list.some((x) => x.id === prev)) return prev;
        if (roundFromUrl && list.some((x) => x.id === roundFromUrl)) return roundFromUrl;
        return list[0]?.id ?? '';
      });
    });
  }, [isAdmin, roundFromUrl]);

  // Load thresholds from localStorage
  useEffect(() => { setThresholds(loadThresholds()); }, []);

  const handleThresholdChange = (t: Threshold[]) => {
    setThresholds(t);
    saveThresholds(t);
  };

  // Fetch bet view
  const fetchData = useCallback(async () => {
    if (!roundId) return;
    setLoading(true);
    try {
      const bt = tab === 'total' || activeBetType === 'all' ? undefined : activeBetType;
      const res = await reportsApi.betView(roundId, bt);
      setData(res.data);
    } finally {
      setLoading(false);
    }
  }, [roundId, activeBetType, tab]);

  useEffect(() => { fetchData(); }, [roundId, activeBetType, tab]);

  // Auto-refresh
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(() => { fetchData(); }, autoRefreshMin * 60_000);
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [autoRefreshMin, fetchData]);

  // Sort rows
  const rows: BetViewRow[] = (() => {
    const src = data?.rows ?? [];
    switch (sortMode) {
      case 'number_asc':       return [...src].sort((a, b) => a.number.localeCompare(b.number));
      case 'number_desc':      return [...src].sort((a, b) => b.number.localeCompare(a.number));
      case 'sold_desc':        return [...src].sort((a, b) => b.sold - a.sold);
      case 'remaining_desc':   return [...src].sort((a, b) => b.remaining - a.remaining);
      default:                 return src;
    }
  })();

  // For "ยอดขายรวม" tab: aggregate across all types per number
  const totalRows: BetViewRow[] = (() => {
    if (tab !== 'total') return rows;
    const map: Record<string, BetViewRow> = {};
    (data?.rows ?? []).forEach(r => {
      if (!map[r.number]) map[r.number] = { number: r.number, bet_type: 'all', sold: 0, sent: 0, remaining: 0 };
      map[r.number].sold += r.sold;
      map[r.number].sent += r.sent;
      map[r.number].remaining += r.remaining;
    });
    const arr = Object.values(map);
    switch (sortMode) {
      case 'number_asc':  return arr.sort((a, b) => a.number.localeCompare(b.number));
      case 'number_desc': return arr.sort((a, b) => b.number.localeCompare(a.number));
      case 'sold_desc':   return arr.sort((a, b) => b.sold - a.sold);
      default:            return arr.sort((a, b) => b.remaining - a.remaining);
    }
  })();

  const displayRows = tab === 'total' ? totalRows : rows;

  // Split into `cols` columns
  const perCol = Math.ceil(displayRows.length / cols);
  const columnGroups: BetViewRow[][] = Array.from({ length: cols }, (_, i) =>
    displayRows.slice(i * perCol, (i + 1) * perCol),
  );

  const totalSold      = data?.total_sold ?? 0;
  const totalSent      = data?.total_sent ?? 0;
  const totalRemaining = data?.total_remaining ?? 0;

  const handleExportPdfCombined = useCallback(async () => {
    if (!roundId) return;
    setExportingPdf(true);
    try {
      const roundName = rounds.find(r => r.id === roundId)?.name ?? roundId;
      const res = await reportsApi.betView(roundId);
      const rowsAll: BetViewRow[] = res.data.rows ?? [];
      const map: Record<string, BetViewRow> = {};
      rowsAll.forEach(r => {
        if (!map[r.number]) map[r.number] = { number: r.number, bet_type: 'all', sold: 0, sent: 0, remaining: 0 };
        map[r.number].sold += r.sold;
        map[r.number].sent += r.sent;
        map[r.number].remaining += r.remaining;
      });
      const mergedRows = Object.values(map).sort((a, b) => a.number.localeCompare(b.number));
      const sold = mergedRows.reduce((s, r) => s + r.sold, 0);
      const sent = mergedRows.reduce((s, r) => s + r.sent, 0);
      const remaining = mergedRows.reduce((s, r) => s + r.remaining, 0);

      const banner = `
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;">
            <div style="font-size:18px;font-weight:800;">รายงานรายการขายรวม</div>
            <div style="font-size:12px;color:${themeHex.textSecondary};">งวด ${escapeHtml(roundName)}</div>
          </div>`;
      const html = `
        <div class="print-root" style="${PRINT_ROOT_INLINE_STYLE};font-size:12px;color:${themeHex.textPrimary};">
          ${buildPrintSlipBrandStrip()}
          ${buildBetTableHtml('รวมทุกประเภท', mergedRows, sold, sent, remaining, banner)}
        </div>
      `;
      openPrintPreview(html, `รายการขายรวม งวด ${roundName}`, `รายการขายรวม_${roundName}`);
    } finally {
      setExportingPdf(false);
    }
  }, [roundId, rounds]);

  const handleExportPdfByType = useCallback(async () => {
    if (!roundId) return;
    setExportingPdf(true);
    try {
      const roundName = rounds.find(r => r.id === roundId)?.name ?? roundId;
      const results = await Promise.all(BET_TYPE_ORDER.map(async (bt) => {
        const res = await reportsApi.betView(roundId, bt);
        return { bt, data: res.data as BetViewResult };
      }));

      const banner = `
          <div style="display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:10px;">
            <div style="font-size:18px;font-weight:800;">รายงานรายการขายแยกตามประเภท</div>
            <div style="font-size:12px;color:${themeHex.textSecondary};">งวด ${escapeHtml(roundName)}</div>
          </div>`;
      const sections = results.map(({ bt, data: section }, idx) => {
        const rowsForType = (section.rows ?? []).sort((a, b) => a.number.localeCompare(b.number));
        return buildBetTableHtml(
          BET_TYPE_LABELS[bt],
          rowsForType,
          section.total_sold,
          section.total_sent,
          section.total_remaining,
          idx === 0 ? banner : undefined,
        );
      }).join('');

      const html = `
        <div class="print-root" style="${PRINT_ROOT_INLINE_STYLE};font-size:12px;color:${themeHex.textPrimary};">
          ${buildPrintSlipBrandStrip()}
          ${sections}
        </div>
      `;
      openPrintPreview(html, `รายการขายแยกประเภท งวด ${roundName}`, `รายการขายแยกประเภท_${roundName}`);
    } finally {
      setExportingPdf(false);
    }
  }, [roundId, rounds]);

  return (
    <AppShell>
      <Header title="แสดงรายการขายทั้งหมด" subtitle={rounds.find(r => r.id === roundId)?.name ?? ''} />
      <main className="adapt-readable adapt-touch flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* ── Tabs ── */}
        <div className="flex gap-0 px-4 shrink-0 bg-[#f5f7fb] border-b border-[var(--color-border)]">
          {([['by_type', 'ยอดขายตามประเภท'], ['total', 'ยอดขายรวม']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === k
                  ? 'bg-white border-[var(--primary-600)] text-[var(--primary-600)]'
                  : 'bg-transparent border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Toolbar: กลุ่มตัวกรอง + แถวปุ่มเอกสาร แยกชัด ลดความรก ── */}
        <div className="shrink-0 border-b border-border bg-surface-100/50">
          <div className="flex flex-wrap gap-x-3 gap-y-2 items-center px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--bg-glass-subtle)] px-2.5 py-1.5">
              <select value={roundId} onChange={e => setRoundId(e.target.value)}
                className="h-11 rounded-lg bg-[var(--color-input-bg)] border border-border px-2.5 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] max-w-[11rem]">
                {rounds.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
              <button
                type="button"
                onClick={fetchData}
                className="btn-toolbar-glow btn-fintech-range !h-11 px-3 text-sm gap-1.5"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin shrink-0' : 'shrink-0'}>
                  <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                  <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
                </svg>
                ดึงข้อมูล
              </button>
              {tab === 'by_type' && (
                <>
                  <span className="text-sm text-theme-text-muted hidden sm:inline">ประเภท</span>
                  <select value={activeBetType} onChange={e => setActiveBetType(e.target.value as BetType | 'all')}
                    className="h-11 rounded-lg bg-[var(--color-input-bg)] border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] max-w-[10.5rem]">
                    <option value="all">ทั้งหมด</option>
                    {BET_TYPE_ORDER.map(bt => <option key={bt} value={bt}>{BET_TYPE_LABELS[bt]}</option>)}
                  </select>
                </>
              )}
              <span className="text-sm text-theme-text-muted hidden sm:inline">เรียง</span>
              <select value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}
                className="h-11 rounded-lg bg-[var(--color-input-bg)] border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] max-w-[10.5rem]">
                {(Object.keys(SORT_LABELS) as SortMode[]).map(k => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
            </div>

            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--color-border)] bg-[var(--bg-glass-subtle)] px-2.5 py-1.5">
              <span className="text-sm text-theme-text-muted">คอลัมน์</span>
              <select value={cols} onChange={e => setCols(parseInt(e.target.value))}
                className="h-11 w-16 rounded-lg bg-[var(--color-input-bg)] border border-border px-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
                {[2, 3, 4, 5, 6].map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <span className="text-sm text-theme-text-muted">ขนาด</span>
              <div className="flex items-center gap-0.5">
                <button type="button" onClick={() => setFontSize(f => Math.max(9, f - 1))}
                  className="h-11 w-11 rounded-lg border border-border bg-surface-200/90 text-theme-text-secondary hover:bg-surface-300/80 text-lg leading-none transition-colors">−</button>
                <span className="text-sm tracking-tight text-theme-text-primary w-8 text-center ">{fontSize}</span>
                <button type="button" onClick={() => setFontSize(f => Math.min(16, f + 1))}
                  className="h-11 w-11 rounded-lg border border-border bg-surface-200/90 text-theme-text-secondary hover:bg-surface-300/80 text-lg leading-none transition-colors">+</button>
              </div>
              <span className="text-sm text-theme-text-muted hidden md:inline">รีเฟรช</span>
              <input type="number" min={1} max={60} value={autoRefreshMin}
                title="ดึงข้อมูลอัตโนมัติ"
                onChange={e => setAutoRefreshMin(Math.max(1, parseInt(e.target.value) || 5))}
                className="h-11 w-14 rounded-lg bg-[var(--color-input-bg)] border border-border px-1 text-sm tracking-tight text-theme-text-primary text-center focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
              <span className="text-sm text-theme-text-muted hidden md:inline">นาที</span>
            </div>

            <div className="flex flex-wrap items-center gap-2 ml-auto">
              <span className="text-sm text-theme-text-muted whitespace-nowrap">{displayRows.length} เลข</span>
              {isAdmin && (
                <>
                  <button
                    type="button"
                    onClick={handleExportPdfCombined}
                    disabled={!roundId || exportingPdf}
                    className="btn-toolbar-glow btn-fintech-search !h-11 px-3 text-sm whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {exportingPdf ? 'กำลังสร้าง...' : 'PDF รวม'}
                  </button>
                  <button
                    type="button"
                    onClick={handleExportPdfByType}
                    disabled={!roundId || exportingPdf}
                    className="btn-toolbar-glow btn-fintech-spark !h-11 px-3 text-sm whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    PDF แยกประเภท
                  </button>
                </>
              )}
              <button
                type="button"
                onClick={() => setShowThresholdPanel(true)}
                className="btn-toolbar-glow btn-toolbar-muted !h-11 px-3 text-sm gap-1.5 whitespace-nowrap"
              >
                ตั้งค่าสี
                {thresholds.length > 0 && (
                  <span className="flex gap-0.5">
                    {[...thresholds].sort((a, b) => a.amount - b.amount).map(t => (
                      <span key={t.id} className="w-2 h-2 rounded-full inline-block ring-1 ring-[var(--color-border)]" style={{ backgroundColor: t.color }} />
                    ))}
                  </span>
                )}
              </button>
            </div>
          </div>
          {showThresholdPanel && (
            <ThresholdPanel thresholds={thresholds} onChange={handleThresholdChange} onClose={() => setShowThresholdPanel(false)} />
          )}
        </div>

        {/* ── Grid ── */}
        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-auto overscroll-contain">
          {loading && displayRows.length === 0 ? (
            <div className="flex items-center justify-center min-h-[8rem] text-theme-text-muted text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin mr-2">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
              กำลังโหลด...
            </div>
          ) : displayRows.length === 0 ? (
            <div className="flex items-center justify-center min-h-[8rem] text-theme-text-muted text-sm">ไม่มีข้อมูล</div>
          ) : (
            <div className="grid gap-1.5 sm:gap-2 p-1.5 sm:p-2 items-start content-start min-w-[52rem]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
              {columnGroups.map((group, ci) => (
                <div
                  key={ci}
                  className="ui-surface flex flex-col min-w-0"
                >
                  <ColHeader fontSize={fontSize} />
                  {group.map((row, ri) => (
                    <GridCell key={`${row.number}-${row.bet_type}-${ri}`} row={row} rowIndex={ri} fontSize={fontSize} thresholds={thresholds} />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer totals ── */}
        <div className="shrink-0 border-t border-border bg-surface-100/80 px-4 sm:px-6 py-2.5 flex flex-wrap gap-6 sm:gap-10 justify-center items-baseline">
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-theme-text-muted">รวมขาย</span>
            <span className="text-base font-bold  tracking-tight text-theme-text-primary">{formatN(totalSold)}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-theme-text-muted">รวมส่ง</span>
            <span className="text-base font-bold  tracking-tight text-neutral">{formatN(totalSent)}</span>
          </div>
          <div className="flex items-baseline gap-2">
            <span className="text-xs text-theme-text-muted">รวมเหลือ</span>
            <span className="text-base font-bold  tracking-tight text-theme-text-primary">{formatN(totalRemaining)}</span>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export default function BetsAllPage() {
  return <Suspense><BetsAllInner /></Suspense>;
}
