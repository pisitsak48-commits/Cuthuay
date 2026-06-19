'use client';
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

const SETTINGS_KEY = 'cuthuay_settings';

interface Settings {
  site_name: string;
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
    site_name: 'AuraX',
    max_bet_amount: 100000,
    min_bet_amount: 1,
    auto_close_bets: false,
    timezone: 'Asia/Bangkok',
  };
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'general' | 'limits'>('general');

  useEffect(() => { setSettings(loadSettings()); }, []);

  const save = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const tabItems = ([['general', 'ทั่วไป'], ['limits', 'ข้อจำกัด']] as [typeof tab, string][]) satisfies [typeof tab, string][];

  return (
    <AppShell>
      <Header title="ตั้งค่าระบบ" subtitle="ปรับการตั้งค่าทั่วไปและอัตราจ่าย" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border pb-0 flex-wrap">
            {tabItems.map(([k, label]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                  tab === k ? 'border-accent text-accent' : 'border-transparent text-theme-text-muted hover:text-theme-text-secondary'
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
                  <label htmlFor="setting-site-name" className="block text-xs font-medium text-theme-text-secondary mb-1.5">ชื่อระบบ</label>
                  <input id="setting-site-name" value={settings.site_name}
                    onChange={e => setSettings(s => ({ ...s, site_name: e.target.value }))}
                    className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
                <div>
                  <label htmlFor="setting-timezone" className="block text-xs font-medium text-theme-text-secondary mb-1.5">โซนเวลา</label>
                  <select id="setting-timezone" value={settings.timezone}
                    onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}
                    className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
                    <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                    <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p id="auto-close-label" className="text-sm text-theme-text-secondary">ปิดรับแทงอัตโนมัติเมื่อถึงงวด</p>
                    <p className="text-xs text-theme-text-muted">ระบบจะปิดงวดอัตโนมัติตามวันที่กำหนด</p>
                  </div>
                  <button
                    role="switch"
                    aria-checked={settings.auto_close_bets}
                    aria-labelledby="auto-close-label"
                    onClick={() => setSettings(s => ({ ...s, auto_close_bets: !s.auto_close_bets }))}
                    className={`relative w-11 h-6 rounded-full transition-colors ${settings.auto_close_bets ? 'bg-accent' : 'bg-surface-300'}`}
                  >
                    <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-[var(--toggle-knob)] transition-transform shadow-sm ${settings.auto_close_bets ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                  </button>
                </div>
              </div>
            </Card>
          )}

          {tab === 'limits' && (
            <Card>
              <CardHeader><CardTitle>ข้อจำกัดการแทง</CardTitle></CardHeader>
              <div className="px-5 pb-5 space-y-4">
                <div>
                  <label htmlFor="setting-min-bet" className="block text-xs font-medium text-theme-text-secondary mb-1.5">จำนวนแทงขั้นต่ำ (บาท)</label>
                  <input id="setting-min-bet" type="number" min={1} value={settings.min_bet_amount}
                    onChange={e => setSettings(s => ({ ...s, min_bet_amount: parseFloat(e.target.value) || 1 }))}
                    className="w-48 h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm tabular-nums tracking-tight text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
                <div>
                  <label htmlFor="setting-max-bet" className="block text-xs font-medium text-theme-text-secondary mb-1.5">จำนวนแทงสูงสุดต่อครั้ง (บาท)</label>
                  <input id="setting-max-bet" type="number" min={1} value={settings.max_bet_amount}
                    onChange={e => setSettings(s => ({ ...s, max_bet_amount: parseFloat(e.target.value) || 100000 }))}
                    className="w-48 h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm tracking-tight text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
              </div>
            </Card>
          )}

          <div className="flex items-center gap-3">
            <Button onClick={save}>บันทึกการตั้งค่า</Button>
            {saved && (
              <motion.p role="status" aria-live="polite" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                className="text-sm text-profit font-medium">
                ✓ บันทึกสำเร็จ
              </motion.p>
            )}
          </div>
        </div>
      </main>
    </AppShell>
  );
}
