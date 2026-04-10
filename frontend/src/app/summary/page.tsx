'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { roundsApi, reportsApi } from '@/lib/api';
import { openPrintPreview } from '@/lib/printPreview';

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

function fNum(v: number) { return Math.round(v).toLocaleString('th-TH'); }
function profitCls(v: number) {
  return v < 0 ? 'text-rose-400 font-semibold' : v > 0 ? 'text-emerald-400 font-semibold' : 'text-slate-400';
}

// ─── (printHtml replaced by openPrintPreview from @/lib/printPreview) ─────────

interface CustSummary {
  customer_id: string; name: string; commission_rate: number;
  sold: number; pct_sold: number; remaining_sold: number;
  payout: number; net: number;
  by_type: Record<string, { sold: number; pct: number; payout: number }>;
  by_sheet: Record<number, { sold: number; pct: number; payout: number }>;
}
interface DealerSummary {
  dealer_id: string; name: string;
  sent: number; pct_sent: number; remaining_sent: number;
  payout: number; net: number;
  by_type: Record<string, { sent: number; pct: number; payout: number }>;
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

// ─── Table cell helpers ───────────────────────────────────────────────────────
function Th({ children, right }: { children?: React.ReactNode; right?: boolean }) {
  return (
    <th className={`py-2 px-3 text-xs text-slate-500 font-medium uppercase tracking-wider border-b border-border whitespace-nowrap ${right ? 'text-right' : 'text-left'}`}>
      {children}
    </th>
  );
}
function Td({ children, right, cls }: { children?: React.ReactNode; right?: boolean; cls?: string }) {
  return (
    <td className={`py-2.5 px-3 text-sm border-b border-border/40 ${right ? 'text-right font-mono' : ''} ${cls ?? ''}`}>
      {children}
    </td>
  );
}

// ─── KPI card ─────────────────────────────────────────────────────────────────
function KpiCard({ label, value, positive }: { label: string; value: string; positive?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-surface-200/60 px-4 py-3 flex flex-col gap-1">
      <span className="text-xs text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={`text-xl font-mono font-bold ${positive === undefined ? 'text-slate-200' : positive ? 'text-emerald-400' : 'text-rose-400'}`}>
        {value}
      </span>
    </div>
  );
}

// ─── Profit tab ───────────────────────────────────────────────────────────────
function ProfitTab({ data }: { data: ProfitSummary }) {
  const rd = data.round.result_data;

  function handlePrint() {
    const resultRows = rd ? ([
      ['รางวัลที่ 1', String(rd.prize_1st ?? '')],
      ['3 ตัวบน', String(rd.prize_3top ?? '')],
      ['3 ตัวล่าง', ((rd.prize_3bottom as string[] | undefined) ?? []).join(', ')],
      ['2 ตัวบน', String(rd.prize_2top ?? '')],
      ['2 ตัวล่าง', String(rd.prize_2bottom ?? '')],
      ['วิ่งบน', String(rd.prize_1top ?? '')],
      ['วิ่งล่าง', String(rd.prize_1bottom ?? '')],
    ] as [string,string][]).filter(([,v]) => v).map(([l,v]) =>
      `<span style="margin-right:20px"><b>${l}:</b> ${v}</span>`
    ).join('') : '';

    const custRows = data.customers.map(c => `
      <tr>
        <td>${c.name}</td>
        <td class="num">${fNum(c.sold)}</td>
        <td class="num">${fNum(c.pct_sold)}</td>
        <td class="num">${fNum(c.remaining_sold)}</td>
        <td class="num" style="color:#c00">${fNum(c.payout)}</td>
        <td class="num ${c.net<0?'neg':'pos'}">${fNum(c.net)}</td>
      </tr>`).join('');

    const dealerRows = data.dealers.map(d => `
      <tr>
        <td>${d.name}</td>
        <td class="num">${fNum(d.sent)}</td>
        <td class="num">${fNum(d.pct_sent)}</td>
        <td class="num">${fNum(d.remaining_sent)}</td>
        <td class="num" style="color:#049">${fNum(d.payout)}</td>
        <td class="num ${d.net<0?'neg':'pos'}">${fNum(d.net)}</td>
      </tr>`).join('');

    const typeRows = BET_TYPES.map(t => {
      const row = data.by_type_sell[t];
      if (!row) return '';
      const pr = row.sold - row.pct - row.payout;
      return `<tr><td>${BET_TYPE_LABELS[t]}</td><td class="num">${fNum(row.sold)}</td><td class="num">${fNum(row.pct)}</td><td class="num" style="color:#c00">${fNum(row.payout)}</td><td class="num ${pr<0?'neg':'pos'}">${fNum(pr)}</td></tr>`;
    }).join('');

    const html = `
      <h2>สรุปผลกำไร-ขาดทุน งวด ${data.round.name}</h2>
      <div class="sub">วันออกรางวัล: ${new Date(data.round.draw_date).toLocaleDateString('th-TH', {day:'numeric',month:'long',year:'numeric'})}</div>
      ${resultRows ? `<div class="result-box">${resultRows}</div>` : ''}
      <div class="kpi-grid">
        <div class="kpi-box"><div class="kpi-label">กำไรสุทธิ</div><div class="kpi-value ${data.profit<0?'neg':'pos'}">${fNum(data.profit)}</div></div>
        <div class="kpi-box"><div class="kpi-label">ยอดขายรวม</div><div class="kpi-value">${fNum(data.sell.total)}</div></div>
        <div class="kpi-box"><div class="kpi-label">จ่ายรางวัล</div><div class="kpi-value neg">${fNum(data.sell.payout)}</div></div>
      </div>
      <div class="section-title">สรุปรายลูกค้า</div>
      <table><thead><tr><th class="l">ลูกค้า</th><th>ยอดขาย</th><th>เปอร์เซนต์</th><th>คงเหลือ</th><th>ยอดถูก</th><th>ยอดสุทธิ</th></tr></thead>
        <tbody>${custRows}</tbody>
        <tfoot><tr class="total-row">
          <td>รวม</td><td class="num">${fNum(data.sell.total)}</td><td class="num">${fNum(data.sell.pct)}</td>
          <td class="num">${fNum(data.sell.remaining)}</td><td class="num neg">${fNum(data.sell.payout)}</td>
          <td class="num ${data.sell.net<0?'neg':'pos'}">${fNum(data.sell.net)}</td>
        </tr></tfoot>
      </table>
      ${data.dealers.length > 0 ? `
      <div class="section-title">สรุปรายเจ้ามือ</div>
      <table><thead><tr><th class="l">เจ้ามือ</th><th>ยอดส่ง</th><th>เปอร์เซนต์</th><th>คงเหลือ</th><th>ยอดถูก</th><th>ยอดสุทธิ</th></tr></thead>
        <tbody>${dealerRows}</tbody>
        <tfoot><tr class="total-row">
          <td>รวม</td><td class="num">${fNum(data.send.total)}</td><td class="num">${fNum(data.send.pct)}</td>
          <td class="num">${fNum(data.send.remaining)}</td><td class="num" style="color:#049">${fNum(data.send.payout)}</td>
          <td class="num ${data.send.net<0?'neg':'pos'}">${fNum(data.send.net)}</td>
        </tr></tfoot>
      </table>` : ''}
      <div class="section-title">แยกตามประเภท</div>
      <table><thead><tr><th class="l">ประเภท</th><th>ยอดขาย</th><th>% ขาย</th><th>ยอดถูก</th><th>กำไร</th></tr></thead>
        <tbody>${typeRows}</tbody>
      </table>`;
    const title = `สรุปผลกำไร งวด ${data.round.name}`;
    openPrintPreview(html, title, `สรุปกำไร_งวด${data.round.name}`);
  }

  return (
    <div className="space-y-5">
      {/* Print button row */}
      <div className="flex justify-end">
        <Button variant="outline" onClick={handlePrint}>พิมพ์ PDF</Button>
      </div>
      {/* KPI row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiCard label="กำไรสุทธิ" value={`${data.profit < 0 ? '' : '+'}${fNum(data.profit)}`} positive={data.profit >= 0} />
        <KpiCard label="ยอดขายรวม" value={fNum(data.sell.total)} />
        <KpiCard label="จ่ายรางวัล" value={fNum(data.sell.payout)} />
        <KpiCard label="คงเหลือ (ขาย)" value={fNum(data.sell.remaining)} />
      </div>

      {/* Result numbers */}
      {rd && (
        <Card className="p-4">
          <div className="text-xs text-slate-500 uppercase tracking-widest mb-3 font-semibold">ผลรางวัล</div>
          <div className="flex flex-wrap gap-5 text-sm">
            {([
              ['รางวัลที่ 1', String(rd.prize_1st ?? '')],
              ['3 ตัวบน', String(rd.prize_3top ?? '')],
              ['3 ตัวล่าง', ((rd.prize_3bottom as string[] | undefined) ?? []).join(', ')],
              ['2 ตัวบน', String(rd.prize_2top ?? '')],
              ['2 ตัวล่าง', String(rd.prize_2bottom ?? '')],
            ] as [string, string][]).map(([label, val]) => val ? (
              <div key={label} className="flex items-center gap-2">
                <span className="text-xs text-slate-500">{label}</span>
                <span className="font-mono font-bold text-slate-200 tracking-widest">{val}</span>
              </div>
            ) : null)}
          </div>
        </Card>
      )}

      {/* Sell / Send summary */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <CardTitle>สรุปยอดขาย / ส่ง</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-200/40">
                <Th />
                <Th right>ยอดรวม</Th>
                <Th right>เปอร์เซนต์</Th>
                <Th right>คงเหลือ</Th>
                <Th right>ยอดถูกรางวัล</Th>
                <Th right>ยอดสุทธิ</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="table-row-hover">
                <Td cls="text-slate-300 font-medium">ยอดขายรวม</Td>
                <Td right>{fNum(data.sell.total)}</Td>
                <Td right>{fNum(data.sell.pct)}</Td>
                <Td right>{fNum(data.sell.remaining)}</Td>
                <Td right cls="text-rose-400">{fNum(data.sell.payout)}</Td>
                <Td right cls={profitCls(data.sell.net)}>{fNum(data.sell.net)}</Td>
              </tr>
              <tr className="table-row-hover">
                <Td cls="text-slate-300 font-medium">ยอดส่งรวม</Td>
                <Td right>{fNum(data.send.total)}</Td>
                <Td right>{fNum(data.send.pct)}</Td>
                <Td right>{fNum(data.send.remaining)}</Td>
                <Td right cls="text-blue-400">{fNum(data.send.payout)}</Td>
                <Td right cls={profitCls(data.send.net)}>{fNum(data.send.net)}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Customer breakdown */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <CardTitle>สรุปรายลูกค้า</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-200/40">
                <Th>ลูกค้า</Th>
                <Th right>ยอดขาย</Th>
                <Th right>เปอร์เซนต์</Th>
                <Th right>คงเหลือ</Th>
                <Th right>ยอดถูก</Th>
                <Th right>ยอดสุทธิ</Th>
              </tr>
            </thead>
            <tbody>
              {data.customers.map(c => (
                <tr key={c.customer_id} className="table-row-hover">
                  <Td cls="text-slate-200 font-medium">{c.name}</Td>
                  <Td right>{fNum(c.sold)}</Td>
                  <Td right cls="text-slate-400">{fNum(c.pct_sold)}</Td>
                  <Td right>{fNum(c.remaining_sold)}</Td>
                  <Td right cls="text-rose-400">{fNum(c.payout)}</Td>
                  <Td right cls={profitCls(c.net)}>{fNum(c.net)}</Td>
                </tr>
              ))}
              <tr className="bg-surface-200/60">
                <Td cls="text-slate-300 font-semibold">รวม</Td>
                <Td right cls="text-slate-200 font-semibold">{fNum(data.sell.total)}</Td>
                <Td right cls="text-slate-400 font-semibold">{fNum(data.sell.pct)}</Td>
                <Td right cls="text-slate-200 font-semibold">{fNum(data.sell.remaining)}</Td>
                <Td right cls="text-rose-400 font-semibold">{fNum(data.sell.payout)}</Td>
                <Td right cls={`${profitCls(data.sell.net)} font-semibold`}>{fNum(data.sell.net)}</Td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      {/* Dealer breakdown */}
      {data.dealers.length > 0 && (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <CardTitle>สรุปรายเจ้ามือ</CardTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-200/40">
                  <Th>เจ้ามือ</Th>
                  <Th right>ยอดส่ง</Th>
                  <Th right>เปอร์เซนต์</Th>
                  <Th right>คงเหลือ</Th>
                  <Th right>ยอดถูก</Th>
                  <Th right>ยอดสุทธิ</Th>
                </tr>
              </thead>
              <tbody>
                {data.dealers.map(d => (
                  <tr key={d.dealer_id} className="table-row-hover">
                    <Td cls="text-slate-200 font-medium">{d.name}</Td>
                    <Td right>{fNum(d.sent)}</Td>
                    <Td right cls="text-slate-400">{fNum(d.pct_sent)}</Td>
                    <Td right>{fNum(d.remaining_sent)}</Td>
                    <Td right cls="text-blue-400">{fNum(d.payout)}</Td>
                    <Td right cls={profitCls(d.net)}>{fNum(d.net)}</Td>
                  </tr>
                ))}
                <tr className="bg-surface-200/60">
                  <Td cls="text-slate-300 font-semibold">รวม</Td>
                  <Td right cls="text-slate-200 font-semibold">{fNum(data.send.total)}</Td>
                  <Td right cls="text-slate-400 font-semibold">{fNum(data.send.pct)}</Td>
                  <Td right cls="text-slate-200 font-semibold">{fNum(data.send.remaining)}</Td>
                  <Td right cls="text-blue-400 font-semibold">{fNum(data.send.payout)}</Td>
                  <Td right cls={`${profitCls(data.send.net)} font-semibold`}>{fNum(data.send.net)}</Td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* By type */}
      <Card className="p-0 overflow-hidden">
        <div className="px-5 pt-4 pb-3 border-b border-border">
          <CardTitle>แยกตามประเภทการขาย</CardTitle>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-surface-200/40">
                <Th>ประเภท</Th>
                <Th right>ยอดขาย</Th>
                <Th right>% ขาย</Th>
                <Th right>ยอดถูก</Th>
                <Th right>กำไร</Th>
              </tr>
            </thead>
            <tbody>
              {BET_TYPES.map(t => {
                const row = data.by_type_sell[t];
                if (!row) return null;
                const profit = row.sold - row.pct - row.payout;
                return (
                  <tr key={t} className="table-row-hover">
                    <Td cls="text-slate-300">{BET_TYPE_LABELS[t]}</Td>
                    <Td right>{fNum(row.sold)}</Td>
                    <Td right cls="text-slate-400">{fNum(row.pct)}</Td>
                    <Td right cls="text-rose-400">{fNum(row.payout)}</Td>
                    <Td right cls={profitCls(profit)}>{fNum(profit)}</Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ─── Customer tab ─────────────────────────────────────────────────────────────
function CustomerTab({ data, roundId }: { data: ProfitSummary; roundId: string }) {
  const [selectedId, setSelectedId] = useState<string>(data.customers[0]?.customer_id ?? '');
  const [reportType, setReportType] = useState<'brief' | 'full' | 'detail' | 'wins'>('brief');
  const [winsData, setWinsData]     = useState<CustWin[] | null>(null);
  const [winsLoading, setWinsLoading] = useState(false);
  const customer = data.customers.find(c => c.customer_id === selectedId);

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

  const winsForCust = winsData?.find(c => c.customer_id === selectedId);

  function handlePrint() {
    if (reportType === 'wins') {
      if (!winsForCust) return;
      const rows = winsForCust.winning_bets.map((b, i) => `
        <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
          <td style="text-align:center">${b.sheet_no}</td>
          <td>${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
          <td style="text-align:center;font-weight:bold">${b.number}</td>
          <td class="num">${fNum(b.amount)}</td>
          <td class="num" style="font-weight:bold;color:#c00">${fNum(b.payout)}</td>
        </tr>`).join('');
      const html = `<h2>ผลถูกฉลาก — ${winsForCust.name}</h2>
        <div class="sub">งวด ${data.round.name} — วันออก ${new Date(data.round.draw_date).toLocaleDateString('th-TH')}</div>
        <table><thead><tr><th style="width:70px">แผ่นที่</th><th>ประเภท</th><th style="width:70px">เลข</th><th style="width:90px">ราคา</th><th style="width:100px">ยอดจ่าย</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" style="text-align:center;color:#999">ไม่มีรายการถูกรางวัล</td></tr>'}</tbody>
        ${rows ? `<tfoot><tr class="total-row"><td colspan="3" class="num">รวม</td><td class="num">${fNum(winsForCust.total_amount)}</td><td class="num" style="color:#c00">${fNum(winsForCust.total_payout)}</td></tr></tfoot>` : ''}
        </table>`;
      openPrintPreview(html, `ผลถูกฉลาก ${winsForCust.name} งวด${data.round.name}`, `ผลถูกฉลาก_${winsForCust.name}_งวด${data.round.name}`);
      return;
    }
    const target = customer ? [customer] : data.customers;
    const sections = target.map(c => {
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
        <div class="section-title">${c.name} (คอมมิชชั่น ${c.commission_rate}%)</div>
        <div style="font-size:12px;color:#555;margin-bottom:6px">สรุปรายแผ่น</div>
        <table><thead><tr><th>แผ่นที่</th><th>ขาย</th><th>%</th><th>คงเหลือ</th><th>ถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${sheetRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(c.sold)}</td><td class="num">${fNum(c.pct_sold)}</td><td class="num">${fNum(c.remaining_sold)}</td><td class="num" style="color:#c00">${fNum(c.payout)}</td><td class="num ${c.net<0?'neg':'pos'}">${fNum(c.net)}</td></tr></tfoot>
        </table>
        <div style="font-size:12px;color:#555;margin:8px 0 4px">แยกตามประเภท</div>
        <table><thead><tr><th>ประเภท</th><th>ขาย</th><th>%</th><th>คงเหลือ</th><th>ถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${typeRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(c.sold)}</td><td class="num">${fNum(c.pct_sold)}</td><td class="num">${fNum(c.remaining_sold)}</td><td class="num" style="color:#c00">${fNum(c.payout)}</td><td class="num ${c.net<0?'neg':'pos'}">${fNum(c.net)}</td></tr></tfoot>
        </table>`;
    }).join('');
    const title = customer ? `รายงานลูกค้า ${customer.name}` : 'รายงานลูกค้าทั้งหมด';
    const filename = customer
      ? `รายงานลูกค้า_${customer.name}_งวด${data.round.name}`
      : `รายงานลูกค้าทั้งหมด_งวด${data.round.name}`;
    openPrintPreview(`<h2>${title}</h2><div class="sub">งวด ${data.round.name} — วันออก ${new Date(data.round.draw_date).toLocaleDateString('th-TH')}</div>${sections}`, title, filename);
  }

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wider">ลูกค้า</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
            {data.customers.map(c => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wider">รูปแบบรายงาน</label>
          <select value={reportType} onChange={e => setReportType(e.target.value as 'brief' | 'full' | 'detail' | 'wins')}
            className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
            <option value="brief">สรุปลูกค้า (ย่อ) — รายแผ่น</option>
            <option value="full">สรุปลูกค้า (เต็ม) — รายแผ่น × ประเภท</option>
            <option value="detail">สรุปผลกำไร — รายประเภท</option>
            <option value="wins">ผลถูกฉลาก — รายการถูกรางวัล</option>
          </select>
        </div>
        <Button variant="outline" onClick={handlePrint} disabled={reportType === 'wins' && !winsForCust}>พิมพ์ PDF</Button>
      </div>

      {/* Wins view */}
      {reportType === 'wins' && (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <CardTitle>ผลถูกฉลาก — {customer?.name ?? '...'}</CardTitle>
          </div>
          {winsLoading ? (
            <div className="py-12 text-center text-slate-500 text-sm">กำลังโหลด...</div>
          ) : winsForCust ? (
            winsForCust.winning_bets.length === 0 ? (
              <div className="py-12 text-center text-slate-500 text-sm">ไม่มีรายการถูกรางวัล</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-200/40">
                      <Th>แผ่นที่</Th>
                      <Th>ประเภท</Th>
                      <Th>เลข</Th>
                      <Th right>ราคา</Th>
                      <Th right>ยอดจ่าย</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {winsForCust.winning_bets.map((b, i) => (
                      <tr key={i} className="table-row-hover">
                        <Td cls="text-center text-slate-400">{b.sheet_no}</Td>
                        <Td cls="text-slate-300">{BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</Td>
                        <Td cls="font-mono font-bold text-slate-100 text-center">{b.number}</Td>
                        <Td right>{fNum(b.amount)}</Td>
                        <Td right cls="text-rose-400 font-semibold">{fNum(b.payout)}</Td>
                      </tr>
                    ))}
                    <tr className="bg-surface-200/60">
                      <td colSpan={3} className="py-2.5 px-3 text-sm font-semibold text-slate-300 border-b border-border/40">รวม</td>
                      <Td right cls="font-semibold text-slate-200">{fNum(winsForCust.total_amount)}</Td>
                      <Td right cls="font-semibold text-rose-400">{fNum(winsForCust.total_payout)}</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          ) : (
            <div className="py-12 text-center text-slate-500 text-sm">ไม่มีข้อมูลผลถูกรางวัล</div>
          )}
        </Card>
      )}

      {/* Other views (brief / full / detail) */}
      {reportType !== 'wins' && customer && (
        <div className="flex gap-4 items-start">
          {/* Main table */}
          <Card className="p-0 overflow-hidden flex-1">
            <div className="px-5 pt-4 pb-3 border-b border-border flex items-center justify-between">
              <CardTitle>{customer.name}</CardTitle>
              <span className="text-xs text-slate-500">คอมมิชชั่น {customer.commission_rate}%</span>
            </div>

            {/* Brief: per sheet */}
            {reportType === 'brief' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-200/40">
                      <Th>แผ่นที่</Th>
                      <Th right>ขาย</Th>
                      <Th right>เปอร์เซนต์</Th>
                      <Th right>คงเหลือ</Th>
                      <Th right>ถูก</Th>
                      <Th right>สุทธิ</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(customer.by_sheet).sort(([a],[b]) => Number(a)-Number(b)).map(([sheet, row]) => {
                      const net = row.sold - row.pct - row.payout;
                      return (
                        <tr key={sheet} className="table-row-hover">
                          <Td cls="text-slate-300 font-medium">แผ่น {sheet}</Td>
                          <Td right>{fNum(row.sold)}</Td>
                          <Td right cls="text-slate-400">{fNum(row.pct)}</Td>
                          <Td right>{fNum(row.sold - row.pct)}</Td>
                          <Td right cls="text-rose-400">{fNum(row.payout)}</Td>
                          <Td right cls={profitCls(net)}>{fNum(net)}</Td>
                        </tr>
                      );
                    })}
                    <tr className="bg-surface-200/60">
                      <Td cls="text-slate-300 font-semibold">รวม</Td>
                      <Td right cls="text-slate-200 font-semibold">{fNum(customer.sold)}</Td>
                      <Td right cls="text-slate-400 font-semibold">{fNum(customer.pct_sold)}</Td>
                      <Td right cls="text-slate-200 font-semibold">{fNum(customer.remaining_sold)}</Td>
                      <Td right cls="text-rose-400 font-semibold">{fNum(customer.payout)}</Td>
                      <Td right cls={`${profitCls(customer.net)} font-semibold`}>{fNum(customer.net)}</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Full: sheet × type */}
            {reportType === 'full' && (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-surface-200/40">
                      <Th>แผ่น</Th>
                      <Th />
                      {BET_TYPES.map(t => <Th key={t} right>{BET_TYPE_LABELS[t]}</Th>)}
                      <Th right>รวม</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(customer.by_sheet).sort(([a],[b]) => Number(a)-Number(b)).flatMap(([sheet, row]) => {
                      const net = row.sold - row.pct - row.payout;
                      return [
                        <tr key={`${sheet}-s`} className="table-row-hover">
                          <td className="py-1.5 px-3 text-center text-slate-300 font-semibold border-b border-border/40" rowSpan={3}>{sheet}</td>
                          <td className="py-1.5 px-3 text-xs text-slate-400 border-b border-border/40">ขาย</td>
                          {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right font-mono border-b border-border/40">{fNum(customer.by_type[t]?.sold ?? 0)}</td>)}
                          <td className="py-1.5 px-3 text-right font-mono font-semibold text-slate-200 border-b border-border/40">{fNum(row.sold)}</td>
                        </tr>,
                        <tr key={`${sheet}-p`} className="table-row-hover">
                          <td className="py-1.5 px-3 text-xs text-slate-500 border-b border-border/40">% ขาย</td>
                          {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right font-mono text-slate-500 border-b border-border/40">{fNum(customer.by_type[t]?.pct ?? 0)}</td>)}
                          <td className="py-1.5 px-3 text-right font-mono text-slate-500 border-b border-border/40">{fNum(row.pct)}</td>
                        </tr>,
                        <tr key={`${sheet}-w`} className="border-b-2 border-border table-row-hover">
                          <td className="py-1.5 px-3 text-xs text-rose-400 border-b border-border/40">ยอดถูก</td>
                          {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right font-mono text-rose-400 border-b border-border/40">{fNum(customer.by_type[t]?.payout ?? 0)}</td>)}
                          <td className={`py-1.5 px-3 text-right font-mono border-b border-border/40 ${profitCls(net)}`}>{fNum(net)}</td>
                        </tr>,
                      ];
                    })}
                    {[
                      { label: 'ขาย',     cls: 'text-slate-200', vals: BET_TYPES.map(t => customer.by_type[t]?.sold ?? 0), total: customer.sold },
                      { label: '% ขาย',   cls: 'text-slate-500', vals: BET_TYPES.map(t => customer.by_type[t]?.pct ?? 0),  total: customer.pct_sold },
                      { label: 'คงเหลือ', cls: 'text-slate-200', vals: BET_TYPES.map(t => (customer.by_type[t]?.sold ?? 0) - (customer.by_type[t]?.pct ?? 0)), total: customer.remaining_sold },
                      { label: 'ยอดถูก', cls: 'text-rose-400',  vals: BET_TYPES.map(t => customer.by_type[t]?.payout ?? 0), total: customer.payout },
                      { label: 'สุทธิ',   cls: profitCls(customer.net), vals: BET_TYPES.map(t => (customer.by_type[t]?.sold ?? 0)-(customer.by_type[t]?.pct ?? 0)-(customer.by_type[t]?.payout ?? 0)), total: customer.net },
                    ].map(({ label, cls, vals, total }) => (
                      <tr key={label} className="bg-surface-200/60 font-bold">
                        <td className="py-1.5 px-3 text-center text-slate-300 border-b border-border/40">รวม</td>
                        <td className={`py-1.5 px-3 text-xs border-b border-border/40 ${cls}`}>{label}</td>
                        {vals.map((v, i) => <td key={i} className={`py-1.5 px-3 text-right font-mono border-b border-border/40 ${cls}`}>{fNum(v)}</td>)}
                        <td className={`py-1.5 px-3 text-right font-mono border-b border-border/40 ${cls}`}>{fNum(total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Detail: by type */}
            {reportType === 'detail' && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-surface-200/40">
                      <Th>ประเภท</Th>
                      <Th right>ขาย</Th>
                      <Th right>% ขาย</Th>
                      <Th right>คงเหลือ</Th>
                      <Th right>ยอดถูก</Th>
                      <Th right>สุทธิ</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {BET_TYPES.map(t => {
                      const row = customer.by_type[t] ?? { sold: 0, pct: 0, payout: 0 };
                      const net = row.sold - row.pct - row.payout;
                      return (
                        <tr key={t} className="table-row-hover">
                          <Td cls="text-slate-300">{BET_TYPE_LABELS[t]}</Td>
                          <Td right>{fNum(row.sold)}</Td>
                          <Td right cls="text-slate-400">{fNum(row.pct)}</Td>
                          <Td right>{fNum(row.sold - row.pct)}</Td>
                          <Td right cls="text-rose-400">{fNum(row.payout)}</Td>
                          <Td right cls={profitCls(net)}>{fNum(net)}</Td>
                        </tr>
                      );
                    })}
                    <tr className="bg-surface-200/60">
                      <Td cls="text-slate-300 font-semibold">รวม</Td>
                      <Td right cls="text-slate-200 font-semibold">{fNum(customer.sold)}</Td>
                      <Td right cls="text-slate-400 font-semibold">{fNum(customer.pct_sold)}</Td>
                      <Td right cls="text-slate-200 font-semibold">{fNum(customer.remaining_sold)}</Td>
                      <Td right cls="text-rose-400 font-semibold">{fNum(customer.payout)}</Td>
                      <Td right cls={`${profitCls(customer.net)} font-semibold`}>{fNum(customer.net)}</Td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          {/* Right summary panel */}
          <div className="hidden lg:block w-52 shrink-0">
            <Card className="p-4 space-y-3">
              <CardTitle>{customer.name}</CardTitle>
              {([
                ['ยอดขาย', customer.sold, ''],
                ['% ขาย', customer.pct_sold, 'text-slate-400'],
                ['คงเหลือ', customer.remaining_sold, ''],
                ['ยอดถูก', customer.payout, 'text-rose-400'],
                ['ยอดสุทธิ', customer.net, profitCls(customer.net)],
              ] as [string, number, string][]).map(([label, val, cls]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className={`font-mono text-sm ${cls}`}>{fNum(val)}</span>
                </div>
              ))}
              <div className="border-t border-border pt-2 space-y-0.5">
                {BET_TYPES.map(t => {
                  const row = customer.by_type[t];
                  if (!row?.sold) return null;
                  return (
                    <div key={t} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{BET_TYPE_LABELS[t]}</span>
                      <span className="font-mono text-slate-300">{fNum(row.sold)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}


// ─── Dealer tab ─────────────────────────────────────────────────────────────
function DealerTab({ data }: { data: ProfitSummary }) {
  const [selectedId, setSelectedId] = useState<string>(data.dealers[0]?.dealer_id ?? '');
  const [reportType, setReportType] = useState<'brief' | 'full' | 'detail'>('brief');
  const dealer = data.dealers.find(d => d.dealer_id === selectedId);

  function handlePrint() {
    if (reportType === 'full') {
      const rows = data.dealers.map(d => `
        <tr>
          <td>${d.name}</td>
          <td class="num">${fNum(d.sent)}</td>
          <td class="num">${fNum(d.pct_sent)}</td>
          <td class="num">${fNum(d.remaining_sent)}</td>
          <td class="num" style="color:#049">${fNum(d.payout)}</td>
          <td class="num ${d.net<0?'neg':'pos'}">${fNum(d.net)}</td>
        </tr>`).join('');
      const totSent = data.dealers.reduce((a,d) => a+d.sent, 0);
      const totPct  = data.dealers.reduce((a,d) => a+d.pct_sent, 0);
      const totRem  = data.dealers.reduce((a,d) => a+d.remaining_sent, 0);
      const totPay  = data.dealers.reduce((a,d) => a+d.payout, 0);
      const totNet  = data.dealers.reduce((a,d) => a+d.net, 0);
      const html = `<h2>สรุปเจ้ามือทั้งหมด</h2>
        <div class="sub">งวด ${data.round.name}</div>
        <table><thead><tr><th class="l">เจ้ามือ</th><th>ยอดส่ง</th><th>%</th><th>คงเหลือ</th><th>ยอดถูก</th><th>สุทธิ</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(totSent)}</td><td class="num">${fNum(totPct)}</td><td class="num">${fNum(totRem)}</td><td class="num" style="color:#049">${fNum(totPay)}</td><td class="num ${totNet<0?'neg':'pos'}">${fNum(totNet)}</td></tr></tfoot>
        </table>`;
      openPrintPreview(html, `สรุปเจ้ามือทั้งหมด งวด${data.round.name}`, `สรุปเจ้ามือ_งวด${data.round.name}`);
      return;
    }
    const target = dealer ? [dealer] : data.dealers;
    const sections = target.map(d => {
      const typeRows = BET_TYPES.map(t => {
        const row = d.by_type[t] ?? { sent:0, pct:0, payout:0 };
        const net = row.payout - (row.sent - row.pct);
        return `<tr><td>${BET_TYPE_LABELS[t]}</td><td class="num">${fNum(row.sent)}</td><td class="num">${fNum(row.pct)}</td><td class="num">${fNum(row.sent-row.pct)}</td><td class="num" style="color:#049">${fNum(row.payout)}</td><td class="num ${net<0?'neg':'pos'}">${fNum(net)}</td></tr>`;
      }).join('');
      return `
        <div class="section-title">${d.name}</div>
        <table><thead><tr><th>ประเภท</th><th>ส่ง</th><th>%</th><th>คงเหลือ</th><th>ยอดถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${typeRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(d.sent)}</td><td class="num">${fNum(d.pct_sent)}</td><td class="num">${fNum(d.remaining_sent)}</td><td class="num" style="color:#049">${fNum(d.payout)}</td><td class="num ${d.net<0?'neg':'pos'}">${fNum(d.net)}</td></tr></tfoot>
        </table>`;
    }).join('');
    const title = dealer ? `รายงานเจ้ามือ ${dealer.name}` : 'รายงานเจ้ามือทั้งหมด';
    const filename = dealer
      ? `รายงานเจ้ามือ_${dealer.name}_งวด${data.round.name}`
      : `รายงานเจ้ามือทั้งหมด_งวด${data.round.name}`;
    openPrintPreview(`<h2>${title}</h2><div class="sub">งวด ${data.round.name} — วันออก ${new Date(data.round.draw_date).toLocaleDateString('th-TH')}</div>${sections}`, title, filename);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wider">เจ้ามือ</label>
          <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
            className="h-9 w-60 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
            <option value="">เจ้ามือทั้งหมด</option>
            {data.dealers.map(d => <option key={d.dealer_id} value={d.dealer_id}>{d.name}</option>)}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-slate-500 uppercase tracking-wider">รูปแบบรายงาน</label>
          <select value={reportType} onChange={e => setReportType(e.target.value as 'brief' | 'full' | 'detail')}
            className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
            <option value="brief">สรุปเจ้ามือ (ย่อ) — รายประเภท</option>
            <option value="full">สรุปเจ้ามือ (เต็ม) — ทุกเจ้ามือ</option>
            <option value="detail">สรุปผลกำไร — รายประเภท</option>
          </select>
        </div>
        <Button variant="outline" onClick={handlePrint}>พิมพ์ PDF</Button>
      </div>

      {/* Full: all dealers summary */}
      {reportType === 'full' && (
        <Card className="p-0 overflow-hidden">
          <div className="px-5 pt-4 pb-3 border-b border-border">
            <CardTitle>สรุปเจ้ามือทั้งหมด</CardTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-surface-200/40">
                  <Th>เจ้ามือ</Th>
                  <Th right>ยอดส่ง</Th>
                  <Th right>เปอร์เซนต์</Th>
                  <Th right>คงเหลือ</Th>
                  <Th right>ยอดถูก</Th>
                  <Th right>ยอดสุทธิ</Th>
                </tr>
              </thead>
              <tbody>
                {data.dealers.map(d => (
                  <tr key={d.dealer_id} className="table-row-hover">
                    <Td cls="text-slate-200 font-medium">{d.name}</Td>
                    <Td right>{fNum(d.sent)}</Td>
                    <Td right cls="text-slate-400">{fNum(d.pct_sent)}</Td>
                    <Td right>{fNum(d.remaining_sent)}</Td>
                    <Td right cls="text-blue-400">{fNum(d.payout)}</Td>
                    <Td right cls={profitCls(d.net)}>{fNum(d.net)}</Td>
                  </tr>
                ))}
                <tr className="bg-surface-200/60">
                  <Td cls="text-slate-300 font-semibold">รวม</Td>
                  <Td right cls="text-slate-200 font-semibold">{fNum(data.send.total)}</Td>
                  <Td right cls="text-slate-400 font-semibold">{fNum(data.send.pct)}</Td>
                  <Td right cls="text-slate-200 font-semibold">{fNum(data.send.remaining)}</Td>
                  <Td right cls="text-blue-400 font-semibold">{fNum(data.send.payout)}</Td>
                  <Td right cls={`${profitCls(data.send.net)} font-semibold`}>{fNum(data.send.net)}</Td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Brief / Detail: selected dealer by type */}
      {reportType !== 'full' && dealer ? (
        <div className="flex gap-4 items-start">
          <Card className="p-0 overflow-hidden flex-1">
            <div className="px-5 pt-4 pb-3 border-b border-border flex items-center justify-between">
              <CardTitle>{dealer.name}</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-surface-200/40">
                    <Th>ประเภท</Th>
                    <Th right>ส่ง</Th>
                    <Th right>% ส่ง</Th>
                    <Th right>คงเหลือ</Th>
                    <Th right>ยอดถูก</Th>
                    <Th right>สุทธิ</Th>
                  </tr>
                </thead>
                <tbody>
                  {BET_TYPES.map(t => {
                    const row = dealer.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
                    const net = row.payout - (row.sent - row.pct);
                    return (
                      <tr key={t} className="table-row-hover">
                        <Td cls="text-slate-300">{BET_TYPE_LABELS[t]}</Td>
                        <Td right>{fNum(row.sent)}</Td>
                        <Td right cls="text-slate-400">{fNum(row.pct)}</Td>
                        <Td right>{fNum(row.sent - row.pct)}</Td>
                        <Td right cls="text-blue-400">{fNum(row.payout)}</Td>
                        <Td right cls={profitCls(net)}>{fNum(net)}</Td>
                      </tr>
                    );
                  })}
                  <tr className="bg-surface-200/60">
                    <Td cls="text-slate-300 font-semibold">รวม</Td>
                    <Td right cls="text-slate-200 font-semibold">{fNum(dealer.sent)}</Td>
                    <Td right cls="text-slate-400 font-semibold">{fNum(dealer.pct_sent)}</Td>
                    <Td right cls="text-slate-200 font-semibold">{fNum(dealer.remaining_sent)}</Td>
                    <Td right cls="text-blue-400 font-semibold">{fNum(dealer.payout)}</Td>
                    <Td right cls={`${profitCls(dealer.net)} font-semibold`}>{fNum(dealer.net)}</Td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>

          {/* Right summary panel */}
          <div className="hidden lg:block w-52 shrink-0">
            <Card className="p-4 space-y-3">
              <CardTitle>{dealer.name}</CardTitle>
              {([
                ['ยอดส่ง', dealer.sent, ''],
                ['% ส่ง', dealer.pct_sent, 'text-slate-400'],
                ['คงเหลือ', dealer.remaining_sent, ''],
                ['ยอดถูก', dealer.payout, 'text-blue-400'],
                ['ยอดสุทธิ', dealer.net, profitCls(dealer.net)],
              ] as [string, number, string][]).map(([label, val, cls]) => (
                <div key={label} className="flex items-center justify-between gap-2">
                  <span className="text-xs text-slate-500">{label}</span>
                  <span className={`font-mono text-sm ${cls}`}>{fNum(val)}</span>
                </div>
              ))}
              <div className="border-t border-border pt-2 space-y-0.5">
                {BET_TYPES.map(t => {
                  const row = dealer.by_type[t];
                  if (!row?.sent) return null;
                  return (
                    <div key={t} className="flex items-center justify-between text-xs">
                      <span className="text-slate-500">{BET_TYPE_LABELS[t]}</span>
                      <span className="font-mono text-slate-300">{fNum(row.sent)}</span>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </div>
      ) : reportType !== 'full' && (
        <p className="text-sm text-slate-500 text-center py-8">ยังไม่มีข้อมูลเจ้ามือในงวดนี้</p>
      )}
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
function SummaryPageInner() {
  const searchParams = useSearchParams();
  const [rounds, setRounds] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [roundId, setRoundId] = useState(searchParams.get('round') ?? '');
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

  const tabs = [
    { key: 'profit',   label: 'สรุปผลกำไร' },
    { key: 'customer', label: 'รายลูกค้า' },
    { key: 'dealer',   label: 'รายเจ้ามือ' },
  ] as const;

  return (
    <AppShell>
      <Header title="ทำรายการสรุป" subtitle="สรุปผลกำไร-ขาดทุน หลังออกผลสลาก" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-5xl mx-auto space-y-4">

          {/* Controls row */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-slate-400">งวด:</label>
            <select value={roundId} onChange={e => setRoundId(e.target.value)}
              className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
              <option value="">-- เลือกงวด --</option>
              {rounds.map(r => (
                <option key={r.id} value={r.id}>{r.name}{(r.status === 'drawn' || r.status === 'archived') ? ' ✓' : ''}</option>
              ))}
            </select>
            <Button onClick={fetchSummary} disabled={!roundId || loading} variant="outline">
              {loading ? 'กำลังโหลด...' : 'ดึงข้อมูล'}
            </Button>
          </div>

          {error && <p className="text-sm text-rose-400 bg-rose-500/10 rounded px-3 py-2">{error}</p>}

          {data && (
            <>
              {/* Tab bar */}
              <div className="flex gap-1 border-b border-border">
                {tabs.map(t => (
                  <button key={t.key} onClick={() => setTab(t.key)}
                    className={`px-5 py-2.5 text-sm font-semibold transition-colors rounded-t-lg ${
                      tab === t.key
                        ? 'bg-surface-200 text-slate-100 border border-b-transparent border-border'
                        : 'text-slate-500 hover:text-slate-300'
                    }`}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div>
                {tab === 'profit'   && <ProfitTab   data={data} />}
                {tab === 'customer' && <CustomerTab data={data} roundId={roundId} />}
                {tab === 'dealer'   && <DealerTab   data={data} />}
              </div>
            </>
          )}

          {!data && !loading && roundId && (
            <p className="text-sm text-slate-500 text-center py-12">ยังไม่มีข้อมูล — กด "ดึงข้อมูล" เพื่อโหลด</p>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export default function SummaryPage() {
  return <Suspense><SummaryPageInner /></Suspense>;
}
