'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { reportsApi } from '@/lib/api';
import { APP_BRAND_NAME } from '@/lib/brand';
import { openPrintPreview, buildPrintReportHeader } from '@/lib/printPreview';
import { downloadHtmlAsPng } from '@/lib/htmlToPng';
import { themeHex } from '@/lib/printColorTokens';
import { cn } from '@/lib/utils';
import type { CustWin, ProfitSummary } from '@/types/summary';
import {
  BET_TYPE_LABELS, BET_TYPES, Th, Td, fNum, profitCls,
  SUMMARY_CD_BAR, SUMMARY_CD_SOLID,
  WinsCustomerTableColGroup, buildWinsPrintSidePanel,
  formatRoundDrawDateLongThai, sheetTypeForCustomer,
  formatImpliedCommissionPctLabel, formatReportDateDdMmYyyy,
  winBetTypeBadgeClass, winBetTypeLabelClass,
} from './summaryShared';

export function CustomerTab({ data, roundId }: { data: ProfitSummary; roundId: string }) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [reportType, setReportType] = useState<'brief' | 'full' | 'wins'>('wins');
  const [winsData, setWinsData]     = useState<CustWin[] | null>(null);
  const [winsLoading, setWinsLoading] = useState(false);
  const [custPngBusy, setCustPngBusy] = useState(false);
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

  const customerComRowLabel =
    selectedId && customer
      ? `ยอดคอม ${customer.commission_display}`
      : `ยอดคอม ${formatImpliedCommissionPctLabel(customerOverview.pct, customerOverview.sold)}`;

  const customerByType = BET_TYPES.map(t => {
    if (selectedId && customer) {
      const row = customer.by_type[t] ?? { sold: 0, pct: 0, payout: 0 };
      return { type: t, sold: row.sold, pct: row.pct, payout: row.payout };
    }
    const row = data.by_type_sell[t] ?? { sold: 0, pct: 0, payout: 0, net: 0 };
    return { type: t, sold: row.sold, pct: row.pct, payout: row.payout };
  });

  function getCustomerPrintPayload(): { inner: string; title: string; filename: string } | null {
    if (reportType === 'wins') {
      if (winsTargets.length === 0) return null;
      const sections = winsTargets.map(w => {
        const csum = data.customers.find(x => x.customer_id === w.customer_id);
        const rows = w.winning_bets.map((b, i) => `
          <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
            <td style="text-align:center">${b.sheet_no}</td>
            <td class="win-p-lbl" data-bet-type="${b.bet_type}">${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
            <td style="text-align:center"><span class="win-p-num" data-bet-type="${b.bet_type}">${b.number}</span></td>
            <td class="num"><span style="font-weight:400">${fNum(b.amount)}</span></td>
            <td class="num" style="color:${themeHex.danger}"><span style="font-weight:400">${fNum(b.payout)}</span></td>
          </tr>`).join('');

        const tableBlock = `
          <div class="print-wins-main">
          <table style="table-layout:fixed;width:100%"><thead><tr><th style="width:10%">แผ่นที่</th><th style="width:24%">ประเภท</th><th style="width:22%">เลข</th><th style="width:20%">ราคา</th><th style="width:24%">ยอดจ่าย</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" style="text-align:center;color:${themeHex.textMuted}">ไม่มีรายการถูกรางวัล</td></tr>`}</tbody>
          ${rows ? `<tfoot><tr class="total-row"><td colspan="3" class="num">รวม</td><td class="num">${fNum(w.total_amount)}</td><td class="num" style="color:${themeHex.danger}">${fNum(w.total_payout)}</td></tr></tfoot>` : ''}
          </table>
          </div>`;
        const sideBlock = buildWinsPrintSidePanel(w.name, csum);
        return `
          <div class="print-wins-pack">
            <div class="section-title">ผลถูกฉลาก — ${w.name}</div>
            <div class="print-wins-grid">
              ${tableBlock}
              ${sideBlock}
            </div>
          </div>`;
      }).join('');

      const title = selectedId
        ? `ผลถูกฉลาก — ${customer?.name ?? ''}`
        : 'ผลถูกฉลาก — ลูกค้าทั้งหมด';
      const filename = selectedId
        ? `ผลถูกฉลาก_${customer?.name ?? 'ลูกค้า'}_งวด${data.round.name}`
        : `ผลถูกฉลาก_ทุกลูกค้า_งวด${data.round.name}`;
      const hdr = buildPrintReportHeader({
        reportTitle: title,
        roundName: data.round.name,
        drawDateDdMmYyyy: formatReportDateDdMmYyyy(data.round.draw_date),
      });
      return { inner: `${hdr}${sections}`, title, filename };
    }
    const sections = customerTargets.map(c => {
      const sheetRows = Object.entries(c.by_sheet).sort(([a],[b]) => Number(a)-Number(b)).map(([sh, row]) => {
        const net = row.sold - row.pct - row.payout;
        return `<tr><td>แผ่น ${sh}</td><td class="num">${fNum(row.sold)}</td><td class="num">${fNum(row.pct)}</td><td class="num">${fNum(row.sold-row.pct)}</td><td class="num" style="color:${themeHex.danger}">${fNum(row.payout)}</td><td class="num ${net<0?'neg':'pos'}">${fNum(net)}</td></tr>`;
      }).join('');
      const typeRows = BET_TYPES.map(t => {
        const row = c.by_type[t] ?? { sold:0, pct:0, payout:0 };
        const net = row.sold - row.pct - row.payout;
        return `<tr><td>${BET_TYPE_LABELS[t]}</td><td class="num">${fNum(row.sold)}</td><td class="num">${fNum(row.pct)}</td><td class="num">${fNum(row.sold-row.pct)}</td><td class="num" style="color:${themeHex.danger}">${fNum(row.payout)}</td><td class="num ${net<0?'neg':'pos'}">${fNum(net)}</td></tr>`;
      }).join('');
      return `
        <div class="section-title">${c.name} (อัตราคอม ${c.commission_display})</div>
        <div style="font-size:12px;color:${themeHex.textSecondary};margin-bottom:6px">สรุปรายแผ่น</div>
        <table><thead><tr><th>แผ่นที่</th><th>ขาย</th><th>ค่าคอม</th><th>คงเหลือ</th><th>ถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${sheetRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(c.sold)}</td><td class="num">${fNum(c.pct_sold)}</td><td class="num">${fNum(c.remaining_sold)}</td><td class="num" style="color:${themeHex.danger}">${fNum(c.payout)}</td><td class="num ${c.net<0?'neg':'pos'}">${fNum(c.net)}</td></tr></tfoot>
        </table>
        <div style="font-size:12px;color:${themeHex.textSecondary};margin:8px 0 4px">แยกตามประเภท</div>
        <table><thead><tr><th>ประเภท</th><th>ขาย</th><th>ค่าคอม</th><th>คงเหลือ</th><th>ถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${typeRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(c.sold)}</td><td class="num">${fNum(c.pct_sold)}</td><td class="num">${fNum(c.remaining_sold)}</td><td class="num" style="color:${themeHex.danger}">${fNum(c.payout)}</td><td class="num ${c.net<0?'neg':'pos'}">${fNum(c.net)}</td></tr></tfoot>
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
    return { inner: `${hdr}${sections}`, title, filename };
  }

  function handlePrint() {
    const p = getCustomerPrintPayload();
    if (!p) return;
    openPrintPreview(`<div class="print-root print-formal-doc">${p.inner}</div>`, p.title, p.filename);
  }

  async function handleDownloadPng() {
    const p = getCustomerPrintPayload();
    if (!p) return;
    setCustPngBusy(true);
    try {
      await downloadHtmlAsPng({
        bodyHtml: p.inner,
        filenameBase: p.filename,
        widthPx: reportType === 'wins' ? 920 : 860,
        pixelRatio: 2,
      });
    } finally {
      setCustPngBusy(false);
    }
  }

  const customerPrintDisabled = reportType === 'wins' && winsTargets.length === 0;

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
        <div className="flex flex-wrap gap-2 items-center">
          <Button
            variant="outline"
            onClick={handlePrint}
            disabled={customerPrintDisabled}
            title="เปิดตัวอย่างแล้วกด «พิมพ์ / บันทึก PDF» — ในกล่องระบบพิมพ์ให้เลือกบันทึกเป็น PDF เพื่อดาวน์โหลดส่งลูกค้า"
          >
            ส่งออก PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleDownloadPng()}
            disabled={customerPrintDisabled || custPngBusy}
            title="ดาวน์โหลด PNG โดยไม่เปิดกล่องพิมพ์ — ส่งไลน์ได้เลย"
            className="!border-2 !border-[var(--chart-primary)]"
            style={{ background: 'var(--chart-primary-soft)' }}
          >
            {custPngBusy ? 'กำลังสร้าง…' : 'ดาวน์โหลด PNG'}
          </Button>
        </div>
      </div>

      {/* Wins view */}
      {reportType === 'wins' && (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
            <Card className={cn('p-0 overflow-hidden rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}>
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
                    className={cn('p-0 overflow-hidden rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}
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
                                <Td cls="text-center text-theme-text-secondary ">{b.sheet_no}</Td>
                                <Td cls={cn('whitespace-normal break-words', winBetTypeLabelClass(b.bet_type))}>
                                  {BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}
                                </Td>
                                <Td cls="text-center align-middle py-2">
                                  <span
                                    className={cn(
                                      'inline-flex min-w-[1.95rem] justify-center rounded-md border px-1.5 py-0.5 tracking-tight text-[0.8125rem] font-bold tracking-wide sm:min-w-[2.15rem] sm:px-1.5 sm:py-0.5 sm:text-sm',
                                      winBetTypeBadgeClass(b.bet_type),
                                    )}
                                  >
                                    {b.number}
                                  </span>
                                </Td>
                                <Td right cls="text-theme-text-primary">{fNum(b.amount)}</Td>
                                <Td right cls="text-loss font-semibold ">{fNum(b.payout)}</Td>
                              </tr>
                            ))}
                            <tr className="bg-surface-50">
                              <td colSpan={3} className="py-2.5 px-3.5 text-sm font-sans font-semibold text-theme-text-secondary">รวม</td>
                              <Td right cls="text-theme-text-primary font-semibold ">{fNum(w.total_amount)}</Td>
                              <Td right cls="text-loss font-semibold ">{fNum(w.total_payout)}</Td>
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
            <Card className={cn('p-4 space-y-3 rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <CardTitle size="lg" className="shrink-0">{selectedId ? (customer?.name ?? 'ลูกค้า') : 'ลูกค้าทั้งหมด'}</CardTitle>
                {formatRoundDrawDateLongThai(data.round.draw_date) ? (
                  <span className="text-sm font-medium text-theme-text-secondary sm:text-right">
                    {formatRoundDrawDateLongThai(data.round.draw_date)}
                  </span>
                ) : null}
              </div>
              <div className="summary-side-stack mb-3">
                {([
                  ['ยอดขาย', customerOverview.sold, 'text-theme-text-primary'],
                  [customerComRowLabel, customerOverview.pct, 'text-theme-text-secondary'],
                  ['คงเหลือ', customerOverview.remaining, 'text-theme-text-primary'],
                  ['ยอดถูก', customerOverview.payout, 'text-loss font-semibold'],
                  ['ยอดสุทธิ', customerOverview.net, profitCls(customerOverview.net)],
                ] as [string, number, string][]).map(([label, val, valCls]) => (
                  <div key={label} className="summary-side-row">
                    <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                    <span className={`tabular-nums tracking-tight text-right shrink-0 ${valCls}`}>{fNum(val)}</span>
                  </div>
                ))}
              </div>

              <div className="summary-side-stack">
                <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                  <span className="font-sans min-w-0">ประเภท</span>
                  <span className="text-right font-sans">ยอดขาย</span>
                  <span className="text-right font-sans">ยอดคอม</span>
                  <span className="text-right font-sans">ยอดถูก</span>
                </div>
                {customerByType.map(row => (
                  <div key={row.type} className="summary-type-grid-r">
                    <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                    <span className="tabular-nums tracking-tight text-right text-theme-text-primary">{fNum(row.sold)}</span>
                    <span className="tabular-nums tracking-tight text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                    <span className="tabular-nums tracking-tight text-right text-loss font-medium">{fNum(row.payout)}</span>
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
              <Card className={cn('p-0 overflow-hidden flex-1 rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}>
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
                          <Th right>ค่าคอม</Th>
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
                              {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right tabular-nums tracking-tight">{fNum(sheetTypeForCustomer(c, sheet, t).sold)}</td>)}
                              <td className="py-1.5 px-3 text-right tabular-nums tracking-tight font-semibold text-theme-text-primary">{fNum(row.sold)}</td>
                            </tr>,
                            <tr key={`${c.customer_id}-${sheet}-p`} className="table-row-hover hover:bg-[var(--bg-hover)]">
                              <td className="py-1.5 px-3 text-sm font-sans text-theme-text-muted">ยอดคอม</td>
                              {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right tabular-nums tracking-tight text-theme-text-muted">{fNum(sheetTypeForCustomer(c, sheet, t).pct)}</td>)}
                              <td className="py-1.5 px-3 text-right tabular-nums tracking-tight text-theme-text-muted">{fNum(row.pct)}</td>
                            </tr>,
                            <tr key={`${c.customer_id}-${sheet}-w`} className="border-b border-[var(--color-border)] table-row-hover hover:bg-[var(--bg-hover)]">
                              <td className="py-1.5 px-3 text-xs font-sans text-loss">ยอดถูก</td>
                              {BET_TYPES.map(t => <td key={t} className="py-1.5 px-3 text-right tabular-nums tracking-tight text-loss">{fNum(sheetTypeForCustomer(c, sheet, t).payout)}</td>)}
                              <td className={`py-1.5 px-3 text-right tabular-nums tracking-tight ${profitCls(net)}`}>{fNum(net)}</td>
                            </tr>,
                          ];
                        })}
                        {[
                          { label: 'ขาย',     cls: 'text-theme-text-primary', vals: BET_TYPES.map(t => c.by_type[t]?.sold ?? 0), total: c.sold },
                          { label: 'ยอดคอม',   cls: 'text-theme-text-muted', vals: BET_TYPES.map(t => c.by_type[t]?.pct ?? 0),  total: c.pct_sold },
                          { label: 'คงเหลือ', cls: 'text-theme-text-primary', vals: BET_TYPES.map(t => (c.by_type[t]?.sold ?? 0) - (c.by_type[t]?.pct ?? 0)), total: c.remaining_sold },
                          { label: 'ยอดถูก', cls: 'text-loss',  vals: BET_TYPES.map(t => c.by_type[t]?.payout ?? 0), total: c.payout },
                          { label: 'สุทธิ',   cls: profitCls(c.net), vals: BET_TYPES.map(t => (c.by_type[t]?.sold ?? 0)-(c.by_type[t]?.pct ?? 0)-(c.by_type[t]?.payout ?? 0)), total: c.net },
                        ].map(({ label, cls, vals, total }) => (
                          <tr key={`${c.customer_id}-${label}`} className="bg-surface-50 font-bold">
                            <td className="py-1.5 px-3 text-center text-theme-text-secondary">รวม</td>
                            <td className={`py-1.5 px-3 text-xs font-sans ${cls}`}>{label}</td>
                            {vals.map((v, i) => <td key={i} className={`py-1.5 px-3 text-right tabular-nums tracking-tight ${cls}`}>{fNum(v)}</td>)}
                            <td className={`py-1.5 px-3 text-right tabular-nums tracking-tight ${cls}`}>{fNum(total)}</td>
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
            <Card className={cn('p-4 space-y-3 rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <CardTitle size="lg" className="shrink-0">{selectedId ? (customer?.name ?? 'ลูกค้า') : 'ลูกค้าทั้งหมด'}</CardTitle>
                {formatRoundDrawDateLongThai(data.round.draw_date) ? (
                  <span className="text-sm font-medium text-theme-text-secondary sm:text-right">
                    {formatRoundDrawDateLongThai(data.round.draw_date)}
                  </span>
                ) : null}
              </div>
              <div className="summary-side-stack mb-3">
                {([
                  ['ยอดขาย', customerOverview.sold, 'text-theme-text-primary'],
                  [customerComRowLabel, customerOverview.pct, 'text-theme-text-secondary'],
                  ['คงเหลือ', customerOverview.remaining, 'text-theme-text-primary'],
                  ['ยอดถูก', customerOverview.payout, 'text-loss'],
                  ['ยอดสุทธิ', customerOverview.net, profitCls(customerOverview.net)],
                ] as [string, number, string][]).map(([label, val, cls]) => (
                  <div key={label} className="summary-side-row">
                    <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                    <span className={`tabular-nums tracking-tight text-sm text-right shrink-0 ${cls}`}>{fNum(val)}</span>
                  </div>
                ))}
              </div>

              <div className="summary-side-stack">
                <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                  <span className="font-sans min-w-0">ประเภท</span>
                  <span className="text-right font-sans">ยอดขาย</span>
                  <span className="text-right font-sans">ยอดคอม</span>
                  <span className="text-right font-sans">ยอดถูก</span>
                </div>
                {customerByType.map(row => (
                  <div key={row.type} className="summary-type-grid-r">
                    <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                    <span className="tabular-nums tracking-tight text-right text-theme-text-primary">{fNum(row.sold)}</span>
                    <span className="tabular-nums tracking-tight text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                    <span className="tabular-nums tracking-tight text-right text-loss">{fNum(row.payout)}</span>
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
