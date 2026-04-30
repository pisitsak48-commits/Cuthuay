'use client';
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { roundsApi, reportsApi } from '@/lib/api';
import { APP_BRAND_NAME } from '@/lib/brand';
import { openPrintPreview, buildPrintReportHeader } from '@/lib/printPreview';
import { cn } from '@/lib/utils';

const BET_TYPE_LABELS: Record<string, string> = {
  '3digit_top':    '3 ตัวบน',
  '3digit_tote':   '3 ตัวโต็ด',
  '3digit_back':   '3 ตัวล่าง',
  '2digit_top':    '2 ตัวบน',
  '2digit_bottom': '2 ตัวล่าง',
  '1digit_top':    'วิ่งบน',
  '1digit_bottom': 'วิ่งล่าง',
};
const BET_TYPES = Object.keys(BET_TYPE_LABELS);

/** ตารางผลถูกฉลากลูกค้า — ความกว้างคงที่ทุกการ์ด ให้คอลัมน์เลขตรงแนวกันทุกลูกค้า */
function WinsCustomerTableColGroup() {
  return (
    <colgroup>
      <col style={{ width: '11%' }} />
      <col style={{ width: '26%' }} />
      <col style={{ width: '14%' }} />
      <col style={{ width: '24%' }} />
      <col style={{ width: '25%' }} />
    </colgroup>
  );
}

/** ตารางผลถูกฉลากเจ้ามือ — คอลัมน์ประเภทกว้างคงที่ */
function WinsDealerTableColGroup() {
  return (
    <colgroup>
      <col style={{ width: '32%' }} />
      <col style={{ width: '18%' }} />
      <col style={{ width: '25%' }} />
      <col style={{ width: '25%' }} />
    </colgroup>
  );
}

/** สีป้ายเลขถูกตามประเภท — ตารางผลถูกฉลาก + บาร์ผลรางวัล (ให้ชุดสีตรงกัน) */
function winBetTypeBadgeClass(_betType: string): string {
  return 'border-[var(--color-border)] bg-[var(--color-badge-neutral-bg)] text-theme-text-secondary';
}

/** แท็บรายลูกค้า / รายเจ้ามือ — พื้นทึบอ่านง่าย ลดฟุ้งแบบ glass */
const SUMMARY_CD_SOLID = '!bg-[var(--color-card-bg-solid)] !backdrop-blur-none';
const SUMMARY_CD_BAR =
  'rounded-card border border-theme-card-border bg-[var(--color-card-bg-solid)] backdrop-blur-none shadow-card';

function fNum(v: number) { return Math.round(v).toLocaleString('th-TH'); }
/** หัวรายงาน PDF — รูปแบบ 24/04/2026 */
function formatReportDateDdMmYyyy(d: string) {
  const x = new Date(d);
  if (Number.isNaN(x.getTime())) return d;
  const dd = String(x.getDate()).padStart(2, '0');
  const mm = String(x.getMonth() + 1).padStart(2, '0');
  const yyyy = x.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}
function profitCls(v: number) {
  return v < 0 ? 'text-loss font-semibold' : v > 0 ? 'text-profit font-semibold' : 'text-theme-text-secondary';
}

function totePerms(num: string): string[] {
  if (num.length !== 3) return [];
  const d = num.split('');
  const s = new Set<string>();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
    if (i !== j && j !== k && i !== k) s.add(d[i]+d[j]+d[k]);
  }
  return Array.from(s).sort();
}

// ─── (printHtml replaced by openPrintPreview from @/lib/printPreview) ─────────

interface CustSummary {
  customer_id: string; name: string;
  /** อัตราคอมจากการตั้งค่าลูกค้า เช่น "20%" หรือ "20% · 5%" */
  commission_display: string;
  sold: number; pct_sold: number; remaining_sold: number;
  payout: number; net: number;
  by_type: Record<string, { sold: number; pct: number; payout: number }>;
  by_sheet: Record<number, { sold: number; pct: number; payout: number }>;
  by_sheet_by_type?: Record<string, Record<string, { sold: number; pct: number; payout: number }>>;
}

/** ยอดแยกตามแผ่น × ประเภท (สำหรับตารางสรุปเต็ม) */
function sheetTypeForCustomer(c: CustSummary, sheetKey: string, t: string) {
  const row = c.by_sheet_by_type?.[sheetKey]?.[t];
  return row ?? { sold: 0, pct: 0, payout: 0 };
}

interface DealerSummary {
  dealer_id: string; name: string;
  sent: number; pct_sent: number; remaining_sent: number;
  payout: number; net: number;
  by_type: Record<string, { sent: number; pct: number; payout: number }>;
}

/** สุทธิฝั่งส่งต่อประเภท (รวมทุกเจ้ามือ) = ยอดถูกเจ้ามือ − คงเหลือส่ง — ต้องบวกกับฝั่งขายเพื่อให้ผลกำไรต่อแถวตรงกับผลรวมงวด / โปรแกรมอ้างอิง */
function sendNetByBetType(dealers: DealerSummary[], betType: string): number {
  return dealers.reduce((sum, d) => {
    const bt = d.by_type[betType];
    if (!bt) return sum;
    const remaining = bt.sent - bt.pct;
    return sum + (bt.payout - remaining);
  }, 0);
}

interface ProfitSummary {
  round: { id: string; name: string; draw_date: string; result_data: Record<string, unknown> | null };
  profit: number;
  sell: { total: number; pct: number; remaining: number; payout: number; net: number };
  send: { total: number; pct: number; remaining: number; payout: number; net: number };
  customers: CustSummary[];
  dealers: DealerSummary[];
  by_type_sell: Record<string, { sold: number; pct: number; payout: number; net: number }>;
}
interface WinBet { sheet_no: number; bet_type: string; number: string; amount: number; payout: number; }
interface CustWin { customer_id: string; name: string; winning_bets: WinBet[]; total_amount: number; total_payout: number; }
interface DealerWinItem { bet_type: string; number: string; amount: number; payout: number; }
interface DealerWin { dealer_id: string; name: string; winning_items: DealerWinItem[]; total_amount: number; total_payout: number; }

// ─── Table cell helpers ───────────────────────────────────────────────────────
function Th({ children, right, className }: { children?: React.ReactNode; right?: boolean; className?: string }) {
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
function Td({ children, right, cls, className }: { children?: React.ReactNode; right?: boolean; cls?: string; className?: string }) {
  return (
    <td
      className={cn(
        'py-2.5 px-3.5 text-sm sm:text-[0.9375rem]',
        right ? 'text-right font-mono tabular-nums' : 'font-sans',
        cls,
        className,
      )}
    >
      {children}
    </td>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({
  label,
  value,
  labelClass,
  valueClass,
}: {
  label: string;
  value: string;
  labelClass: string;
  valueClass: string;
}) {
  return (
    <div className="rounded-card border border-theme-card-border bg-[var(--bg-glass-subtle)] shadow-card px-4 py-3.5 flex flex-col gap-1.5">
      <span className={cn('text-xs sm:text-sm uppercase tracking-wide font-semibold', labelClass)}>{label}</span>
      <span className={cn('text-2xl leading-none font-mono font-bold', valueClass)}>{value}</span>
    </div>
  );
}

// ─── Profit tab ───────────────────────────────────────────────────────────────
function ProfitTab({ data }: { data: ProfitSummary }) {
  const rd = data.round.result_data;

  function handlePrint() {
    const rdata = rd as Record<string, unknown> | null | undefined;
    let resultHtml = '';
    if (rdata && typeof rdata === 'object') {
      const p1 = String(rdata.prize_1st ?? '');
      let top3raw = String(rdata.prize_3top ?? '').trim();
      if (top3raw.length < 3 && p1.length >= 3) top3raw = p1.slice(-3);
      const parts: string[] = [];
      if (p1) parts.push(`<b>รางวัลที่ 1:</b> ${p1}`);
      if (top3raw) parts.push(`<b>3 ตัวบน:</b> ${top3raw}`);
      const b3 = (rdata.prize_3bottom as string[] | undefined) ?? [];
      if (b3.length) parts.push(`<b>3 ตัวล่าง:</b> ${b3.join(', ')}`);
      if (rdata.prize_2top) parts.push(`<b>2 ตัวบน:</b> ${String(rdata.prize_2top)}`);
      if (rdata.prize_2bottom) parts.push(`<b>2 ตัวล่าง:</b> ${String(rdata.prize_2bottom)}`);
      if (rdata.prize_1top) parts.push(`<b>วิ่งบน:</b> ${String(rdata.prize_1top)}`);
      if (rdata.prize_1bottom) parts.push(`<b>วิ่งล่าง:</b> ${String(rdata.prize_1bottom)}`);
      if (parts.length) resultHtml = `<div class="print-result-box">${parts.join(' &nbsp;·&nbsp; ')}</div>`;
    }

    const header = buildPrintReportHeader({
      reportTitle: 'รายงานสรุปผลกำไร',
      roundName: data.round.name,
      drawDateDdMmYyyy: formatReportDateDdMmYyyy(data.round.draw_date),
      pageNum: 1,
    });

    const profitBanner = `
      <div class="print-profit-banner">
        <span class="pp-label">ผลกำไร</span>
        <span class="pp-value ${data.profit < 0 ? 'neg' : 'pos'}">${fNum(data.profit)}</span>
        <span class="pp-unit">บาท</span>
      </div>`;

    const aggTable = `
      <table class="print-formal">
        <thead>
          <tr>
            <th class="l" style="width:14%">รายการ</th>
            <th>ยอดขายรวม / ยอดส่งรวม</th>
            <th>% ขายรวม / % ส่งรวม</th>
            <th>คงเหลือ</th>
            <th>ยอดถูกรวม</th>
            <th>ยอดสุทธิ</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th class="l">ขาย</th>
            <td class="num">${fNum(data.sell.total)}</td>
            <td class="num">${fNum(data.sell.pct)}</td>
            <td class="num">${fNum(data.sell.remaining)}</td>
            <td class="num">${fNum(data.sell.payout)}</td>
            <td class="num ${data.sell.net < 0 ? 'neg' : 'pos'}">${fNum(data.sell.net)}</td>
          </tr>
          <tr>
            <th class="l">ส่ง</th>
            <td class="num">${fNum(data.send.total)}</td>
            <td class="num">${fNum(data.send.pct)}</td>
            <td class="num">${fNum(data.send.remaining)}</td>
            <td class="num">${fNum(data.send.payout)}</td>
            <td class="num ${data.send.net < 0 ? 'neg' : 'pos'}">${fNum(data.send.net)}</td>
          </tr>
        </tbody>
      </table>`;

    const custRows = data.customers.map(c => `
      <tr>
        <td class="l">${c.name}</td>
        <td class="num">${fNum(c.sold)}</td>
        <td class="num">${fNum(c.pct_sold)}</td>
        <td class="num">${fNum(c.remaining_sold)}</td>
        <td class="num">${fNum(c.payout)}</td>
        <td class="num ${c.net < 0 ? 'neg' : 'pos'}">${fNum(c.net)}</td>
      </tr>`).join('');

    const custTable = `
      <div class="print-yellow-bar">รายการสรุปยอด ลูกค้า</div>
      <table class="print-formal">
        <thead>
          <tr>
            <th class="l">ชื่อ</th>
            <th>ยอด ขาย-ส่ง</th>
            <th>เปอร์เซนต์</th>
            <th>คงเหลือ</th>
            <th>ยอดถูก</th>
            <th>ยอดสุทธิ</th>
          </tr>
        </thead>
        <tbody>${custRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td class="l">รวม</td>
            <td class="num">${fNum(data.sell.total)}</td>
            <td class="num">${fNum(data.sell.pct)}</td>
            <td class="num">${fNum(data.sell.remaining)}</td>
            <td class="num">${fNum(data.sell.payout)}</td>
            <td class="num ${data.sell.net < 0 ? 'neg' : 'pos'}">${fNum(data.sell.net)}</td>
          </tr>
        </tfoot>
      </table>`;

    const dealerBlock =
      data.dealers.length === 0
        ? ''
        : (() => {
            const dealerRows = data.dealers.map(d => `
      <tr>
        <td class="l">${d.name}</td>
        <td class="num">${fNum(d.sent)}</td>
        <td class="num">${fNum(d.pct_sent)}</td>
        <td class="num">${fNum(d.remaining_sent)}</td>
        <td class="num">${fNum(d.payout)}</td>
        <td class="num ${d.net < 0 ? 'neg' : 'pos'}">${fNum(d.net)}</td>
      </tr>`).join('');
            return `
      <div class="print-yellow-bar">รายการสรุปยอด เจ้ามือ</div>
      <table class="print-formal">
        <thead>
          <tr>
            <th class="l">ชื่อ</th>
            <th>ยอด ขาย-ส่ง</th>
            <th>เปอร์เซนต์</th>
            <th>คงเหลือ</th>
            <th>ยอดถูก</th>
            <th>ยอดสุทธิ</th>
          </tr>
        </thead>
        <tbody>${dealerRows}</tbody>
        <tfoot>
          <tr class="total-row">
            <td class="l">รวม</td>
            <td class="num">${fNum(data.send.total)}</td>
            <td class="num">${fNum(data.send.pct)}</td>
            <td class="num">${fNum(data.send.remaining)}</td>
            <td class="num">${fNum(data.send.payout)}</td>
            <td class="num ${data.send.net < 0 ? 'neg' : 'pos'}">${fNum(data.send.net)}</td>
          </tr>
        </tfoot>
      </table>`;
          })();

    const typeRows = BET_TYPES.map(t => {
      const row = data.by_type_sell[t];
      if (!row) return '';
      const sellNet = row.net;
      const sendNet = sendNetByBetType(data.dealers, t);
      const pr = sellNet + sendNet;
      const sent = data.dealers.reduce((sum, dealer) => sum + (dealer.by_type[t]?.sent ?? 0), 0);
      return `<tr><td class="l">${BET_TYPE_LABELS[t]}</td><td class="num">${fNum(row.sold)}</td><td class="num">${fNum(sent)}</td><td class="num ${pr < 0 ? 'neg' : 'pos'}">${fNum(pr)}</td></tr>`;
    }).join('');

    const byTypeTable = `
      <div class="print-yellow-bar">แยกตามประเภทการขาย</div>
      <table class="print-formal">
        <thead>
          <tr>
            <th class="l">ประเภท</th>
            <th>ขาย</th>
            <th>ส่ง</th>
            <th>ผลกำไร</th>
          </tr>
        </thead>
        <tbody>${typeRows}</tbody>
      </table>`;

    const html =
      `${header}${resultHtml}${profitBanner}${aggTable}${custTable}${dealerBlock}${byTypeTable}`;
    const title = `สรุปผลกำไร งวด ${data.round.name}`;
    openPrintPreview(`<div class="print-root print-formal-doc">${html}</div>`, title, `สรุปกำไร_งวด${data.round.name}`);
  }

  return (
    <div className="space-y-4">
      {/* Notice: round not drawn yet */}
      {!rd && (
        <div className="rounded-lg border border-[var(--color-badge-warning-border)] bg-[var(--color-badge-warning-bg)] px-4 py-3 flex items-start gap-3">
          <span className="text-theme-text-primary text-lg leading-none mt-0.5">⚠</span>
          <div>
            <div className="text-sm font-semibold text-theme-text-primary">งวดนี้ยังไม่ออกผลสลาก</div>
            <div className="text-xs text-theme-text-secondary mt-0.5">ยอดถูกรางวัลและยอดจ่ายจะแสดงหลังจากกรอกผลสลากแล้วเท่านั้น เลขอั้นที่ตั้งไว้จะถูกนำมาคำนวณโดยอัตโนมัติเมื่อออกผล</div>
          </div>
        </div>
      )}

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <KpiCard
          label="ยอดขายรวม"
          value={fNum(data.sell.total)}
          labelClass="text-profit/85"
          valueClass="text-profit"
        />
        <KpiCard
          label="จ่ายรางวัล"
          value={fNum(data.sell.payout)}
          labelClass="text-loss/85"
          valueClass="text-loss"
        />
        <KpiCard
          label="คงเหลือ (ขาย)"
          value={fNum(data.sell.remaining)}
          labelClass="text-accent-hover/85"
          valueClass="text-accent"
        />
      </div>

      {/* Profit bar (report-style emphasis) */}
      <Card className="p-0 overflow-hidden border-theme-card-border shadow-[var(--shadow-soft)]">
        <div className="px-5 py-4.5 bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs sm:text-sm uppercase tracking-[0.14em] text-theme-text-secondary">สรุปสุทธิ</div>
            <div className="text-xl font-semibold text-theme-text-primary mt-0.5">ผลกำไร</div>
          </div>
          <span className={`text-3xl sm:text-4xl font-mono font-bold tracking-tight ${data.profit >= 0 ? 'text-profit' : 'text-loss'}`}>
            {fNum(data.profit)}
          </span>
        </div>
      </Card>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)] gap-4 2xl:gap-6 items-start">
        <div className="space-y-4 min-w-0">
          {/* Sell / Send summary */}
          <Card className="p-0 overflow-hidden border-theme-card-border rounded-card shadow-card">
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
              <CardTitle size="lg">สรุปยอดขาย / ส่ง</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)]">
                    <Th />
                    <Th right>ยอดรวม</Th>
                    <Th right>ค่าคอม (฿)</Th>
                    <Th right>คงเหลือ</Th>
                    <Th right>ยอดถูกรางวัล</Th>
                    <Th right>ยอดสุทธิ</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="table-row-hover hover:bg-[var(--bg-hover)]">
                    <Td cls="text-theme-text-secondary font-medium">ยอดขายรวม</Td>
                    <Td right>{fNum(data.sell.total)}</Td>
                    <Td right>{fNum(data.sell.pct)}</Td>
                    <Td right>{fNum(data.sell.remaining)}</Td>
                    <Td right cls="text-loss">{fNum(data.sell.payout)}</Td>
                    <Td right cls={profitCls(data.sell.net)}>{fNum(data.sell.net)}</Td>
                  </tr>
                  <tr className="table-row-hover hover:bg-[var(--bg-hover)]">
                    <Td cls="text-theme-text-secondary font-medium">ยอดส่งรวม</Td>
                    <Td right>{fNum(data.send.total)}</Td>
                    <Td right>{fNum(data.send.pct)}</Td>
                    <Td right>{fNum(data.send.remaining)}</Td>
                    <Td right cls="text-loss">{fNum(data.send.payout)}</Td>
                    <Td right cls={profitCls(data.send.net)}>{fNum(data.send.net)}</Td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Customer breakdown */}
          <Card className="p-0 overflow-hidden border-theme-card-border rounded-card shadow-card">
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
              <CardTitle size="lg">สรุปรายลูกค้า</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)]">
                    <Th>ลูกค้า</Th>
                    <Th right>ยอดขาย</Th>
                    <Th right>ค่าคอม (฿)</Th>
                    <Th right>คงเหลือ</Th>
                    <Th right>ยอดถูก</Th>
                    <Th right>ยอดสุทธิ</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.customers.map(c => (
                    <tr key={c.customer_id} className="table-row-hover hover:bg-[var(--bg-hover)]">
                      <Td cls="text-theme-text-primary font-medium">{c.name}</Td>
                      <Td right>{fNum(c.sold)}</Td>
                      <Td right cls="text-theme-text-secondary">{fNum(c.pct_sold)}</Td>
                      <Td right>{fNum(c.remaining_sold)}</Td>
                      <Td right cls="text-loss">{fNum(c.payout)}</Td>
                      <Td right cls={profitCls(c.net)}>{fNum(c.net)}</Td>
                    </tr>
                  ))}
                  <tr className="bg-surface-50">
                    <Td cls="text-theme-text-secondary font-semibold">รวม</Td>
                    <Td right cls="text-theme-text-primary font-semibold">{fNum(data.sell.total)}</Td>
                    <Td right cls="text-theme-text-secondary font-semibold">{fNum(data.sell.pct)}</Td>
                    <Td right cls="text-theme-text-primary font-semibold">{fNum(data.sell.remaining)}</Td>
                    <Td right cls="text-loss font-semibold">{fNum(data.sell.payout)}</Td>
                    <Td right cls={`${profitCls(data.sell.net)} font-semibold`}>{fNum(data.sell.net)}</Td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Dealer breakdown */}
          {data.dealers.length > 0 && (
            <Card className="p-0 overflow-hidden border-theme-card-border rounded-card shadow-card">
              <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
                <CardTitle size="lg">สรุปรายเจ้ามือ</CardTitle>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[var(--bg-glass-subtle)]">
                      <Th>เจ้ามือ</Th>
                      <Th right>ยอดส่ง</Th>
                      <Th right>ค่าคอม (฿)</Th>
                      <Th right>คงเหลือ</Th>
                      <Th right>ยอดถูก</Th>
                      <Th right>ยอดสุทธิ</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.dealers.map(d => (
                      <tr key={d.dealer_id} className="table-row-hover hover:bg-[var(--bg-hover)]">
                        <Td cls="text-theme-text-primary font-medium">{d.name}</Td>
                        <Td right>{fNum(d.sent)}</Td>
                        <Td right cls="text-theme-text-secondary">{fNum(d.pct_sent)}</Td>
                        <Td right>{fNum(d.remaining_sent)}</Td>
                        <Td right cls="text-loss">{fNum(d.payout)}</Td>
                        <Td right cls={profitCls(d.net)}>{fNum(d.net)}</Td>
                      </tr>
                    ))}
                    <tr className="bg-surface-50">
                      <Td cls="text-theme-text-secondary font-semibold">รวม</Td>
                      <Td right cls="text-theme-text-primary font-semibold">{fNum(data.send.total)}</Td>
                      <Td right cls="text-theme-text-secondary font-semibold">{fNum(data.send.pct)}</Td>
                      <Td right cls="text-theme-text-primary font-semibold">{fNum(data.send.remaining)}</Td>
                      <Td right cls="text-loss font-semibold">{fNum(data.send.payout)}</Td>
                      <Td right cls={`${profitCls(data.send.net)} font-semibold`}>{fNum(data.send.net)}</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </div>

        <div className="max-xl:static xl:sticky xl:top-4 space-y-3 min-w-0 w-full">
          <Card className="p-0 overflow-hidden border-theme-card-border rounded-card shadow-card">
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
              <CardTitle size="lg" className="min-w-0">แยกตามประเภทการขาย</CardTitle>
              <span className="text-xs text-theme-text-secondary font-medium shrink-0">ดูเร็ว</span>
            </div>
            <div className="overflow-x-auto pb-5">
              <table className="w-full table-fixed min-w-[340px]">
                <colgroup>
                  <col className="w-[34%]" />
                  <col className="w-[22%]" />
                  <col className="w-[22%]" />
                  <col className="w-[22%]" />
                </colgroup>
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)]">
                    <th className="py-2.5 pl-5 pr-2 sm:pr-3 text-xs sm:text-[0.8125rem] text-theme-text-secondary font-semibold tracking-wide border-b border-[var(--color-border)] text-left align-bottom">
                      ประเภท
                    </th>
                    <th className="py-2.5 px-2 sm:px-3 text-xs sm:text-[0.8125rem] text-theme-text-secondary font-semibold tracking-wide border-b border-[var(--color-border)] text-right whitespace-nowrap">
                      ขาย
                    </th>
                    <th className="py-2.5 px-2 sm:px-3 text-xs sm:text-[0.8125rem] text-theme-text-secondary font-semibold tracking-wide border-b border-[var(--color-border)] text-right whitespace-nowrap">
                      ส่ง
                    </th>
                    <th className="py-2.5 pl-2 sm:pl-3 pr-5 text-xs sm:text-[0.8125rem] text-theme-text-secondary font-semibold tracking-wide border-b border-[var(--color-border)] text-right whitespace-nowrap">
                      ผลกำไร
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {BET_TYPES.map(t => {
                    const row = data.by_type_sell[t];
                    if (!row) return null;
                    const sellNet = row.net;
                    const sendNet = sendNetByBetType(data.dealers, t);
                    const profit = sellNet + sendNet;
                    const sent = data.dealers.reduce((sum, dealer) => sum + (dealer.by_type[t]?.sent ?? 0), 0);
                    return (
                      <tr key={t} className="table-row-hover hover:bg-[var(--bg-hover)]">
                        <td className="py-2.5 pl-5 pr-2 sm:pr-3 text-sm font-sans text-theme-text-secondary align-middle break-words">
                          {BET_TYPE_LABELS[t]}
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-sm text-right font-mono tabular-nums text-[13px] sm:text-sm text-theme-text-primary whitespace-nowrap align-middle">
                          {fNum(row.sold)}
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-sm text-right font-mono tabular-nums text-[13px] sm:text-sm text-theme-text-secondary whitespace-nowrap align-middle">
                          {fNum(sent)}
                        </td>
                        <td className={`py-2.5 pl-2 sm:pl-3 pr-5 text-sm text-right font-mono tabular-nums text-[13px] sm:text-sm whitespace-nowrap align-middle ${profitCls(profit)}`}>
                          {fNum(profit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* PDF print button — prominent, at bottom of right panel */}
          <button
            onClick={handlePrint}
            className="w-full flex items-center justify-center gap-2 rounded-xl border border-theme-card-border bg-white text-theme-text-primary font-semibold text-sm py-3 px-4 shadow-[var(--shadow-soft)] hover:bg-[var(--bg-hover)] hover:shadow-[var(--shadow-hover)] transition-[background-color,box-shadow] duration-200 [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
            </svg>
            พิมพ์ PDF
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customer tab ─────────────────────────────────────────────────────────────
function CustomerTab({ data, roundId }: { data: ProfitSummary; roundId: string }) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [reportType, setReportType] = useState<'brief' | 'full' | 'wins'>('wins');
  const [winsData, setWinsData]     = useState<CustWin[] | null>(null);
  const [winsLoading, setWinsLoading] = useState(false);
  const customer = data.customers.find(c => c.customer_id === selectedId);
  const customerTargets = selectedId && customer ? [customer] : data.customers;

  // Reset wins cache when round changes
  useEffect(() => { setWinsData(null); }, [roundId]);

  // Lazy-load wins when tab is first selected
  useEffect(() => {
    if (reportType !== 'wins' || !roundId || winsData !== null) return;
    setWinsLoading(true);
    reportsApi.customerWins(roundId)
      .then(res => setWinsData(res.data.customers))
      .catch(() => setWinsData([]))
      .finally(() => setWinsLoading(false));
  }, [reportType, roundId, winsData]);

  const winsTargets = selectedId
    ? (winsData?.filter(c => c.customer_id === selectedId) ?? [])
    : (winsData ?? []);

  const customerOverview = selectedId && customer
    ? {
        sold: customer.sold,
        pct: customer.pct_sold,
        remaining: customer.remaining_sold,
        payout: customer.payout,
        net: customer.net,
      }
    : {
        sold: data.sell.total,
        pct: data.sell.pct,
        remaining: data.sell.remaining,
        payout: data.sell.payout,
        net: data.sell.net,
      };

  const customerByType = BET_TYPES.map(t => {
    if (selectedId && customer) {
      const row = customer.by_type[t] ?? { sold: 0, pct: 0, payout: 0 };
      return { type: t, sold: row.sold, pct: row.pct, payout: row.payout };
    }
    const row = data.by_type_sell[t] ?? { sold: 0, pct: 0, payout: 0, net: 0 };
    return { type: t, sold: row.sold, pct: row.pct, payout: row.payout };
  });

  function handlePrint() {
    if (reportType === 'wins') {
      if (winsTargets.length === 0) return;
      const sections = winsTargets.map(w => {
        const rows = w.winning_bets.map((b, i) => `
          <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
            <td style="text-align:center">${b.sheet_no}</td>
            <td>${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
            <td style="text-align:center"><span style="font-weight:700">${b.number}</span></td>
            <td class="num"><span style="font-weight:400">${fNum(b.amount)}</span></td>
            <td class="num" style="color:#c00"><span style="font-weight:400">${fNum(b.payout)}</span></td>
          </tr>`).join('');

        return `
          <div class="section-title">ลูกค้า : ${w.name}</div>
          <table style="table-layout:fixed;width:100%"><thead><tr><th style="width:11%">แผ่นที่</th><th style="width:26%">ประเภท</th><th style="width:14%">เลข</th><th style="width:24%">ราคา</th><th style="width:25%">ยอดจ่าย</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#999">ไม่มีรายการถูกรางวัล</td></tr>'}</tbody>
          ${rows ? `<tfoot><tr class="total-row"><td colspan="3" class="num">รวม</td><td class="num">${fNum(w.total_amount)}</td><td class="num" style="color:#c00">${fNum(w.total_payout)}</td></tr></tfoot>` : ''}
          </table>`;
      }).join('');

      const title = selectedId
        ? `รายงานตรวจผลการขาย ${customer?.name ?? ''}`
        : 'รายงานตรวจผลการขาย (ลูกค้าทั้งหมด)';
      const filename = selectedId
        ? `ตรวจผลการขาย_${customer?.name ?? 'ลูกค้า'}_งวด${data.round.name}`
        : `ตรวจผลการขาย_ทุกลูกค้า_งวด${data.round.name}`;
      const hdr = buildPrintReportHeader({
        reportTitle: title,
        roundName: data.round.name,
        drawDateDdMmYyyy: formatReportDateDdMmYyyy(data.round.draw_date),
      });
      openPrintPreview(`<div class="print-root print-formal-doc">${hdr}${sections}</div>`, title, filename);
      return;
    }
    const sections = customerTargets.map(c => {
      const sheetRows = Object.entries(c.by_sheet).sort(([a],[b]) => Number(a)-Number(b)).map(([sh, row]) => {
        const net = row.sold - row.pct - row.payout;
        return `<tr><td>แผ่น ${sh}</td><td class="num">${fNum(row.sold)}</td><td class="num">${fNum(row.pct)}</td><td class="num">${fNum(row.sold-row.pct)}</td><td class="num" style="color:#c00">${fNum(row.payout)}</td><td class="num ${net<0?'neg':'pos'}">${fNum(net)}</td></tr>`;
      }).join('');
      const typeRows = BET_TYPES.map(t => {
        const row = c.by_type[t] ?? { sold:0, pct:0, payout:0 };
        const net = row.sold - row.pct - row.payout;
        return `<tr><td>${BET_TYPE_LABELS[t]}</td><td class="num">${fNum(row.sold)}</td><td class="num">${fNum(row.pct)}</td><td class="num">${fNum(row.sold-row.pct)}</td><td class="num" style="color:#c00">${fNum(row.payout)}</td><td class="num ${net<0?'neg':'pos'}">${fNum(net)}</td></tr>`;
      }).join('');
      return `
        <div class="section-title">${c.name} (อัตราคอม ${c.commission_display})</div>
        <div style="font-size:12px;color:#555;margin-bottom:6px">สรุปรายแผ่น</div>
        <table><thead><tr><th>แผ่นที่</th><th>ขาย</th><th>ค่าคอม (฿)</th><th>คงเหลือ</th><th>ถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${sheetRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(c.sold)}</td><td class="num">${fNum(c.pct_sold)}</td><td class="num">${fNum(c.remaining_sold)}</td><td class="num" style="color:#c00">${fNum(c.payout)}</td><td class="num ${c.net<0?'neg':'pos'}">${fNum(c.net)}</td></tr></tfoot>
        </table>
        <div style="font-size:12px;color:#555;margin:8px 0 4px">แยกตามประเภท</div>
        <table><thead><tr><th>ประเภท</th><th>ขาย</th><th>ค่าคอม (฿)</th><th>คงเหลือ</th><th>ถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${typeRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(c.sold)}</td><td class="num">${fNum(c.pct_sold)}</td><td class="num">${fNum(c.remaining_sold)}</td><td class="num" style="color:#c00">${fNum(c.payout)}</td><td class="num ${c.net<0?'neg':'pos'}">${fNum(c.net)}</td></tr></tfoot>
        </table>`;
    }).join('');
    const title = reportType === 'brief'
      ? (selectedId ? `รายงานสรุปลูกค้า (ย่อ) ${customer?.name ?? ''}` : 'รายงานสรุปลูกค้า (ย่อ)')
      : (selectedId ? `รายงานสรุปลูกค้า (เต็ม) ${customer?.name ?? ''}` : 'รายงานสรุปลูกค้า (เต็ม)');
    const filename = reportType === 'brief'
      ? (selectedId ? `สรุปลูกค้า_ย่อ_${customer?.name ?? 'ลูกค้า'}_งวด${data.round.name}` : `สรุปลูกค้า_ย่อ_ทุกลูกค้า_งวด${data.round.name}`)
      : (selectedId ? `สรุปลูกค้า_เต็ม_${customer?.name ?? 'ลูกค้า'}_งวด${data.round.name}` : `สรุปลูกค้า_เต็ม_ทุกลูกค้า_งวด${data.round.name}`);
    const hdr = buildPrintReportHeader({
      reportTitle: title,
      roundName: data.round.name,
      drawDateDdMmYyyy: formatReportDateDdMmYyyy(data.round.draw_date),
    });
    openPrintPreview(`<div class="print-root print-formal-doc">${hdr}${sections}</div>`, title, filename);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className={cn(SUMMARY_CD_BAR, 'px-3 py-3 flex flex-wrap gap-3 items-end')}>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-theme-text-secondary">ลูกค้า</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
            <option value="">ลูกค้าทั้งหมด</option>
            {data.customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-theme-text-secondary">รูปแบบรายงาน</label>
          <select value={reportType} onChange={e => setReportType(e.target.value as 'brief' | 'full' | 'wins')}
            className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
            <option value="wins">ผลถูกฉลาก — รายการถูกรางวัล</option>
            <option value="brief">สรุปลูกค้า (ย่อ) — รายแผ่น</option>
            <option value="full">สรุปลูกค้า (เต็ม) — รายแผ่น × ประเภท</option>
          </select>
        </div>
        <Button variant="outline" onClick={handlePrint} disabled={reportType === 'wins' && winsTargets.length === 0}>พิมพ์ PDF</Button>
      </div>

      {/* Wins view */}
      {reportType === 'wins' && (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
          <Card className={cn('p-0 overflow-hidden border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
              <CardTitle size="lg">ผลถูกฉลาก — {selectedId ? (customer?.name ?? '...') : 'ลูกค้าทั้งหมด'}</CardTitle>
            </div>
            {winsLoading ? (
              <div className="py-12 text-center text-theme-text-muted text-sm">กำลังโหลด...</div>
            ) : winsTargets.length === 0 ? (
              <div className="py-12 text-center text-theme-text-muted text-sm">ไม่มีข้อมูลผลถูกรางวัล</div>
            ) : (
              <div className="space-y-4 p-4">
                {winsTargets.map(w => (
                  <Card
                    key={w.customer_id}
                    className={cn('p-0 overflow-hidden border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}
                  >
                    <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
                      <CardTitle size="lg">{w.name}</CardTitle>
                      <span className="text-xs text-theme-text-muted whitespace-nowrap hidden sm:inline">ผลถูกฉลาก</span>
                    </div>
                    {w.winning_bets.length === 0 ? (
                      <div className="py-8 text-center text-theme-text-muted text-sm">ไม่มีรายการถูกรางวัล</div>
                    ) : (
                      <div className="min-w-0 overflow-x-auto">
                        <table className="w-full table-fixed border-collapse">
                          <WinsCustomerTableColGroup />
                          <thead>
                            <tr className="bg-[var(--bg-glass-subtle)]">
                              <Th>แผ่นที่</Th>
                              <Th>ประเภท</Th>
                              <Th className="!text-center">เลข</Th>
                              <Th right>ราคา</Th>
                              <Th right>ยอดจ่าย</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {w.winning_bets.map((b, i) => (
                              <tr key={i} className="table-row-hover hover:bg-[var(--bg-hover)] border-b border-[var(--color-border)]">
                                <Td cls="text-center text-theme-text-secondary tabular-nums">{b.sheet_no}</Td>
                                <Td cls="text-theme-text-secondary whitespace-normal break-words">{BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</Td>
                                <Td cls="text-center align-middle">
                                  <span
                                    className={cn(
                                      'inline-flex min-w-[2.5rem] justify-center rounded-md border px-1.5 py-0.5 font-mono text-[0.9em] font-semibold tabular-nums tracking-wide',
                                      winBetTypeBadgeClass(b.bet_type),
                                    )}
                                  >
                                    {b.number}
                                  </span>
                                </Td>
                                <Td right cls="text-theme-text-primary">{fNum(b.amount)}</Td>
                                <Td right cls="text-loss font-semibold tabular-nums">{fNum(b.payout)}</Td>
                              </tr>
                            ))}
                            <tr className="bg-surface-50">
                              <td colSpan={3} className="py-2.5 px-3.5 text-sm font-sans font-semibold text-theme-text-secondary">รวม</td>
                              <Td right cls="text-theme-text-primary font-semibold tabular-nums">{fNum(w.total_amount)}</Td>
                              <Td right cls="text-loss font-semibold tabular-nums">{fNum(w.total_payout)}</Td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </Card>

          <div className="max-2xl:static 2xl:sticky 2xl:top-4">
            <Card className={cn('p-4 space-y-3 border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
              <CardTitle size="lg">{selectedId ? (customer?.name ?? 'ลูกค้า') : 'ลูกค้าทั้งหมด'}</CardTitle>
              <div className="summary-side-stack mb-3">
                {([
                  ['ยอดขาย', customerOverview.sold, 'text-theme-text-primary'],
                  ['ยอดคอม (฿)', customerOverview.pct, 'text-theme-text-secondary'],
                  ['คงเหลือ', customerOverview.remaining, 'text-theme-text-primary'],
                  ['ยอดถูก', customerOverview.payout, 'text-loss font-semibold'],
                  ['ยอดสุทธิ', customerOverview.net, profitCls(customerOverview.net)],
                ] as [string, number, string][]).map(([label, val, valCls]) => (
                  <div key={label} className="summary-side-row">
                    <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                    <span className={`font-mono tabular-nums text-right shrink-0 ${valCls}`}>{fNum(val)}</span>
                  </div>
                ))}
              </div>

              <div className="summary-side-stack">
                <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                  <span className="font-sans min-w-0">ประเภท</span>
                  <span className="text-right font-sans">ยอดขาย</span>
                  <span className="text-right font-sans">ยอดคอม (฿)</span>
                  <span className="text-right font-sans">ยอดถูก</span>
                </div>
                {customerByType.map(row => (
                  <div key={row.type} className="summary-type-grid-r">
                    <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                    <span className="font-mono tabular-nums text-right text-theme-text-primary">{fNum(row.sold)}</span>
                    <span className="font-mono tabular-nums text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                    <span className="font-mono tabular-nums text-right text-loss font-medium">{fNum(row.payout)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {/* Other views (brief / full) */}
      {reportType !== 'wins' && customerTargets.length > 0 && (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            {customerTargets.map(c => (
              <div key={c.customer_id} className="flex gap-4 items-start">
              <Card className={cn('p-0 overflow-hidden flex-1 border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
                <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)] flex items-center justify-between">
                  <CardTitle size="lg">{c.name}</CardTitle>
                  <span className="text-sm font-medium text-theme-text-secondary" title="อัตราหักคอมจากยอดขายตามที่ตั้งในลูกค้า">
                    อัตราคอม {c.commission_display}
                  </span>
                </div>

                {reportType === 'brief' && (
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="bg-[var(--bg-glass-subtle)]">
                          <Th>แผ่นที่</Th>
                          <Th right>ขาย</Th>
                          <Th right>ค่าคอม (฿)</Th>
                          <Th right>คงเหลือ</Th>
                          <Th right>ถูก</Th>
                          <Th right>สุทธิ</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(c.by_sheet).sort(([a],[b]) => Number(a)-Number(b)).map(([sheet, row]) => {
                          const net = row.sold - row.pct - row.payout;
                          return (
                            <tr key={sheet} className="table-row-hover hover:bg-[var(--bg-hover)]">
                              <Td cls="text-theme-text-secondary font-medium">แผ่น {sheet}</Td>
                              <Td right>{fNum(row.sold)}</Td>
                              <Td right cls="text-theme-text-secondary">{fNum(row.pct)}</Td>
                              <Td right>{fNum(row.sold - row.pct)}</Td>
                              <Td right cls="text-loss">{fNum(row.payout)}</Td>
                              <Td right cls={profitCls(net)}>{fNum(net)}</Td>
                            </tr>
                          );
                        })}
                        <tr className="bg-surface-50">
                          <Td cls="text-theme-text-secondary font-semibold">รวม</Td>
                          <Td right cls="text-theme-text-primary font-semibold">{fNum(c.sold)}</Td>
                          <Td right cls="text-theme-text-secondary font-semibold">{fNum(c.pct_sold)}</Td>
                          <Td right cls="text-theme-text-primary font-semibold">{fNum(c.remaining_sold)}</Td>
                          <Td right cls="text-loss font-semibold">{fNum(c.payout)}</Td>
                          <Td right cls={`${profitCls(c.net)} font-semibold`}>{fNum(c.net)}</Td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {reportType === 'full' && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-[var(--bg-glass-subtle)]">
                          <Th>แผ่น</Th>
                          <Th />
                          {BET_TYPES.map(t => <Th key={t} right>{BET_TYPE_LABELS[t]}</Th>)}
                          <Th right>รวม</Th>
                        </tr>
                      </thead>
                      <tbody>
                        {Object.entries(c.by_sheet).sort(([a],[b]) => Number(a)-Number(b)).flatMap(([sheet, row]) => {
                          const net = row.sold - row.pct - row.payout;
                          return [
                            <tr key={`${c.customer_id}-${sheet}-s`} className="table-row-hover hover:bg-[var(--bg-hover)]">
                              <td className="py-1.5 px-3 text-center text-theme-text-secondary font-semibold" rowSpan={3}>{sheet}</td>
                              <td className="py-1.5 px-3 text-xs font-sans text-theme-text-secondary">ขาย</td>
                              {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right font-mono">{fNum(sheetTypeForCustomer(c, sheet, t).sold)}</td>)}
                              <td className="py-1.5 px-3 text-right font-mono font-semibold text-theme-text-primary">{fNum(row.sold)}</td>
                            </tr>,
                            <tr key={`${c.customer_id}-${sheet}-p`} className="table-row-hover hover:bg-[var(--bg-hover)]">
                              <td className="py-1.5 px-3 text-sm font-sans text-theme-text-muted">ยอดคอม (฿)</td>
                              {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right font-mono text-theme-text-muted">{fNum(sheetTypeForCustomer(c, sheet, t).pct)}</td>)}
                              <td className="py-1.5 px-3 text-right font-mono text-theme-text-muted">{fNum(row.pct)}</td>
                            </tr>,
                            <tr key={`${c.customer_id}-${sheet}-w`} className="border-b border-[var(--color-border)] table-row-hover hover:bg-[var(--bg-hover)]">
                              <td className="py-1.5 px-3 text-xs font-sans text-loss">ยอดถูก</td>
                              {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right font-mono text-loss">{fNum(sheetTypeForCustomer(c, sheet, t).payout)}</td>)}
                              <td className={`py-1.5 px-3 text-right font-mono ${profitCls(net)}`}>{fNum(net)}</td>
                            </tr>,
                          ];
                        })}
                        {[
                          { label: 'ขาย',     cls: 'text-theme-text-primary', vals: BET_TYPES.map(t => c.by_type[t]?.sold ?? 0), total: c.sold },
                          { label: 'ยอดคอม (฿)',   cls: 'text-theme-text-muted', vals: BET_TYPES.map(t => c.by_type[t]?.pct ?? 0),  total: c.pct_sold },
                          { label: 'คงเหลือ', cls: 'text-theme-text-primary', vals: BET_TYPES.map(t => (c.by_type[t]?.sold ?? 0) - (c.by_type[t]?.pct ?? 0)), total: c.remaining_sold },
                          { label: 'ยอดถูก', cls: 'text-loss',  vals: BET_TYPES.map(t => c.by_type[t]?.payout ?? 0), total: c.payout },
                          { label: 'สุทธิ',   cls: profitCls(c.net), vals: BET_TYPES.map(t => (c.by_type[t]?.sold ?? 0)-(c.by_type[t]?.pct ?? 0)-(c.by_type[t]?.payout ?? 0)), total: c.net },
                        ].map(({ label, cls, vals, total }) => (
                          <tr key={`${c.customer_id}-${label}`} className="bg-surface-50 font-bold">
                            <td className="py-1.5 px-3 text-center text-theme-text-secondary">รวม</td>
                            <td className={`py-1.5 px-3 text-xs font-sans ${cls}`}>{label}</td>
                            {vals.map((v, i) => <td key={i} className={`py-1.5 px-3 text-right font-mono ${cls}`}>{fNum(v)}</td>)}
                            <td className={`py-1.5 px-3 text-right font-mono ${cls}`}>{fNum(total)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              </div>
            ))}
          </div>

          <div className="max-2xl:static 2xl:sticky 2xl:top-4">
            <Card className={cn('p-4 space-y-3 border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
              <CardTitle size="lg">{selectedId ? (customer?.name ?? 'ลูกค้า') : 'ลูกค้าทั้งหมด'}</CardTitle>
              <div className="summary-side-stack mb-3">
                {([
                  ['ยอดขาย', customerOverview.sold, 'text-theme-text-primary'],
                  ['ยอดคอม (฿)', customerOverview.pct, 'text-theme-text-secondary'],
                  ['คงเหลือ', customerOverview.remaining, 'text-theme-text-primary'],
                  ['ยอดถูก', customerOverview.payout, 'text-loss'],
                  ['ยอดสุทธิ', customerOverview.net, profitCls(customerOverview.net)],
                ] as [string, number, string][]).map(([label, val, cls]) => (
                  <div key={label} className="summary-side-row">
                    <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                    <span className={`font-mono tabular-nums text-sm text-right shrink-0 ${cls}`}>{fNum(val)}</span>
                  </div>
                ))}
              </div>

              <div className="summary-side-stack">
                <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                  <span className="font-sans min-w-0">ประเภท</span>
                  <span className="text-right font-sans">ยอดขาย</span>
                  <span className="text-right font-sans">ยอดคอม (฿)</span>
                  <span className="text-right font-sans">ยอดถูก</span>
                </div>
                {customerByType.map(row => (
                  <div key={row.type} className="summary-type-grid-r">
                    <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                    <span className="font-mono tabular-nums text-right text-theme-text-primary">{fNum(row.sold)}</span>
                    <span className="font-mono tabular-nums text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                    <span className="font-mono tabular-nums text-right text-loss">{fNum(row.payout)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Dealer tab ─────────────────────────────────────────────────────────────
function DealerTab({ data, roundId }: { data: ProfitSummary; roundId: string }) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [reportType, setReportType] = useState<'send_summary' | 'wins_summary'>('wins_summary');
  const [winsData, setWinsData] = useState<DealerWin[] | null>(null);
  const [winsLoading, setWinsLoading] = useState(false);

  const selectedDealer = data.dealers.find(d => d.dealer_id === selectedId);
  const selectedSendDealers = selectedId ? data.dealers.filter(d => d.dealer_id === selectedId) : data.dealers;
  const selectedWinsDealers = selectedId
    ? (winsData?.filter(d => d.dealer_id === selectedId) ?? [])
    : (winsData ?? []);

  const dealerOverview = selectedId && selectedDealer
    ? {
        sent: selectedDealer.sent,
        pct: selectedDealer.pct_sent,
        remaining: selectedDealer.remaining_sent,
        payout: selectedDealer.payout,
        net: selectedDealer.net,
      }
    : {
        sent: data.send.total,
        pct: data.send.pct,
        remaining: data.send.remaining,
        payout: data.send.payout,
        net: data.send.net,
      };

  const dealerByType = BET_TYPES.map(t => {
    if (selectedId && selectedDealer) {
      const row = selectedDealer.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
      return { type: t, sent: row.sent, pct: row.pct, payout: row.payout };
    }
    const agg = data.dealers.reduce(
      (acc, d) => {
        const row = d.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
        acc.sent += row.sent;
        acc.pct += row.pct;
        acc.payout += row.payout;
        return acc;
      },
      { sent: 0, pct: 0, payout: 0 }
    );
    return { type: t, sent: agg.sent, pct: agg.pct, payout: agg.payout };
  });

  useEffect(() => { setWinsData(null); }, [roundId]);

  useEffect(() => {
    if (reportType !== 'wins_summary' || !roundId || winsData !== null) return;
    setWinsLoading(true);
    reportsApi.dealerWins(roundId)
      .then(res => setWinsData(res.data.dealers))
      .catch(() => setWinsData([]))
      .finally(() => setWinsLoading(false));
  }, [reportType, roundId, winsData]);

  function handlePrint() {
    if (reportType === 'wins_summary') {
      const targets = selectedWinsDealers;
      if (targets.length === 0) return;

      const sections = targets.map(d => {
        const rows = d.winning_items.map((b, i) => `
          <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
            <td>${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
            <td style="text-align:center"><span style="font-weight:700">${b.number}</span></td>
            <td class="num"><span style="font-weight:400">${fNum(b.amount)}</span></td>
            <td class="num" style="color:#c00"><span style="font-weight:400">${fNum(b.payout)}</span></td>
          </tr>`).join('');

        return `
          <div class="section-title">เจ้ามือ : ${d.name}</div>
          <table style="table-layout:fixed;width:100%"><thead><tr><th style="width:32%">ประเภท</th><th style="width:18%">เลข</th><th style="width:25%">ราคา</th><th style="width:25%">จ่าย</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#999">ไม่มีรายการถูกรางวัล</td></tr>'}</tbody>
          ${rows ? `<tfoot><tr class="total-row"><td colspan="2" class="num">รวม</td><td class="num">${fNum(d.total_amount)}</td><td class="num" style="color:#c00">${fNum(d.total_payout)}</td></tr></tfoot>` : ''}
          </table>`;
      }).join('');

      const title = selectedId
        ? `รายงานสรุปผลถูกฉลากเจ้ามือ ${selectedDealer?.name ?? ''}`
        : 'รายงานสรุปผลถูกฉลากเจ้ามือ (ทุกเจ้ามือ)';
      const filename = selectedId
        ? `ผลถูกฉลาก_${selectedDealer?.name ?? 'เจ้ามือ'}_งวด${data.round.name}`
        : `ผลถูกฉลาก_ทุกเจ้ามือ_งวด${data.round.name}`;

      const hdr = buildPrintReportHeader({
        reportTitle: title,
        roundName: data.round.name,
        drawDateDdMmYyyy: formatReportDateDdMmYyyy(data.round.draw_date),
      });
      openPrintPreview(`<div class="print-root print-formal-doc">${hdr}${sections}</div>`, title, filename);
      return;
    }

    const sections = selectedSendDealers.map(d => {
      const typeRows = BET_TYPES.map(t => {
        const row = d.by_type[t] ?? { sent:0, pct:0, payout:0 };
        const net = row.payout - (row.sent - row.pct);
        return `<tr><td>${BET_TYPE_LABELS[t]}</td><td class="num">${fNum(row.sent)}</td><td class="num">${fNum(row.pct)}</td><td class="num">${fNum(row.sent-row.pct)}</td><td class="num" style="color:#c00">${fNum(row.payout)}</td><td class="num ${net<0?'neg':'pos'}">${fNum(net)}</td></tr>`;
      }).join('');
      return `
        <div class="section-title">เจ้ามือ : ${d.name}</div>
        <table><thead><tr><th>ประเภท</th><th>ส่ง</th><th>%</th><th>คงเหลือ</th><th>ยอดถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${typeRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(d.sent)}</td><td class="num">${fNum(d.pct_sent)}</td><td class="num">${fNum(d.remaining_sent)}</td><td class="num" style="color:#c00">${fNum(d.payout)}</td><td class="num ${d.net<0?'neg':'pos'}">${fNum(d.net)}</td></tr></tfoot>
        </table>`;
    }).join('');

    const title = selectedId
      ? `รายงานสรุปยอดส่ง ${selectedDealer?.name ?? ''}`
      : 'รายงานสรุปยอดส่ง (ทุกเจ้ามือ)';
    const filename = selectedId
      ? `สรุปยอดส่ง_${selectedDealer?.name ?? 'เจ้ามือ'}_งวด${data.round.name}`
      : `สรุปยอดส่ง_ทุกเจ้ามือ_งวด${data.round.name}`;

    const hdr = buildPrintReportHeader({
      reportTitle: title,
      roundName: data.round.name,
      drawDateDdMmYyyy: formatReportDateDdMmYyyy(data.round.draw_date),
    });
    openPrintPreview(`<div class="print-root print-formal-doc">${hdr}${sections}</div>`, title, filename);
  }

  return (
    <div className="space-y-4">
      <div className={cn(SUMMARY_CD_BAR, 'px-3 py-3 flex flex-wrap gap-3 items-end')}>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-theme-text-secondary">เจ้ามือ</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="h-9 w-60 rounded-lg bg-surface-300 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
            <option value="">เจ้ามือทั้งหมด</option>
            {data.dealers.map(d => <option key={d.dealer_id} value={d.dealer_id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium text-theme-text-secondary">รูปแบบรายงาน</label>
          <select value={reportType} onChange={e => setReportType(e.target.value as 'send_summary' | 'wins_summary')}
            className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
            <option value="wins_summary">รายงานสรุปผลถูกฉลากเจ้ามือ</option>
            <option value="send_summary">รายงานสรุปยอดส่ง</option>
          </select>
        </div>
        <Button variant="outline" onClick={handlePrint} disabled={reportType === 'wins_summary' && selectedWinsDealers.length === 0}>พิมพ์ PDF</Button>
      </div>

      {reportType === 'wins_summary' && (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
        <Card className={cn('p-0 overflow-hidden border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
              <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
            <CardTitle size="lg">
              รายงานสรุปผลถูกฉลากเจ้ามือ {selectedId ? `— ${selectedDealer?.name ?? ''}` : '— ทุกเจ้ามือ'}
            </CardTitle>
          </div>
          {winsLoading ? (
            <div className="py-12 text-center text-theme-text-muted text-sm">กำลังโหลด...</div>
          ) : selectedWinsDealers.length === 0 ? (
            <div className="py-12 text-center text-theme-text-muted text-sm">ไม่มีรายการถูกรางวัล</div>
          ) : (
            <div className="space-y-4 p-4">
              {selectedWinsDealers.map(d => (
                <Card
                  key={d.dealer_id}
                  className={cn('p-0 overflow-hidden border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}
                >
                  <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)] flex items-center justify-between gap-3">
                    <CardTitle size="lg">{d.name}</CardTitle>
                    <span className="text-xs text-theme-text-muted whitespace-nowrap hidden sm:inline">ผลถูกฉลากเจ้ามือ</span>
                  </div>
                  {d.winning_items.length === 0 ? (
                    <div className="py-8 text-center text-theme-text-muted text-sm">ไม่มีรายการถูกรางวัล</div>
                  ) : (
                    <div className="min-w-0 overflow-x-auto">
                      <table className="w-full table-fixed border-collapse">
                        <WinsDealerTableColGroup />
                        <thead>
                          <tr className="bg-[var(--bg-glass-subtle)]">
                            <Th>ประเภท</Th>
                            <Th className="!text-center">เลข</Th>
                            <Th right>ราคา</Th>
                            <Th right>ยอดจ่าย</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.winning_items.map((b, i) => (
                            <tr key={i} className="table-row-hover hover:bg-[var(--bg-hover)] border-b border-[var(--color-border)]">
                              <Td cls="text-theme-text-secondary whitespace-normal break-words">{BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</Td>
                              <Td cls="text-center align-middle">
                                <span
                                  className={cn(
                                    'inline-flex min-w-[2.5rem] justify-center rounded-md border px-1.5 py-0.5 font-mono text-[0.9em] font-semibold tabular-nums tracking-wide',
                                    winBetTypeBadgeClass(b.bet_type),
                                  )}
                                >
                                  {b.number}
                                </span>
                              </Td>
                              <Td right cls="text-theme-text-primary">{fNum(b.amount)}</Td>
                              <Td right cls="text-loss font-semibold tabular-nums">{fNum(b.payout)}</Td>
                            </tr>
                          ))}
                          <tr className="bg-surface-50">
                            <td colSpan={2} className="py-2.5 px-3.5 text-sm font-sans font-semibold text-theme-text-secondary">รวม</td>
                            <Td right cls="text-theme-text-primary font-semibold tabular-nums">{fNum(d.total_amount)}</Td>
                            <Td right cls="text-loss font-semibold tabular-nums">{fNum(d.total_payout)}</Td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              ))}
            </div>
          )}
        </Card>
        <div className="max-2xl:static 2xl:sticky 2xl:top-4">
          <Card className={cn('p-4 space-y-3 border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
            <CardTitle size="lg">{selectedId ? (selectedDealer?.name ?? 'เจ้ามือ') : 'เจ้ามือทั้งหมด'}</CardTitle>
            <div className="summary-side-stack mb-3">
              {([
                ['ยอดส่ง', dealerOverview.sent, 'text-theme-text-primary'],
                ['ยอดคอม (฿)', dealerOverview.pct, 'text-theme-text-secondary'],
                ['คงเหลือ', dealerOverview.remaining, 'text-theme-text-primary'],
                ['ยอดถูก', dealerOverview.payout, 'text-loss font-semibold'],
                ['ยอดสุทธิ', dealerOverview.net, profitCls(dealerOverview.net)],
              ] as [string, number, string][]).map(([label, val, valCls]) => (
                <div key={label} className="summary-side-row">
                  <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                  <span className={`font-mono tabular-nums text-sm text-right shrink-0 ${valCls}`}>{fNum(val)}</span>
                </div>
              ))}
            </div>

            <div className="summary-side-stack">
              <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                <span className="font-sans min-w-0">ประเภท</span>
                <span className="text-right font-sans">ยอดส่ง</span>
                <span className="text-right font-sans">ยอดคอม (฿)</span>
                <span className="text-right font-sans">ยอดถูก</span>
              </div>
              {dealerByType.map(row => (
                <div key={row.type} className="summary-type-grid-r">
                  <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                  <span className="font-mono tabular-nums text-right text-theme-text-primary">{fNum(row.sent)}</span>
                  <span className="font-mono tabular-nums text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                  <span className="font-mono tabular-nums text-right text-loss font-medium">{fNum(row.payout)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        </div>
      )}

      {reportType === 'send_summary' && (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
        <Card className={cn('p-0 overflow-hidden border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
              <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
            <CardTitle size="lg">
              รายงานสรุปยอดส่ง {selectedId ? `— ${selectedDealer?.name ?? ''}` : '— ทุกเจ้ามือ'}
            </CardTitle>
          </div>
          {selectedSendDealers.length === 0 ? (
            <div className="py-12 text-center text-theme-text-muted text-sm">ยังไม่มีข้อมูลเจ้ามือในงวดนี้</div>
          ) : selectedId && selectedDealer ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)]">
                    <Th>ประเภท</Th>
                    <Th right>ส่ง</Th>
                    <Th right>ค่าคอม (฿)</Th>
                    <Th right>คงเหลือ</Th>
                    <Th right>ยอดถูก</Th>
                    <Th right>สุทธิ</Th>
                  </tr>
                </thead>
                <tbody>
                  {BET_TYPES.map(t => {
                    const row = selectedDealer.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
                    const net = row.payout - (row.sent - row.pct);
                    return (
                      <tr key={t} className="table-row-hover hover:bg-[var(--bg-hover)]">
                        <Td cls="text-theme-text-secondary">{BET_TYPE_LABELS[t]}</Td>
                        <Td right>{fNum(row.sent)}</Td>
                        <Td right cls="text-theme-text-secondary">{fNum(row.pct)}</Td>
                        <Td right>{fNum(row.sent - row.pct)}</Td>
                        <Td right cls="text-loss">{fNum(row.payout)}</Td>
                        <Td right cls={profitCls(net)}>{fNum(net)}</Td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface-50">
                    <Td cls="text-theme-text-secondary font-semibold">รวม</Td>
                    <Td right cls="text-theme-text-primary font-semibold">{fNum(selectedDealer.sent)}</Td>
                    <Td right cls="text-theme-text-secondary font-semibold">{fNum(selectedDealer.pct_sent)}</Td>
                    <Td right cls="text-theme-text-primary font-semibold">{fNum(selectedDealer.remaining_sent)}</Td>
                    <Td right cls="text-loss font-semibold">{fNum(selectedDealer.payout)}</Td>
                    <Td right cls={`${profitCls(selectedDealer.net)} font-semibold`}>{fNum(selectedDealer.net)}</Td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)]">
                    <Th>เจ้ามือ</Th>
                    <Th right>ยอดส่ง</Th>
                    <Th right>ค่าคอม (฿)</Th>
                    <Th right>คงเหลือ</Th>
                    <Th right>ยอดถูก</Th>
                    <Th right>ยอดสุทธิ</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.dealers.map(d => (
                    <tr key={d.dealer_id} className="table-row-hover hover:bg-[var(--bg-hover)]">
                      <Td cls="text-theme-text-primary font-medium">{d.name}</Td>
                      <Td right>{fNum(d.sent)}</Td>
                      <Td right cls="text-theme-text-secondary">{fNum(d.pct_sent)}</Td>
                      <Td right>{fNum(d.remaining_sent)}</Td>
                      <Td right cls="text-loss">{fNum(d.payout)}</Td>
                      <Td right cls={profitCls(d.net)}>{fNum(d.net)}</Td>
                    </tr>
                  ))}
                  <tr className="bg-surface-50">
                    <Td cls="text-theme-text-secondary font-semibold">รวม</Td>
                    <Td right cls="text-theme-text-primary font-semibold">{fNum(data.send.total)}</Td>
                    <Td right cls="text-theme-text-secondary font-semibold">{fNum(data.send.pct)}</Td>
                    <Td right cls="text-theme-text-primary font-semibold">{fNum(data.send.remaining)}</Td>
                    <Td right cls="text-loss font-semibold">{fNum(data.send.payout)}</Td>
                    <Td right cls={`${profitCls(data.send.net)} font-semibold`}>{fNum(data.send.net)}</Td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <div className="max-2xl:static 2xl:sticky 2xl:top-4">
          <Card className={cn('p-4 space-y-3 border-theme-card-border rounded-card shadow-card', SUMMARY_CD_SOLID)}>
            <CardTitle size="lg">{selectedId ? (selectedDealer?.name ?? 'เจ้ามือ') : 'เจ้ามือทั้งหมด'}</CardTitle>
            <div className="summary-side-stack mb-3">
              {([
                ['ยอดส่ง', dealerOverview.sent, 'text-theme-text-primary'],
                ['ยอดคอม (฿)', dealerOverview.pct, 'text-theme-text-secondary'],
                ['คงเหลือ', dealerOverview.remaining, 'text-theme-text-primary'],
                ['ยอดถูก', dealerOverview.payout, 'text-loss font-semibold'],
                ['ยอดสุทธิ', dealerOverview.net, profitCls(dealerOverview.net)],
              ] as [string, number, string][]).map(([label, val, valCls]) => (
                <div key={label} className="summary-side-row">
                  <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                  <span className={`font-mono tabular-nums text-sm text-right shrink-0 ${valCls}`}>{fNum(val)}</span>
                </div>
              ))}
            </div>

            <div className="summary-side-stack">
              <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                <span className="font-sans min-w-0">ประเภท</span>
                <span className="text-right font-sans">ยอดส่ง</span>
                <span className="text-right font-sans">ยอดคอม (฿)</span>
                <span className="text-right font-sans">ยอดถูก</span>
              </div>
              {dealerByType.map(row => (
                <div key={row.type} className="summary-type-grid-r">
                  <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                  <span className="font-mono tabular-nums text-right text-theme-text-primary">{fNum(row.sent)}</span>
                  <span className="font-mono tabular-nums text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                  <span className="font-mono tabular-nums text-right text-loss font-medium">{fNum(row.payout)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        </div>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
function SummaryPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const roundFromUrl = searchParams.get('round') ?? '';
  const [rounds, setRounds] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [roundId, setRoundId] = useState(roundFromUrl);
  const [tab, setTab] = useState<'profit' | 'customer' | 'dealer'>('profit');
  const [data, setData] = useState<ProfitSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const fetchRounds = useCallback(async () => {
    try {
      const res = await roundsApi.list();
      const all = res.data.rounds ?? [];
      setRounds(all);
      if (!roundId && all.length) {
        // prefer drawn or archived (has results), then fall back to first
        const withResults = all.find((r: { status: string }) =>
          r.status === 'drawn' || r.status === 'archived'
        ) ?? all[0];
        setRoundId(withResults.id);
      }
    } catch { /* ignore */ }
  }, [roundId]);

  const fetchSummary = useCallback(async () => {
    if (!roundId) return;
    setLoading(true);
    setError('');
    try {
      const res = await reportsApi.profitSummary(roundId);
      setData(res.data);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'โหลดข้อมูลไม่สำเร็จ';
      setError(msg);
    } finally {
      setLoading(false);
    }
  }, [roundId]);

  useEffect(() => { fetchRounds(); }, []);
  useEffect(() => { fetchSummary(); }, [roundId]);

  useEffect(() => {
    if (roundFromUrl) setRoundId(roundFromUrl);
  }, [roundFromUrl]);

  // ─── Result modal state ────────────────────────────────────────────────────
  const [showResultModal, setShowResultModal] = useState(false);
  const [rPrize1st, setRPrize1st] = useState('');
  const [rBot3, setRBot3] = useState<[string,string,string,string]>(['','','','']);
  const [rBot2, setRBot2] = useState('');
  const [resultSaving, setResultSaving] = useState(false);
  const [resultError, setResultError] = useState('');

  const rTop3  = rPrize1st.length >= 3 ? rPrize1st.slice(-3) : '';
  const rTop2  = rTop3.length === 3 ? rTop3.slice(-2) : '';
  const rTote3 = rTop3.length === 3 ? totePerms(rTop3) : [];

  const openResultModal = useCallback(() => {
    const rd = data?.round.result_data as { prize_1st?: string; prize_3top?: string; prize_3bottom?: string[]; prize_2bottom?: string } | null;
    if (rd) {
      setRPrize1st(rd.prize_1st ?? rd.prize_3top ?? '');
      const b3 = rd.prize_3bottom ?? [];
      setRBot3([b3[0]??'', b3[1]??'', b3[2]??'', b3[3]??''] as [string,string,string,string]);
      setRBot2(rd.prize_2bottom ?? '');
    } else {
      setRPrize1st(''); setRBot3(['','','','']); setRBot2('');
    }
    setResultError('');
    setShowResultModal(true);
  }, [data]);

  const autoOpenResultDone = useRef(false);
  useEffect(() => {
    if (searchParams.get('editResult') !== '1') {
      autoOpenResultDone.current = false;
      return;
    }
    if (!data || autoOpenResultDone.current) return;
    autoOpenResultDone.current = true;
    openResultModal();
    const rid = roundId || data.round.id;
    router.replace(`/summary?round=${encodeURIComponent(rid)}`, { scroll: false });
  }, [searchParams, data, roundId, openResultModal, router]);

  async function handleSaveResult() {
    if (!roundId) { setResultError('กรุณาเลือกงวด'); return; }
    if (rTop3.length !== 3) { setResultError('กรุณากรอกรางวัลที่ 1 ให้ครบอย่างน้อย 3 หลัก'); return; }
    if (rBot2.length !== 2) { setResultError('กรุณากรอก 2 ตัวล่าง (2 หลัก)'); return; }
    setResultError('');
    setResultSaving(true);
    try {
      await roundsApi.submitResult(roundId, {
        result_prize_1st: rPrize1st.length === 6 ? rPrize1st : undefined,
        result_3top: rTop3,
        result_2bottom: rBot2,
        result_3bottom: rBot3.filter(s => s.length === 3),
      });
      setShowResultModal(false);
      await fetchSummary();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'เกิดข้อผิดพลาด';
      setResultError(msg);
    } finally {
      setResultSaving(false);
    }
  }

  async function handleResetResult() {
    if (!confirm('รีเซ็ตผลสลาก?\nงวดจะกลับสู่สถานะปิด และข้อมูลสรุปผลจะถูกล้างทั้งหมด')) return;
    try {
      await roundsApi.resetResult(roundId);
      setShowResultModal(false);
      await fetchSummary();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'รีเซ็ตไม่สำเร็จ';
      setResultError(msg);
    }
  }

  const tabs = [
    {
      key: 'profit',
      label: 'สรุปผลกำไร',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
      ),
      activeClass: 'bg-[var(--color-nav-active-bg)] text-theme-text-primary border border-[var(--color-border)] shadow-[var(--shadow-soft)]',
      dotClass: 'bg-theme-text-primary',
    },
    {
      key: 'customer',
      label: 'รายลูกค้า',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      ),
      activeClass: 'bg-[var(--color-nav-active-bg)] text-theme-text-primary border border-[var(--color-border)] shadow-[var(--shadow-soft)]',
      dotClass: 'bg-theme-text-primary',
    },
    {
      key: 'dealer',
      label: 'รายเจ้ามือ',
      icon: (
        <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-2 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
        </svg>
      ),
      activeClass: 'bg-[var(--color-nav-active-bg)] text-theme-text-primary border border-[var(--color-border)] shadow-[var(--shadow-soft)]',
      dotClass: 'bg-theme-text-primary',
    },
  ] as const;

  return (
    <AppShell>
      <Header
        title="ทำรายการสรุป"
        subtitle={`${APP_BRAND_NAME} · สรุปผลกำไร-ขาดทุน หลังออกผลสลาก`}
        variant="prominent"
      />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-7xl mx-auto space-y-4">

          {/* Controls row */}
          <div className="rounded-card border border-theme-card-border bg-[var(--bg-glass-subtle)] shadow-card px-3 py-3 flex items-center gap-3 flex-wrap">
            <label className="text-sm text-theme-text-secondary">งวด:</label>
            <select value={roundId} onChange={e => setRoundId(e.target.value)}
              className="h-9 rounded-lg bg-[var(--color-input-bg)] border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-border-strong)]">
              <option value="">-- เลือกงวด --</option>
              {rounds.map(r => (
                <option key={r.id} value={r.id}>{r.name}{(r.status === 'drawn' || r.status === 'archived') ? ' ✓' : ''}</option>
              ))}
            </select>
            <Button onClick={fetchSummary} disabled={!roundId || loading} variant="outline">
              {loading ? 'กำลังโหลด...' : 'ดึงข้อมูล'}
            </Button>
          </div>

          {error && <p className="text-sm text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2">{error}</p>}

          {data && (
            <>
              {/* Result strip — แบบเดิม (แถวเดียว) ระยะห่าง/ padding ปรับให้สมดุลขึ้น */}
              <Card className="rounded-card border-theme-card-border bg-surface-200/25 py-3 px-3 shadow-card sm:px-4">
                <div className="flex min-w-0 flex-nowrap items-stretch gap-2 sm:gap-2.5">
                  <span className="flex shrink-0 items-center self-center text-[10px] font-semibold tracking-wide text-theme-text-secondary sm:text-xs">
                    ผลรางวัล
                  </span>
                  {data.round.result_data ? (
                    <div className="flex min-w-0 flex-1 flex-nowrap items-stretch gap-1.5 sm:gap-2">
                      {(() => {
                        const rd = data.round.result_data as Record<string, unknown>;
                        const p1 = String(rd.prize_1st ?? '');
                        let top3raw = String(rd.prize_3top ?? '').trim();
                        if (top3raw.length < 3 && p1.length >= 3) top3raw = p1.slice(-3);
                        const top3 = top3raw.length >= 3 ? top3raw.slice(-3) : '';
                        const toteJoined = top3.length === 3 ? totePerms(top3).join(', ') : '';
                        const all: { label: string; val: string; pillClass: string }[] = [
                          {
                            label: 'รางวัลที่ 1',
                            val: p1,
                            pillClass: winBetTypeBadgeClass('3digit_top'),
                          },
                          { label: '3 ตัวบน', val: top3raw, pillClass: winBetTypeBadgeClass('3digit_top') },
                          { label: 'เลขโต๊ด', val: toteJoined, pillClass: winBetTypeBadgeClass('3digit_tote') },
                          {
                            label: '3 ตัวล่าง',
                            val: ((rd.prize_3bottom as string[] | undefined) ?? []).join(', '),
                            pillClass: winBetTypeBadgeClass('3digit_back'),
                          },
                          { label: '2 ตัวบน', val: String(rd.prize_2top ?? ''), pillClass: winBetTypeBadgeClass('2digit_top') },
                          {
                            label: '2 ตัวล่าง',
                            val: String(rd.prize_2bottom ?? ''),
                            pillClass: winBetTypeBadgeClass('2digit_bottom'),
                          },
                        ];
                        const nonEmpty = all.filter((r) => r.val.trim() !== '');
                        return nonEmpty.map((r) => (
                          <div
                            key={r.label}
                            className="flex min-w-0 flex-1 basis-0 flex-col justify-center rounded-lg border border-[var(--color-border)] bg-surface-50 px-2 py-1.5 sm:px-2.5 sm:py-2"
                          >
                            <span className="truncate text-center text-[9px] font-medium leading-none text-theme-text-muted sm:text-[10px]">
                              {r.label}
                            </span>
                            <span
                              className={cn(
                                'mt-1 min-h-[2.35em] rounded-md px-1 py-1 text-center font-mono text-[10px] font-semibold font-tabular leading-snug break-words border [overflow-wrap:anywhere] line-clamp-3 sm:line-clamp-4 sm:text-[11px]',
                                r.pillClass,
                              )}
                              title={r.val}
                            >
                              {r.val}
                            </span>
                          </div>
                        ));
                      })()}
                    </div>
                  ) : (
                    <p className="min-w-0 flex-1 truncate text-xs italic text-theme-text-muted sm:text-sm">
                      ยังไม่ได้ใส่ผลสลากสำหรับงวดนี้
                    </p>
                  )}
                  <div className="flex shrink-0 items-center gap-1.5 border-l border-[var(--color-border)] pl-2 sm:gap-2 sm:pl-2.5">
                    {data.round.result_data ? (
                      <>
                        <button
                          type="button"
                          onClick={openResultModal}
                          className="btn-toolbar-glow btn-fintech-search inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm !h-auto"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                          </svg>
                          แก้ไข
                        </button>
                        <button
                          type="button"
                          onClick={handleResetResult}
                          className="btn-toolbar-glow btn-fintech-rose inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs sm:px-3 sm:py-2 sm:text-sm !h-auto"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                          รีเซ็ต
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={openResultModal}
                        className="btn-primary-glow inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs sm:py-2 sm:text-sm !h-auto"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 shrink-0 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                        </svg>
                        ใส่ผลสลาก
                      </button>
                    )}
                  </div>
                </div>
              </Card>

              {/* Tab bar */}
              <div className="rounded-xl border border-[var(--color-border)] bg-[var(--bg-glass-subtle)] p-1.5 flex gap-1.5">
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                      tab === t.key
                        ? t.activeClass
                        : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-[var(--bg-glass-subtle)]'
                    }`}>
                    {tab === t.key && <span className={`w-1.5 h-1.5 rounded-full ${t.dotClass} shrink-0`} />}
                    {!( tab === t.key) && <span className="opacity-50">{t.icon}</span>}
                    {t.label}
                  </button>
                ))}
              </div>

              <div>
                {tab === 'profit'   && <ProfitTab   data={data} />}
                {tab === 'customer' && <CustomerTab data={data} roundId={roundId} />}
                {tab === 'dealer'   && <DealerTab   data={data} roundId={roundId} />}
              </div>
            </>
          )}

          {!data && !loading && roundId && (
            <p className="text-sm text-theme-text-muted text-center py-12">ยังไม่มีข้อมูล — กด "ดึงข้อมูล" เพื่อโหลด</p>
          )}
        </div>
      </main>

      {/* ─── Result Modal ──────────────────────────────────────────────────── */}
      {showResultModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[var(--color-backdrop-overlay)]"
          onClick={() => setShowResultModal(false)}
        >
          <div
            className="relative z-10 w-full max-w-lg overflow-hidden rounded-2xl border border-theme-card-border bg-[var(--color-card-bg-solid)] shadow-[var(--shadow-hover)]"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)] bg-[var(--color-card-bg-solid)]">
              <div className="flex items-center gap-2.5">
                <div className={`w-2.5 h-2.5 rounded-full ${data?.round.result_data ? 'bg-neutral' : 'bg-profit'}`} />
                <span className="font-semibold text-theme-text-primary">
                  {data?.round.result_data ? 'แก้ไขผลสลาก' : 'ใส่ผลสลาก'}
                </span>
                <span className="text-xs text-theme-text-muted font-normal">งวด {data?.round.name}</span>
              </div>
              <button onClick={() => setShowResultModal(false)} className="text-theme-text-muted hover:text-theme-text-secondary transition-colors p-1">
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Body */}
            <div className="px-5 py-4 space-y-4 bg-[var(--color-bg-primary)]">
              {/* รางวัลที่ 1 */}
              <div>
                <label className="text-xs text-theme-text-secondary mb-1.5 block">
                  รางวัลที่ 1 <span className="text-loss">*</span>
                  <span className="ml-1 text-theme-text-muted">(6 หลัก)</span>
                </label>
                <input
                  type="text" inputMode="numeric" maxLength={6}
                  value={rPrize1st}
                  onChange={e => setRPrize1st(e.target.value.replace(/\D/g,'').slice(0,6))}
                  placeholder="เช่น 292514"
                  autoFocus
                  className="w-full h-11 rounded-xl bg-[var(--color-input-bg)] border-2 border-[var(--color-input-border)] px-3 text-xl font-mono font-bold tracking-[0.3em] text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-border-strong)]"
                />
              </div>

              {/* Auto-computed preview */}
              {rTop3 && (
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-[var(--color-border)] bg-surface-50 px-4 py-3 text-xs">
                  <div className="text-theme-text-muted">3 ตัวบน: <span className="text-profit font-mono font-bold ml-1">{rTop3}</span></div>
                  <div className="text-theme-text-muted">2 ตัวบน: <span className="text-profit font-mono font-bold ml-1">{rTop2}</span></div>
                  {rTote3.length > 0 && (
                    <div className="col-span-2 text-theme-text-muted">โต็ด: <span className="text-theme-text-secondary font-mono ml-1 text-[11px]">{rTote3.join(' , ')}</span></div>
                  )}
                </div>
              )}

              {/* 3 ตัวล่าง */}
              <div>
                <label className="text-xs text-theme-text-secondary mb-1.5 block">3 ตัวล่าง (สูงสุด 4 ชุด)</label>
                <div className="grid grid-cols-2 gap-2">
                  {[0, 1, 2, 3].map(i => (
                    <input key={i} type="text" inputMode="numeric" maxLength={3}
                      value={rBot3[i]}
                      onChange={e => {
                        const n = [...rBot3] as typeof rBot3;
                        n[i] = e.target.value.replace(/\D/g,'').slice(0,3);
                        setRBot3(n);
                      }}
                      placeholder={`ชุด ${i + 1}`}
                      className="w-full h-9 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] focus:border-[var(--color-border-strong)] text-center text-sm font-mono text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                    />
                  ))}
                </div>
              </div>

              {/* 2 ตัวล่าง */}
              <div>
                <label className="text-xs text-theme-text-secondary mb-1.5 block">
                  2 ตัวล่าง <span className="text-loss">*</span>
                  <span className="ml-1 text-theme-text-muted">(2 หลัก)</span>
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="text" inputMode="numeric" maxLength={2}
                    value={rBot2}
                    onChange={e => setRBot2(e.target.value.replace(/\D/g,'').slice(0,2))}
                    placeholder="47"
                    className="w-24 h-9 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] focus:border-[var(--color-border-strong)] text-center text-base font-mono font-bold text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                  />
                  {rBot2.length === 2 && (
                    <span className="text-xs text-theme-text-muted">วิ่งล่าง: <span className="text-theme-text-secondary font-mono">{rBot2.split('').join(' , ')}</span></span>
                  )}
                </div>
              </div>

              {resultError && (
                <p className="text-sm text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] rounded-lg px-3 py-2 border border-[var(--color-badge-danger-border)]">{resultError}</p>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-[var(--color-border)] bg-[var(--color-card-bg-solid)] flex items-center gap-2">
              <button
                onClick={handleSaveResult}
                disabled={resultSaving || rTop3.length !== 3 || rBot2.length !== 2}
                className="btn-toolbar-glow btn-toolbar-profit flex-1 !h-auto py-2.5 text-sm rounded-2xl flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {resultSaving ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"/>
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {resultSaving ? 'กำลังบันทึก...' : 'บันทึก'}
              </button>
              {data?.round.result_data && (
                <button
                  onClick={handleResetResult}
                  className="btn-toolbar-glow btn-fintech-rose inline-flex items-center gap-1.5 px-3.5 py-2.5 text-sm rounded-2xl !h-auto"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  รีเซ็ต
                </button>
              )}
              <button
                onClick={() => setShowResultModal(false)}
                className="btn-toolbar-glow btn-toolbar-muted px-4 py-2.5 text-sm rounded-2xl !h-auto"
              >
                ยกเลิก
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

export default function SummaryPage() {
  return <Suspense><SummaryPageInner /></Suspense>;
}
