'use client';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const variantMap: Record<BadgeVariant, string> = {
  default: 'bg-slate-700/60 text-slate-300',
  success: 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25',
  warning: 'bg-amber-500/15 text-amber-400 border border-amber-500/25',
  danger:  'bg-rose-500/15 text-rose-400 border border-rose-500/25',
  info:    'bg-blue-500/15 text-blue-400 border border-blue-500/25',
  muted:   'bg-surface-300/50 text-slate-500',
};

interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
  dot?: boolean;
}

export function Badge({ children, variant = 'default', className, dot }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium',
        variantMap[variant],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            'w-1.5 h-1.5 rounded-full animate-pulse-slow',
            variant === 'success' && 'bg-emerald-400',
            variant === 'danger'  && 'bg-rose-400',
            variant === 'warning' && 'bg-amber-400',
            variant === 'info'    && 'bg-blue-400',
          )}
        />
      )}
      {children}
    </span>
  );
}

export function RoundStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: BadgeVariant }> = {
    open:     { label: 'เปิดรับ', variant: 'success' },
    closed:   { label: 'ปิดรับ',  variant: 'warning' },
    drawn:    { label: 'ออกผล',   variant: 'muted'   },
    archived: { label: 'ซ่อน',    variant: 'muted'   },
  };
  const config = map[status] ?? { label: status, variant: 'default' };
  return <Badge variant={config.variant} dot={status === 'open'}>{config.label}</Badge>;
}

export function RiskBadge({ percent }: { percent: number }) {
  const level =
    percent < 30 ? 'success' :
    percent < 60 ? 'warning' :
    percent < 100 ? 'danger' : 'danger';
  const label =
    percent < 30 ? 'ต่ำ' :
    percent < 60 ? 'กลาง' :
    percent < 100 ? 'สูง' : 'วิกฤต';
  return <Badge variant={level}>{label} {percent.toFixed(1)}%</Badge>;
}
