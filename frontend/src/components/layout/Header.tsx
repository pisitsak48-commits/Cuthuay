'use client';
import type { ReactNode } from 'react';
import { useAppStore } from '@/store/useStore';
import { Badge } from '@/components/ui/Badge';
import { cn, formatBaht } from '@/lib/utils';

interface HeaderProps {
  title: string;
  subtitle?: string;
  /** หัวข้อใหญ่ขึ้น (เช่น หน้าสรุป / แดชบอร์ดหลัก) */
  variant?: 'default' | 'prominent';
  /** ปุ่ม/ลิงก์ด้านขวา (เช่น ออกผล) — ใช้คลาส btn-toolbar-glow ให้เข้าธีม */
  trailing?: ReactNode;
}

export function Header({ title, subtitle, variant = 'default', trailing }: HeaderProps) {
  const { selectedRound } = useAppStore();
  const prominent = variant === 'prominent';

  return (
    <header className="ui-surface flex items-center justify-between px-5 py-4 mx-4 mt-4">
      <div>
        <h1
          className={cn(
            'font-semibold text-theme-text-primary tracking-tight',
            prominent ? 'text-3xl sm:text-4xl' : 'text-2xl',
          )}>
          {title}
        </h1>
        {subtitle && (
          <p
            className={cn(
              'text-gray-600 mt-1',
              prominent ? 'text-base mt-1.5 max-w-2xl leading-snug' : 'text-sm',
            )}>
            {subtitle}
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        {selectedRound && (
          <>
            <div className="text-right">
              <p className={cn('text-theme-text-muted', prominent ? 'text-sm' : 'text-xs')}>
                งวด
              </p>
              <p
                className={cn(
                  'font-semibold text-theme-text-primary',
                  prominent ? 'text-base mt-0.5' : 'text-sm',
                )}>
                {selectedRound.name}
              </p>
            </div>
            <div className="text-right">
              <p className={cn('text-theme-text-muted', prominent ? 'text-sm' : 'text-xs')}>
                ยอดรับ
              </p>
              <p
                className={cn(
                  'font-semibold tabular-nums tracking-tight text-accent',
                  prominent ? 'text-base mt-0.5' : 'text-sm',
                )}>
                {formatBaht(selectedRound.total_revenue ?? 0)}
              </p>
            </div>
            <BadgeWrap status={selectedRound.status} />
          </>
        )}
        {trailing}
      </div>
    </header>
  );
}

function BadgeWrap({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'success' | 'warning' | 'muted' }> = {
    open:   { label: 'เปิดรับ', variant: 'success' },
    closed: { label: 'ปิดรับ',  variant: 'warning' },
    drawn:  { label: 'ออกผล',   variant: 'muted'   },
  };
  const cfg = map[status] ?? { label: status, variant: 'muted' as const };
  return <Badge variant={cfg.variant} dot={status === 'open'}>{cfg.label}</Badge>;
}
