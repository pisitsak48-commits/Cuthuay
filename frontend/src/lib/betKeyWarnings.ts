import {
  expandNumberInput,
  type ParseResult,
  type BetInputMode,
} from '@/lib/betParser';

export type BetKeyWarningKind =
  | 'ambiguous_short_digit'
  | 'bulk_2digit'
  | 'bulk_3digit'
  | 'bulk_run'
  | 'bulk_range';

export type BetKeyWarning = {
  kind: BetKeyWarningKind;
  message: string;
  /** true = ห้ามบันทึกจนกว่าจะแก้เลข */
  blockCommit: boolean;
};

const BULK_WARN_COUNT = 5;
const BULK_BLOCK_COUNT = 8;

function expansionKind(mode: BetInputMode, numInput: string): BetKeyWarningKind {
  const s = numInput.trim();
  if (s.includes('-') && s !== '--' && !s.endsWith('-')) return 'bulk_range';
  if (mode === '3digit') return 'bulk_3digit';
  if (mode === 'run') return 'bulk_run';
  return 'bulk_2digit';
}

function formatNumberPreview(numbers: string[], max = 5): string {
  const head = numbers.slice(0, max).join(', ');
  return numbers.length > max ? `${head}…` : head;
}

/** ตรวจก่อนบันทึก — เลขสั้นเกินไป / ขยายหลายเลข (ราว, ช่วง, เบิ้ล) */
export function analyzeBetKeyWarning(
  numInput: string,
  amtInput: string,
  parseResult: ParseResult,
): BetKeyWarning | null {
  const s = numInput.trim();
  const expanded = expandNumberInput(s);
  if (!expanded) return null;

  const { numbers, mode } = expanded;
  const amtCore = amtInput.trim().replace(/-+$/, '');

  // 4 + 10*10 น่าจะหมายถึง 40 ไม่ใช่วิ่ง 4
  if (/^\d$/.test(s) && !s.includes('*')) {
    const normalized = amtCore.replace(/\*/g, '+');
    const parts = normalized.split('+').map((p) => p.trim()).filter(Boolean);
    const priced = parts.filter((p) => /^\d+$/.test(p) && parseFloat(p) > 0);
    if (priced.length >= 2 && mode === 'run') {
      return {
        kind: 'ambiguous_short_digit',
        message: `⚠ พิมพ์ "${s}" แต่ยอดแบบ 2 ตัว (${priced.join('*')}) — ตั้งใจวิ่ง ${s} หรือต้องการ ${s}0?`,
        blockCommit: true,
      };
    }
  }

  // 2 ตัวแต่พิมพ์แค่หลักแรก เช่น 4 แทน 40 (ยอดเดี่ยว)
  if (/^\d$/.test(s) && mode === 'run' && amtCore && !amtCore.includes('*') && !amtCore.includes('+')) {
    const single = parseFloat(amtCore);
    if (single >= 10 && single % 10 === 0) {
      return {
        kind: 'ambiguous_short_digit',
        message: `⚠ พิมพ์เลขหลักเดียว "${s}" — ตั้งใจ ${s}0 = ${single} หรือวิ่ง ${s}?`,
        blockCommit: false,
      };
    }
  }

  const isBulkPattern =
    numbers.length >= BULK_WARN_COUNT &&
    (s.includes('*') || (s.includes('-') && !s.endsWith('-')) || s === '--');

  if (isBulkPattern) {
    const kind = expansionKind(mode, s);
    const labels: Record<BetKeyWarningKind, string> = {
      ambiguous_short_digit: '',
      bulk_2digit: '2 ตัว',
      bulk_3digit: '3 ตัว',
      bulk_run: 'วิ่ง',
      bulk_range: 'ช่วงเลข',
    };
    return {
      kind,
      message: `⚠ ${labels[kind]} ${numbers.length} เลข (${formatNumberPreview(numbers)}) — ตรวจให้ครบก่อนบันทึก`,
      blockCommit: numbers.length >= BULK_BLOCK_COUNT,
    };
  }

  // กลับ / ขยายจาก parser แล้วได้หลายแถวในครั้งเดียว
  if (parseResult.bets.length >= 12 && (parseResult.isKlap || numbers.length > 1)) {
    return {
      kind: expansionKind(mode, s),
      message: `⚠ บันทึกครั้งเดียว ${parseResult.bets.length} รายการ — ตรวจเลข "${s}" ให้ถูก`,
      blockCommit: false,
    };
  }

  return null;
}

/** ข้อความใต้ช่องเลขขณะพิมพ์ (ไม่บังคับบล็อก) */
export function previewBetKeyWarning(numInput: string, amtInput: string): string | null {
  if (!numInput.trim()) return null;
  const fake: ParseResult = {
    bets: [],
    mode: '2digit',
    expandedNumbers: [],
    isKlap: false,
    amountHint: '',
  };
  const expanded = expandNumberInput(numInput);
  if (expanded) fake.expandedNumbers = expanded.numbers;
  return analyzeBetKeyWarning(numInput, amtInput, fake)?.message ?? null;
}

/** คีย์ blocked จาก limits ที่โหลดไว้ */
export function findBlockedBetsInParsed(
  bets: { number: string; bet_type: string }[],
  blockedKeys: ReadonlySet<string>,
): string[] {
  const nums = new Set<string>();
  for (const b of bets) {
    if (blockedKeys.has(`${b.number}::${b.bet_type}`)) nums.add(b.number);
  }
  return [...nums].sort((a, b) => a.localeCompare(b, 'th'));
}
