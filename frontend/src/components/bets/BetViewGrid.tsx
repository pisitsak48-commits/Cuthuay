'use client';

export interface BetViewRow {
  number: string;
  bet_type: string;
  sold: number;
  sent: number;
  remaining: number;
}

export interface BetViewThreshold {
  id: number;
  amount: number;
  color: string;
}

export type BetViewLayoutMode = 'columns' | 'table';

const LAYOUT_STORAGE_KEY = 'betview_layout_mode';

export function loadBetViewLayoutMode(): BetViewLayoutMode {
  if (typeof window === 'undefined') return 'columns';
  try {
    const v = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (v === 'table' || v === 'columns') return v;
  } catch { /* ignore */ }
  return 'columns';
}

export function saveBetViewLayoutMode(mode: BetViewLayoutMode): void {
  try { localStorage.setItem(LAYOUT_STORAGE_KEY, mode); } catch { /* ignore */ }
}

export const CELL_GRID_TEMPLATE = '4.5rem 1fr 1fr 1fr';

export function formatBetViewN(v: number): string {
  return v === 0 ? '0' : v.toLocaleString('th-TH', { maximumFractionDigits: 0 });
}

export function getThresholdColor(sold: number, thresholds: BetViewThreshold[]): string | null {
  const sorted = [...thresholds].sort((a, b) => b.amount - a.amount);
  for (const t of sorted) {
    if (sold >= t.amount) return t.color;
  }
  return null;
}

function numberFontSize(base: number): number {
  return Math.max(14, Math.round(base * 1.15));
}

type RowProps = {
  row: BetViewRow;
  rowIndex: number;
  fontSize: number;
  thresholds: BetViewThreshold[];
};

export function BetViewGridCell({ row, rowIndex, fontSize, thresholds }: RowProps) {
  const soldColor = getThresholdColor(row.sold, thresholds);
  const rowBg = rowIndex % 2 === 0 ? 'bg-surface-100/80' : 'bg-[var(--color-surface)]';
  const padY = fontSize >= 13 ? 'py-2.5' : 'py-2';
  const numSize = numberFontSize(fontSize);

  return (
    <div
      className={`grid border-b border-[var(--color-border)] hover:bg-[var(--bg-hover)] transition-colors ${rowBg}`}
      style={{ fontSize, gridTemplateColumns: CELL_GRID_TEMPLATE, lineHeight: 1.35 }}
    >
      <div
        className={`px-2 sm:px-2.5 ${padY} font-mono tabular-nums font-bold text-theme-text-primary text-center bg-surface-200/70 border-r-2 border-[var(--color-border-strong,var(--color-border))]`}
        style={{ fontSize: numSize }}
      >
        {row.number}
      </div>
      <div
        className={`px-2 sm:px-2.5 ${padY} text-right tabular-nums font-medium border-r border-[var(--color-border)] ${soldColor ? '' : 'text-theme-text-primary'}`}
        style={soldColor ? { color: soldColor } : undefined}
      >
        {formatBetViewN(row.sold)}
      </div>
      <div
        className={`px-2 sm:px-2.5 ${padY} text-right tabular-nums font-medium border-r border-[var(--color-border)] ${row.sent > 0 ? 'text-theme-text-secondary' : 'text-theme-text-muted'}`}
      >
        {formatBetViewN(row.sent)}
      </div>
      <div
        className={`px-2 sm:px-2.5 ${padY} text-right tabular-nums border-r-0 ${
          row.remaining > 0 ? 'text-theme-text-primary font-semibold' : 'text-theme-text-muted font-medium'
        }`}
      >
        {formatBetViewN(row.remaining)}
      </div>
    </div>
  );
}

export function BetViewColHeader({ fontSize }: { fontSize: number }) {
  return (
    <div
      className="grid border-b-2 border-[var(--color-border)] bg-surface-200/60 sticky top-0 z-10 select-none"
      style={{ fontSize: Math.max(fontSize, 11), gridTemplateColumns: CELL_GRID_TEMPLATE }}
    >
      <div className="px-2 sm:px-2.5 py-2 text-theme-text-primary font-semibold border-r-2 border-[var(--color-border-strong,var(--color-border))] text-center">
        เลข
      </div>
      <div className="px-2 sm:px-2.5 py-2 text-theme-text-secondary font-medium text-right border-r border-[var(--color-border)]">
        ขาย
      </div>
      <div className="px-2 sm:px-2.5 py-2 text-theme-text-secondary font-medium text-right border-r border-[var(--color-border)]">
        ส่ง
      </div>
      <div className="px-2 sm:px-2.5 py-2 text-theme-text-secondary font-medium text-right">เหลือ</div>
    </div>
  );
}

type ColumnGridProps = {
  rows: BetViewRow[];
  cols: number;
  fontSize: number;
  thresholds: BetViewThreshold[];
};

export function BetViewColumnGrid({ rows, cols, fontSize, thresholds }: ColumnGridProps) {
  const perCol = Math.ceil(rows.length / cols) || 1;
  const columnGroups: BetViewRow[][] = Array.from({ length: cols }, (_, i) =>
    rows.slice(i * perCol, (i + 1) * perCol),
  );

  return (
    <div
      className="grid gap-1.5 sm:gap-2 p-1.5 sm:p-2 items-start content-start"
      style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
    >
      {columnGroups.map((group, ci) => (
        <div
          key={ci}
          className="flex flex-col min-w-0 rounded-2xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-sm"
        >
          <BetViewColHeader fontSize={fontSize} />
          {group.map((row, ri) => (
            <BetViewGridCell
              key={`${row.number}-${row.bet_type}-${ri}`}
              row={row}
              rowIndex={ri}
              fontSize={fontSize}
              thresholds={thresholds}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function BetViewTable({ rows, fontSize, thresholds }: Omit<ColumnGridProps, 'cols'>) {
  const numSize = numberFontSize(fontSize);

  return (
    <div className="p-2 sm:p-3 overflow-x-auto">
      <div className="rounded-2xl border border-[var(--color-border)] bg-[var(--color-card-bg-solid)] shadow-sm overflow-hidden min-w-[280px]">
        <table className="w-full border-collapse" style={{ fontSize }}>
          <thead className="sticky top-0 z-10 bg-surface-200/60">
            <tr className="border-b-2 border-[var(--color-border)]">
              <th className="px-3 py-2.5 text-center font-semibold text-theme-text-primary border-r-2 border-[var(--color-border-strong,var(--color-border))] w-[5.5rem]">
                เลข
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-theme-text-secondary border-r border-[var(--color-border)]">
                ขาย
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-theme-text-secondary border-r border-[var(--color-border)]">
                ส่ง
              </th>
              <th className="px-3 py-2.5 text-right font-medium text-theme-text-secondary">เหลือ</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, ri) => {
              const soldColor = getThresholdColor(row.sold, thresholds);
              const rowBg = ri % 2 === 0 ? 'bg-surface-100/80' : 'bg-[var(--color-surface)]';
              return (
                <tr key={`${row.number}-${row.bet_type}-${ri}`} className={`border-b border-[var(--color-border)] hover:bg-[var(--bg-hover)] ${rowBg}`}>
                  <td
                    className="px-3 py-2.5 text-center font-mono tabular-nums font-bold text-theme-text-primary border-r-2 border-[var(--color-border-strong,var(--color-border))] bg-surface-200/50"
                    style={{ fontSize: numSize }}
                  >
                    {row.number}
                  </td>
                  <td
                    className={`px-3 py-2.5 text-right tabular-nums font-medium border-r border-[var(--color-border)] ${soldColor ? '' : 'text-theme-text-primary'}`}
                    style={soldColor ? { color: soldColor } : undefined}
                  >
                    {formatBetViewN(row.sold)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums font-medium border-r border-[var(--color-border)] ${row.sent > 0 ? 'text-theme-text-secondary' : 'text-theme-text-muted'}`}>
                    {formatBetViewN(row.sent)}
                  </td>
                  <td className={`px-3 py-2.5 text-right tabular-nums ${row.remaining > 0 ? 'text-theme-text-primary font-semibold' : 'text-theme-text-muted font-medium'}`}>
                    {formatBetViewN(row.remaining)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
