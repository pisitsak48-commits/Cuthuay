'use client';

// Recharts uses SVG presentation attributes; CSS custom properties don't resolve there.
const CHART_SALES_COLOR  = '#2563eb'; // --chart-primary (blue-600)
const CHART_PROFIT_COLOR = '#22c55e'; // --chart-profit (green-500)
const CHART_LOSS_COLOR   = '#ef4444'; // --color-semantic-danger (red-500)

import { useCallback, useEffect, useMemo, useState, Fragment } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
  Cell,
} from 'recharts';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Button } from '@/components/ui/Button';
import { Card, CardTitle } from '@/components/ui/Card';
import { RoundStatusBadge } from '@/components/ui/Badge';
import { roundsApi, reportsApi } from '@/lib/api';
import { APP_BRAND_NAME } from '@/lib/brand';
import { buddhistEraYearFromDrawDate, cn, formatBaht, roundChartAxisLabel } from '@/lib/utils';
import type { Round } from '@/types';

const MAX_DRAWN_PROFIT_FETCH = 80;
const FETCH_CONCURRENCY = 5;

type CompareCust = {
  customer_id: string;
  name: string;
  sold: number;
  payout: number;
  net: number;
  remaining_sold: number;
};

type CompareDealer = {
  dealer_id: string;
  name: string;
  sent: number;
  payout: number;
  net: number;
  remaining_sent: number;
};

type ProfitPayload = {
  profit: number;
  sell: { total: number; payout: number; remaining: number; net: number };
  customers: CompareCust[];
  dealers: CompareDealer[];
};

type RowState =
  | { kind: 'drawn'; round: Round; data: ProfitPayload }
  | { kind: 'drawn_error'; round: Round; error: string }
  | { kind: 'pending'; round: Round }
  | { kind: 'nodraw'; round: Round };

async function poolMap<T, R>(items: T[], concurrency: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, Math.max(items.length, 1)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) break;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export default function SummaryComparePage() {
  const defaultYearBE = useMemo(() => new Date().getFullYear() + 543, []);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [rows, setRows] = useState<RowState[]>([]);
  const [loadingProfit, setLoadingProfit] = useState(false);
  const [fetchTruncated, setFetchTruncated] = useState(false);
  const [yearFilter, setYearFilter] = useState<number | 'all'>(defaultYearBE);
  const [listError, setListError] = useState<string | null>(null);
  const [expandedRoundIds, setExpandedRoundIds] = useState<Set<string>>(() => new Set());

  const toggleExpandRound = useCallback((id: string) => {
    setExpandedRoundIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setLoadingList(true);
      setListError(null);
      try {
        const res = await roundsApi.list();
        const list = (res.data as { rounds?: Round[] })?.rounds ?? [];
        if (!cancelled) setRounds(Array.isArray(list) ? list : []);
      } catch {
        if (!cancelled) {
          setListError('โหลดรายการงวดไม่สำเร็จ');
          setRounds([]);
        }
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableYearsBE = useMemo(() => {
    const set = new Set<number>();
    for (const r of rounds) {
      set.add(buddhistEraYearFromDrawDate(r.draw_date));
    }
    return Array.from(set).sort((a, b) => b - a);
  }, [rounds]);

  useEffect(() => {
    if (!availableYearsBE.length) return;
    setYearFilter((prev) => {
      if (prev === 'all') return prev;
      if (!availableYearsBE.includes(prev)) return availableYearsBE[0] ?? prev;
      return prev;
    });
  }, [availableYearsBE]);

  const filteredRounds = useMemo(() => {
    let list = [...rounds];
    if (yearFilter !== 'all') {
      list = list.filter((r) => buddhistEraYearFromDrawDate(r.draw_date) === yearFilter);
    }
    list.sort((a, b) => new Date(b.draw_date).getTime() - new Date(a.draw_date).getTime());
    return list;
  }, [rounds, yearFilter]);

  const loadProfits = useCallback(async () => {
    const drawn = filteredRounds.filter((r) => r.status === 'drawn');
    const capped = drawn.slice(0, MAX_DRAWN_PROFIT_FETCH);
    setFetchTruncated(drawn.length > capped.length);

    const initialRows: RowState[] = filteredRounds.map((r) =>
      r.status === 'drawn'
        ? capped.some((c) => c.id === r.id)
          ? ({ kind: 'pending', round: r } as const)
          : ({ kind: 'drawn_error', round: r, error: 'ไม่อยู่ในช่วงโหลด (เกินขีดจำกัด) — เลือกปี พ.ศ. ให้แคบลง' } as const)
        : ({ kind: 'nodraw', round: r } as const),
    );

    setRows(initialRows);

    if (!capped.length) {
      setLoadingProfit(false);
      return;
    }

    setLoadingProfit(true);
    try {
      const results = await poolMap(capped, FETCH_CONCURRENCY, async (round) => {
        try {
          const res = await reportsApi.profitSummary(round.id);
          const raw = res.data as Record<string, unknown>;
          const sell = raw.sell as ProfitPayload['sell'];
          const data: ProfitPayload = {
            profit: Number(raw.profit ?? 0),
            sell: {
              total: Number(sell?.total ?? 0),
              payout: Number(sell?.payout ?? 0),
              remaining: Number(sell?.remaining ?? 0),
              net: Number(sell?.net ?? 0),
            },
            customers: Array.isArray(raw.customers) ? (raw.customers as CompareCust[]) : [],
            dealers: Array.isArray(raw.dealers) ? (raw.dealers as CompareDealer[]) : [],
          };
          return { ok: true as const, round, data };
        } catch {
          return { ok: false as const, round, error: 'โหลดสรุปไม่สำเร็จ' };
        }
      });

      const profitMap = new Map<string, ProfitPayload | 'err'>();
      for (const x of results) {
        if (x.ok) profitMap.set(x.round.id, x.data);
        else profitMap.set(x.round.id, 'err');
      }

      setRows(
        filteredRounds.map((r): RowState => {
          if (r.status !== 'drawn') return { kind: 'nodraw', round: r };
          if (!capped.some((c) => c.id === r.id)) {
            return { kind: 'drawn_error', round: r, error: 'เกินจำนวนงวดสูงสุดต่อการโหลด — เลือกปี พ.ศ.' };
          }
          const p = profitMap.get(r.id);
          if (p === 'err') return { kind: 'drawn_error', round: r, error: 'โหลดสรุปไม่สำเร็จ' };
          if (!p) return { kind: 'pending', round: r };
          return { kind: 'drawn', round: r, data: p };
        }),
      );
    } finally {
      setLoadingProfit(false);
    }
  }, [filteredRounds]);

  useEffect(() => {
    if (loadingList) return;
    void loadProfits();
  }, [loadingList, loadProfits]);

  const aggregates = useMemo(() => {
    let salesSum = 0;
    let salesDrawnSum = 0;
    let profitSum = 0;
    let payoutSum = 0;
    let drawnWithProfit = 0;
    const roundsTotal = filteredRounds.length;

    for (const row of rows) {
      const rev = Number(row.round.total_revenue ?? 0);
      if (row.kind === 'drawn') {
        salesSum += row.data.sell.total;
        salesDrawnSum += row.data.sell.total;
        profitSum += row.data.profit;
        payoutSum += row.data.sell.payout;
        drawnWithProfit++;
      } else if (row.kind === 'nodraw' || row.kind === 'drawn_error' || row.kind === 'pending') {
        salesSum += rev;
      }
    }

    const avgProfit = drawnWithProfit > 0 ? profitSum / drawnWithProfit : null;
    const marginPct =
      salesDrawnSum > 0 && drawnWithProfit > 0 ? (profitSum / salesDrawnSum) * 100 : null;

    return {
      salesSum,
      profitSum,
      payoutSum,
      drawnWithProfit,
      roundsTotal,
      avgProfit,
      marginPct,
    };
  }, [rows, filteredRounds.length]);

  const chartData = useMemo(() => {
    const chronological = [...rows].reverse();
    const out: {
      name: string;
      sales: number;
      profit: number | null;
      key: string;
    }[] = [];
    for (const row of chronological) {
      if (row.kind === 'drawn') {
        out.push({
          name: roundChartAxisLabel(row.round),
          sales: row.data.sell.total,
          profit: row.data.profit,
          key: row.round.id,
        });
      } else if (row.kind === 'nodraw' || row.kind === 'drawn_error' || row.kind === 'pending') {
        out.push({
          name: roundChartAxisLabel(row.round),
          sales: Number(row.round.total_revenue ?? 0),
          profit: null,
          key: row.round.id,
        });
      }
    }
    return out.slice(-24);
  }, [rows]);

  /** รวมทุกงวดที่โหลดสรุปแล้วในมุมมอง — ใช้เปรียบเทียบข้ามงวด */
  const rolledCustomerTotals = useMemo(() => {
    const m = new Map<
      string,
      { name: string; sold: number; payout: number; net: number; rounds: number }
    >();
    for (const row of rows) {
      if (row.kind !== 'drawn') continue;
      for (const c of row.data.customers) {
        const prev = m.get(c.customer_id) ?? {
          name: c.name,
          sold: 0,
          payout: 0,
          net: 0,
          rounds: 0,
        };
        m.set(c.customer_id, {
          name: c.name || prev.name,
          sold: prev.sold + Number(c.sold ?? 0),
          payout: prev.payout + Number(c.payout ?? 0),
          net: prev.net + Number(c.net ?? 0),
          rounds: prev.rounds + 1,
        });
      }
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.sold - a.sold);
  }, [rows]);

  const rolledDealerTotals = useMemo(() => {
    const m = new Map<
      string,
      { name: string; sent: number; payout: number; net: number; rounds: number }
    >();
    for (const row of rows) {
      if (row.kind !== 'drawn') continue;
      for (const d of row.data.dealers) {
        const prev = m.get(d.dealer_id) ?? {
          name: d.name,
          sent: 0,
          payout: 0,
          net: 0,
          rounds: 0,
        };
        m.set(d.dealer_id, {
          name: d.name || prev.name,
          sent: prev.sent + Number(d.sent ?? 0),
          payout: prev.payout + Number(d.payout ?? 0),
          net: prev.net + Number(d.net ?? 0),
          rounds: prev.rounds + 1,
        });
      }
    }
    return [...m.entries()]
      .map(([id, v]) => ({ id, ...v }))
      .sort((a, b) => b.sent - a.sent);
  }, [rows]);

  const csvExport = () => {
    const header = ['งวด', 'วันออก', 'สถานะ', 'ยอดขาย', 'จ่ายรางวัล', 'กำไรสุทธิ', '%กำไร/ขาย'];
    const lines = [header.join(',')];
    for (const row of rows) {
      const r = row.round;
      const status = r.status;
      const dateStr = new Date(r.draw_date.includes('T') ? r.draw_date : `${r.draw_date}T12:00:00`).toISOString().slice(0, 10);
      if (row.kind === 'drawn') {
        const s = row.data.sell.total;
        const pct = s > 0 ? ((row.data.profit / s) * 100).toFixed(2) : '';
        lines.push(
          [
            `"${String(r.name).replace(/"/g, '""')}"`,
            dateStr,
            status,
            row.data.sell.total,
            row.data.sell.payout,
            row.data.profit,
            pct,
          ].join(','),
        );
      } else {
        lines.push(
          [`"${String(r.name).replace(/"/g, '""')}"`, dateStr, status, Number(r.total_revenue ?? 0), '', '', ''].join(','),
        );
      }
    }
    const blob = new Blob(['\ufeff', lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `สรุปเทียบงวด_${yearFilter === 'all' ? 'ทั้งหมด' : `พศ${yearFilter}`}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const axisTickProps = {
    fill: 'var(--chart-axis)',
    fontSize: 11,
    fontFamily: 'var(--font-inter), var(--font-thai), system-ui, sans-serif',
    style: { fontVariantNumeric: 'tabular-nums' as const },
  };

  return (
    <AppShell>
      <Header
        title="เทียบทุกงวด · สรุปรายปี"
        subtitle={`${APP_BRAND_NAME} · ข้อมูลจากสรุปหลังออกผล (งวดที่ยังไม่ออกผลแสดงยอดรับระหว่างรับแทง)`}
        variant="prominent"
      />

      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-[1600px] mx-auto space-y-4">
          <div className="flex flex-col lg:flex-row lg:items-center gap-3 justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <label className="text-sm text-theme-text-secondary shrink-0">ปี พ.ศ.</label>
              <select
                value={yearFilter === 'all' ? 'all' : String(yearFilter)}
                onChange={(e) => setYearFilter(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                disabled={loadingList}
                className="h-9 rounded-lg bg-[var(--color-input-bg)] border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] min-w-[11rem]"
              >
                <option value="all">ทั้งหมดในระบบ</option>
                {availableYearsBE.map((y) => (
                  <option key={y} value={y}>
                    พ.ศ. {y}
                  </option>
                ))}
              </select>
              <Button type="button" variant="outline" size="sm" onClick={() => void loadProfits()} disabled={loadingList || loadingProfit}>
                {loadingProfit ? 'กำลังโหลดสรุป…' : 'รีเฟรชข้อมูล'}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={csvExport} disabled={!rows.length}>
                Export CSV
              </Button>
            </div>
            <div className="text-xs text-theme-text-muted max-w-xl leading-relaxed">
              เทียบยอดขายและกำไรต่องวดในปีที่เลือก · โหลดสรุปกำไรสูงสุด {MAX_DRAWN_PROFIT_FETCH} งวดที่ออกผลแล้วต่อครั้ง (เรียงใหม่สุดก่อน)
              {fetchTruncated ? (
                <span className="block mt-1 text-[var(--color-badge-warning-text)] font-medium">
                  มีงวดที่ออกผลเกินขีดจำกัด — ให้เลือกปี พ.ศ. เพื่อโหลดครบ
                </span>
              ) : null}
            </div>
          </div>

          {listError ? (
            <p className="text-sm text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2">
              {listError}
            </p>
          ) : null}

          {/* KPI */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              {
                label: 'ยอดขายรวม (ในมุมมอง)',
                sub:
                  yearFilter === 'all'
                    ? `${filteredRounds.length} งวด`
                    : `พ.ศ. ${yearFilter} · ${filteredRounds.length} งวด`,
                value: aggregates.salesSum,
                cls: 'text-profit',
              },
              {
                label: 'จ่ายรางวัลรวม',
                sub: `จากงวดที่ออกผล ${aggregates.drawnWithProfit} งวด`,
                value: aggregates.payoutSum,
                cls: 'text-loss',
              },
              {
                label: 'กำไรสุทธิรวม',
                sub: aggregates.avgProfit != null ? `เฉลี่ยต่องวด ${formatBaht(aggregates.avgProfit)}` : '—',
                value: aggregates.profitSum,
                cls: aggregates.profitSum >= 0 ? 'text-profit' : 'text-loss',
              },
              {
                label: '% กำไรต่อยอดขาย',
                sub: aggregates.marginPct != null ? 'คิดจากยอดรวมในมุมมอง' : 'ต้องมีงวดที่ออกผลแล้ว',
                value: aggregates.marginPct != null ? `${aggregates.marginPct.toFixed(2)}%` : '—',
                cls: 'text-accent',
                raw: true,
              },
            ].map((k) => (
              <Card key={k.label} className="p-4 rounded-2xl border border-[var(--color-border)]/70 shadow-[var(--shadow-soft)] bg-gradient-to-b from-white to-[var(--color-bg-primary)]">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-theme-text-muted">{k.label}</p>
                <p className="text-xs text-theme-text-secondary mt-1">{k.sub}</p>
                <p className={cn('text-xl font-bold tabular-nums mt-2 tracking-tight', k.cls)}>
                  {'raw' in k && k.raw ? k.value : typeof k.value === 'number' ? formatBaht(k.value) : k.value}
                </p>
              </Card>
            ))}
          </div>

          {/* Chart */}
          {chartData.length > 1 ? (
            <Card className="p-0 overflow-hidden rounded-2xl border border-[var(--color-border)]/70 shadow-[var(--shadow-soft)]">
              <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)]">
                <CardTitle size="lg">กราฟเทียบยอดขายและกำไร</CardTitle>
                <p className="text-xs text-theme-text-muted mt-1">สูงสุด {chartData.length} งวดล่าสุดในมุมมอง (เรียงจากซ้าย = เก่า → ขวา = ใหม่)</p>
              </div>
              <div className="p-4 h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 8, right: 12, left: 4, bottom: 28 }} barGap={4}>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 4" vertical={false} />
                    <XAxis dataKey="name" tick={axisTickProps} interval={0} angle={-28} textAnchor="end" height={56} axisLine={false} tickLine={false} />
                    <YAxis tick={axisTickProps} tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`} width={44} axisLine={false} tickLine={false} />
                    <Tooltip
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null;
                        const pl = payload[0]?.payload as { sales: number; profit: number | null };
                        return (
                          <div
                            className="rounded-xl border px-3 py-2 text-sm shadow-lg"
                            style={{
                              background: 'var(--chart-tooltip-bg)',
                              borderColor: 'var(--chart-tooltip-border)',
                              color: 'var(--chart-tooltip-fg)',
                            }}
                          >
                            <p className="text-xs font-semibold mb-1 opacity-80">{label}</p>
                            <p className="tabular-nums">ยอดขาย {formatBaht(pl.sales)}</p>
                            {pl.profit != null ? (
                              <p className={cn('tabular-nums font-semibold', pl.profit >= 0 ? 'text-[var(--chart-profit)]' : 'text-loss')}>
                                กำไร {formatBaht(pl.profit)}
                              </p>
                            ) : (
                              <p className="text-[11px] opacity-70 italic">ยังไม่มีข้อมูลกำไร</p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Legend
                      wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
                      iconType="square"
                      payload={[
                        { value: 'ยอดขาย', type: 'square', id: 'sales', color: CHART_SALES_COLOR },
                        { value: 'กำไร', type: 'square', id: 'profit', color: CHART_PROFIT_COLOR },
                      ]}
                    />
                    <ReferenceLine y={0} stroke="var(--chart-ref-line)" />
                    <Bar dataKey="sales" name="ยอดขาย" fill={CHART_SALES_COLOR} radius={[6, 6, 0, 0]} maxBarSize={28} />
                    <Bar dataKey="profit" name="กำไร" fill={CHART_PROFIT_COLOR} radius={[6, 6, 0, 0]} maxBarSize={28}>
                      {chartData.map((entry) => (
                        <Cell
                          key={entry.key}
                          fill={
                            entry.profit == null
                              ? 'transparent'
                              : entry.profit >= 0
                                ? CHART_PROFIT_COLOR
                                : CHART_LOSS_COLOR
                          }
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}

          {/* Table */}
          <Card className="p-0 overflow-hidden rounded-2xl border border-[var(--color-border)]/70 shadow-[var(--shadow-soft)]">
            <div className="px-5 py-4 border-b border-[var(--color-border)] flex flex-wrap items-center justify-between gap-3 bg-[var(--bg-glass-subtle)]">
              <CardTitle size="lg">ตารางเทียบทุกงวด</CardTitle>
              <Link href="/summary" className="text-xs font-semibold text-accent hover:underline">
                ← ไปสรุปรายงวด
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[980px]">
                <thead className="bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)]">
                  <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary">
                    <th className="py-3 pl-4 pr-1 w-12 text-center">รายละเอียด</th>
                    <th className="py-3 pl-2 pr-3">งวด</th>
                    <th className="py-3 px-3 whitespace-nowrap">วันออก</th>
                    <th className="py-3 px-3">สถานะ</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">ยอดขาย</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">จ่ายรางวัล</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">กำไรสุทธิ</th>
                    <th className="py-3 px-3 text-right whitespace-nowrap">% / ขาย</th>
                    <th className="py-3 pr-5 text-right whitespace-nowrap">จัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingList ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-theme-text-muted">
                        กำลังโหลดงวด…
                      </td>
                    </tr>
                  ) : rows.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="py-16 text-center text-theme-text-muted">
                        ไม่มีข้อมูลงวด
                      </td>
                    </tr>
                  ) : (
                    rows.map((row, i) => {
                      const r = row.round;
                      const dateLabel = new Date(r.draw_date.includes('T') ? r.draw_date : `${r.draw_date}T12:00:00`).toLocaleDateString('th-TH', {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                      });
                      const sales =
                        row.kind === 'drawn'
                          ? row.data.sell.total
                          : row.kind === 'pending'
                            ? null
                            : Number(r.total_revenue ?? 0);
                      const payout = row.kind === 'drawn' ? row.data.sell.payout : null;
                      const profit = row.kind === 'drawn' ? row.data.profit : null;
                      const pct =
                        row.kind === 'drawn' && row.data.sell.total > 0
                          ? (row.data.profit / row.data.sell.total) * 100
                          : null;
                      const canExpand = row.kind === 'drawn';
                      const open = expandedRoundIds.has(r.id);

                      return (
                        <Fragment key={r.id}>
                          <tr
                            className={cn(
                              'border-b border-[var(--color-border)]/70 hover:bg-[var(--bg-hover)]/80 transition-colors',
                              i % 2 === 1 && 'bg-[var(--bg-glass-subtle)]/35',
                            )}
                          >
                            <td className="py-3 pl-4 pr-1 text-center align-middle">
                              <button
                                type="button"
                                disabled={!canExpand}
                                onClick={() => canExpand && toggleExpandRound(r.id)}
                                className={cn(
                                  'inline-flex h-8 w-8 items-center justify-center rounded-lg text-xs font-bold border transition-colors',
                                  canExpand
                                    ? 'border-[var(--color-border)] bg-[var(--color-input-bg)] text-theme-text-primary hover:border-accent hover:text-accent'
                                    : 'border-transparent text-theme-text-muted opacity-40 cursor-not-allowed',
                                )}
                                title={canExpand ? (open ? 'ย่อรายลูกค้า/เจ้ามือ' : 'ขยายรายลูกค้า/เจ้ามือ') : 'เฉพาะงวดที่ออกผลแล้ว'}
                              >
                                {canExpand ? (open ? '−' : '+') : '·'}
                              </button>
                            </td>
                            <td className="py-3 pl-2 pr-3 font-semibold text-theme-text-primary whitespace-nowrap">{r.name}</td>
                            <td className="py-3 px-3 tabular-nums text-theme-text-muted text-xs whitespace-nowrap">{dateLabel}</td>
                            <td className="py-3 px-3">
                              <RoundStatusBadge status={r.status} />
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums font-medium whitespace-nowrap">
                              {sales != null ? formatBaht(sales) : <span className="text-theme-text-muted italic">…</span>}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums whitespace-nowrap">
                              {payout != null ? formatBaht(payout) : <span className="text-theme-text-muted">—</span>}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums font-semibold whitespace-nowrap">
                              {profit != null ? (
                                <span className={profit >= 0 ? 'text-profit' : 'text-loss'}>{formatBaht(profit)}</span>
                              ) : row.kind === 'drawn_error' ? (
                                <span className="text-[11px] text-loss">{row.error}</span>
                              ) : (
                                <span className="text-theme-text-muted">—</span>
                              )}
                            </td>
                            <td className="py-3 px-3 text-right tabular-nums text-xs whitespace-nowrap">
                              {pct != null ? `${pct.toFixed(2)}%` : '—'}
                            </td>
                            <td className="py-3 pr-5 text-right whitespace-nowrap">
                              <Link href={`/summary?round=${encodeURIComponent(r.id)}`}>
                                <span className="inline-flex rounded-full px-3 py-1 text-[11px] font-semibold bg-[var(--color-input-bg)] border border-[var(--color-border)] hover:border-accent hover:text-accent transition-colors cursor-pointer">
                                  เปิดสรุป
                                </span>
                              </Link>
                            </td>
                          </tr>
                          {open && row.kind === 'drawn' ? (
                            <tr className="bg-[var(--color-bg-primary)]/90 border-b border-[var(--color-border)]/70">
                              <td colSpan={9} className="p-0">
                                <div className="p-4 sm:p-5 grid grid-cols-1 xl:grid-cols-2 gap-5 border-t border-[var(--color-border)]/50">
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold uppercase tracking-wide text-theme-text-secondary mb-2">รายลูกค้า · งวด {r.name}</p>
                                    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-card-bg-solid)]">
                                      {row.data.customers.length === 0 ? (
                                        <p className="p-4 text-xs text-theme-text-muted">ไม่มีข้อมูลลูกค้าในงวดนี้</p>
                                      ) : (
                                        <table className="w-full text-xs">
                                          <thead className="bg-[var(--bg-glass-subtle)] text-theme-text-secondary">
                                            <tr>
                                              <th className="text-left py-2 pl-3 pr-2 font-semibold">ลูกค้า</th>
                                              <th className="text-right py-2 px-2 font-semibold whitespace-nowrap">ยอดขาย</th>
                                              <th className="text-right py-2 px-2 font-semibold whitespace-nowrap">จ่ายรางวัล</th>
                                              <th className="text-right py-2 pr-3 pl-2 font-semibold whitespace-nowrap">สุทธิ</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {[...row.data.customers].sort((a, b) => b.sold - a.sold).map((c) => (
                                              <tr key={c.customer_id} className="border-t border-[var(--color-border)]/50">
                                                <td className="py-2 pl-3 pr-2 font-medium text-theme-text-primary">{c.name}</td>
                                                <td className="py-2 px-2 text-right tabular-nums">{formatBaht(c.sold)}</td>
                                                <td className="py-2 px-2 text-right tabular-nums text-loss">{formatBaht(c.payout)}</td>
                                                <td className={cn('py-2 pr-3 pl-2 text-right tabular-nums font-semibold', c.net >= 0 ? 'text-profit' : 'text-loss')}>
                                                  {formatBaht(c.net)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  </div>
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold uppercase tracking-wide text-theme-text-secondary mb-2">รายเจ้ามือ · งวด {r.name}</p>
                                    <div className="overflow-x-auto rounded-xl border border-[var(--color-border)]/70 bg-[var(--color-card-bg-solid)]">
                                      {row.data.dealers.length === 0 ? (
                                        <p className="p-4 text-xs text-theme-text-muted">ไม่มีข้อมูลการส่งเจ้ามือในงวดนี้</p>
                                      ) : (
                                        <table className="w-full text-xs">
                                          <thead className="bg-[var(--bg-glass-subtle)] text-theme-text-secondary">
                                            <tr>
                                              <th className="text-left py-2 pl-3 pr-2 font-semibold">เจ้ามือ</th>
                                              <th className="text-right py-2 px-2 font-semibold whitespace-nowrap">ยอดส่ง</th>
                                              <th className="text-right py-2 px-2 font-semibold whitespace-nowrap">จ่ายรางวัล</th>
                                              <th className="text-right py-2 pr-3 pl-2 font-semibold whitespace-nowrap">สุทธิ</th>
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {[...row.data.dealers].sort((a, b) => b.sent - a.sent).map((d) => (
                                              <tr key={d.dealer_id} className="border-t border-[var(--color-border)]/50">
                                                <td className="py-2 pl-3 pr-2 font-medium text-theme-text-primary">{d.name}</td>
                                                <td className="py-2 px-2 text-right tabular-nums">{formatBaht(d.sent)}</td>
                                                <td className="py-2 px-2 text-right tabular-nums text-loss">{formatBaht(d.payout)}</td>
                                                <td className={cn('py-2 pr-3 pl-2 text-right tabular-nums font-semibold', d.net >= 0 ? 'text-profit' : 'text-loss')}>
                                                  {formatBaht(d.net)}
                                                </td>
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          {(rolledCustomerTotals.length > 0 || rolledDealerTotals.length > 0) && (
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
              {rolledCustomerTotals.length > 0 ? (
                <Card className="p-0 overflow-hidden rounded-2xl border border-[var(--color-border)]/70 shadow-[var(--shadow-soft)]">
                  <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)]">
                    <CardTitle size="lg">สรุปรายลูกค้ารวม</CardTitle>
                    <p className="text-xs text-theme-text-muted mt-1">
                      รวมจากงวดที่โหลดสรุปแล้วในมุมมองปัจจุบัน ({aggregates.drawnWithProfit} งวด)
                    </p>
                  </div>
                  <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                    <table className="w-full text-sm min-w-[520px]">
                      <thead className="sticky top-0 bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)] z-[1]">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary">
                          <th className="py-2.5 pl-5 pr-3">ลูกค้า</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">ยอดขายรวม</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">จ่ายรวม</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">สุทธิรวม</th>
                          <th className="py-2.5 pr-5 text-right whitespace-nowrap">งวด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rolledCustomerTotals.map((c, idx) => (
                          <tr key={c.id} className={cn('border-b border-[var(--color-border)]/60', idx % 2 === 1 && 'bg-[var(--bg-glass-subtle)]/40')}>
                            <td className="py-2.5 pl-5 pr-3 font-medium text-theme-text-primary">{c.name}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{formatBaht(c.sold)}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-loss">{formatBaht(c.payout)}</td>
                            <td className={cn('py-2.5 px-3 text-right tabular-nums font-semibold', c.net >= 0 ? 'text-profit' : 'text-loss')}>
                              {formatBaht(c.net)}
                            </td>
                            <td className="py-2.5 pr-5 text-right tabular-nums text-xs text-theme-text-muted">{c.rounds}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : null}

              {rolledDealerTotals.length > 0 ? (
                <Card className="p-0 overflow-hidden rounded-2xl border border-[var(--color-border)]/70 shadow-[var(--shadow-soft)]">
                  <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)]">
                    <CardTitle size="lg">สรุปรายเจ้ามือรวม</CardTitle>
                    <p className="text-xs text-theme-text-muted mt-1">
                      รวมจากงวดที่โหลดสรุปแล้วในมุมมองปัจจุบัน ({aggregates.drawnWithProfit} งวด)
                    </p>
                  </div>
                  <div className="overflow-x-auto max-h-[28rem] overflow-y-auto">
                    <table className="w-full text-sm min-w-[520px]">
                      <thead className="sticky top-0 bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)] z-[1]">
                        <tr className="text-left text-[11px] font-semibold uppercase tracking-wide text-theme-text-secondary">
                          <th className="py-2.5 pl-5 pr-3">เจ้ามือ</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">ส่งรวม</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">จ่ายรวม</th>
                          <th className="py-2.5 px-3 text-right whitespace-nowrap">สุทธิรวม</th>
                          <th className="py-2.5 pr-5 text-right whitespace-nowrap">งวด</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rolledDealerTotals.map((d, idx) => (
                          <tr key={d.id} className={cn('border-b border-[var(--color-border)]/60', idx % 2 === 1 && 'bg-[var(--bg-glass-subtle)]/40')}>
                            <td className="py-2.5 pl-5 pr-3 font-medium text-theme-text-primary">{d.name}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums">{formatBaht(d.sent)}</td>
                            <td className="py-2.5 px-3 text-right tabular-nums text-loss">{formatBaht(d.payout)}</td>
                            <td className={cn('py-2.5 px-3 text-right tabular-nums font-semibold', d.net >= 0 ? 'text-profit' : 'text-loss')}>
                              {formatBaht(d.net)}
                            </td>
                            <td className="py-2.5 pr-5 text-right tabular-nums text-xs text-theme-text-muted">{d.rounds}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
