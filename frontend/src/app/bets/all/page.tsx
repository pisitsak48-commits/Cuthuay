'use client';
import { useEffect, useState, useRef, Suspense, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { roundsApi, reportsApi } from '@/lib/api';
import { BET_TYPE_LABELS, BetType } from '@/types';

// ─── Types ────────────────────────────────────────────────────────────────────
interface BetViewRow { number: string; bet_type: string; sold: number; sent: number; remaining: number }
interface BetViewResult { rows: BetViewRow[]; total_sold: number; total_sent: number; total_remaining: number }

interface Threshold { id: number; amount: number; color: string }

const PRESET_COLORS = [
  { label: 'เหลือง',   value: '#eab308' },
  { label: 'ส้ม',      value: '#f97316' },
  { label: 'แดง',      value: '#ef4444' },
  { label: 'ชมพู',     value: '#ec4899' },
  { label: 'ม่วง',     value: '#a855f7' },
  { label: 'ฟ้า',      value: '#38bdf8' },
  { label: 'เขียว',    value: '#22c55e' },
];

const DEFAULT_THRESHOLDS: Threshold[] = [
  { id: 1, amount: 1000, color: '#f97316' },
  { id: 2, amount: 1500, color: '#ef4444' },
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

// ─── One cell in the grid ─────────────────────────────────────────────────────
function GridCell({ row, fontSize, thresholds }: { row: BetViewRow; fontSize: number; thresholds: Threshold[] }) {
  const soldColor = getThresholdColor(row.sold, thresholds);
  return (
    <div className="grid grid-cols-4 border-b border-border/40 hover:bg-surface-200/40 transition-colors"
      style={{ fontSize }}>
      <div className="px-1.5 py-[3px] font-mono font-bold text-blue-400 border-r border-border/30 bg-slate-900/30">
        {row.number}
      </div>
      <div className="px-1.5 py-[3px] text-right font-mono font-semibold border-r border-border/30 transition-colors"
        style={{ color: soldColor ?? '#e2e8f0' }}>
        {formatN(row.sold)}
      </div>
      <div className={`px-1.5 py-[3px] text-right font-mono border-r border-border/30 ${row.sent > 0 ? 'text-red-400' : 'text-slate-600'}`}>
        {formatN(row.sent)}
      </div>
      <div className={`px-1.5 py-[3px] text-right font-mono font-semibold ${row.remaining > 0 ? 'text-blue-300' : 'text-slate-600'}`}>
        {formatN(row.remaining)}
      </div>
    </div>
  );
}

// ─── Column header ─────────────────────────────────────────────────────────────
function ColHeader({ fontSize }: { fontSize: number }) {
  return (
    <div className="grid grid-cols-4 border-b border-border bg-surface-200 sticky top-0 z-10 select-none"
      style={{ fontSize }}>
      <div className="px-1.5 py-1 text-slate-400 font-semibold border-r border-border/30">เลข</div>
      <div className="px-1.5 py-1 text-slate-400 font-semibold text-right border-r border-border/30">ขาย</div>
      <div className="px-1.5 py-1 text-slate-400 font-semibold text-right border-r border-border/30">ส่ง</div>
      <div className="px-1.5 py-1 text-slate-400 font-semibold text-right">เหลือ</div>
    </div>
  );
}

// ─── Threshold Settings Modal ─────────────────────────────────────────────────
function ThresholdPanel({ thresholds, onChange, onClose }: { thresholds: Threshold[]; onChange: (t: Threshold[]) => void; onClose: () => void }) {
  const nextId = useRef(Math.max(0, ...thresholds.map(t => t.id)) + 1);

  const addRow = () => {
    const newT: Threshold = { id: nextId.current++, amount: 500, color: '#f97316' };
    onChange([...thresholds, newT].sort((a, b) => a.amount - b.amount));
  };

  const update = (id: number, patch: Partial<Threshold>) => {
    onChange(thresholds.map(t => t.id === id ? { ...t, ...patch } : t).sort((a, b) => a.amount - b.amount));
  };

  const remove = (id: number) => onChange(thresholds.filter(t => t.id !== id));

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-slate-800 border border-slate-600 rounded-lg shadow-2xl p-4 w-[380px] flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-slate-200">ตั้งค่าสีแจ้งเตือนยอดขาย</div>
            <div className="text-xs text-slate-500 mt-0.5">คอลัมน์ "ขาย" เปลี่ยนสีเมื่อถึงยอดที่กำหนด</div>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-xl leading-none ml-4">×</button>
        </div>

        <div className="flex flex-col gap-2 max-h-[320px] overflow-y-auto">
          {thresholds.length === 0 && (
            <div className="text-xs text-slate-600 text-center py-3">ยังไม่มีการกำหนดยอด</div>
          )}
          {[...thresholds].sort((a, b) => a.amount - b.amount).map((t) => (
            <div key={t.id} className="flex items-center gap-2 bg-slate-900/60 rounded px-3 py-2">
              <span className="text-xs text-slate-500 w-8 shrink-0">ถึง</span>
              <input
                type="number" min={1} value={t.amount}
                onChange={e => update(t.id, { amount: parseInt(e.target.value) || 0 })}
                className="w-24 h-7 bg-slate-900 border border-slate-600 rounded px-2 text-xs font-mono text-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
              <span className="text-xs text-slate-500 shrink-0">สี</span>
              <div className="flex gap-1.5 flex-wrap flex-1">
                {PRESET_COLORS.map(pc => (
                  <button key={pc.value} title={pc.label}
                    onClick={() => update(t.id, { color: pc.value })}
                    className={`w-5 h-5 rounded-full border-2 transition-all ${t.color === pc.value ? 'border-white scale-110' : 'border-transparent hover:border-slate-400'}`}
                    style={{ backgroundColor: pc.value }}
                  />
                ))}
              </div>
              <button onClick={() => remove(t.id)}
                className="text-slate-600 hover:text-red-400 text-lg leading-none shrink-0">×</button>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 pt-2 border-t border-slate-700">
          <button onClick={addRow}
            className="h-8 px-4 rounded bg-indigo-700 hover:bg-indigo-600 text-white text-xs font-semibold">
            + เพิ่มยอด
          </button>
          {thresholds.length > 0 && (
            <div className="flex gap-1.5 items-center flex-1 flex-wrap">
              <span className="text-xs text-slate-600">ตัวอย่าง:</span>
              {[...thresholds].sort((a, b) => a.amount - b.amount).map(t => (
                <span key={t.id} className="text-xs font-mono font-semibold px-2 py-0.5 rounded"
                  style={{ color: t.color, backgroundColor: `${t.color}22` }}>
                  {t.amount.toLocaleString()}
                </span>
              ))}
            </div>
          )}
          <button onClick={onClose}
            className="h-8 px-4 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-xs ml-auto">
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

  const [rounds, setRounds]             = useState<Array<{ id: string; name: string }>>([]);
  const [roundId, setRoundId]           = useState(searchParams.get('round') ?? '');
  const [activeBetType, setActiveBetType] = useState<BetType | 'all'>('3digit_top');
  const [sortMode, setSortMode]         = useState<SortMode>('number_asc');
  const [fontSize, setFontSize]         = useState(12);
  const [autoRefreshMin, setAutoRefreshMin] = useState(5);
  const [loading, setLoading]           = useState(false);
  const [data, setData]                 = useState<BetViewResult | null>(null);
  const [tab, setTab]                   = useState<'by_type' | 'total'>('by_type');
  const [cols, setCols]                 = useState(4);
  const [thresholds, setThresholds]     = useState<Threshold[]>(DEFAULT_THRESHOLDS);
  const [showThresholdPanel, setShowThresholdPanel] = useState(false);
  const intervalRef                     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Fetch rounds
  useEffect(() => {
    roundsApi.list().then(r => {
      const list = r.data.rounds ?? [];
      setRounds(list);
      if (!roundId && list.length) setRoundId(list[0].id);
    });
  }, []);

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

  return (
    <AppShell>
      <Header title="แสดงรายการขายทั้งหมด" subtitle={rounds.find(r => r.id === roundId)?.name ?? ''} />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden">

        {/* ── Tabs ── */}
        <div className="flex border-b border-border px-4 bg-surface-100/80 shrink-0">
          {([['by_type', 'ยอดขายตามประเภท'], ['total', 'ยอดขายรวม']] as const).map(([k, label]) => (
            <button key={k} onClick={() => setTab(k)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                tab === k ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-300'
              }`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Toolbar ── */}
        <div className="flex flex-wrap gap-2.5 items-center px-4 py-2.5 border-b border-border bg-surface-100/60 shrink-0">
          {/* Round */}
          <select value={roundId} onChange={e => setRoundId(e.target.value)}
            className="h-8 rounded-lg bg-surface-200 border border-border px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
            {rounds.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>

          {/* Refresh */}
          <button onClick={fetchData} className="h-8 px-3 rounded-lg bg-surface-200 border border-border text-xs text-slate-300 hover:bg-surface-300 flex items-center gap-1.5 transition-colors">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={loading ? 'animate-spin' : ''}>
              <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
            </svg>
            ดึงข้อมูล
          </button>

          {/* Bet type (only for by_type tab) */}
          {tab === 'by_type' && (
            <>
              <span className="text-xs text-slate-500">ประเภท</span>
              <select value={activeBetType} onChange={e => setActiveBetType(e.target.value as BetType | 'all')}
                className="h-8 rounded-lg bg-surface-200 border border-border px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
                <option value="all">ทั้งหมด</option>
                {BET_TYPE_ORDER.map(bt => <option key={bt} value={bt}>{BET_TYPE_LABELS[bt]}</option>)}
              </select>
            </>
          )}

          {/* Sort */}
          <span className="text-xs text-slate-500">เรียงตาม</span>
          <select value={sortMode} onChange={e => setSortMode(e.target.value as SortMode)}
            className="h-8 rounded-lg bg-surface-200 border border-border px-2.5 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
            {(Object.keys(SORT_LABELS) as SortMode[]).map(k => (
              <option key={k} value={k}>{SORT_LABELS[k]}</option>
            ))}
          </select>

          {/* Columns */}
          <span className="text-xs text-slate-500">คอลัมน์</span>
          <select value={cols} onChange={e => setCols(parseInt(e.target.value))}
            className="h-8 w-16 rounded-lg bg-surface-200 border border-border px-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
            {[2, 3, 4, 5, 6].map(c => <option key={c} value={c}>{c}</option>)}
          </select>

          {/* Font size */}
          <span className="text-xs text-slate-500">ขนาดอักษร</span>
          <div className="flex items-center gap-1">
            <button onClick={() => setFontSize(f => Math.max(9, f - 1))}
              className="h-7 w-7 rounded border border-border bg-surface-200 text-slate-300 hover:bg-surface-300 transition-colors text-sm leading-none">−</button>
            <span className="text-xs font-mono text-slate-300 w-6 text-center">{fontSize}</span>
            <button onClick={() => setFontSize(f => Math.min(16, f + 1))}
              className="h-7 w-7 rounded border border-border bg-surface-200 text-slate-300 hover:bg-surface-300 transition-colors text-sm leading-none">+</button>
          </div>

          {/* Auto refresh */}
          <span className="text-xs text-slate-500">ดึงข้อมูลทุก</span>
          <input type="number" min={1} max={60} value={autoRefreshMin}
            onChange={e => setAutoRefreshMin(Math.max(1, parseInt(e.target.value) || 5))}
            className="h-8 w-14 rounded-lg bg-surface-200 border border-border px-2 text-xs font-mono text-slate-200 text-center focus:outline-none focus:ring-1 focus:ring-accent" />
          <span className="text-xs text-slate-500">นาที</span>

          <span className="ml-auto text-xs text-slate-500">{displayRows.length} เลข</span>

          {/* Threshold settings */}
          <button onClick={() => setShowThresholdPanel(true)}
            className="h-8 px-3 rounded-lg border bg-surface-200 border-border text-slate-300 hover:bg-surface-300 text-xs flex items-center gap-1.5 transition-colors">
            🎨 ตั้งค่าสี
            {thresholds.length > 0 && (
              <span className="flex gap-0.5">
                {[...thresholds].sort((a, b) => a.amount - b.amount).map(t => (
                  <span key={t.id} className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: t.color }} />
                ))}
              </span>
            )}
          </button>
          {showThresholdPanel && (
            <ThresholdPanel thresholds={thresholds} onChange={handleThresholdChange} onClose={() => setShowThresholdPanel(false)} />
          )}
        </div>

        {/* ── Grid ── */}
        <div className="flex-1 min-h-0 overflow-auto">
          {loading && displayRows.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin mr-2">
                <polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/>
              </svg>
              กำลังโหลด...
            </div>
          ) : displayRows.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-slate-500 text-sm">ไม่มีข้อมูล</div>
          ) : (
            <div className={`grid h-full`} style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
              {columnGroups.map((group, ci) => (
                <div key={ci} className={`flex flex-col border-r border-border/30 ${ci === cols - 1 ? 'border-r-0' : ''}`}>
                  <ColHeader fontSize={fontSize} />
                  <div className="flex-1 overflow-auto">
                    {group.map((row, ri) => (
                      <GridCell key={`${row.number}-${row.bet_type}-${ri}`} row={row} fontSize={fontSize} thresholds={thresholds} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Footer totals ── */}
        <div className="shrink-0 border-t border-border bg-surface-100/80 px-6 py-2.5 flex gap-10 justify-center">
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">รวมขาย</span>
            <span className="text-base font-bold font-mono text-slate-100">{formatN(totalSold)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">รวมส่ง</span>
            <span className="text-base font-bold font-mono text-red-400">{formatN(totalSent)}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-xs text-slate-500">รวมเหลือ</span>
            <span className="text-base font-bold font-mono text-blue-400">{formatN(totalRemaining)}</span>
          </div>
        </div>
      </main>
    </AppShell>
  );
}

export default function BetsAllPage() {
  return <Suspense><BetsAllInner /></Suspense>;
}
