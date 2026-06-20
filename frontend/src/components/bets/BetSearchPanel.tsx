'use client';

export function BetSearchPanel({
  q,
  setQ,
  onSearch,
  onNext,
  onClear,
  matchCount,
  activeIndex,
}: {
  q: string;
  setQ: (v: string) => void;
  onSearch: () => void;
  onNext: () => void;
  onClear: () => void;
  matchCount: number;
  activeIndex: number;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:gap-1.5">
        <input
          value={q}
          onChange={e => setQ(e.target.value.replace(/\s+/g, ''))}
          onKeyDown={e => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            if (!q.trim()) return;
            if (activeIndex >= 0) onNext();
            else onSearch();
          }}
          aria-label="ค้นหาเลขตรงตัว"
          placeholder="ค้นหาเลขตรงตัว..."
          className="h-8 w-full min-w-0 flex-1 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2.5 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] tracking-tight" />
        <div className="flex shrink-0 items-center justify-end gap-1.5 sm:justify-start">
          <button
            onClick={() => {
              if (!q.trim()) return;
              if (activeIndex >= 0) onNext();
              else onSearch();
            }}
            className="btn-toolbar-glow btn-fintech-search h-7 shrink-0 px-3 text-xs">
            ค้นหา
          </button>
          <button
            onClick={onClear}
            className="btn-toolbar-glow btn-fintech-spark h-7 shrink-0 px-3 text-xs">
            เคลียร์
          </button>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-theme-text-muted">
        {q.trim()
          ? matchCount > 0
            ? `พบ ${matchCount} รายการในแผ่นนี้${activeIndex >= 0 ? ` • ลำดับ ${activeIndex + 1}/${matchCount}` : ''}`
            : 'ไม่พบเลขนี้ในแผ่นนี้'
          : 'ค้นหาเฉพาะลูกค้าและแผ่นที่เลือกอยู่เท่านั้น'}
      </div>
    </div>
  );
}
