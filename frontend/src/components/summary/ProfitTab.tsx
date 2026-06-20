'use client';
import { useState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { APP_BRAND_NAME } from '@/lib/brand';
import { openPrintPreview, buildPrintReportHeader } from '@/lib/printPreview';
import { downloadHtmlAsPng } from '@/lib/htmlToPng';
import { themeHex } from '@/lib/printColorTokens';
import type { ProfitSummary } from '@/types/summary';
import {
  BET_TYPE_LABELS,
  BET_TYPES,
  Th,
  Td,
  KpiCard,
  fNum,
  profitCls,
  sendNetByBetType,
  dealerByTypeNet,
  formatReportDateDdMmYyyy,
} from './summaryShared';
export function ProfitTab({ data }: { data: ProfitSummary }) {
  const rd = data.round.result_data;
  const [profitPngBusy, setProfitPngBusy] = useState(false);

  function buildProfitPrintInner(): { inner: string; title: string; filename: string } {
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

    const inner =
      `${header}${resultHtml}${profitBanner}${aggTable}${custTable}${dealerBlock}${byTypeTable}`;
    const title = `สรุปผลกำไร งวด ${data.round.name}`;
    const filename = `สรุปกำไร_งวด${data.round.name}`;
    return { inner, title, filename };
  }

  function handlePrint() {
    const { inner, title, filename } = buildProfitPrintInner();
    openPrintPreview(`<div class="print-root print-formal-doc">${inner}</div>`, title, filename);
  }

  async function handleDownloadPng() {
    const { inner, filename } = buildProfitPrintInner();
    setProfitPngBusy(true);
    try {
      await downloadHtmlAsPng({ bodyHtml: inner, filenameBase: filename, widthPx: 900, pixelRatio: 2 });
    } finally {
      setProfitPngBusy(false);
    }
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

      {/* KPI row — แถวเดียว 4 ช่องรวมสุทธิผลกำไร */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-3.5">
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
        <KpiCard
          label="สรุปสุทธิ"
          labelSecondary="ผลกำไร"
          value={fNum(data.profit)}
          labelClass="text-theme-text-secondary"
          valueClass={data.profit >= 0 ? 'text-profit' : 'text-loss'}
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_minmax(20rem,30rem)] 2xl:grid-cols-[minmax(0,1fr)_minmax(22rem,32rem)] gap-4 2xl:gap-6 items-start">
        <div className="space-y-4 min-w-0">
          {/* Sell / Send summary */}
          <Card className="p-0 overflow-hidden rounded-2xl shadow-sm border-0">
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
              <CardTitle size="lg">สรุปยอดขาย / ส่ง</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)]">
                    <Th />
                    <Th right>ยอดรวม</Th>
                    <Th right>ค่าคอม</Th>
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
          <Card className="p-0 overflow-hidden rounded-2xl shadow-sm border-0">
            <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
              <CardTitle size="lg">สรุปรายลูกค้า</CardTitle>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)]">
                    <Th>ลูกค้า</Th>
                    <Th right>ยอดขาย</Th>
                    <Th right>ค่าคอม</Th>
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
            <Card className="p-0 overflow-hidden rounded-2xl shadow-sm border-0">
              <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
                <CardTitle size="lg">สรุปรายเจ้ามือ</CardTitle>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-[var(--bg-glass-subtle)]">
                      <Th>เจ้ามือ</Th>
                      <Th right>ยอดส่ง</Th>
                      <Th right>ค่าคอม</Th>
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
          <Card className="p-0 overflow-hidden rounded-2xl shadow-sm border-0">
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
                        <td className="py-2.5 px-2 sm:px-3 text-sm text-right tabular-nums tracking-tight text-[13px] sm:text-sm text-theme-text-primary whitespace-nowrap align-middle">
                          {fNum(row.sold)}
                        </td>
                        <td className="py-2.5 px-2 sm:px-3 text-sm text-right tabular-nums tracking-tight text-[13px] sm:text-sm text-theme-text-secondary whitespace-nowrap align-middle">
                          {fNum(sent)}
                        </td>
                        <td className={`py-2.5 pl-2 sm:pl-3 pr-5 text-sm text-right tabular-nums tracking-tight text-[13px] sm:text-sm whitespace-nowrap align-middle ${profitCls(profit)}`}>
                          {fNum(profit)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {/* PDF / PNG — bottom of right panel */}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              onClick={handlePrint}
              className="flex-1 flex items-center justify-center gap-2 rounded-2xl border-0 bg-[var(--color-card-bg-solid)] text-theme-text-primary font-semibold text-sm py-3 px-4 shadow-sm hover:shadow-md hover:bg-[var(--bg-hover)] transition-[background-color,box-shadow] duration-200 [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))]"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
              </svg>
              พิมพ์ PDF
            </button>
            <button
              type="button"
              onClick={() => void handleDownloadPng()}
              disabled={profitPngBusy}
              title="ดาวน์โหลด PNG โดยไม่เปิดกล่องพิมพ์ — ส่งไลน์ได้เลย"
              className="flex-1 flex items-center justify-center gap-2 rounded-xl border-2 border-[var(--chart-primary)] font-semibold text-sm py-3 px-4 shadow-[var(--shadow-soft)] transition-[background-color,box-shadow] duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: 'var(--chart-primary-soft)', color: 'var(--chart-neutral-dark)' }}
            >
              {profitPngBusy ? 'กำลังสร้าง…' : 'ดาวน์โหลด PNG'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
