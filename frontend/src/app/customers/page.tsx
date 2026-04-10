'use client';
import { useEffect, useState, useCallback, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { customersApi, dealersApi } from '@/lib/api';
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
const inputCls  = 'w-full h-7 rounded bg-slate-900 border border-slate-600 px-2 text-xs text-slate-200 text-right placeholder:text-slate-700 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono';
const fieldCls  = 'w-full h-8 rounded bg-slate-700 border border-slate-600 px-3 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500';
const labelCls  = 'text-xs text-slate-400 block mb-1';
const secTitle  = 'text-[10px] text-slate-500 uppercase tracking-widest font-semibold mb-2';
const btnSave   = 'flex-1 h-8 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors';
const btnCancel = 'h-8 px-3 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs transition-colors';
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

function CustomerSection() {
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
  useEffect(() => { fetchList(); }, [fetchList]);

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
      <div className="w-80 shrink-0 border-r border-slate-700 flex flex-col bg-slate-800/50 h-full">
        <div className="p-3 border-b border-slate-700 shrink-0">
          <p className={secTitle}>{edit ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}</p>
        </div>
        <div className="p-3 space-y-2.5 flex-1 overflow-y-auto min-h-0">
          <div>
            <label className={labelCls}>ชื่อลูกค้า <span className="text-rose-400">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ชื่อ หรือ รหัส" className={fieldCls} />
          </div>
          <div>
            <p className={secTitle}>อัตราจ่ายและเปอร์เซ็นต์</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-700">
                <th className="text-left py-1 text-slate-500 font-normal">ประเภท</th>
                <th className="text-center py-1 text-slate-500 font-normal w-16">ลด %</th>
                <th className="text-center py-1 text-slate-500 font-normal w-20">อัตราจ่าย</th>
              </tr></thead>
              <tbody>
                {BET_TYPES.map(row => (
                  <tr key={row.dPctKey} className="border-b border-slate-700/40">
                    <td className="py-1 text-slate-300">{row.label}</td>
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
              className="w-full rounded bg-slate-700 border border-slate-600 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-indigo-500 resize-none" />
          </div>
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
        <div className="p-3 border-t border-slate-700 flex gap-2 shrink-0">
          {edit && <button onClick={startNew} className={btnCancel}>ใหม่</button>}
          <button onClick={handleSave} disabled={saving} className={btnSave}>
            {saving ? 'กำลังบันทึก...' : edit ? 'อัปเดต' : 'เพิ่มลูกค้า'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700 shrink-0 flex items-center gap-3">
          <span className="text-slate-300 text-xs font-semibold">รายชื่อลูกค้า</span>
          <span className="text-slate-600 text-xs">{list.length} ราย</span>
          <button onClick={startNew} className="ml-auto text-xs text-indigo-400 hover:text-indigo-300">+ เพิ่มใหม่</button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading
            ? <div className="p-6 text-center text-slate-600 text-xs">กำลังโหลด...</div>
            : list.length === 0
              ? <div className="p-6 text-center text-slate-600 text-xs">ยังไม่มีลูกค้า</div>
              : (
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="sticky top-0 bg-slate-800/95 backdrop-blur">
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-3 text-slate-500 font-normal">ชื่อ</th>
                      {BET_TYPES.map(t => (
                        <th key={'p'+t.dPctKey} className="text-right py-2 px-1 text-slate-600 font-normal text-[10px]">
                          %{t.label.replace('3 ตัวบน','3บ').replace('3 ตัวโต็ด','3ต').replace('3 ตัวล่าง','3ล').replace('2 ตัวบน','2บ').replace('2 ตัวล่าง','2ล').replace('วิ่งบน','วบ').replace('วิ่งล่าง','วล')}
                        </th>
                      ))}
                      {BET_TYPES.map(t => (
                        <th key={'r'+t.cKey} className="text-right py-2 px-2 text-slate-500 font-normal">
                          {t.label.replace('3 ตัวบน','3บน').replace('3 ตัวโต็ด','โต็ด').replace('3 ตัวล่าง','3ล่าง').replace('2 ตัวบน','2บน').replace('2 ตัวล่าง','2ล่าง')}
                        </th>
                      ))}
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(c => (
                      <tr key={c.id} onClick={() => startEdit(c)}
                        className={`border-b border-slate-700/40 cursor-pointer hover:bg-slate-700/30 ${edit?.id === c.id ? 'bg-indigo-900/20' : ''}`}>
                        <td className="py-1.5 px-3 text-slate-200 font-medium">{c.name}</td>
                        {BET_TYPES.map(t => {
                          const val = (c as unknown as Record<string, number | string | null>)[t.dPctKey];
                          const n = val != null ? parseFloat(String(val)) : null;
                          return (
                            <td key={'p'+t.dPctKey} className="py-1.5 px-1 text-right font-mono text-slate-400">
                              {n != null && n > 0 ? fmtNum(n) : <span className="text-slate-700">—</span>}
                            </td>
                          );
                        })}
                        {BET_TYPES.map(t => {
                          const val = (c as unknown as Record<string, number | string | null>)[t.cKey];
                          const n = val != null ? parseFloat(String(val)) : null;
                          return (
                            <td key={'r'+t.cKey} className="py-1.5 px-2 text-right font-mono">
                              {n != null && n > 0
                                ? <span className="text-amber-400 font-semibold">{fmtNum(n, false)}</span>
                                : <span className="text-slate-700">—</span>}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          <button onClick={e => { e.stopPropagation(); startCopy(c); }}
                            title="คัดลอกเป็นรายการใหม่"
                            className="text-slate-600 hover:text-indigo-400 text-xs mr-2">⎘</button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                            className="text-slate-700 hover:text-rose-400 text-base leading-none">×</button>
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

function DealerSection() {
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
  useEffect(() => { fetchList(); }, [fetchList]);

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
      <div className="w-80 shrink-0 border-r border-slate-700 flex flex-col bg-slate-800/50 h-full">
        <div className="p-3 border-b border-slate-700 shrink-0">
          <p className={secTitle}>{edit ? 'แก้ไขเจ้ามือ' : 'เพิ่มเจ้ามือใหม่'}</p>
        </div>
        <div className="p-3 space-y-2.5 flex-1 overflow-y-auto min-h-0">
          <div>
            <label className={labelCls}>ชื่อเจ้ามือ <span className="text-rose-400">*</span></label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ชื่อเจ้ามือ" className={fieldCls} />
          </div>
          <div>
            <label className={labelCls}>ชื่อผู้ส่ง</label>
            <input value={form.sender_name} onChange={e => set('sender_name', e.target.value)} placeholder="ผู้ส่ง" className={fieldCls} />
          </div>
          <div>
            <p className={secTitle}>อัตราจ่ายและเปอร์เซ็นต์</p>
            <table className="w-full text-xs">
              <thead><tr className="border-b border-slate-700">
                <th className="text-left py-1 text-slate-500 font-normal">ประเภท</th>
                <th className="text-center py-1 text-slate-500 font-normal w-16">ลด %</th>
                <th className="text-center py-1 text-slate-500 font-normal w-20">จ่าย</th>
              </tr></thead>
              <tbody>
                {BET_TYPES.map(row => (
                  <tr key={row.dPctKey} className="border-b border-slate-700/40">
                    <td className="py-1 text-slate-300">{row.label}</td>
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
          {error && <p className="text-xs text-rose-400">{error}</p>}
        </div>
        <div className="p-3 border-t border-slate-700 flex gap-2 shrink-0">
          {edit && <button onClick={startNew} className={btnCancel}>ใหม่</button>}
          <button onClick={handleSave} disabled={saving} className={btnSave}>
            {saving ? 'กำลังบันทึก...' : edit ? 'อัปเดต' : 'เพิ่มเจ้ามือ'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-4 py-2.5 border-b border-slate-700 shrink-0 flex items-center gap-3">
          <span className="text-slate-300 text-xs font-semibold">รายชื่อเจ้ามือ</span>
          <span className="text-slate-600 text-xs">{list.length} ราย</span>
          <button onClick={startNew} className="ml-auto text-xs text-indigo-400 hover:text-indigo-300">+ เพิ่มใหม่</button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading
            ? <div className="p-6 text-center text-slate-600 text-xs">กำลังโหลด...</div>
            : list.length === 0
              ? <div className="p-6 text-center text-slate-600 text-xs">ยังไม่มีเจ้ามือ</div>
              : (
                <table className="w-full text-xs whitespace-nowrap">
                  <thead className="sticky top-0 bg-slate-800/95 backdrop-blur">
                    <tr className="border-b border-slate-700">
                      <th className="text-left py-2 px-3 text-slate-500 font-normal">เจ้ามือ</th>
                      {BET_TYPES.map(t => (
                        <th key={'p'+t.dPctKey} className="text-right py-2 px-1 text-slate-600 font-normal text-[10px]">
                          %{t.label.replace('3 ตัวบน','3บ').replace('3 ตัวโต็ด','3ต').replace('3 ตัวล่าง','3ล').replace('2 ตัวบน','2บ').replace('2 ตัวล่าง','2ล').replace('วิ่งบน','วบ').replace('วิ่งล่าง','วล')}
                        </th>
                      ))}
                      {BET_TYPES.map(t => (
                        <th key={'r'+t.dRateKey} className="text-right py-2 px-2 text-slate-500 font-normal">
                          {t.label.replace('3 ตัวบน','3บน').replace('3 ตัวโต็ด','โต็ด').replace('3 ตัวล่าง','3ล่าง').replace('2 ตัวบน','2บน').replace('2 ตัวล่าง','2ล่าง')}
                        </th>
                      ))}
                      <th className="w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map(d => (
                      <tr key={d.id} onClick={() => startEdit(d)}
                        className={`border-b border-slate-700/40 cursor-pointer hover:bg-slate-700/30 ${edit?.id === d.id ? 'bg-indigo-900/20' : ''}`}>
                        <td className="py-1.5 px-3 text-slate-200 font-medium">{d.name}</td>
                        {BET_TYPES.map(t => {
                          const v = d[t.dPctKey as keyof Dealer] as number | string | null;
                          const n = v != null ? parseFloat(String(v)) : null;
                          return (
                            <td key={'p'+t.dPctKey} className="py-1.5 px-1 text-right font-mono text-slate-400">
                              {n != null && n > 0 ? fmtNum(n) : <span className="text-slate-700">—</span>}
                            </td>
                          );
                        })}
                        {BET_TYPES.map(t => {
                          const v = d[t.dRateKey as keyof Dealer] as number | string | null;
                          const n = v != null ? parseFloat(String(v)) : null;
                          return (
                            <td key={'r'+t.dRateKey} className="py-1.5 px-2 text-right font-mono">
                              {n != null && n > 0
                                ? <span className="text-amber-400 font-semibold">{fmtNum(n, false)}</span>
                                : <span className="text-slate-700">—</span>}
                            </td>
                          );
                        })}
                        <td className="py-1.5 px-2 whitespace-nowrap">
                          <button onClick={e => { e.stopPropagation(); startCopy(d); }}
                            title="คัดลอกเป็นรายการใหม่"
                            className="text-slate-600 hover:text-indigo-400 text-xs mr-2">⎘</button>
                          <button onClick={e => { e.stopPropagation(); handleDelete(d.id); }}
                            className="text-slate-700 hover:text-rose-400 text-base leading-none">×</button>
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
  const [tab, setTab] = useState<TabKey>((searchParams.get('tab') as TabKey) ?? 'customer');

  const switchTab = (t: TabKey) => {
    setTab(t);
    router.replace(`/customers?tab=${t}`, { scroll: false });
  };

  return (
    <AppShell>
      <div className="flex flex-col h-screen overflow-hidden bg-slate-900">
        {/* Tab bar */}
        <div className="flex items-end gap-1 px-4 pt-3 border-b border-slate-700 shrink-0">
          <span className="text-slate-600 text-xs mr-2 pb-2.5">ข้อมูลพื้นฐาน:</span>
          {([
            { key: 'customer', label: 'ลูกค้า',  sub: 'อัตราจ่าย / คอมมิชชั่น' },
            { key: 'dealer',   label: 'เจ้ามือ', sub: 'อัตราจ่าย / ส่วนลด' },
          ] as { key: TabKey; label: string; sub: string }[]).map(t => (
            <button key={t.key} onClick={() => switchTab(t.key)}
              className={`px-5 py-2 text-sm font-semibold rounded-t-lg border-x border-t transition-colors ${
                tab === t.key
                  ? 'bg-slate-800 border-slate-700 text-slate-100'
                  : 'bg-transparent border-transparent text-slate-500 hover:text-slate-300'
              }`}>
              {t.label}
              <span className="ml-1.5 text-[10px] font-normal text-slate-600 hidden sm:inline">— {t.sub}</span>
            </button>
          ))}
        </div>
        {/* Section content */}
        <div className="flex-1 overflow-hidden">
          {tab === 'customer' && <CustomerSection />}
          {tab === 'dealer'   && <DealerSection />}
        </div>
      </div>
    </AppShell>
  );
}

export default function ContactsPage() {
  return <Suspense><ContactsPageInner /></Suspense>;
}

