// ─── betParser.ts ─────────────────────────────────────────────────────────────
// Fast-key bet parser: แปลงรูปแบบเลขและจำนวนเงินเป็น ParsedBet[]
// SYNC: สำเนาจาก frontend/src/lib/betParser.ts — LINE webhook ใช้ไฟล์นี้

export type BetInputMode = 'run' | '2digit' | '3digit';

export interface ParsedBet {
  number:   string;
  bet_type: '2digit_top' | '2digit_bottom' | '3digit_top' | '3digit_tote' | '3digit_back' | '1digit_top' | '1digit_bottom';
  amount:   number;
  segment_index?: number;
}

export interface ParseResult {
  bets:            ParsedBet[];
  error?:          string;
  mode:            BetInputMode;
  expandedNumbers: string[];
  isKlap:          boolean;
  amountHint:      string;
}

// ─── Number Expansion ─────────────────────────────────────────────────────────

export function expandNumberInput(input: string): { numbers: string[]; mode: BetInputMode; isKlap?: boolean } | null {
  const s = input.trim();
  if (!s) return null;

  if (s === '--') {
    return { numbers: ['00','11','22','33','44','55','66','77','88','99'], mode: '2digit' };
  }

  const rangeMatch = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (rangeMatch) {
    const from = parseInt(rangeMatch[1], 10);
    const to   = parseInt(rangeMatch[2], 10);
    if (from <= to && to <= 99) {
      const nums: string[] = [];
      for (let i = from; i <= to; i++) nums.push(i.toString().padStart(2, '0'));
      return { numbers: nums, mode: '2digit' };
    }
  }

  const bothMatch = s.match(/^(\*(\d)\*|(\d)\*\*)$/);
  if (bothMatch) {
    const digit = s.replace(/\*/g, '');
    const front = Array.from({ length: 10 }, (_: unknown, i: number) => `${digit}${i}`);
    const back  = Array.from({ length: 10 }, (_: unknown, i: number) => `${i}${digit}`);
    const combined = front.concat(back);
    const seen: Record<string, boolean> = {};
    const union: string[] = [];
    combined.forEach(n => { if (!seen[n]) { seen[n] = true; union.push(n); } });
    return { numbers: union, mode: '2digit' };
  }

  const frontMatch = s.match(/^(\d)\*$/);
  if (frontMatch) {
    const d = frontMatch[1];
    return { numbers: Array.from({ length: 10 }, (_: unknown, i: number) => `${d}${i}`), mode: '2digit' };
  }

  const backMatch = s.match(/^\*(\d)$/);
  if (backMatch) {
    const d = backMatch[1];
    return { numbers: Array.from({ length: 10 }, (_: unknown, i: number) => `${i}${d}`), mode: '2digit' };
  }

  // หน้าเลข + dash = กลับ เช่น 125- หรือ 15-
  const numKlapMatch = s.match(/^(\d{2,3})-$/);
  if (numKlapMatch) {
    const d = numKlapMatch[1];
    const mode: BetInputMode = d.length === 2 ? '2digit' : '3digit';
    return { numbers: [d], mode, isKlap: true };
  }

  if (/^\d$/.test(s))   return { numbers: [s], mode: 'run' };
  if (/^\d{2}$/.test(s)) return { numbers: [s], mode: '2digit' };
  if (/^\d{3}$/.test(s)) return { numbers: [s], mode: '3digit' };

  return null;
}

// ─── Permutation Expansion (กลับ) ────────────────────────────────────────────

export function getPermutations(num: string): string[] {
  if (num.length === 1) {
    const result: string[] = [];
    for (let i = 0; i <= 9; i++) {
      for (let j = 0; j <= 9; j++) {
        const n = `${i}${j}`;
        if (n.includes(num) && !result.includes(n)) result.push(n);
      }
    }
    return result;
  }
  if (num.length === 2) {
    const a = num[0];
    const b = num[1];
    return a === b ? [num] : [num, `${b}${a}`];
  }
  if (num.length === 3) {
    const found: string[] = [];
    const chars = num.split('');
    function permHelper(arr: string[], curr: string): void {
      if (!arr.length) { if (!found.includes(curr)) found.push(curr); return; }
      for (let i = 0; i < arr.length; i++) {
        permHelper([...arr.slice(0, i), ...arr.slice(i + 1)], curr + arr[i]);
      }
    }
    permHelper(chars, '');
    return found.filter((p, idx) => idx === 0 || p !== num).length
      ? [num, ...found.filter(p => p !== num)]
      : [num];
  }
  return [num];
}

// ─── Amount Hint ──────────────────────────────────────────────────────────────

export function getAmountHint(mode: BetInputMode, isKlap: boolean, isKlapTote?: boolean, isKlapBoth?: boolean): string {
  if (isKlapBoth)  return 'กลับบน+โต็ด: ทุก perm × 3บน และ โต็ด';
  if (isKlapTote)  return 'กลับโต็ด: ทุก perm × โต็ด';
  if (isKlap) {
    if (mode === 'run')    return 'กลับ: บน+ล่าง ต่อทุกเลข';
    if (mode === '2digit') return 'กลับ: บน+ล่าง ต่อทุกเลข';
    return 'กลับ: จำนวน หรือ ตัวที่1+ตัวที่2+...';
  }
  if (mode === 'run')    return 'วิ่งบน+วิ่งล่าง เช่น 100+100';
  if (mode === '2digit') return 'บน+ล่าง เช่น 100+50 หรือ 100-';
  return '3บน+โต็ด+2ล่าง เช่น 100+150+50';
}

// ─── Main Parser ──────────────────────────────────────────────────────────────

export function parseBetLine(numberInput: string, amountInput: string): ParseResult {
  const expanded = expandNumberInput(numberInput);
  if (!expanded) {
    return { bets: [], error: 'รูปแบบเลขไม่ถูกต้อง', mode: '2digit', expandedNumbers: [], isKlap: false, amountHint: '' };
  }
  const { numbers, mode, isKlap: isKlapFromNum } = expanded;
  const amountStr = amountInput.trim();
  const isKlapFromAmt = amountStr.endsWith('-');
  // *100- = กลับโต๊ด (klap tote) for 3digit
  const isKlapTote = mode === '3digit' && isKlapFromAmt && amountStr.startsWith('*') && !amountStr.slice(1).includes('*');
  // 100*100- = กลับบน+โต๊ด (klap both): exactly one * between digits, no + sign  
  const klapBothMatch = mode === '3digit' && isKlapFromAmt && !isKlapTote
    ? amountStr.slice(0, -1).match(/^(\d+)\*(\d+)$/)
    : null;
  const isKlapBoth = !!klapBothMatch;
  const isKlap = isKlapFromAmt || !!isKlapFromNum;
  // normalize: allow * as separator same as + (but only between digits, not as number pattern)
  // For klapTote: strip leading * and trailing -
  const rawCore = isKlapTote ? amountStr.slice(1, -1) : (isKlapFromAmt ? amountStr.slice(0, -1) : amountStr);
  const normalized = rawCore;
  const core      = normalized.replace(/\*/g, '+');
  const parts     = core.split('+').map(p => parseFloat(p) || 0);

  if (parts.every(p => p === 0)) {
    return { bets: [], mode, expandedNumbers: numbers, isKlap, amountHint: getAmountHint(mode, isKlap, isKlapTote, isKlapBoth) };
  }

  const bets: ParsedBet[] = [];

  for (const num of numbers) {
    if (isKlapTote) {
      // กลับโต๊ด: all perms × 3digit_tote, last-repeats
      const perms = getPermutations(num);
      for (let i = 0; i < perms.length; i++) {
        const amt = parts[Math.min(i, parts.length - 1)] ?? 0;
        if (amt > 0) bets.push({ number: perms[i], bet_type: '3digit_tote', amount: amt });
      }
    } else if (isKlapBoth && klapBothMatch) {
      // กลับบน+โต๊ด: all perms × 3บน + all perms × โต๊ด (same amount for all perms)
      const topAmt  = parseFloat(klapBothMatch[1]) || 0;
      const toteAmt = parseFloat(klapBothMatch[2]) || 0;
      const perms = getPermutations(num);
      for (const perm of perms) {
        if (topAmt  > 0) bets.push({ number: perm, bet_type: '3digit_top',  amount: topAmt  });
        if (toteAmt > 0) bets.push({ number: perm, bet_type: '3digit_tote', amount: toteAmt });
      }
    } else if (isKlap) {
      const perms = getPermutations(num);
      if (mode === 'run' || mode === '2digit') {
        const topAmt = parts[0] ?? 0;
        const botAmt = parts[1] ?? 0;
        for (const perm of perms) {
          const isRun = perm.length === 1;
          if (topAmt > 0) bets.push({ number: perm, bet_type: isRun ? '1digit_top'    : '2digit_top',    amount: topAmt });
          if (botAmt > 0) bets.push({ number: perm, bet_type: isRun ? '1digit_bottom' : '2digit_bottom', amount: botAmt });
        }
      } else {
        // 3digit กลับ: parts[i] → perm[i], ถ้า perm มากกว่า parts → ตัวสุดท้ายซ้ำ (last repeats)
        // เช่น 114 100+200- → 114=100, 141=200, 411=200
        for (let i = 0; i < perms.length; i++) {
          const amt = parts[Math.min(i, parts.length - 1)] ?? 0;
          if (amt > 0) bets.push({ number: perms[i], bet_type: '3digit_top', amount: amt });
        }
      }
    } else {
      bets.push(...createNormalBets(num, mode, parts));
    }
  }

  return { bets, mode, expandedNumbers: numbers, isKlap, amountHint: getAmountHint(mode, isKlap, isKlapTote, isKlapBoth) };
}

function createNormalBets(num: string, mode: BetInputMode, amounts: number[]): ParsedBet[] {
  const bets: ParsedBet[] = [];
  if (mode === 'run') {
    if ((amounts[0] ?? 0) > 0) bets.push({ number: num, bet_type: '1digit_top',    amount: amounts[0] });
    if ((amounts[1] ?? 0) > 0) bets.push({ number: num, bet_type: '1digit_bottom', amount: amounts[1] });
  } else if (mode === '2digit') {
    if ((amounts[0] ?? 0) > 0) bets.push({ number: num, bet_type: '2digit_top',    amount: amounts[0] });
    if ((amounts[1] ?? 0) > 0) bets.push({ number: num, bet_type: '2digit_bottom', amount: amounts[1] });
  } else if (mode === '3digit') {
    if ((amounts[0] ?? 0) > 0) bets.push({ number: num, bet_type: '3digit_top',  amount: amounts[0] });
    if ((amounts[1] ?? 0) > 0) bets.push({ number: num, bet_type: '3digit_tote', amount: amounts[1] });
    if ((amounts[2] ?? 0) > 0) bets.push({ number: num, bet_type: '3digit_back', amount: amounts[2] });
  }
  return bets;
}

// ─── LINE text import ─────────────────────────────────────────────────────────

/**
 * Parse a single LINE-format line into {number, amountStr} usable by parseBetLine.
 * Returns null if the line has no amount info (bare number or unrecognised).
 *
 * Supported patterns:
 *   12=100×100   → 2digit top=100 bottom=100   (× or x or X, or just -)
 *   12=100-100   → same
 *   12=100       → 2digit top=100 only
 *   470 บ50 ต50  → 3digit top=50, tote=50  (Thai label บ/ต/ล)
 *   56 100 50    → 2digit top=100 bottom=50  (space-separated)
 *   56 100*50    → same with * separator
 */
/**
 * Parse amount separator: sep = ×, ✕, ✖, x, X, *, %, :, -, space
 * Returns [amt1, amt2] as strings given "AMT1<sep>AMT2" or "AMT1" string.
 * Used internally by extractLineAmount and multi-pair parsers.
 */
function splitAmounts(amtStr: string): string[] {
  // split on × ✕ ✖ x X * % : or -
  const parts = amtStr.split(/[\u00D7\u2715\u2716xX*%:\-]/);
  return parts.map(p => p.trim()).filter(p => /^\d+$/.test(p));
}

/** 256 บ30 ล30 ต3 / บน·ล่าง·โต๊ด — ลำดับคำย่ออิสระ (รูปแบบเดิมบังคับ บ→ต→ล ผิด) */
function parseThaiBlTLabels(s: string): { number: string; amountStr: string } | null {
  const m = s.match(/^(\d{1,3})(\s+.*)$/u);
  if (!m) return null;
  const num = m[1];
  const tail = m[2];

  const bFull = tail.match(/\s+บน\s*(\d+)/u);
  const bShort = !bFull ? tail.match(/\s+บ(\d+)/u) : null;
  const bVal = bFull ? Number(bFull[1]) : (bShort ? Number(bShort[1]) : 0);

  const lFull = tail.match(/\s+ล่าง\s*(\d+)/u);
  const lShort = !lFull ? tail.match(/\s+ล(\d+)/u) : null;
  const lVal = lFull ? Number(lFull[1]) : (lShort ? Number(lShort[1]) : 0);

  const tFull = tail.match(/\s+โต๊ด\s*(\d+)/u);
  const tShort = !tFull ? tail.match(/\s+ต(\d+)/u) : null;
  const tVal = tFull ? Number(tFull[1]) : (tShort ? Number(tShort[1]) : 0);

  if (!bVal && !lVal && !tVal) return null;

  if (num.length === 3) {
    return { number: num, amountStr: `${bVal}+${tVal}+${lVal}` };
  }
  const bot = lVal > 0 ? lVal : tVal;
  if (num.length === 2) {
    return { number: num, amountStr: `${bVal}+${bot}` };
  }
  if (num.length === 1) {
    return { number: num, amountStr: `${bVal}+${bot}` };
  }
  return null;
}

/**
 * Parse a single "NUM<sep>AMT1<sep>AMT2" token into { number, amountStr }.
 * sep can be = - space (between number and amounts).
 * Returns null if token doesn't look like a bet.
 */
function parseToken(token: string): { number: string; amountStr: string } | null {
  const s = token.trim();
  if (!s) return null;

  // NUM=AMT*…กลับ  → 3ตัวบนกลับครบ permutation (ไลน์ เช่น 816=20*6กลับ / 816=20* กลับ)
  let m = s.match(/^(\d{3})\s*=\s*(\d+)\s*\*\s*(?:\d+\s*)?กลับ\s*$/u);
  if (m) return { number: m[1], amountStr: `${m[2]}*klap` };

  // NUM AMT*…กลับ — ช่องว่างหลังเลข เช่น "816 20*6 กลับ" "816 20* กลับ"
  m = s.match(/^(\d{3})\s+(\d+)\s*\*\s*(?:\d+\s*)?กลับ\s*$/u);
  if (m) return { number: m[1], amountStr: `${m[2]}*klap` };

  // NUM AMT กลับ — ตัวละเดียวแล้วกลับ เช่น "816 20 กลับ"
  m = s.match(/^(\d{3})\s+(\d+)\s+กลับ\s*$/u);
  if (m) return { number: m[1], amountStr: `${m[2]}*klap` };

  // NUM=AMT*N Thai_tag  e.g. "169=10*6 ประดู"  → all perms 3digit_top at price AMT
  m = s.match(/^(\d{3})\s*=\s*(\d+)\s*\*\s*\d+\s+[\u0E00-\u0E7F]/u);
  if (m) return { number: m[1], amountStr: `${m[2]}*klap` };

  // NUM=AMT1<sep>AMT2[<sep>AMT3...]   (= sign, any sep, 2+ amounts)
  m = s.match(/^(\d{1,3})\s*=\s*(\d+(?:[\u00D7\u2715\u2716xX*%:\-]\d+)+)$/);
  if (m) {
    const parts = splitAmounts(m[2]);
    if (parts.length >= 2) return { number: m[1], amountStr: parts.join('+') };
  }

  // NUM = AMT1*AMT2*AMT3  (with spaces around =)
  m = s.match(/^(\d{1,3})\s+=\s+(\d+(?:[*+]\d+)+)$/);
  if (m) {
    const parts = splitAmounts(m[2].replace(/\+/g, '*'));
    if (parts.length >= 2) return { number: m[1], amountStr: parts.join('+') };
  }

  // NUM=AMT  (single, = sign)
  m = s.match(/^(\d{1,3})\s*=\s*(\d+)$/);
  if (m) return { number: m[1], amountStr: m[2] };

  // NUM-AMT1*AMT2  or  NUM-AMT1-AMT2  (dash after number, for LINE compact format)
  // e.g. 58-50*50  63-50*50  830-50*50
  m = s.match(/^(\d{1,3})\s*-\s*(\d+[\u00D7\u2715\u2716xX*%:\-]\d+)$/);
  if (m) {
    const parts = splitAmounts(m[2]);
    if (parts.length >= 2) return { number: m[1], amountStr: `${parts[0]}+${parts[1]}` };
  }

  // NUM-AMT  (single amount with dash, e.g. 58-50)
  m = s.match(/^(\d{1,3})\s*-\s*(\d+)$/);
  if (m) return { number: m[1], amountStr: m[2] };

  // NUM.AMT1*AMT2[*AMT3]  (dot separator, e.g. 29.100*100  92.50*50*50)
  m = s.match(/^(\d{1,3})\.((\d+[\u00D7\u2715\u2716xX*%:\-])+\d+)$/);
  if (m) {
    const parts = splitAmounts(m[2]);
    if (parts.length >= 2) return { number: m[1], amountStr: parts.join('+') };
  }

  // NUM.AMT  (single amount, dot separator, e.g. 29.100)
  m = s.match(/^(\d{1,3})\.(\d+)$/);
  if (m) return { number: m[1], amountStr: m[2] };

  // NUM AMT1<sep>AMT2[<sep>AMT3...]  (space between number and amounts)
  m = s.match(/^(\d{1,3})\s+(\d+(?:[\u00D7\u2715\u2716xX*%:\-]\d+)+)$/);
  if (m) {
    const parts = splitAmounts(m[2]);
    if (parts.length >= 2) return { number: m[1], amountStr: parts.join('+') };
  }

  // NUM AMT1 AMT2  (two space-separated amounts)
  m = s.match(/^(\d{1,3})\s+(\d+)\s+(\d+)$/);
  if (m) return { number: m[1], amountStr: `${m[2]}+${m[3]}` };

  // NUM AMT  (single space-separated amount)
  m = s.match(/^(\d{1,3})\s+(\d+)$/);
  if (m) return { number: m[1], amountStr: m[2] };

  return null;
}

function extractLineAmount(line: string): { number: string; amountStr: string } | null {
  const t = parseThaiBlTLabels(line.trim());
  if (t) return t;
  return parseToken(line.trim());
}

/** Return just the number string if the line is a bare digit sequence (1-3 digits), else null */
function extractBareNumber(line: string): string | null {
  const s = line.trim();
  return /^\d{1,3}$/.test(s) ? s : null;
}

export interface LineImportResult {
  bets:         ParsedBet[];
  parsedCount:  number;   // successfully parsed number entries
  skippedCount: number;   // lines that could not be parsed
}

/** Section context from LINE headers — affects how × is interpreted */
type SectionMode = 'none' | '2top' | '2bot' | '3top' | '3bl' | '3back';

function klap2(num: string): string {
  return num.length === 2 ? num[1] + num[0] : num;
}

/**
 * Pre-process LINE text: join lines that were word-wrapped by the LINE app.
 *
 * Rule 1: a line that contains commas but NO '=' (pure digit/comma fragment)
 *         → append the next line to it (they're part of the same CSV number list)
 * Rule 2: a line that ends with =NUMBER and the next line is just *NUMBER / ×NUMBER
 *         → append the amount-suffix so we get the complete amount token
 * Rule 3: "816 20*6" or "816 20" then next line only "กลับ" → join (LINE word-wrap)
 */
function preJoinFragments(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    let cur = lines[i];
    // Rule 1: pure digit/comma/space fragment with at least one comma → join next
    while (i + 1 < lines.length) {
      const t = cur.trim();
      if (t.includes(',') && /^[\d,\s]+$/.test(t)) {
        i++;
        cur = cur.trimEnd() + lines[i].trim();
      } else { break; }
    }
    // Rule 2: amount suffix on its own next line (*30, ×30, x30)
    // Rule 3: "816 20*6" แล้วบรรทัดถัดไปแค่ "กลับ" (word-wrap ไลน์)
    if (i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (/^[*×xX]\d+$/.test(next) && cur.includes('=')) {
        cur = cur.trim() + next;
        i++;
      } else if (
        /^กลับ\s*$/u.test(next)
        && (
          /^\d{3}(?:\s+|\s*=\s*)\d+\s*\*/u.test(cur.trim())
          || /^\d{3}\s+\d+\s*$/u.test(cur.trim())
        )
      ) {
        cur = `${cur.trim()} ${next}`;
        i++;
      }
    }
    out.push(cur);
  }
  return out.join('\n');
}

const LINE_PASTE_ZW_RE = /[\u200B-\u200D\uFEFF]/g;

function stripLinePasteInvisible(s: string): string {
  return s.replace(LINE_PASTE_ZW_RE, '');
}

/** เริ่มเนื้อโพยแล้วหรือยัง (หลังตัดเวลา) — ใช้ลบชื่อผู้ส่งหลายคำ */
function isLikelyBetLineContentStart(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (/^=+\s*\d/.test(t)) return true;
  const toks = t.split(/\s+/).filter(Boolean);
  if (!toks.length) return true;
  const a = toks[0];
  if (/^\d/.test(a)) return true;
  const head2 = toks.slice(0, 2).join(' ');
  if (/^(?:2|3)\s*ต/u.test(head2)) return true;
  if (/^บน|^ล่าง|^บต|^บล|^วิ่ง|^เต็ง/u.test(a)) return true;
  return false;
}

/** คำนำหน้าไลน์: [HH:MM], เวลา + AM/PM, วันที่+เวลา, แล้วตัดชื่อผู้ส่งจนกว่าบรรทัดจะขึ้นต้นแบบโพย */
function stripLineChatTimePrefix(line: string): string {
  let s = stripLinePasteInvisible(line).trim();
  s = s.replace(/^(?:\[)?\d{1,2}:\d{2}(?::\d{2})?(?:\])?\s*(?:[-–—:]\s*)?/u, '');
  s = s.replace(/^(?:AM|PM|am|pm|น\.?)\s+/u, '');
  s = s.replace(/^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\s*,\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[-–—:]\s*)?/u, '');
  const toks = s.split(/\s+/).filter(Boolean);
  let i = 0;
  while (i < toks.length) {
    const rest = toks.slice(i).join(' ');
    if (isLikelyBetLineContentStart(rest)) break;
    i++;
  }
  return toks.slice(i).join(' ').trim();
}

function normalizeLinePasteBetSeparators(line: string): string {
  let s = line.replace(/\u00D7/g, '*').replace(/\u2715/g, '*').replace(/\u2716/g, '*');
  s = s.replace(/(\d)\s*["'`´]\s*(\d)/g, '$1*$2');
  // 50x50 → 50*50 (ป้อน x จากมือถือ/คีย์บอร์ด)
  let prev = '';
  while (prev !== s) {
    prev = s;
    s = s.replace(/(\d)\s*[xX]\s*(\d)/g, '$1*$2');
  }
  s = s.replace(/[.。]+$/g, '');
  return s.trim();
}

/**
 * โพยไลน์: ==/=== , = คั่นราคา (98=50=50), ขีดคั่นราคาหลัง = (628 = 30 - 30 - 30), ท้าย "บ ล ต"
 */
function normalizeLineEquationStyles(line: string): string {
  let s = line.trim();
  if (!s) return s;

  s = s.replace(/\s+(?:บ\s*ล\s*ต|บลต)\s*\.?\s*$/iu, '');
  s = s.replace(/(\d)(?:บ\s*ล\s*ต|บลต)\s*\.?\s*$/iu, '$1');

  s = s.replace(/(\d{1,3})\s*={2,}\s*/g, '$1=');

  const eq = s.match(/^(\d{1,3})(\s*=\s*)(.+)$/);
  if (!eq) return s;

  let rhs = eq[3].trim().replace(/\s+/g, '');

  const mPair = rhs.match(/^(\d{1,3})-(\d{1,3})-(\d+)(.*)$/);
  if (mPair && /[\u00D7\u2715\u2716xX*]/.test(mPair[4])) {
    return `${eq[1]}=${rhs}`;
  }

  let prev = '';
  while (prev !== rhs) {
    prev = rhs;
    rhs = rhs.replace(/(\d)=+(\d)/g, '$1*$2');
  }

  if (!/^(\d{1,3}-\d{1,3}-\d+)/.test(rhs) || !/[\u00D7\u2715\u2716xX*]/.test(rhs)) {
    rhs = rhs.replace(/(\d)-(\d)/g, '$1*$2');
  }

  return `${eq[1]}=${rhs}`;
}

/** ชื่อคนในกลุ่มไลน์แบบ "นิ่ม/92" "P\"นุชจัง/94" — ไม่มี = */
function isLineGroupSenderTag(line: string): boolean {
  if (line.includes('=')) return false;
  const t = line.trim();
  if (!/[\/／]\d{2,3}\s*$/.test(t)) return false;
  if (/[\u0E00-\u0E7F]/.test(t)) return true;
  if (/^P["']?/i.test(t)) return true;
  return false;
}

/** ข้อความแทรกจากการก๊อปแชท (เช่น วันที่แบบสั้น / ตัวเลขหัวข้อ) */
function isLinePasteMetadataNoise(line: string): boolean {
  const t = line.trim();
  if (/^\d{1,2}-\d{1,2}-\d{1,4}\s*$/.test(t)) return true;
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/.test(t)) return true;
  if (/^หวยไทย/u.test(t)) return true;
  if (/^600\s*$/.test(t)) return true;
  return false;
}

/**
 * ตัดเวลา/ชื่อผู้ส่งจากแชท LINE, ลบ zero-width, แปลง × และ " ระหว่างตัวเลข เป็น *
 * จากนั้นต่อบรรทัดที่ไลน์ตัด (preJoinFragments) — แล้ว normalize สมการ (==, = คั่นราคา, ขีดหลัง = , ตัดท้าย บลต)
 * ผลลัพธ์ใช้ paste หรือส่งเข้า parseLineBetsText
 */
export function normalizeLinePasteText(raw: string): string {
  const withNl = raw.replace(/\r\n|\r/g, '\n');
  const timeStripped = withNl
    .split('\n')
    .map((l) => {
      const a = stripLinePasteInvisible(l);
      return stripLineChatTimePrefix(a).trim();
    })
    .join('\n');
  const joined = preJoinFragments(timeStripped);
  const out: string[] = [];
  for (const rawLine of joined.split('\n')) {
    let line = stripLinePasteInvisible(rawLine).trim();
    if (!line) continue;
    line = normalizeLinePasteBetSeparators(line);
    if (!line) continue;
    line = normalizeLineEquationStyles(line);
    if (!line) continue;
    if (isLineGroupSenderTag(line)) continue;
    if (isLinePasteMetadataNoise(line)) continue;
    out.push(line);
  }
  return out.join('\n');
}

/** แบ่งโพยรวมหลายข้อความไลน์ที่ต้นบรรทัดมีเวลา HH:MM */
export function splitLinePasteByChatClock(raw: string): string[] {
  const nl = raw.replace(/\r\n|\r/g, '\n').trim();
  if (!nl) return [];
  return nl.split(/(?=\n\d{1,2}:\d{2}\s+)/).map((s) => s.trim()).filter(Boolean);
}

export function parseLineBetsTextWithSegments(text: string): LineImportResult {
  const chunks = splitLinePasteByChatClock(text);
  const sources = chunks.length > 0 ? chunks : (text.trim() ? [text.trim()] : []);
  if (!sources.length) return { bets: [], parsedCount: 0, skippedCount: 0 };
  const allBets: ParsedBet[] = [];
  let parsedCount = 0;
  let skippedCount = 0;
  for (let i = 0; i < sources.length; i++) {
    const r = parseLineBetsText(sources[i]);
    const seg = i + 1;
    for (const b of r.bets) allBets.push({ ...b, segment_index: seg });
    parsedCount += r.parsedCount;
    skippedCount += r.skippedCount;
  }
  return { bets: allBets, parsedCount, skippedCount };
}

/**
 * Parse a full paste of LINE message text into bets.
 *
 * Supports GROUP format: bare numbers on their own lines, followed by a
 * "number=amount" line → all accumulated numbers get the same amount.
 *
 * Also supports SECTION HEADERS from LINE group format:
 *   "2 ตัวบน"   → context: subsequent NUM=A×A means NUM top=A + klap(NUM) top=A
 *   "2 ตัวล่าง" → context: subsequent NUM=A×A means NUM bottom=A + klap(NUM) bottom=A
 *   "3 ตัวบน"   → context: NUM=A×B means 3ตัวบน×โต๊ด (normal 3digit parsing)
 *   "บต" (ไลน์) → เหมือน 3 ตัวบน: เลข 3 หลัก NUM=A×B = บน A + โต๊ด B
 *   "บล" (ไลน์) → เลข 2 หลัก NUM=A×B = 2บน+2ล่าง; เลข 3 หลัก NUM=A×B = 3บน A + 3ล่าง B (ไม่ใช่โต๊ด)
 *   หัว "บน" บรรทัดเดียว → ถัดไปเน้นขาบน (เหมือน 2 ตัวบนสำหรับ 2 หลัก; 3 หลัก parse ตาม parseBetLine)
 *
 *   816 20*6 กลับ     → 3บนกลับครบ permutation (ตัวละ 20)
 *   470 บ50 ต50         → 3บน=50, โต๊ด=50
 *   ── under "2 ตัวบน" header ──
 *   65=500×500          → 65บน=500 + 56บน=500  (กลับเลข: A=เลขตั้งต้น, B=เลขกลับ)
 *   66=500              → 66บน=500 only
 *   ── under "2 ตัวล่าง" header ──
 *   79=1000×1000        → 79ล่าง=1000 + 97ล่าง=1000  (กลับเลข: A=เลขตั้งต้น, B=เลขกลับ)
 *
 *   91 ล่าง 20         → 91 เฉพาะ 2ล่าง 20 (เทียบ 91=0*20; ไม่ให้ 91 ค้างไปรวมบรรทัดถัดไป)
 *   65 บน 50           → 65 เฉพาะ 2บน 50
 *   256 บ30 ล30 ต3     → 3บน+โต๊ด+3ล่าง (ลำดับคำย่อ บ/ล/ต เรียงได้อิสระ)
 *   830-50*50 … 04-40-150*150 — หลายโทเค็นช่องว่างเดียวกัน (NN-NN-A*B = 2บน+2ล่าง ต่อเลข)
 *
 *   ── หลายบรรทัดแล้วราคาท้ายบรรทัด (= นำหน้าได้) ──
 *   571 / 175 / … / =10*10  → ทุกเลขก่อนหน้าได้ 10*10
 *   ── เลข+ราคาช่องว่าง แล้วเลขเปล่าต่อท้าย (ต่อราคา) ──
 *   460 10*10 / 46 20*20 / 64 / 40 / … / 70 20*20  → เลขเปล่าใช้ราคาล่าสุดที่มี * หรือหลายช่อง
 *
 * normalizeLinePasteText: ==/=== , 98=50=50 , 628=30-30-30 , ท้าย "บลต" → โครง NUM=ราคา*ราคา
 */
export function parseLineBetsText(text: string): LineImportResult {
  const cleaned = normalizeLinePasteText(text);
  const allBets: ParsedBet[] = [];
  const pending: string[] = [];  // bare numbers waiting for an amount line
  /** ราคาจากบรรทัด NUM+ราคา (มี * หรือ +) — ใช้กับเลขเปล่าถัดไปเมื่อไม่มี pending ค้าง */
  let lineForwardFill: string | null = null;
  let parsedCount  = 0;
  let skippedCount = 0;
  let sectionMode: SectionMode = 'none';

  const pushBet = (number: string, bet_type: ParsedBet['bet_type'], amount: number) => {
    allBets.push({ number, bet_type, amount });
  };

  const amountTriggersForwardFill = (amountStr: string) =>
    amountStr.includes('*') || amountStr.includes('+');

  const applyAmountToNumbers = (nums: string[], amountStr: string) => {
    const hadThreeDigitSlot = nums.some((n) => n.length === 3);

    for (const num of nums) {
      const hasTwoParts = amountStr.includes('+');

      // ── 3digit กลับ (from NUM=AMT*klap pattern) ───────────────────
      if (amountStr.endsWith('*klap')) {
        const amt = Number(amountStr.replace('*klap', ''));
        if (!isNaN(amt) && amt > 0 && num.length === 3) {
          const perms = getPermutations(num);
          for (const perm of perms) pushBet(perm, '3digit_top', amt);
          parsedCount++;
        } else { skippedCount++; }
        continue;
      }

      // ── Section-aware logic (เฉพาะเลข 2 หลัก — เลข 3 หลักต้องไม่ถูกบังคับเป็น 2digit_*) ──
      if (sectionMode === '2top' || sectionMode === '2bot') {
        if (num.length !== 2) {
          const result = parseBetLine(num, amountStr);
          if (!result.error && result.bets.length) {
            allBets.push(...result.bets);
            parsedCount++;
          } else { skippedCount++; }
          continue;
        }
        const betType: ParsedBet['bet_type'] = sectionMode === '2top' ? '2digit_top' : '2digit_bottom';

        if (hasTwoParts) {
          // NUM=A×B under section → กลับเลข: NUM betType=A + klap(NUM) betType=B
          const parts = amountStr.split('+');
          const amt1 = Number(parts[0]) || 0;
          const amt2 = Number(parts[1]) || 0;
          const k = klap2(num);
          if (amt1 > 0 || amt2 > 0) {
            if (amt1 > 0) pushBet(num, betType, amt1);
            if (amt2 > 0 && k !== num) pushBet(k, betType, amt2);
            parsedCount++;
          } else { skippedCount++; }
        } else {
          // Single amount under section → just the number, no klap
          const amt = Number(amountStr);
          if (!isNaN(amt) && amt > 0) {
            pushBet(num, betType, amt);
            parsedCount++;
          } else { skippedCount++; }
        }
        continue;
      }

      // ── 3 ตัวล่าง (หัวข้อ): NUM=100 → เฉพาะ 3ล่าง ─────────
      if (sectionMode === '3back') {
        if (num.length === 3 && !hasTwoParts) {
          const amt = Number(amountStr);
          if (!isNaN(amt) && amt > 0) {
            pushBet(num, '3digit_back', amt);
            parsedCount++;
          } else { skippedCount++; }
        } else {
          const result = parseBetLine(num, amountStr);
          if (!result.error && result.bets.length) {
            allBets.push(...result.bets);
            parsedCount++;
          } else { skippedCount++; }
        }
        continue;
      }

      // ── บล: เลข 3 หลัก NUM=A*B → 3บน + 3ล่าง (ไม่ใช่โต๊ด) ─────────
      if (sectionMode === '3bl' && num.length === 3) {
        const amtSegs = amountStr.split('+').map((p) => p.trim()).filter(Boolean);
        if (amtSegs.length >= 3) {
          const result = parseBetLine(num, amountStr);
          if (!result.error && result.bets.length) {
            allBets.push(...result.bets);
            parsedCount++;
          } else { skippedCount++; }
          continue;
        }
        if (hasTwoParts) {
          const parts = amountStr.split('+');
          const amt1 = Number(parts[0]) || 0;
          const amt2 = Number(parts[1]) || 0;
          if (amt1 > 0) pushBet(num, '3digit_top', amt1);
          if (amt2 > 0) pushBet(num, '3digit_back', amt2);
          parsedCount++;
        } else {
          const amt = Number(amountStr);
          if (!isNaN(amt) && amt > 0) {
            pushBet(num, '3digit_top', amt);
            parsedCount++;
          } else { skippedCount++; }
        }
        continue;
      }

      // ── Default / 3ตัวบน section (use parseBetLine as before) ─────
      const result = parseBetLine(num, amountStr);
      if (!result.error && result.bets.length) {
        allBets.push(...result.bets);
        parsedCount++;
      } else { skippedCount++; }
    }

    // หลังเลข 3 หลักในกลุ่มเดียวกับราคา — ไลน์มักไม่มีหัวข้อปิดท้าย ให้รีเซ็ตโหมด 2บน/2ล่าง
    // (ไม่งั้น "ล่าง" ค้างแล้ว 30=50*50 ถูกตีเป็น ล่าง+กลับแทน บน+ล่าง)
    if (hadThreeDigitSlot && (sectionMode === '2top' || sectionMode === '2bot')) sectionMode = 'none';
  };

  const flush = (numberWithAmt: string, amountStr: string) => {
    const hadPending = pending.length > 0;
    applyAmountToNumbers([...pending, numberWithAmt], amountStr);
    pending.length = 0;
    if (hadPending) lineForwardFill = null;
    else if (amountTriggersForwardFill(amountStr)) lineForwardFill = amountStr;
    else lineForwardFill = null;
  };

  const rawLines = cleaned.split('\n');
  for (let lineIdx = 0; lineIdx < rawLines.length; lineIdx++) {
    const line = rawLines[lineIdx].trim();
    if (!line) continue;

    // ── Detect section headers ─────────────────────────────────────
    if (/^บน\s*\/\s*ล่าง\s*$/u.test(line))     { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = 'none'; continue; }
    if (/^บน\s*$/u.test(line))                  { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '2top';  continue; }
    if (/บ\s*[-–—]\s*ต/u.test(line) && !/=/.test(line)) {
      skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '3top'; continue;
    }
    if (/^2\s*ตัวบน$/u.test(line))              { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '2top';  continue; }
    if (/^2\s*ตัวล่าง$|^ล่าง$/u.test(line))     { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '2bot';  continue; }
    if (/^3\s*ตัวบน$/u.test(line))              { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '3top';  continue; }
    if (/^3\s*ตัวล่าง$/u.test(line))            { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '3back'; continue; }
    if (/^เต็ง\s*[-–—]\s*โต๊ด$/u.test(line))     { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '3top';  continue; }
    if (/^บต\.?\s*$/u.test(line))               { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '3top';  continue; }
    if (/^บล\.?\s*$/u.test(line))               { skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = '3bl'; continue; }
    // Any other Thai "ตัว" or "วิ่ง" header resets to default  
    // (exclude กลับ ตัวละ commands from this reset)
    if (/ตัว|วิ่ง/u.test(line) && !/\d\s*=/.test(line) && !/กลับ.*ตัวละ/u.test(line)) {
      skippedCount += pending.length; pending.length = 0; lineForwardFill = null; sectionMode = 'none'; continue;
    }

    // ── "91 ล่าง 20" / "65 บน 100" — ระบุขาเดียว (กันเลขค้าง pending ไปรวมบรรทัดถัดไป) ──
    {
      const oneSide = line.match(/^(\d{1,3})\s+(ล่าง|บน)\s+(\d+)\s*(?:บาท|฿)?\s*[.。]*\s*$/u);
      if (oneSide) {
        const num = oneSide[1];
        const isBottom = oneSide[2] === 'ล่าง';
        const amt = Number(oneSide[3]);
        if (amt > 0 && /^\d+$/.test(num)) {
          skippedCount += pending.length;
          pending.length = 0;
          lineForwardFill = null;
          let amountStr: string;
          if (num.length === 1 || num.length === 2) {
            amountStr = isBottom ? `0+${amt}` : `${amt}+0`;
          } else {
            amountStr = isBottom ? `0+0+${amt}` : `${amt}+0+0`;
          }
          const result = parseBetLine(num, amountStr);
          if (!result.error && result.bets.length) {
            allBets.push(...result.bets);
            parsedCount++;
          } else skippedCount++;
          continue;
        }
      }
    }

    // ── CSV numbers with shared amount: "584,589,481,...=30*30" ──────────
    // ต้องก่อนบล็อกรายการคั่นจุลภาค+ไทย — ไม่งั้น "=30*30" ถูกไปจับแค่เลข 30 ตัวสุดท้าย
    {
      const csvMatch = line.match(/^((?:\d{1,3}\s*,\s*)+\d{1,3})\s*=\s*(.+)$/);
      if (csvMatch) {
        const nums = csvMatch[1].split(',').map(n => n.trim()).filter(n => /^\d{1,3}$/.test(n));
        const amtRaw = csvMatch[2].trim();
        if (nums.length > 0) {
          skippedCount += pending.length;
          pending.length = 0;
          lineForwardFill = null;
          for (const n of nums) {
            const result = parseBetLine(n, amtRaw);
            if (!result.error && result.bets.length) {
              allBets.push(...result.bets);
              parsedCount++;
            } else { skippedCount++; }
          }
          continue;
        }
      }
    }

    // ── "321,412,038 10*10" — ช่องว่างระหว่างรายการกับราคา (ไม่มี =) ──
    {
      const csvSp = line.match(
        /^((?:\d{1,3}\s*,\s*)+\d{1,3})\s+(\d+(?:[\*×xX\u00D7\u2715%:\-]\d+)+)\s*$/
      );
      if (csvSp) {
        const nums = csvSp[1].split(',').map(n => n.trim()).filter(n => /^\d{1,3}$/.test(n));
        const amtRaw = csvSp[2].trim();
        if (nums.length > 0) {
          skippedCount += pending.length;
          pending.length = 0;
          lineForwardFill = null;
          for (const n of nums) {
            const result = parseBetLine(n, amtRaw);
            if (!result.error && result.bets.length) {
              allBets.push(...result.bets);
              parsedCount++;
            } else { skippedCount++; }
          }
          continue;
        }
      }
    }

    // ── "27,72,18,81 บน+ล่าง ตัวละ 50 บาท" / "137, 173,...,713,บน 50฿" ─
    // CSV numbers followed by Thai descriptor containing amount
    {
      const commaNumsMatch = line.match(
        /^((?:\d{1,3}\s*,\s*)+\d{1,3}),?\s*.*?(\d+)\s*(?:บาท|฿)?\s*[.。]*\s*$/u
      );
      if (commaNumsMatch) {
        const nums = commaNumsMatch[1].split(',').map(n => n.trim()).filter(n => /^\d{1,3}$/.test(n));
        const amt  = Number(commaNumsMatch[2]);
        // Check for บน+ล่าง or บน, ล่าง keywords
        const hasTop = /บน/u.test(line);
        const hasBot = /ล่าง/u.test(line);
        if (nums.length > 0 && amt > 0) {
          for (const n of nums) {
            const mode: BetInputMode = n.length === 3 ? '3digit' : n.length === 1 ? 'run' : '2digit';
            if (mode === '2digit') {
              if (hasTop) pushBet(n, '2digit_top', amt);
              if (hasBot) pushBet(n, '2digit_bottom', amt);
              if (!hasTop && !hasBot) pushBet(n, '2digit_top', amt);
            } else if (mode === '3digit') {
              pushBet(n, '3digit_top', amt);
            } else {
              if (hasTop) pushBet(n, '1digit_top', amt);
              if (hasBot) pushBet(n, '1digit_bottom', amt);
            }
            parsedCount++;
          }
          continue;
        }
      }
    }

    // ── ช่องว่างคั่นหลายโทเค็น: 830-50*50 504-50*50 04-40-150*150 ─
    {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length >= 1) {
        let allOk = true;
        for (const tok of tokens) {
          const triple = tok.match(/^(\d{1,3})-(\d{1,3})-(\d+)([\*xX\u00D7\u2715%:\-])(\d+)$/);
          if (triple) continue;
          if (!parseToken(tok)) { allOk = false; break; }
        }
        if (allOk && (tokens.length >= 2 || pending.length === 0)) {
          skippedCount += pending.length;
          pending.length = 0;
          lineForwardFill = null;
          for (const tok of tokens) {
            const tr = tok.match(/^(\d{1,3})-(\d{1,3})-(\d+)([\*xX\u00D7\u2715%:\-])(\d+)$/);
            if (tr) {
              const amtStr = `${tr[3]}+${tr[5]}`;
              flush(tr[1], amtStr);
              flush(tr[2], amtStr);
            } else {
              const p = parseToken(tok)!;
              flush(p.number, p.amountStr);
            }
          }
          continue;
        }
      }
    }

    // ── Multi-pair inline: NUM1 AMT1 NUM2 AMT2 ... ────────────────
    // e.g. "49 50*50 82 50*50 70 20*20"  (table row from lottery slip)
    // e.g. "544 20*20*20 857 30*30*30"   (3-digit with 3 amounts)
    // e.g. "27 100 72 100 30 50*50"      (mixed single/double amounts)
    {
      const pairPat = /^(\d{1,3})\s+(\d+(?:[*×xX\u00D7]\d+)*)(?:\s|$)/u;
      const pairs: Array<{ number: string; amountStr: string }> = [];
      let rest = line.trim();
      while (rest.length > 0) {
        const m = rest.match(pairPat);
        if (!m) break;
        const normAmt = m[2].replace(/[×xX\u00D7]/g, '*');
        pairs.push({ number: m[1], amountStr: splitAmounts(normAmt).join('+') || normAmt });
        rest = rest.slice(m[0].length).trimStart();
      }
      if (pairs.length >= 2 && rest.trim() === '') {
        for (const p of pairs) flush(p.number, p.amountStr);
        continue;
      }
    }

    // ── NUM/NUM/... slash-separated numbers sharing one amount ─────
    // e.g. "30/03-10*10"  → treat as "30-10*10" and "03-10*10"
    {
      const slashMatch = line.match(/^([\d\/]+?)\s*[\-=]\s*(.+)$/);
      if (slashMatch) {
        const nums = slashMatch[1].split('/').map(n => n.trim()).filter(n => /^\d{1,3}$/.test(n));
        if (nums.length >= 2) {
          // reconstruct amountStr from remainder
          const amtPart = slashMatch[2].trim();
          const amtParts = splitAmounts(amtPart);
          const amountStr = amtParts.length >= 2 ? `${amtParts[0]}+${amtParts[1]}` : (amtParts[0] ?? amtPart);
          for (const n of nums) flush(n, amountStr);
          continue;
        }
      }
    }

    // ── Standalone price line: "30*30" or "=10*10" (ท้ายบล็อกเลขเปล่า) ──
    {
      const compact = line.replace(/\s+/g, '').replace(/[xX×]/g, '*').replace(/^=+/, '');
      const priceOnly = /^(\d+(?:\*\d+)+)$/.test(compact);
      if (priceOnly && pending.length > 0) {
        lineForwardFill = null;
        const amtParts = splitAmounts(compact);
        const amountStr = amtParts.join('+');
        for (const num of pending.splice(0)) {
          const result = parseBetLine(num, amountStr);
          if (!result.error && result.bets.length) { allBets.push(...result.bets); parsedCount++; }
          else { skippedCount++; }
        }
        continue;
      }
    }

    // ── "6กลับ ตัวละ N บาท" command ─────────────────────────────────
    // Flush pending numbers as all-permutations at given price
    {
      const klapCmd = line.match(/^\d*กลับ\s+ตัวละ\s+(\d+)\s*บาท?$/u);
      if (klapCmd) {
        const amt = Number(klapCmd[1]);
        lineForwardFill = null;
        if (amt > 0 && pending.length > 0) {
          for (const num of pending.splice(0)) {
            const perms = getPermutations(num);
            const type: ParsedBet['bet_type'] = num.length === 3 ? '3digit_top' : '2digit_top';
            for (const perm of perms) pushBet(perm, type, amt);
            parsedCount++;
          }
        } else { skippedCount++; }
        continue;
      }
    }

    // ── Standard single-line extraction ───────────────────────────
    const withAmt = extractLineAmount(line);
    if (withAmt) {
      // เลข 2 หลักแบบ 89=50 หลังกลุ่มที่มีเลข 3 หลัก แล้วตามด้วยบรรทัดราคาเดี่ยว (20*20) — ไม่รวม pending
      if (
        pending.length > 0 &&
        withAmt.number.length === 2 &&
        pending.some((n) => n.length === 3)
      ) {
        let j = lineIdx + 1;
        while (j < rawLines.length && !rawLines[j].trim()) j++;
        if (j < rawLines.length) {
          const nextCompact = rawLines[j].trim().replace(/\s+/g, '').replace(/[xX×]/g, '*').replace(/^=+/, '');
          if (/^(\d+(?:\*\d+)+)$/.test(nextCompact)) {
            applyAmountToNumbers([withAmt.number], withAmt.amountStr);
            if (amountTriggersForwardFill(withAmt.amountStr)) lineForwardFill = withAmt.amountStr;
            else lineForwardFill = null;
            continue;
          }
        }
      }
      flush(withAmt.number, withAmt.amountStr);
      continue;
    }

    const bare = extractBareNumber(line);
    if (bare) {
      if (lineForwardFill && pending.length === 0) {
        applyAmountToNumbers([bare], lineForwardFill);
        continue;
      }
      pending.push(bare);
      continue;
    }

    // ── Number with Thai annotation: "678 ตรงโต๊ด" → bare number ──
    {
      const numThai = line.match(/^(\d{1,3})\s+[\u0E00-\u0E7F]/u);
      if (numThai) { pending.push(numThai[1]); continue; }
    }

    skippedCount++;
  }

  // Orphaned numbers with no following amount line
  skippedCount += pending.length;

  return { bets: allBets, parsedCount, skippedCount };
}

// ─── Preview label ────────────────────────────────────────────────────────────

export function describeParsedBets(bets: ParsedBet[]): string {
  if (!bets.length) return '';
  const map: Record<string, string> = {
    '3digit_top': '3บน', '3digit_tote': 'โต๊ด', '3digit_back': '3ล่าง',
    '2digit_top': '2บน', '2digit_bottom': '2ล่าง',
    '1digit_top': 'วิ่งบน', '1digit_bottom': 'วิ่งล่าง',
  };
  return bets.map((b: ParsedBet) => `${b.number} ${map[b.bet_type] ?? b.bet_type}=${b.amount.toLocaleString()}`).join(', ');
}

// ─── Number input hint ────────────────────────────────────────────────────────

export function describeNumberExpansion(input: string): string {
  const s = input.trim();
  if (!s) return '';
  if (s === '--') return 'เลขเบิ้ล: 00,11,...,99 (10 เลข)';
  const numKlapHint = s.match(/^(\d{2,3})-$/);
  if (numKlapHint) {
    const d = numKlapHint[1];
    const perms = getPermutations(d);
    return `กลับ ${d}: ${perms.length} เลข (${perms.join(', ')})`;
  }
  const rangeMatch = s.match(/^(\d{1,2})-(\d{1,2})$/);
  if (rangeMatch) {
    const from = parseInt(rangeMatch[1], 10);
    const to   = parseInt(rangeMatch[2], 10);
    if (from <= to) return `เลขถึง: ${from.toString().padStart(2,'0')}-${to.toString().padStart(2,'0')} (${to - from + 1} เลข)`;
  }
  if (s.match(/^\*\d\*$/) || s.match(/^\d\*\*$/)) {
    const d = s.replace(/\*/g, '');
    return `ราวหน้า/หลัง ${d}: ${d}0-${d}9 + 0${d}-9${d}`;
  }
  if (s.match(/^\d\*$/))  return `ราวหน้า ${s[0]}: ${s[0]}0,...,${s[0]}9 (10 เลข)`;
  if (s.match(/^\*\d$/))  return `ราวหลัง ${s[1]}: 0${s[1]},...,9${s[1]} (10 เลข)`;
  if (/^\d$/.test(s))     return `วิ่ง ${s}`;
  if (/^\d{2}$/.test(s))  return `2 ตัว`;
  if (/^\d{3}$/.test(s))  return `3 ตัว`;
  return 'รูปแบบไม่ถูกต้อง';
}

// ─── PDF / OCR import ──────────────────────────────────────────────────────────

/**
 * โพยมือแบบวงเล็บ } — รายการเลขแนวตั้งหลายตัว แล้วราคาเดียวกันข้างวงเล็บ (เช่น 50 x 50)
 * แปลงเป็น N บรรทัด NUM=amt*amt เพื่อ import ข้อความตรงกับ parseToken / parseLineBetsText
 */
export function normalizeOcrCurlyBraceGroups(rawText: string): string {
  const lines = rawText.replace(/\r\n|\r/g, '\n').split('\n');
  const out: string[] = [];
  let buf: string[] = [];

  const isBareBetNum = (s: string) => /^(?:\d{2}|\d{3})$/.test(s.trim());

  const normalizeBare = (s: string) => s.replace(/[Oo]/g, '0');

  const parseSharedPriceLine = (raw: string): string | null => {
    let s = raw.replace(/\t/g, ' ').trim();
    if (!s) return null;
    s = normalizeOcrBetSymbols(s);
    s = s.replace(/\s+/g, '');
    s = s.replace(/[xX×]/g, '*');
    if (!/^\d+(?:\*\d+)+$/.test(s)) return null;
    const segs = s.split('*');
    if (segs.length < 2 || segs.some((p) => !/^\d+$/.test(p))) return null;
    return segs.join('*');
  };

  const flushBufBare = () => {
    for (const n of buf) out.push(n);
    buf = [];
  };

  const expandBuf = (price: string) => {
    for (const n of buf) out.push(`${n}=${price}`);
    buf = [];
  };

  for (const raw of lines) {
    let line = raw.replace(/\t/g, ' ').trim();
    if (!line) continue;

    // เส้นวงเล็บ / ขีด จาก OCR เดี่ยวๆ — ข้าม
    if (/^[\}\{\|\[\]\(\)\/\\_\-]+$/.test(line)) continue;

    // หลายเลขในบรรทัดเดียว: "817 125 417 426 205"
    const compactNums = line.replace(/\s+/g, ' ').trim();
    const multiNum = compactNums.match(/^(\d{2,3}(?:\s+\d{2,3})+)$/);
    if (multiNum) {
      const parts = compactNums.split(/\s+/).filter(isBareBetNum).map(normalizeBare);
      if (parts.length === 2 && parts[0] === parts[1] && buf.length > 0) {
        expandBuf(`${parts[0]}*${parts[1]}`);
        continue;
      }
      if (parts.length >= 2) {
        if (buf.length && buf[0].length !== parts[0].length) flushBufBare();
        buf.push(...parts);
        continue;
      }
    }

    if (isBareBetNum(line)) {
      const n = normalizeBare(line.trim());
      if (buf.length && buf[0].length !== n.length) flushBufBare();
      buf.push(n);
      continue;
    }

    const price = parseSharedPriceLine(line);
    if (price !== null) {
      if (buf.length > 0) expandBuf(price);
      continue;
    }

    if (/[\u0E00-\u0E7F]/.test(line)) {
      if (buf.length) flushBufBare();
      out.push(line);
      continue;
    }

    if (buf.length) flushBufBare();
    out.push(line);
  }

  if (buf.length) flushBufBare();

  return out.join('\n');
}

/**
 * แปลงสัญลักษณ์ยูนิโค้ด / เว้นวรรครอบ = * จาก OCR (สติกเกอร์ LINE, ภาพ)
 */
export function normalizeOcrBetSymbols(line: string): string {
  let s = line
    .replace(/[\uFF1D﹦＝]/g, '=')
    .replace(/[\uFF0A＊∗﹡]/g, '*')
    .replace(/[\u00D7\u2715\u2716]/g, '*');
  s = s.replace(/\s+/g, ' ').trim();
  return s.replace(/\s*=\s*/g, '=').replace(/\s*\*\s*/g, '*');
}

/**
 * แปลงข้อความจาก OCR โพยตาราง / โพยวงเล็บ — เรียก normalizeOcrCurlyBraceGroups ก่อน
 * · แนวตั้งหลายเลข + ราคาเดียว (50 x 50) → 817=50*50…
 * · "548 20 20 20" → "548 20*20*20" · "13 30 30" → "13 30*30"
 * · หัวข้อไลน์ บนล่าง / บนโต๊ด
 */
export function normalizeHandwrittenSlipTableOcr(rawText: string): string {
  const expanded = normalizeOcrCurlyBraceGroups(rawText);
  const lines = expanded.replace(/\r\n|\r/g, '\n').split('\n');
  const out: string[] = [];
  /** บริบทจากข้อความไทยบนภาพสติกเกอร์ (OCR อาจอ่านได้บางส่วน) */
  let slipSection: 'none' | 'bon_lang' | 'bon_tod' = 'none';

  for (let line of lines) {
    line = line.replace(/\t/g, ' ');
    line = normalizeOcrBetSymbols(line);
    if (!line) continue;

    // หัวข้อแยกกลุ่ม (ไม่ใส่ใน out)
    if (/บน\s*ล่าง|บนล่าง/u.test(line) && !/โต๊ด/u.test(line)) {
      slipSection = 'bon_lang';
      continue;
    }
    if (/บน\s*โต๊ด|บนโต๊ด/u.test(line)) {
      slipSection = 'bon_tod';
      continue;
    }

    // แก้ O/o ที่มักออกจาก OCR ในช่องตัวเลข
    if (/^\d/.test(line)) {
      line = line.replace(/[Oo]/g, '0');
    }

    // 3 หลัก + บน + ล่าง + โต๊ด — ตารางโพยมักเรียง บน|ล่าง|โต๊ด แต่ parseBetLine(3digit) คาด บน|โต๊ด|ล่าง
    const m3 = line.match(/^(\d{3})\s+(\d+)\s+(\d+)\s+(\d+)$/);
    if (m3) {
      const top = m3[2];
      const bottom = m3[3];
      const tote = m3[4];
      out.push(`${m3[1]} ${top}*${tote}*${bottom}`);
      continue;
    }

    // 3 หลัก เฉพาะบน+ล่าง (OCR ตกคอลโต๊ด) — หรือบน+โต๊ดเมื่อมีหัวข้อบนโต๊ด
    const m3pair = line.match(/^(\d{3})\s+(\d+)\s+(\d+)$/);
    if (m3pair) {
      if (slipSection === 'bon_tod') {
        out.push(`${m3pair[1]} ${m3pair[2]}*${m3pair[3]}*0`);
      } else {
        out.push(`${m3pair[1]} ${m3pair[2]}*0*${m3pair[3]}`);
      }
      continue;
    }

    // 2 หลัก + บน + ล่าง (ไม่มีโต๊ด)
    const m2 = line.match(/^(\d{2})\s+(\d+)\s+(\d+)$/);
    if (m2) {
      out.push(`${m2[1]} ${m2[2]}*${m2[3]}`);
      continue;
    }

    out.push(line);
  }

  return out.join('\n');
}

/**
 * ดึงรายการเดิมพันจากข้อความ PDF/OCR — รองรับทั้ง
 * - "เลข 20*20*20" (ช่องว่าง)
 * - "เลข=20*20" (= จากสติกเกอร์/สกรีนช็อต)
 * แล้ว parseLineBetsText
 */
export function parsePdfBetsText(rawText: string): LineImportResult & { extractedLines: string } {
  const normalized = rawText
    .replace(/[\u00D7\u2715\u2716]/g, '*')
    .replace(/\r\n|\r/g, '\n');

  const lines: string[] = [];
  const seen = new Set<string>();
  const addRow = (row: string) => {
    if (!seen.has(row)) {
      seen.add(row);
      lines.push(row);
    }
  };

  const perLineMulti = /(?<!\d)(\d{1,3})\s+(\d+(?:\*\d+)*)(?!\d)/g;

  for (const rawLine of normalized.split('\n')) {
    const line = normalizeOcrBetSymbols(rawLine.trim());
    if (!line) continue;

    const tok = parseToken(line);
    if (tok) {
      addRow(`${tok.number} ${tok.amountStr.replace(/\+/g, '*')}`);
      continue;
    }

    let m: RegExpExecArray | null;
    perLineMulti.lastIndex = 0;
    let any = false;
    while ((m = perLineMulti.exec(line)) !== null) {
      addRow(`${m[1]} ${m[2]}`);
      any = true;
    }
    if (any) continue;
  }

  const extractedLines = lines.join('\n');
  const result = parseLineBetsText(extractedLines);
  const bets = result.bets.map((b) => ({ ...b, segment_index: 1 }));
  return { ...result, bets, extractedLines };
}
