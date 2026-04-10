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
    (trend === 'up'   ? 'text-emerald-400' :
     trend === 'down' ? 'text-rose-400'    : 'text-slate-100');

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
      className={cn(
        'rounded-xl border border-border bg-surface-100/70 p-5 backdrop-blur-sm',
        'hover:border-border-bright transition-colors duration-200',
        className,
      )}
    >
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-widest mb-2">
        {label}
      </p>
      <p className={cn('font-mono text-2xl font-semibold tracking-tight leading-none', valueColor)}>
        {displayValue}
      </p>
      {subLabel && (
        <p className="text-xs text-slate-500 mt-1.5">{subLabel}</p>
      )}
    </motion.div>
  );
}
