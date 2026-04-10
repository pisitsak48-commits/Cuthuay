'use client';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts';
import { formatBaht } from '@/lib/utils';
import { Round } from '@/types';

interface Props {
  rounds: Round[];
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface-100 p-3 shadow-xl text-xs">
      <p className="text-slate-400 mb-1">{label}</p>
      <p className="font-mono font-semibold text-slate-200">
        {formatBaht(payload[0].value)}
      </p>
    </div>
  );
}

const COLORS = ['#3b82f6', '#8b5cf6', '#06b6d4', '#f59e0b', '#ef4444', '#22c55e', '#ec4899'];

export function RiskDistributionChart({ rounds }: Props) {
  const data = rounds
    .slice()
    .reverse()
    .slice(0, 8)
    .map((r, i) => ({
      name: r.name.length > 10 ? r.name.slice(-8) : r.name,
      revenue: Number(r.total_revenue ?? 0),
      color: COLORS[i % COLORS.length],
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
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
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
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(59,130,246,0.06)' }} />
          <Bar dataKey="revenue" radius={[4, 4, 0, 0]} maxBarSize={40}>
            {data.map((entry, index) => (
              <Cell key={index} fill={entry.color} fillOpacity={0.85} />
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
    clamped < 30  ? '#22c55e' :
    clamped < 60  ? '#f59e0b' :
    clamped < 100 ? '#ef4444' : '#dc2626';

  const angle = (clamped / 150) * 180 - 90; // map 0-150% to -90..90 deg

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 120 70" width="140" height="82">
        {/* Track */}
        <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="#1e293b" strokeWidth="10" strokeLinecap="round" />
        {/* Value arc */}
        <path
          d="M10,60 A50,50 0 0,1 110,60"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 150) * 157} 157`}
          style={{ filter: `drop-shadow(0 0 6px ${color}80)` }}
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
        <text x="10" y="68" fill="#475569" fontSize="7" textAnchor="middle">0%</text>
        <text x="110" y="68" fill="#475569" fontSize="7" textAnchor="middle">150%</text>
      </svg>
      <p className="font-mono font-bold text-2xl" style={{ color }}>
        {percent.toFixed(1)}%
      </p>
    </div>
  );
}
