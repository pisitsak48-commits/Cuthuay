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
        'rounded-xl border border-[var(--color-border)] bg-white p-5 shadow-sm',
        hover && 'hover:bg-[var(--bg-hover)] cursor-pointer',
        glow && 'shadow-sm',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('ui-panel-head mb-0', className)}>
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
        'text-base font-semibold tracking-tight text-theme-text-primary',
        size === 'lg' && 'text-lg',
        className,
      )}>
      {children}
    </h3>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(className)}>{children}</div>;
}
