// ─── Web Audio API sound effects (no external deps) ──────────────────────────

import type { BetKeyWarningKind } from '@/lib/betKeyWarnings';

let ctx: AudioContext | null = null;

function getCtx(): AudioContext {
  if (!ctx) ctx = new AudioContext();
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
}

function beep(
  frequency: number,
  duration: number,
  type: OscillatorType = 'sine',
  gain = 0.25,
): void {
  try {
    const c = getCtx();
    const osc = c.createOscillator();
    const g   = c.createGain();
    osc.connect(g);
    g.connect(c.destination);
    osc.type      = type;
    osc.frequency.setValueAtTime(frequency, c.currentTime);
    g.gain.setValueAtTime(gain, c.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + duration);
  } catch { /* silent fail */ }
}

/** เสียง "ติ๊ง" สั้นๆ เมื่อบันทึก bet 1 รายการสำเร็จ */
export function playSaveBet(): void {
  beep(880, 0.08, 'sine', 0.18);
}

/** เสียง "ติ๊ง-ต่อง" เมื่อ import หลายรายการสำเร็จ */
export function playImportSuccess(): void {
  beep(660, 0.08, 'sine', 0.2);
  setTimeout(() => beep(880, 0.12, 'sine', 0.2), 80);
}

/** เสียง error */
export function playError(): void {
  beep(220, 0.15, 'sawtooth', 0.15);
}

/** เสียงเตือนเมื่อเลขถูกปิดรับ (ต่างจาก error ทั่วไป — ให้หันกลับมาทวนโพย/แจ้งลูกค้า) */
export function playBlockedNumber(): void {
  beep(520, 0.1, 'square', 0.22);
  setTimeout(() => { beep(380, 0.1, 'square', 0.18); }, 100);
  setTimeout(() => { beep(260, 0.16, 'square', 0.14); }, 220);
}

/** สัญญาณปิดรับ — ดังกว่า playBlockedNumber (ใช้ก่อนบันทึก / ตอน API ปฏิเสธ) */
export function playBlockedNumberAlarm(): void {
  playBlockedNumber();
  setTimeout(() => playBlockedNumber(), 380);
}

/** เสียงแยกตามประเภทเมื่อคีย์ขยายหลายเลข / สงสัยพิมพ์ไม่ครบ */
export function playExpansionWarning(kind: BetKeyWarningKind): void {
  switch (kind) {
    case 'ambiguous_short_digit':
      beep(880, 0.07, 'triangle', 0.28);
      setTimeout(() => beep(440, 0.14, 'sawtooth', 0.2), 90);
      setTimeout(() => beep(330, 0.18, 'sawtooth', 0.16), 240);
      break;
    case 'bulk_3digit':
      beep(392, 0.11, 'sine', 0.24);
      setTimeout(() => beep(494, 0.11, 'sine', 0.22), 130);
      setTimeout(() => beep(587, 0.14, 'sine', 0.2), 260);
      break;
    case 'bulk_run':
      beep(740, 0.09, 'sine', 0.22);
      setTimeout(() => beep(988, 0.1, 'sine', 0.2), 100);
      break;
    case 'bulk_range':
      beep(330, 0.1, 'square', 0.2);
      setTimeout(() => beep(415, 0.1, 'square', 0.18), 110);
      setTimeout(() => beep(523, 0.12, 'square', 0.16), 220);
      break;
    case 'bulk_2digit':
    default:
      beep(440, 0.1, 'sine', 0.24);
      setTimeout(() => beep(554, 0.1, 'sine', 0.22), 120);
      break;
  }
}

/** ข้อความ error จาก API ที่หมายถึงเลขปิดรับ */
export function isBlockedBetApiMessage(msg: string): boolean {
  return msg.includes('ปิดรับ') || /is blocked for this round/i.test(msg);
}

// ─── Text-to-speech (Thai) ────────────────────────────────────────────────────

/** พูด text ภาษาไทย ยกเลิกเสียงเดิมก่อนเสมอ */
export function speak(text: string, rate = 1.8): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang  = 'th-TH';
  utter.rate  = rate;
  utter.pitch = 1.0;
  window.speechSynthesis.speak(utter);
}

/** พูด a จบแล้วพูด b ต่อคิว (ใช้เมื่อพิมพ์ยอดแล้วกด * — ให้ได้ยินยอดก่อน แล้วค่อย "คูณ") */
export function speakQueued(a: string, b: string, rate = 1.8): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const t1 = a.trim();
  const t2 = b.trim();
  if (!t1) {
    if (t2) speak(t2, rate);
    return;
  }
  window.speechSynthesis.cancel();
  const u1 = new SpeechSynthesisUtterance(t1);
  u1.lang = 'th-TH';
  u1.rate = rate;
  u1.onend = () => {
    if (!t2) return;
    const u2 = new SpeechSynthesisUtterance(t2);
    u2.lang = 'th-TH';
    u2.rate = rate;
    window.speechSynthesis.speak(u2);
  };
  window.speechSynthesis.speak(u1);
}

/** พูดต่อท้ายคิวโดยไม่ cancel (ใช้หลังยอดพูดอยู่แล้ว จะให้พูด "คูณ" ต่อ) */
export function speakAppend(text: string, rate = 1.8): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  const t = text.trim();
  if (!t) return;
  const u = new SpeechSynthesisUtterance(t);
  u.lang = 'th-TH';
  u.rate = rate;
  window.speechSynthesis.speak(u);
}

const THAI_DIGITS: Record<string, string> = {
  '0': 'ศูนย์', '1': 'หนึ่ง', '2': 'สอง',  '3': 'สาม',
  '4': 'สี่',   '5': 'ห้า',   '6': 'หก',    '7': 'เจ็ด',
  '8': 'แปด',   '9': 'เก้า',
};

/** พูดเลขทีละหลัก เช่น "123" → "หนึ่ง สอง สาม" */
export function speakNumber(num: string, rate = 1.8): void {
  const digits = num.replace(/\D/g, '');
  if (!digits) return;
  speak(digits.split('').map(d => THAI_DIGITS[d] ?? d).join(' '), rate);
}

/** พูดยอดเดิมพัน — พูดแค่ตัวเลขสั้นๆ ไม่มี label เพื่อความรวดเร็ว */
export function speakAmounts(amtRaw: string, _mode: 'run' | '2digit' | '3digit', rate = 1.8): void {
  const core  = amtRaw.replace(/-$/, '').replace(/[×xX×]/g, '*');
  const parts = core.split(/[*+]/).map(p => p.trim()).filter(p => p && !isNaN(Number(p)) && Number(p) > 0);
  if (!parts.length) return;
  speak(parts.join(' '), rate);
}

/** หยุด TTS ทั้งหมด (ไม่กระทบเสียง beep) */
export function cancelSpeech(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

/** หยุดชั่วคราว — ใช้คู่กับ resumeSpeech บน utterance เดิม (เบราว์เซอร์ที่รองรับ) */
export function pauseSpeech(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis?.speaking) return;
  try {
    window.speechSynthesis.pause();
  } catch { /* ignore */ }
}

/** คืนค่า true ถ้าเล่นต่อจากคิวที่ pause ไว้ได้ */
export function resumeSpeech(): boolean {
  if (typeof window === 'undefined' || !window.speechSynthesis) return false;
  try {
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      return true;
    }
  } catch { /* ignore */ }
  return false;
}

/** อ่านหนึ่งบรรทัดสำหรับโหมดตรวจด้วยเสียง — ยกเลิกคิวเดิมก่อน แล้วเรียก onEnd เมื่อจบหรือ error */
export function speakVoiceAudit(text: string, rate: number, onEnd?: () => void): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) {
    queueMicrotask(() => { onEnd?.(); });
    return;
  }
  const t = text.trim();
  if (!t) {
    queueMicrotask(() => { onEnd?.(); });
    return;
  }
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(t);
  utter.lang  = 'th-TH';
  utter.rate  = rate;
  utter.pitch = 1.0;
  utter.onend   = () => { onEnd?.(); };
  utter.onerror = () => { onEnd?.(); };
  window.speechSynthesis.speak(utter);
}

/** แถวโพยดิบ (ยอดต่อ bet_type) — คีย์ตรงกับ ColKey ใน bets page */
export type VoiceAuditBetRow = Record<string, number>;

/** พูดเลขทีละหลักเป็นคำ — ข้ามอักขระที่ไม่ใช่ตัวเลข */
export function lotteryDigitsSpokenThai(numberDisplay: string): string {
  const parts: string[] = [];
  for (const ch of numberDisplay) {
    if (ch >= '0' && ch <= '9') {
      parts.push(THAI_DIGITS[ch] ?? ch);
    }
  }
  return parts.join(' ');
}

function thaiBelow100(num: number): string {
  const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  if (num <= 0) return '';
  if (num < 10) return DIGITS[num] ?? '';
  if (num === 10) return 'สิบ';
  if (num === 11) return 'สิบเอ็ด';
  const tens = Math.floor(num / 10);
  const ones = num % 10;
  const tensWord = tens === 2 ? 'ยี่สิบ' : tens === 1 ? 'สิบ' : `${DIGITS[tens]}สิบ`;
  if (ones === 0) return tensWord;
  if (ones === 1) return `${tensWord}เอ็ด`;
  return `${tensWord}${DIGITS[ones]}`;
}

function thaiBelow1000(num: number): string {
  const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];
  if (num <= 0) return '';
  const hundreds = Math.floor(num / 100);
  const rest = num % 100;
  let s = '';
  if (hundreds > 0) {
    s += (hundreds === 1 ? 'หนึ่ง' : DIGITS[hundreds]) + 'ร้อย';
    if (rest === 0) return s;
    const tens = Math.floor(rest / 10);
    const ones = rest % 10;
    if (tens === 0) {
      if (ones === 1) return `${s}เอ็ด`;
      return `${s}${DIGITS[ones]}`;
    }
    return s + thaiBelow100(rest);
  }
  return thaiBelow100(rest);
}

/** จำนวนเต็มบวก → คำอ่านไทย (ใช้กับยอดซื้อโพย ไม่เกินหลักล้านพอใช้งานจริง) */
export function integerAmountToThai(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '';
  let num = Math.floor(n);
  if (num <= 0) return '';

  const DIGITS = ['', 'หนึ่ง', 'สอง', 'สาม', 'สี่', 'ห้า', 'หก', 'เจ็ด', 'แปด', 'เก้า'];

  function chunkUnderMillion(x: number): string {
    if (x <= 0) return '';
    let v = x;
    const bits: string[] = [];
    const saen = Math.floor(v / 100000);
    if (saen) {
      v %= 100000;
      bits.push(`${saen === 1 ? 'หนึ่ง' : DIGITS[saen]}แสน`);
    }
    const muen = Math.floor(v / 10000);
    if (muen) {
      v %= 10000;
      bits.push(`${muen === 1 ? 'หนึ่ง' : DIGITS[muen]}หมื่น`);
    }
    const phan = Math.floor(v / 1000);
    if (phan) {
      v %= 1000;
      bits.push(`${phan === 1 ? 'หนึ่ง' : DIGITS[phan]}พัน`);
    }
    const tail = thaiBelow1000(v);
    if (tail) bits.push(tail);
    return bits.join('');
  }

  const millions = Math.floor(num / 1000000);
  num %= 1000000;
  let head = '';
  if (millions > 0) head = `${chunkUnderMillion(millions)}ล้าน`;
  return head + chunkUnderMillion(num);
}

/** ดึงยอดเป็นตัวเลขเรียงแบบโพย (เทียบ formatPrintItem.rice — ไม่มีป้ายบน/ล่าง) */
export function voiceAuditAmountInts(row: VoiceAuditBetRow): number[] {
  const has3top  = (row['3digit_top']    ?? 0) > 0;
  const has3tote = (row['3digit_tote']   ?? 0) > 0;
  const has3back = (row['3digit_back']   ?? 0) > 0;
  const has2top  = (row['2digit_top']    ?? 0) > 0;
  const has2bot  = (row['2digit_bottom'] ?? 0) > 0;
  const has1top  = (row['1digit_top']    ?? 0) > 0;
  const has1bot  = (row['1digit_bottom'] ?? 0) > 0;

  if (has3top || has3tote || has3back) {
    const parts = [Number(row['3digit_top'] ?? 0), Number(row['3digit_tote'] ?? 0), Number(row['3digit_back'] ?? 0)];
    while (parts.length > 1 && parts[parts.length - 1] === 0) parts.pop();
    return parts.filter(p => p > 0);
  }
  if (has2top && has2bot) return [Number(row['2digit_top']), Number(row['2digit_bottom'])].filter(p => p > 0);
  if (has2top) return [Number(row['2digit_top'])].filter(p => p > 0);
  if (has2bot) return [Number(row['2digit_bottom'])].filter(p => p > 0);
  if (has1top && has1bot) return [Number(row['1digit_top']), Number(row['1digit_bottom'])].filter(p => p > 0);
  if (has1top) return [Number(row['1digit_top'])].filter(p => p > 0);
  if (has1bot) return [Number(row['1digit_bottom'])].filter(p => p > 0);
  return [];
}

/** ข้อความเดียวสำหรับโหมดตรวจด้วยเสียง: เลขทีละหลัก + ยอดเป็นคำไทยคั่นด้วย "คูณ" + (ถ้ามีผลออก) ชนิดที่ถูกและยอดจ่าย */
export type VoiceAuditLineBet = Readonly<{
  bet_type: string;
  number: string;
  amount: number;
  payout_rate: number;
}>;

export type VoiceAuditLineOpts = Readonly<{
  winKeys?: ReadonlySet<string>;
  bets?: ReadonlyArray<VoiceAuditLineBet>;
  /** เมื่อบางแถวไม่มี payout_rate — fallback เช่นจากลูกค้า */
  rateLookup?: (betType: string) => number;
}>;

const VOICE_AUDIT_WIN_ORDER = [
  '3digit_top',
  '3digit_tote',
  '3digit_back',
  '2digit_top',
  '2digit_bottom',
  '1digit_top',
  '1digit_bottom',
] as const;

const VOICE_AUDIT_WIN_LABEL: Record<string, string> = {
  '3digit_top':    'ถูกสามตัวบน',
  '3digit_tote':   'ถูกสามตัวโต็ด',
  '3digit_back':   'ถูกสามตัวล่าง',
  '2digit_top':    'ถูกบน',
  '2digit_bottom': 'ถูกล่าง',
  '1digit_top':    'ถูกวิ่งบน',
  '1digit_bottom': 'ถูกวิ่งล่าง',
};

/** อัตราจ่ายเป็นคำพูด เช่น สิบ / หนึ่งร้อย / สามจุดห้า (ทศนิยม) */
export function payoutRateSpeech(rate: number): string {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return '';
  const scaled = Math.round(r * 100) / 100;
  const whole = Math.floor(scaled + 1e-9);
  const frac = Math.round((scaled - whole) * 100);
  if (frac <= 0 || frac >= 100) return integerAmountToThai(Math.round(scaled));
  const fracStr = frac.toString().padStart(2, '0').replace(/0+$/, '');
  const fracWords = lotteryDigitsSpokenThai(fracStr).replace(/\s+/g, '');
  const head = integerAmountToThai(whole);
  return fracWords ? `${head}จุด${fracWords}` : head;
}

function buildVoiceAuditWinPhrase(opts?: VoiceAuditLineOpts): string {
  if (!opts?.winKeys?.size || !opts.bets?.length) return '';
  const winning = opts.bets.filter((b) => opts.winKeys!.has(`${b.bet_type}::${b.number}`));
  if (!winning.length) return '';

  type Agg = { bet_type: string; rate: number; prize: number };
  const map = new Map<string, Agg>();

  for (const b of winning) {
    let rate = Number(b.payout_rate);
    if (!(rate > 0) && opts.rateLookup) rate = opts.rateLookup(b.bet_type);
    if (!(rate > 0)) continue;
    const prizeAdd = Number(b.amount) * rate;
    const key = `${b.bet_type}@${rate}`;
    const prev = map.get(key);
    if (prev) prev.prize += prizeAdd;
    else map.set(key, { bet_type: b.bet_type, rate, prize: prizeAdd });
  }

  const entries = [...map.values()].sort((a, b) => {
    const ia = VOICE_AUDIT_WIN_ORDER.indexOf(a.bet_type as (typeof VOICE_AUDIT_WIN_ORDER)[number]);
    const ib = VOICE_AUDIT_WIN_ORDER.indexOf(b.bet_type as (typeof VOICE_AUDIT_WIN_ORDER)[number]);
    const va = ia === -1 ? 99 : ia;
    const vb = ib === -1 ? 99 : ib;
    if (va !== vb) return va - vb;
    return a.rate - b.rate;
  });

  const parts: string[] = [];
  for (const e of entries) {
    const label = VOICE_AUDIT_WIN_LABEL[e.bet_type] ?? `ถูก${e.bet_type}`;
    const prizeW = integerAmountToThai(Math.round(e.prize));
    if (!prizeW) continue;
    if (e.bet_type === '3digit_tote') {
      const rateW = payoutRateSpeech(e.rate);
      parts.push(rateW ? `${label} โต็ด ${rateW}บาท ${prizeW}บาท` : `${label} ${prizeW}บาท`);
    } else {
      parts.push(`${label} ${prizeW}บาท`);
    }
  }

  return parts.join(' ');
}

export function buildVoiceAuditLine(
  numberDisplay: string,
  row: VoiceAuditBetRow,
  opts?: VoiceAuditLineOpts,
): string {
  const numPart = lotteryDigitsSpokenThai(numberDisplay).trim();
  const amtWords = voiceAuditAmountInts(row).map(integerAmountToThai).filter(Boolean);
  const amtPart = amtWords.join('คูณ');
  const winPart = buildVoiceAuditWinPhrase(opts);
  return [numPart, amtPart, winPart].filter(Boolean).join(' ');
}

