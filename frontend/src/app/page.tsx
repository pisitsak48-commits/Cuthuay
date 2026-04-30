'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { StatCard } from '@/components/ui/StatCard';
import { RoundStatusBadge } from '@/components/ui/Badge';
import { RiskDistributionChart } from '@/components/charts/RiskChart';
import { ProfitLossChart } from '@/components/charts/ProfitLossChart';
import { reportsApi } from '@/lib/api';
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
      <main className="flex-1 space-y-8 p-6 sm:p-8">
        {/* KPI Row */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6">
          <StatCard label="งวดที่เปิดอยู่"   value={openRounds}     format="number"  index={0} />
          <StatCard label="ยอดรับรวม (เปิด)" value={totalRevenue}   format="baht"    index={1} colorOverride="text-profit" />
          <StatCard label="โพยที่รับทั้งหมด" value={totalBets}       format="number"  index={2} />
          <StatCard label="งวดทั้งหมด"       value={stats?.recent_rounds?.length ?? 0} format="number" index={3} />
        </div>

        {/* Charts Row */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="glass-card p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-bold text-theme-text-primary">P&amp;L ย้อนหลัง</div>
            </div>
            <ProfitLossChart rounds={stats?.recent_rounds ?? []} />
          </div>
          <div className="glass-card p-6 flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="text-lg font-bold text-theme-text-primary">การกระจายความเสี่ยง</div>
            </div>
            <RiskDistributionChart rounds={stats?.recent_rounds ?? []} />
          </div>
        </div>

        {/* Recent Rounds Table */}
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="text-lg font-bold text-theme-text-primary">งวดล่าสุด</div>
            <Link href="/bets">
              <button
                type="button"
                className="rounded-2xl border border-theme-card-border bg-[var(--bg-glass-subtle)] px-4 py-2 text-sm font-semibold text-theme-text-primary transition-[border-color,background-color,box-shadow] duration-200 [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))] hover:border-[var(--color-border-strong)] hover:bg-[var(--bg-hover)] hover:shadow-[var(--shadow-soft)]"
              >
                ดูทั้งหมด
              </button>
            </Link>
          </div>
          {loading ? (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 rounded-card bg-[var(--bg-glass-subtle)] animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full overflow-hidden rounded-card border border-theme-card-border bg-[var(--bg-glass-subtle)]">
                <thead className="bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)]">
                  <tr>
                    {['งวด', 'วันออก', 'โพย', 'ยอดรับ', 'สถานะ', ''].map((h) => (
                      <th key={h} className="px-4 py-2 text-left text-xs font-semibold uppercase tracking-wider text-theme-text-secondary">
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
                      transition={{ delay: i * 0.04, duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      className="table-row-hover border-b border-[var(--color-border)]"
                    >
                      <td className="px-4 py-2 font-medium text-theme-text-primary">{round.name}</td>
                      <td className="px-4 py-2 font-mono text-xs text-theme-text-muted">
                        {new Date(round.draw_date).toLocaleDateString('th-TH')}
                      </td>
                      <td className="px-4 py-2 font-mono text-theme-text-muted">
                        {(round.bet_count ?? 0).toLocaleString()}
                      </td>
                      <td className="px-4 py-2 font-mono text-profit">
                        {formatBaht(round.total_revenue ?? 0)}
                      </td>
                      <td className="px-4 py-2">
                        <RoundStatusBadge status={round.status} />
                      </td>
                      <td className="px-4 py-2">
                        <Link href={`/cut?round=${round.id}`}>
                          <button type="button" className="btn-primary-glow px-3 py-1.5 text-xs rounded-2xl">วิเคราะห์</button>
                        </Link>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {!stats?.recent_rounds?.length && (
                <p className="text-center py-8 text-sm text-theme-text-muted">ยังไม่มีข้อมูลงวด</p>
              )}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
