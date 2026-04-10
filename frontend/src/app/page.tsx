'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { RoundStatusBadge, RiskBadge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { RiskDistributionChart } from '@/components/charts/RiskChart';
import { ProfitLossChart } from '@/components/charts/ProfitLossChart';
import { reportsApi, roundsApi } from '@/lib/api';
import { wsClient } from '@/lib/websocket';
import { formatBaht } from '@/lib/utils';
import { DashboardStats, Round } from '@/types';
import Link from 'next/link';

export default function DashboardPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchStats = useCallback(async () => {
    try {
      const res = await reportsApi.dashboard();
      setStats(res.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const unsub = wsClient.on('*', () => fetchStats());
    return () => unsub();
  }, [fetchStats]);

  const openRounds = stats?.round_stats?.find((r) => r.status === 'open')?.count ?? 0;
  const totalRevenue = parseFloat(String(stats?.active_bets?.total_revenue ?? 0));
  const totalBets = parseInt(String(stats?.active_bets?.total_bets ?? 0));

  return (
    <AppShell>
      <Header title="Dashboard" subtitle="ภาพรวมระบบรับแทงหวย" />

      <main className="flex-1 p-6 space-y-6">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="งวดที่เปิดอยู่"   value={openRounds}     format="number"  index={0} />
          <StatCard label="ยอดรับรวม (เปิด)" value={totalRevenue}   format="baht"    index={1} colorOverride="text-emerald-400" />
          <StatCard label="โพยที่รับทั้งหมด" value={totalBets}       format="number"  index={2} />
          <StatCard label="งวดทั้งหมด"       value={stats?.recent_rounds?.length ?? 0} format="number" index={3} />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <CardHeader>
              <CardTitle>P&amp;L ย้อนหลัง</CardTitle>
            </CardHeader>
            <ProfitLossChart rounds={stats?.recent_rounds ?? []} />
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>การกระจายความเสี่ยง</CardTitle>
            </CardHeader>
            <RiskDistributionChart rounds={stats?.recent_rounds ?? []} />
          </Card>
        </div>

        {/* Recent Rounds Table */}
        <Card>
          <CardHeader>
            <CardTitle>งวดล่าสุด</CardTitle>
            <Link href="/bets">
              <Button variant="ghost" size="sm">ดูทั้งหมด</Button>
            </Link>
          </CardHeader>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-surface-200 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    {['งวด', 'วันออก', 'โพย', 'ยอดรับ', 'สถานะ', ''].map((h) => (
                      <th key={h} className="text-left py-2 px-3 text-xs text-slate-500 font-medium uppercase tracking-wider">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(stats?.recent_rounds ?? []).map((round: Round, i: number) => (
                    <motion.tr
                      key={round.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.04 }}
                      className="border-b border-border/50 table-row-hover"
                    >
                      <td className="py-3 px-3 font-medium text-slate-200">{round.name}</td>
                      <td className="py-3 px-3 text-slate-400 font-mono text-xs">
                        {new Date(round.draw_date).toLocaleDateString('th-TH')}
                      </td>
                      <td className="py-3 px-3 font-mono text-slate-300">
                        {(round.bet_count ?? 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-3 font-mono text-emerald-400">
                        {formatBaht(round.total_revenue ?? 0)}
                      </td>
                      <td className="py-3 px-3">
                        <RoundStatusBadge status={round.status} />
                      </td>
                      <td className="py-3 px-3">
                        <Link href={`/cut?round=${round.id}`}>
                          <Button variant="ghost" size="sm">วิเคราะห์</Button>
                        </Link>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {!stats?.recent_rounds?.length && (
                <p className="text-center text-slate-600 py-8 text-sm">ยังไม่มีข้อมูลงวด</p>
              )}
            </div>
          )}
        </Card>
      </main>
    </AppShell>
  );
}
