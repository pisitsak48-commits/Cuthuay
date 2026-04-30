'use client';
import { cn } from '@/lib/utils';

interface CardProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  glow?: boolean;
}

export function Card({ children, className, hover, glow }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-card border border-theme-card-border bg-theme-card p-5 shadow-card transition-[transform,box-shadow,border-color] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
        hover && 'hover:-translate-y-0.5 hover:shadow-[var(--shadow-hover)] cursor-pointer',
        glow && 'border-[var(--color-border-strong)] shadow-[var(--shadow-soft)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between mb-4', className)}>
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  className,
  size = 'default',
}: {
  children: React.ReactNode;
  className?: string;
  /** lg = หัวข้อการ์ดใหญ่ขึ้น (เช่น หน้าสรุป) */
  size?: 'default' | 'lg';
}) {
  return (
    <h3
      className={cn(
        'font-semibold text-theme-text-primary uppercase opacity-95',
        size === 'lg'
          ? 'text-base sm:text-[1.0625rem] tracking-[0.2em]'
          : 'text-sm tracking-[0.24em] opacity-90',
        className,
      )}>
      {children}
    </h3>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(className)}>{children}</div>;
}
