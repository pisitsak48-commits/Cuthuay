'use client';
import { cn } from '@/lib/utils';

interface NeonCardProps {
  children: React.ReactNode;
  className?: string;
  glow?: boolean;
}

export function NeonCard({ children, className, glow }: NeonCardProps) {
  return (
    <div className={cn(
      'glass-panel p-5',
      glow && 'shadow-sm',
      className,
    )}>
      {children}
    </div>
  );
}

interface GlowButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'cyan' | 'purple' | 'pink' | 'ghost';
}

export function GlowButton({ variant = 'cyan', className, children, ...props }: GlowButtonProps) {
  const base =
    'btn-primary-glow';
  const styles = {
    cyan: '',
    purple: 'btn-toolbar-muted !text-[var(--color-text-primary)]',
    pink: 'btn-toolbar-muted',
    ghost: 'bg-transparent border-transparent shadow-none hover:bg-[var(--bg-hover)] !text-[var(--color-text-primary)]',
  };
  return (
    <button className={cn(base, styles[variant], className)} {...props}>
      {children}
    </button>
  );
}

interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
}

export function GlassPanel({ children, className }: GlassPanelProps) {
  return (
    <div className={cn(
      'glass-panel p-5',
      className,
    )}>
      {children}
    </div>
  );
}

export function NotificationBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-[1.5rem] h-6 items-center justify-center rounded-full bg-[rgb(var(--color-notify)/1)] px-2 text-[11px] font-semibold tabular-nums text-[var(--text-inverse)] shadow-[var(--shadow-soft)]">
      {count}
    </span>
  );
}
