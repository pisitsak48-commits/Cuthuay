import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';

export type PaddleOcrResult =
  | { ok: true; text: string; lines: string[]; engine: string }
  | { ok: false; reason: string };

/** หาไฟล์สคริปต์จากทั้งโหมด dev (src) และ production (dist) */
function resolveScriptPath(): string | null {
  const candidates = [
    path.join(process.cwd(), 'scripts', 'paddle_ocr_image.py'),
    path.resolve(__dirname, '..', '..', 'scripts', 'paddle_ocr_image.py'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * รัน PaddleOCR ผ่าน Python (ถ้ามี) — คืน text เรียงแถวจากภาพ
 */
export function runPaddleOcrOnImage(buffer: Buffer, mimetype: string): PaddleOcrResult {
  const script = resolveScriptPath();
  if (!script) {
    return { ok: false, reason: 'paddle_ocr_image.py not found' };
  }

  const ext =
    mimetype.includes('jpeg') || mimetype.includes('jpg')
      ? '.jpg'
      : mimetype.includes('webp')
        ? '.webp'
        : '.png';

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cuthuay-paddle-'));
  const tmpFile = path.join(dir, `ocr${ext}`);
  try {
    fs.writeFileSync(tmpFile, buffer);
    const pythonBin = process.env.PADDLE_OCR_PYTHON?.trim() || 'python3';
    const r = spawnSync(pythonBin, [script, tmpFile], {
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
      timeout: Number(process.env.PADDLE_OCR_TIMEOUT_MS) || 120_000,
      env: { ...process.env, PYTHONUNBUFFERED: '1' },
    });

    if (r.error) {
      return { ok: false, reason: r.error.message };
    }
    if (r.status !== 0) {
      const errMsg = (() => {
        try {
          const j = JSON.parse(r.stdout || '{}') as { error?: string };
          return j.error || r.stderr?.slice(0, 300) || `exit ${r.status}`;
        } catch {
          return r.stderr?.slice(0, 300) || r.stdout?.slice(0, 300) || `exit ${r.status}`;
        }
      })();
      return { ok: false, reason: errMsg };
    }

    const parsed = JSON.parse(r.stdout || '{}') as {
      text?: string;
      lines?: string[];
      engine?: string;
      error?: string;
    };
    if (parsed.error) {
      return { ok: false, reason: parsed.error };
    }
    const text = String(parsed.text ?? '').trim();
    const lines = Array.isArray(parsed.lines) ? parsed.lines.map((l) => String(l)) : [];
    return {
      ok: true,
      text,
      lines,
      engine: parsed.engine ?? 'paddleocr',
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: msg };
  } finally {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}
