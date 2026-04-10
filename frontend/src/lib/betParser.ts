// ─── betParser.ts ─────────────────────────────────────────────────────────────
// Fast-key bet parser: แปลงรูปแบบเลขและจำนวนเงินเป็น ParsedBet[]

export type BetInputMode = 'run' | '2digit' | '3digit';

export interface ParsedBet {
  number:   string;
  bet_type: '2digit_top' | '2digit_bottom' | '3digit_top' | '3digit_tote' | '3digit_back' | '1digit_top' | '1digit_bottom';
  amount:   number;
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

/**
 * Parse a single "NUM<sep>AMT1<sep>AMT2" token into { number, amountStr }.
 * sep can be = - space (between number and amounts).
 * Returns null if token doesn't look like a bet.
 */
function parseToken(token: string): { number: string; amountStr: string } | null {
  const s = token.trim();
  if (!s) return null;

  // NUM=AMT*กลับ  → 3digit all-perms top
  let m = s.match(/^(\d{3})\s*=\s*(\d+)\s*\*\s*(?:\d+)?กลับ$/u);
  if (m) return { number: m[1], amountStr: `${m[2]}*klap` };

  // NUM=AMT1<sep>AMT2   (= sign, any sep)
  m = s.match(/^(\d{1,3})\s*=\s*(\d+[\u00D7\u2715\u2716xX*%:\-]\d+)$/);
  if (m) {
    const parts = splitAmounts(m[2]);
    if (parts.length >= 2) return { number: m[1], amountStr: `${parts[0]}+${parts[1]}` };
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

  // NUM บTOP ตTOTE ลBOT  (Thai prefix labels บ/ต/ล)
  m = s.match(/^(\d+)(?:\s+\u0E1A(\d+))?(?:\s+\u0E15(\d+))?(?:\s+\u0E25(\d+))?$/u);
  if (m && (m[2] || m[3] || m[4])) {
    return { number: m[1], amountStr: `${m[2] ?? 0}+${m[3] ?? 0}+${m[4] ?? 0}` };
  }

  // NUM AMT1<sep>AMT2  (space between number and amounts, sep for amounts)
  m = s.match(/^(\d{1,3})\s+(\d+[\u00D7\u2715\u2716xX*%:\-]\d+)$/);
  if (m) {
    const parts = splitAmounts(m[2]);
    if (parts.length >= 2) return { number: m[1], amountStr: `${parts[0]}+${parts[1]}` };
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
type SectionMode = 'none' | '2top' | '2bot' | '3top';

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
    if (i + 1 < lines.length) {
      const next = lines[i + 1].trim();
      if (/^[*×xX]\d+$/.test(next) && cur.includes('=')) {
        cur = cur.trim() + next;
        i++;
      }
    }
    out.push(cur);
  }
  return out.join('\n');
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
 *
 *   12=100×100          → บน=100, ล่าง=100  (no section)
 *   470 บ50 ต50         → 3บน=50, โต๊ด=50
 *   ── under "2 ตัวบน" header ──
 *   65=500×500          → 65บน=500 + 56บน=500  (กลับเลข: A=เลขตั้งต้น, B=เลขกลับ)
 *   66=500              → 66บน=500 only
 *   ── under "2 ตัวล่าง" header ──
 *   79=1000×1000        → 79ล่าง=1000 + 97ล่าง=1000  (กลับเลข: A=เลขตั้งต้น, B=เลขกลับ)
 */
export function parseLineBetsText(text: string): LineImportResult {
  const allBets: ParsedBet[] = [];
  const pending: string[] = [];  // bare numbers waiting for an amount line
  let parsedCount  = 0;
  let skippedCount = 0;
  let sectionMode: SectionMode = 'none';

  const pushBet = (number: string, bet_type: ParsedBet['bet_type'], amount: number) => {
    allBets.push({ number, bet_type, amount });
  };

  const flush = (numberWithAmt: string, amountStr: string) => {
    const nums = [...pending, numberWithAmt];
    pending.length = 0;

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

      // ── Section-aware logic ────────────────────────────────────────
      if (sectionMode === '2top' || sectionMode === '2bot') {
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

      // ── Default / 3ตัวบน section (use parseBetLine as before) ─────
      const result = parseBetLine(num, amountStr);
      if (!result.error && result.bets.length) {
        allBets.push(...result.bets);
        parsedCount++;
      } else { skippedCount++; }
    }
  };

  for (const rawLine of preJoinFragments(text).split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    // ── Detect section headers ─────────────────────────────────────
    if (/^2\s*ตัวบน$/u.test(line))              { skippedCount += pending.length; pending.length = 0; sectionMode = '2top';  continue; }
    if (/^2\s*ตัวล่าง$|^ล่าง$/u.test(line))     { skippedCount += pending.length; pending.length = 0; sectionMode = '2bot';  continue; }
    if (/^3\s*ตัวบน$/u.test(line))              { skippedCount += pending.length; pending.length = 0; sectionMode = '3top';  continue; }
    // Any other Thai "ตัว" or "วิ่ง" header resets to default  
    if (/ตัว|วิ่ง/u.test(line) && !/\d\s*=/.test(line)) {
      skippedCount += pending.length; pending.length = 0; sectionMode = 'none'; continue;
    }

    // ── "27,72,18,81 บน+ล่าง ตัวละ 50 บาท" format ────────────
    // CSV numbers followed by Thai descriptor containing amount
    {
      const commaNumsMatch = line.match(/^([\d,]+)\s+.*?(\d+)\s*บาท?$/u);
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

    // ── CSV numbers with shared amount: "584,589,481,...=30*30" ──────────
    // Matches comma-separated 1-3 digit numbers followed by =AMT×AMT
    {
      const csvMatch = line.match(/^((?:\d{1,3}\s*,\s*)+\d{1,3})\s*=\s*(.+)$/);
      if (csvMatch) {
        const nums = csvMatch[1].split(',').map(n => n.trim()).filter(n => /^\d{1,3}$/.test(n));
        const amtRaw = csvMatch[2].trim();
        if (nums.length > 0) {
          skippedCount += pending.length;
          pending.length = 0;
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

    // ── "A-B-AMT*AMT" pairs split by space: 04-40-150*150 10-01-150*150 ──
    // Pattern: two 2-digit numbers paired with amounts → each number gets the amount
    {
      // detect if line contains tokens like NN-NN-AMT*AMT or NN-NN-AMT-AMT
      const pairPat = /^((?:\d{1,3}-\d{1,3}-\d+[\*xX\u00D7\u2715%:\-]\d+\s*)+)$/;
      if (pairPat.test(line)) {
        const tokens = line.trim().split(/\s+/);
        let allOk = true;
        for (const tok of tokens) {
          // NN-NN-AMT*AMT → num1=NN, num2=NN, amts=AMT*AMT
          const pm = tok.match(/^(\d{1,3})-(\d{1,3})-(\d+)([\*xX\u00D7\u2715%:\-])(\d+)$/);
          if (pm) {
            const n1 = pm[1], n2 = pm[2], a1 = Number(pm[3]), a2 = Number(pm[5]);
            flush(n1, `${a1}+${a2}`);
            flush(n2, `${a1}+${a2}`);
          } else { allOk = false; }
        }
        if (allOk) continue;
      }
    }

    // ── Multiple space-separated bet-tokens in one line ────────────
    // e.g. "830-50*50 504-50*50" or "830-50*50 504-50*50"
    // Split by whitespace and try to parse each as a token
    {
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const parsed: Array<{ number: string; amountStr: string }> = [];
        let allParsed = true;
        for (const part of parts) {
          const t = parseToken(part);
          if (t) { parsed.push(t); }
          else { allParsed = false; break; }
        }
        if (allParsed && parsed.length >= 2) {
          for (const p of parsed) flush(p.number, p.amountStr);
          continue;
        }
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

    // ── Standard single-line extraction ───────────────────────────
    const withAmt = extractLineAmount(line);
    if (withAmt) { flush(withAmt.number, withAmt.amountStr); continue; }

    const bare = extractBareNumber(line);
    if (bare) { pending.push(bare); continue; }

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
