'use client';
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AxiosError } from 'axios';
import { customersApi, dealersApi } from '@/lib/api';
import { useAuthStore } from '@/store/useStore';
import { Customer, Dealer, DEFAULT_PAYOUT_RATES } from '@/types';
import { AppShell } from '@/components/layout/AppShell';

// ─── Shared bet-type rows (customer rate key + dealer pct/rate keys) ──────────
const BET_TYPES = [
  { label: '3 ตัวบน',   cKey: 'rate_3top',    dPctKey: 'pct_3top',    dRateKey: 'rate_3top',    def: DEFAULT_PAYOUT_RATES['3digit_top']    },
  { label: '3 ตัวโต็ด', cKey: 'rate_3tote',   dPctKey: 'pct_3tote',   dRateKey: 'rate_3tote',   def: DEFAULT_PAYOUT_RATES['3digit_tote']   },
  { label: '3 ตัวล่าง', cKey: 'rate_3back',   dPctKey: 'pct_3back',   dRateKey: 'rate_3back',   def: DEFAULT_PAYOUT_RATES['3digit_back']   },
  { label: '2 ตัวบน',   cKey: 'rate_2top',    dPctKey: 'pct_2top',    dRateKey: 'rate_2top',    def: DEFAULT_PAYOUT_RATES['2digit_top']    },
  { label: '2 ตัวล่าง', cKey: 'rate_2bottom', dPctKey: 'pct_2bottom', dRateKey: 'rate_2bottom', def: DEFAULT_PAYOUT_RATES['2digit_bottom'] },
  { label: 'วิ่งบน',    cKey: 'rate_1top',    dPctKey: 'pct_1top',    dRateKey: 'rate_1top',    def: DEFAULT_PAYOUT_RATES['1digit_top']    },
  { label: 'วิ่งล่าง',  cKey: 'rate_1bottom', dPctKey: 'pct_1bottom', dRateKey: 'rate_1bottom', def: DEFAULT_PAYOUT_RATES['1digit_bottom'] },
] as const;

// ─── Shared styles ────────────────────────────────────────────────────────────
const inputCls  = 'w-full h-7 rounded bg-surface-default border border-border px-2 text-xs text-theme-text-primary text-right placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] font-mono';
const fieldCls  = 'w-full h-8 rounded bg-surface-200 border border-border px-3 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)]';
const labelCls  = 'text-xs text-theme-text-secondary block mb-1';
const secTitle  = 'text-[10px] text-theme-text-muted uppercase tracking-widest font-semibold mb-2';
const btnSave = 'btn-toolbar-glow btn-toolbar-profit flex-1 !h-8 text-xs rounded-2xl justify-center';
const btnCancel = 'btn-toolbar-glow btn-toolbar-muted flex-1 !h-8 text-xs rounded-2xl justify-center';
const btnExport = 'btn-toolbar-glow btn-fintech-search !h-8 px-3 text-[11px] justify-center';
const btnExportAll = 'btn-toolbar-glow btn-fintech-spark !h-8 px-3 text-[11px] justify-center';
const btnImport = 'btn-toolbar-glow btn-toolbar-profit !h-8 px-3 text-[11px] justify-center';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Trim .00 trailing decimals for display. null/0 → '—' */
function fmtNum(v: number | string | null | undefined, showZeroAsDash = true): string {
  if (v == null) return '—';
  const n = parseFloat(String(v));
  if (isNaN(n)) return '—';
  if (showZeroAsDash && n === 0) return '—';
  return n % 1 === 0 ? String(Math.round(n)) : String(n);
}
/** Trim .00 for form inputs. null → fallback */
function fmtForm(v: number | string | null | undefined, fallback = ''): string {
  if (v == null) return fallback;
  const n = parseFloat(String(v));
  if (isNaN(n)) return fallback;
  return n % 1 === 0 ? String(Math.round(n)) : String(n);
}
// ─── CUSTOMER section ─────────────────────────────────────────────────────────
interface CForm {
  name: string; note: string;
  pct_3top: string; pct_3tote: string; pct_3back: string;
  pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
  rate_3top: string; rate_3tote: string; rate_3back: string;
  rate_2top: string; rate_2bottom: string; rate_1top: string; rate_1bottom: string;
}
const EMPTY_CFORM: CForm = {
  name: '', note: '',
  pct_3top: '0', pct_3tote: '0', pct_3back: '0',
  pct_2top: '0', pct_2bottom: '0', pct_1top: '0', pct_1bottom: '0',
  rate_3top: '', rate_3tote: '', rate_3back: '',
  rate_2top: '', rate_2bottom: '', rate_1top: '', rate_1bottom: '',
};
function cToForm(c: Customer): CForm {
  return {
    name: c.name, note: c.note ?? '',
    pct_3top:    fmtForm(c.pct_3top,    '0'),
    pct_3tote:   fmtForm(c.pct_3tote,   '0'),
    pct_3back:   fmtForm(c.pct_3back,   '0'),
    pct_2top:    fmtForm(c.pct_2top,    '0'),
    pct_2bottom: fmtForm(c.pct_2bottom, '0'),
    pct_1top:    fmtForm(c.pct_1top,    '0'),
    pct_1bottom: fmtForm(c.pct_1bottom, '0'),
    rate_3top:    fmtForm(c.rate_3top),
    rate_3tote:   fmtForm(c.rate_3tote),
    rate_3back:   fmtForm(c.rate_3back),
    rate_2top:    fmtForm(c.rate_2top),
    rate_2bottom: fmtForm(c.rate_2bottom),
    rate_1top:    fmtForm(c.rate_1top),
    rate_1bottom: fmtForm(c.rate_1bottom),
  };
}
function cFormToPayload(f: CForm): Record<string, unknown> {
  const n = (v: string) => v.trim() === '' ? null : parseInt(v, 10);
  const p = (v: string) => parseFloat(v) || 0;
  return {
    name: f.name.trim(), note: f.note.trim() || null,
    commission_rate: 0, commission_rate_run: 0,
    pct_3top:    p(f.pct_3top),    pct_3tote:   p(f.pct_3tote),   pct_3back:   p(f.pct_3back),
    pct_2top:    p(f.pct_2top),    pct_2bottom: p(f.pct_2bottom),
    pct_1top:    p(f.pct_1top),    pct_1bottom: p(f.pct_1bottom),
    rate_3top: n(f.rate_3top), rate_3tote: n(f.rate_3tote), rate_3back: n(f.rate_3back),
    rate_2top: n(f.rate_2top), rate_2bottom: n(f.rate_2bottom),
    rate_1top: n(f.rate_1top), rate_1bottom: n(f.rate_1bottom),
  };
}

function CustomerSection({ reloadToken = 0 }: { reloadToken?: number }) {
  const [list, setList]       = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [edit, setEdit]       = useState<Customer | null>(null);
  const [form, setForm]       = useState<CForm>(EMPTY_CFORM);
  const [error, setError]     = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try { const r = await customersApi.list(); setList(r.data.customers); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchList(); }, [fetchList, reloadToken]);

  const set = (k: keyof CForm, v: string) => setForm(p => ({ ...p, [k]: v }));
  const startEdit = (c: Customer) => { setEdit(c); setForm(cToForm(c)); setError(''); };
  const startNew  = () => { setEdit(null); setForm(EMPTY_CFORM); setError(''); };
  const startCopy = (c: Customer) => { setEdit(null); setForm({ ...cToForm(c), name: '' }); setError(''); };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('กรุณากรอกชื่อลูกค้า'); return; }
    setSaving(true); setError('');
    try {
      const p = cFormToPayload(form);
      if (edit) await customersApi.update(edit.id, p);
      else      await customersApi.create(p);
      await fetchList(); startNew();
    } catch { setError('บันทึกไม่สำเร็จ'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ลบลูกค้านี้?')) return;
    try { await customersApi.delete(id); await fetchList(); if (edit?.id === id) startNew(); }
    catch { setError('ลบไม่สำเร็จ'); }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Form */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col bg-surface-100/50 h-full">
              <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between">
               <div>
                  <p className="text-base font-semibold text-theme-text-primary tracking-tight">
                    {edit ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}
                  </p>
                  <p className="text-[11px] text-theme-text-muted mt-0.5">
                      ตั้งค่าอัตราจ่ายและเปอร์เซ็นต์
                  </p>
                </div>
                  {edit && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
                  Editing
                  </span>
                )}
      </div>
        <div className="p-3 space-y-2.5 overflow-y-auto">
          <div>
            <label className={labelCls}>ชื่อลูกค้า <span className="text-loss">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ชื่อ หรือ รหัส" className={fieldCls} />
          </div>
          <div>
            <p className={secTitle}>อัตราจ่ายและเปอร์เซ็นต์</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                <th className="text-left py-1 text-theme-text-muted font-normal">ประเภท</th>
                <th className="text-center py-1 text-theme-text-muted font-normal w-16">ลด %</th>
                <th className="text-center py-1 text-theme-text-muted font-normal w-20">อัตราจ่าย</th>
              </tr></thead>
              <tbody>
                {BET_TYPES.map(row => (
                  <tr key={row.dPctKey} className="border-b border-border/40">
                    <td className="py-1 text-theme-text-secondary">{row.label}</td>
                    <td className="py-1 px-1">
                      <input type="text" inputMode="decimal"
                        value={form[row.dPctKey as keyof CForm]}
                        onChange={e => set(row.dPctKey as keyof CForm, e.target.value.replace(/[^0-9.]/g, ''))}
                        className={inputCls} />
                    </td>
                    <td className="py-1 px-1">
                      <input type="text" inputMode="numeric"
                        value={form[row.cKey as keyof CForm]}
                        onChange={e => set(row.cKey as keyof CForm, e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder={String(row.def)}
                        className={inputCls} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <label className={labelCls}>หมายเหตุ</label>
            <textarea value={form.note} onChange={e => set('note', e.target.value)} rows={2} placeholder="หมายเหตุ..."
              className="w-full rounded bg-surface-200 border border-border px-3 py-1.5 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] resize-none" />
          </div>
          {error && <p className="text-xs text-loss">{error}</p>}
        </div>
        <div className="p-3 border-t border-border flex gap-2 shrink-0">
          {edit && <button onClick={startNew} className={btnCancel}>ใหม่</button>}
          <button onClick={handleSave} disabled={saving} className={btnSave}>
            {saving ? 'กำลังบันทึก...' : edit ? 'อัปเดต' : 'เพิ่มลูกค้า'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center gap-3">
          <span className="text-theme-text-secondary text-xs font-semibold">รายชื่อลูกค้า</span>
          <span className="text-theme-text-muted text-xs">{list.length} ราย</span>
        </div>
        <div className="flex-1 overflow-auto">
          {loading
            ? <div className="p-6 text-center text-theme-text-muted text-xs">กำลังโหลด...</div>
            : list.length === 0
              ? <div className="p-6 text-center text-theme-text-muted text-xs">ยังไม่มีลูกค้า</div>
              : (
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="sticky top-0 bg-surface-50 border-b border-[var(--color-border)]">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-theme-text-muted font-normal">ชื่อ</th>
                      {BET_TYPES.map(t => (
                        <th key={'p'+t.dPctKey} className="text-right py-2 px-1 text-theme-text-muted font-normal text-[10px]">
                          %{t.label.replace('3 ตัวบน','3บ').replace('3 ตัวโต็ด','3ต').replace('3 ตัวล่าง','3ล').replace('2 ตัวบน','2บ').replace('2 ตัวล่าง','2ล').replace('วิ่งบน','วบ').replace('วิ่งล่าง','วล')}
                        </th>
                      ))}
                      {BET_TYPES.map(t => (
                        <th key={'r'+t.cKey} className="text-right py-2 px-2 text-theme-text-muted font-normal">
                          {t.label.replace('3 ตัวบน','3บน').replace('3 ตัวโต็ด','โต็ด').replace('3 ตัวล่าง','3ล่าง').replace('2 ตัวบน','2บน').replace('2 ตัวล่าง','2ล่าง')}
                        </th>
                      ))}
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(c => (
                      <tr key={c.id} onClick={() => startEdit(c)}
                        className={`border-b border-border/40 cursor-pointer hover:bg-surface-200/30 ${edit?.id === c.id ? 'bg-accent/10' : ''}`}>
                        <td className="py-1.5 px-3 text-theme-text-primary font-medium">{c.name}</td>
                        {BET_TYPES.map(t => {
                          const val = (c as unknown as Record<string, number | string | null>)[t.dPctKey];
                          const n = val != null ? parseFloat(String(val)) : null;
                          return (
                            <td key={'p'+t.dPctKey} className="py-1.5 px-1 text-right font-mono text-theme-text-secondary">
                              {n != null && n > 0 ? fmtNum(n) : <span className="text-theme-text-muted">—</span>}
                            </td>
                          );
                        })}
                        {BET_TYPES.map(t => {
                          const val = (c as unknown as Record<string, number | string | null>)[t.cKey];
                          const n = val != null ? parseFloat(String(val)) : null;
                          return (
                            <td key={'r'+t.cKey} className="py-1.5 px-2 text-right font-mono">
                              {n != null && n > 0
                                ? <span className="text-risk-medium font-semibold">{fmtNum(n, false)}</span>
                                : <span className="text-theme-text-muted">—</span>}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          <button onClick={e => { e.stopPropagation(); startCopy(c); }}
                            title="คัดลอกเป็นรายการใหม่"
                            className="text-theme-text-muted hover:text-accent text-xs mr-2">⎘</button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                            className="text-theme-text-muted hover:text-loss text-base leading-none">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
      </div>
    </div>
  );
}

// ─── DEALER section ───────────────────────────────────────────────────────────
interface DForm {
  name: string; sender_name: string; keep_net_pct: string;
  pct_3top: string; pct_3tote: string; pct_3back: string;
  pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
  rate_3top: string; rate_3tote: string; rate_3back: string;
  rate_2top: string; rate_2bottom: string; rate_1top: string; rate_1bottom: string;
}
const EMPTY_DFORM: DForm = {
  name: '', sender_name: '', keep_net_pct: '100',
  pct_3top: '0', pct_3tote: '0', pct_3back: '0',
  pct_2top: '0', pct_2bottom: '0', pct_1top: '0', pct_1bottom: '0',
  rate_3top: '', rate_3tote: '', rate_3back: '',
  rate_2top: '', rate_2bottom: '', rate_1top: '', rate_1bottom: '',
};
function dToForm(d: Dealer): DForm {
  return {
    name: d.name, sender_name: d.sender_name ?? '', keep_net_pct: fmtForm(d.keep_net_pct, '100'),
    pct_3top:    fmtForm(d.pct_3top,    '0'),
    pct_3tote:   fmtForm(d.pct_3tote,   '0'),
    pct_3back:   fmtForm(d.pct_3back,   '0'),
    pct_2top:    fmtForm(d.pct_2top,    '0'),
    pct_2bottom: fmtForm(d.pct_2bottom, '0'),
    pct_1top:    fmtForm(d.pct_1top,    '0'),
    pct_1bottom: fmtForm(d.pct_1bottom, '0'),
    rate_3top:    fmtForm(d.rate_3top),
    rate_3tote:   fmtForm(d.rate_3tote),
    rate_3back:   fmtForm(d.rate_3back),
    rate_2top:    fmtForm(d.rate_2top),
    rate_2bottom: fmtForm(d.rate_2bottom),
    rate_1top:    fmtForm(d.rate_1top),
    rate_1bottom: fmtForm(d.rate_1bottom),
  };
}
function dFormToPayload(f: DForm): Record<string, unknown> {
  const n = (v: string) => v.trim() === '' ? null : parseInt(v, 10);
  return {
    name: f.name.trim(), sender_name: f.sender_name.trim() || null,
    keep_net_pct: parseFloat(f.keep_net_pct) || 100,
    pct_3top:    parseFloat(f.pct_3top)    || 0,
    pct_3tote:   parseFloat(f.pct_3tote)   || 0,
    pct_3back:   parseFloat(f.pct_3back)   || 0,
    pct_2top:    parseFloat(f.pct_2top)    || 0,
    pct_2bottom: parseFloat(f.pct_2bottom) || 0,
    pct_1top:    parseFloat(f.pct_1top)    || 0,
    pct_1bottom: parseFloat(f.pct_1bottom) || 0,
    rate_3top: n(f.rate_3top), rate_3tote: n(f.rate_3tote), rate_3back: n(f.rate_3back),
    rate_2top: n(f.rate_2top), rate_2bottom: n(f.rate_2bottom),
    rate_1top: n(f.rate_1top), rate_1bottom: n(f.rate_1bottom),
  };
}

function DealerSection({ reloadToken = 0 }: { reloadToken?: number }) {
  const [list, setList]       = useState<Dealer[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving]   = useState(false);
  const [edit, setEdit]       = useState<Dealer | null>(null);
  const [form, setForm]       = useState<DForm>(EMPTY_DFORM);
  const [error, setError]     = useState('');

  const fetchList = useCallback(async () => {
    setLoading(true);
    try { const r = await dealersApi.list(); setList(r.data.dealers); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchList(); }, [fetchList, reloadToken]);

  const set = (k: keyof DForm, v: string) => setForm(p => ({ ...p, [k]: v }));
  const startEdit = (d: Dealer) => { setEdit(d); setForm(dToForm(d)); setError(''); };
  const startNew  = () => { setEdit(null); setForm(EMPTY_DFORM); setError(''); };
  const startCopy = (d: Dealer) => { setEdit(null); setForm({ ...dToForm(d), name: '' }); setError(''); };

  const handleSave = async () => {
    if (!form.name.trim()) { setError('กรุณากรอกชื่อเจ้ามือ'); return; }
    setSaving(true); setError('');
    try {
      const p = dFormToPayload(form);
      if (edit) await dealersApi.update(edit.id, p);
      else      await dealersApi.create(p);
      await fetchList(); startNew();
    } catch { setError('บันทึกไม่สำเร็จ'); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('ลบเจ้ามือนี้?')) return;
    try { await dealersApi.delete(id); await fetchList(); if (edit?.id === id) startNew(); }
    catch { setError('ลบไม่สำเร็จ'); }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Form */}
      <div className="w-80 shrink-0 border-r border-border flex flex-col bg-surface-100/50 h-full">
        <div className="px-4 py-3 border-b border-border shrink-0 flex items-center justify-between">
  <div>
    <p className="text-base font-semibold text-theme-text-primary tracking-tight">
      {edit ? 'แก้ไขเจ้ามือ' : 'เพิ่มเจ้ามือใหม่'}
    </p>
    <p className="text-[11px] text-theme-text-muted mt-0.5">
      ตั้งค่าอัตราจ่ายและเปอร์เซ็นต์
    </p>
  </div>

  {edit && (
    <span className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent border border-accent/20">
      Editing
    </span>
  )}
</div>
         <div className="p-3 space-y-2.5 overflow-y-auto">
          <div>
            <label className={labelCls}>ชื่อเจ้ามือ <span className="text-loss">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ชื่อเจ้ามือ" className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>ชื่อผู้ส่ง</label>
            <input value={form.sender_name} onChange={e => set('sender_name', e.target.value)} placeholder="ผู้ส่ง" className={fieldCls} />
          </div>
          <div>
            <p className={secTitle}>อัตราจ่ายและเปอร์เซ็นต์</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-border">
                <th className="text-left py-1 text-theme-text-muted font-normal">ประเภท</th>
                <th className="text-center py-1 text-theme-text-muted font-normal w-16">ลด %</th>
                <th className="text-center py-1 text-theme-text-muted font-normal w-20">จ่าย</th>
              </tr></thead>
              <tbody>
                {BET_TYPES.map(row => (
                  <tr key={row.dPctKey} className="border-b border-border/40">
                    <td className="py-1 text-theme-text-secondary">{row.label}</td>
                    <td className="py-1 px-1">
                      <input type="text" inputMode="decimal"
                        value={form[row.dPctKey as keyof DForm]}
                        onChange={e => set(row.dPctKey as keyof DForm, e.target.value.replace(/[^0-9.]/g, ''))}
                        className={inputCls} />
                    </td>
                    <td className="py-1 px-1">
                      <input type="text" inputMode="numeric"
                        value={form[row.dRateKey as keyof DForm]}
                        onChange={e => set(row.dRateKey as keyof DForm, e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder={String(row.def)}
                        className={inputCls} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {error && <p className="text-xs text-loss">{error}</p>}
        </div>
        <div className="p-3 border-t border-border flex gap-2 shrink-0">
          {edit && <button onClick={startNew} className={btnCancel}>ใหม่</button>}
          <button onClick={handleSave} disabled={saving} className={btnSave}>
            {saving ? 'กำลังบันทึก...' : edit ? 'อัปเดต' : 'เพิ่มเจ้ามือ'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-border shrink-0 flex items-center gap-3">
          <span className="text-theme-text-secondary text-xs font-semibold">รายชื่อเจ้ามือ</span>
          <span className="text-theme-text-muted text-xs">{list.length} ราย</span>
        </div>
        <div className="flex-1 overflow-auto">
          {loading
            ? <div className="p-6 text-center text-theme-text-muted text-xs">กำลังโหลด...</div>
            : list.length === 0
              ? <div className="p-6 text-center text-theme-text-muted text-xs">ยังไม่มีเจ้ามือ</div>
              : (
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="sticky top-0 bg-surface-50 border-b border-[var(--color-border)]">
                    <tr className="border-b border-border">
                      <th className="text-left py-2 px-3 text-theme-text-muted font-normal">เจ้ามือ</th>
                      {BET_TYPES.map(t => (
                        <th key={'p'+t.dPctKey} className="text-right py-2 px-1 text-theme-text-muted font-normal text-[10px]">
                          %{t.label.replace('3 ตัวบน','3บ').replace('3 ตัวโต็ด','3ต').replace('3 ตัวล่าง','3ล').replace('2 ตัวบน','2บ').replace('2 ตัวล่าง','2ล').replace('วิ่งบน','วบ').replace('วิ่งล่าง','วล')}
                        </th>
                      ))}
                      {BET_TYPES.map(t => (
                        <th key={'r'+t.dRateKey} className="text-right py-2 px-2 text-theme-text-muted font-normal">
                          {t.label.replace('3 ตัวบน','3บน').replace('3 ตัวโต็ด','โต็ด').replace('3 ตัวล่าง','3ล่าง').replace('2 ตัวบน','2บน').replace('2 ตัวล่าง','2ล่าง')}
                        </th>
                      ))}
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(d => (
                      <tr key={d.id} onClick={() => startEdit(d)}
                        className={`border-b border-border/40 cursor-pointer hover:bg-surface-200/30 ${edit?.id === d.id ? 'bg-accent/10' : ''}`}>
                        <td className="py-1.5 px-3 text-theme-text-primary font-medium">{d.name}</td>
                        {BET_TYPES.map(t => {
                          const v = d[t.dPctKey as keyof Dealer] as number | string | null;
                          const n = v != null ? parseFloat(String(v)) : null;
                          return (
                            <td key={'p'+t.dPctKey} className="py-1.5 px-1 text-right font-mono text-theme-text-secondary">
                              {n != null && n > 0 ? fmtNum(n) : <span className="text-theme-text-muted">—</span>}
                            </td>
                          );
                        })}
                        {BET_TYPES.map(t => {
                          const v = d[t.dRateKey as keyof Dealer] as number | string | null;
                          const n = v != null ? parseFloat(String(v)) : null;
                          return (
                            <td key={'r'+t.dRateKey} className="py-1.5 px-2 text-right font-mono">
                              {n != null && n > 0
                                ? <span className="text-risk-medium font-semibold">{fmtNum(n, false)}</span>
                                : <span className="text-theme-text-muted">—</span>}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          <button onClick={e => { e.stopPropagation(); startCopy(d); }}
                            title="คัดลอกเป็นรายการใหม่"
                            className="text-theme-text-muted hover:text-accent text-xs mr-2">⎘</button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(d.id); }}
                            className="text-theme-text-muted hover:text-loss text-base leading-none">×</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
        </div>
      </div>
    </div>
  );
}

// ─── Main combined page ───────────────────────────────────────────────────────
type TabKey = 'customer' | 'dealer';

function ContactsPageInner() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { user } = useAuthStore();
  const isAdmin = user?.role === 'admin';
  const [tab, setTab] = useState<TabKey>((searchParams.get('tab') as TabKey) ?? 'customer');
  const [customerReload, setCustomerReload] = useState(0);
  const [dealerReload, setDealerReload] = useState(0);
  const customerImportRef = useRef<HTMLInputElement>(null);
  const dealerImportRef = useRef<HTMLInputElement>(null);

  const switchTab = (t: TabKey) => {
    setTab(t);
    router.replace(`/customers?tab=${t}`, { scroll: false });
  };

  const exportCustomers = async (includeInactive = false) => {
    try {
      const res = await customersApi.exportJson(
        includeInactive ? { includeInactive: true } : undefined,
      );
      const d = new Date().toISOString().slice(0, 10);
      triggerDownload(res.data, `aurax-customers-${d}.json`);
    } catch {
      alert('ส่งออกลูกค้าไม่สำเร็จ');
    }
  };

  const exportDealers = async (includeInactive = false) => {
    try {
      const res = await dealersApi.exportJson(
        includeInactive ? { includeInactive: true } : undefined,
      );
      const d = new Date().toISOString().slice(0, 10);
      triggerDownload(res.data, `aurax-dealers-${d}.json`);
    } catch {
      alert('ส่งออกเจ้ามือไม่สำเร็จ');
    }
  };

  const onCustomerImportPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Record<string, unknown>;
      const r = await customersApi.importJson(data);
      alert(
        `นำเข้า/อัปเดต ${r.data.imported} แถวจากไฟล์\n(ตารางแสดงเฉพาะลูกค้าที่ใช้งาน — รายที่ปิดใช้จะไม่โชว์)`,
      );
      setCustomerReload((x) => x + 1);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string; errors?: { index: number; message: string }[] }>;
      const msg = ax.response?.data?.error ?? (err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ');
      const extra = ax.response?.data?.errors?.length
        ? `\n${ax.response.data.errors.slice(0, 3).map((x) => `#${x.index}: ${x.message}`).join('\n')}`
        : '';
      alert(msg + extra);
    }
  };

  const onDealerImportPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      const data = JSON.parse(await f.text()) as Record<string, unknown>;
      const r = await dealersApi.importJson(data);
      alert(
        `นำเข้า/อัปเดต ${r.data.imported} แถวจากไฟล์\n(ตารางแสดงเฉพาะเจ้ามือที่ใช้งาน — รายที่กดลบแล้วยังอยู่ในฐานข้อมูลแบบซ่อน จะไม่โชว์)`,
      );
      setDealerReload((x) => x + 1);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string; errors?: { index: number; message: string }[] }>;
      const msg = ax.response?.data?.error ?? (err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ');
      const extra = ax.response?.data?.errors?.length
        ? `\n${ax.response.data.errors.slice(0, 3).map((x) => `#${x.index}: ${x.message}`).join('\n')}`
        : '';
      alert(msg + extra);
    }
  };

  return (
    <AppShell>
      <div className="flex flex-col h-full min-h-0 overflow-hidden bg-surface-default">
        {/* Tab bar */}
        <div className="flex flex-wrap items-end gap-2 px-4 pt-3 border-b border-border shrink-0">
          <div className="flex items-end gap-1 flex-1 min-w-0">
            <span className="text-theme-text-muted text-xs mr-2 pb-2.5 shrink-0">ข้อมูลพื้นฐาน:</span>
            {([
              { key: 'customer', label: 'ลูกค้า',  sub: 'อัตราจ่าย / เปอร์เซ็นต์' },
              { key: 'dealer',   label: 'เจ้ามือ', sub: 'อัตราจ่าย / เปอร์เซ็นต์' },
            ] as { key: TabKey; label: string; sub: string }[]).map(t => (
              <button key={t.key} onClick={() => switchTab(t.key)}
                className={`px-5 py-2 text-sm font-semibold rounded-t-lg border-x border-t transition-colors ${
                  tab === t.key
                    ? 'bg-surface-100 border-border text-theme-text-primary'
                    : 'bg-transparent border-transparent text-theme-text-muted hover:text-theme-text-secondary'
                }`}>
                {t.label}
                <span className="ml-1.5 text-[10px] font-normal text-theme-text-muted hidden sm:inline">— {t.sub}</span>
              </button>
            ))}
          </div>
          {isAdmin && (
            <div className="flex flex-wrap items-center gap-1.5 pb-2">
              <span className="text-[10px] text-theme-text-muted hidden md:inline mr-1">สำรอง JSON (admin):</span>
              {tab === 'customer' && (
                <>
                  <button type="button" className={btnExport} onClick={() => exportCustomers(false)}>
                    ส่งออกลูกค้า
                  </button>
                  <button
                    type="button"
                    className={btnExportAll}
                    title="รวมลูกค้าที่ปิดใช้ในฐานข้อมูล"
                    onClick={() => exportCustomers(true)}
                  >
                    รวมที่ซ่อน
                  </button>
                  <button type="button" className={btnImport} onClick={() => customerImportRef.current?.click()}>
                    นำเข้าลูกค้า
                  </button>
                  <input
                    ref={customerImportRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={onCustomerImportPick}
                  />
                </>
              )}
              {tab === 'dealer' && (
                <>
                  <button type="button" className={btnExport} onClick={() => exportDealers(false)}>
                    ส่งออกเจ้ามือ
                  </button>
                  <button
                    type="button"
                    className={btnExportAll}
                    title="รวมเจ้ามือที่กดลบแล้ว (ยังอยู่ในฐานข้อมูลแบบซ่อน)"
                    onClick={() => exportDealers(true)}
                  >
                    รวมที่ซ่อน
                  </button>
                  <button type="button" className={btnImport} onClick={() => dealerImportRef.current?.click()}>
                    นำเข้าเจ้ามือ
                  </button>
                  <input
                    ref={dealerImportRef}
                    type="file"
                    accept="application/json,.json"
                    className="hidden"
                    onChange={onDealerImportPick}
                  />
                </>
              )}
            </div>
          )}
        </div>
        {isAdmin && (
          <p className="px-4 py-1.5 text-[10px] text-theme-text-muted border-b border-border/60 bg-surface-100/40">
            แนะนำ: ส่งออกจากเครื่องต้นทาง → นำเข้าที่นี่ก่อนนำเข้างวด/โพย — จะได้ UUID ลูกค้า/เจ้ามือตรงกัน
            (ถ้านำเข้างวดไปแล้ว โพยอาจยังไม่ผูกลูกค้าจนกว่าจะนำเข้าลูกค้าชุดเดิมแล้วแก้โพยเอง)
            <span className="block mt-1">
              ส่งออกค่าเริ่มต้น = เหมือนตาราง (เฉพาะที่ใช้งาน) · กดลบเจ้ามือ = ซ่อนใน DB ไม่ลบถาวร — เลข «นำเข้า X แถว» คือจำนวนแถวในไฟล์ JSON
              ถ้าไฟล์เก่ามีรายการซ่อน จึงอาจมากกว่าที่เห็นในตาราง · ต้องการไฟล์ครบทุกแถวใช้ปุ่ม «รวมที่ซ่อน»
            </span>
          </p>
        )}
        {/* Section content */}
        <div className="flex-1 overflow-hidden">
          {tab === 'customer' && <CustomerSection reloadToken={customerReload} />}
          {tab === 'dealer'   && <DealerSection reloadToken={dealerReload} />}
        </div>
      </div>
    </AppShell>
  );
}

export default function ContactsPage() {
  return <Suspense><ContactsPageInner /></Suspense>;
}

