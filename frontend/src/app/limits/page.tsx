'use client';
import { useEffect, useState, useCallback } from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { Header } from '@/components/layout/Header';
import { roundsApi, limitsApi, customersApi, dealersApi } from '@/lib/api';
import {
  Round, NumberLimit, BetType, BET_TYPE_LABELS,
  Customer, Dealer, DEFAULT_PAYOUT_RATES,
} from '@/types';

// ─── helpers ──────────────────────────────────────────────────────────────────

function getPermutations(n: string): string[] {
  const chars = n.split('');
  const result = new Set<string>();
  const permute = (arr: string[], current: string) => {
    if (arr.length === 0) { result.add(current); return; }
    for (let i = 0; i < arr.length; i++) {
      permute([...arr.slice(0, i), ...arr.slice(i + 1)], current + arr[i]);
    }
  };
  permute(chars, '');
  return [...result].filter((p) => p !== n);
}

const BET_TYPES: BetType[] = [
  '3digit_top', '3digit_tote', '3digit_back',
  '2digit_top', '2digit_bottom',
  '1digit_top', '1digit_bottom',
];

// ─── sub-components ───────────────────────────────────────────────────────────

interface LimitTableProps {
  limits: NumberLimit[];
  customers: Customer[];
  dealers: Dealer[];
  dealerLimits?: NumberLimit[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function LimitTable({ limits, customers, dealers, dealerLimits, selectedId, onSelect, onDelete }: LimitTableProps) {
  const entityName = (l: NumberLimit) => {
    if (l.entity_type === 'all') return 'ทั้งหมด';
    const c = customers.find((x) => x.id === l.entity_id);
    if (c) return c.name;
    const d = dealers.find((x) => x.id === l.entity_id);
    if (d) return d.name;
    return '-';
  };

  const matchesDealer = (l: NumberLimit) =>
    l.entity_type === 'customer' && (dealerLimits ?? []).some(
      d => d.number === l.number && d.bet_type === l.bet_type &&
           d.payout_pct === l.payout_pct && d.is_blocked === l.is_blocked
    );

  if (limits.length === 0)
    return <p className="text-slate-500 text-sm py-6 text-center">ยังไม่มีรายการอั้นเลข</p>;

  return (
    <div className="overflow-auto max-h-[calc(100vh-260px)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-slate-800 text-slate-400">
          <tr>
            <th className="px-3 py-2 text-left">ประเภท</th>
            <th className="px-3 py-2 text-center">เลข</th>
            <th className="px-3 py-2 text-center">ราคา / %</th>
            <th className="px-3 py-2 text-center">ปิดรับ</th>
            <th className="px-3 py-2 text-left">ลูกค้า/เจ้ามือ</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {limits.map((l) => (
            <tr
              key={l.id}
              onClick={() => onSelect(l.id)}
              className={`cursor-pointer border-b border-slate-700/50 transition-colors ${
                l.id === selectedId ? 'bg-blue-900/40' : 'hover:bg-slate-700/40'
              }`}
            >
              <td className="px-3 py-2 text-slate-300">{BET_TYPE_LABELS[l.bet_type]}</td>
              <td className="px-3 py-2 text-center font-mono text-yellow-300">{l.number}</td>
              <td className="px-3 py-2 text-center text-slate-300">
                {l.custom_payout != null
                  ? l.custom_payout
                  : l.payout_pct !== 100
                  ? `${l.payout_pct}%`
                  : '-'}
              </td>
              <td className="px-3 py-2 text-center">
                {l.is_blocked ? (
                  <span className="text-red-400 font-bold">✓</span>
                ) : (
                  <span className="text-slate-600">-</span>
                )}
              </td>
              <td className="px-3 py-2 text-slate-400">
                {entityName(l)}
                {matchesDealer(l) && (
                  <span className="ml-1.5 text-[10px] bg-emerald-900/30 border border-emerald-600/30 text-emerald-400 rounded px-1 py-0.5 align-middle">= เจ้ามือ</span>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(l.id); }}
                  className="text-red-500 hover:text-red-300 px-1"
                  title="ลบ"
                >✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── main form panel ──────────────────────────────────────────────────────────

type Tab = 'customer' | 'dealer';

interface FormState {
  entityId: string;        // '' = ทั้งหมด
  allEntities: boolean;
  betType: BetType;
  number: string;
  reverse: boolean;
  customPayout: string;    // direct จ่าย override
  payoutPct: string;       // 0-100
}

const defaultForm = (): FormState => ({
  entityId: '',
  allEntities: true,
  betType: '3digit_top',
  number: '',
  reverse: false,
  customPayout: String(DEFAULT_PAYOUT_RATES['3digit_top']),
  payoutPct: '100',
});

interface RightFormProps {
  tab: Tab;
  customers: Customer[];
  dealers: Dealer[];
  dealerLimits?: NumberLimit[];
  roundId: string;
  selectedLimitId: string | null;
  onSave: () => void;
}

function RightForm({ tab, customers, dealers, dealerLimits, roundId, selectedLimitId, onSave }: RightFormProps) {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const set = (k: keyof FormState, v: unknown) => setForm((p) => ({ ...p, [k]: v }));

  const handleNumberChange = (val: string) =>
    setForm(p => ({ ...p, number: val }));

  const handleBetTypeChange = (bt: BetType) =>
    setForm(p => ({ ...p, betType: bt, customPayout: String(DEFAULT_PAYOUT_RATES[bt]), payoutPct: '100' }));

  const entityType = form.allEntities ? 'all' : tab;
  const entityId   = form.allEntities ? null : (form.entityId || null);

  // Default จ่าย based on bet type
  const defaultRate = DEFAULT_PAYOUT_RATES[form.betType];

  const buildPayload = (num: string) => {
    const pct = parseFloat(form.payoutPct) || 100;
    const rate = parseFloat(form.customPayout);
    return {
      round_id:      roundId,
      number:        num,
      bet_type:      form.betType,
      entity_type:   entityType,
      entity_id:     entityId,
      custom_payout: (!isNaN(rate) && rate > 0) ? rate : null,
      payout_pct:    pct,
      is_blocked:    false,
      max_amount:    null,
    };
  };

  const numbers = (): string[] => {
    const base = form.number.trim();
    if (!base) return [];
    const list = [base];
    if (form.reverse) list.push(...getPermutations(base));
    return [...new Set(list)];
  };

  const doBlock = async () => {
    const nums = numbers();
    if (!nums.length) return;
    setBusy(true); setMsg('');
    try {
      const payloads = nums.map((n) => ({
        round_id:      roundId,
        number:        n,
        bet_type:      form.betType,
        entity_type:   entityType,
        entity_id:     entityId,
        is_blocked:    true,
        custom_payout: null,
        payout_pct:    100,
        max_amount:    null,
      }));
      if (payloads.length === 1) await limitsApi.upsert(roundId, payloads[0]);
      else await limitsApi.bulkUpsert(roundId, payloads);
      setMsg('ปิดรับสำเร็จ');
      onSave();
    } catch { setMsg('เกิดข้อผิดพลาด'); }
    setBusy(false);
  };

  const doLimit = async () => {
    const nums = numbers();
    if (!nums.length) return;
    setBusy(true); setMsg('');
    try {
      const payloads = nums.map((n) => buildPayload(n));
      if (payloads.length === 1) await limitsApi.upsert(roundId, payloads[0]);
      else await limitsApi.bulkUpsert(roundId, payloads);
      setMsg('บันทึกสำเร็จ');
      onSave();
    } catch { setMsg('เกิดข้อผิดพลาด'); }
    setBusy(false);
  };

  const doCancel = async () => {
    if (!selectedLimitId) { setMsg('กรุณาเลือกรายการจากตาราง'); return; }
    setBusy(true); setMsg('');
    try {
      await limitsApi.deleteById(roundId, selectedLimitId);
      setMsg('ยกเลิกการอั้นสำเร็จ');
      onSave();
    } catch { setMsg('เกิดข้อผิดพลาด'); }
    setBusy(false);
  };

  const doLimitAll = async () => {
    const base = form.number.trim();
    if (!base) return;
    const perms = getPermutations(base);
    if (!perms.length) { setMsg('ไม่มีเลขสลับ'); return; }
    setBusy(true); setMsg('');
    try {
      const payloads = [base, ...perms].map((n) => buildPayload(n));
      await limitsApi.bulkUpsert(roundId, payloads);
      setMsg(`อั้นเลขติด ${payloads.length} รายการสำเร็จ`);
      onSave();
    } catch { setMsg('เกิดข้อผิดพลาด'); }
    setBusy(false);
  };

  const doFinish = () => { setForm(defaultForm()); setMsg(''); };

  const entities = tab === 'customer' ? customers : dealers;
  const entityLabel = tab === 'customer' ? 'ลูกค้า' : 'เจ้ามือ';

  return (
    <div className="flex flex-col gap-3">
      {/* Entity row */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">{entityLabel}</label>
        <div className="flex items-center gap-2">
          <select
            value={form.entityId}
            onChange={(e) => set('entityId', e.target.value)}
            disabled={form.allEntities}
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 disabled:opacity-40"
          >
            <option value="">-- เลือก{entityLabel} --</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm text-slate-300 whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={form.allEntities}
              onChange={(e) => set('allEntities', e.target.checked)}
              className="accent-blue-500"
            />
            ทั้งหมด
          </label>
        </div>
      </div>

      {/* Bet type */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">ประเภท</label>
        <select
          value={form.betType}
          onChange={(e) => handleBetTypeChange(e.target.value as BetType)}
          className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200"
        >
          {BET_TYPES.map((bt) => (
            <option key={bt} value={bt}>{BET_TYPE_LABELS[bt]}</option>
          ))}
        </select>
      </div>

      {/* Number */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">เลข</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.number}
            onChange={(e) => handleNumberChange(e.target.value.replace(/\D/g, ''))}
            maxLength={3}
            placeholder="000"
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-mono text-center"
          />
          <label className="flex items-center gap-1 text-sm text-slate-300 whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={form.reverse}
              onChange={(e) => set('reverse', e.target.checked)}
              className="accent-blue-500"
            />
            กลับเลข
          </label>
        </div>
      </div>

      {/* Payout rate + pct — synced */}
      <div>
        <label className="block text-xs text-slate-400 mb-1">จ่าย</label>
        <div className="flex items-center gap-2">
          {/* จ่าย field: typing here recomputes % */}
          <input
            type="text"
            inputMode="decimal"
            value={form.customPayout}
            onChange={(e) => {
              const raw = e.target.value;
              const payout = parseFloat(raw);
              const newPct = isNaN(payout) || defaultRate === 0
                ? form.payoutPct
                : String(Math.round((payout / defaultRate) * 100));
              setForm((p) => ({ ...p, customPayout: raw, payoutPct: newPct }));
            }}
            className="flex-1 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 font-mono text-center"
          />
          <div className="flex items-center gap-1">
            {/* % spinner: changing here recomputes จ่าย */}
            <button
              type="button"
              onClick={() => {
                const newPct = Math.max(0, parseInt(form.payoutPct || '100') - 5);
                const newPayout = parseFloat((defaultRate * newPct / 100).toFixed(2));
                setForm((p) => ({ ...p, payoutPct: String(newPct), customPayout: String(newPayout) }));
              }}
              className="bg-slate-600 hover:bg-slate-500 text-white rounded px-2 py-1 text-xs"
            >▼</button>
            <input
              type="text"
              inputMode="numeric"
              value={form.payoutPct}
              onChange={(e) => {
                const raw = e.target.value.replace(/\D/g, '');
                const pct = parseInt(raw) || 0;
                const newPayout = parseFloat((defaultRate * Math.min(pct, 100) / 100).toFixed(2));
                setForm((p) => ({ ...p, payoutPct: raw, customPayout: String(newPayout) }));
              }}
              className="w-12 bg-slate-700 border border-slate-600 rounded px-1 py-1.5 text-sm text-slate-200 font-mono text-center"
            />
            <button
              type="button"
              onClick={() => {
                const newPct = Math.min(100, parseInt(form.payoutPct || '100') + 5);
                const newPayout = parseFloat((defaultRate * newPct / 100).toFixed(2));
                setForm((p) => ({ ...p, payoutPct: String(newPct), customPayout: String(newPayout) }));
              }}
              className="bg-slate-600 hover:bg-slate-500 text-white rounded px-2 py-1 text-xs"
            >▲</button>
            <span className="text-slate-400 text-sm">%</span>
          </div>
        </div>
      </div>

      {/* Buttons */}
      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={doBlock}
          disabled={busy}
          className="w-full bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white rounded py-2 text-sm font-semibold transition-colors"
        >
          ปิดรับ
        </button>
        <button
          onClick={doLimit}
          disabled={busy}
          className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded py-2 text-sm font-semibold transition-colors"
        >
          ทำรายการอั้น
        </button>
        <button
          onClick={doCancel}
          disabled={busy}
          className="w-full bg-amber-600 hover:bg-amber-500 disabled:opacity-50 text-white rounded py-2 text-sm font-semibold transition-colors"
        >
          ยกเลิกการอั้น
        </button>
        <button
          onClick={doLimitAll}
          disabled={busy}
          className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50 text-white rounded py-2 text-sm font-semibold transition-colors"
        >
          อั้นเลขติด
        </button>
        <button
          onClick={doFinish}
          className="w-full bg-slate-600 hover:bg-slate-500 text-white rounded py-2 text-sm font-semibold transition-colors"
        >
          จบการทำงาน
        </button>
      </div>

      {msg && (
        <p className={`text-sm text-center mt-1 ${msg.includes('ผิดพลาด') ? 'text-red-400' : 'text-green-400'}`}>
          {msg}
        </p>
      )}
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

// ─── Copy-from-dealer modal ────────────────────────────────────────────────────
interface CopyFromDealerModalProps {
  dealerLimits: NumberLimit[];
  customers: Customer[];
  roundId: string;
  onClose: () => void;
  onDone: () => void;
}

function CopyFromDealerModal({ dealerLimits, customers, roundId, onClose, onDone }: CopyFromDealerModalProps) {
  const [allCustomers, setAllCustomers] = useState(true);
  const [selectedCust, setSelectedCust] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  const toggleCust = (id: string) =>
    setSelectedCust(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleConfirm = async () => {
    if (dealerLimits.length === 0) { setMsg('ไม่มีเลขอั้นเจ้ามือ'); return; }
    if (!allCustomers && selectedCust.size === 0) { setMsg('กรุณาเลือกลูกค้าอย่างน้อย 1 ราย'); return; }
    setBusy(true); setMsg('');
    try {
      if (allCustomers) {
        // entity_type: 'all' — applies to all customers
        const payloads = dealerLimits.map(l => ({
          round_id: roundId, number: l.number, bet_type: l.bet_type,
          entity_type: 'all' as const, entity_id: null,
          custom_payout: l.custom_payout ?? null,
          payout_pct: l.payout_pct, is_blocked: l.is_blocked, max_amount: l.max_amount ?? null,
        }));
        await limitsApi.bulkUpsert(roundId, payloads);
      } else {
        // one row per customer per limit
        const payloads = [...selectedCust].flatMap(custId =>
          dealerLimits.map(l => ({
            round_id: roundId, number: l.number, bet_type: l.bet_type,
            entity_type: 'customer' as const, entity_id: custId,
            custom_payout: l.custom_payout ?? null,
            payout_pct: l.payout_pct, is_blocked: l.is_blocked, max_amount: l.max_amount ?? null,
          }))
        );
        await limitsApi.bulkUpsert(roundId, payloads);
      }
      setMsg(`คัดลอกสำเร็จ ${dealerLimits.length} รายการ`);
      setTimeout(onDone, 800);
    } catch { setMsg('เกิดข้อผิดพลาด'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-slate-800 border border-slate-600 rounded-xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-slate-700 flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-slate-100 text-sm">คัดลอกเลขอั้นจากเจ้ามือ</h3>
            <p className="text-xs text-slate-500 mt-0.5">{dealerLimits.length} รายการ — เลือกว่าจะใช้กับลูกค้าใด</p>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: dealer limits preview */}
          <div className="flex-1 border-r border-slate-700 overflow-auto">
            <div className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-700 sticky top-0 bg-slate-800">เลขอั้นเจ้ามือที่จะคัดลอก</div>
            {dealerLimits.length === 0
              ? <p className="text-slate-600 text-xs italic text-center py-8">ไม่มีเลขอั้นเจ้ามือ</p>
              : (
                <table className="w-full text-xs">
                  <thead className="sticky top-[29px] bg-slate-800 text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left">ประเภท</th>
                      <th className="px-3 py-1.5 text-center">เลข</th>
                      <th className="px-3 py-1.5 text-center">ราคา / %</th>
                      <th className="px-3 py-1.5 text-center">ปิดรับ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealerLimits.map((l, i) => (
                      <tr key={l.id} className={`border-b border-slate-700/40 ${i % 2 === 0 ? '' : 'bg-slate-700/20'}`}>
                        <td className="px-3 py-1.5 text-slate-300">{BET_TYPE_LABELS[l.bet_type]}</td>
                        <td className="px-3 py-1.5 text-center font-mono text-yellow-300">{l.number}</td>
                        <td className="px-3 py-1.5 text-center text-slate-300">
                          {l.is_blocked ? '—' : l.payout_pct !== 100 ? `${l.payout_pct}%` : '100%'}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {l.is_blocked ? <span className="text-red-400 font-bold">✓</span> : <span className="text-slate-600">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>

          {/* Right: customer selection */}
          <div className="w-52 shrink-0 flex flex-col overflow-hidden">
            <div className="px-3 py-2 text-[10px] text-slate-500 uppercase tracking-wider border-b border-slate-700">ใช้กับ</div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                allCustomers ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}>
                <input type="radio" checked={allCustomers} onChange={() => setAllCustomers(true)} className="accent-blue-500" />
                ลูกค้าทุกคน
              </label>
              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                !allCustomers ? 'bg-blue-600/20 border-blue-500/40 text-blue-300' : 'border-slate-600 text-slate-400 hover:border-slate-500'
              }`}>
                <input type="radio" checked={!allCustomers} onChange={() => setAllCustomers(false)} className="accent-blue-500" />
                เลือกลูกค้า
              </label>
              {!allCustomers && (
                <div className="space-y-1 pl-2">
                  {customers.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer py-1">
                      <input type="checkbox" className="accent-blue-500"
                        checked={selectedCust.has(c.id)}
                        onChange={() => toggleCust(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-slate-700 flex items-center justify-between shrink-0">
          <span className={`text-xs ${msg.includes('ผิดพลาด') ? 'text-red-400' : 'text-emerald-400'}`}>{msg}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 px-4 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm text-slate-300 transition-colors border border-slate-600">
              ยกเลิก
            </button>
            <button onClick={handleConfirm} disabled={busy || dealerLimits.length === 0}
              className="h-8 px-5 rounded-lg bg-blue-600 hover:bg-blue-500 text-sm text-white font-semibold transition-colors disabled:opacity-50">
              {busy ? 'กำลังบันทึก…' : `ยืนยัน (${dealerLimits.length} รายการ)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LimitsPage() {
  const [rounds, setRounds]       = useState<Round[]>([]);
  const [roundId, setRoundId]     = useState('');
  const [tab, setTab]             = useState<Tab>('customer');
  const [limits, setLimits]       = useState<NumberLimit[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [dealers, setDealers]     = useState<Dealer[]>([]);
  const [dealerLimits, setDealerLimits] = useState<NumberLimit[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [showCopyModal, setShowCopyModal] = useState(false);

  // ── load rounds, customers, dealers on mount ──
  useEffect(() => {
    roundsApi.list().then((r) => {
      const list: Round[] = r.data.rounds;
      setRounds(list);
      if (list.length) setRoundId(list[0].id);
    });
    customersApi.list().then((r) => setCustomers(r.data.customers ?? r.data));
    dealersApi.list().then((r) => setDealers(r.data.dealers ?? r.data));
  }, []);

  // ── load dealer limits (for badge + toggle) ──
  const fetchDealerLimits = useCallback(async () => {
    if (!roundId) return;
    try {
      const [dlrRes, allRes] = await Promise.all([
        limitsApi.list(roundId, { entity_type: 'dealer' }),
        limitsApi.list(roundId, { entity_type: 'all' }),
      ]);
      const dlrList: NumberLimit[] = dlrRes.data.limits ?? [];
      const allList: NumberLimit[] = allRes.data.limits ?? [];
      // Merge: dealer-specific takes precedence over 'all' for same number+betType
      const seen = new Set<string>();
      const merged = [...dlrList, ...allList].filter(l => {
        const key = `${l.number}:${l.bet_type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      setDealerLimits(merged);
    } catch { /* ignore */ }
  }, [roundId]);

  useEffect(() => { fetchDealerLimits(); }, [fetchDealerLimits]);

  // ── load limits when round or tab changes ──
  const fetchLimits = useCallback(async () => {
    if (!roundId) return;
    setLoading(true);
    try {
      if (tab === 'customer') {
        // Customer tab: show only customer-specific limits (not 'all' / dealer limits)
        const res = await limitsApi.list(roundId, { entity_type: 'customer' });
        setLimits(res.data.limits ?? []);
      } else {
        // Dealer tab: show dealer-specific + 'all' combined
        const [entRes, allRes] = await Promise.all([
          limitsApi.list(roundId, { entity_type: 'dealer' }),
          limitsApi.list(roundId, { entity_type: 'all' }),
        ]);
        const entList: NumberLimit[] = entRes.data.limits ?? [];
        const allList: NumberLimit[] = allRes.data.limits ?? [];
        const combined = [...entList, ...allList];
        const seen = new Set<string>();
        setLimits(combined.filter((l) => { if (seen.has(l.id)) return false; seen.add(l.id); return true; }));
      }
    } finally {
      setLoading(false);
    }
  }, [roundId, tab]);

  useEffect(() => { fetchLimits(); }, [fetchLimits]);

  const handleSave = useCallback(() => {
    fetchLimits();
    fetchDealerLimits();
  }, [fetchLimits, fetchDealerLimits]);

  const handleDelete = async (id: string) => {
    await limitsApi.deleteById(roundId, id);
    setSelectedId(null);
    fetchLimits();
    fetchDealerLimits();
  };

  return (
    <AppShell>
      <Header title="เลขอั้น" subtitle="ตั้งค่าเลขต้องห้ามและอัตราพิเศษ" />

      <main className="flex-1 p-4 flex flex-col gap-4 min-h-0">
        {/* Top bar: round selector + tabs */}
        <div className="flex items-center gap-4 flex-wrap">
          <select
            value={roundId}
            onChange={(e) => setRoundId(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded px-3 py-1.5 text-sm text-slate-200"
          >
            <option value="">-- เลือกงวด --</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          <div className="flex border border-slate-600 rounded overflow-hidden">
            <button
              onClick={() => setTab('customer')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === 'customer' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              อั้นเลขลูกค้า
            </button>
            <button
              onClick={() => setTab('dealer')}
              className={`px-4 py-1.5 text-sm font-medium transition-colors ${
                tab === 'dealer' ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}
            >
              เลขอั้นเจ้ามือ
            </button>
          </div>

          <span className="text-xs text-slate-500 ml-auto">{limits.length} รายการ{loading ? ' (โหลด...)' : ''}</span>
        </div>

        {/* Split panel */}
        {roundId ? (
          <div className="flex gap-4 min-h-0 flex-1">
            {/* Left: table */}
            <div className="flex-[3] bg-slate-800 border border-slate-700 rounded-lg p-3 overflow-hidden">
              <LimitTable
                limits={limits}
                customers={customers}
                dealers={dealers}
                dealerLimits={dealerLimits}
                selectedId={selectedId}
                onSelect={setSelectedId}
                onDelete={handleDelete}
              />
            </div>

            {/* Right: form */}
            <div className="flex-[2] bg-slate-800 border border-slate-700 rounded-lg p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-700">
                <p className="text-sm font-semibold text-slate-300">
                  {tab === 'customer' ? 'อั้นเลขลูกค้า' : 'เลขอั้นเจ้ามือ'}
                </p>
                {tab === 'customer' && dealerLimits.length > 0 && (
                  <button
                    onClick={() => setShowCopyModal(true)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-emerald-700/30 border border-emerald-600/40 text-emerald-300 hover:bg-emerald-700/50 transition-colors">
                    คัดลอกจากเจ้ามือ ({dealerLimits.length})
                  </button>
                )}
              </div>
              <RightForm
                key={tab + roundId}
                tab={tab}
                customers={customers}
                dealers={dealers}
                dealerLimits={dealerLimits}
                roundId={roundId}
                selectedLimitId={selectedId}
                onSave={handleSave}
              />
            </div>
          </div>
        ) : (
          <p className="text-slate-500 text-sm text-center py-12">กรุณาเลือกงวด</p>
        )}
      </main>

      {showCopyModal && (
        <CopyFromDealerModal
          dealerLimits={dealerLimits}
          customers={customers}
          roundId={roundId}
          onClose={() => setShowCopyModal(false)}
          onDone={() => { setShowCopyModal(false); handleSave(); }}
        />
      )}
    </AppShell>
  );
}
