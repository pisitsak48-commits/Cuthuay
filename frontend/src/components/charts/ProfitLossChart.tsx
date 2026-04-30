'use client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formatBaht, roundChartAxisLabel } from '@/lib/utils';
import { Round } from '@/types';

interface Props {
  rounds: Round[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value as number;
  return (
    <div className="rounded-2xl border border-theme-card-border bg-[var(--color-card-bg-solid)] p-3 shadow-[var(--shadow-soft)] text-xs">
      <p className="text-theme-text-secondary mb-1">{label}</p>
      <p className={`font-mono font-semibold ${val >= 0 ? 'text-profit' : 'text-loss'}`}>
        {val >= 0 ? '+' : ''}{formatBaht(val)}
      </p>
    </div>
  );
}

export function ProfitLossChart({ rounds }: Props) {
  const data = rounds
    .slice()
    .reverse()
    .slice(0, 10)
    .map((r) => ({
      name: roundChartAxisLabel(r),
      revenue: Number(r.total_revenue ?? 0),
    }));

  if (!data.length) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-theme-text-muted">
        ไม่มีข้อมูล
      </div>
    );
  }

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 8 }}>
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="8%" stopColor="#22d3ee" stopOpacity={0.42} />
              <stop offset="45%" stopColor="#a78bfa" stopOpacity={0.18} />
              <stop offset="92%" stopColor="#f472b6" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="lineRevenue" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0%" stopColor="#22d3ee" />
              <stop offset="40%" stopColor="#818cf8" />
              <stop offset="72%" stopColor="#e879f9" />
              <stop offset="100%" stopColor="#f472b6" />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey="name"
            interval={0}
            tick={{ fill: 'var(--chart-axis)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            height={36}
          />
          <YAxis
            tick={{ fill: 'var(--chart-axis)', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="var(--chart-ref-line)" />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="url(#lineRevenue)"
            strokeWidth={2.75}
            fill="url(#colorRevenue)"
            dot={{ fill: '#22d3ee', r: 3.5, strokeWidth: 0 }}
            activeDot={{ r: 7, fill: '#f472b6', stroke: '#22d3ee', strokeWidth: 2 }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
