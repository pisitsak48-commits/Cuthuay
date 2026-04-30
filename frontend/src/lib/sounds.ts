// ─── Web Audio API sound effects (no external deps) ──────────────────────────

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

