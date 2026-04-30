'use client';
import { useEffect, useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { Card, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Customer, Round } from '@/types';
import { useAuthStore } from '@/store/useStore';
import {
  authApi,
  customersApi,
  lineIntegrationApi,
  roundsApi,
  type LineIntegrationSettingsDto,
  type LineWebhookLogRow,
} from '@/lib/api';

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
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const [settings, setSettings] = useState<Settings>(defaultSettings());
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'general' | 'limits' | 'line'>('general');

  const [lineDto, setLineDto] = useState<LineIntegrationSettingsDto | null>(null);
  const [lineRounds, setLineRounds] = useState<Round[]>([]);
  const [lineCustomers, setLineCustomers] = useState<Customer[]>([]);
  const [lineUsers, setLineUsers] = useState<Array<{ id: string; username: string; role: string }>>([]);
  const [lineLogs, setLineLogs] = useState<LineWebhookLogRow[]>([]);
  const [lineLoading, setLineLoading] = useState(false);
  const [lineSaving, setLineSaving] = useState(false);
  const [lineSaved, setLineSaved] = useState(false);
  const [lineErr, setLineErr] = useState<string | null>(null);
  const [groupsText, setGroupsText] = useState('');

  const loadLine = useCallback(async () => {
    if (!isAdmin) return;
    setLineLoading(true);
    setLineErr(null);
    try {
      const [st, rr, cc, uu, lg] = await Promise.all([
        lineIntegrationApi.getSettings(),
        roundsApi.list(),
        customersApi.list(),
        authApi.listUsers(),
        lineIntegrationApi.getLogs(30),
      ]);
      const d = st.data;
      setLineDto(d);
      setGroupsText((d.allowed_group_ids ?? []).join('\n'));
      setLineRounds((rr.data as { rounds: Round[] }).rounds ?? []);
      setLineCustomers((cc.data as { customers: Customer[] }).customers ?? []);
      setLineUsers(
        (uu.data.users ?? []).filter((x) => x.is_active !== false && (x.role === 'admin' || x.role === 'operator')),
      );
      setLineLogs(lg.data.logs ?? []);
    } catch (e: unknown) {
      setLineErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    } finally {
      setLineLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => { setSettings(loadSettings()); }, []);

  useEffect(() => {
    if (tab === 'line' && isAdmin) void loadLine();
  }, [tab, isAdmin, loadLine]);

  const saveLine = async () => {
    if (!lineDto) return;
    setLineSaving(true);
    setLineErr(null);
    try {
      const allowed = groupsText
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const { data } = await lineIntegrationApi.patchSettings({
        webhook_enabled: lineDto.webhook_enabled,
        auto_import_enabled: lineDto.auto_import_enabled,
        target_round_id: lineDto.target_round_id,
        customer_id: lineDto.customer_id,
        sheet_no: lineDto.sheet_no,
        allowed_group_ids: allowed,
        actor_user_id: lineDto.actor_user_id,
      });
      setLineDto(data);
      setGroupsText((data.allowed_group_ids ?? []).join('\n'));
      const lg = await lineIntegrationApi.getLogs(30);
      setLineLogs(lg.data.logs ?? []);
      setLineSaved(true);
      setTimeout(() => setLineSaved(false), 2500);
    } catch (e: unknown) {
      setLineErr(e instanceof Error ? e.message : 'บันทึกไม่สำเร็จ');
    } finally {
      setLineSaving(false);
    }
  };

  const save = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setSaved(true);
    setTimeout(() => setSaved(false), 2500);
  };

  const tabItems = ([['general', 'ทั่วไป'], ['limits', 'ข้อจำกัด']] as [typeof tab, string][]) satisfies [typeof tab, string][];
  const tabsWithLine = isAdmin ? [...tabItems, ['line', 'รับไลน์ (Webhook)'] as [typeof tab, string]] : tabItems;

  return (
    <AppShell>
      <Header title="ตั้งค่าระบบ" subtitle="ปรับการตั้งค่าทั่วไปและอัตราจ่าย" />
      <main className="flex-1 overflow-auto p-5">
        <div className="max-w-3xl mx-auto space-y-5">

          {/* Tabs */}
          <div className="flex gap-1 border-b border-border pb-0 flex-wrap">
            {tabsWithLine.map(([k, label]) => (
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
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1.5">ชื่อระบบ</label>
                  <input value={settings.site_name}
                    onChange={e => setSettings(s => ({ ...s, site_name: e.target.value }))}
                    className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1.5">โซนเวลา</label>
                  <select value={settings.timezone}
                    onChange={e => setSettings(s => ({ ...s, timezone: e.target.value }))}
                    className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]">
                    <option value="Asia/Bangkok">Asia/Bangkok (UTC+7)</option>
                    <option value="Asia/Singapore">Asia/Singapore (UTC+8)</option>
                  </select>
                </div>
                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm text-theme-text-secondary">ปิดรับแทงอัตโนมัติเมื่อถึงงวด</p>
                    <p className="text-xs text-theme-text-muted">ระบบจะปิดงวดอัตโนมัติตามวันที่กำหนด</p>
                  </div>
                  <button onClick={() => setSettings(s => ({ ...s, auto_close_bets: !s.auto_close_bets }))}
                    className={`relative w-11 h-6 rounded-full transition-colors ${settings.auto_close_bets ? 'bg-accent' : 'bg-surface-300'}`}>
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
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1.5">จำนวนแทงขั้นต่ำ (บาท)</label>
                  <input type="number" min={1} value={settings.min_bet_amount}
                    onChange={e => setSettings(s => ({ ...s, min_bet_amount: parseFloat(e.target.value) || 1 }))}
                    className="w-48 h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm font-mono text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-theme-text-secondary mb-1.5">จำนวนแทงสูงสุดต่อครั้ง (บาท)</label>
                  <input type="number" min={1} value={settings.max_bet_amount}
                    onChange={e => setSettings(s => ({ ...s, max_bet_amount: parseFloat(e.target.value) || 100000 }))}
                    className="w-48 h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm font-mono text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]" />
                </div>
              </div>
            </Card>
          )}

          {tab === 'line' && isAdmin && (
            <Card>
              <CardHeader><CardTitle>รับข้อความจาก LINE (Messaging API)</CardTitle></CardHeader>
              <div className="px-5 pb-5 space-y-4 text-sm text-theme-text-secondary">
                <p className="text-xs text-theme-text-muted leading-relaxed">
                  เพิ่มบอทในกลุ่มไลน์ แล้วตั้ง Webhook URL เป็น <code className="text-accent/90 font-mono bg-surface-200 px-1 rounded">HTTPS://โดเมนของคุณ/api/line/webhook</code>
                  {' '}และใส่ Channel secret ในตัวแปรสภาพแวดล้อม <code className="font-mono bg-surface-200 px-1 rounded">LINE_CHANNEL_SECRET</code> ของเซิร์ฟเวอร์ API
                </p>
                {lineLoading && <p className="text-xs animate-pulse">กำลังโหลด…</p>}
                {lineErr && (
                  <div className="text-xs text-[var(--color-badge-danger-text)] bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2">
                    {lineErr}
                  </div>
                )}
                {lineDto && (
                  <>
                    <div className="flex items-center justify-between py-2 border-b border-border/80">
                      <div>
                        <p className="text-theme-text-primary font-medium">เปิดรับ Webhook</p>
                        <p className="text-xs text-theme-text-muted">ปิดเมื่อไม่ใช้งาน — ไลน์ยังยิงมาได้ แต่ระบบจะตอบ OK โดยไม่ประมวลผล</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLineDto((s) => (s ? { ...s, webhook_enabled: !s.webhook_enabled } : s))}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${lineDto.webhook_enabled ? 'bg-accent' : 'bg-surface-300'}`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-[var(--toggle-knob)] transition-transform shadow-sm ${lineDto.webhook_enabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    <div className={`flex items-center justify-between py-2 border-b border-border/80 ${!lineDto.webhook_enabled ? 'opacity-50 pointer-events-none' : ''}`}>
                      <div>
                        <p className="text-theme-text-primary font-medium">นำเข้าโพยอัตโนมัติ</p>
                        <p className="text-xs text-theme-text-muted">แปลงข้อความแชทด้วยตัวแปลงเดียวกับหน้ารับไลน์ — ต้องเลือกงวดและผู้ใช้ที่บันทึก</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setLineDto((s) => (s ? { ...s, auto_import_enabled: !s.auto_import_enabled } : s))}
                        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${lineDto.auto_import_enabled ? 'bg-accent' : 'bg-surface-300'}`}
                      >
                        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-[var(--toggle-knob)] transition-transform shadow-sm ${lineDto.auto_import_enabled ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
                      </button>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div>
                        <label className="block text-xs font-medium mb-1">งวดที่นำเข้า</label>
                        <select
                          value={lineDto.target_round_id ?? ''}
                          onChange={(e) =>
                            setLineDto((s) =>
                              s ? { ...s, target_round_id: e.target.value || null } : s,
                            )
                          }
                          className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                        >
                          <option value="">— เลือกงวด —</option>
                          {lineRounds.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name} ({r.status})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">ลูกค้า (ถ้ามี)</label>
                        <select
                          value={lineDto.customer_id ?? ''}
                          onChange={(e) =>
                            setLineDto((s) => (s ? { ...s, customer_id: e.target.value || null } : s))
                          }
                          className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                        >
                          <option value="">— ไม่ระบุ —</option>
                          {lineCustomers.filter((c) => c.is_active).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">เลขที่แผ่น</label>
                        <input
                          type="number"
                          min={1}
                          max={999}
                          value={lineDto.sheet_no}
                          onChange={(e) =>
                            setLineDto((s) =>
                              s ? { ...s, sheet_no: Math.min(999, Math.max(1, parseInt(e.target.value, 10) || 1)) } : s,
                            )
                          }
                          className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium mb-1">บันทึกในนาม (ผู้ใช้ระบบ)</label>
                        <select
                          value={lineDto.actor_user_id ?? ''}
                          onChange={(e) =>
                            setLineDto((s) => (s ? { ...s, actor_user_id: e.target.value || null } : s))
                          }
                          className="w-full h-10 rounded-lg bg-surface-200 border border-border px-3 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                        >
                          <option value="">— อัตโนมัติ (admin/operator คนแรก) —</option>
                          {lineUsers.map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.username} ({u.role})
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1">Group ID ที่อนุญาต (ว่าง = ทุกกลุ่ม)</label>
                      <textarea
                        value={groupsText}
                        onChange={(e) => setGroupsText(e.target.value)}
                        rows={3}
                        placeholder="Cxxxx... หนึ่งบรรทัดต่อหนึ่งกลุ่ม"
                        className="w-full rounded-lg bg-surface-200 border border-border px-3 py-2 text-xs font-mono text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]"
                      />
                    </div>
                    <div className="flex flex-wrap items-center gap-3 pt-1">
                      <Button type="button" onClick={() => void saveLine()} disabled={lineSaving}>
                        {lineSaving ? 'กำลังบันทึก…' : 'บันทึกการตั้งค่าไลน์'}
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void loadLine()} disabled={lineLoading}>
                        โหลดใหม่
                      </Button>
                      {lineSaved && (
                        <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm text-profit font-medium">
                          ✓ บันทึกแล้ว
                        </motion.span>
                      )}
                    </div>
                    <div className="pt-4 border-t border-border">
                      <p className="text-xs font-semibold text-theme-text-primary mb-2">ประวัติล่าสุด (เฉพาะข้อความที่ประมวลผล)</p>
                      <div className="max-h-56 overflow-y-auto rounded-lg border border-border text-xs">
                        <table className="w-full">
                          <thead className="bg-surface-200 sticky top-0">
                            <tr>
                              <th className="text-left py-2 px-2 font-medium text-theme-text-muted">เวลา</th>
                              <th className="text-left py-2 px-2 font-medium text-theme-text-muted">สถานะ</th>
                              <th className="text-right py-2 px-2 font-medium text-theme-text-muted">แทรก</th>
                              <th className="text-left py-2 px-2 font-medium text-theme-text-muted">ข้อความ</th>
                            </tr>
                          </thead>
                          <tbody>
                            {lineLogs.length === 0 ? (
                              <tr>
                                <td colSpan={4} className="py-6 text-center text-theme-text-muted">ยังไม่มี log</td>
                              </tr>
                            ) : (
                              lineLogs.map((row) => (
                                <tr key={row.id} className="border-t border-border/80">
                                  <td className="py-1.5 px-2 whitespace-nowrap text-theme-text-muted tabular-nums">
                                    {new Date(row.received_at).toLocaleString('th-TH', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                                  </td>
                                  <td className="py-1.5 px-2 font-mono">{row.status}</td>
                                  <td className="py-1.5 px-2 text-right tabular-nums">{row.inserted_count}</td>
                                  <td className="py-1.5 px-2 truncate max-w-[12rem]" title={row.text_preview ?? ''}>{row.text_preview}</td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </Card>
          )}

          {tab !== 'line' && (
            <div className="flex items-center gap-3">
              <Button onClick={save}>บันทึกการตั้งค่า</Button>
              {saved && (
                <motion.p initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
                  className="text-sm text-profit font-medium">
                  ✓ บันทึกสำเร็จ
                </motion.p>
              )}
            </div>
          )}
        </div>
      </main>
    </AppShell>
  );
}
