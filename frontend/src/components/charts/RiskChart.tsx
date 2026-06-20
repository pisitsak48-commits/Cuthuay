'use client';

// Recharts SVG fill/stroke attributes don't accept CSS custom properties.
// Read resolved values at render time so they follow theme changes.
function readCssVar(name: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Legend,
  ReferenceLine,
} from 'recharts';
import { formatBaht, roundChartAxisLabel, cn } from '@/lib/utils';
import type { Round } from '@/types';
import type { RoundProfitExtra } from './ProfitLossChart';

interface Props {
  rounds: Round[];
  profitByRoundId?: Record<string, RoundProfitExtra>;
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
    hasProfit: boolean;
  };
  return (
    <div
      className="rounded-xl border px-3 py-2.5 text-sm shadow-lg min-w-[176px]"
      style={{
        background: 'var(--chart-tooltip-bg)',
        color: 'var(--chart-tooltip-fg)',
        borderColor: 'var(--chart-tooltip-border)',
      }}
    >
      <p className="mb-2 text-xs font-semibold" style={{ color: 'var(--chart-tooltip-muted)' }}>
        {label}
      </p>
      <div className="space-y-1 tabular-nums">
        <div className="flex justify-between gap-4">
          <span style={{ color: 'var(--chart-tooltip-muted)' }}>ยอดขาย</span>
          <span className="font-semibold">{formatBaht(row.sales)}</span>
        </div>
        {row.hasProfit && row.profit != null ? (
          <>
            <div className="flex justify-between gap-4">
              <span style={{ color: 'var(--chart-tooltip-muted)' }}>กำไรสุทธิ</span>
              <span className={cn('font-semibold', row.profit >= 0 ? 'text-[var(--chart-profit)]' : 'text-[var(--color-semantic-danger-muted)]')}>
                {formatBaht(row.profit)}
              </span>
            </div>
            {row.profitPct != null ? (
              <div className="flex justify-between gap-4 text-xs pt-1 border-t border-[var(--color-border)]/60 mt-1">
                <span style={{ color: 'var(--chart-tooltip-muted)' }}>% / ยอดขาย</span>
                <span>{row.profitPct.toFixed(2)}%</span>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[11px] italic pt-0.5" style={{ color: 'var(--chart-tooltip-muted)' }}>
            ยังไม่ออกผล — ไม่มีค่ากำไร
          </p>
        )}
      </div>
    </div>
  );
}

export function RiskDistributionChart({ rounds, profitByRoundId = {} }: Props) {
  const chartSalesColor  = readCssVar('--chart-primary', '#4a90e2');
  const chartProfitColor = readCssVar('--chart-profit', '#4caf50');
  const chartPeakColor   = '#fbbf24'; // no token; intentional one-off highlight

  const data = rounds
    .slice()
    .reverse()
    .slice(0, 12)
    .map((r) => {
      const extra = profitByRoundId[r.id];
      const sales = extra?.sellTotal ?? Number(r.total_revenue ?? 0);
      const profit = r.status === 'drawn' && extra != null ? extra.profit : null;
      const hasProfit = profit != null;
      const profitPct = profit != null && sales > 0 ? (profit / sales) * 100 : null;
      return {
        name: roundChartAxisLabel(r),
        sales,
        profit: profit ?? 0,
        profitPct,
        status: r.status,
        hasProfit,
      };
    });

  const maxRev = data.length ? Math.max(...data.map((d) => d.sales), 0) : 0;

  if (!data.length) {
    return (
      <div className="h-56 flex items-center justify-center text-xs text-theme-text-muted">
        ไม่มีข้อมูล
      </div>
    );
  }

  return (
    <div className="h-56 p-3">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 10, left: 4, bottom: 18 }} barGap={4}>
          <defs>
            <linearGradient id="riskBarSales" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#5b9fef" stopOpacity={1} />
              <stop offset="100%" stopColor="#357abd" stopOpacity={0.88} />
            </linearGradient>
            <linearGradient id="riskBarProfitPos" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity={1} />
              <stop offset="100%" stopColor="#059669" stopOpacity={0.92} />
            </linearGradient>
            <linearGradient id="riskBarProfitNeg" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#fb7185" stopOpacity={1} />
              <stop offset="100%" stopColor="#dc2626" stopOpacity={0.95} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="3 3" vertical={false} />
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
            tick={axisTickProps}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => `฿${(v / 1000).toFixed(0)}k`}
            width={46}
          />
          <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgba(74,144,226,0.06)', radius: 6 } as any} />
          <Legend
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
            iconType="square"
            payload={[
              { value: 'ยอดขาย', type: 'square', id: 'sales', color: chartSalesColor },
              { value: 'กำไร', type: 'square', id: 'profit', color: chartProfitColor },
            ]}
          />
          <ReferenceLine y={0} stroke="var(--chart-ref-line)" />
          <Bar dataKey="sales" name="sales" radius={[7, 7, 2, 2]} maxBarSize={36}>
            {data.map((entry, index) => (
              <Cell
                key={`s-${index}`}
                fill={
                  maxRev > 0 && entry.sales === maxRev ? chartPeakColor : 'url(#riskBarSales)'
                }
              />
            ))}
          </Bar>
          <Bar dataKey="profit" name="profit" radius={[7, 7, 2, 2]} maxBarSize={36}>
            {data.map((entry, index) => (
              <Cell
                key={`p-${index}`}
                fill={
                  !entry.hasProfit
                    ? 'transparent'
                    : entry.profit >= 0
                      ? 'url(#riskBarProfitPos)'
                      : 'url(#riskBarProfitNeg)'
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Risk Gauge (ใช้ในหน้าอื่นได้) ───────────────────────────────────────────────
interface GaugeProps {
  percent: number;
}

export function RiskGauge({ percent }: GaugeProps) {
  const clamped = Math.min(Math.max(percent, 0), 150);
  const color =
    clamped < 30 ? 'var(--chart-gauge-low)' :
    clamped < 60 ? 'var(--chart-gauge-mid)' :
    clamped < 100 ? 'var(--chart-gauge-high)' : 'var(--chart-gauge-crit)';

  const angle = (clamped / 150) * 180 - 90;

  const gaugeAxisStyle = {
    fill: 'var(--chart-axis)',
    fontSize: 11,
    letterSpacing: '-0.01em',
    fontFamily: 'var(--font-inter), var(--font-thai), system-ui, sans-serif',
    fontVariantNumeric: 'tabular-nums' as const,
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <svg viewBox="0 0 120 70" width="140" height="82">
        <path d="M10,60 A50,50 0 0,1 110,60" fill="none" stroke="var(--chart-grid)" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M10,60 A50,50 0 0,1 110,60"
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${(clamped / 150) * 157} 157`}
        />
        <line
          x1="60"
          y1="60"
          x2={60 + 38 * Math.cos(((angle) * Math.PI) / 180)}
          y2={60 + 38 * Math.sin(((angle) * Math.PI) / 180)}
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="60" cy="60" r="4" fill={color} />
        <text x="10" y="68" {...gaugeAxisStyle} textAnchor="middle">0%</text>
        <text x="110" y="68" {...gaugeAxisStyle} textAnchor="middle">150%</text>
      </svg>
      <p className="tabular-nums tracking-tight font-bold text-2xl" style={{ color }}>
        {percent.toFixed(1)}%
      </p>
    </div>
  );
}
