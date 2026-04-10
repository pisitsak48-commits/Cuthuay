'use client';
import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { RoundStatusBadge } from '@/components/ui/Badge';
import { roundsApi, dealersApi } from '@/lib/api';
import { formatBaht } from '@/lib/utils';
import { Round, Dealer } from '@/types';

export default function RoundsPage() {
  const router = useRouter();
  const [rounds, setRounds] = useState<Round[]>([]);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Create round modal state
  const [showCreate, setShowCreate] = useState(false);
  const [newDate, setNewDate] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');

  const fetchData = useCallback(async () => {
    try {
      const [rRes, dRes] = await Promise.all([roundsApi.list(), dealersApi.list()]);
      setRounds(rRes.data.rounds);
      setDealers(dRes.data.dealers);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleDealerChange = async (roundId: string, dealerId: string) => {
    setSavingId(roundId);
    try {
      await roundsApi.setDealer(roundId, dealerId || null);
      setRounds((prev) =>
        prev.map((r) => {
          if (r.id !== roundId) return r;
          const d = dealers.find((x) => x.id === dealerId);
          return { ...r, dealer_id: dealerId || null, dealer_name: d?.name ?? null };
        })
      );
    } finally {
      setSavingId(null);
    }
  };

  const handleStatusChange = async (round: Round, status: string) => {
    setSavingId(round.id);
    try {
      await roundsApi.updateStatus(round.id, status);
      setRounds((prev) => prev.map((r) => (r.id === round.id ? { ...r, status: status as Round['status'] } : r)));
    } catch (err: any) {
      alert('เปลี่ยนสถานะไม่สำเร็จ: ' + (err?.response?.data?.message ?? err?.message ?? 'error'));
    } finally {
      setSavingId(null);
    }
  };

  const handleCreate = async () => {
    if (!newDate) return;
    const d = new Date(newDate + 'T12:00:00');
    const name = d.toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' });
    setCreating(true);
    setCreateError('');
    try {
      await roundsApi.create({ name, draw_date: newDate });
      setNewDate('');
      setShowCreate(false);
      await fetchData();
    } catch (err: any) {
      setCreateError(err?.response?.data?.message ?? err?.message ?? 'เกิดข้อผิดพลาด');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (round: Round) => {
    if (!confirm(`ลบงวด "${round.name}" และโพยทั้งหมดในงวดนี้? ไม่สามารถกู้คืนได้`)) return;
    setDeletingId(round.id);
    try {
      await roundsApi.delete(round.id);
      setRounds(prev => prev.filter(r => r.id !== round.id));
    } catch (err: any) {
      alert('ลบไม่สำเร็จ: ' + (err?.response?.data?.message ?? err?.message ?? 'error'));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <AppShell>
      <Header title="จัดการงวด" subtitle="กำหนดเจ้ามือและสถานะงวด" />
      <main className="flex-1 p-6 space-y-5">
        <div className="flex justify-end">
          <Button onClick={() => setShowCreate((v) => !v)}>+ สร้างงวดใหม่</Button>
        </div>

        {showCreate && (
          <Card className="p-5">
            <CardTitle className="mb-4">สร้างงวดใหม่</CardTitle>
            <div className="flex flex-wrap gap-3 items-end">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-slate-500 uppercase tracking-wider">วันออกรางวัล</label>
                <input
                  type="date"
                  className="h-9 rounded-lg bg-surface-300 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                />
                {newDate && (
                  <span className="text-xs text-slate-500 mt-0.5">
                    ชื่องวด: {new Date(newDate + 'T12:00:00').toLocaleDateString('th-TH', { day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                )}
              </div>
              <Button onClick={handleCreate} loading={creating} disabled={!newDate}>บันทึก</Button>
              <Button variant="ghost" onClick={() => setShowCreate(false)}>ยกเลิก</Button>
            </div>
            {createError && (
              <p className="mt-2 text-sm text-rose-400 bg-rose-500/10 rounded px-3 py-2">{createError}</p>
            )}
          </Card>
        )}

        <Card className="p-0 overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <CardTitle>รายการงวดทั้งหมด</CardTitle>
          </div>
          {loading ? (
            <div className="p-5 space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-10 rounded-lg bg-surface-200 animate-pulse" />
              ))}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-200/40">
                    {['งวด', 'วันออก', 'โพย', 'ยอดรับ', 'สถานะ', 'เจ้ามือ', 'จัดการ', ''].map((h, i) => (
                      <th key={i} className="text-left py-2 px-4 text-xs text-slate-500 font-medium uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rounds.map((round, i) => (
                    <motion.tr
                      key={round.id}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.03 }}
                      className="border-b border-border/40 table-row-hover"
                    >
                      <td className="py-3 px-4 font-medium text-slate-200">{round.name}</td>
                      <td className="py-3 px-4 text-slate-400 font-mono text-xs">
                        {new Date(round.draw_date).toLocaleDateString('th-TH')}
                      </td>
                      <td className="py-3 px-4 font-mono text-slate-300">
                        {(round.bet_count ?? 0).toLocaleString()}
                      </td>
                      <td className="py-3 px-4 font-mono text-emerald-400">
                        {formatBaht(round.total_revenue ?? 0)}
                      </td>
                      <td className="py-3 px-4">
                        <RoundStatusBadge status={round.status} />
                      </td>
                      <td className="py-3 px-4">
                        <select
                          value={round.dealer_id ?? ''}
                          onChange={(e) => handleDealerChange(round.id, e.target.value)}
                          disabled={savingId === round.id}
                          className="h-8 rounded-lg bg-surface-300 border border-border px-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent disabled:opacity-50"
                        >
                          <option value="">-- ไม่ระบุ --</option>
                          {dealers.map((d) => (
                            <option key={d.id} value={d.id}>{d.name}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          {round.status === 'closed' && (
                            <Button size="sm" variant="ghost" disabled={savingId === round.id} onClick={() => handleStatusChange(round, 'open')}>เปิด</Button>
                          )}
                          {round.status === 'open' && (
                            <Button size="sm" variant="ghost" disabled={savingId === round.id} onClick={() => handleStatusChange(round, 'closed')}>ปิด</Button>
                          )}
                          {round.status === 'drawn' && (
                            <Button size="sm" variant="ghost" disabled={savingId === round.id}
                              onClick={() => handleStatusChange(round, 'archived')}
                              className="text-slate-500 hover:text-slate-300">
                              ซ่อน
                            </Button>
                          )}
                          {round.status === 'archived' && (
                            <Button size="sm" variant="outline" disabled={savingId === round.id}
                              onClick={() => handleStatusChange(round, 'drawn')}>
                              แสดง
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => router.push(`/bets?round=${round.id}`)}>โพย</Button>
                          {(round.status === 'drawn' || round.status === 'archived') && (
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/results?round=${round.id}`)}>ผล</Button>
                          )}
                          {(round.status === 'drawn' || round.status === 'archived') && (
                            <Button size="sm" variant="ghost" onClick={() => router.push(`/summary?round=${round.id}`)}>สรุป</Button>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <button
                          onClick={() => handleDelete(round)}
                          disabled={deletingId === round.id}
                          title="ลบงวดนี้"
                          className="h-7 w-7 flex items-center justify-center rounded text-slate-600 hover:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 transition-colors text-sm"
                        >
                          {deletingId === round.id ? '…' : '✕'}
                        </button>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
              {!rounds.length && (
                <p className="text-center text-slate-600 py-8 text-sm">ยังไม่มีงวด</p>
              )}
            </div>
          )}
        </Card>
      </main>
    </AppShell>
  );
}
