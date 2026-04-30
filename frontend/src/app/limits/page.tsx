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

/**
 * คอลัมน์ราคา / % — ให้ 2 ตัวและ 3 ตัวอ่านสอดคล้องกัน:
 * แสดงยอดจ่ายต่อบาท (จาก custom_payout หรือคำนวณจากเรทมาตรฐาน × %) ตามด้วย % เมื่อไม่ใช่ 100%
 */
function formatLimitPayoutCell(l: NumberLimit): string {
  const pctRaw = Number(l.payout_pct);
  const pct = Number.isFinite(pctRaw) ? Math.round(pctRaw) : 100;
  const def = DEFAULT_PAYOUT_RATES[l.bet_type];
  const useCustom = l.custom_payout != null && Number(l.custom_payout) > 0;
  const rateNum = useCustom ? Number(l.custom_payout) : def * (pct / 100);
  const rounded = Math.round(rateNum);
  const rateStr =
    Math.abs(rateNum - rounded) < 1e-6
      ? rounded.toLocaleString('th-TH')
      : Number(rateNum.toFixed(2)).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

  if (pct === 100) {
    if (!useCustom) return '-';
    return rateStr;
  }
  return `${rateStr} · ${pct}%`;
}

// ─── sub-components ───────────────────────────────────────────────────────────

interface LimitTableProps {
  limits: NumberLimit[];
  customers: Customer[];
  dealers: Dealer[];
  dealerLimits?: NumberLimit[];
  selectedId: string | null;
  tab: Tab;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
}

function LimitTable({ limits, customers, dealers, dealerLimits, selectedId, tab, onSelect, onDelete }: LimitTableProps) {
  const [filterBetType, setFilterBetType] = useState<BetType | ''>('');
  const [filterNumber, setFilterNumber] = useState('');

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

  // For customer tab: collapse per-customer duplicates into unique number+bet_type groups
  const collapsedLimits = tab === 'customer'
    ? (() => {
        const seen = new Map<string, NumberLimit & { custCount: number }>();
        for (const l of limits) {
          const key = `${l.number}||${l.bet_type}||${l.custom_payout}||${l.payout_pct}||${l.is_blocked}`;
          if (!seen.has(key)) seen.set(key, { ...l, custCount: 1 });
          else seen.get(key)!.custCount++;
        }
        return Array.from(seen.values());
      })()
    : limits as (NumberLimit & { custCount?: number })[];

  const displayLimits = collapsedLimits
    .filter(l => !filterBetType || l.bet_type === filterBetType)
    .filter(l => !filterNumber || l.number.includes(filterNumber.trim()));

  return (
    <>
      {/* Filter bar */}
      <div className="flex gap-2 mb-2">
        <input
          type="text"
          placeholder="กรองเลข..."
          value={filterNumber}
          onChange={e => setFilterNumber(e.target.value)}
          className="flex-1 bg-surface-200 border border-border rounded px-2 py-1 text-xs text-theme-text-primary placeholder:text-theme-text-muted"
        />
        <select
          value={filterBetType}
          onChange={e => setFilterBetType(e.target.value as BetType | '')}
          className="bg-surface-200 border border-border rounded px-2 py-1 text-xs text-theme-text-primary"
        >
          <option value="">ทุกประเภท</option>
          {BET_TYPES.map(bt => (
            <option key={bt} value={bt}>{BET_TYPE_LABELS[bt]}</option>
          ))}
        </select>
      </div>
      {displayLimits.length === 0
        ? <p className="text-theme-text-muted text-sm py-6 text-center">ไม่มีรายการ</p>
        : <div className="overflow-auto max-h-[calc(100vh-300px)]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 bg-surface-100 text-theme-text-secondary">
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
          {displayLimits.map((l) => (
            <tr
              key={l.id}
              onClick={() => onSelect(l.id)}
              className={`cursor-pointer border-b border-border/50 transition-colors duration-200 [transition-timing-function:var(--ease-premium,cubic-bezier(0.22,1,0.36,1))] ${
                l.id === selectedId ? 'bg-[var(--color-nav-active-bg)]' : 'hover:bg-[var(--bg-hover)]'
              }`}
            >
              <td className="px-3 py-2 text-theme-text-secondary">{BET_TYPE_LABELS[l.bet_type]}</td>
              <td className="px-3 py-2 text-center font-mono font-semibold text-theme-text-primary">{l.number}</td>
              <td className="px-3 py-2 text-center text-theme-text-secondary tabular-nums">
                {formatLimitPayoutCell(l)}
              </td>
              <td className="px-3 py-2 text-center">
                {l.is_blocked ? (
                  <span className="text-loss font-bold">✓</span>
                ) : (
                  <span className="text-theme-text-muted">-</span>
                )}
              </td>
              <td className="px-3 py-2 text-theme-text-secondary">
                {tab === 'customer' && (l as NumberLimit & { custCount?: number }).custCount != null ? (
                  <span className="text-[10px] bg-[var(--color-badge-neutral-bg)] border border-[var(--color-badge-neutral-border)] text-theme-text-secondary rounded px-1.5 py-0.5">
                    ลูกค้าทุกคน {(l as NumberLimit & { custCount: number }).custCount > 1 ? `(${(l as NumberLimit & { custCount: number }).custCount})` : ''}
                  </span>
                ) : (
                  <>
                    {entityName(l)}
                    {l.entity_type === 'all' && (
                      <span className="ml-1.5 text-[10px] bg-[var(--color-badge-neutral-bg)] border border-[var(--color-badge-neutral-border)] text-theme-text-secondary rounded px-1 py-0.5 align-middle">ทุกคน</span>
                    )}
                    {matchesDealer(l) && (
                      <span className="ml-1.5 text-[10px] bg-[var(--color-badge-success-bg)] border border-[var(--color-badge-success-border)] text-[var(--color-badge-success-text)] rounded px-1 py-0.5 align-middle">= เจ้ามือ</span>
                    )}
                  </>
                )}
              </td>
              <td className="px-3 py-2 text-right">
                <button
                  onClick={(e) => { e.stopPropagation(); onDelete(l.id); }}
                  className="text-risk-high hover:text-red-300 px-1"
                  title="ลบ"
                >✕</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
      }
    </>
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

  // อั้นทั้ง 3บน + โต็ด พร้อมกัน — ใช้ % เดียวกับในฟอร์ม แต่ให้ backend คำนวณจ่ายแยกตามอัตราแต่ละประเภท
  // (ห้ามใช้ buildPayload แล้วสลับ bet_type เพราะ custom_payout เป็นยอดจ่ายต่อบาทแบบตายตัวจากอัตราประเภทที่เลือก จะทำให้โต๊ดได้เรทเดียวกับ 3 บน)
  const doLimitTopAndTote = async () => {
    const nums = numbers();
    if (!nums.length) return;
    const pct = parseFloat(form.payoutPct) || 100;
    setBusy(true); setMsg('');
    try {
      const base = {
        round_id: roundId,
        entity_type: entityType,
        entity_id: entityId,
        custom_payout: null as number | null,
        payout_pct: pct,
        is_blocked: false,
        max_amount: null as number | null,
      };
      const payloads = [
        ...nums.map((n) => ({ ...base, number: n, bet_type: '3digit_top' as const })),
        ...nums.map((n) => ({ ...base, number: n, bet_type: '3digit_tote' as const })),
      ];
      await limitsApi.bulkUpsert(roundId, payloads);
      setMsg(`บันทึก 3บน+โต็ด สำเร็จ (${nums.length * 2} รายการ) · ใช้ ${pct}% แยกคำนวณตามอัตราแต่ละประเภท`);
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
        <label className="block text-xs text-theme-text-secondary mb-1">{entityLabel}</label>
        <div className="flex items-center gap-2">
          <select
            value={form.entityId}
            onChange={(e) => set('entityId', e.target.value)}
            disabled={form.allEntities}
            className="flex-1 bg-surface-200 border border-border rounded px-2 py-1.5 text-sm text-theme-text-primary disabled:opacity-40"
          >
            <option value="">-- เลือก{entityLabel} --</option>
            {entities.map((e) => (
              <option key={e.id} value={e.id}>{e.name}</option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-sm text-theme-text-secondary whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={form.allEntities}
              onChange={(e) => set('allEntities', e.target.checked)}
              className="accent"
            />
            ทั้งหมด
          </label>
        </div>
      </div>

      {/* Bet type */}
      <div>
        <label className="block text-xs text-theme-text-secondary mb-1">ประเภท</label>
        <select
          value={form.betType}
          onChange={(e) => handleBetTypeChange(e.target.value as BetType)}
          className="w-full bg-surface-200 border border-border rounded px-2 py-1.5 text-sm text-theme-text-primary"
        >
          {BET_TYPES.map((bt) => (
            <option key={bt} value={bt}>{BET_TYPE_LABELS[bt]}</option>
          ))}
        </select>
      </div>

      {/* Number */}
      <div>
        <label className="block text-xs text-theme-text-secondary mb-1">เลข</label>
        <div className="flex items-center gap-2">
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={form.number}
            onChange={(e) => handleNumberChange(e.target.value.replace(/\D/g, ''))}
            maxLength={3}
            placeholder="000"
            className="flex-1 bg-surface-200 border border-border rounded px-2 py-1.5 text-sm text-theme-text-primary font-mono text-center"
          />
          <label className="flex items-center gap-1 text-sm text-theme-text-secondary whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={form.reverse}
              onChange={(e) => set('reverse', e.target.checked)}
              className="accent"
            />
            กลับเลข
          </label>
        </div>
      </div>

      {/* Payout rate + pct — synced */}
      <div>
        <label className="block text-xs text-theme-text-secondary mb-1">จ่าย</label>
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
            className="flex-1 bg-surface-200 border border-border rounded px-2 py-1.5 text-sm text-theme-text-primary font-mono text-center"
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
              className="bg-surface-300 hover:bg-surface-400 text-theme-btn-primary-fg rounded px-2 py-1 text-xs transition-all duration-theme"
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
              className="w-12 bg-surface-200 border border-border rounded px-1 py-1.5 text-sm text-theme-text-primary font-mono text-center"
            />
            <button
              type="button"
              onClick={() => {
                const newPct = Math.min(100, parseInt(form.payoutPct || '100') + 5);
                const newPayout = parseFloat((defaultRate * newPct / 100).toFixed(2));
                setForm((p) => ({ ...p, payoutPct: String(newPct), customPayout: String(newPayout) }));
              }}
              className="bg-surface-300 hover:bg-surface-400 text-theme-btn-primary-fg rounded px-2 py-1 text-xs transition-all duration-theme"
            >▲</button>
            <span className="text-theme-text-secondary text-sm">%</span>
          </div>
        </div>
      </div>

      {/* Buttons — ปิดรับไว้ล่างสุด (ไม่ค่อยใช้) */}
      <div className="flex flex-col gap-2 mt-1">
        <button
          onClick={doLimit}
          disabled={busy}
          className="btn-toolbar-glow btn-fintech-search w-full !h-auto min-h-[2.5rem] py-2.5 text-sm font-semibold disabled:opacity-50"
        >
          ทำรายการอั้น
        </button>
        {(form.betType === '3digit_top' || form.betType === '3digit_tote') && (
          <button
            onClick={doLimitTopAndTote}
            disabled={busy}
            className="btn-toolbar-glow btn-fintech-spark w-full !h-auto min-h-[2.5rem] py-2.5 text-sm font-semibold disabled:opacity-50"
            title="ใช้ % จ่ายในฟอร์มเดียวกัน ระบบคำนวณยอดจ่ายต่อบาทแยกตามอัตรา 3 บน / โต๊ด"
          >
            อั้น 3บน + โต็ด พร้อมกัน
          </button>
        )}
        <div className="pt-2 mt-1 border-t border-border/70 space-y-1.5">
          <p className="text-[10px] text-theme-text-muted text-center leading-snug px-0.5">
            ปิดรับทันที (ไม่ค่อยใช้)
          </p>
          <button
            onClick={doBlock}
            disabled={busy}
            className="btn-toolbar-glow btn-toolbar-danger w-full !h-auto min-h-[2.25rem] py-2 text-sm font-semibold disabled:opacity-50 opacity-95"
          >
            ปิดรับ
          </button>
        </div>
      </div>

      {msg && (
        <p className={`text-sm text-center mt-1 ${msg.includes('ผิดพลาด') ? 'text-loss' : 'text-green-400'}`}>
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
    const toNum = (v: unknown) => (v == null ? null : Number(v));
    const mapLimit = (l: NumberLimit, entity_type: 'all' | 'customer', entity_id: string | null) => ({
      round_id: roundId, number: l.number, bet_type: l.bet_type,
      entity_type, entity_id,
      custom_payout: toNum(l.custom_payout),
      payout_pct: Number(l.payout_pct) || 100,
      is_blocked: l.is_blocked,
      max_amount: toNum(l.max_amount),
    });
    try {
      // ทุกกรณีบันทึกเป็น per-customer rows (entity_type='customer')
      // เพื่อไม่ให้ทับซ้อนกับ row ของเจ้ามือ (entity_type='all')
      const targetIds = allCustomers
        ? customers.map(c => c.id)
        : [...selectedCust];

      if (targetIds.length === 0) {
        setMsg('ไม่มีลูกค้าในระบบ'); setBusy(false); return;
      }

      const payloads = targetIds.flatMap(custId =>
        dealerLimits.map(l => mapLimit(l, 'customer', custId))
      );
      await limitsApi.bulkUpsert(roundId, payloads);
      setMsg(`คัดลอกสำเร็จ ${dealerLimits.length} รายการ × ${targetIds.length} ลูกค้า`);
      setTimeout(onDone, 800);
    } catch { setMsg('เกิดข้อผิดพลาด'); }
    finally { setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--color-backdrop-overlay)] p-4" onClick={onClose}>
      <div
        className="bg-surface-100 border border-border rounded-xl shadow-[var(--shadow-hover)] w-full max-w-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center justify-between shrink-0">
          <div>
            <h3 className="font-bold text-theme-text-primary text-sm">คัดลอกเลขอั้นจากเจ้ามือ</h3>
            <p className="text-xs text-theme-text-muted mt-0.5">{dealerLimits.length} รายการ — เลือกว่าจะใช้กับลูกค้าใด</p>
          </div>
          <button onClick={onClose} className="text-theme-text-muted hover:text-theme-text-secondary text-lg leading-none">✕</button>
        </div>

        <div className="flex flex-1 min-h-0 overflow-hidden">
          {/* Left: dealer limits preview */}
          <div className="flex-1 border-r border-border overflow-auto">
            <div className="px-3 py-2 text-[10px] text-theme-text-muted uppercase tracking-wider border-b border-border sticky top-0 bg-surface-100">เลขอั้นเจ้ามือที่จะคัดลอก</div>
            {dealerLimits.length === 0
              ? <p className="text-theme-text-muted text-xs italic text-center py-8">ไม่มีเลขอั้นเจ้ามือ</p>
              : (
                <table className="w-full text-xs">
                  <thead className="sticky top-[29px] bg-surface-100 text-theme-text-muted">
                    <tr>
                      <th className="px-3 py-1.5 text-left">ประเภท</th>
                      <th className="px-3 py-1.5 text-center">เลข</th>
                      <th className="px-3 py-1.5 text-center">ราคา / %</th>
                      <th className="px-3 py-1.5 text-center">ปิดรับ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dealerLimits.map((l, i) => (
                      <tr key={l.id} className={`border-b border-border/40 ${i % 2 === 0 ? '' : 'bg-surface-200/20'}`}>
                        <td className="px-3 py-1.5 text-theme-text-secondary">{BET_TYPE_LABELS[l.bet_type]}</td>
                        <td className="px-3 py-1.5 text-center font-mono font-semibold text-theme-text-primary">{l.number}</td>
                        <td className="px-3 py-1.5 text-center text-theme-text-secondary tabular-nums">
                          {l.is_blocked ? '—' : formatLimitPayoutCell(l)}
                        </td>
                        <td className="px-3 py-1.5 text-center">
                          {l.is_blocked ? <span className="text-loss font-bold">✓</span> : <span className="text-theme-text-muted">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>

          {/* Right: customer selection */}
          <div className="w-52 shrink-0 flex flex-col overflow-hidden">
            <div className="px-3 py-2 text-[10px] text-theme-text-muted uppercase tracking-wider border-b border-border">ใช้กับ</div>
            <div className="flex-1 overflow-auto p-3 space-y-2">
              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                allCustomers ? 'bg-accent/15 border-accent/35 text-accent-hover' : 'border-border text-theme-text-secondary hover:border-border'
              }`}>
                <input type="radio" checked={allCustomers} onChange={() => setAllCustomers(true)} className="accent" />
                ลูกค้าทุกคน
              </label>
              <label className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors text-sm ${
                !allCustomers ? 'bg-accent/15 border-accent/35 text-accent-hover' : 'border-border text-theme-text-secondary hover:border-border'
              }`}>
                <input type="radio" checked={!allCustomers} onChange={() => setAllCustomers(false)} className="accent" />
                เลือกลูกค้า
              </label>
              {!allCustomers && (
                <div className="space-y-1 pl-2">
                  {customers.map(c => (
                    <label key={c.id} className="flex items-center gap-2 text-xs text-theme-text-secondary cursor-pointer py-1">
                      <input type="checkbox" className="accent"
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
        <div className="px-5 py-3 border-t border-border flex items-center justify-between shrink-0">
          <span className={`text-xs ${msg.includes('ผิดพลาด') ? 'text-loss' : 'text-profit'}`}>{msg}</span>
          <div className="flex gap-2">
            <button onClick={onClose} className="h-8 px-4 rounded-lg bg-surface-200 hover:bg-surface-300 text-sm text-theme-text-secondary transition-colors border border-border">
              ยกเลิก
            </button>
            <button onClick={handleConfirm} disabled={busy || dealerLimits.length === 0}
              className="btn-primary-glow h-8 px-5 text-sm rounded-xl">
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
        // Customer tab: per-customer rows only (entity_type='customer')
        // 'all' rows belong to dealer configuration — shown in dealer tab
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
    try {
      await limitsApi.deleteById(roundId, id);
    } catch {
      // ignore if already deleted
    }
    setSelectedId(null);
    fetchLimits();
    fetchDealerLimits();
  };

  const handleDeleteAll = async () => {
    if (!roundId) return;
    if (!confirm('ลบเลขอั้นทั้งหมดในแท็บนี้?')) return;
    try {
      if (tab === 'dealer') {
        await Promise.all([
          limitsApi.deleteAll(roundId, 'all'),
          limitsApi.deleteAll(roundId, 'dealer'),
        ]);
      } else {
        await limitsApi.deleteAll(roundId, 'customer');
      }
    } catch {
      // ignore
    }
    setSelectedId(null);
    fetchLimits();
    fetchDealerLimits();
  };

  /** ลบทุก entity_type ในงวด (ลูกค้า + เจ้ามือ + ทั่วไป) — หน้าตัดอ้างอิงแค่ all+dealer แต่ล้างครบกันข้อมูลค้าง */
  const handlePurgeAllLimitsInRound = async () => {
    if (!roundId) return;
    if (!confirm(
      'ลบเลขอั้นทั้งหมดของงวดนี้ทุกประเภท (ลูกค้า + เจ้ามือ + ทั่วไป)?\n'
      + 'ปุ่ม "ลบทั้งหมด" ในแต่ละแท็บลบเฉพาะแท็บนั้น — ปุ่มนี้เคลียร์ทั้งฐานข้อมูลของงวด',
    )) return;
    try {
      await limitsApi.deleteAll(roundId);
    } catch {
      // ignore
    }
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
            className="bg-surface-200 border border-border rounded px-3 py-1.5 text-sm text-theme-text-primary"
          >
            <option value="">-- เลือกงวด --</option>
            {rounds.map((r) => (
              <option key={r.id} value={r.id}>{r.name}</option>
            ))}
          </select>

          <div className="flex border border-border rounded-xl overflow-hidden">
            <button
              onClick={() => setTab('customer')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-all ${
                tab === 'customer' ? 'btn-primary-glow rounded-none' : 'bg-surface-200 text-theme-text-secondary hover:bg-surface-300 rounded-none'
              }`}
            >
              อั้นเลขลูกค้า
            </button>
            <button
              onClick={() => setTab('dealer')}
              className={`flex-1 px-4 py-2 text-sm font-medium transition-all ${
                tab === 'dealer' ? 'btn-primary-glow rounded-none' : 'bg-surface-200 text-theme-text-secondary hover:bg-surface-300 rounded-none'
              }`}
            >
              เลขอั้นเจ้ามือ
            </button>
          </div>

          <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
            {roundId && (
              <button
                type="button"
                onClick={handlePurgeAllLimitsInRound}
                className="text-xs px-2 py-1 rounded-lg border border-risk-medium/50 bg-risk-medium/10 text-risk-medium hover:bg-risk-medium/20 transition-all duration-theme"
                title="ลบทุกแถว number_limits ของงวดนี้ (ทุก entity_type)"
              >
                ล้างทั้งงวด (ทุกแท็บ)
              </button>
            )}
            <span className="text-xs text-theme-text-muted">{limits.length} รายการ{loading ? ' (โหลด...)' : ''}</span>
          </div>
        </div>

        {/* Split panel */}
        {roundId ? (
          <div className="flex gap-4 min-h-0 flex-1">
            {/* Left: table */}
            <div className="flex-[3] bg-surface-100 border border-border rounded-lg p-3 overflow-hidden">
              {limits.length > 0 && (
                <div className="flex justify-end mb-2">
                  <button
                    onClick={handleDeleteAll}
                    className="text-xs px-2 py-1 rounded bg-[var(--color-badge-danger-bg)] border-[var(--color-badge-danger-border)] text-loss hover:bg-risk-high/20 transition-all duration-theme"
                  >
                    ลบทั้งหมด
                  </button>
                </div>
              )}
              <LimitTable
                limits={limits}
                customers={customers}
                dealers={dealers}
                dealerLimits={dealerLimits}
                selectedId={selectedId}
                tab={tab}
                onSelect={setSelectedId}
                onDelete={handleDelete}
              />
            </div>

            {/* Right: form */}
            <div className="flex-[2] bg-surface-100 border border-border rounded-lg p-4 overflow-y-auto">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-border gap-2">
                <p className="text-sm font-semibold text-theme-text-secondary">
                  {tab === 'customer' ? 'อั้นเลขลูกค้า' : 'เลขอั้นเจ้ามือ'}
                </p>
                {tab === 'customer' && dealerLimits.length > 0 && (
                  <button
                    onClick={() => setShowCopyModal(true)}
                    className="text-xs px-3 py-1.5 rounded-lg bg-[var(--color-badge-success-bg)] border border-[var(--color-badge-success-border)] text-[var(--color-badge-success-text)] hover:opacity-90 transition-opacity duration-200 shrink-0">
                    คัดลอกจากเจ้ามือ ({dealerLimits.length})
                  </button>
                )}
              </div>
              {tab === 'customer' && (
                <p className="text-[11px] text-theme-text-muted leading-relaxed mb-3 px-0.5 rounded-lg border border-border/40 bg-surface-200/25 py-2">
                  <span className="font-semibold text-theme-text-secondary">อั้นแยกจากเจ้ามือ:</span>{' '}
                  เลือกลูกค้าหรือติ๊ก «ทั้งหมด» แล้วกรอกเลขกด «ทำรายการอั้น» ได้เลย ไม่จำเป็นต้องกดคัดลอก
                  — ระบบใช้เฉพาะค่าที่คุณตั้งในฟอร์มนี้ ป้าย «= เจ้ามือ» ในรายการแค่บอกว่าค่าตรงกับเลขอั้นเจ้ามือเท่านั้น
                </p>
              )}
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
          <p className="text-theme-text-muted text-sm text-center py-12">กรุณาเลือกงวด</p>
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
