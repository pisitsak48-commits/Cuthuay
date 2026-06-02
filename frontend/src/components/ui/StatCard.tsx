'use client';
import { motion, useReducedMotion } from 'framer-motion';
import { cn, formatBaht, formatPercent } from '@/lib/utils';

type AccentKey = 'blue' | 'green' | 'amber' | 'rose' | 'violet';

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
  const prefersReducedMotion = useReducedMotion();
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
      initial={prefersReducedMotion ? false : { opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={
        prefersReducedMotion
          ? { duration: 0 }
          : { duration: 0.22, delay: index * 0.04, ease: [0.22, 1, 0.36, 1] }
      }
      className={cn(
        'rounded-xl border border-[var(--color-border)] bg-white shadow-sm overflow-hidden',
        className,
      )}
    >
      <div className="p-5">
        <div className="flex items-start justify-between gap-3 mb-3">
          <p className="text-sm font-medium text-theme-text-secondary leading-tight mt-0.5">
            {label}
          </p>
          {icon && accent && (
            <div className={cn(
              'shrink-0 rounded-lg p-2 text-white',
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
