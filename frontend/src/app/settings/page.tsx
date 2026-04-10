'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { DEFAULT_PAYOUT_RATES, BET_TYPE_LABELS, BetType } from '@/types';

const BET_TYPES: BetType[] = [
  '3digit_top', '3digit_tote', '3digit_back',
  '2digit_top', '2digit_bottom', '1digit_top', '1digit_bottom',
];

const SETTINGS_KEY = 'cuthuay_settings';

interface Settings {
  site_name: string;
  default_payout_rates: Record<string, number>;
  max_bet_amount: number;
  min_bet_amount: number;
  auto_close_bets: boolean;
  timezone: string;
}

function loadSettings(): Settings {
  if (typeof window === 'undefined') return defaultSettings();
  try { return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') }; } catch { return defaultSettings(); }
}

function defaultSettings(): Settings {
  return {
    site_name: 'CutHuay',
    default_payout_rates: { ...DEFAULT_PAYOUT_RATES },
    max_bet_amount: 100000,
    min_bet_amount: 1,
    auto_close_bets: false,
    timezone: 'Asia/Bangkok',
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'general' | 'payout' | 'limits'>('general');

  useEffect(() => { setSettings(loadSettings()); }, []);

  const save = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const updateRate = (type: string, val: string) => {
    const num = parseFloat(val);
    if (isNaN(num)) return;
    setSettings(s => ({
      ...s,
      default_payout_rates: { ...s.default_payout_rates, [type]: num },
    }));
  };

  return (
    <AppShell>
      <Header title="ตั้งค่าระบบ" subtitle="ปรับการตั้งค่าทั่วไปและอัตราจ่าย" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border pb-0">
            {([['general', 'ทั่วไป'], ['payout', 'อัตราจ่าย'], ['limits', 'ข้อจำกัด']] as [typeof tab, string][]).map(([k, label]) => (
              <button key={k} onClick={() => setTab(k)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === k ? 'border-accent text-accent' : 'border-transparent text-slate-500 hover:text-slate-300'
                }`}>
                {label}
              </button>
            ))}
          </div>

          {tab === 'general' && (
            <Card>
              <CardHeader><CardTitle>ตั้งค่าทั่วไป</CardTitle></CardHeader>
              <div className="px-5 pb-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">ชื่อระบบ</label>
                  <input value={settings.site_name}
                    onChange={e => setSettings(s => ({ ...s, site_name: e.target.value }))}
                    className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">โซนเวลา</label>
                  <select value={settings.timezone}
                    onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}
                    className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent">
                    <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                    <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm text-slate-300">ปิดรับแทงอัตโนมัติเมื่อถึงงวด</p>
                    <p className="text-xs text-slate-500">ระบบจะปิดงวดอัตโนมัติตามวันที่กำหนด</p>
                  </div>
                  <button onClick={() => setSettings(s => ({ ...s, auto_close_bets: !s.auto_close_bets }))}
                    className={`relative w-11 h-6 rounded-full transition-colors ${settings.auto_close_bets ? 'bg-accent' : 'bg-surface-300'}`}>
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm ${settings.auto_close_bets ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
            </Card>
          )}

          {tab === 'payout' && (
            <Card>
              <CardHeader><CardTitle>อัตราจ่ายเริ่มต้น</CardTitle></CardHeader>
              <div className="px-5 pb-5">
                <p className="text-xs text-slate-500 mb-4">กำหนดอัตราจ่ายมาตรฐาน (ลูกค้าแต่ละคนสามารถตั้งค่าเองได้)</p>
                <div className="space-y-3">
                  {BET_TYPES.map(bt => (
                    <div key={bt} className="flex items-center justify-between gap-4">
                      <label className="text-sm text-slate-300 w-32 shrink-0">{BET_TYPE_LABELS[bt]}</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="number" min={1} max={1000} step={0.5}
                          value={settings.default_payout_rates[bt] ?? DEFAULT_PAYOUT_RATES[bt]}
                          onChange={e => updateRate(bt, e.target.value)}
                          className="w-28 h-9 rounded-lg bg-surface-200 border border-border px-3 text-sm font-mono text-slate-200 text-right focus:outline-none focus:ring-1 focus:ring-accent"
                        />
                        <span className="text-xs text-slate-500">บาท / บาท</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Card>
          )}

          {tab === 'limits' && (
            <Card>
              <CardHeader><CardTitle>ข้อจำกัดการแทง</CardTitle></CardHeader>
              <div className="px-5 pb-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">จำนวนแทงขั้นต่ำ (บาท)</label>
                  <input type="number" min={1} value={settings.min_bet_amount}
                    onChange={e => setSettings(s => ({ ...s, min_bet_amount: parseFloat(e.target.value) || 1 }))}
                    className="w-48 h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1.5">จำนวนแทงสูงสุดต่อครั้ง (บาท)</label>
                  <input type="number" min={1} value={settings.max_bet_amount}
                    onChange={e => setSettings(s => ({ ...s, max_bet_amount: parseFloat(e.target.value) || 100000 }))}
                    className="w-48 h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm font-mono text-slate-200 focus:outline-none focus:ring-1 focus:ring-accent" />
                </div>
              </div>
            </Card>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save}>บันทึกการตั้งค่า</Button>
            {saved && (
              <motion.p initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="text-sm text-emerald-400 font-medium">
                ✓ บันทึกสำเร็จ
              </motion.p>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
