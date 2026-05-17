/** UTF-8 BOM — Excel เปิดไฟล์ CSV อ่านภาษาไทยได้ถูกต้อง */
export const CSV_UTF8_BOM = '\uFEFF';

/** RFC 4180 — ครอบด้วย " เมื่อมี comma, quote, ขึ้นบรรทัดใหม่ */
export function escapeCsvField(value: string | number): string {
  const s = String(value);
  if (!/[",\r\n]/.test(s)) return s;
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * บังคับให้ Excel เก็บเป็นข้อความ (กัน 50**100 → สัญกรณ์ยกกำลัง → 1.00E+102)
 * ใส่ tab นำหน้าภายในช่องที่ quote แล้ว
 */
export function excelSafeTextField(value: string): string {
  const s = String(value);
  if (!s) return escapeCsvField(s);
  const needsTab =
    /[*^=]/.test(s) ||
    /^\d+\*\*/.test(s) ||
    /^\*+\d/.test(s);
  const body = needsTab ? `\t${s}` : s;
  return escapeCsvField(body);
}

/** บรรทัดโพยแบบเดียวกับ export แยกแผ่น: 754=100*100 */
export function formatBetCsvLine(number: string, payload: string): string {
  const safePayload =
    /[*^=]/.test(payload) || /^\*+\d/.test(payload) ? `\t${payload}` : payload;
  const safeNum =
    /^\d+$/.test(number) && number.length > 1 && number.startsWith('0')
      ? `\t${number}`
      : number;
  return `${safeNum}=${safePayload}`;
}

export function downloadTextFile(
  content: string,
  filename: string,
  mime = 'text/csv;charset=utf-8;',
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
