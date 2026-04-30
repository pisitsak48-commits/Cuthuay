'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { roundsApi, betsApi } from '@/lib/api';
import { playBlockedNumber, playError, isBlockedBetApiMessage } from '@/lib/sounds';
import { formatBaht } from '@/lib/utils';
import { BET_TYPE_LABELS, Round } from '@/types';
import { parseLineBetsTextWithSegments } from '@/lib/betParser';
import { useAuthStore } from '@/store/useStore';

interface ParsedBet {
  number: string;
  bet_type: string;
  amount: number;
  segment_index?: number;
  raw: string;
}

function BetsImportInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const roundFromUrl = searchParams.get('round') ?? '';
  const { user, _hasHydrated } = useAuthStore();
  const [rounds, setRounds]   = useState<Array<{ id: string; name: string }>>([]);
  const [roundId, setRoundId] = useState(searchParams.get('round') ?? '');
  const [raw, setRaw]         = useState('');
  const [parsed, setParsed]   = useState<ParsedBet[]>([]);
  const [errors, setErrors]   = useState<string[]>([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);
  const [lastInserted, setLastInserted] = useState(0);

  useEffect(() => {
    if (!_hasHydrated) return;
    if (user?.role !== 'admin') {
      router.replace('/bets');
      return;
    }
    roundsApi.list().then(r => {
      const full: Round[] = r.data.rounds ?? [];
      setRounds(full.map(({ id, name }: Round) => ({ id, name })));
      setRoundId((prev) => {
        if (prev && full.some((x: Round) => x.id === prev)) return prev;
        if (roundFromUrl && full.some((x: Round) => x.id === roundFromUrl)) return roundFromUrl;
        return full[0]?.id ?? '';
      });
    });
  }, [_hasHydrated, user?.role, router, roundFromUrl]);

  const handleParse = useCallback(() => {
    const result = parseLineBetsTextWithSegments(raw);
    const bets: ParsedBet[] = result.bets.map(b => ({ ...b, raw: '' }));
    setParsed(bets);
    setErrors(result.skippedCount > 0 ? [`ข้ามไป ${result.skippedCount} บรรทัด (รูปแบบไม่ถูกต้อง)`] : []);
    setSaved(false);
    setLastInserted(0);
  }, [raw]);

  const handleSave = async () => {
    if (!roundId || parsed.length === 0) return;
    setSaving(true);
    setErrors([]);
    try {
      const importBatchId =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `imp-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const res = await betsApi.bulk(roundId, parsed.map(b => ({
        number: b.number,
        bet_type: b.bet_type,
        amount: b.amount,
        import_batch_id: importBatchId,
        segment_index: b.segment_index ?? 1,
      })));
      const { inserted = 0, errors: apiErrors = [] } = res.data as { inserted: number; errors: string[] };
      const blocked = apiErrors.filter(isBlockedBetApiMessage);
      if (blocked.length) playBlockedNumber();
      else if (inserted === 0 && apiErrors.length) playError();
      if (apiErrors.length) setErrors(apiErrors);
      setLastInserted(inserted);
      setSaved(inserted > 0);
    } catch {
      playError();
      setErrors(['บันทึกไม่สำเร็จ']);
      setSaved(false);
      setLastInserted(0);
    } finally {
      setSaving(false);
    }
  };

  const totalAmount = parsed.reduce((s, b) => s + b.amount, 0);

  return (
    <AppShell>
      <Header title="รับไฟล์ข้อมูลการขาย" subtitle="นำเข้าข้อมูลโพยจากไฟล์หรือวางข้อความ" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* Left: input */}
          <Card>
            <CardHeader><CardTitle>วางข้อมูล</CardTitle></CardHeader>
            <div className="px-5 pb-5 space-y-4">
              <div>
                <label className="text-xs text-theme-text-muted mb-1 block">เลือกงวด</label>
                <select value={roundId} onChange={e => setRoundId(e.target.value)}
                  className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
                  {rounds.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-theme-text-muted mb-1 block">
                  รูปแบบไลน์: <code className="text-accent/80">เลข=บนxล่าง</code> หรือ <code className="text-accent/80">เลข บราคา ตราคา</code>
                </label>
                <div className="text-[10px] text-theme-text-muted mb-2 space-y-0.5">
                  <p>ตัวอย่าง: <code>12=100×100</code> · <code>019=30*30</code> · <code>470 บ50 ต50</code> · <code>70=50-50</code></p>
                  <p>กลุ่ม: วางเลขแต่ละบรรทัด + บรรทัดสุดท้ายใส่ราคา (ใช้ราคาร่วมกัน)</p>
                </div>
                <textarea
                  value={raw}
                  onChange={e => { setRaw(e.target.value); setSaved(false); setParsed([]); setLastInserted(0); }}
                  rows={18}
                  placeholder={'# ตัวอย่าง\n12=100×100\n470 บ50 ต50\n019=30*30'}
                  className="w-full rounded-xl bg-surface-200 border border-border px-4 py-3 text-sm font-mono text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] resize-none leading-relaxed"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={handleParse} disabled={!raw.trim()}>ตรวจสอบข้อมูล</Button>
                <button
                  type="button"
                  onClick={() => { setRaw(''); setParsed([]); setErrors([]); setSaved(false); setLastInserted(0); }}
                  disabled={!raw.trim()}
                  className="text-xs px-3 py-2 h-10 rounded-xl border border-border bg-surface-200/70 text-theme-text-muted hover:text-theme-text-primary hover:bg-[var(--bg-hover)] disabled:opacity-35 disabled:cursor-not-allowed font-medium transition-colors"
                >
                  เคลียร์ข้อความ
                </button>
                {parsed.length > 0 && !saved && (
                  <Button variant="outline" onClick={handleSave} loading={saving} disabled={!roundId}>
                    บันทึก {parsed.length} รายการ
                  </Button>
                )}
              </div>

              {errors.length > 0 && (
                <div className="rounded-lg bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] p-3 text-xs text-[var(--color-badge-danger-text)] space-y-1">
                  {errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
              {saved && (
                <div className="text-sm text-profit font-medium space-y-1">
                  <p>✓ บันทึก {lastInserted} รายการ</p>
                  {lastInserted < parsed.length && (
                    <p className="text-xs font-normal text-theme-text-secondary">บางรายการไม่เข้า — ดูข้อความด้านบน (เช่น เลขปิดรับ)</p>
                  )}
                </div>
              )}
            </div>
          </Card>

          {/* Right: preview */}
          <Card>
            <CardHeader>
              <CardTitle>ตรวจสอบก่อนบันทึก</CardTitle>
              {parsed.length > 0 && (
                <span className="text-xs text-theme-text-muted">{parsed.length} รายการ · รวม {formatBaht(totalAmount)} บาท</span>
              )}
            </CardHeader>
            <div className="overflow-auto max-h-[calc(100vh-220px)]">
              {parsed.length === 0 ? (
                <div className="px-5 pb-5 text-sm text-theme-text-muted italic">กด "ตรวจสอบข้อมูล" เพื่อดูตัวอย่าง</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-100 border-b border-border">
                    <tr>
                      {['เลข', 'ประเภท', 'ราคา'].map(h => (
                        <th key={h} className="py-2 px-4 text-left text-theme-text-muted font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((b, i) => (
                      <tr key={i} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-surface-200/30'}`}>
                        <td className="py-1.5 px-4 font-mono font-bold text-theme-text-primary tracking-widest">{b.number}</td>
                        <td className="py-1.5 px-4 text-theme-text-secondary">{BET_TYPE_LABELS[b.bet_type as keyof typeof BET_TYPE_LABELS] ?? b.bet_type}</td>
                        <td className="py-1.5 px-4 font-mono text-profit">{formatBaht(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border bg-surface-200">
                    <tr>
                      <td colSpan={2} className="py-2 px-4 text-xs text-theme-text-secondary font-semibold text-right">รวม</td>
                      <td className="py-2 px-4 font-mono font-bold text-profit">{formatBaht(totalAmount)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          </Card>
        </div>
      </main>
    </AppShell>
  );
}

export default function BetsImportPage() {
  return <Suspense><BetsImportInner /></Suspense>;
}
