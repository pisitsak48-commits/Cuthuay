'use client';
import { cn } from '@/lib/utils';

type BadgeVariant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted';

const variantMap: Record<BadgeVariant, string> = {
  default:
    'bg-[var(--color-badge-neutral-bg)] text-theme-text-primary border-[var(--color-badge-neutral-border)]',
  success:
    'bg-[var(--color-badge-success-bg)] text-[var(--color-badge-success-text)] border-[var(--color-badge-success-border)]',
  warning:
    'bg-[var(--color-badge-warning-bg)] text-[var(--color-badge-warning-text)] border-[var(--color-badge-warning-border)]',
  danger:
    'bg-[var(--color-badge-danger-bg)] text-[var(--color-badge-danger-text)] border-[var(--color-badge-danger-border)]',
  info: 'bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border-[var(--color-badge-info-border)]',
  muted:
    'bg-[var(--color-badge-neutral-bg)] text-theme-text-secondary border-[var(--color-badge-neutral-border)]',
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
        'inline-flex items-center gap-1.5 rounded-md px-2.5 py-0.5 text-xs font-medium border transition-colors duration-150',
        variantMap[variant],
        className,
      )}
    >
      {dot && (
        <span
          className={cn(
            'w-2.5 h-2.5 rounded-full',
            variant === 'success' && 'bg-profit',
            variant === 'danger' && 'bg-risk-high',
            variant === 'warning' && 'bg-accent-glow',
            variant === 'info' && 'bg-accent-glow',
            variant === 'muted' && 'bg-theme-text-muted',
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
  return <Badge variant={level} className="tabular-nums">{label} {percent.toFixed(1)}%</Badge>;
}

export function NotificationBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex items-center justify-center min-w-[1.5rem] h-6 rounded-md bg-[rgb(var(--color-notify)/1)] px-2 text-xs font-medium tabular-nums text-[var(--text-inverse)]">
      {count}
    </span>
  );
}
