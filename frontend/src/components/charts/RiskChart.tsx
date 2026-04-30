'use client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { formatBaht, roundChartAxisLabel } from '@/lib/utils';
import { Round } from '@/types';

interface Props {
  rounds: Round[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-theme-card-border bg-[var(--color-card-bg-solid)] p-3 shadow-[var(--shadow-soft)] text-xs">
      <p className="text-theme-text-secondary mb-1">{label}</p>
      <p className="font-mono font-semibold text-theme-text-primary">
        {formatBaht(payload[0].value)}
      </p>
    </div>
  );
}

const COLORS = [
  'var(--chart-palette-1)',
  'var(--chart-palette-2)',
  'var(--chart-palette-3)',
  'var(--chart-palette-4)',
  'var(--chart-palette-5)',
  'var(--chart-palette-6)',
  'var(--chart-palette-7)',
];

export function RiskDistributionChart({ rounds }: Props) {
  const data = rounds
    .slice()
    .reverse()
    .slice(0, 8)
    .map((r, i) => ({
      name: roundChartAxisLabel(r),
      revenue: Number(r.total_revenue ?? 0),
      color: COLORS[i % COLORS.length],
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
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 8 }}>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
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
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--chart-tooltip-cursor)' }} />
          <Bar dataKey="revenue" radius={[10, 10, 0, 0]} maxBarSize={44}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} fillOpacity={0.92} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Risk Gauge (used on cut page) ───────────────────────────────────────────
interface GaugeProps {
  percent: number;
}

export function RiskGauge({ percent }: GaugeProps) {
  const clamped = Math.min(Math.max(percent, 0), 150);
  const color =
    clamped < 30  ? 'var(--chart-gauge-low)' :
    clamped < 60  ? 'var(--chart-gauge-mid)' :
    clamped < 100 ? 'var(--chart-gauge-high)' : 'var(--chart-gauge-crit)';

  const angle = (clamped / 150) * 180 - 90; // map 0-150% to -90..90 deg

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 120 70" width="140" height="82">
        {/* Track */}
        <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="var(--chart-grid)" strokeWidth="10" strokeLinecap="round" />
        {/* Value arc */}
        <path
          d="M10,60 A50,50 0 0,1 110,60"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 150) * 157} 157`}
        />
        {/* Needle */}
        <line
          x1="60" y1="60"
          x2={60 + 38 * Math.cos(((angle) * Math.PI) / 180)}
          y2={60 + 38 * Math.sin(((angle) * Math.PI) / 180)}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="60" cy="60" r="4" fill={color} />
        {/* Labels */}
        <text x="10" y="68" fill="var(--chart-axis)" fontSize="7" textAnchor="middle">0%</text>
        <text x="110" y="68" fill="var(--chart-axis)" fontSize="7" textAnchor="middle">150%</text>
      </svg>
      <p className="font-mono font-bold text-2xl" style={{ color }}>
        {percent.toFixed(1)}%
      </p>
    </div>
  );
}
