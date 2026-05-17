import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { z } from 'zod';

/** โฟลเดอร์ backend เสมอ — ใช้โหลด .env และ resolve path สัมพันธ์ (ไม่พึ่ง process.cwd ที่เปลี่ยนตามที่รัน npm) */
export const backendRoot = path.resolve(__dirname, '../..');

dotenv.config({ path: path.join(backendRoot, '.env') });
dotenv.config({ path: path.join(backendRoot, '.env.local') });

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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(4000),
  DATABASE_URL: z.string().min(1),
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRES_IN: z.string().default('8h'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  REPORTS_DIR: z.string().default('./reports'),
  /** Messaging API — ตั้งค่าเมื่อใช้ webhook รับข้อความจากบอทในกลุ่มไลน์ */
  LINE_CHANNEL_SECRET: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('❌ Invalid environment variables:\n', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

/** log ช่วยดีบัก Vision — ไม่พิมพ์เนื้อหา secret */
if (parsed.data.NODE_ENV !== 'production') {
  const raw = stripEnvQuotes(
    process.env.GOOGLE_VISION_KEY_FILE?.trim() ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS?.trim() ||
      '',
  );
  const abs = raw
    ? path.isAbsolute(raw)
      ? raw
      : path.resolve(backendRoot, raw)
    : '';
  const exists = abs ? fs.existsSync(abs) : false;
  console.info(
    `[env] backendRoot=${backendRoot} process.cwd=${process.cwd()} GOOGLE_JSON=${
      abs ? (exists ? abs : `${abs} (ไม่มีไฟล์)`) : '(ไม่ได้ตั้งในโปรเซส — ตรวจ backend/.env)'
    }`,
  );
}

export const env = parsed.data;
