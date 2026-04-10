'use client';
import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { roundsApi, betsApi, customersApi } from '@/lib/api';
import { Round, Customer } from '@/types';
import { useRouter } from 'next/navigation';

// ─── Constants ────────────────────────────────────────────────────────────────
const BET_TYPES = [
  { value: 'all',           label: 'ทุกประเภท' },
  { value: '3digit_top',    label: '3 ตัวบน'   },
  { value: '3digit_tote',   label: '3 ตัวโต็ด'  },
  { value: '3digit_back',   label: '3 ตัวล่าง'  },
  { value: '2digit_top',    label: '2 ตัวบน'   },
  { value: '2digit_bottom', label: '2 ตัวล่าง'  },
  { value: '1digit_top',    label: 'วิ่งบน'    },
  { value: '1digit_bottom', label: 'วิ่งล่าง'   },
];

const BET_TYPE_LABEL: Record<string, string> = {
  '3digit_top':    '3 ตัวบน',
  '3digit_tote':   '3 ตัวโต็ด',
  '3digit_back':   '3 ตัวล่าง',
  '2digit_top':    '2 ตัวบน',
  '2digit_bottom': '2 ตัวล่าง',
  '1digit_top':    'วิ่งบน',
  '1digit_bottom': 'วิ่งล่าง',
};

type SearchMode = 'top' | 'has' | 'exceed';

interface ResultRow {
  rank: number;
  number: string;
  bet_type: string;
  total_amount: number;
  bet_count?: number | null;
  sheet_no?: number | null;
  customer_name?: string | null;
}

function fNum(v: number) {
  return Math.round(v).toLocaleString('th-TH');
}

// ─── Form pieces ──────────────────────────────────────────────────────────────
function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-sm text-slate-300 w-28 shrink-0">{children}</span>;
}

function Sel({
  value, onChange, children, disabled,
}: {
  value: string; onChange: (v: string) => void;
  children: React.ReactNode; disabled?: boolean;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded px-2 py-1 focus:outline-none focus:border-blue-400 disabled:opacity-40"
    >
      {children}
    </select>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BetsSearchPage() {
  const router = useRouter();

  const [rounds, setRounds]       = useState<Round[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [roundId, setRoundId]     = useState('');

  const [mode, setMode]               = useState<SearchMode>('top');
  // top
  const [topLimit, setTopLimit]       = useState(10);
  const [topType, setTopType]         = useState('all');
  // has
  const [hasCust, setHasCust]         = useState('all');
  const [hasType, setHasType]         = useState('all');
  const [hasNum, setHasNum]           = useState('');
  // exceed
  const [exdCust, setExdCust]         = useState('all');
  const [exdType, setExdType]         = useState('all');
  const [exdAmt, setExdAmt]           = useState(0);

  const [rows, setRows]         = useState<ResultRow[]>([]);
  const [searched, setSearched] = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  useEffect(() => {
    Promise.all([roundsApi.list(), customersApi.list()]).then(([r, c]) => {
      const rl: Round[] = r.data.rounds ?? [];
      setRounds(rl);
      if (rl.length > 0) setRoundId(rl[0].id);
      setCustomers(c.data.customers ?? []);
    }).catch(() => {});
  }, []);

  const doSearch = useCallback(async () => {
    if (!roundId) { setError('กรุณาเลือกงวด'); return; }
    setLoading(true); setError('');
    try {
      const params: Parameters<typeof betsApi.search>[0] = { round_id: roundId, mode };
      if (mode === 'top') {
        if (topType !== 'all') params.bet_type = topType;
        params.limit = topLimit;
      } else if (mode === 'has') {
        if (hasType !== 'all') params.bet_type    = hasType;
        if (hasCust !== 'all') params.customer_id = hasCust;
        if (hasNum.trim())     params.number       = hasNum.trim();
      } else {
        if (exdType !== 'all') params.bet_type    = exdType;
        if (exdCust !== 'all') params.customer_id = exdCust;
        params.min_amount = exdAmt;
      }
      const res = await betsApi.search(params);
      setRows(res.data.rows ?? []);
      setSearched(true);
    } catch {
      setError('เกิดข้อผิดพลาดในการค้นหา');
    } finally {
      setLoading(false);
    }
  }, [roundId, mode, topLimit, topType, hasCust, hasType, hasNum, exdCust, exdType, exdAmt]);

  const isHas = mode === 'has';

  return (
    <AppShell>
      <Header title="ค้นหารายการขาย" />

      <div className="flex flex-1 overflow-hidden p-4 gap-4 min-h-0">

        {/* ── Left: Results Table ── */}
        <div className="flex flex-col flex-1 min-w-0 bg-slate-800 border border-slate-700 rounded-lg overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-slate-700 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-slate-300 font-medium text-xs w-12">ลำดับ</th>
                  <th className="px-3 py-2 text-left text-slate-300 font-medium text-xs">เลข</th>
                  <th className="px-3 py-2 text-right text-slate-300 font-medium text-xs">ราคา</th>
                  <th className="px-3 py-2 text-left text-slate-300 font-medium text-xs">ประเภทเลข</th>
                  <th className="px-3 py-2 text-center text-slate-300 font-medium text-xs w-20">
                    {isHas ? 'แผนที่' : 'รายการ'}
                  </th>
                  <th className="px-3 py-2 text-left text-slate-300 font-medium text-xs">ลูกค้า</th>
                </tr>
              </thead>
              <tbody>
                {!searched && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-500 py-20 text-sm">
                      กรอกเงื่อนไขแล้วกด{' '}
                      <span className="text-blue-400 font-medium">ค้นหา</span>{' '}
                      เพื่อดูผลลัพธ์
                    </td>
                  </tr>
                )}
                {searched && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-slate-500 py-20 text-sm">ไม่พบรายการ</td>
                  </tr>
                )}
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-t border-slate-700/50 hover:bg-slate-700/30 transition-colors ${
                      i % 2 === 1 ? 'bg-slate-800/60' : ''
                    }`}
                  >
                    <td className="px-3 py-1.5 text-slate-500 text-xs">{row.rank}</td>
                    <td className="px-3 py-1.5 font-mono text-base text-slate-100 font-bold tracking-widest">{row.number}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-amber-300 font-semibold">{fNum(Number(row.total_amount))}</td>
                    <td className="px-3 py-1.5 text-slate-300 text-xs">{BET_TYPE_LABEL[row.bet_type] ?? row.bet_type}</td>
                    <td className="px-3 py-1.5 text-center text-slate-400 text-xs">
                      {isHas ? (row.sheet_no ?? '-') : (row.bet_count ?? '-')}
                    </td>
                    <td className="px-3 py-1.5 text-slate-300 text-xs">{row.customer_name ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Status bar */}
          {searched && (
            <div className="shrink-0 border-t border-slate-700 px-4 py-2 flex gap-4 text-xs text-slate-400">
              <span>พบ <span className="text-slate-200 font-semibold">{rows.length}</span> รายการ</span>
              {rows.length > 0 && (
                <span>ยอดรวม{' '}
                  <span className="text-amber-300 font-semibold">
                    {fNum(rows.reduce((s, r) => s + Number(r.total_amount), 0))}
                  </span>{' '}บาท
                </span>
              )}
            </div>
          )}
        </div>

        {/* ── Right: Search Panel ── */}
        <div className="w-80 shrink-0 flex flex-col gap-3 overflow-y-auto">

          {/* Round */}
          <div className="bg-slate-800 border border-slate-700 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <Label>งวด</Label>
              <Sel value={roundId} onChange={setRoundId}>
                {rounds.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </Sel>
            </div>
          </div>

          {/* Mode 1: top */}
          <ModeCard
            active={mode === 'top'}
            label="ค้นหายอดขายสูงสุด"
            onActivate={() => setMode('top')}
          >
            <div className="flex items-center gap-2">
              <Label>จำนวน</Label>
              <input
                type="number" min={1} max={1000}
                value={topLimit}
                onChange={(e) => setTopLimit(Math.max(1, parseInt(e.target.value) || 1))}
                className="w-20 bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded px-2 py-1 text-right focus:outline-none focus:border-blue-400"
              />
              <span className="text-sm text-slate-400 shrink-0">รายการ</span>
            </div>
            <div className="flex items-center gap-2">
              <Label>ประเภท</Label>
              <Sel value={topType} onChange={setTopType}>
                {BET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Sel>
            </div>
          </ModeCard>

          {/* Mode 2: has */}
          <ModeCard
            active={mode === 'has'}
            label="ค้นหาเลขที่มีรายการขาย"
            onActivate={() => setMode('has')}
          >
            <div className="flex items-center gap-2">
              <Label>ลูกค้า</Label>
              <Sel value={hasCust} onChange={setHasCust}>
                <option value="all">ทั้งหมด</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Sel>
            </div>
            <div className="flex items-center gap-2">
              <Label>ประเภท</Label>
              <Sel value={hasType} onChange={setHasType}>
                {BET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Sel>
            </div>
            <div className="flex items-center gap-2">
              <Label>เลข</Label>
              <input
                type="text" maxLength={4}
                value={hasNum}
                onChange={(e) => setHasNum(e.target.value.replace(/\D/g, ''))}
                placeholder="ทั้งหมด"
                className="flex-1 bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-400 placeholder:text-slate-500"
              />
            </div>
          </ModeCard>

          {/* Mode 3: exceed */}
          <ModeCard
            active={mode === 'exceed'}
            label="ค้นหายอดขายมากกว่า"
            onActivate={() => setMode('exceed')}
          >
            <div className="flex items-center gap-2">
              <Label>ลูกค้า</Label>
              <Sel value={exdCust} onChange={setExdCust}>
                <option value="all">ทั้งหมด</option>
                {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Sel>
            </div>
            <div className="flex items-center gap-2">
              <Label>ประเภท</Label>
              <Sel value={exdType} onChange={setExdType}>
                {BET_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </Sel>
            </div>
            <div className="flex items-center gap-2">
              <Label>ยอดขายมากกว่า</Label>
              <input
                type="number" min={0}
                value={exdAmt}
                onChange={(e) => setExdAmt(Math.max(0, parseInt(e.target.value) || 0))}
                className="w-24 bg-slate-700 border border-slate-600 text-slate-100 text-sm rounded px-2 py-1 text-right focus:outline-none focus:border-blue-400"
              />
              <span className="text-sm text-slate-400 shrink-0">บาท</span>
            </div>
          </ModeCard>

          {error && <p className="text-red-400 text-xs px-1">{error}</p>}

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={doSearch}
              disabled={loading}
              className="flex-1 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800/60 text-white font-semibold text-sm py-2 rounded transition-colors"
            >
              {loading ? 'กำลังค้นหา...' : 'ค้นหา'}
            </button>
            <button
              onClick={() => router.back()}
              className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-200 font-semibold text-sm py-2 rounded transition-colors"
            >
              จบการทำงาน
            </button>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

// ─── ModeCard ─────────────────────────────────────────────────────────────────
function ModeCard({
  active, label, onActivate, children,
}: {
  active: boolean;
  label: string;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`bg-slate-800 border rounded-lg p-3 cursor-pointer transition-colors ${
        active ? 'border-blue-500/60' : 'border-slate-700 hover:border-slate-600'
      }`}
      onClick={onActivate}
    >
      <label className="flex items-center gap-2 cursor-pointer mb-3 select-none">
        <input
          type="radio" name="search-mode" readOnly
          checked={active}
          onChange={onActivate}
          className="accent-blue-500"
        />
        <span className="text-sm font-semibold text-slate-100">{label}</span>
      </label>
      <div
        className={`flex flex-col gap-2 transition-opacity ${
          active ? 'opacity-100' : 'opacity-40 pointer-events-none'
        }`}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}
