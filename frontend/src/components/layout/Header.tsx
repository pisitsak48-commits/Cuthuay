'use client';
import { useAppStore, useThemeStore } from '@/store/useStore';
import { Badge } from '@/components/ui/Badge';
import { formatBaht } from '@/lib/utils';

interface HeaderProps {
  title: string;
  subtitle?: string;
}

export function Header({ title, subtitle }: HeaderProps) {
  const { selectedRound } = useAppStore();
  const { theme, toggleTheme } = useThemeStore();

  return (
    <header className="flex items-center justify-between px-6 py-4 border-b border-border bg-surface-50/60 backdrop-blur-sm">
      <div>
        <h1 className="text-lg font-semibold text-slate-100 tracking-tight">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
      </div>

      <div className="flex items-center gap-3">
        {selectedRound && (
          <>
            <div className="text-right">
              <p className="text-xs text-slate-500">งวด</p>
              <p className="text-sm font-semibold text-slate-200">{selectedRound.name}</p>
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500">ยอดรับ</p>
              <p className="text-sm font-mono font-semibold text-emerald-400">
                {formatBaht(selectedRound.total_revenue ?? 0)}
              </p>
            </div>
            <BadgeWrap status={selectedRound.status} />
          </>
        )}
        <button
          onClick={toggleTheme}
          title={theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'}
          className="w-8 h-8 flex items-center justify-center rounded-lg border border-border/60 text-slate-400 hover:text-slate-200 hover:border-accent/60 hover:bg-accent/10 transition-colors"
        >
          {theme === 'dark' ? (
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
            </svg>
          )}
        </button>
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
