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
        'rounded-2xl border-0 bg-[var(--color-card-bg-solid)] p-6 shadow-sm backdrop-blur-none transition-[transform,box-shadow] duration-[200ms] [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]',
        hover && 'hover:shadow-md cursor-pointer',
        glow && 'shadow-md',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-center justify-between mb-6', className)}>
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
        'text-lg font-medium tracking-tight text-theme-text-primary',
        size === 'lg' && 'sm:text-xl',
        className,
      )}>
      {children}
    </h3>
  );
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn(className)}>{children}</div>;
}
