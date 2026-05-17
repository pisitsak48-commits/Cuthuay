import { runPaddleOcrOnImage } from './paddleOcr';
import { runGoogleVisionOcrOnImage } from './googleVisionOcr';

/** ลำดับเครื่องยนต์เมื่อ ocrEngine=auto — ค่าเริ่ม Paddle ก่อน Google (ประหยัดโควตา/ค่า Vision หลังฟรี) — ปรับด้วย OCR_IMAGE_AUTO_ORDER */
function autoOrder(): string[] {
  const raw = (process.env.OCR_IMAGE_AUTO_ORDER ?? 'paddle,google-vision').toLowerCase();
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s === 'google' ? 'google-vision' : s));
}

function normalizePreference(raw: unknown): 'auto' | 'paddle' | 'google-vision' {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (s === 'paddle' || s === 'google-vision' || s === 'google' || s === 'vision') {
    return s === 'paddle' ? 'paddle' : 'google-vision';
  }
  return 'auto';
}

export type ServerOcrJsonResponse = {
  text: string;
  lines: string[];
  engine: string;
  message?: string;
};

/**
 * รวม Paddle + Google Vision ตามที่เลือก (ฟิลด์ฟอร์ม ocrEngine)
 */
export async function runServerImageOcr(
  buffer: Buffer,
  mimetype: string,
  ocrEngineRaw: unknown,
): Promise<ServerOcrJsonResponse> {
  const pref = normalizePreference(ocrEngineRaw);

  if (pref === 'paddle') {
    const r = runPaddleOcrOnImage(buffer, mimetype);
    if (r.ok && r.text.length > 0) {
      return { text: r.text, lines: r.lines, engine: r.engine };
    }
    return {
      text: '',
      lines: [],
      engine: 'none',
      message: r.ok ? 'PaddleOCR: ไม่พบข้อความ' : r.reason,
    };
  }

  if (pref === 'google-vision') {
    const r = await runGoogleVisionOcrOnImage(buffer);
    if (r.ok && r.text.length > 0) {
      return { text: r.text, lines: r.lines, engine: r.engine };
    }
    return {
      text: '',
      lines: [],
      engine: 'none',
      message: r.ok ? 'Google Vision: ไม่พบข้อความ' : r.reason,
    };
  }

  const messages: string[] = [];
  for (const step of autoOrder()) {
    if (step === 'google-vision') {
      const r = await runGoogleVisionOcrOnImage(buffer);
      if (r.ok && r.text.length > 0) {
        return { text: r.text, lines: r.lines, engine: r.engine };
      }
      if (!r.ok) messages.push(r.reason);
    } else if (step === 'paddle') {
      const r = runPaddleOcrOnImage(buffer, mimetype);
      if (r.ok && r.text.length > 0) {
        return { text: r.text, lines: r.lines, engine: r.engine };
      }
      if (!r.ok) messages.push(r.reason);
    }
  }

  return {
    text: '',
    lines: [],
    engine: 'none',
    message: messages.filter(Boolean).join(' · ') || 'ไม่มี OCR บนเซิร์ฟเวอร์พร้อมใช้งาน',
  };
}
