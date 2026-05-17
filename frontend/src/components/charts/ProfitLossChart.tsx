'use client';
import { useMemo } from 'react';
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Legend,
} from 'recharts';
import { formatBaht, formatPercent, roundChartAxisLabel, cn } from '@/lib/utils';
import type { Round } from '@/types';

export type RoundProfitExtra = { profit: number; sellTotal: number };

interface Props {
  rounds: Round[];
  profitByRoundId?: Record<string, RoundProfitExtra>;
  loadingProfit?: boolean;
}

const axisTickProps = {
  fill: 'var(--chart-axis)',
  fontSize: 13,
  fontFamily: 'var(--font-inter), var(--font-thai), system-ui, sans-serif',
  letterSpacing: '-0.01em',
  style: { fontVariantNumeric: 'tabular-nums' as const },
};

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload as {
    sales: number;
    profit: number | null;
    profitPct: number | null;
    status: string;
  };
  return (
    <div
      className="rounded-xl border px-3 py-2.5 text-sm shadow-lg min-w-[188px]"
      style={{
        background: 'var(--chart-tooltip-bg)',
        color: 'var(--chart-tooltip-fg)',
        borderColor: 'var(--chart-tooltip-border)',
      }}
    >
      <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--chart-tooltip-muted)' }}>
        {label}
      </p>
      <div className="space-y-1.5">
        <div className="flex justify-between gap-4 tabular-nums">
          <span style={{ color: 'var(--chart-tooltip-muted)' }}>ยอดขาย</span>
          <span className="font-semibold">{formatBaht(row.sales)}</span>
        </div>
        {row.status === 'drawn' && row.profit != null ? (
          <>
            <div className="flex justify-between gap-4 tabular-nums">
              <span style={{ color: 'var(--chart-tooltip-muted)' }}>กำไรสุทธิ</span>
              <span className={cn('font-semibold', row.profit >= 0 ? 'text-[var(--chart-profit)]' : 'text-[var(--color-semantic-danger-muted)]')}>
                {row.profit >= 0 ? '+' : ''}{formatBaht(row.profit)}
              </span>
            </div>
            {row.profitPct != null && row.sales > 0 ? (
              <div className="flex justify-between gap-4 tabular-nums text-xs pt-0.5 border-t border-[var(--color-border)]/60 mt-1.5 pt-1.5">
                <span style={{ color: 'var(--chart-tooltip-muted)' }}>% กำไร / ยอดขาย</span>
                <span className="font-semibold">{formatPercent(row.profitPct, 2)}</span>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[11px] italic" style={{ color: 'var(--chart-tooltip-muted)' }}>
            ยังไม่ออกผล — แสดงเฉพาะยอดรับระหว่างรับแทง
          </p>
        )}
      </div>
    </div>
  );
}

export function ProfitLossChart({ rounds, profitByRoundId = {}, loadingProfit }: Props) {
  const data = useMemo(() => {
    return rounds
      .slice()
      .reverse()
      .slice(0, 14)
      .map((r) => {
        const extra = profitByRoundId[r.id];
        const sales = extra?.sellTotal ?? Number(r.total_revenue ?? 0);
        const profit = r.status === 'drawn' && extra != null ? extra.profit : null;
        const profitPct = profit != null && sales > 0 ? (profit / sales) * 100 : null;
        return {
          name: roundChartAxisLabel(r),
          sales,
          profit,
          profitPct,
          status: r.status,
        };
      });
  }, [rounds, profitByRoundId]);

  const maxMoney = data.length
    ? Math.max(...data.flatMap((d) => [d.sales, d.profit ?? -Infinity]), 0)
    : 0;
  const minProfit = data.length ? Math.min(...data.map((d) => (d.profit != null ? d.profit : 0)), 0) : 0;

  if (!data.length) {
    return (
      <div className="h-56 flex items-center justify-center text-xs text-theme-text-muted">
        ไม่มีข้อมูล
      </div>
    );
  }

  return (
    <div className="relative h-56 p-3">
      {loadingProfit ? (
        <div className="absolute right-3 top-2 z-[1] rounded-full bg-[var(--bg-glass-subtle)] border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-medium text-theme-text-muted">
          โหลดกำไร…
        </div>
      ) : null}
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 14, left: 4, bottom: 22 }}>
          <defs>
            <linearGradient id="dashSalesFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4a90e2" stopOpacity={0.42} />
              <stop offset="55%" stopColor="#93c5fd" stopOpacity={0.14} />
              <stop offset="100%" stopColor="#bfdbfe" stopOpacity={0.03} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey="name"
            interval={0}
            tick={axisTickProps}
            axisLine={false}
            tickLine={false}
            height={36}
            tickMargin={8}
          />
          <YAxis
            yAxisId="left"
            tick={axisTickProps}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`}
            width={46}
            domain={[Math.min(minProfit * 1.05, 0), Math.max(maxMoney * 1.08, 1)]}
          />
          <YAxis
            yAxisId="right"
            orientation="right"
            tick={axisTickProps}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `${Math.round(v)}%`}
            width={36}
            domain={['auto', 'auto']}
          />
          <Tooltip content={<ChartTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="square"
            payload={[
              { value: 'ยอดขาย', type: 'square', id: 'sales', color: '#4a90e2' },
              { value: 'กำไรสุทธิ', type: 'square', id: 'profit', color: '#4caf50' },
              { value: '% กำไร/ขาย', type: 'square', id: 'profitPct', color: '#a855f7' },
            ]}
          />
          <ReferenceLine yAxisId="left" y={0} stroke="var(--chart-ref-line)" />
          <Area
            yAxisId="left"
            type="monotone"
            dataKey="sales"
            name="sales"
            stroke="#4a90e2"
            strokeWidth={2}
            fill="url(#dashSalesFill)"
            dot={false}
          />
          <Line
            yAxisId="left"
            type="monotone"
            dataKey="profit"
            name="profit"
            stroke="var(--chart-profit)"
            strokeWidth={2.5}
            dot={{ r: 4, strokeWidth: 2, fill: '#fff', stroke: 'var(--chart-profit)' }}
            activeDot={{ r: 6 }}
            connectNulls={false}
          />
          <Line
            yAxisId="right"
            type="monotone"
            dataKey="profitPct"
            name="profitPct"
            stroke="#a855f7"
            strokeWidth={2}
            strokeDasharray="5 5"
            dot={false}
            connectNulls={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
