'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { roundsApi, betsApi } from '@/lib/api';
import { formatBaht } from '@/lib/utils';
import { BET_TYPE_LABELS } from '@/types';
import { parseLineBetsText } from '@/lib/betParser';

interface ParsedBet {
  number: string;
  bet_type: string;
  amount: number;
  raw: string;
}

function BetsImportInner() {
  const searchParams = useSearchParams();
  const [rounds, setRounds]   = useState<Array<{ id: string; name: string }>>([]);
  const [roundId, setRoundId] = useState(searchParams.get('round') ?? '');
  const [raw, setRaw]         = useState('');
  const [parsed, setParsed]   = useState<ParsedBet[]>([]);
  const [errors, setErrors]   = useState<string[]>([]);
  const [saving, setSaving]   = useState(false);
  const [saved, setSaved]     = useState(false);

  useEffect(() => {
    roundsApi.list().then(r => {
      setRounds(r.data.rounds ?? []);
      if (!roundId && r.data.rounds?.length) setRoundId(r.data.rounds[0].id);
    });
  }, []);

  const handleParse = useCallback(() => {
    const result = parseLineBetsText(raw);
    const bets: ParsedBet[] = result.bets.map(b => ({ ...b, raw: '' }));
    setParsed(bets);
    setErrors(result.skippedCount > 0 ? [`ข้ามไป ${result.skippedCount} บรรทัด (รูปแบบไม่ถูกต้อง)`] : []);
    setSaved(false);
  }, [raw]);

  const handleSave = async () => {
    if (!roundId || parsed.length === 0) return;
    setSaving(true);
    try {
      await betsApi.bulk(roundId, parsed.map(b => ({
        number: b.number,
        bet_type: b.bet_type,
        amount: b.amount,
      })));
      setSaved(true);
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
                <label className="text-xs text-slate-500 mb-1 block">เลือกงวด</label>
                <select value={roundId} onChange={e => setRoundId(e.target.value)}
                  className="w-full h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
                  {rounds.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </div>

              <div>
                <label className="text-xs text-slate-500 mb-1 block">
                  รูปแบบไลน์: <code className="text-accent/80">เลข=บนxล่าง</code> หรือ <code className="text-accent/80">เลข บราคา ตราคา</code>
                </label>
                <div className="text-[10px] text-slate-600 mb-2 space-y-0.5">
                  <p>ตัวอย่าง: <code>12=100×100</code> · <code>019=30*30</code> · <code>470 บ50 ต50</code> · <code>70=50-50</code></p>
                  <p>กลุ่ม: วางเลขแต่ละบรรทัด + บรรทัดสุดท้ายใส่ราคา (ใช้ราคาร่วมกัน)</p>
                </div>
                <textarea
                  value={raw}
                  onChange={e => { setRaw(e.target.value); setSaved(false); setParsed([]); }}
                  rows={18}
                  placeholder={'# ตัวอย่าง\n12=100×100\n470 บ50 ต50\n019=30*30'}
                  className="w-full rounded-xl bg-surface-200 border border-border px-4 py-3 text-sm font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent resize-none leading-relaxed"
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleParse} disabled={!raw.trim()}>ตรวจสอบข้อมูล</Button>
                {parsed.length > 0 && !saved && (
                  <Button variant="outline" onClick={handleSave} loading={saving} disabled={!roundId}>
                    บันทึก {parsed.length} รายการ
                  </Button>
                )}
              </div>

              {errors.length > 0 && (
                <div className="rounded-lg bg-rose-500/10 border border-rose-500/20 p-3 text-xs text-rose-400 space-y-1">
                  {errors.map((e, i) => <p key={i}>{e}</p>)}
                </div>
              )}
              {saved && (
                <p className="text-sm text-emerald-400 font-medium">✓ บันทึกสำเร็จ {parsed.length} รายการ</p>
              )}
            </div>
          </Card>

          {/* Right: preview */}
          <Card>
            <CardHeader>
              <CardTitle>ตรวจสอบก่อนบันทึก</CardTitle>
              {parsed.length > 0 && (
                <span className="text-xs text-slate-500">{parsed.length} รายการ · รวม {formatBaht(totalAmount)} บาท</span>
              )}
            </CardHeader>
            <div className="overflow-auto max-h-[calc(100vh-220px)]">
              {parsed.length === 0 ? (
                <div className="px-5 pb-5 text-sm text-slate-500 italic">กด "ตรวจสอบข้อมูล" เพื่อดูตัวอย่าง</div>
              ) : (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-surface-100 border-b border-border">
                    <tr>
                      {['เลข', 'ประเภท', 'ราคา'].map(h => (
                        <th key={h} className="py-2 px-4 text-left text-slate-500 font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {parsed.map((b, i) => (
                      <tr key={i} className={`border-b border-border/30 ${i % 2 === 0 ? '' : 'bg-surface-200/30'}`}>
                        <td className="py-1.5 px-4 font-mono font-bold text-slate-100 tracking-widest">{b.number}</td>
                        <td className="py-1.5 px-4 text-slate-400">{BET_TYPE_LABELS[b.bet_type as keyof typeof BET_TYPE_LABELS] ?? b.bet_type}</td>
                        <td className="py-1.5 px-4 font-mono text-emerald-400">{formatBaht(b.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="border-t border-border bg-surface-200">
                    <tr>
                      <td colSpan={2} className="py-2 px-4 text-xs text-slate-400 font-semibold text-right">รวม</td>
                      <td className="py-2 px-4 font-mono font-bold text-emerald-400">{formatBaht(totalAmount)}</td>
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
