'use client';
import { motion } from 'framer-motion';
import { cn, formatBaht, formatPercent } from '@/lib/utils';

type AccentKey = 'blue' | 'green' | 'amber' | 'rose' | 'violet';

const accentLine: Record<AccentKey, string> = {
  blue:   'bg-gradient-to-r from-blue-400  to-blue-600',
  green:  'bg-gradient-to-r from-emerald-400 to-emerald-600',
  amber:  'bg-gradient-to-r from-amber-400 to-orange-500',
  rose:   'bg-gradient-to-r from-rose-400  to-red-500',
  violet: 'bg-gradient-to-r from-violet-400 to-violet-600',
};
const accentIconBg: Record<AccentKey, string> = {
  blue:   'bg-blue-500',
  green:  'bg-emerald-500',
  amber:  'bg-amber-500',
  rose:   'bg-rose-500',
  violet: 'bg-violet-500',
};

interface StatCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  format?: 'baht' | 'percent' | 'number' | 'raw';
  colorOverride?: string;
  className?: string;
  index?: number;
  accent?: AccentKey;
  icon?: React.ReactNode;
}

export function StatCard({
  label, value, subLabel, trend, format = 'raw',
  colorOverride, className, index = 0, accent, icon,
}: StatCardProps) {
  const numericValue = typeof value === 'number' ? value : parseFloat(String(value)) || 0;

  const displayValue =
    format === 'baht'    ? formatBaht(numericValue) :
    format === 'percent' ? formatPercent(numericValue) :
    format === 'number'  ? numericValue.toLocaleString('th-TH') :
    String(value);

  const valueColor =
    colorOverride ??
    (trend === 'up'   ? 'text-accent' :
     trend === 'down' ? 'text-loss' : 'text-theme-text-primary');

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className={cn(
        'rounded-2xl border-0 bg-white shadow-sm overflow-hidden',
        'transition-[transform,box-shadow] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
        'hover:shadow-md hover:-translate-y-0.5',
        className,
      )}
    >
      {accent && <div className={cn('h-[3px] w-full', accentLine[accent])} />}
      <div className="px-5 py-4">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-xs font-semibold text-theme-text-secondary uppercase tracking-wider leading-tight mt-0.5">
            {label}
          </p>
          {icon && accent && (
            <div className={cn(
              'shrink-0 rounded-xl p-2 text-white shadow-sm',
              accentIconBg[accent],
            )}>
              {icon}
            </div>
          )}
        </div>
        <p className={cn('font-sans text-3xl font-bold tabular-nums tracking-tight leading-none', valueColor)}>
          {displayValue}
        </p>
        {subLabel && (
          <p className="text-xs text-theme-text-muted mt-2 leading-snug">{subLabel}</p>
        )}
      </div>
    </motion.div>
  );
}
