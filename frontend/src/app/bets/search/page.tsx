'use client';
import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { roundsApi, betsApi, customersApi } from '@/lib/api';
import { Round, Customer } from '@/types';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/useStore';

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
  return <span className="text-sm text-theme-text-secondary w-28 shrink-0">{children}</span>;
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
      className="flex-1 bg-surface-200 border border-border text-theme-text-primary text-sm rounded px-2 py-1 focus:outline-none focus:border-blue-400 disabled:opacity-40"
    >
      {children}
    </select>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BetsSearchPage() {
  const router = useRouter();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');

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
      const full: Round[] = r.data.rounds ?? [];
      const rl = isAdmin ? full : full.filter((x) => x.status === 'open');
      setRounds(rl);
      setRoundId((prev) => {
        if (prev && rl.some((x) => x.id === prev)) return prev;
        return rl[0]?.id ?? '';
      });
      setCustomers(c.data.customers ?? []);
    }).catch(() => {});
  }, [isAdmin]);

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

  const showLineDetail = mode === 'has' || mode === 'exceed';

  return (
    <AppShell>
      <Header title="ค้นหารายการขาย" />

      <div className="flex flex-1 overflow-hidden p-4 gap-4 min-h-0">

        {/* ── Left: Results Table ── */}
        <div className="flex flex-col flex-1 min-w-0 bg-surface-100 border border-border rounded-lg overflow-hidden">
          <div className="flex-1 overflow-auto">
            <table className="w-full text-sm border-collapse">
              <thead className="sticky top-0 bg-surface-200 z-10">
                <tr>
                  <th className="px-3 py-2 text-left text-theme-text-secondary font-medium text-xs w-12">ลำดับ</th>
                  <th className="px-3 py-2 text-left text-theme-text-secondary font-medium text-xs">เลข</th>
                  <th className="px-3 py-2 text-right text-theme-text-secondary font-medium text-xs">ราคา</th>
                  <th className="px-3 py-2 text-left text-theme-text-secondary font-medium text-xs">ประเภทเลข</th>
                  <th className="px-3 py-2 text-center text-theme-text-secondary font-medium text-xs w-20">
                    {showLineDetail ? 'แผ่นที่' : 'รายการ'}
                  </th>
                  <th className="px-3 py-2 text-left text-theme-text-secondary font-medium text-xs">ลูกค้า</th>
                </tr>
              </thead>
              <tbody>
                {!searched && (
                  <tr>
                    <td colSpan={6} className="text-center text-theme-text-muted py-20 text-sm">
                      กรอกเงื่อนไขแล้วกด{' '}
                      <span className="text-accent font-medium">ค้นหา</span>{' '}
                      เพื่อดูผลลัพธ์
                    </td>
                  </tr>
                )}
                {searched && rows.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-theme-text-muted py-20 text-sm">ไม่พบรายการ</td>
                  </tr>
                )}
                {rows.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-t border-border/50 hover:bg-surface-200/30 transition-colors ${
                      i % 2 === 1 ? 'bg-surface-100/60' : ''
                    }`}
                  >
                    <td className="px-3 py-1.5 text-theme-text-muted text-xs">{row.rank}</td>
                    <td className="px-3 py-1.5 font-mono text-base text-theme-text-primary font-bold tracking-widest">{row.number}</td>
                    <td className="px-3 py-1.5 text-right font-mono text-risk-medium font-semibold">{fNum(Number(row.total_amount))}</td>
                    <td className="px-3 py-1.5 text-theme-text-secondary text-xs">{BET_TYPE_LABEL[row.bet_type] ?? row.bet_type}</td>
                    <td className="px-3 py-1.5 text-center text-theme-text-secondary text-xs">
                      {showLineDetail ? (row.sheet_no ?? '-') : (row.bet_count ?? '-')}
                    </td>
                    <td className="px-3 py-1.5 text-theme-text-secondary text-xs">{row.customer_name ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Status bar */}
          {searched && (
            <div className="shrink-0 border-t border-border px-4 py-2 flex gap-4 text-xs text-theme-text-secondary">
              <span>พบ <span className="text-theme-text-primary font-semibold">{rows.length}</span> รายการ</span>
              {rows.length > 0 && (
                <span>ยอดรวม{' '}
                  <span className="text-risk-medium font-semibold">
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
          <div className="bg-surface-100 border border-border rounded-lg p-3">
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
                className="w-20 bg-surface-200 border border-border text-theme-text-primary text-sm rounded px-2 py-1 text-right focus:outline-none focus:border-blue-400"
              />
              <span className="text-sm text-theme-text-secondary shrink-0">รายการ</span>
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
                className="flex-1 bg-surface-200 border border-border text-theme-text-primary text-sm rounded px-2 py-1 font-mono focus:outline-none focus:border-blue-400 placeholder:text-theme-text-muted"
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
                className="w-24 bg-surface-200 border border-border text-theme-text-primary text-sm rounded px-2 py-1 text-right focus:outline-none focus:border-blue-400"
              />
              <span className="text-sm text-theme-text-secondary shrink-0">บาท</span>
            </div>
          </ModeCard>

          {error && <p className="text-loss text-xs px-1">{error}</p>}

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={doSearch}
              disabled={loading}
              className="btn-primary-glow flex-1 py-2.5 text-sm rounded-xl font-semibold disabled:bg-surface-300/60 disabled:hover:translate-y-0 disabled:shadow-none"
            >
              {loading ? 'กำลังค้นหา...' : 'ค้นหา'}
            </button>
            <button
              type="button"
              onClick={() => router.back()}
              className="btn-toolbar-glow btn-fintech-spark flex-1 py-2.5 text-sm font-semibold rounded-xl min-h-[2.75rem] gap-1"
            >
              <span aria-hidden>✓</span>
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
      className={`bg-surface-100 border rounded-lg p-3 cursor-pointer transition-colors ${
        active ? 'border-blue-500/60' : 'border-border hover:border-border'
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
        <span className="text-sm font-semibold text-theme-text-primary">{label}</span>
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
