'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { roundsApi } from '@/lib/api';

interface ResultData {
  prize_1st: string;
  prize_3top: string;
  tote_numbers: string[];
  tote_2d_numbers: string[];
  prize_3bottom: string[];
  prize_3front: string[];
  prize_2top: string;
  prize_2bottom: string;
  prize_1top: string;
  prize_1bottom: string;
}

function totePerms(num: string): string[] {
  if (num.length !== 3) return [];
  const d = num.split('');
  const set = new Set<string>();
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) {
    if (i !== j && j !== k && i !== k) set.add(d[i] + d[j] + d[k]);
  }
  return Array.from(set).sort();
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50 last:border-b-0">
      <span className="w-28 text-sm text-slate-400 shrink-0">{label}</span>
      <div className="flex-1 h-8 rounded bg-surface-300 border border-border px-2 flex items-center text-sm font-mono text-slate-300 select-none">
        {value || <span className="text-slate-600">—</span>}
      </div>
    </div>
  );
}

function EditField({ label, value, onChange, maxLen, placeholder }: {
  label: string; value: string; onChange: (v: string) => void;
  maxLen?: number; placeholder?: string;
}) {
  return (
    <div className="flex items-center gap-3 py-2 border-b border-border/50">
      <span className="w-28 text-sm text-slate-400 shrink-0">{label}</span>
      <input
        type="text"
        inputMode="numeric"
        maxLength={maxLen}
        value={value}
        onChange={e => onChange(e.target.value.replace(/\D/g, ''))}
        placeholder={placeholder}
        className="flex-1 h-8 rounded bg-surface-300 border border-accent/50 focus:border-accent px-2 text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-accent/40"
      />
    </div>
  );
}

function ResultsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [rounds, setRounds] = useState<Array<{ id: string; name: string; status: string }>>([]);
  const [roundId, setRoundId] = useState(searchParams.get('round') ?? '');
  const [prize1st, setPrize1st] = useState('');
  const [bot3, setBot3]         = useState<[string,string,string,string]>(['','','','']);
  const [bot2, setBot2]         = useState('');
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState('');
  const [saved, setSaved]       = useState(false);

  const top3  = prize1st.length >= 3 ? prize1st.slice(-3) : '';
  const top2  = top3.length === 3 ? top3.slice(-2) : '';
  const run1T = top3.length === 3 ? top3.split('').join(' , ') : '';
  const tote3 = top3.length === 3 ? totePerms(top3) : [];

  const fetchRounds = useCallback(async () => {
    try {
      const res = await roundsApi.list();
      setRounds(res.data.rounds ?? []);
      if (!roundId && res.data.rounds?.length) {
        // prefer open/closed round (for entering new results), fall back to first
        const active = res.data.rounds.find(
          (r: { status: string }) => r.status !== 'drawn' && r.status !== 'archived'
        ) ?? res.data.rounds[0];
        setRoundId(active.id);
      }
    } catch { /* ignore */ }
  }, [roundId]);

  const loadStoredResult = useCallback(async () => {
    if (!roundId) return;
    try {
      const res = await roundsApi.getResult(roundId);
      const rd = res.data?.result_data as ResultData | null;
      if (rd) {
        setPrize1st(rd.prize_1st ?? rd.prize_3top ?? '');
        const b3 = rd.prize_3bottom ?? [];
        setBot3([b3[0]??'', b3[1]??'', b3[2]??'', b3[3]??''] as [string,string,string,string]);
        setBot2(rd.prize_2bottom ?? '');
        setSaved(true);
      } else {
        setPrize1st(''); setBot3(['','','','']); setBot2(''); setSaved(false);
      }
    } catch { /* no result yet */ }
  }, [roundId]);

  useEffect(() => { fetchRounds(); }, []);
  useEffect(() => { loadStoredResult(); }, [roundId]);

  const handleSave = async () => {
    if (!roundId) { setError('กรุณาเลือกงวด'); return; }
    if (top3.length !== 3) { setError('กรุณากรอกรางวัลที่ 1 ให้ครบอย่างน้อย 3 หลัก'); return; }
    if (bot2.length !== 2) { setError('กรุณากรอก 2 ตัวล่าง (2 หลัก)'); return; }
    const bot3List = bot3.filter(s => s.length === 3);
    setError('');
    setSaving(true);
    try {
      await roundsApi.submitResult(roundId, {
        result_prize_1st: prize1st.length === 6 ? prize1st : undefined,
        result_3top: top3,
        result_2bottom: bot2,
        result_3bottom: bot3List,
      });
      setSaved(true);
      await fetchRounds();
    } catch (e: unknown) {
      const msg =
        (e as { response?: { data?: { message?: string } } })?.response?.data?.message ??
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        'เกิดข้อผิดพลาด';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (!roundId) { setPrize1st(''); setBot3(['','','','']); setBot2(''); setSaved(false); setError(''); return; }
    if (!confirm('รีเซ็ตผลสลาก? งวดจะกลับสู่สถานะปิด และข้อมูลสรุปผลจะถูกล้าง')) return;
    try {
      await roundsApi.resetResult(roundId);
      setPrize1st(''); setBot3(['','','','']); setBot2(''); setSaved(false); setError('');
      await fetchRounds();
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'รีเซ็ตไม่สำเร็จ';
      setError(msg);
    }
  };

  const round = rounds.find(r => r.id === roundId);

  return (
    <AppShell>
      <Header title="ใส่ผลสลาก" subtitle="กรอกผลรางวัลและคำนวณยอดจ่าย" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-xl mx-auto space-y-4">

          {/* Round selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <label className="text-sm text-slate-400">งวด:</label>
            <select
              value={roundId}
              onChange={e => { setRoundId(e.target.value); setSaved(false); }}
              className="h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">-- เลือกงวด --</option>
              {rounds.map(r => (
                <option key={r.id} value={r.id}>{r.name}{(r.status === 'drawn' || r.status === 'archived') ? ' ✓' : ''}</option>
              ))}
            </select>
            {saved && (
              <Button onClick={() => router.push(`/summary?round=${roundId}`)}>
                ดูสรุปผล →
              </Button>
            )}
          </div>

          {/* Prize entry card */}
          <Card className="p-0 overflow-hidden">
            <div className="px-5 pt-4 pb-3 border-b border-border">
              <CardTitle>ผลสลาก</CardTitle>
            </div>
            <div className="px-5 py-4">

              {/* รางวัลที่ 1 */}
              <div className="flex items-center gap-3 py-2 border-b border-border/50">
                <span className="w-28 text-sm text-accent shrink-0 font-semibold">รางวัลที่ 1</span>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  value={prize1st}
                  onChange={e => setPrize1st(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="เช่น 292514"
                  className="flex-1 h-9 rounded bg-surface-300 border-2 border-accent px-2 text-base font-mono font-bold tracking-[0.3em] text-white placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-accent/40"
                />
              </div>

              <ReadOnly label="3 ตัวบน"  value={top3} />
              <ReadOnly label="3 ตัวโต็ด" value={tote3.join(' , ')} />
              {/* 3 ตัวล่าง — 4 ช่องแยก */}
              <div className="flex items-center gap-3 py-2 border-b border-border/50">
                <span className="w-28 text-sm text-slate-400 shrink-0">3 ตัวล่าง</span>
                <div className="flex gap-2">
                  {bot3.map((v, i) => (
                    <input key={i} type="text" inputMode="numeric" maxLength={3}
                      value={v}
                      onChange={e => {
                        const n = [...bot3] as typeof bot3;
                        n[i] = e.target.value.replace(/\D/g, '').slice(0, 3);
                        setBot3(n);
                      }}
                      placeholder="000"
                      className="w-14 h-8 rounded bg-surface-300 border border-accent/50 focus:border-accent text-center text-sm font-mono text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-accent/40"
                    />
                  ))}
                </div>
              </div>
              <ReadOnly label="2 ตัวบน"  value={top2} />
              <EditField label="2 ตัวล่าง" value={bot2} onChange={setBot2} maxLen={2}
                placeholder="เช่น 47" />
              <ReadOnly label="วิ่งบน"  value={run1T} />
              <ReadOnly label="วิ่งล่าง" value={bot2.length === 2 ? bot2.split('').join(' , ') : ''} />

              {error && (
                <p className="mt-3 text-sm text-rose-400 bg-rose-500/10 rounded px-3 py-2">{error}</p>
              )}

              <div className="flex gap-3 justify-center pt-5 pb-1">
                <Button
                  onClick={handleSave}
                  disabled={saving || !roundId || top3.length !== 3 || bot2.length !== 2}
                  loading={saving}
                >
                  บันทึกผลสลาก
                </Button>
                <Button
                  variant="outline"
                  onClick={handleReset}
                >
                  รีเซ็ต
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { if (saved && roundId) router.push(`/summary?round=${roundId}`); else router.push('/'); }}
                >
                  จบการทำงาน
                </Button>
              </div>
            </div>
          </Card>

          {saved && (round?.status === 'drawn' || round?.status === 'archived') && (
            <p className="text-center text-sm text-emerald-400">
              ✓ บันทึกผลสลากแล้ว —{' '}
              <button
                onClick={() => router.push(`/summary?round=${roundId}`)}
                className="underline text-accent hover:text-accent-hover"
              >
                คลิกดูสรุปผล
              </button>
            </p>
          )}
        </div>
      </main>
    </AppShell>
  );
}

export default function ResultsPage() {
  return <Suspense><ResultsPageInner /></Suspense>;
}
