'use client';
import { motion } from 'framer-motion';
import { cn, formatBaht, formatPercent } from '@/lib/utils';

interface StatCardProps {
  label: string;
  value: string | number;
  subLabel?: string;
  trend?: 'up' | 'down' | 'neutral';
  format?: 'baht' | 'percent' | 'number' | 'raw';
  colorOverride?: string;
  className?: string;
  index?: number;
}

export function StatCard({
  label,
  value,
  subLabel,
  trend,
  format = 'raw',
  colorOverride,
  className,
  index = 0,
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
        'rounded-card border border-theme-card-border p-5 transition-[transform,box-shadow,border-color] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
        'bg-[var(--bg-glass)] shadow-card',
        'hover:-translate-y-0.5 hover:border-[var(--color-border-strong)] hover:shadow-[var(--shadow-hover)]',
        className,
      )}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-theme-text-secondary mb-2">
        {label}
      </p>
      <p className={cn('font-mono text-3xl font-semibold tabular-nums tracking-wide leading-none', valueColor)}>
        {displayValue}
      </p>
      {subLabel && (
        <p className="text-xs text-theme-text-secondary mt-2">{subLabel}</p>
      )}
    </motion.div>
  );
}
