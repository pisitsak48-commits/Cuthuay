'use client';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { formatBaht } from '@/lib/utils';
import { Round } from '@/types';

interface Props {
  rounds: Round[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const val = payload[0].value as number;
  return (
    <div className="rounded-lg border border-border bg-surface-100 p-3 shadow-xl text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className={`font-mono font-semibold ${val >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
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
      name: r.name.length > 12 ? r.name.slice(0, 12) + '…' : r.name,
      revenue: Number(r.total_revenue ?? 0),
    }));

  if (!data.length) {
    return (
      <div className="h-48 flex items-center justify-center text-xs text-slate-600">
        ไม่มีข้อมูล
      </div>
    );
  }

  return (
    <div className="h-52">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#22c55e" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fill: '#475569', fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="#334155" />
          <Area
            type="monotone"
            dataKey="revenue"
            stroke="#22c55e"
            strokeWidth={2}
            fill="url(#colorRevenue)"
            dot={{ fill: '#22c55e', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: '#22c55e' }}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
