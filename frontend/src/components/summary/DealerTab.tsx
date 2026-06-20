'use client';
import { useEffect, useState } from 'react';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { reportsApi } from '@/lib/api';
import { APP_BRAND_NAME } from '@/lib/brand';
import { openPrintPreview, buildPrintReportHeader } from '@/lib/printPreview';
import { downloadHtmlAsPng } from '@/lib/htmlToPng';
import { themeHex } from '@/lib/printColorTokens';
import { cn } from '@/lib/utils';
import type { DealerSummary, DealerWin, ProfitSummary } from '@/types/summary';
import {
  BET_TYPE_LABELS, BET_TYPES, Th, Td, fNum, profitCls,
  SUMMARY_CD_BAR, SUMMARY_CD_SOLID,
  WinsDealerTableColGroup, buildDealerWinsPrintSidePanel, dealerWinsTableHtml,
  formatRoundDrawDateLongThai, dealerByTypeNet,
  formatImpliedCommissionPctLabel, formatReportDateDdMmYyyy,
  winBetTypeBadgeClass, winBetTypeLabelClass,
} from './summaryShared';

export function DealerTab({ data, roundId }: { data: ProfitSummary; roundId: string }) {
  const [selectedId, setSelectedId] = useState<string>('');
  const [reportType, setReportType] = useState<'wins' | 'brief' | 'full'>('wins');
  const [winsData, setWinsData] = useState<DealerWin[] | null>(null);
  const [winsLoading, setWinsLoading] = useState(false);
  const [dealerPngBusy, setDealerPngBusy] = useState(false);

  const selectedDealer = data.dealers.find(d => d.dealer_id === selectedId);
  const dealerTargets = selectedId && selectedDealer ? [selectedDealer] : data.dealers;
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

  const dealerComRowLabel = `ยอดคอม ${formatImpliedCommissionPctLabel(dealerOverview.pct, dealerOverview.sent)}`;

  useEffect(() => { setWinsData(null); }, [roundId]);

  useEffect(() => {
    if (reportType !== 'wins' || !roundId || winsData !== null) return;
    setWinsLoading(true);
    reportsApi.dealerWins(roundId)
      .then(res => setWinsData(res.data.dealers))
      .catch(() => setWinsData([]))
      .finally(() => setWinsLoading(false));
  }, [reportType, roundId, winsData]);

  function getDealerPrintPayload(): { inner: string; title: string; filename: string } | null {
    if (reportType === 'wins') {
      const targets = selectedWinsDealers;
      if (targets.length === 0) return null;

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

      const sideName = selectedId ? (selectedDealer?.name ?? 'เจ้ามือ') : 'เจ้ามือทั้งหมด';
      const sideBlock = buildDealerWinsPrintSidePanel(sideName, dealerOverview, dealerByType);

      if (selectedId) {
        const d = targets[0];
        const tableBlock = `<div class="print-wins-main">${dealerWinsTableHtml(d)}</div>`;
        const sections = `
          <div class="print-wins-pack">
            <div class="section-title">ผลถูกฉลากเจ้ามือ — ${selectedDealer?.name ?? d.name}</div>
            <div class="print-wins-grid">
              ${tableBlock}
              ${sideBlock}
            </div>
          </div>`;
        return { inner: `${hdr}${sections}`, title, filename };
      }

      const dealerStacks = targets
        .map((d) => {
          return `
            <div>
              <div class="section-title" style="margin-bottom:8px">เจ้ามือ : ${d.name}</div>
              <div class="print-wins-main">${dealerWinsTableHtml(d)}</div>
            </div>`;
        })
        .join('');

      const sections = `
          <div class="print-wins-pack">
            <div class="section-title">ผลถูกฉลากเจ้ามือ — ทุกเจ้ามือ</div>
            <div class="print-wins-mega-grid">
              <div class="print-wins-left-stack">${dealerStacks}</div>
              ${sideBlock}
            </div>
          </div>`;
      return { inner: `${hdr}${sections}`, title, filename };
    }

    if (dealerTargets.length === 0) return null;

    const briefTables = (d: DealerSummary) => {
      const typeRows = BET_TYPES.map(t => {
        const row = d.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
        const net = dealerByTypeNet(d, t);
        return `<tr><td>${BET_TYPE_LABELS[t]}</td><td class="num">${fNum(row.sent)}</td><td class="num">${fNum(row.pct)}</td><td class="num">${fNum(row.sent - row.pct)}</td><td class="num" style="color:${themeHex.danger}">${fNum(row.payout)}</td><td class="num ${net < 0 ? 'neg' : 'pos'}">${fNum(net)}</td></tr>`;
      }).join('');
      return `
        <div style="font-size:12px;color:${themeHex.textSecondary};margin-bottom:6px">สรุปแยกตามประเภท</div>
        <table><thead><tr><th>ประเภท</th><th>ส่ง</th><th>ค่าคอม</th><th>คงเหลือ</th><th>ถูก</th><th>สุทธิ</th></tr></thead>
          <tbody>${typeRows}</tbody>
          <tfoot><tr class="total-row"><td>รวม</td><td class="num">${fNum(d.sent)}</td><td class="num">${fNum(d.pct_sent)}</td><td class="num">${fNum(d.remaining_sent)}</td><td class="num" style="color:${themeHex.danger}">${fNum(d.payout)}</td><td class="num ${d.net < 0 ? 'neg' : 'pos'}">${fNum(d.net)}</td></tr></tfoot>
        </table>`;
    };

    const fullMatrix = (d: DealerSummary) => {
      const th = BET_TYPES.map(t => `<th>${BET_TYPE_LABELS[t]}</th>`).join('');
      const sentVals = BET_TYPES.map(t => `<td class="num">${fNum(d.by_type[t]?.sent ?? 0)}</td>`).join('');
      const pctVals = BET_TYPES.map(t => `<td class="num">${fNum(d.by_type[t]?.pct ?? 0)}</td>`).join('');
      const remVals = BET_TYPES.map(t => {
        const row = d.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
        return `<td class="num">${fNum(row.sent - row.pct)}</td>`;
      }).join('');
      const payVals = BET_TYPES.map(t => `<td class="num" style="color:${themeHex.danger}">${fNum(d.by_type[t]?.payout ?? 0)}</td>`).join('');
      const netVals = BET_TYPES.map(t => {
        const n = dealerByTypeNet(d, t);
        return `<td class="num ${n < 0 ? 'neg' : 'pos'}">${fNum(n)}</td>`;
      }).join('');
      return `
        <div style="font-size:12px;color:${themeHex.textSecondary};margin:8px 0 4px">เมทริกซ์ตามประเภท</div>
        <table><thead><tr><th class="l" colspan="2">รายการ</th>${th}<th>รวม</th></tr></thead><tbody>
          <tr><th class="l" colspan="2">ส่ง</th>${sentVals}<td class="num">${fNum(d.sent)}</td></tr>
          <tr><th class="l" colspan="2">ค่าคอม</th>${pctVals}<td class="num">${fNum(d.pct_sent)}</td></tr>
          <tr><th class="l" colspan="2">คงเหลือ</th>${remVals}<td class="num">${fNum(d.remaining_sent)}</td></tr>
          <tr><th class="l" colspan="2">ยอดถูก</th>${payVals}<td class="num" style="color:${themeHex.danger}">${fNum(d.payout)}</td></tr>
          <tr><th class="l" colspan="2">สุทธิ</th>${netVals}<td class="num ${d.net < 0 ? 'neg' : 'pos'}">${fNum(d.net)}</td></tr>
        </tbody></table>`;
    };

    const sections = dealerTargets.map(d => {
      const titleBlock = `<div class="section-title">${d.name}</div>`;
      if (reportType === 'brief') {
        return `${titleBlock}${briefTables(d)}`;
      }
      return `${titleBlock}${fullMatrix(d)}${briefTables(d)}`;
    }).join('');

    const title = reportType === 'brief'
      ? (selectedId ? `รายงานสรุปเจ้ามือ (ย่อ) ${selectedDealer?.name ?? ''}` : 'รายงานสรุปเจ้ามือ (ย่อ)')
      : (selectedId ? `รายงานสรุปเจ้ามือ (เต็ม) ${selectedDealer?.name ?? ''}` : 'รายงานสรุปเจ้ามือ (เต็ม)');
    const filename = reportType === 'brief'
      ? (selectedId ? `สรุปเจ้ามือ_ย่อ_${selectedDealer?.name ?? 'เจ้ามือ'}_งวด${data.round.name}` : `สรุปเจ้ามือ_ย่อ_ทุกเจ้ามือ_งวด${data.round.name}`)
      : (selectedId ? `สรุปเจ้ามือ_เต็ม_${selectedDealer?.name ?? 'เจ้ามือ'}_งวด${data.round.name}` : `สรุปเจ้ามือ_เต็ม_ทุกเจ้ามือ_งวด${data.round.name}`);

    const hdr = buildPrintReportHeader({
      reportTitle: title,
      roundName: data.round.name,
      drawDateDdMmYyyy: formatReportDateDdMmYyyy(data.round.draw_date),
    });
    return { inner: `${hdr}${sections}`, title, filename };
  }

  function handlePrint() {
    const p = getDealerPrintPayload();
    if (!p) return;
    openPrintPreview(`<div class="print-root print-formal-doc">${p.inner}</div>`, p.title, p.filename);
  }

  async function handleDownloadPng() {
    const p = getDealerPrintPayload();
    if (!p) return;
    setDealerPngBusy(true);
    try {
      await downloadHtmlAsPng({
        bodyHtml: p.inner,
        filenameBase: p.filename,
        widthPx: reportType === 'wins' ? 920 : reportType === 'full' ? 960 : 860,
        pixelRatio: 2,
      });
    } finally {
      setDealerPngBusy(false);
    }
  }

  const dealerPrintDisabled =
    (reportType === 'wins' && selectedWinsDealers.length === 0) ||
    ((reportType === 'brief' || reportType === 'full') && dealerTargets.length === 0);

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
          <select value={reportType} onChange={e => setReportType(e.target.value as 'wins' | 'brief' | 'full')}
            className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
            <option value="wins">ผลถูกฉลาก — รายการถูกรางวัล</option>
            <option value="brief">สรุปเจ้ามือ (ย่อ) — แยกตามประเภท</option>
            <option value="full">สรุปเจ้ามือ (เต็ม) — เมทริกซ์ × แยกประเภท</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <Button variant="outline" onClick={handlePrint} disabled={dealerPrintDisabled} title="เปิดตัวอย่างแล้วกดพิมพ์หรือบันทึก PDF">
            ส่งออก PDF
          </Button>
          <Button
            variant="outline"
            onClick={() => void handleDownloadPng()}
            disabled={dealerPrintDisabled || dealerPngBusy}
            title="ดาวน์โหลด PNG โดยไม่เปิดกล่องพิมพ์ — ส่งไลน์ได้เลย"
            className="!border-2 !border-[var(--chart-primary)]"
            style={{ background: 'var(--chart-primary-soft)' }}
          >
            {dealerPngBusy ? 'กำลังสร้าง…' : 'ดาวน์โหลด PNG'}
          </Button>
        </div>
      </div>

      {reportType === 'wins' && (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
            <Card className={cn('p-0 overflow-hidden rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}>
              <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)]">
            <CardTitle size="lg">ผลถูกฉลากเจ้ามือ — {selectedId ? (selectedDealer?.name ?? '') : 'ทุกเจ้ามือ'}</CardTitle>
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
                  className={cn('p-0 overflow-hidden rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}
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
                            <td colSpan={2} className="py-2.5 px-3.5 text-sm font-sans font-semibold text-theme-text-secondary">รวม</td>
                            <Td right cls="text-theme-text-primary font-semibold ">{fNum(d.total_amount)}</Td>
                            <Td right cls="text-loss font-semibold ">{fNum(d.total_payout)}</Td>
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
              <CardTitle size="lg" className="shrink-0">{selectedId ? (selectedDealer?.name ?? 'เจ้ามือ') : 'เจ้ามือทั้งหมด'}</CardTitle>
              {formatRoundDrawDateLongThai(data.round.draw_date) ? (
                <span className="text-sm font-medium text-theme-text-secondary sm:text-right">
                  {formatRoundDrawDateLongThai(data.round.draw_date)}
                </span>
              ) : null}
            </div>
            <div className="summary-side-stack mb-3">
              {([
                ['ยอดส่ง', dealerOverview.sent, 'text-theme-text-primary'],
                [dealerComRowLabel, dealerOverview.pct, 'text-theme-text-secondary'],
                ['คงเหลือ', dealerOverview.remaining, 'text-theme-text-primary'],
                ['ยอดถูก', dealerOverview.payout, 'text-loss font-semibold'],
                ['ยอดสุทธิ', dealerOverview.net, profitCls(dealerOverview.net)],
              ] as [string, number, string][]).map(([label, val, valCls]) => (
                <div key={label} className="summary-side-row">
                  <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                  <span className={`tabular-nums tracking-tight text-sm text-right shrink-0 ${valCls}`}>{fNum(val)}</span>
                </div>
              ))}
            </div>

            <div className="summary-side-stack">
              <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                <span className="font-sans min-w-0">ประเภท</span>
                <span className="text-right font-sans">ยอดส่ง</span>
                <span className="text-right font-sans">ยอดคอม</span>
                <span className="text-right font-sans">ยอดถูก</span>
              </div>
              {dealerByType.map(row => (
                <div key={row.type} className="summary-type-grid-r">
                  <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                  <span className="tabular-nums tracking-tight text-right text-theme-text-primary">{fNum(row.sent)}</span>
                  <span className="tabular-nums tracking-tight text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                  <span className="tabular-nums tracking-tight text-right text-loss font-medium">{fNum(row.payout)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
        </div>
      )}

      {reportType !== 'wins' && dealerTargets.length > 0 && (
        <div className="grid grid-cols-1 2xl:grid-cols-[minmax(0,1fr)_minmax(280px,380px)] gap-4 items-start">
          <div className="space-y-4 min-w-0">
            {dealerTargets.map(d => (
              <div key={d.dealer_id} className="flex gap-4 items-start">
                <Card className={cn('p-0 overflow-hidden flex-1 rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}>
                  <div className="px-5 pt-4 pb-3 border-b border-[var(--color-border)] flex items-center justify-between">
                    <CardTitle size="lg">{d.name}</CardTitle>
                    <span className="text-sm font-medium text-theme-text-secondary">สรุปยอดส่ง</span>
                  </div>

                  {reportType === 'brief' && (
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="bg-[var(--bg-glass-subtle)]">
                            <Th>ประเภท</Th>
                            <Th right>ส่ง</Th>
                            <Th right>ค่าคอม</Th>
                            <Th right>คงเหลือ</Th>
                            <Th right>ถูก</Th>
                            <Th right>สุทธิ</Th>
                          </tr>
                        </thead>
                        <tbody>
                          {BET_TYPES.map(t => {
                            const row = d.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
                            const net = dealerByTypeNet(d, t);
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
                            <Td right cls="text-theme-text-primary font-semibold">{fNum(d.sent)}</Td>
                            <Td right cls="text-theme-text-secondary font-semibold">{fNum(d.pct_sent)}</Td>
                            <Td right cls="text-theme-text-primary font-semibold">{fNum(d.remaining_sent)}</Td>
                            <Td right cls="text-loss font-semibold">{fNum(d.payout)}</Td>
                            <Td right cls={`${profitCls(d.net)} font-semibold`}>{fNum(d.net)}</Td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  )}

                  {reportType === 'full' && (
                    <div className="space-y-0">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="bg-[var(--bg-glass-subtle)]">
                              <Th className="min-w-[3.5rem] text-center">กลุ่ม</Th>
                              <Th className="min-w-[4rem]">รายการ</Th>
                              {BET_TYPES.map(t => <Th key={t} right>{BET_TYPE_LABELS[t]}</Th>)}
                              <Th right>รวม</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {([
                              { label: 'ส่ง', cls: 'text-theme-text-primary', vals: BET_TYPES.map(t => d.by_type[t]?.sent ?? 0), total: d.sent },
                              { label: 'ค่าคอม', cls: 'text-theme-text-muted', vals: BET_TYPES.map(t => d.by_type[t]?.pct ?? 0), total: d.pct_sent },
                              {
                                label: 'คงเหลือ',
                                cls: 'text-theme-text-primary',
                                vals: BET_TYPES.map(t => {
                                  const r = d.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
                                  return r.sent - r.pct;
                                }),
                                total: d.remaining_sent,
                              },
                              { label: 'ยอดถูก', cls: 'text-loss', vals: BET_TYPES.map(t => d.by_type[t]?.payout ?? 0), total: d.payout },
                              {
                                label: 'สุทธิ',
                                cls: profitCls(d.net),
                                vals: BET_TYPES.map(t => dealerByTypeNet(d, t)),
                                total: d.net,
                              },
                            ] as { label: string; cls: string; vals: number[]; total: number }[]).map(({ label, cls, vals, total }, ri) => (
                              <tr key={label} className="table-row-hover hover:bg-[var(--bg-hover)] border-b border-[var(--color-border)]">
                                {ri === 0 ? (
                                  <td rowSpan={5} className="py-1.5 px-3 text-center text-theme-text-secondary font-semibold align-middle border-r border-[var(--color-border)]">
                                    ทั้งหมด
                                  </td>
                                ) : null}
                                <td className={`py-1.5 px-3 text-xs font-sans ${cls}`}>{label}</td>
                                {vals.map((v, i) => (
                                  <td key={i} className={`py-1.5 px-3 text-right tabular-nums tracking-tight ${cls}`}>{fNum(v)}</td>
                                ))}
                                <td className={`py-1.5 px-3 text-right tabular-nums tracking-tight font-semibold ${cls}`}>{fNum(total)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div className="overflow-x-auto border-t border-[var(--color-border)]">
                        <div className="px-5 pt-3 pb-1 text-xs font-semibold text-theme-text-secondary">สรุปแยกตามประเภท</div>
                        <table className="w-full">
                          <thead>
                            <tr className="bg-[var(--bg-glass-subtle)]">
                              <Th>ประเภท</Th>
                              <Th right>ส่ง</Th>
                              <Th right>ค่าคอม</Th>
                              <Th right>คงเหลือ</Th>
                              <Th right>ถูก</Th>
                              <Th right>สุทธิ</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {BET_TYPES.map(t => {
                              const row = d.by_type[t] ?? { sent: 0, pct: 0, payout: 0 };
                              const net = dealerByTypeNet(d, t);
                              return (
                                <tr key={`f-${d.dealer_id}-${t}`} className="table-row-hover hover:bg-[var(--bg-hover)]">
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
                              <Td right cls="text-theme-text-primary font-semibold">{fNum(d.sent)}</Td>
                              <Td right cls="text-theme-text-secondary font-semibold">{fNum(d.pct_sent)}</Td>
                              <Td right cls="text-theme-text-primary font-semibold">{fNum(d.remaining_sent)}</Td>
                              <Td right cls="text-loss font-semibold">{fNum(d.payout)}</Td>
                              <Td right cls={`${profitCls(d.net)} font-semibold`}>{fNum(d.net)}</Td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </Card>
              </div>
            ))}
          </div>

          <div className="max-2xl:static 2xl:sticky 2xl:top-4">
            <Card className={cn('p-4 space-y-3 rounded-2xl shadow-sm border-0', SUMMARY_CD_SOLID)}>
              <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                <CardTitle size="lg" className="shrink-0">{selectedId ? (selectedDealer?.name ?? 'เจ้ามือ') : 'เจ้ามือทั้งหมด'}</CardTitle>
                {formatRoundDrawDateLongThai(data.round.draw_date) ? (
                  <span className="text-sm font-medium text-theme-text-secondary sm:text-right">
                    {formatRoundDrawDateLongThai(data.round.draw_date)}
                  </span>
                ) : null}
              </div>
              <div className="summary-side-stack mb-3">
                {([
                  ['ยอดส่ง', dealerOverview.sent, 'text-theme-text-primary'],
                  [dealerComRowLabel, dealerOverview.pct, 'text-theme-text-secondary'],
                  ['คงเหลือ', dealerOverview.remaining, 'text-theme-text-primary'],
                  ['ยอดถูก', dealerOverview.payout, 'text-loss font-semibold'],
                  ['ยอดสุทธิ', dealerOverview.net, profitCls(dealerOverview.net)],
                ] as [string, number, string][]).map(([label, val, valCls]) => (
                  <div key={label} className="summary-side-row">
                    <span className="font-sans text-theme-text-secondary font-medium">{label}</span>
                    <span className={`tabular-nums tracking-tight text-sm text-right shrink-0 ${valCls}`}>{fNum(val)}</span>
                  </div>
                ))}
              </div>

              <div className="summary-side-stack">
                <div className="summary-type-grid-h border-b border-[var(--color-border)]">
                  <span className="font-sans min-w-0">ประเภท</span>
                  <span className="text-right font-sans">ยอดส่ง</span>
                  <span className="text-right font-sans">ยอดคอม</span>
                  <span className="text-right font-sans">ยอดถูก</span>
                </div>
                {dealerByType.map(row => (
                  <div key={row.type} className="summary-type-grid-r">
                    <span className="font-sans min-w-0 whitespace-nowrap">{BET_TYPE_LABELS[row.type]}</span>
                    <span className="tabular-nums tracking-tight text-right text-theme-text-primary">{fNum(row.sent)}</span>
                    <span className="tabular-nums tracking-tight text-right text-theme-text-secondary">{fNum(row.pct)}</span>
                    <span className="tabular-nums tracking-tight text-right text-loss font-medium">{fNum(row.payout)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {reportType !== 'wins' && dealerTargets.length === 0 && (
        <div className="rounded-2xl border-0 bg-[var(--color-card-bg-solid)] shadow-sm px-4 py-10 text-center text-sm text-theme-text-muted">
          ยังไม่มีข้อมูลเจ้ามือในงวดนี้
        </div>
      )}
    </div>
  );
}
