import fs from 'fs';
import path from 'path';
import type { PaddleOcrResult } from './paddleOcr';
import { backendRoot } from '../config/env';
import { ImageAnnotatorClient } from '@google-cloud/vision';

function stripEnvQuotes(s: string): string {
  const t = s.trim();
  if (
    t.length >= 2 &&
    ((t[0] === '"' && t[t.length - 1] === '"') || (t[0] === "'" && t[t.length - 1] === "'"))
  ) {
    return t.slice(1, -1).trim();
  }
  return t;
}

function resolveCredentialsPath(): string | undefined {
  const raw = stripEnvQuotes(
    process.env.GOOGLE_VISION_KEY_FILE?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      '',
  );
  if (!raw) return undefined;
  /** path สัมพันธ์ใน .env = สัมพันธ์กับโฟลเดอร์ backend */
  return path.isAbsolute(raw) ? raw : path.resolve(backendRoot, raw);
}

function visionUseApplicationDefaultCredentials(): boolean {
  const v = process.env.GOOGLE_VISION_USE_ADC?.trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes';
}

function runningInDocker(): boolean {
  try {
    return fs.existsSync('/.dockerenv');
  } catch {
    return false;
  }
}

function missingCredentialsHint(): string {
  const docker = runningInDocker() || backendRoot === '/app';
  if (!docker) return '';
  return (
    ' · Docker: ใส่ GOOGLE_APPLICATION_CREDENTIALS ใน environment ของ service backend (เช่น /app/secrets/vision-key.json) ' +
    'และ mount ./backend/secrets → /app/secrets แล้ว restart — มีตัวอย่างใน docker-compose.yml'
  );
}

/**
 * OCR รูปโพยผ่าน Google Cloud Vision (Document Text Detection)
 * - เครื่อง dev: ตั้ง GOOGLE_APPLICATION_CREDENTIALS หรือ GOOGLE_VISION_KEY_FILE ใน backend/.env
 * - Cloud Run / GCE (workload identity): GOOGLE_VISION_USE_ADC=1
 */
export async function runGoogleVisionOcrOnImage(buffer: Buffer): Promise<PaddleOcrResult> {
  const credPath = resolveCredentialsPath();
  const useAdc = visionUseApplicationDefaultCredentials();

  if (!credPath && !useAdc) {
    return {
      ok: false,
      reason: `Google Vision: ไม่พบ GOOGLE_APPLICATION_CREDENTIALS / GOOGLE_VISION_KEY_FILE ในโปรเซส API — dev: ใส่ใน backend/.env (โฟลเดอร์ ${backendRoot}) แล้ว restart${missingCredentialsHint()} · โปรดอ่าน docker-compose.yml (service backend) หากรันใน container`,
    };
  }

  if (credPath && !fs.existsSync(credPath)) {
    return {
      ok: false,
      reason: `Google Vision: ไม่พบไฟล์ credentials ที่ ${credPath} — แก้ path หรือวาง JSON ให้ตรง (ใน Docker ให้ mount ./backend/secrets:/app/secrets และใช้ path ภายใน container เช่น /app/secrets/vision-key.json)`,
    };
  }

  const client =
    credPath && fs.existsSync(credPath)
      ? new ImageAnnotatorClient({ keyFilename: credPath })
      : new ImageAnnotatorClient();

  try {
    const [result] = await client.documentTextDetection({
      image: { content: buffer },
      imageContext: { languageHints: ['en', 'th'] },
    });

    const full = result.fullTextAnnotation?.text?.trim();
    if (full) {
      const lines = full.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return { ok: true, text: full, lines, engine: 'google-vision' };
    }

    const fallback = result.textAnnotations?.[0]?.description?.trim();
    if (fallback) {
      const lines = fallback.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return { ok: true, text: fallback, lines, engine: 'google-vision' };
    }

    const [sparse] = await client.textDetection({
      image: { content: buffer },
      imageContext: { languageHints: ['en', 'th'] },
    });
    const sparseText = sparse.textAnnotations?.[0]?.description?.trim();
    if (sparseText) {
      const lines = sparseText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      return { ok: true, text: sparseText, lines, engine: 'google-vision' };
    }

    return { ok: false, reason: 'Google Vision: ไม่พบข้อความในภาพ' };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/could not load the default credentials/i.test(msg)) {
      return {
        ok: false,
        reason:
          'Google Vision: ไลบรารียังโหลด credentials ไม่ได้ — ตรวจไฟล์ JSON service account ว่าโหลดได้ (path ใน [env] ตอน start) · บน Cloud Run ลองตั้ง GOOGLE_VISION_USE_ADC=1',
      };
    }
    if (/billing/i.test(msg) && /enable/i.test(msg)) {
      return {
        ok: false,
        reason:
          'Google Vision: โปรเจกต์ Google Cloud ยังไม่ได้ผูก Billing — Vision API ต้องเปิดบิลลิงถึงจะเรียกได้ (มีเครดิต/ฟรีทดลองตามโปรโมชัน GCP) · ไปที่ Google Cloud Console → Billing → ผูกบัญชีเรียกเก็บเงินกับโปรเจกต์นี้ แล้วรอสักครู่ค่อยลองใหม่ · หรือเลือกโหมด OCR “อัตโนมัติ”/“ในเบราว์เซอร์” ชั่วคราว',
      };
    }
    return { ok: false, reason: `Google Vision: ${msg}` };
  }
}
