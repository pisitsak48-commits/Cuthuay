'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Button } from '@/components/ui/Button';
import { RoundStatusBadge } from '@/components/ui/Badge';
import { roundsApi, reportsApi, cutApi } from '@/lib/api';
import { formatBaht, formatPercent } from '@/lib/utils';
import { Round, RiskReport } from '@/types';

export default function ReportsPage() {
  const [rounds, setRounds] = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId] = useState('');
  const [summary, setSummary] = useState<RiskReport | null>(null);
  const [breakdown, setBreakdown] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [pdfLoading, setPdfLoading] = useState(false);

  const fetchRounds = useCallback(async () => {
    try {
      const res = await roundsApi.list();
      setRounds(res.data.rounds);
    } catch { /* ignore */ }
  }, []);

  const fetchSummary = useCallback(async () => {
    if (!selectedRoundId) return;
    setLoading(true);
    try {
      const res = await reportsApi.summary(selectedRoundId);
      setSummary(res.data);
      setBreakdown(res.data.breakdown ?? []);
    } finally {
      setLoading(false);
    }
  }, [selectedRoundId]);

  useEffect(() => { fetchRounds(); }, []);
  useEffect(() => { fetchSummary(); }, [selectedRoundId]);

  const downloadPdf = async () => {
    if (!selectedRoundId) return;
    setPdfLoading(true);
    try {
      const res = await reportsApi.pdf(selectedRoundId);
      const url = URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      const round = rounds.find((r) => r.id === selectedRoundId);
      a.download = `report_${round?.name ?? selectedRoundId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setPdfLoading(false);
    }
  };

  const BET_TYPE_TH: Record<string, string> = {
    '2digit_top':    '2 ตัวบน',
    '2digit_bottom': '2 ตัวล่าง',
    '3digit_top':    '3 ตัวบน',
    '3digit_tote':   '3 ตัวโต็ด',
    '3digit_back':   '3 ตัวล่าง',
    '1digit_top':    'วิ่งบน',
    '1digit_bottom': 'วิ่งล่าง',
  };

  return (
    <AppShell>
      <Header title="รายงาน" subtitle="สรุปผลและส่งออกรายงาน" />

      <main className="flex-1 p-6 space-y-5">
        {/* Controls */}
        <div className="flex gap-3 items-end flex-wrap">
          <select
            value={selectedRoundId}
            onChange={(e) => setSelectedRoundId(e.target.value)}
            className="h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-1 focus:ring-accent"
          >
            <option value="">-- เลือกงวด --</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>
          <Button
            variant="outline"
            onClick={downloadPdf}
            loading={pdfLoading}
            disabled={!selectedRoundId}
          >
            ดาวน์โหลด PDF
          </Button>
        </div>

        {/* KPIs */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="ยอดรับรวม"    value={summary.total_revenue} format="baht"    index={0} colorOverride="text-profit" />
            <StatCard label="ขาดทุนสูงสุด" value={summary.max_loss}      format="baht"    index={1} colorOverride={summary.max_loss > 0 ? 'text-loss' : 'text-theme-text-secondary'} />
            <StatCard label="ความเสี่ยง %"  value={summary.risk_percent}  format="percent" index={2} />
            <StatCard label="P&L คาดหวัง"  value={summary.expected_pl}   format="baht"    index={3} colorOverride={summary.expected_pl >= 0 ? 'text-profit' : 'text-loss'} />
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Bet Breakdown */}
          <Card>
            <CardHeader><CardTitle>ยอดแบ่งตามประเภท</CardTitle></CardHeader>
            {breakdown.length > 0 ? (
              <div className="space-y-3">
                {breakdown.map((row: any) => (
                  <div key={row.bet_type} className="flex items-center justify-between">
                    <span className="text-sm text-theme-text-secondary">{BET_TYPE_TH[row.bet_type] ?? row.bet_type}</span>
                    <div className="flex items-center gap-4 text-xs tabular-nums tracking-tight">
                      <span className="text-theme-text-muted">{row.count} รายการ</span>
                      <span className="text-profit font-semibold">{formatBaht(parseFloat(row.total))}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center text-theme-text-muted text-sm py-8">เลือกงวดเพื่อดูข้อมูล</p>
            )}
          </Card>

          {/* Top Exposures */}
          <Card>
            <CardHeader><CardTitle>เลขเสี่ยงสูงสุด</CardTitle></CardHeader>
            {summary?.exposures?.length ? (
              <div className="space-y-2">
                {summary.exposures.slice(0, 8).map((exp, i) => (
                  <motion.div
                    key={`${exp.bet_type}:${exp.number}`}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.03 }}
                    className="flex items-center justify-between py-1.5 border-b border-border/30"
                  >
                    <div className="flex items-center gap-2">
                      <span className=" tracking-tight font-bold text-theme-text-primary text-base w-12 tracking-widest">
                        {exp.number}
                      </span>
                      <span className="text-xs text-theme-text-muted">{BET_TYPE_TH[exp.bet_type]}</span>
                    </div>
                    <span className={` tracking-tight text-sm font-semibold ${exp.net_pl >= 0 ? 'text-profit' : 'text-rose-400'}`}>
                      {exp.net_pl >= 0 ? '+' : ''}{formatBaht(exp.net_pl)}
                    </span>
                  </motion.div>
                ))}
              </div>
            ) : (
              <p className="text-center text-theme-text-muted text-sm py-8">เลือกงวดเพื่อดูข้อมูล</p>
            )}
          </Card>
        </div>

        {/* Rounds History Table */}
        <Card className="p-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <CardTitle>ประวัติงวดทั้งหมด</CardTitle>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-200/40">
                  {['งวด', 'วันออก', 'จำนวนโพย', 'ยอดรับ', 'สถานะ', 'ผลออก'].map((h) => (
                    <th key={h} className="text-left py-2.5 px-4 text-xs text-theme-text-muted font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rounds.map((round, i) => (
                  <tr key={round.id} className="border-b border-border/40 table-row-hover">
                    <td className="py-3 px-4 font-medium text-theme-text-primary">{round.name}</td>
                    <td className="py-3 px-4 text-theme-text-secondary  tracking-tight text-xs">
                      {new Date(round.draw_date).toLocaleDateString('th-TH')}
                    </td>
                    <td className="py-3 px-4  tracking-tight text-theme-text-secondary">
                      {(round.bet_count ?? 0).toLocaleString()}
                    </td>
                    <td className="py-3 px-4  tracking-tight text-profit">
                      {formatBaht(round.total_revenue ?? 0)}
                    </td>
                    <td className="py-3 px-4">
                      <RoundStatusBadge status={round.status} />
                    </td>
                    <td className="py-3 px-4  tracking-tight font-bold text-theme-text-primary text-lg tracking-widest">
                      {round.result_number ?? <span className="text-theme-text-muted text-xs font-normal">-</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}
