'use client';
import { useEffect, useState, useCallback, useRef, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import type { AxiosError } from 'axios';
import { customersApi, dealersApi } from '@/lib/api';
import { useAuthStore } from '@/store/useStore';
import { Customer, Dealer, DEFAULT_PAYOUT_RATES } from '@/types';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';

// ─── Shared bet-type rows ─────────────────────────────────────────────────────
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
const inputCls = 'w-full h-7 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-2 text-[12px] text-theme-text-primary text-right placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-accent)] tabular-nums tracking-tight transition-colors';
const fieldCls = 'w-full h-9 rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-3 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-accent)] transition-colors';
const btnSave   = 'btn-toolbar-glow btn-toolbar-profit flex-1 !h-9 text-sm rounded-xl justify-center';
const btnCancel = 'btn-toolbar-glow btn-toolbar-muted flex-1 !h-9 text-sm rounded-xl justify-center';
const btnExport = 'btn-toolbar-glow btn-fintech-search !h-8 px-3.5 text-xs font-semibold justify-center border border-[var(--color-border-strong)]';
const btnImport = 'btn-toolbar-glow btn-toolbar-profit !h-8 px-3.5 text-xs font-semibold justify-center border border-[var(--color-border-strong)] shadow-[var(--shadow-soft)]';

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function fmtNum(v: number | string | null | undefined, showZeroAsDash = true): string {
  if (v == null) return '—';
  const n = parseFloat(String(v));
  if (isNaN(n)) return '—';
  if (showZeroAsDash && n === 0) return '—';
  return n % 1 === 0 ? String(Math.round(n)) : String(n);
}
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
    pct_3top:    fmtForm(c.pct_3top,    '0'), pct_3tote:   fmtForm(c.pct_3tote,   '0'), pct_3back:   fmtForm(c.pct_3back,   '0'),
    pct_2top:    fmtForm(c.pct_2top,    '0'), pct_2bottom: fmtForm(c.pct_2bottom, '0'),
    pct_1top:    fmtForm(c.pct_1top,    '0'), pct_1bottom: fmtForm(c.pct_1bottom, '0'),
    rate_3top:    fmtForm(c.rate_3top),   rate_3tote:   fmtForm(c.rate_3tote),   rate_3back:   fmtForm(c.rate_3back),
    rate_2top:    fmtForm(c.rate_2top),   rate_2bottom: fmtForm(c.rate_2bottom),
    rate_1top:    fmtForm(c.rate_1top),   rate_1bottom: fmtForm(c.rate_1bottom),
  };
}
function cFormToPayload(f: CForm): Record<string, unknown> {
  const n = (v: string) => v.trim() === '' ? null : parseInt(v, 10);
  const p = (v: string) => parseFloat(v) || 0;
  return {
    name: f.name.trim(), note: f.note.trim() || null,
    commission_rate: 0, commission_rate_run: 0,
    pct_3top: p(f.pct_3top), pct_3tote: p(f.pct_3tote), pct_3back: p(f.pct_3back),
    pct_2top: p(f.pct_2top), pct_2bottom: p(f.pct_2bottom),
    pct_1top: p(f.pct_1top), pct_1bottom: p(f.pct_1bottom),
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
    <div className="flex h-full gap-4">
      {/* ── Form card ── */}
      <div className="w-[296px] shrink-0 flex flex-col glass-card overflow-hidden">
        {/* card header */}
        <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-base font-semibold text-theme-text-primary tracking-tight leading-tight">
              {edit ? 'แก้ไขลูกค้า' : 'เพิ่มลูกค้าใหม่'}
            </p>
            <p className="text-[11px] text-theme-text-muted mt-0.5">ตั้งค่าอัตราจ่ายและเปอร์เซ็นต์</p>
          </div>
          {edit && (
            <span className="shrink-0 text-[10px] px-2 py-1 rounded-full bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)] font-semibold tracking-wide">
              กำลังแก้ไข
            </span>
          )}
        </div>

        {/* form body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          {/* Name */}
          <div>
            <label className="text-xs text-theme-text-secondary font-semibold block mb-1.5">
              ชื่อลูกค้า <span className="text-loss font-bold">*</span>
            </label>
            <input
              value={form.name}
              onChange={e => set('name', e.target.value)}
              placeholder="ชื่อ หรือ รหัส"
              className={fieldCls}
            />
          </div>

          {/* Rate table */}
          <div>
            <p className="text-[10px] text-theme-text-muted uppercase tracking-widest font-semibold mb-2">
              อัตราจ่ายและเปอร์เซ็นต์
            </p>
            <div className="rounded-xl overflow-hidden border border-[var(--color-border)]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)]">
                    <th className="text-left py-2 px-3 text-theme-text-secondary font-semibold">ประเภท</th>
                    <th className="text-center py-2 px-2 text-theme-text-secondary font-semibold w-16">ลด&nbsp;%</th>
                    <th className="text-center py-2 px-2 text-theme-text-secondary font-semibold w-20">อัตราจ่าย</th>
                  </tr>
                </thead>
                <tbody>
                  {BET_TYPES.map((row, idx) => (
                    <tr
                      key={row.dPctKey}
                      className={`border-b border-[var(--color-border)]/60 last:border-b-0 ${idx % 2 === 1 ? 'bg-[var(--bg-glass-subtle)]/60' : ''}`}
                    >
                      <td className="py-1.5 px-3 text-theme-text-primary font-medium whitespace-nowrap">{row.label}</td>
                      <td className="py-1.5 px-1.5">
                        <input
                          type="text" inputMode="decimal"
                          value={form[row.dPctKey as keyof CForm]}
                          onChange={e => set(row.dPctKey as keyof CForm, e.target.value.replace(/[^0-9.]/g, ''))}
                          className={inputCls}
                        />
                      </td>
                      <td className="py-1.5 px-1.5">
                        <input
                          type="text" inputMode="numeric"
                          value={form[row.cKey as keyof CForm]}
                          onChange={e => set(row.cKey as keyof CForm, e.target.value.replace(/[^0-9.]/g, ''))}
                          placeholder={String(row.def)}
                          className={inputCls}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Note */}
          <div>
            <label className="text-xs text-theme-text-secondary font-semibold block mb-1.5">หมายเหตุ</label>
            <textarea
              value={form.note}
              onChange={e => set('note', e.target.value)}
              rows={2}
              placeholder="หมายเหตุ..."
              className="w-full rounded-lg bg-[var(--color-input-bg)] border border-[var(--color-input-border)] px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-muted focus:outline-none focus:ring-2 focus:ring-[var(--color-accent-ring)] focus:border-[var(--color-accent)] resize-none transition-colors leading-relaxed"
            />
          </div>

          {error && (
            <p className="text-xs text-loss bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        {/* footer buttons */}
        <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--bg-glass-subtle)] flex gap-2 shrink-0">
          {edit && <button onClick={startNew} className={btnCancel}>ยกเลิก</button>}
          <button onClick={handleSave} disabled={saving} className={btnSave}>
            {saving ? 'กำลังบันทึก…' : edit ? 'อัปเดตลูกค้า' : 'เพิ่มลูกค้า'}
          </button>
        </div>
      </div>

      {/* ── List card ── */}
      <div className="flex-1 flex flex-col glass-card overflow-hidden min-w-0">
        {/* card header */}
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] flex items-center gap-3 shrink-0">
          <span className="text-sm font-semibold text-theme-text-primary">รายชื่อลูกค้า</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)]">
            {list.length} ราย
          </span>
        </div>

        <div className="flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="p-8 text-center text-theme-text-muted text-sm">กำลังโหลด…</div>
          ) : list.length === 0 ? (
            <div className="p-8 text-center text-theme-text-muted text-sm">ยังไม่มีลูกค้า</div>
          ) : (
            <table className="w-full text-[12px] whitespace-nowrap">
              <thead className="sticky top-0 bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)] z-10">
                <tr>
                  <th className="text-left py-2.5 px-4 text-[11px] text-theme-text-secondary font-semibold uppercase tracking-wide">ชื่อ</th>
                  {BET_TYPES.map(t => (
                    <th key={'p'+t.dPctKey} className="text-right py-2.5 px-1.5 text-[11px] text-theme-text-secondary font-semibold uppercase tracking-wide">
                      %{t.label.replace('3 ตัวบน','3บ').replace('3 ตัวโต็ด','3ต').replace('3 ตัวล่าง','3ล').replace('2 ตัวบน','2บ').replace('2 ตัวล่าง','2ล').replace('วิ่งบน','วบ').replace('วิ่งล่าง','วล')}
                    </th>
                  ))}
                  <th className="py-2.5 px-2">
                    <span className="inline-block w-px h-3 bg-[var(--color-border)]" />
                  </th>
                  {BET_TYPES.map(t => (
                    <th key={'r'+t.cKey} className="text-right py-2.5 px-2 text-[11px] text-theme-text-secondary font-semibold uppercase tracking-wide">
                      {t.label.replace('3 ตัวบน','3บน').replace('3 ตัวโต็ด','โต็ด').replace('3 ตัวล่าง','3ล่าง').replace('2 ตัวบน','2บน').replace('2 ตัวล่าง','2ล่าง')}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {list.map((c, rowIdx) => (
                  <tr
                    key={c.id}
                    onClick={() => startEdit(c)}
                    className={`cursor-pointer border-b border-[var(--color-border)]/50 last:border-b-0 transition-colors duration-100 ${
                      edit?.id === c.id
                        ? 'bg-[var(--color-badge-info-bg)]'
                        : rowIdx % 2 === 0 ? 'bg-white hover:bg-[var(--bg-hover)]' : 'bg-[var(--bg-glass-subtle)]/60 hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <td className="py-2 px-4 font-semibold text-theme-text-primary">
                      <span className={edit?.id === c.id ? 'text-[var(--color-badge-info-text)]' : ''}>
                        {c.name}
                      </span>
                    </td>
                    {BET_TYPES.map(t => {
                      const val = (c as unknown as Record<string, number | string | null>)[t.dPctKey];
                      const n = val != null ? parseFloat(String(val)) : null;
                      return (
                        <td key={'p'+t.dPctKey} className="py-2 px-1.5 text-right tabular-nums text-theme-text-secondary">
                          {n != null && n > 0 ? fmtNum(n) : <span className="text-theme-text-muted opacity-30">—</span>}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2">
                      <span className="inline-block w-px h-3 bg-[var(--color-border)]" />
                    </td>
                    {BET_TYPES.map(t => {
                      const val = (c as unknown as Record<string, number | string | null>)[t.cKey];
                      const n = val != null ? parseFloat(String(val)) : null;
                      return (
                        <td key={'r'+t.cKey} className="py-2 px-2 text-right tabular-nums">
                          {n != null && n > 0
                            ? <span className="font-semibold text-[var(--color-accent)]">{fmtNum(n, false)}</span>
                            : <span className="text-theme-text-muted opacity-30">—</span>}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 whitespace-nowrap text-right">
                      <button
                        onClick={e => { e.stopPropagation(); startCopy(c); }}
                        title="คัดลอกเป็นรายการใหม่"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-theme-text-muted hover:text-accent hover:bg-[var(--color-badge-info-bg)] transition-colors text-sm mr-1"
                      >⎘</button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(c.id); }}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-theme-text-muted hover:text-loss hover:bg-[var(--color-badge-danger-bg)] transition-colors text-base leading-none"
                      >×</button>
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
    pct_3top:    fmtForm(d.pct_3top,    '0'), pct_3tote:   fmtForm(d.pct_3tote,   '0'), pct_3back:   fmtForm(d.pct_3back,   '0'),
    pct_2top:    fmtForm(d.pct_2top,    '0'), pct_2bottom: fmtForm(d.pct_2bottom, '0'),
    pct_1top:    fmtForm(d.pct_1top,    '0'), pct_1bottom: fmtForm(d.pct_1bottom, '0'),
    rate_3top:    fmtForm(d.rate_3top),   rate_3tote:   fmtForm(d.rate_3tote),   rate_3back:   fmtForm(d.rate_3back),
    rate_2top:    fmtForm(d.rate_2top),   rate_2bottom: fmtForm(d.rate_2bottom),
    rate_1top:    fmtForm(d.rate_1top),   rate_1bottom: fmtForm(d.rate_1bottom),
  };
}
function dFormToPayload(f: DForm): Record<string, unknown> {
  const n = (v: string) => v.trim() === '' ? null : parseInt(v, 10);
  return {
    name: f.name.trim(), sender_name: f.sender_name.trim() || null,
    keep_net_pct: parseFloat(f.keep_net_pct) || 100,
    pct_3top:    parseFloat(f.pct_3top)    || 0, pct_3tote:   parseFloat(f.pct_3tote)   || 0, pct_3back:   parseFloat(f.pct_3back)   || 0,
    pct_2top:    parseFloat(f.pct_2top)    || 0, pct_2bottom: parseFloat(f.pct_2bottom) || 0,
    pct_1top:    parseFloat(f.pct_1top)    || 0, pct_1bottom: parseFloat(f.pct_1bottom) || 0,
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
    <div className="flex h-full gap-4">
      {/* ── Form card ── */}
      <div className="w-[296px] shrink-0 flex flex-col glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] flex items-start justify-between gap-3 shrink-0">
          <div className="min-w-0">
            <p className="text-base font-semibold text-theme-text-primary tracking-tight leading-tight">
              {edit ? 'แก้ไขเจ้ามือ' : 'เพิ่มเจ้ามือใหม่'}
            </p>
            <p className="text-[11px] text-theme-text-muted mt-0.5">ตั้งค่าอัตราจ่ายและเปอร์เซ็นต์</p>
          </div>
          {edit && (
            <span className="shrink-0 text-[10px] px-2 py-1 rounded-full bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)] font-semibold tracking-wide">
              กำลังแก้ไข
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
          <div>
            <label className="text-xs text-theme-text-secondary font-semibold block mb-1.5">
              ชื่อเจ้ามือ <span className="text-loss font-bold">*</span>
            </label>
            <input value={form.name} onChange={e => set('name', e.target.value)} placeholder="ชื่อเจ้ามือ" className={fieldCls} />
          </div>
          <div>
            <label className="text-xs text-theme-text-secondary font-semibold block mb-1.5">ชื่อผู้ส่ง</label>
            <input value={form.sender_name} onChange={e => set('sender_name', e.target.value)} placeholder="ผู้ส่ง" className={fieldCls} />
          </div>

          <div>
            <p className="text-[10px] text-theme-text-muted uppercase tracking-widest font-semibold mb-2">
              อัตราจ่ายและเปอร์เซ็นต์
            </p>
            <div className="rounded-xl overflow-hidden border border-[var(--color-border)]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)]">
                    <th className="text-left py-2 px-3 text-theme-text-secondary font-semibold">ประเภท</th>
                    <th className="text-center py-2 px-2 text-theme-text-secondary font-semibold w-16">ลด&nbsp;%</th>
                    <th className="text-center py-2 px-2 text-theme-text-secondary font-semibold w-20">จ่าย</th>
                  </tr>
                </thead>
                <tbody>
                  {BET_TYPES.map((row, idx) => (
                    <tr
                      key={row.dPctKey}
                      className={`border-b border-[var(--color-border)]/60 last:border-b-0 ${idx % 2 === 1 ? 'bg-[var(--bg-glass-subtle)]/60' : ''}`}
                    >
                      <td className="py-1.5 px-3 text-theme-text-primary font-medium whitespace-nowrap">{row.label}</td>
                      <td className="py-1.5 px-1.5">
                        <input type="text" inputMode="decimal"
                          value={form[row.dPctKey as keyof DForm]}
                          onChange={e => set(row.dPctKey as keyof DForm, e.target.value.replace(/[^0-9.]/g, ''))}
                          className={inputCls} />
                      </td>
                      <td className="py-1.5 px-1.5">
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
          </div>

          {error && (
            <p className="text-xs text-loss bg-[var(--color-badge-danger-bg)] border border-[var(--color-badge-danger-border)] rounded-lg px-3 py-2">
              {error}
            </p>
          )}
        </div>

        <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--bg-glass-subtle)] flex gap-2 shrink-0">
          {edit && <button onClick={startNew} className={btnCancel}>ยกเลิก</button>}
          <button onClick={handleSave} disabled={saving} className={btnSave}>
            {saving ? 'กำลังบันทึก…' : edit ? 'อัปเดตเจ้ามือ' : 'เพิ่มเจ้ามือ'}
          </button>
        </div>
      </div>

      {/* ── List card ── */}
      <div className="flex-1 flex flex-col glass-card overflow-hidden min-w-0">
        <div className="px-5 py-3.5 border-b border-[var(--color-border)] bg-[var(--bg-glass-subtle)] flex items-center gap-3 shrink-0">
          <span className="text-sm font-semibold text-theme-text-primary">รายชื่อเจ้ามือ</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-[var(--color-badge-info-bg)] text-[var(--color-badge-info-text)] border border-[var(--color-badge-info-border)]">
            {list.length} ราย
          </span>
        </div>

        <div className="flex-1 overflow-auto min-h-0">
          {loading ? (
            <div className="p-8 text-center text-theme-text-muted text-sm">กำลังโหลด…</div>
          ) : list.length === 0 ? (
            <div className="p-8 text-center text-theme-text-muted text-sm">ยังไม่มีเจ้ามือ</div>
          ) : (
            <table className="w-full text-[12px] whitespace-nowrap">
              <thead className="sticky top-0 bg-[var(--bg-glass-subtle)] border-b border-[var(--color-border)] z-10">
                <tr>
                  <th className="text-left py-2.5 px-4 text-[11px] text-theme-text-secondary font-semibold uppercase tracking-wide">เจ้ามือ</th>
                  {BET_TYPES.map(t => (
                    <th key={'p'+t.dPctKey} className="text-right py-2.5 px-1.5 text-[11px] text-theme-text-secondary font-semibold uppercase tracking-wide">
                      %{t.label.replace('3 ตัวบน','3บ').replace('3 ตัวโต็ด','3ต').replace('3 ตัวล่าง','3ล').replace('2 ตัวบน','2บ').replace('2 ตัวล่าง','2ล').replace('วิ่งบน','วบ').replace('วิ่งล่าง','วล')}
                    </th>
                  ))}
                  <th className="py-2.5 px-2">
                    <span className="inline-block w-px h-3 bg-[var(--color-border)]" />
                  </th>
                  {BET_TYPES.map(t => (
                    <th key={'r'+t.dRateKey} className="text-right py-2.5 px-2 text-[11px] text-theme-text-secondary font-semibold uppercase tracking-wide">
                      {t.label.replace('3 ตัวบน','3บน').replace('3 ตัวโต็ด','โต็ด').replace('3 ตัวล่าง','3ล่าง').replace('2 ตัวบน','2บน').replace('2 ตัวล่าง','2ล่าง')}
                    </th>
                  ))}
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {list.map((d, rowIdx) => (
                  <tr
                    key={d.id}
                    onClick={() => startEdit(d)}
                    className={`cursor-pointer border-b border-[var(--color-border)]/50 last:border-b-0 transition-colors duration-100 ${
                      edit?.id === d.id
                        ? 'bg-[var(--color-badge-info-bg)]'
                        : rowIdx % 2 === 0 ? 'bg-white hover:bg-[var(--bg-hover)]' : 'bg-[var(--bg-glass-subtle)]/60 hover:bg-[var(--bg-hover)]'
                    }`}
                  >
                    <td className="py-2 px-4 font-semibold text-theme-text-primary">
                      <span className={edit?.id === d.id ? 'text-[var(--color-badge-info-text)]' : ''}>{d.name}</span>
                    </td>
                    {BET_TYPES.map(t => {
                      const v = d[t.dPctKey as keyof Dealer] as number | string | null;
                      const n = v != null ? parseFloat(String(v)) : null;
                      return (
                        <td key={'p'+t.dPctKey} className="py-2 px-1.5 text-right tabular-nums text-theme-text-secondary">
                          {n != null && n > 0 ? fmtNum(n) : <span className="text-theme-text-muted opacity-30">—</span>}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2">
                      <span className="inline-block w-px h-3 bg-[var(--color-border)]" />
                    </td>
                    {BET_TYPES.map(t => {
                      const v = d[t.dRateKey as keyof Dealer] as number | string | null;
                      const n = v != null ? parseFloat(String(v)) : null;
                      return (
                        <td key={'r'+t.dRateKey} className="py-2 px-2 text-right tabular-nums">
                          {n != null && n > 0
                            ? <span className="font-semibold text-[var(--color-accent)]">{fmtNum(n, false)}</span>
                            : <span className="text-theme-text-muted opacity-30">—</span>}
                        </td>
                      );
                    })}
                    <td className="py-2 px-2 whitespace-nowrap text-right">
                      <button
                        onClick={e => { e.stopPropagation(); startCopy(d); }}
                        title="คัดลอกเป็นรายการใหม่"
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-theme-text-muted hover:text-accent hover:bg-[var(--color-badge-info-bg)] transition-colors text-sm mr-1"
                      >⎘</button>
                      <button
                        onClick={e => { e.stopPropagation(); handleDelete(d.id); }}
                        className="inline-flex items-center justify-center w-6 h-6 rounded-md text-theme-text-muted hover:text-loss hover:bg-[var(--color-badge-danger-bg)] transition-colors text-base leading-none"
                      >×</button>
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

// ─── Main page ────────────────────────────────────────────────────────────────
type TabKey = 'customer' | 'dealer';
const TABS: { key: TabKey; label: string; sub: string }[] = [
  { key: 'customer', label: 'ลูกค้า',  sub: 'อัตราจ่าย / เปอร์เซ็นต์' },
  { key: 'dealer',   label: 'เจ้ามือ', sub: 'อัตราจ่าย / เปอร์เซ็นต์' },
];

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

  const exportCustomers = async () => {
    try { const res = await customersApi.exportJson(); triggerDownload(res.data, `aurax-customers-${new Date().toISOString().slice(0,10)}.json`); }
    catch { alert('ส่งออกลูกค้าไม่สำเร็จ'); }
  };
  const exportDealers = async () => {
    try { const res = await dealersApi.exportJson(); triggerDownload(res.data, `aurax-dealers-${new Date().toISOString().slice(0,10)}.json`); }
    catch { alert('ส่งออกเจ้ามือไม่สำเร็จ'); }
  };

  const onCustomerImportPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    try {
      const r = await customersApi.importJson(JSON.parse(await f.text()) as Record<string, unknown>);
      alert(`นำเข้า/อัปเดต ${r.data.imported} แถวจากไฟล์`);
      setCustomerReload(x => x + 1);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string; errors?: { index: number; message: string }[] }>;
      const msg = ax.response?.data?.error ?? (err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ');
      const extra = ax.response?.data?.errors?.length ? `\n${ax.response.data.errors.slice(0,3).map(x => `#${x.index}: ${x.message}`).join('\n')}` : '';
      alert(msg + extra);
    }
  };
  const onDealerImportPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; e.target.value = ''; if (!f) return;
    try {
      const r = await dealersApi.importJson(JSON.parse(await f.text()) as Record<string, unknown>);
      alert(`นำเข้า/อัปเดต ${r.data.imported} แถวจากไฟล์`);
      setDealerReload(x => x + 1);
    } catch (err) {
      const ax = err as AxiosError<{ error?: string; errors?: { index: number; message: string }[] }>;
      const msg = ax.response?.data?.error ?? (err instanceof Error ? err.message : 'นำเข้าไม่สำเร็จ');
      const extra = ax.response?.data?.errors?.length ? `\n${ax.response.data.errors.slice(0,3).map(x => `#${x.index}: ${x.message}`).join('\n')}` : '';
      alert(msg + extra);
    }
  };

  return (
    <AppShell>
      <Header
        title="ลูกค้า / เจ้ามือ"
        subtitle="จัดการอัตราจ่ายและเปอร์เซ็นต์คอมมิชชัน"
        trailing={
          isAdmin ? (
            <div className="flex items-center gap-1.5">
              {tab === 'customer' && (
                <>
                  <button type="button" className={btnExport} onClick={exportCustomers}>ส่งออกลูกค้า</button>
                  <button type="button" className={btnImport} onClick={() => customerImportRef.current?.click()}>นำเข้าลูกค้า</button>
                  <input ref={customerImportRef} type="file" accept="application/json,.json" className="hidden" onChange={onCustomerImportPick} />
                </>
              )}
              {tab === 'dealer' && (
                <>
                  <button type="button" className={btnExport} onClick={exportDealers}>ส่งออกเจ้ามือ</button>
                  <button type="button" className={btnImport} onClick={() => dealerImportRef.current?.click()}>นำเข้าเจ้ามือ</button>
                  <input ref={dealerImportRef} type="file" accept="application/json,.json" className="hidden" onChange={onDealerImportPick} />
                </>
              )}
            </div>
          ) : undefined
        }
      />

      <main className="flex flex-col flex-1 min-h-0 overflow-hidden px-4 pb-4 gap-3">
        {/* Segmented tab control */}
        <div className="shrink-0 flex items-center gap-3 pt-1">
          <div className="inline-flex bg-[var(--bg-glass-subtle)] rounded-xl p-1 border border-[var(--color-border)] gap-0.5">
            {TABS.map(t => (
              <button
                key={t.key}
                onClick={() => switchTab(t.key)}
                className={`px-4 py-1.5 text-sm font-semibold rounded-lg transition-all duration-150 leading-none ${
                  tab === t.key
                    ? 'bg-white shadow-sm text-theme-text-primary'
                    : 'text-theme-text-muted hover:text-theme-text-secondary hover:bg-white/40'
                }`}
              >
                {t.label}
                <span className="ml-1.5 text-[10px] font-normal opacity-60 hidden sm:inline">— {t.sub}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {tab === 'customer' && <CustomerSection reloadToken={customerReload} />}
          {tab === 'dealer'   && <DealerSection   reloadToken={dealerReload} />}
        </div>
      </main>
    </AppShell>
  );
}

export default function ContactsPage() {
  return <Suspense><ContactsPageInner /></Suspense>;
}
