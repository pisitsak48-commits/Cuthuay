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
      'rounded-2xl border-0 p-6 transition-[transform,box-shadow] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
      'bg-white shadow-sm',
      glow && 'shadow-md',
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
    'inline-flex items-center justify-center gap-2 rounded-full px-4 py-2.5 text-sm font-semibold transition-[transform,box-shadow,opacity] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-400 disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    cyan: 'border-0 bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md hover:shadow-lg hover:-translate-y-0.5 active:translate-y-0',
    purple:
      'bg-white text-gray-900 border-0 shadow-sm hover:shadow-md hover:-translate-y-0.5 active:translate-y-0',
    pink:
      'bg-gray-100 text-gray-900 border-0 shadow-sm hover:bg-gray-200/90 hover:-translate-y-0.5 active:translate-y-0',
    ghost:
      'bg-transparent border-0 text-gray-900 hover:bg-gray-100 hover:-translate-y-0.5 active:translate-y-0',
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
      'rounded-2xl border-0 p-6 shadow-sm transition-[transform,box-shadow] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
      'bg-white',
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
