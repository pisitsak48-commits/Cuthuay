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
      'rounded-card border border-theme-card-border p-6 transition-[transform,box-shadow,border-color] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
      'bg-[var(--bg-glass)] shadow-card',
      glow && 'shadow-[var(--shadow-hover)] border-[var(--color-border-strong)]',
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
    'inline-flex items-center justify-center gap-2 rounded-2xl px-4 py-2.5 text-sm font-semibold transition-[transform,box-shadow,opacity] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-accent-ring)] disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    cyan: 'bg-btn-primary text-theme-btn-primary-fg shadow-btn-primary hover:shadow-btn-primary-hover hover:-translate-y-px active:translate-y-0',
    purple:
      'bg-white text-theme-text-primary border border-theme-card-border shadow-[var(--shadow-soft)] hover:bg-[var(--bg-hover)] hover:shadow-[var(--shadow-hover)] hover:-translate-y-px active:translate-y-0',
    pink:
      'bg-[var(--bg-glass-subtle)] text-theme-text-primary border border-theme-card-border shadow-[var(--shadow-soft)] hover:bg-[var(--bg-hover)] hover:-translate-y-px active:translate-y-0',
    ghost:
      'bg-transparent border border-theme-card-border text-theme-text-primary hover:bg-[var(--bg-hover)] hover:-translate-y-px active:translate-y-0',
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
      'rounded-card border border-theme-card-border p-6 shadow-card transition-[transform,box-shadow] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
      'bg-[var(--bg-glass)]',
      className,
    )}>
      {children}
    </div>
  );
}

export function NotificationBadge({ count }: { count: number }) {
  return (
    <span className="inline-flex min-w-[1.5rem] h-6 items-center justify-center rounded-full bg-[rgb(var(--color-notify)/1)] px-2 text-[11px] font-semibold text-theme-btn-primary-fg shadow-[var(--shadow-soft)]">
      {count}
    </span>
  );
}
