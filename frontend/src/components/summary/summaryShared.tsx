'use client';
import { cn } from '@/lib/utils';
import { themeHex } from '@/lib/printColorTokens';
import type {
  CustSummary,
  DealerSummary,
  DealerWin,
  ProfitSummary,
} from '@/types/summary';

export const BET_TYPE_LABELS: Record<string, string> = {
  '3digit_top':    '3 ตัวบน',
  '3digit_tote':   '3 ตัวโต็ด',
  '3digit_back':   '3 ตัวล่าง',
  '2digit_top':    '2 ตัวบน',
  '2digit_bottom': '2 ตัวล่าง',
  '1digit_top':    'วิ่งบน',
  '1digit_bottom': 'วิ่งล่าง',
};
export const BET_TYPES = Object.keys(BET_TYPE_LABELS);

/** ตารางผลถูกฉลากลูกค้า — ความกว้างคงที่ทุกการ์ด ให้คอลัมน์เลขตรงแนวกันทุกลูกค้า */
export function WinsCustomerTableColGroup() {
  return (
    <colgroup>
      <col style={{ width: '10%' }} />
      <col style={{ width: '24%' }} />
      <col style={{ width: '22%' }} />
      <col style={{ width: '20%' }} />
      <col style={{ width: '24%' }} />
    </colgroup>
  );
}

/** ตารางผลถูกฉลากเจ้ามือ — คอลัมน์ประเภทกว้างคงที่ */
export function WinsDealerTableColGroup() {
  return (
    <colgroup>
      <col style={{ width: '30%' }} />
      <col style={{ width: '22%' }} />
      <col style={{ width: '24%' }} />
      <col style={{ width: '24%' }} />
    </colgroup>
  );
}

/** ธีมสีต่อประเภทเลข — บาร์ผลรางวัล / ป้ายเลขถูก / คอลัมน์ประเภท (ให้ชุดสีตรงกัน) */
type WinBetVisualKey =
  | 'prize_1st'
  | '3digit_top'
  | '3digit_tote'
  | '3digit_back'
  | '2digit_top'
  | '2digit_bottom'
  | '1digit_top'
  | '1digit_bottom';

type WinBetVisual = {
  stripCard: string;
  badge: string;
  label: string;
  numberText: string;
};

export const WIN_BET_NEUTRAL: WinBetVisual = {
  stripCard: 'border border-[var(--color-border)] bg-[var(--color-card-bg-solid)]',
  badge:
    'border border-[var(--color-border)] bg-[var(--color-badge-neutral-bg)] text-theme-text-primary font-semibold',
  label: 'text-theme-text-secondary font-semibold',
  numberText: 'text-theme-text-primary',
};

export const WIN_BET_VISUALS: Record<WinBetVisualKey, WinBetVisual> = {
  prize_1st: {
    stripCard: 'border border-[var(--color-badge-warning-border)] bg-[var(--color-badge-warning-bg)]',
    badge:
      'border border-[var(--color-badge-warning-border)] bg-[var(--color-badge-warning-bg)] text-[var(--text-accent)] font-semibold',
    label: 'text-[var(--text-accent)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-bold',
  },
  '3digit_top': {
    stripCard: 'border border-[var(--color-border)] bg-[var(--bg-glass-subtle)]',
    badge:
      'border border-[var(--color-border)] bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] font-semibold',
    label: 'text-[var(--color-badge-info-text)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-semibold',
  },
  '3digit_tote': {
    stripCard: 'border border-[var(--color-border)] bg-[var(--bg-glass-subtle)]',
    badge:
      'border border-[var(--color-border)] bg-[var(--color-badge-neutral-bg)] text-[var(--text-primary)] font-semibold',
    label: 'text-[var(--text-secondary)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-semibold',
  },
  '3digit_back': {
    stripCard: 'border border-[var(--color-badge-success-border)] bg-[var(--color-badge-success-bg)]',
    badge:
      'border border-[var(--color-badge-success-border)] bg-[var(--color-badge-success-bg)] text-[var(--color-badge-success-text)] font-semibold',
    label: 'text-[var(--color-badge-success-text)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-semibold',
  },
  '2digit_top': {
    stripCard: 'border border-[var(--color-border)] bg-[var(--bg-glass-subtle)]',
    badge:
      'border border-[var(--color-border)] bg-[var(--color-badge-neutral-bg)] text-[var(--text-primary)] font-semibold',
    label: 'text-[var(--text-secondary)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-semibold',
  },
  '2digit_bottom': {
    stripCard: 'border border-[var(--color-badge-danger-border)] bg-[var(--color-badge-danger-bg)]',
    badge:
      'border border-[var(--color-badge-danger-border)] bg-[var(--color-badge-danger-bg)] text-[var(--color-badge-danger-text)] font-semibold',
    label: 'text-[var(--color-badge-danger-text)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-semibold',
  },
  '1digit_top': {
    stripCard: 'border border-[var(--color-border)] bg-[var(--bg-glass-subtle)]',
    badge:
      'border border-[var(--color-border)] bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] font-semibold',
    label: 'text-[var(--color-badge-info-text)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-semibold',
  },
  '1digit_bottom': {
    stripCard: 'border border-[var(--color-badge-warning-border)] bg-[var(--color-badge-warning-bg)]',
    badge:
      'border border-[var(--color-badge-warning-border)] bg-[var(--color-badge-warning-bg)] text-[var(--text-accent)] font-semibold',
    label: 'text-[var(--text-accent)] font-semibold',
    numberText: 'text-[var(--text-primary)] font-semibold',
  },
};

export function winBetVisuals(betType: string): WinBetVisual {
  const v = WIN_BET_VISUALS[betType as WinBetVisualKey];
  return v ?? WIN_BET_NEUTRAL;
}

/** ป้ายเลขในตารางผลถูกฉลาก */
export function winBetTypeBadgeClass(betType: string): string {
  return winBetVisuals(betType).badge;
}

export function winBetTypeLabelClass(betType: string): string {
  return winBetVisuals(betType).label;
}

/** แท็บรายลูกค้า / รายเจ้ามือ — พื้นทึบอ่านง่าย ลดฟุ้งแบบ glass */
export const SUMMARY_CD_SOLID = '!bg-[var(--color-card-bg-solid)] !backdrop-blur-none';
export const SUMMARY_CD_BAR =
  'rounded-2xl border-0 bg-[var(--color-card-bg-solid)] backdrop-blur-none shadow-sm';

export function fNum(v: number) { return Math.round(v).toLocaleString('th-TH'); }
/** หัวรายงาน PDF — รูปแบบ 24/04/2026 */
export function formatReportDateDdMmYyyy(d: string) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return d;
  const dd = String(x.getDate()).padStart(2, '0');
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const yyyy = x.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
/** งวดวันที่ 2 พฤษภาคม 2569 — ใช้ปฏิทินไทยตามระบบ */
export function formatRoundDrawDateLongThai(drawDate: string) {
  const d = new Date(drawDate.includes('T') ? drawDate : `${drawDate}T12:00:00`);
  if (Number.isNaN(d.getTime())) return '';
  const inner = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
  return `งวดวันที่ ${inner}`;
}
/** เปอร์เซ็นต์ค่าคอมโดยประมาณจากยอดเงินคอม / ฐานขายหรือส่ง */
export function formatImpliedCommissionPctLabel(pctAmount: number, baseAmount: number) {
  if (baseAmount <= 0) return '0%';
  const p = (pctAmount / baseAmount) * 100;
  const r = Math.round(p * 100) / 100;
  return `${r}%`;
}
export function profitCls(v: number) {
  return v < 0 ? 'text-loss font-semibold' : v > 0 ? 'text-profit font-semibold' : 'text-theme-text-secondary';
}

export function totePerms(num: string): string[] {
  if (num.length !== 3) return [];
  const d = num.split('');
  const s = new Set<string>();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
    if (i !== j && j !== k && i !== k) s.add(d[i]+d[j]+d[k]);
  }
  return Array.from(s).sort();
}

// ─── (printHtml replaced by openPrintPreview from @/lib/printPreview) ─────────

/** แผงสรุป (ยอดขาย / คอม / ถูก / แยกประเภท) สำหรับพิมพ์ PDF ผลถูกฉลาก — ให้ตรงกับการ์ดด้านขวาบนหน้าจอ */
export function buildWinsPrintSidePanel(displayName: string, c: CustSummary | undefined): string {
  const sold = c?.sold ?? 0;
  const pct = c?.pct_sold ?? 0;
  const remaining = c?.remaining_sold ?? 0;
  const payout = c?.payout ?? 0;
  const net = c?.net ?? 0;
  const netCls = net < 0 ? 'neg' : 'pos';
  const comPctLabel = c ? c.commission_display : formatImpliedCommissionPctLabel(pct, sold);
  const row = (label: string, val: string, extraCls = '') =>
    `<div class="print-wins-kpi-row"><span class="print-wins-kpi-label">${label}</span><span class="num print-wins-kpi-val ${extraCls}">${val}</span></div>`;
  const typeHead = `<div class="print-wins-type-grid print-wins-type-head">
    <span>ประเภท</span><span class="num">ยอดขาย</span><span class="num">ยอดคอม</span><span class="num">ยอดถูก</span>
  </div>`;
  const typeRows = BET_TYPES.map(t => {
    const r = c?.by_type[t] ?? { sold: 0, pct: 0, payout: 0 };
    return `<div class="print-wins-type-grid print-wins-type-row">
      <span class="print-wins-type-name">${BET_TYPE_LABELS[t]}</span>
      <span class="num">${fNum(r.sold)}</span>
      <span class="num">${fNum(r.pct)}</span>
      <span class="num" style="color:${themeHex.danger}">${fNum(r.payout)}</span>
    </div>`;
  }).join('');
  return `<aside class="print-wins-side">
    <div class="print-wins-side-title">${displayName}</div>
    ${row('ยอดขาย', fNum(sold))}
    ${row(`ยอดคอม ${comPctLabel}`, fNum(pct))}
    ${row('คงเหลือ', fNum(remaining))}
    ${row('ยอดถูก', fNum(payout), 'neg')}
    ${row('ยอดสุทธิ', fNum(net), netCls)}
    ${typeHead}
    ${typeRows}
  </aside>`;
}

/** แผงสรุปฝั่งเจ้ามือ (ยอดส่ง / คอม / ถูก / แยกประเภท) สำหรับ PDF/PNG ผลถูกฉลาก — ให้ตรงการ์ดขวาบนหน้าจอ */
export function buildDealerWinsPrintSidePanel(
  displayName: string,
  overview: { sent: number; pct: number; remaining: number; payout: number; net: number },
  byType: Array<{ type: string; sent: number; pct: number; payout: number }>,
): string {
  const { sent, pct, remaining, payout, net } = overview;
  const comPctLabel = formatImpliedCommissionPctLabel(pct, sent);
  const netCls = net < 0 ? 'neg' : 'pos';
  const row = (label: string, val: string, extraCls = '') =>
    `<div class="print-wins-kpi-row"><span class="print-wins-kpi-label">${label}</span><span class="num print-wins-kpi-val ${extraCls}">${val}</span></div>`;
  const typeHead = `<div class="print-wins-type-grid print-wins-type-head">
    <span>ประเภท</span><span class="num">ยอดส่ง</span><span class="num">ยอดคอม</span><span class="num">ยอดถูก</span>
  </div>`;
  const typeRows = byType
    .map(
      (r) =>
        `<div class="print-wins-type-grid print-wins-type-row">
      <span class="print-wins-type-name">${BET_TYPE_LABELS[r.type]}</span>
      <span class="num">${fNum(r.sent)}</span>
      <span class="num">${fNum(r.pct)}</span>
      <span class="num" style="color:${themeHex.danger}">${fNum(r.payout)}</span>
    </div>`,
    )
    .join('');
  return `<aside class="print-wins-side">
    <div class="print-wins-side-title">${displayName}</div>
    ${row('ยอดส่ง', fNum(sent))}
    ${row(`ยอดคอม ${comPctLabel}`, fNum(pct))}
    ${row('คงเหลือ', fNum(remaining))}
    ${row('ยอดถูก', fNum(payout), 'neg')}
    ${row('ยอดสุทธิ', fNum(net), netCls)}
    ${typeHead}
    ${typeRows}
  </aside>`;
}

export function dealerWinsTableHtml(d: DealerWin): string {
  const rows = d.winning_items
    .map(
      (b, i) => `
          <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
            <td class="win-p-lbl" data-bet-type="${b.bet_type}">${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
            <td style="text-align:center"><span class="win-p-num" data-bet-type="${b.bet_type}">${b.number}</span></td>
            <td class="num"><span style="font-weight:400">${fNum(b.amount)}</span></td>
            <td class="num" style="color:${themeHex.danger}"><span style="font-weight:400">${fNum(b.payout)}</span></td>
          </tr>`,
    )
    .join('');
  return `<table style="table-layout:fixed;width:100%"><thead><tr><th style="width:30%">ประเภท</th><th style="width:22%">เลข</th><th style="width:24%">ราคา</th><th style="width:24%">ยอดจ่าย</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" style="text-align:center;color:${themeHex.textMuted}">ไม่มีรายการถูกรางวัล</td></tr>`}</tbody>
          ${rows ? `<tfoot><tr class="total-row"><td colspan="2" class="num">รวม</td><td class="num">${fNum(d.total_amount)}</td><td class="num" style="color:${themeHex.danger}">${fNum(d.total_payout)}</td></tr></tfoot>` : ''}
          </table>`;
}

/** ยอดแยกตามแผ่น × ประเภท (สำหรับตารางสรุปเต็ม) */
export function sheetTypeForCustomer(c: CustSummary, sheetKey: string, t: string) {
  const row = c.by_sheet_by_type?.[sheetKey]?.[t];
  return row ?? { sold: 0, pct: 0, payout: 0 };
}

/** สุทธิฝั่งส่งต่อประเภท (รวมทุกเจ้ามือ) = ยอดถูกเจ้ามือ − คงเหลือส่ง — ต้องบวกกับฝั่งขายเพื่อให้ผลกำไรต่อแถวตรงกับผลรวมงวด / โปรแกรมอ้างอิง */
export function sendNetByBetType(dealers: DealerSummary[], betType: string): number {
  return dealers.reduce((sum, d) => {
    const bt = d.by_type[betType];
    if (!bt) return sum;
    const remaining = bt.sent - bt.pct;
    return sum + (bt.payout - remaining);
  }, 0);
}

/** สุทธิรายประเภทฝั่งส่ง (เจ้ามือ) — ตรงกับคอลัมน์สุทธิในตารางสรุปยอดส่ง */
export function dealerByTypeNet(d: DealerSummary, t: string): number {
  const r = d.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
  return r.payout - (r.sent - r.pct);
}

// ─── Table cell helpers ───────────────────────────────────────────────────────
export function Th({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
  return (
    <th
      className={cn(
        'font-sans py-3 px-3.5 text-xs sm:text-[0.8125rem] text-theme-text-secondary font-semibold tracking-wide whitespace-nowrap leading-snug border-b border-[var(--color-border)]',
        right ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  );
}
export function Td({ children, right, cls, className }: { children?: React.ReactNode; right?: boolean; cls?: string; className?: string }) {
  return (
    <td
      className={cn(
        'py-2.5 px-3.5 text-sm sm:text-[0.9375rem]',
        right ? 'text-right tabular-nums tracking-tight' : 'font-sans',
        cls,
        className,
      )}
    >
      {children}
    </td>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
export function KpiCard({
  label,
  labelSecondary,
  value,
  labelClass,
  valueClass,
}: {
  label: string;
  labelSecondary?: string;
  value: string;
  labelClass: string;
  valueClass: string;
}) {
  return (
    <div className="rounded-2xl border border-[var(--color-border)]/65 bg-gradient-to-b from-white to-[var(--color-bg-primary)] shadow-[var(--shadow-soft)] px-4 py-3.5 flex flex-col justify-between gap-2 min-h-[5.75rem]">
      <div className="min-w-0">
        <span className={cn('text-[11px] sm:text-xs uppercase tracking-[0.12em] font-semibold block', labelClass)}>{label}</span>
        {labelSecondary ? (
          <span className="text-sm font-semibold text-theme-text-primary mt-1 block">{labelSecondary}</span>
        ) : null}
      </div>
      <span className={cn('text-xl sm:text-2xl leading-none tracking-tight font-bold tabular-nums', valueClass)}>{value}</span>
    </div>
  );
}

/** แถบผลรางวัล — ใช้ใต้แถบเลือกงวด / เหนือเมนูแท็บสรุป */
export function SummaryPrizeBar({
  data,
  loading,
  openResultModal,
  handleResetResult,
}: {
  data: ProfitSummary;
  loading: boolean;
  openResultModal: () => void;
  handleResetResult: () => void | Promise<void>;
}) {
  const rd = data.round.result_data as Record<string, unknown> | null | undefined;
  return (
    <div
      className={cn(
        'rounded-2xl border border-[var(--color-border)]/70 bg-gradient-to-b from-white via-[var(--color-card-bg-solid)] to-[var(--bg-glass-subtle)] shadow-[var(--shadow-soft)] px-4 py-3 sm:px-5 sm:py-3.5 transition-opacity duration-200 ease-out',
        loading && 'opacity-[0.62]',
      )}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch lg:gap-4">
        <div className="flex shrink-0 items-center gap-2 lg:flex-col lg:items-start lg:justify-center lg:min-w-[5.5rem] lg:border-r lg:border-[var(--color-border)]/80 lg:pr-4">
          <span className="text-[11px] font-bold uppercase tracking-[0.2em] text-theme-text-muted">ผลรางวัล</span>
          <span className="hidden lg:inline text-[11px] text-theme-text-muted leading-snug">งวด {data.round.name}</span>
        </div>

        <div className="min-w-0 flex-1 flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-3">
          {rd ? (
            <div className="min-w-0 flex-1 overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] py-0.5">
              <div className="flex w-max flex-nowrap items-stretch gap-2">
                {(() => {
                  const p1 = String(rd.prize_1st ?? '');
                  let top3raw = String(rd.prize_3top ?? '').trim();
                  if (top3raw.length < 3 && p1.length >= 3) top3raw = p1.slice(-3);
                  const top3 = top3raw.length >= 3 ? top3raw.slice(-3) : '';
                  const toteJoined = top3.length === 3 ? totePerms(top3).join(', ') : '';
                  const all: { label: string; val: string; themeKey: WinBetVisualKey | string; wide?: boolean }[] = [
                    { label: 'รางวัลที่ 1', val: p1, themeKey: 'prize_1st' },
                    { label: '3 ตัวบน', val: top3raw, themeKey: '3digit_top' },
                    { label: 'เลขโต๊ด', val: toteJoined, themeKey: '3digit_tote', wide: true },
                    {
                      label: '3 ตัวล่าง',
                      val: ((rd.prize_3bottom as string[] | undefined) ?? []).join(', '),
                      themeKey: '3digit_back',
                      wide: true,
                    },
                    { label: '2 ตัวบน', val: String(rd.prize_2top ?? ''), themeKey: '2digit_top' },
                    { label: '2 ตัวล่าง', val: String(rd.prize_2bottom ?? ''), themeKey: '2digit_bottom' },
                  ];
                  const nonEmpty = all.filter((r) => r.val.trim() !== '');
                  return nonEmpty.map((r) => {
                    const vis = winBetVisuals(r.themeKey);
                    return (
                      <div
                        key={r.label}
                        className={cn(
                          'flex flex-col justify-center rounded-xl border px-2 py-1.5 shadow-sm shrink-0',
                          vis.stripCard,
                          r.wide ? 'max-w-[11rem] sm:max-w-[13rem]' : 'min-w-[4rem]',
                          r.themeKey === 'prize_1st' && 'min-w-[6rem]',
                        )}
                      >
                        <span className={cn('text-center text-[9px] font-bold uppercase leading-none tracking-wide', vis.label)}>
                          {r.label}
                        </span>
                        <span
                          className={cn(
                            'mt-1 text-center tracking-tight leading-tight line-clamp-2 break-all',
                            r.themeKey === 'prize_1st'
                              ? 'text-xs font-bold sm:text-[13px]'
                              : 'text-[11px] font-semibold sm:text-xs',
                            vis.numberText,
                          )}
                          title={r.val}
                        >
                          {r.val}
                        </span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          ) : (
            <span className="text-sm italic text-theme-text-muted py-1">ยังไม่ได้ใส่ผลสลาก</span>
          )}

          <div className="flex shrink-0 flex-wrap items-center gap-2 justify-start sm:justify-end">
            {rd ? (
              <>
                <button
                  type="button"
                  onClick={openResultModal}
                  className="btn-toolbar-glow btn-fintech-search inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold !h-auto shadow-sm min-w-[6.5rem]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  แก้ไข
                </button>
                <button
                  type="button"
                  onClick={() => void handleResetResult()}
                  className="btn-toolbar-glow btn-fintech-rose inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold !h-auto shadow-sm min-w-[6.5rem]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  รีเซ็ต
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={openResultModal}
                className="btn-primary-glow inline-flex items-center justify-center gap-1.5 rounded-xl px-4 py-2.5 text-xs font-semibold !h-auto shadow-md min-w-[8rem]"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                ใส่ผลสลาก
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
