'use client';
import dynamic from 'next/dynamic';
import { useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { StatCard } from '@/components/ui/StatCard';
import { RoundStatusBadge } from '@/components/ui/Badge';
import type { RoundProfitExtra } from '@/components/charts/ProfitLossChart';
import { useDashboardQuery } from '@/hooks/queries/useDashboardQuery';
import { wsClient } from '@/lib/websocket';
import { buddhistEraYearFromDrawDate, formatBaht } from '@/lib/utils';
import { Round } from '@/types';
import Link from 'next/link';

const RiskDistributionChart = dynamic(
  () => import('@/components/charts/RiskChart').then((m) => m.RiskDistributionChart),
  { ssr: false, loading: () => <div className="h-48 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" /> },
);
const ProfitLossChart = dynamic(
  () => import('@/components/charts/ProfitLossChart').then((m) => m.ProfitLossChart),
  { ssr: false, loading: () => <div className="h-56 animate-pulse rounded-xl bg-[var(--color-surface-muted)]" /> },
);

// ─── Icons ────────────────────────────────────────────────────────────────────
function IconLock() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 11V7a4 4 0 118 0v4M5 11h14v10H5z" />
    </svg>
  );
}
function IconBaht() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}
function IconReceipt() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}
function IconCalendar() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
  );
}
function IconTrend() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}
function IconRisk() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
    </svg>
  );
}

// ─── Skeleton row ─────────────────────────────────────────────────────────────
function SkeletonRows({ n = 4 }: { n?: number }) {
  return (
    <div className="space-y-2 p-4">
      {Array.from({ length: n }).map((_, i) => (
        <div key={i} className="h-10 rounded-xl bg-[var(--gray-100)] animate-pulse" style={{ opacity: 1 - i * 0.15 }} />
      ))}
    </div>
  );
}

// ─── Section card header ──────────────────────────────────────────────────────
function CardHeader({
  icon, title, accent = 'blue', trailing,
}: {
  icon: React.ReactNode;
  title: string;
  accent?: 'blue' | 'green';
  trailing?: React.ReactNode;
}) {
  const dot = accent === 'green'
    ? 'bg-emerald-500 shadow-[0_0_6px_rgba(52,211,153,0.6)]'
    : 'bg-blue-500 shadow-[0_0_6px_rgba(74,144,226,0.6)]';
  const iconBg = accent === 'green'
    ? 'bg-emerald-500/10 text-emerald-600'
    : 'bg-blue-500/10 text-blue-600';
  return (
    <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border)]">
      <div className="flex items-center gap-3">
        <div className={`rounded-xl p-2 ${iconBg}`}>{icon}</div>
        <div>
          <p className="text-sm font-bold text-theme-text-primary tracking-tight leading-tight">{title}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className={`inline-block w-1.5 h-1.5 rounded-full ${dot}`} />
            <span className="text-[11px] text-theme-text-muted font-medium tracking-wide uppercase">Live</span>
          </div>
        </div>
      </div>
      {trailing}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { data: stats, isLoading: loading, refetch } = useDashboardQuery();
  const profitByRoundId = (stats?.profit_by_round ?? {}) as Record<string, RoundProfitExtra>;

  useEffect(() => {
    const unsub = wsClient.on('*', () => { void refetch(); });
    return () => unsub();
  }, [refetch]);

  const yearProfitBanner = useMemo(() => {
    if (!stats?.recent_rounds?.length || !Object.keys(profitByRoundId).length) return null;
    const buckets = new Map<number, { total: number; n: number }>();
    const currentBE = new Date().getFullYear() + 543;
    for (const r of stats.recent_rounds) {
      if (r.status !== 'drawn') continue;
      const extra = profitByRoundId[r.id];
      if (!extra) continue;
      const be = buddhistEraYearFromDrawDate(r.draw_date);
      const prev = buckets.get(be) ?? { total: 0, n: 0 };
      buckets.set(be, { total: prev.total + extra.profit, n: prev.n + 1 });
    }
    const prefer = buckets.get(currentBE);
    if (prefer && prefer.n > 0) return { beYear: currentBE, ...prefer };
    const sorted = [...buckets.entries()].sort((a, b) => b[0] - a[0]);
    const pick = sorted[0];
    if (!pick) return null;
    return { beYear: pick[0], total: pick[1].total, n: pick[1].n };
  }, [stats?.recent_rounds, profitByRoundId]);

  const openRounds  = stats?.round_stats?.find((r) => r.status === 'open')?.count ?? 0;
  const totalRevenue = parseFloat(String(stats?.active_bets?.total_revenue ?? 0));
  const totalBets   = parseInt(String(stats?.active_bets?.total_bets ?? 0));
  const totalRounds = stats?.recent_rounds?.length ?? 0;

  return (
    <AppShell>
      <Header title="Dashboard" subtitle="ภาพรวมระบบรับแทงหวย" />

      <main className="flex-1 space-y-5 px-4 pb-6 sm:px-6 sm:pb-8 pt-4">

        {/* ── KPI row ── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="งวดที่เปิดอยู่"
            value={openRounds}
            format="number"
            accent="blue"
            icon={<IconLock />}
            subLabel="งวดที่กำลังรับแทงอยู่"
            index={0}
          />
          <StatCard
            label="ยอดรับรวม (เปิด)"
            value={totalRevenue}
            format="baht"
            accent="green"
            icon={<IconBaht />}
            colorOverride="text-profit"
            subLabel="ยอดรับรวมทุกโพยที่เปิด"
            index={1}
          />
          <StatCard
            label="โพยที่รับทั้งหมด"
            value={totalBets}
            format="number"
            accent="violet"
            icon={<IconReceipt />}
            subLabel="จำนวนโพยในงวดเปิด"
            index={2}
          />
          <StatCard
            label="งวดทั้งหมด"
            value={totalRounds}
            format="number"
            accent="amber"
            icon={<IconCalendar />}
            subLabel="งวดทั้งหมดในระบบ"
            index={3}
          />
        </div>

        {yearProfitBanner && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="rounded-2xl border border-[var(--color-border)]/70 bg-gradient-to-r from-[var(--color-card-bg-solid)] via-white to-[var(--bg-glass-subtle)] shadow-[var(--shadow-soft)] px-4 py-3 sm:px-5 sm:py-3.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2"
          >
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-theme-text-muted">สรุปกำไรรวมทั้งปี (งวดที่ออกผลแล้ว)</p>
              <p className="text-sm font-bold text-theme-text-primary mt-0.5">
                พ.ศ. {yearProfitBanner.beYear}
                <span className="font-normal text-theme-text-muted font-medium ml-2">
                  {yearProfitBanner.n} งวดที่มีข้อมูลกำไร (ในงวดล่าสุดที่แดชบอร์ดแสดง)
                </span>
              </p>
            </div>
            <p className={`text-xl sm:text-2xl font-bold tabular-nums tracking-tight shrink-0 ${yearProfitBanner.total >= 0 ? 'text-profit' : 'text-loss'}`}>
              {yearProfitBanner.total >= 0 ? '+' : ''}{formatBaht(yearProfitBanner.total)}
            </p>
          </motion.div>
        )}

        {/* ── Charts row ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card overflow-hidden flex flex-col">
            <CardHeader icon={<IconTrend />} title="ยอดขาย · กำไร · % เทียบขาย" accent="blue" />
            <div className="p-4 flex-1">
              <ProfitLossChart
                rounds={stats?.recent_rounds ?? []}
                profitByRoundId={profitByRoundId}
                loadingProfit={false}
              />
            </div>
          </div>

          <div className="glass-card overflow-hidden flex flex-col">
            <CardHeader icon={<IconRisk />} title="ยอดขายเทียบกำไรต่องวด" accent="green" />
            <div className="p-4 flex-1">
              <RiskDistributionChart rounds={stats?.recent_rounds ?? []} profitByRoundId={profitByRoundId} />
            </div>
          </div>
        </div>

        {/* ── Recent rounds ── */}
        <div className="glass-card overflow-hidden">
          <CardHeader
            icon={<IconCalendar />}
            title="งวดล่าสุด"
            trailing={
              <Link href="/rounds">
                <button
                  type="button"
                  className="btn-primary-glow px-4 py-1.5 text-xs rounded-full"
                >
                  ดูทั้งหมด
                </button>
              </Link>
            }
          />

          {loading ? (
            <SkeletonRows n={4} />
          ) : !stats?.recent_rounds?.length ? (
            <div className="py-12 text-center text-sm text-theme-text-muted">ยังไม่มีข้อมูลงวด</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)]">
                  <tr>
                    {[
                      { label: 'งวด',    cls: 'text-left  pl-5' },
                      { label: 'วันออก', cls: 'text-left' },
                      { label: 'โพย',    cls: 'text-right' },
                      { label: 'ยอดรับ', cls: 'text-right' },
                      { label: 'สถานะ',  cls: 'text-left' },
                      { label: '',       cls: 'text-right pr-5' },
                    ].map((h) => (
                      <th
                        key={h.label}
                        className={`py-2.5 px-3 text-[11px] font-semibold uppercase tracking-wider text-theme-text-secondary ${h.cls}`}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stats.recent_rounds.map((round: Round, i: number) => (
                    <tr
                      key={round.id}
                      className={`table-row-hover border-b border-[var(--color-border)]/60 last:border-b-0 ${
                        i % 2 === 0 ? '' : 'bg-[var(--bg-glass-subtle)]/50'
                      }`}
                    >
                      <td className="py-3 pl-5 pr-3 font-semibold text-theme-text-primary whitespace-nowrap">
                        {round.name}
                      </td>
                      <td className="py-3 px-3 tabular-nums text-xs text-theme-text-muted whitespace-nowrap">
                        {new Date(round.draw_date).toLocaleDateString('th-TH', {
                          day: 'numeric', month: 'short', year: '2-digit',
                        })}
                      </td>
                      <td className="py-3 px-3 tabular-nums text-right text-theme-text-secondary font-medium">
                        {(round.bet_count ?? 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-3 tabular-nums text-right font-semibold text-profit whitespace-nowrap">
                        {formatBaht(round.total_revenue ?? 0)}
                      </td>
                      <td className="py-3 px-3">
                        <RoundStatusBadge status={round.status} />
                      </td>
                      <td className="py-3 pl-3 pr-5 text-right">
                        <Link href={`/cut?round=${round.id}`}>
                          <button
                            type="button"
                            className="btn-primary-glow px-3.5 py-1.5 text-xs rounded-full"
                          >
                            วิเคราะห์
                          </button>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>
    </AppShell>
  );
}
