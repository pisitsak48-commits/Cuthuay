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

function fNum(v: number) { return Math.round(v).toLocaleString('th-TH'); }

// ─── Types ────────────────────────────────────────────────────────────────────
interface WinBet { sheet_no: number; bet_type: string; number: string; amount: number; payout: number; }
interface CustWin { customer_id: string; name: string; winning_bets: WinBet[]; total_amount: number; total_payout: number; }
interface CustomerWinsData {
  round: { id: string; name: string; draw_date: string; result_data: Record<string, unknown> | null };
  customers: CustWin[];
}

interface DealerWinItem { bet_type: string; number: string; amount: number; payout: number; }
interface DealerWin { dealer_id: string; name: string; winning_items: DealerWinItem[]; total_amount: number; total_payout: number; }
interface DealerWinsData {
  round: { id: string; name: string; draw_date: string; result_data: Record<string, unknown> | null };
  dealers: DealerWin[];
}

// ─── Print helpers ────────────────────────────────────────────────────────────
function printCustomerWins(cust: CustWin, roundName: string, drawDate: string) {
  const rows = cust.winning_bets.map((b, i) => `
    <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
      <td style="text-align:center">${b.sheet_no}</td>
      <td>${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
      <td style="text-align:center;font-weight:bold">${b.number}</td>
      <td class="num">${fNum(b.amount)}</td>
      <td class="num" style="font-weight:bold">${fNum(b.payout)}</td>
    </tr>`).join('');
  const body = `
    <h2>รายงานสรุปผลถูกสลากลูกค้า</h2>
    <div class="sub">ลูกค้า : ${cust.name} &nbsp;&nbsp; งวด ${roundName} (${drawDate})</div>
    <table>
      <thead><tr>
        <th style="width:80px">แผ่นที่</th><th>ประเภทเลข</th>
        <th style="width:80px">เลข</th><th style="width:100px">ราคา</th><th style="width:110px">จ่าย</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row">
        <td colspan="3" class="num">รวม</td>
        <td class="num">${fNum(cust.total_amount)}</td>
        <td class="num">${fNum(cust.total_payout)}</td>
      </tr></tfoot>
    </table>`;
  openPrintPreview(body, `รายงานสรุปผลถูกสลากลูกค้า`, `ผลถูกสลาก_${cust.name}_งวด${roundName}`);
}

function printAllCustomers(customers: CustWin[], roundName: string, drawDate: string) {
  const sections = customers.map(cust => {
    const rows = cust.winning_bets.map((b, i) => `
      <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
        <td style="text-align:center">${b.sheet_no}</td>
        <td>${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
        <td style="text-align:center;font-weight:bold">${b.number}</td>
        <td class="num">${fNum(b.amount)}</td>
        <td class="num" style="font-weight:bold">${fNum(b.payout)}</td>
      </tr>`).join('');
    return `
      <div class="section">
        <div class="section-title">ลูกค้า : ${cust.name}</div>
        <table>
          <thead><tr>
            <th style="width:70px">แผ่นที่</th><th>ประเภทเลข</th>
            <th style="width:70px">เลข</th><th style="width:90px">ราคา</th><th style="width:100px">จ่าย</th>
          </tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr class="total-row">
            <td colspan="3" class="num">รวม</td>
            <td class="num">${fNum(cust.total_amount)}</td>
            <td class="num">${fNum(cust.total_payout)}</td>
          </tr></tfoot>
        </table>
      </div>`;
  }).join('');
  const title = `รายงานสรุปผลถูกสลากลูกค้า — งวด ${roundName} (${drawDate})`;
  openPrintPreview(`<h2>${title}</h2>${sections}`, title, `ผลถูกสลากทุกลูกค้า_งวด${roundName}`);
}

function printDealerWins(dealer: DealerWin, roundName: string, drawDate: string) {
  const rows = dealer.winning_items.map((b, i) => `
    <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
      <td>${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
      <td style="text-align:center;font-weight:bold">${b.number}</td>
      <td class="num">${fNum(b.amount)}</td>
      <td class="num" style="font-weight:bold">${fNum(b.payout)}</td>
    </tr>`).join('');
  const body = `
    <h2>รายงานสรุปผลถูกสลากเจ้ามือ</h2>
    <div class="sub">เจ้ามือ : ${dealer.name} &nbsp;&nbsp; งวด ${roundName} (${drawDate})</div>
    <table>
      <thead><tr>
        <th>ประเภทเลข</th><th style="width:80px">เลข</th>
        <th style="width:100px">ราคา</th><th style="width:110px">จ่าย</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr class="total-row">
        <td colspan="2" class="num">รวม</td>
        <td class="num">${fNum(dealer.total_amount)}</td>
        <td class="num">${fNum(dealer.total_payout)}</td>
      </tr></tfoot>
    </table>`;
  openPrintPreview(body, `รายงานสรุปผลถูกสลากเจ้ามือ`, `ผลถูกสลาก_${dealer.name}_งวด${roundName}`);
}

// ─── Cards ────────────────────────────────────────────────────────────────────
function CustomerWinCard({ customer, roundName, drawDate }: { customer: CustWin; roundName: string; drawDate: string }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-border flex items-center justify-between">
        <div>
          <CardTitle>ผลถูกฉลาก — {customer.name}</CardTitle>
          <p className="text-sm text-slate-400 mt-0.5">งวด {roundName} ({drawDate})</p>
        </div>
        <Button variant="ghost" onClick={() => printCustomerWins(customer, roundName, drawDate)}>PDF</Button>
      </div>
      {customer.winning_bets.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">ไม่มีเลขถูกรางวัล</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-amber-500/10 border-b border-amber-500/20">
                <th className="py-2.5 px-4 text-xs font-semibold text-amber-300 text-center w-20">แผ่นที่</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-amber-300 text-left">ประเภทเลข</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-amber-300 text-center w-20">เลข</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-amber-300 text-right w-28">ราคา</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-amber-300 text-right w-32">ยอดจ่าย</th>
              </tr>
            </thead>
            <tbody>
              {customer.winning_bets.map((b, i) => (
                <tr key={i} className="border-b border-border/40 hover:bg-surface-200/40 transition-colors">
                  <td className="py-2.5 px-4 text-sm text-center text-slate-300">{b.sheet_no}</td>
                  <td className="py-2.5 px-4 text-sm text-slate-300">{BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
                  <td className="py-2.5 px-4 text-sm text-center font-mono font-bold text-slate-100 tracking-widest">{b.number}</td>
                  <td className="py-2.5 px-4 text-sm text-right font-mono text-slate-300">{fNum(b.amount)}</td>
                  <td className="py-2.5 px-4 text-sm text-right font-mono font-bold text-amber-300">{fNum(b.payout)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-200/60">
                <td colSpan={3} className="py-2.5 px-4 text-sm text-right font-semibold text-slate-300">รวม</td>
                <td className="py-2.5 px-4 text-sm text-right font-mono font-semibold text-slate-200">{fNum(customer.total_amount)}</td>
                <td className="py-2.5 px-4 text-sm text-right font-mono font-bold text-amber-300">{fNum(customer.total_payout)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

function DealerWinCard({ dealer, roundName, drawDate }: { dealer: DealerWin; roundName: string; drawDate: string }) {
  return (
    <Card className="p-0 overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-border flex items-center justify-between">
        <div>
          <CardTitle>ผลถูกฉลาก — {dealer.name}</CardTitle>
          <p className="text-sm text-slate-400 mt-0.5">งวด {roundName} ({drawDate})</p>
        </div>
        <Button variant="ghost" onClick={() => printDealerWins(dealer, roundName, drawDate)}>PDF</Button>
      </div>
      {dealer.winning_items.length === 0 ? (
        <p className="px-5 py-6 text-sm text-slate-500">ไม่มีเลขถูกรางวัล</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-sky-500/10 border-b border-sky-500/20">
                <th className="py-2.5 px-4 text-xs font-semibold text-sky-300 text-left">ประเภทเลข</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-sky-300 text-center w-20">เลข</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-sky-300 text-right w-28">ราคา</th>
                <th className="py-2.5 px-4 text-xs font-semibold text-sky-300 text-right w-32">ยอดจ่าย</th>
              </tr>
            </thead>
            <tbody>
              {dealer.winning_items.map((b, i) => (
                <tr key={i} className="border-b border-border/40 hover:bg-surface-200/40 transition-colors">
                  <td className="py-2.5 px-4 text-sm text-slate-300">{BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
                  <td className="py-2.5 px-4 text-sm text-center font-mono font-bold text-slate-100 tracking-widest">{b.number}</td>
                  <td className="py-2.5 px-4 text-sm text-right font-mono text-slate-300">{fNum(b.amount)}</td>
                  <td className="py-2.5 px-4 text-sm text-right font-mono font-bold text-sky-300">{fNum(b.payout)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-border bg-surface-200/60">
                <td colSpan={2} className="py-2.5 px-4 text-sm text-right font-semibold text-slate-300">รวม</td>
                <td className="py-2.5 px-4 text-sm text-right font-mono font-semibold text-slate-200">{fNum(dealer.total_amount)}</td>
                <td className="py-2.5 px-4 text-sm text-right font-mono font-bold text-sky-300">{fNum(dealer.total_payout)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
type ActiveTab = 'customer' | 'dealer';

function BetResultsPageInner() {
  const searchParams = useSearchParams();
  const [rounds, setRounds] = useState<Array<{ id: string; name: string; draw_date: string; status: string }>>([]);
  const [roundId, setRoundId] = useState(searchParams.get('round') ?? '');
  const [tab, setTab] = useState<ActiveTab>('customer');

  // Customer wins state
  const [custData, setCustData] = useState<CustomerWinsData | null>(null);
  const [selectedCustId, setSelectedCustId] = useState('');
  const [custLoading, setCustLoading] = useState(false);
  const [custError, setCustError] = useState('');

  // Dealer wins state
  const [dealerData, setDealerData] = useState<DealerWinsData | null>(null);
  const [selectedDealerId, setSelectedDealerId] = useState('');
  const [dealerLoading, setDealerLoading] = useState(false);
  const [dealerError, setDealerError] = useState('');

  const fetchRounds = useCallback(async () => {
    try {
      const res = await roundsApi.list();
      const all: Array<{ id: string; name: string; draw_date: string; status: string }> = res.data.rounds ?? [];
      setRounds(all);
      if (!roundId) {
        const drawn = all.find(r => r.status === 'drawn' || r.status === 'archived');
        if (drawn) setRoundId(drawn.id);
      }
    } catch { /* ignore */ }
  }, [roundId]);

  const fetchCustWins = useCallback(async () => {
    if (!roundId) return;
    setCustLoading(true); setCustError('');
    try {
      const res = await reportsApi.customerWins(roundId);
      setCustData(res.data);
      setSelectedCustId(res.data.customers[0]?.customer_id ?? '');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'โหลดข้อมูลไม่สำเร็จ';
      setCustError(msg); setCustData(null);
    } finally { setCustLoading(false); }
  }, [roundId]);

  const fetchDealerWins = useCallback(async () => {
    if (!roundId) return;
    setDealerLoading(true); setDealerError('');
    try {
      const res = await reportsApi.dealerWins(roundId);
      setDealerData(res.data);
      setSelectedDealerId(res.data.dealers[0]?.dealer_id ?? '');
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error ?? 'โหลดข้อมูลไม่สำเร็จ';
      setDealerError(msg); setDealerData(null);
    } finally { setDealerLoading(false); }
  }, [roundId]);

  useEffect(() => { fetchRounds(); }, []);
  useEffect(() => {
    setCustData(null); setDealerData(null);
    void fetchCustWins();
    void fetchDealerWins();
  }, [roundId]);

  const round = rounds.find(r => r.id === roundId);
  const drawDate = round ? new Date(round.draw_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  const customer = custData?.customers.find(c => c.customer_id === selectedCustId);
  const dealer = dealerData?.dealers.find(d => d.dealer_id === selectedDealerId);

  const selectClass = "h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent";

  return (
    <AppShell>
      <Header title="ผลถูกฉลาก" subtitle="รายการถูกรางวัล" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-3xl mx-auto space-y-4">

          {/* Round selector + tabs */}
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-slate-500 uppercase tracking-wider">งวด</label>
              <select value={roundId} onChange={e => setRoundId(e.target.value)} className={selectClass}>
                <option value="">-- เลือกงวด --</option>
                {rounds.filter(r => r.status === 'drawn' || r.status === 'archived').map(r => (
                  <option key={r.id} value={r.id}>{r.name} ✓</option>
                ))}
              </select>
            </div>

            <div className="flex border border-border rounded overflow-hidden">
              <button
                onClick={() => setTab('customer')}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === 'customer' ? 'bg-amber-600 text-white' : 'bg-surface-200 text-slate-300 hover:bg-surface-100'}`}
              >
                ลูกค้า
              </button>
              <button
                onClick={() => setTab('dealer')}
                className={`px-4 py-1.5 text-sm font-medium transition-colors ${tab === 'dealer' ? 'bg-sky-600 text-white' : 'bg-surface-200 text-slate-300 hover:bg-surface-100'}`}
              >
                เจ้ามือ
              </button>
            </div>

            {/* Customer filter + print (customer tab) */}
            {tab === 'customer' && custData && custData.customers.length > 0 && (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-xs text-slate-500 uppercase tracking-wider">ลูกค้า</label>
                  <select value={selectedCustId} onChange={e => setSelectedCustId(e.target.value)} className={selectClass}>
                    <option value="">-- ทุกลูกค้า --</option>
                    {custData.customers.map(c => (
                      <option key={c.customer_id} value={c.customer_id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <Button variant="outline" onClick={() => {
                  if (!custData) return;
                  const roundName = custData.round.name;
                  if (customer) printCustomerWins(customer, roundName, drawDate);
                  else printAllCustomers(custData.customers, roundName, drawDate);
                }}>พิมพ์ PDF</Button>
              </>
            )}

            {/* Dealer filter + print (dealer tab) */}
            {tab === 'dealer' && dealerData && dealerData.dealers.length > 0 && (
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500 uppercase tracking-wider">เจ้ามือ</label>
                <select value={selectedDealerId} onChange={e => setSelectedDealerId(e.target.value)} className={selectClass}>
                  <option value="">-- ทุกเจ้ามือ --</option>
                  {dealerData.dealers.map(d => (
                    <option key={d.dealer_id} value={d.dealer_id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
            {tab === 'dealer' && dealerData && dealerData.dealers.length > 0 && (
              <Button variant="outline" onClick={() => {
                if (!dealerData) return;
                const toPrint = selectedDealerId && dealer ? [dealer] : dealerData.dealers;
                const sections = toPrint.map(d => {
                  const rows = d.winning_items.map((b, i) => `
                    <tr class="${i % 2 !== 0 ? 'stripe-even' : ''}">
                      <td>${BET_TYPE_LABELS[b.bet_type] ?? b.bet_type}</td>
                      <td style="text-align:center;font-weight:bold">${b.number}</td>
                      <td class="num">${fNum(b.amount)}</td>
                      <td class="num" style="font-weight:bold">${fNum(b.payout)}</td>
                    </tr>`).join('');
                  return `<div class="section"><div class="section-title">เจ้ามือ : ${d.name}</div>
                    <table>
                      <thead><tr><th>ประเภทเลข</th><th style="width:70px">เลข</th><th style="width:90px">ราคา</th><th style="width:100px">จ่าย</th></tr></thead>
                      <tbody>${rows}</tbody>
                      <tfoot><tr class="total-row"><td colspan="2" class="num">รวม</td><td class="num">${fNum(d.total_amount)}</td><td class="num">${fNum(d.total_payout)}</td></tr></tfoot>
                    </table></div>`;
                }).join('');
                const title = `รายงานสรุปผลถูกสลากเจ้ามือ — งวด ${dealerData.round.name} (${drawDate})`;
                openPrintPreview(`<h2>${title}</h2>${sections}`, title, `ผลถูกสลากเจ้ามือ_งวด${dealerData.round.name}`);
              }}>พิมพ์ PDF</Button>
            )}
          </div>

          {/* ─ Customer tab ─ */}
          {tab === 'customer' && (
            <>
              {custError && <p className="text-sm text-rose-400 bg-rose-500/10 rounded px-3 py-2">{custError}</p>}
              {custLoading && <p className="text-sm text-slate-500 text-center py-8">กำลังโหลด...</p>}
              {custData && !custLoading && (
                custData.customers.length === 0 ? (
                  <Card className="p-8 text-center text-slate-500 text-sm">ไม่มีลูกค้าถูกรางวัลในงวดนี้</Card>
                ) : selectedCustId && customer ? (
                  <CustomerWinCard customer={customer} roundName={custData.round.name} drawDate={drawDate} />
                ) : (
                  <div className="space-y-4">
                    {custData.customers.map(c => (
                      <CustomerWinCard key={c.customer_id} customer={c} roundName={custData.round.name} drawDate={drawDate} />
                    ))}
                  </div>
                )
              )}
            </>
          )}

          {/* ─ Dealer tab ─ */}
          {tab === 'dealer' && (
            <>
              {dealerError && <p className="text-sm text-rose-400 bg-rose-500/10 rounded px-3 py-2">{dealerError}</p>}
              {dealerLoading && <p className="text-sm text-slate-500 text-center py-8">กำลังโหลด...</p>}
              {dealerData && !dealerLoading && (
                dealerData.dealers.length === 0 ? (
                  <Card className="p-8 text-center text-slate-500 text-sm">ไม่มีเจ้ามือถูกรางวัลในงวดนี้ (ไม่มีข้อมูลส่งเจ้ามือ)</Card>
                ) : selectedDealerId && dealer ? (
                  <DealerWinCard dealer={dealer} roundName={dealerData.round.name} drawDate={drawDate} />
                ) : (
                  <div className="space-y-4">
                    {dealerData.dealers.map(d => (
                      <DealerWinCard key={d.dealer_id} dealer={d} roundName={dealerData.round.name} drawDate={drawDate} />
                    ))}
                  </div>
                )
              )}
            </>
          )}

        </div>
      </main>
    </AppShell>
  );
}

export default function BetResultsPage() {
  return <Suspense><BetResultsPageInner /></Suspense>;
}

