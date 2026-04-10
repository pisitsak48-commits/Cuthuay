'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { roundsApi, betsApi, customersApi } from '@/lib/api';
import { Bet, Round, Customer, BET_TYPE_LABELS, DEFAULT_PAYOUT_RATES } from '@/types';
import { useAppStore, useThemeStore } from '@/store/useStore';
import { wsClient } from '@/lib/websocket';
import {
  parseBetLine, expandNumberInput, describeNumberExpansion,
  parseLineBetsText,
  BetInputMode,
} from '@/lib/betParser';
import { AppShell } from '@/components/layout/AppShell';
import { openPrintPreview } from '@/lib/printPreview';

function getEffectiveRate(customer: Customer | null, betType: string): number {
  if (!customer) return (DEFAULT_PAYOUT_RATES as Record<string, number>)[betType] ?? 0;
  const map: Record<string, keyof Customer> = {
    '3digit_top':    'rate_3top',
    '3digit_tote':   'rate_3tote',
    '3digit_back':   'rate_3back',
    '2digit_top':    'rate_2top',
    '2digit_bottom': 'rate_2bottom',
    '1digit_top':    'rate_1top',
    '1digit_bottom': 'rate_1bottom',
  };
  const key = map[betType];
  const raw = key ? (customer[key] as number | string | null) : null;
  const custom = raw != null ? parseFloat(String(raw)) : null;
  const fallback = (DEFAULT_PAYOUT_RATES as Record<string, number>)[betType] ?? 0;
  return (custom != null && !isNaN(custom) && custom > 0) ? custom : fallback;
}

const COL_TYPES = [
  { key: '3digit_top',    label: '3 ตัวบน'  },
  { key: '3digit_tote',   label: '3 ตัวโต็ด' },
  { key: '3digit_back',   label: '3 ตัวล่าง' },
  { key: '2digit_top',    label: '2 ตัวบน'  },
  { key: '2digit_bottom', label: '2 ตัวล่าง' },
  { key: '1digit_top',    label: 'วิ่งบน'   },
  { key: '1digit_bottom', label: 'วิ่งล่าง'  },
] as const;

type ColKey = typeof COL_TYPES[number]['key'];

function buildRowFromBets(bets: Bet[]): Record<ColKey, number> {
  const row: Record<string, number> = {};
  COL_TYPES.forEach(c => { row[c.key] = 0; });
  bets.forEach(b => { if (row[b.bet_type] !== undefined) row[b.bet_type] += Number(b.amount); });
  return row as Record<ColKey, number>;
}

type PrintItem = { label: string; price: string };

function formatPrintItem(group: { number: string; bets: Bet[] }): PrintItem {
  const row = buildRowFromBets(group.bets);
  const n = group.number;
  const has3top  = row['3digit_top']    > 0;
  const has3tote = row['3digit_tote']   > 0;
  const has3back = row['3digit_back']   > 0;
  const has2top  = row['2digit_top']    > 0;
  const has2bot  = row['2digit_bottom'] > 0;
  const has1top  = row['1digit_top']    > 0;
  const has1bot  = row['1digit_bottom'] > 0;

  if (has3top || has3tote || has3back) {
    const parts = [row['3digit_top'], row['3digit_tote'], row['3digit_back']];
    while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
    return { label: n, price: parts.join('*') };
  }
  if (has2top && has2bot) return { label: n,          price: `${row['2digit_top']}*${row['2digit_bottom']}` };
  if (has2top)            return { label: `บน${n}`,   price: String(row['2digit_top']) };
  if (has2bot)            return { label: `ล่าง${n}`, price: String(row['2digit_bottom']) };
  if (has1top && has1bot) return { label: `วิ่ง${n}`, price: `${row['1digit_top']}*${row['1digit_bottom']}` };
  if (has1top)            return { label: `วิ่งบน${n}`,   price: String(row['1digit_top']) };
  if (has1bot)            return { label: `วิ่งล่าง${n}`, price: String(row['1digit_bottom']) };
  return { label: n, price: '-' };
}

function groupByEntry(bets: Bet[]): { createdAt: string; number: string; bets: Bet[] }[] {
  const map: Record<string, Bet[]> = {};
  bets.forEach(b => {
    // group by timestamp + number: ทำให้ klap แต่ละตัวเลขแสดงเป็น row แยก
    const key = `${b.created_at}||${b.number}`;
    if (!map[key]) map[key] = [];
    map[key].push(b);
  });
  return Object.entries(map)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, bets]) => ({ createdAt: key.split('||')[0], number: bets[0].number, bets }));
}

export default function BetsPage() {
  const [rounds, setRounds]                         = useState<Round[]>([]);
  const [selectedRoundId, setSelectedRoundId]       = useState('');
  const [savedBets, setSavedBets]                   = useState<Bet[]>([]);
  const [customers, setCustomers]                   = useState<Customer[]>([]);
  const [selectedCustomerId, setSelectedCustomerId] = useState('');
  const [loading, setLoading]         = useState(false);
  const [isSaving, setIsSaving]       = useState(false);
  const { setSelectedRound }          = useAppStore();
  const { theme, toggleTheme }         = useThemeStore();

  const [numInput, setNumInput]       = useState('');
  const [amtInput, setAmtInput]       = useState('');
  const [parseError, setParseError]   = useState('');
  const [numHint, setNumHint]         = useState('');
  const [inputMode, setInputMode]     = useState<BetInputMode>('2digit');
  const [isKlap, setIsKlap]           = useState(false);
  const [activeField, setActiveField] = useState<'num' | 'amt'>('num');
  const [numWidth, setNumWidth]       = useState(176);
  const [inputFs, setInputFs]         = useState(48);   // font-size px for the two main inputs
  const [rowFs, setRowFs]             = useState(12);    // font-size px for the bet list table rows
  const [sumFs, setSumFs]             = useState(12);    // font-size px for the right summary panel
  const [sheet, setSheet]             = useState(1);
  const [maxSheets, setMaxSheets]     = useState(1);
  const [selectedGroups, setSelectedGroups] = useState<Set<string>>(new Set());
  const [editModal, setEditModal]     = useState<{ bets: Bet[]; number: string } | null>(null);
  const [editAmt, setEditAmt]         = useState('');
  const [moveModal, setMoveModal]     = useState(false);
  const [moveTarget, setMoveTarget]   = useState(1);
  const [moveTargetCustomerId, setMoveTargetCustomerId] = useState<string>('__same__');
  const [lineModal, setLineModal]     = useState(false);
  const [lineText, setLineText]       = useState('');
  const [ocrLoading, setOcrLoading]   = useState(false);
  const [ocrError, setOcrError]       = useState('');
  const [imgDragOver, setImgDragOver] = useState(false);
  const [searchQ, setSearchQ]         = useState('');

  const numRef      = useRef<HTMLInputElement>(null);
  const amtRef      = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const isDragging  = useRef(false);

  const onDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isDragging.current = true;
    const startX = e.clientX;
    const startW = numWidth;
    const onMove = (ev: MouseEvent) => {
      if (!isDragging.current) return;
      setNumWidth(Math.max(100, Math.min(400, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const fetchRounds = useCallback(async () => {
    const res = await roundsApi.list();          // all rounds, not just open
    const all: Round[] = res.data.rounds ?? [];
    setRounds(all);
    if (all.length && !selectedRoundId) {
      // prefer first open round, otherwise first round
      const preferred = all.find(r => r.status === 'open') ?? all[0];
      setSelectedRoundId(preferred.id);
    }
  }, [selectedRoundId]);

  const fetchBets = useCallback(async () => {
    if (!selectedRoundId) return;
    setLoading(true);
    try {
      const res = await betsApi.list(selectedRoundId);
      setSavedBets(res.data.bets);
    } catch { /* silent refresh failure */ }
    finally { setLoading(false); }
  }, [selectedRoundId]);

  const fetchCustomers = useCallback(async () => {
    const res = await customersApi.list();
    setCustomers(res.data.customers);
  }, []);

  useEffect(() => { fetchRounds(); fetchCustomers(); }, []);
  // Auto-select first customer when list loads and none is selected
  useEffect(() => {
    if (customers.length > 0 && !selectedCustomerId) {
      setSelectedCustomerId(customers[0].id);
    }
  }, [customers]);
  useEffect(() => {
    fetchBets();
    const round = rounds.find(r => r.id === selectedRoundId);
    setSelectedRound(round ?? null);
  }, [selectedRoundId, rounds]);

  useEffect(() => {
    const u1 = wsClient.on('bet_added',       () => fetchBets());
    const u2 = wsClient.on('bets_bulk_added', () => fetchBets());
    const u3 = wsClient.on('bet_deleted',     () => fetchBets());
    return () => { u1(); u2(); u3(); };
  }, [fetchBets]);

  // Reset to sheet 1 whenever customer changes
  useEffect(() => {
    setSheet(1);
    setMaxSheets(1);
    setSelectedGroups(new Set());
  }, [selectedCustomerId]);

  const currentCustomer = customers.find(c => c.id === selectedCustomerId) ?? null;
  const customerIndex = customers.findIndex(c => c.id === selectedCustomerId);
  const navigateCustomer = (dir: 1 | -1) => {
    if (!customers.length) return;
    if (customerIndex < 0) {
      setSelectedCustomerId(dir === 1 ? customers[0].id : customers[customers.length - 1].id);
      return;
    }
    const next = (customerIndex + dir + customers.length) % customers.length;
    setSelectedCustomerId(customers[next].id);
  };

  const onNumChange = (v: string) => {
    // Allow digits, *, - only (for wildcards, range, klap patterns)
    const filtered = v.replace(/[^0-9*\-]/g, '').slice(0, 5);
    setNumInput(filtered); setParseError('');
    if (!filtered.trim()) { setNumHint(''); setInputMode('2digit'); setIsKlap(false); return; }
    setNumHint(describeNumberExpansion(filtered));
    const expanded = expandNumberInput(filtered);
    if (expanded) { setInputMode(expanded.mode); setIsKlap(!!expanded.isKlap); }
  };

  const onAmtChange = (v: string) => {
    // Allow digits, *, +, - only
    const filtered = v.replace(/[^0-9*+\-]/g, '');
    const klapAmt = filtered.trim().endsWith('-');
    setAmtInput(filtered);
    const klapNum = !!expandNumberInput(numInput)?.isKlap;
    setIsKlap(klapAmt || klapNum);
    if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!filtered.trim() || !numInput.trim()) { setParseError(''); return; }
    // *xxx- = กลับโต๊ด → auto-commit
    if (klapAmt) { setTimeout(() => { void commitLineWith(numInput, filtered); }, 0); return; }
    if (klapNum && filtered.trim() && parseFloat(filtered.trim()) > 0) {
      // number-field klap: auto-commit on Enter via onAmtKeyDown, just preview here
    }
    const result = parseBetLine(numInput, filtered);
    setParseError(result.error ?? '');
  };

  const onNumKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
      if (!expandNumberInput(numInput)) { setParseError('รูปแบบเลขไม่ถูกต้อง'); return; }
      setActiveField('amt');
      setTimeout(() => amtRef.current?.focus(), 0);
    }
  };

  const onAmtKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); commitLine(); }
    if (e.key === 'Tab') { e.preventDefault(); setActiveField('num'); setTimeout(() => numRef.current?.focus(), 0); }
  };

  const commitLineWith = async (num: string, amt: string) => {
    if (!num.trim() || !amt.trim()) return;
    if (!selectedCustomerId) { setParseError('กรุณาเลือกลูกค้าก่อนคีย์'); return; }
    if (!selectedRoundId) { setParseError('กรุณาเลือกงวดก่อน'); return; }
    const result = parseBetLine(num, amt);
    if (result.error || !result.bets.length) { setParseError(result.error ?? 'ไม่มีรายการ'); return; }
    setIsSaving(true);
    try {
      await betsApi.bulk(selectedRoundId, result.bets.map(bet => ({
        number: bet.number, bet_type: bet.bet_type, amount: bet.amount,
        payout_rate: getEffectiveRate(currentCustomer, bet.bet_type),
        customer_id: selectedCustomerId || null,
        customer_ref: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name ?? null) : null,
        sheet_no: sheet,
      })));
      await fetchBets();
      setNumInput(''); setParseError(''); setNumHint(''); setActiveField('num');
      setSelectedGroups(new Set());
      setTimeout(() => numRef.current?.focus(), 0);
    } catch (err: unknown) {
      const axiosErr = err as { response?: { data?: { error?: string } } };
      const msg = axiosErr?.response?.data?.error ?? (err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
      setParseError(msg);
    }
    finally { setIsSaving(false); }
  };

  const commitLine = () => { void commitLineWith(numInput, amtInput); };

  const deleteSavedGroup = async (bets: Bet[]) => {
    if (!confirm('ลบโพยนี้?')) return;
    await Promise.all(bets.map(b => betsApi.delete(b.id)));
    await fetchBets();
  };

  const deleteSelectedGroups = async () => {
    if (selectedGroups.size === 0) return;
    if (!confirm(`ลบ ${selectedGroups.size} รายการที่เลือก?`)) return;
    const toDelete = sheetGrouped.filter(g => selectedGroups.has(groupKey(g)));
    await Promise.all(toDelete.flatMap(g => g.bets.map(b => betsApi.delete(b.id))));
    setSelectedGroups(new Set());
    await fetchBets();
  };

  const moveSelectedGroups = async (targetSheet: number) => {
    if (selectedGroups.size === 0) return;
    const toMove = sheetGrouped.filter(g => selectedGroups.has(groupKey(g)));
    const ids = toMove.flatMap(g => g.bets.map(b => b.id));
    const isCustomerChange = moveTargetCustomerId !== '__same__';
    if (isCustomerChange) {
      const targetCust = customers.find(c => c.id === moveTargetCustomerId);
      await betsApi.moveSheet(ids, targetSheet, moveTargetCustomerId || null, targetCust?.name ?? null);
    } else {
      await betsApi.moveSheet(ids, targetSheet);
    }
    setSelectedGroups(new Set());
    setMoveModal(false);
    await fetchBets();
  };

  const handleAddSheet = () => {
    const next = effectiveMaxSheets + 1;
    setMaxSheets(next);
    setSheet(next);
    setSelectedGroups(new Set());
  };

  const handleRemoveSheet = () => {
    const betsInSheet = savedBets.filter(b => (b.sheet_no ?? 1) === sheet);
    if (betsInSheet.length > 0) {
      alert(`แผ่นที่ ${sheet} มีข้อมูล ${betsInSheet.length} รายการ — ลบข้อมูลในแผ่นนี้ก่อน`);
      return;
    }
    if (effectiveMaxSheets <= 1) return;
    const newMax = effectiveMaxSheets - 1;
    setMaxSheets(newMax);
    if (sheet > newMax) setSheet(newMax);
    setSelectedGroups(new Set());
  };

  const openEditModal = () => {
    if (selectedGroups.size !== 1) return;
    const key = Array.from(selectedGroups)[0];
    const group = sheetGrouped.find(g => groupKey(g) === key);
    if (!group) return;
    setEditModal({ bets: group.bets, number: group.number });
    const row = buildRowFromBets(group.bets);
    const parts = COL_TYPES.map(c => row[c.key] > 0 ? row[c.key].toString() : '0');
    setEditAmt(parts.join('+'));
  };

  const saveEdit = async () => {
    if (!editModal || !selectedRoundId) return;
    const result = parseBetLine(editModal.number, editAmt);
    if (result.error || !result.bets.length) { alert(result.error ?? 'รูปแบบไม่ถูกต้อง'); return; }
    await Promise.all(editModal.bets.map(b => betsApi.delete(b.id)));
    await betsApi.bulk(selectedRoundId, result.bets.map(bet => ({
      number: bet.number, bet_type: bet.bet_type, amount: bet.amount,
      payout_rate: getEffectiveRate(currentCustomer, bet.bet_type),
      customer_id: selectedCustomerId || null,
      customer_ref: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name ?? null) : null,
      sheet_no: sheet,
    })));
    setEditModal(null);
    setSelectedGroups(new Set());
    await fetchBets();
  };

  const savedTotal = savedBets.reduce((s, b) => s + Number(b.amount), 0);

  const summaryByType: Record<string, number> = {};
  COL_TYPES.forEach(c => { summaryByType[c.key] = 0; });
  savedBets.forEach(b => { if (summaryByType[b.bet_type] !== undefined) summaryByType[b.bet_type] += Number(b.amount); });

  const customerSavedByType: Record<string, number> = {};
  COL_TYPES.forEach(c => { customerSavedByType[c.key] = 0; });
  if (selectedCustomerId) {
    savedBets.forEach(b => {
      if (b.customer_id === selectedCustomerId && customerSavedByType[b.bet_type] !== undefined) {
        customerSavedByType[b.bet_type] += Number(b.amount);
      }
    });
  }
  const customerSavedTotal = Object.values(customerSavedByType).reduce((a, v) => a + v, 0);

  const handleLineImport = async () => {
    if (!selectedRoundId) { alert('กรุณาเลือกงวดก่อน'); return; }
    const { bets: parsedBets, parsedCount, skippedCount } = parseLineBetsText(lineText);
    if (!parsedBets.length) { alert('ไม่พบรายการที่ถูกต้อง'); return; }
    const betsPayload = parsedBets.map(bet => ({
      number: bet.number, bet_type: bet.bet_type, amount: bet.amount,
      payout_rate: getEffectiveRate(currentCustomer, bet.bet_type),
      customer_id: selectedCustomerId || null,
      customer_ref: selectedCustomerId ? (customers.find(c => c.id === selectedCustomerId)?.name ?? null) : null,
      sheet_no: sheet,
    }));
    try {
      await betsApi.bulk(selectedRoundId, betsPayload);
      await fetchBets();
      alert(`นำเข้าสำเร็จ ${parsedCount} รายการ${skippedCount > 0 ? ` (ข้าม ${skippedCount} บรรทัด)` : ''}`);
    } catch { alert('นำเข้าไม่สำเร็จ'); }
    setLineText('');
    setLineModal(false);
  };

  const handleImageFile = async (file: File) => {
    if (!file.type.startsWith('image/')) { setOcrError('กรุณาเลือกไฟล์รูปภาพ'); return; }
    setOcrLoading(true);
    setOcrError('');
    try {
      const { createWorker } = await import('tesseract.js');
      const worker = await createWorker('tha+eng');
      const { data: { text } } = await worker.recognize(file);
      await worker.terminate();
      const extracted = text.trim();
      if (!extracted) { setOcrError('ไม่พบข้อความในรูป'); return; }
      setLineText(prev => prev ? prev + '\n' + extracted : extracted);
    } catch {
      setOcrError('อ่านรูปไม่สำเร็จ กรุณาลองใหม่');
    } finally {
      setOcrLoading(false);
    }
  };

  const grouped = groupByEntry(savedBets);

  // Customer-specific bets
  const customerBets = selectedCustomerId
    ? savedBets.filter(b => b.customer_id === selectedCustomerId)
    : savedBets;

  // Max sheet for current customer
  const maxSheetFromData = customerBets.length
    ? Math.max(...customerBets.map(b => b.sheet_no ?? 1))
    : 1;
  // effectiveMaxSheets = ใช้ค่า maxSheets (เพิ่มชั่วคราว) หรือ data หากมากกว่า
  const effectiveMaxSheets = Math.max(maxSheets, maxSheetFromData);

  const sheetByType: Record<string, number> = {};
  COL_TYPES.forEach(c => { sheetByType[c.key] = 0; });
  customerBets.filter(b => (b.sheet_no ?? 1) === sheet).forEach(b => {
    if (sheetByType[b.bet_type] !== undefined) sheetByType[b.bet_type] += Number(b.amount);
  });
  const sheetTotal = Object.values(sheetByType).reduce((a, v) => a + v, 0);

  // Filter grouped by current sheet AND current customer
  const groupKey = (g: { createdAt: string; number: string }) => `${g.createdAt}||${g.number}`;
  const sheetGrouped = groupByEntry(
    customerBets.filter(b => (b.sheet_no ?? 1) === sheet)
  );

  // ── Print receipt data ───────────────────────────────────────────────────
  const printItems = sheetGrouped.map(formatPrintItem);
  const printTotal = customerBets.filter(b => (b.sheet_no ?? 1) === sheet)
    .reduce((s, b) => s + Number(b.amount), 0);
  const currentRound = rounds.find(r => r.id === selectedRoundId);
  const printRows: PrintItem[][] = [];
  for (let i = 0; i < printItems.length; i += 4) printRows.push(printItems.slice(i, i + 4));

  const handlePrint = () => {
    const customerName = currentCustomer?.name ?? 'ไม่ระบุลูกค้า';
    const roundName   = currentRound?.name ?? 'ไม่ระบุงวด';
    const printDate   = new Date().toLocaleDateString('th-TH', { year: 'numeric', month: 'long', day: 'numeric' });
    const COLS = 4;
    const thinBorder = 'border:1px solid #bbb;';
    const thickR     = 'border-right:3px solid #666;';

    let bodyRows = '';
    for (let row = 0; row < printRows.length; row++) {
      let cells = '';
      for (let col = 0; col < COLS; col++) {
        const item = printRows[row][col];
        const sepR = col < COLS - 1 ? thickR : '';
        cells += `<td style="${thinBorder}padding:3px 8px;">${item ? item.label : ''}</td>`;
        cells += `<td style="${thinBorder}${sepR}padding:3px 8px;text-align:right;">${item ? item.price : ''}</td>`;
      }
      bodyRows += `<tr${row % 2 === 1 ? ' style="background:#f8f8f0;"' : ''}>${cells}</tr>`;
    }

    let headCells = '';
    for (let c = 0; c < COLS; c++) {
      const sepR = c < COLS - 1 ? thickR : '';
      headCells += `<th style="${thinBorder}background:#f0e68c;padding:5px 8px;text-align:left;min-width:70px;">เลข</th>`;
      headCells += `<th style="${thinBorder}${sepR}background:#f0e68c;padding:5px 8px;text-align:left;min-width:55px;">ราคา</th>`;
    }

    const html = `
      <div style="font-family:'Sarabun','TH Sarabun New',Arial,sans-serif;font-size:13px;color:#000;padding:12px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;font-weight:bold;font-size:15px;margin-bottom:6px;">
          <span>ลูกค้า : ${customerName}</span>
          <span>แผ่นที่ : ${sheet} &nbsp;&nbsp; งวด : ${roundName}</span>
        </div>
        <table style="width:100%;border-collapse:collapse;border:3px solid #000;">
          <thead><tr>${headCells}</tr></thead>
          <tbody>${bodyRows}</tbody>
          <tfoot>
            <tr>
              <td colspan="6" style="${thinBorder}background:#fffde7;border-top:3px solid #000;padding:4px 8px;font-weight:bold;">วันที่พิมพ์ ${printDate}</td>
              <td colspan="2" style="${thinBorder}background:#fffde7;border-top:3px solid #000;padding:4px 8px;text-align:right;font-weight:bold;">รวม &nbsp;&nbsp; ${printTotal.toLocaleString()}</td>
            </tr>
          </tfoot>
        </table>
      </div>`;

    openPrintPreview(html, `โพย — ${customerName} แผ่น${sheet} — ${roundName}`, `โพย_${customerName}_แผ่น${sheet}_${roundName}`);
  };

  return (
    <AppShell>
      <div className="flex flex-col h-screen bg-slate-900 overflow-hidden">

        {/* Top bar */}
        <div className="flex items-center gap-3 px-4 py-2 bg-slate-800 border-b border-slate-700 shrink-0">
          <span className="text-slate-300 text-sm font-semibold">รับแทง</span>
          <div className="w-px h-4 bg-slate-600" />
          <select value={selectedRoundId} onChange={e => setSelectedRoundId(e.target.value)}
            className="h-7 rounded bg-slate-700 border border-slate-600 px-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500">
            {rounds.filter(r => r.status !== 'archived').length === 0
              ? <option value="">— ยังไม่มีงวด —</option>
              : rounds.filter(r => r.status !== 'archived').map(r => {
                  const icon = r.status === 'drawn' ? '✓ ' : r.status === 'closed' ? '■ ' : '';
                  return <option key={r.id} value={r.id}>{icon}{r.name}</option>;
                })
            }
          </select>
          <a href="/rounds" className="text-xs text-emerald-400 hover:underline">+ เริ่มงวดใหม่</a>
          <div className="flex-1" />
          {isSaving && <span className="text-xs text-indigo-400 animate-pulse">กำลังบันทึก...</span>}
          <button
            onClick={toggleTheme}
            title={theme === 'dark' ? 'เปลี่ยนเป็นธีมสว่าง' : 'เปลี่ยนเป็นธีมมืด'}
            className="w-7 h-7 flex items-center justify-center rounded bg-slate-700 border border-slate-600 text-slate-400 hover:text-slate-200 hover:bg-slate-600 transition-colors">
            {theme === 'dark' ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
              </svg>
            )}
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          <div className="flex flex-col flex-1 overflow-hidden">

            {/* Warning: no customer selected */}
            {!selectedCustomerId && (
              <div className="shrink-0 bg-amber-900/40 border-b border-amber-700/50 px-4 py-1.5 text-xs text-amber-300 text-center select-none">
                {customers.length === 0
                  ? <>⚠ ยังไม่มีลูกค้า — <a href="/customers" className="underline">+ เพิ่มลูกค้า</a></>
                  : '⚠ กรุณาเลือกลูกค้าก่อนคีย์โพย'}
              </div>
            )}

            {/* Input header with drag-resize */}
            <div className="flex items-stretch bg-slate-800 border-b border-slate-700 shrink-0 select-none">

              {/* เลข — resizable */}
              <div style={{ width: numWidth, minWidth: 100, maxWidth: 400 }}
                className="flex flex-col items-center justify-center border-r border-slate-700 px-4 py-2 shrink-0 overflow-hidden">
                <span className="text-slate-400 text-xs mb-1 tracking-widest uppercase">เลข</span>
                <input ref={numRef} value={numInput} onChange={e => onNumChange(e.target.value)}
                  onKeyDown={onNumKeyDown} onFocus={() => setActiveField('num')} autoFocus placeholder="123"
                  style={{ fontSize: inputFs, lineHeight: 1.1 }}
                  className={`w-full text-center font-bold font-mono bg-transparent text-slate-100 placeholder:text-slate-700 placeholder:text-xl focus:outline-none caret-indigo-400 ${activeField === 'num' ? 'border-b-2 border-indigo-400' : 'border-b-2 border-transparent'}`} />
                {numHint && <span className="text-xs text-slate-500 mt-1">{numHint}</span>}
              </div>

              {/* Drag handle */}
              <div onMouseDown={onDividerMouseDown}
                className="w-1.5 shrink-0 cursor-col-resize bg-slate-700 hover:bg-indigo-500 active:bg-indigo-400 transition-colors" />

              {/* ราคา — flex-1 */}
              <div className="flex flex-col items-center justify-center flex-1 px-6 py-2 relative overflow-hidden">
                <span className="text-slate-400 text-xs mb-1 tracking-widest uppercase">ราคา</span>
                <input ref={amtRef} value={amtInput} onChange={e => onAmtChange(e.target.value)}
                  onKeyDown={onAmtKeyDown} onFocus={() => setActiveField('amt')}
                  placeholder={inputMode === 'run' ? 'วิ่งบน*ล่าง' : inputMode === '2digit' ? 'บน*ล่าง หรือ 100-' : '3บน*โต็ด*3ล่าง'}
                  style={{ fontSize: inputFs, lineHeight: 1.1 }}
                  className={`w-full text-center font-bold font-mono bg-transparent text-slate-100 placeholder:text-slate-700 placeholder:text-xl focus:outline-none caret-indigo-400 ${activeField === 'amt' ? 'border-b-2 border-indigo-400' : 'border-b-2 border-transparent'}`} />
                {parseError && <span className="text-xs text-red-400 mt-1">{parseError}</span>}
                {!parseError && isKlap && (() => {
                  const v = amtInput.trim();
                  const isKlapTote = inputMode === '3digit' && v.startsWith('*') && v.endsWith('-') && !v.slice(1).includes('*');
                  const isKlapBoth = inputMode === '3digit' && v.endsWith('-') && !isKlapTote && !!v.slice(0,-1).match(/^\d+\*\d+$/);
                  const label = isKlapBoth ? 'กลับบน+โต็ด' : isKlapTote ? 'กลับโต็ด' : 'กลับเลข';
                  const cls   = isKlapBoth ? 'text-fuchsia-400' : isKlapTote ? 'text-purple-400' : 'text-amber-400';
                  return <span className={`text-xs mt-1 ${cls}`}>{label}</span>;
                })()}
                <div className="absolute top-2 right-3 flex gap-1.5">
                  {inputMode === 'run'    && <span className="text-xs px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-300 border border-violet-500/30">วิ่ง</span>}
                  {inputMode === '2digit' && <span className="text-xs px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-300 border border-sky-500/30">2 ตัว</span>}
                  {inputMode === '3digit' && <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">3 ตัว</span>}
                  {isKlap && (() => {
                    const v = amtInput.trim();
                    const isKlapTote = inputMode === '3digit' && v.startsWith('*') && v.endsWith('-') && !v.slice(1).includes('*');
                    const isKlapBoth = inputMode === '3digit' && v.endsWith('-') && !isKlapTote && !!v.slice(0,-1).match(/^\d+\*\d+$/);
                    const label = isKlapBoth ? 'กลับบน+โต็ด' : isKlapTote ? 'กลับโต็ด' : 'กลับ';
                    const cls   = isKlapBoth ? 'bg-fuchsia-500/20 text-fuchsia-300 border-fuchsia-500/30'
                                : isKlapTote ? 'bg-purple-500/20 text-purple-300 border-purple-500/30'
                                : 'bg-amber-500/20 text-amber-300 border-amber-500/30';
                    return <span className={`text-xs px-1.5 py-0.5 rounded border ${cls}`}>{label}</span>;
                  })()}
                </div>
              </div>

              <div className="flex items-center gap-1 px-2 border-l border-slate-700">
                <button title="ลดขนาดตัวเลข" className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold"
                  onClick={() => setInputFs(s => Math.max(24, s - 8))}>A-</button>
                <button title="ขยายขนาดตัวเลข" className="w-7 h-7 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold"
                  onClick={() => setInputFs(s => Math.min(80, s + 8))}>A+</button>
                <button className="w-8 h-8 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-bold ml-1"
                  onClick={() => { setNumInput(''); setAmtInput(''); setParseError(''); setNumHint(''); setTimeout(() => numRef.current?.focus(), 0); }}>C</button>
              </div>
            </div>

            {/* Column headers */}
            <div className="shrink-0 bg-slate-800/80 border-b border-slate-700">
              <table className="w-full table-fixed" style={{ fontSize: rowFs }}>
                <thead>
                  <tr>
                    <th className="text-center py-1.5 px-1 text-slate-500 w-7">
                      <input type="checkbox" className="accent-indigo-500"
                        checked={sheetGrouped.length > 0 && selectedGroups.size === sheetGrouped.length}
                        onChange={e => {
                          if (e.target.checked) setSelectedGroups(new Set(sheetGrouped.map(g => groupKey(g))));
                          else setSelectedGroups(new Set());
                        }} />
                    </th>
                    <th className="text-left py-1.5 px-3 text-slate-500 w-7">#</th>
                    <th className="text-left py-1.5 px-3 text-slate-400 font-semibold w-16">เลข</th>
                    {COL_TYPES.map(c => (
                      <th key={c.key} className="text-right py-1.5 px-2 text-slate-500 font-normal">{c.label}</th>
                    ))}
                    <th className="text-left py-1.5 px-3 text-slate-500 w-20">เวลา</th>
                    <th className="text-left py-1.5 px-3 text-slate-500 w-16">ลูกค้า</th>
                    <th className="w-6"></th>
                  </tr>
                </thead>
              </table>
            </div>

            {/* Rows */}
            <div className="flex-1 overflow-y-auto">
              <table className="w-full table-fixed" style={{ fontSize: rowFs }}>
                <tbody>
                  {loading ? (
                    <tr><td colSpan={COL_TYPES.length + 6} className="py-6 text-center text-slate-600">กำลังโหลด...</td></tr>
                  ) : sheetGrouped.map((group, idx) => {
                    const key = groupKey(group);
                    const row = buildRowFromBets(group.bets);
                    const firstBet = group.bets[0];
                    const timeStr = new Date(firstBet.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' });
                    const isSelected = selectedGroups.has(key);
                    return (
                      <tr key={`${key}||${idx}`}
                        className={`border-b border-slate-700/30 cursor-pointer ${isSelected ? 'bg-indigo-900/30' : searchQ.trim() && group.number.includes(searchQ.trim()) ? 'bg-amber-900/40 hover:bg-amber-800/30' : idx % 2 === 0 ? 'bg-slate-800/40 hover:bg-slate-700/30' : 'hover:bg-slate-700/20'}`}
                        onClick={() => {
                          const next = new Set(selectedGroups);
                          if (next.has(key)) next.delete(key); else next.add(key);
                          setSelectedGroups(next);
                        }}>
                        <td className="py-1 px-1 w-7 text-center" onClick={e => e.stopPropagation()}>
                          <input type="checkbox" className="accent-indigo-500"
                            checked={isSelected}
                            onChange={e => {
                              const next = new Set(selectedGroups);
                              if (e.target.checked) next.add(key); else next.delete(key);
                              setSelectedGroups(next);
                            }} />
                        </td>
                        <td className="py-1 px-3 text-slate-600 w-7">{idx + 1}</td>
                        <td className="py-1 px-3 font-mono font-bold text-blue-400 w-16">{group.number}</td>
                        {COL_TYPES.map(c => (
                          <td key={c.key} className="py-1 px-2 text-right font-mono text-slate-300">
                            {row[c.key] > 0 ? row[c.key].toLocaleString() : <span className="text-slate-700">0</span>}
                          </td>
                        ))}
                        <td className="py-1 px-3 text-slate-500 font-mono w-20">{timeStr}</td>
                        <td className="py-1 px-3 text-slate-500 w-16 truncate">{firstBet.customer_ref ?? '—'}</td>
                        <td className="py-1 px-1 w-6" onClick={e => e.stopPropagation()}>
                          <button onClick={() => deleteSavedGroup(group.bets)} className="text-slate-700 hover:text-red-400">×</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Bottom status bar */}
            <div className="shrink-0 bg-slate-900 border-t border-slate-700 px-3 py-1 flex items-center gap-2 text-xs text-slate-600">
              <span>แผ่น {sheet}</span>
              <span className="text-slate-700">|</span>
              <span className="font-mono text-emerald-400">{savedBets.filter(b => (b.sheet_no ?? 1) === sheet).reduce((s, b) => s + Number(b.amount), 0).toLocaleString()}</span>
              <span className="ml-auto text-slate-700">{sheetGrouped.length} รายการ {selectedGroups.size > 0 && `(เลือก ${selectedGroups.size})`}</span>
            </div>

            {/* Toolbar */}
            <div className="shrink-0 bg-slate-800 border-t border-slate-600 px-2 py-1.5 flex items-center gap-1.5">
              <button
                onClick={() => { setNumInput(''); setAmtInput(''); setParseError(''); setTimeout(() => numRef.current?.focus(), 0); }}
                className="flex items-center gap-1 h-7 px-3 rounded bg-emerald-700 hover:bg-emerald-600 text-white text-xs font-semibold">
                <span>+</span><span>แทรก</span>
              </button>
              <button
                disabled={selectedGroups.size !== 1}
                onClick={openEditModal}
                className="flex items-center gap-1 h-7 px-3 rounded bg-sky-700 hover:bg-sky-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold">
                <span>✏</span><span>แก้ไข</span>
              </button>
              <button
                disabled={selectedGroups.size === 0}
                onClick={deleteSelectedGroups}
                className="flex items-center gap-1 h-7 px-3 rounded bg-red-700 hover:bg-red-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold">
                <span>×</span><span>ลบ</span>
              </button>
              <button
                disabled={selectedGroups.size === 0}
                onClick={() => { setMoveTarget(1); setMoveTargetCustomerId('__same__'); setMoveModal(true); }}
                className="flex items-center gap-1 h-7 px-3 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold">
                <span>→</span><span>ย้ายแผ่น</span>
              </button>
              <button
                onClick={handlePrint}
                disabled={printItems.length === 0}
                className="flex items-center gap-1 h-7 px-3 rounded bg-amber-700 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-xs font-semibold">
                <span>🖨</span><span>พิมพ์โพย</span>
              </button>
              <div className="w-px h-5 bg-slate-600 mx-1" />
              <span className="text-xs text-slate-500">ขนาด</span>
              <button title="ลดขนาดตาราง" className="h-7 px-2.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold"
                onClick={() => setRowFs(s => Math.max(9, s - 2))}>A−</button>
              <button title="ขยายขนาดตาราง" className="h-7 px-2.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs font-bold"
                onClick={() => setRowFs(s => Math.min(22, s + 2))}>A+</button>
              <button
                onClick={() => {
                  if (selectedGroups.size === sheetGrouped.length) setSelectedGroups(new Set());
                  else setSelectedGroups(new Set(sheetGrouped.map(g => groupKey(g))));
                }}
                className="h-7 px-3 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 text-xs">
                {selectedGroups.size === sheetGrouped.length && sheetGrouped.length > 0 ? 'ยกเลิกทั้งหมด' : 'เลือกทั้งหมด'}
              </button>
            </div>
          </div>

          {/* RIGHT: Summary Panel */}
          <div className="w-72 shrink-0 border-l border-slate-700 flex flex-col bg-slate-800/50 overflow-y-auto">

            {/* Customer navigator + แผ่น selector */}
            <div className="p-3 border-b border-slate-700 shrink-0 space-y-2">
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500 shrink-0">ลูกค้า</span>
                <select value={selectedCustomerId} onChange={e => setSelectedCustomerId(e.target.value)}
                  className="flex-1 h-7 rounded bg-slate-700 border border-slate-600 px-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 min-w-0">
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <button onClick={() => navigateCustomer(-1)}
                  className="h-7 px-2 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 text-xs font-semibold shrink-0">ขึ้น</button>
                <button onClick={() => navigateCustomer(1)}
                  className="h-7 px-2 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-slate-600 text-xs font-semibold shrink-0">ลง</button>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-slate-500 shrink-0">แผ่น</span>
                <select value={sheet} onChange={e => { setSheet(Number(e.target.value)); setSelectedGroups(new Set()); }}
                  className="flex-1 h-7 rounded bg-slate-900 border border-slate-600 px-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500 font-mono">
                  {Array.from({ length: effectiveMaxSheets }, (_, i) => i + 1).map(n => (
                    <option key={n} value={n}>{n}{customerBets.filter(b => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}</option>
                  ))}
                </select>
                <button onClick={handleRemoveSheet}
                  className="h-7 w-7 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-red-700 flex items-center justify-center text-base font-bold shrink-0"
                  title="ลบแผ่น (ลบได้เมื่อไม่มีข้อมูล)">−</button>
                <button onClick={handleAddSheet}
                  className="h-7 w-7 rounded bg-slate-700 border border-slate-600 text-slate-300 hover:bg-emerald-700 flex items-center justify-center text-base font-bold shrink-0"
                  title="เพิ่มแผ่นใหม่">+</button>
              </div>
              <button onClick={() => setLineModal(true)}
                className="w-full h-8 rounded bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold">
                รับข้อมูลไลน์
              </button>
            </div>

            {/* ค้นหา */}
            <div className="border-b border-slate-700 shrink-0">
              <SearchPanel bets={savedBets} q={searchQ} setQ={setSearchQ} />
            </div>

            {/* Summary table */}
            <div className="p-3 flex-1">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-slate-500 font-semibold tracking-wider">สรุปยอด</span>
                <div className="flex gap-1">
                  <button onClick={() => setSumFs(s => Math.max(9, s - 2))} className="h-5 px-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 text-[10px] font-bold leading-none">A−</button>
                  <button onClick={() => setSumFs(s => Math.min(22, s + 2))} className="h-5 px-1.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-400 text-[10px] font-bold leading-none">A+</button>
                </div>
              </div>
              <table className="w-full" style={{ fontSize: sumFs }}>
                <thead>
                  <tr className="border-b border-slate-700">
                    <th className="text-left py-1 text-slate-500 font-normal">เลข</th>
                    <th className="text-right py-1 text-slate-500 font-normal">แผ่น</th>
                    <th className="text-right py-1 text-slate-500 font-normal">ลูกค้า</th>
                    <th className="text-right py-1 text-slate-500 font-normal">รวม</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-slate-700 font-semibold bg-slate-700/30">
                    <td className="py-1 text-slate-300">รวม</td>
                    <td className="py-1 text-right font-mono text-amber-300">{sheetTotal > 0 ? sheetTotal.toLocaleString() : '—'}</td>
                    <td className="py-1 text-right font-mono text-sky-300">{customerSavedTotal > 0 ? customerSavedTotal.toLocaleString() : '—'}</td>
                    <td className="py-1 text-right font-mono text-emerald-400">{savedTotal > 0 ? savedTotal.toLocaleString() : '—'}</td>
                  </tr>
                  {COL_TYPES.map(c => {
                    const sheetAmt = sheetByType[c.key] ?? 0;
                    const custAmt = customerSavedByType[c.key] ?? 0;
                    const total = summaryByType[c.key] ?? 0;
                    return (
                      <tr key={c.key} className="border-b border-slate-700/30">
                        <td className={`py-0.5 ${total > 0 ? 'text-slate-400' : 'text-slate-700'}`}>{c.label}</td>
                        <td className={`py-0.5 text-right font-mono ${sheetAmt > 0 ? 'text-amber-300' : 'text-slate-700'}`}>{sheetAmt > 0 ? sheetAmt.toLocaleString() : '0'}</td>
                        <td className={`py-0.5 text-right font-mono ${custAmt > 0 ? 'text-sky-300' : 'text-slate-700'}`}>{custAmt > 0 ? custAmt.toLocaleString() : '0'}</td>
                        <td className={`py-0.5 text-right font-mono ${total > 0 ? 'text-emerald-400' : 'text-slate-700'}`}>{total > 0 ? total.toLocaleString() : '0'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {editModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setEditModal(null)}>
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-80 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-200">แก้ไข — เลข <span className="font-mono text-blue-400">{editModal.number}</span></div>
            <div className="text-xs text-slate-500">ราคา: 3บน+โต็ด+3ล่าง+2บน+2ล่าง+วิ่งบน+วิ่งล่าง (0 = ไม่แทง)</div>
            <input value={editAmt} onChange={e => setEditAmt(e.target.value)}
              className="h-9 rounded bg-slate-900 border border-slate-600 px-3 text-sm text-slate-200 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setEditModal(null)}
                className="h-8 px-4 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm">ยกเลิก</button>
              <button onClick={saveEdit}
                className="h-8 px-4 rounded bg-sky-600 hover:bg-sky-500 text-white text-sm font-semibold">บันทึก</button>
            </div>
          </div>
        </div>
      )}

      {/* Move Sheet Modal */}
      {moveModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setMoveModal(false)}>
          <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-80 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <div className="text-sm font-semibold text-slate-200">ย้าย — {selectedGroups.size} รายการ</div>

            {/* Target customer */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-16 shrink-0">ลูกค้า</span>
              <select value={moveTargetCustomerId} onChange={e => { setMoveTargetCustomerId(e.target.value); setMoveTarget(1); }}
                className="flex-1 h-8 rounded bg-slate-900 border border-slate-600 px-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                <option value="__same__">เดิม ({customers.find(c => c.id === selectedCustomerId)?.name ?? 'ไม่ระบุ'})</option>
                {customers.filter(c => c.id !== selectedCustomerId).map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>

            {/* Target sheet */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 w-16 shrink-0">ย้ายไปแผ่น</span>
              <select value={moveTarget} onChange={e => setMoveTarget(Number(e.target.value))}
                className="flex-1 h-8 rounded bg-slate-900 border border-slate-600 px-2 text-sm text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500">
                {(() => {
                  const tCustId = moveTargetCustomerId === '__same__' ? selectedCustomerId : moveTargetCustomerId;
                  const tCustBets = tCustId ? savedBets.filter(b => b.customer_id === tCustId) : savedBets.filter(b => !b.customer_id);
                  const tMax = tCustBets.length ? Math.max(...tCustBets.map(b => b.sheet_no ?? 1)) : 1;
                  const opts: number[] = Array.from({ length: tMax }, (_, i) => i + 1);
                  if (moveTargetCustomerId === '__same__') opts.splice(opts.indexOf(sheet), 1); // remove current sheet if same customer
                  if (!opts.length) opts.push(tMax + 1);
                  const showNew = true;
                  return [
                    ...opts.map(n => <option key={n} value={n}>แผ่น {n}{tCustBets.filter(b => (b.sheet_no ?? 1) === n).length > 0 ? ' ●' : ''}</option>),
                    <option key="new" value={tMax + 1}>แผ่น {tMax + 1} (ใหม่)</option>,
                  ];
                })()}
              </select>
            </div>

            <div className="flex gap-2 justify-end">
              <button onClick={() => setMoveModal(false)}
                className="h-8 px-4 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm">ยกเลิก</button>
              <button onClick={async () => { await moveSelectedGroups(moveTarget); }}
                className="h-8 px-4 rounded bg-amber-600 hover:bg-amber-500 text-white text-sm font-semibold">ย้าย</button>
            </div>
          </div>
        </div>
      )}

      {/* Line Import Modal */}
      {lineModal && (() => {
        const preview = lineText.trim() ? parseLineBetsText(lineText) : null;

        // Group preview bets by number (same structure as main bets table)
        type PreviewRow = { number: string; amounts: Record<string, number> };
        const groupedPreview: PreviewRow[] = [];
        if (preview?.bets.length) {
          const map = new Map<string, PreviewRow>();
          for (const b of preview.bets) {
            if (!map.has(b.number)) {
              const row: PreviewRow = { number: b.number, amounts: {} };
              map.set(b.number, row);
              groupedPreview.push(row);
            }
            const row = map.get(b.number)!;
            row.amounts[b.bet_type] = (row.amounts[b.bet_type] ?? 0) + b.amount;
          }
        }

        return (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
            <div className="bg-slate-800 border border-slate-600 rounded-lg p-4 w-[860px] max-h-[90vh] flex flex-col gap-3" onClick={e => e.stopPropagation()}>

              {/* Title */}
              <div className="text-sm font-semibold text-slate-200 shrink-0">รับข้อมูลไลน์</div>

              {/* Split panel */}
              <div className="flex gap-3 flex-1 min-h-0" style={{ minHeight: '420px' }}>

                {/* Left: hints + image drop + textarea */}
                <div className="w-[210px] shrink-0 flex flex-col gap-2">
                  <div className="text-xs text-slate-500 leading-relaxed bg-slate-900/60 rounded px-3 py-2 space-y-0.5">
                    <div className="text-slate-400 font-semibold mb-1">รูปแบบที่รองรับ:</div>
                    <div><span className="font-mono text-indigo-300">12=100×100</span></div>
                    <div><span className="font-mono text-indigo-300">70=50-50</span></div>
                    <div><span className="font-mono text-indigo-300">470 บ50 ต50</span></div>
                    <div><span className="font-mono text-indigo-300">12 21 60=50×50</span></div>
                    <div className="pt-1 border-t border-slate-700 text-slate-600">
                      <div className="text-slate-500 font-semibold">หัวข้อส่วน:</div>
                      <div><span className="font-mono text-amber-400">2 ตัวบน</span> → klap บน</div>
                      <div><span className="font-mono text-amber-400">2 ตัวล่าง</span> → klap ล่าง</div>
                    </div>
                  </div>

                  {/* Image drop zone */}
                  <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImageFile(f); e.target.value = ''; }} />
                  <div
                    onDragOver={e => { e.preventDefault(); setImgDragOver(true); }}
                    onDragLeave={() => setImgDragOver(false)}
                    onDrop={e => { e.preventDefault(); setImgDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleImageFile(f); }}
                    onClick={() => imgInputRef.current?.click()}
                    className={`flex items-center justify-center h-14 border-2 border-dashed rounded cursor-pointer text-xs transition-colors select-none
                      ${imgDragOver ? 'border-indigo-400 bg-indigo-900/20 text-indigo-300' : 'border-slate-600 bg-slate-900/40 hover:border-slate-400 text-slate-500'}`}>
                    {ocrLoading
                      ? <span className="text-indigo-400 animate-pulse">⏳ กำลังอ่านรูป...</span>
                      : <span>📷 ลากรูปหรือคลิกเลือกไฟล์</span>
                    }
                  </div>
                  {ocrError && <div className="text-xs text-red-400">{ocrError}</div>}

                  <div className="flex items-center gap-1 text-xs text-slate-700">
                    <div className="flex-1 border-t border-slate-700" />
                    <span>หรือวางข้อความ</span>
                    <div className="flex-1 border-t border-slate-700" />
                  </div>

                  <textarea value={lineText} onChange={e => setLineText(e.target.value)}
                    placeholder={"วางข้อความจากไลน์\nเช่น:\n12=100×100\n38=50×50\n470 บ50 ต50\n\n21\n26\n60=50×50"}
                    className="flex-1 bg-slate-900 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder:text-slate-600 font-mono resize-none focus:outline-none focus:ring-1 focus:ring-indigo-500" />
                </div>

                {/* Right: preview table (same layout as main bets table) */}
                <div className="flex-1 flex flex-col gap-1 min-w-0">
                  <div className="text-xs shrink-0 flex items-center gap-2">
                    {!preview && <span className="text-slate-600">วางข้อความที่ช่องซ้าย จะแสดง preview อัตโนมัติ</span>}
                    {preview && preview.parsedCount > 0 && (
                      <>
                        <span className="text-emerald-400 font-semibold">✓ พบ {preview.parsedCount} รายการ ({groupedPreview.length} เลข)</span>
                        {preview.skippedCount > 0 && <span className="text-amber-400">⚠ ข้าม {preview.skippedCount} บรรทัด</span>}
                      </>
                    )}
                    {preview && preview.parsedCount === 0 && (
                      <span className="text-slate-500">ไม่พบรายการที่ถูกต้อง{preview.skippedCount > 0 ? ` (ข้าม ${preview.skippedCount} บรรทัด)` : ''}</span>
                    )}
                  </div>

                  {/* Column headers (sticky) */}
                  <div className="shrink-0 bg-slate-900 border border-b-0 border-slate-700 rounded-t">
                    <table className="w-full table-fixed text-xs">
                      <thead>
                        <tr>
                          <th className="text-left py-1.5 px-2 text-slate-500 w-7">#</th>
                          <th className="text-left py-1.5 px-2 text-slate-400 font-semibold w-12">เลข</th>
                          {COL_TYPES.map(c => (
                            <th key={c.key} className="text-right py-1.5 px-2 text-slate-500 font-normal">{c.label}</th>
                          ))}
                        </tr>
                      </thead>
                    </table>
                  </div>

                  {/* Scrollable rows */}
                  <div className="flex-1 overflow-y-auto border border-t-0 border-slate-700 rounded-b min-h-0">
                    <table className="w-full table-fixed text-xs">
                      <tbody>
                        {groupedPreview.length === 0 ? (
                          <tr>
                            <td colSpan={9} className="py-12 text-center text-slate-700">—</td>
                          </tr>
                        ) : groupedPreview.map((row, idx) => (
                          <tr key={row.number + idx}
                            className={`border-b border-slate-700/30 ${idx % 2 === 0 ? 'bg-slate-800/40' : ''}`}>
                            <td className="py-1 px-2 text-slate-600 w-7">{idx + 1}</td>
                            <td className="py-1 px-2 font-mono font-bold text-blue-400 w-12">{row.number}</td>
                            {COL_TYPES.map(c => (
                              <td key={c.key} className="py-1 px-2 text-right font-mono text-slate-300">
                                {(row.amounts[c.key] ?? 0) > 0
                                  ? row.amounts[c.key].toLocaleString()
                                  : <span className="text-slate-700">—</span>}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {preview && preview.parsedCount > 0 && (
                    <div className="text-xs text-slate-500 shrink-0">
                      นำเข้าให้: <span className="text-slate-200">{currentCustomer?.name ?? '(ไม่ระบุลูกค้า)'}</span>
                      <span className="ml-1">แผ่น {sheet}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Buttons */}
              <div className="flex gap-2 justify-end shrink-0">
                <button onClick={() => { setLineModal(false); setLineText(''); setOcrError(''); }}
                  className="h-8 px-4 rounded bg-slate-700 text-slate-300 hover:bg-slate-600 text-sm">ยกเลิก</button>
                <button onClick={handleLineImport}
                  disabled={!preview || preview.parsedCount === 0}
                  className="h-8 px-4 rounded bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-semibold">
                  นำเข้า {preview && preview.parsedCount > 0 ? `(${preview.parsedCount})` : ''}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Print Receipt (hidden screen, visible only @media print) ─────── */}
      <div id="bet-receipt" style={{ display: 'none' }}>
        <div className="receipt-header">
          <div className="receipt-title">The Best</div>
          <div className="receipt-meta">
            <span>รายการขายของลูกค้า: {currentCustomer?.name ?? '(ทั้งหมด)'}</span>
            <span>
              แผ่นที่: {sheet}/{effectiveMaxSheets}&nbsp;
              งวดประจำวันที่:&nbsp;
              {currentRound ? new Date(currentRound.draw_date).toLocaleDateString('th-TH') : '—'}
            </span>
          </div>
        </div>
        <table>
          <thead>
            <tr>
              <th>เลข</th><th>ราคา</th>
              <th>เลข</th><th>ราคา</th>
              <th>เลข</th><th>ราคา</th>
              <th>เลข</th><th>ราคา</th>
            </tr>
          </thead>
          <tbody>
            {printRows.map((row, ri) => (
              <tr key={ri}>
                {[0, 1, 2, 3].map(ci => (
                  <>
                    <td key={`l${ci}`} style={{ fontWeight: 'bold' }}>{row[ci]?.label ?? ''}</td>
                    <td key={`p${ci}`}>{row[ci]?.price ?? ''}</td>
                  </>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="receipt-footer">
          <span>
            วันที่พิมพ์&nbsp;
            {new Date().toLocaleDateString('th-TH')}&nbsp;
            {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
          </span>
          <span>ราคารวม {printTotal.toLocaleString()}</span>
        </div>
      </div>

    </AppShell>
  );
}

function SearchPanel({ bets, q, setQ }: { bets: Bet[]; q: string; setQ: (v: string) => void }) {
  const results = q.trim() ? bets.filter(b => b.number.includes(q.trim())) : [];
  const totals: Record<string, number> = {};
  results.forEach(b => { totals[b.bet_type] = (totals[b.bet_type] ?? 0) + Number(b.amount); });
  return (
    <div className="p-3">
      <div className="flex gap-1">
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาเลข..."
          className="flex-1 h-7 rounded bg-slate-700 border border-slate-600 px-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:ring-1 focus:ring-amber-500 font-mono" />
        <button onClick={() => setQ('')} className="h-7 px-2.5 rounded bg-slate-700 border border-slate-600 text-slate-400 hover:text-slate-200 text-xs">ล้าง</button>
      </div>
      {q.trim() && (
        <div className="mt-2 space-y-0.5">
          {results.length === 0 && <p className="text-xs text-slate-600">ไม่พบ</p>}
          {Object.entries(totals).map(([type, amt]) => (
            <div key={type} className="flex justify-between text-xs">
              <span className="text-slate-400">{(BET_TYPE_LABELS as Record<string, string>)[type] ?? type}</span>
              <span className="font-mono text-emerald-400">{(amt as number).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
