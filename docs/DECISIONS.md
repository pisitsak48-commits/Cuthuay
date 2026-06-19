# DECISIONS (ADR-lite) — Cut Huay

## ADR-001 — Monorepo split frontend/backend
- **Decision:** แยก `frontend/` (Next.js) และ `backend/` (Express TS) ชัดเจน
- **Context:** ทีมต้อง deploy แยก lifecycle และมี boundary ชัด
- **Consequence:** ~~ยังไม่มี shared package types~~ → มี `packages/bet-parser` แล้ว (shared parser + contract tests); types อื่นยังต้อง sync เอง

## ADR-002 — JWT stateless auth + role-based authorize
- **Decision:** ใช้ Bearer JWT + middleware `authenticate/authorize`
- **Context:** ต้องรองรับ role admin/operator/viewer ง่ายและเร็ว
- **Consequence:** ปัจจุบันขยายเป็น access+refresh + session versioning เพื่อ revoke server-side ได้

## ADR-008 — Refresh token + session versioning revoke
- **Decision:** เลือก **Session Versioning (users.token_version)** แทน revoke-list
- **Context:** ต้องการ revoke ที่ใช้งานจริงขั้นต่ำและ migration ง่าย (ไม่เพิ่มตาราง token state จำนวนมาก)
- **Consequence:** `logout`/`logout-all` ทำให้ token generation เก่าถูก invalidate ทั้งหมดของผู้ใช้นั้น

## ADR-003 — Idempotent migration script เดียว (`migrate.ts`)
- **Decision:** รวม SQL หลาย migration เดิมไว้ในไฟล์เดียว โดยใช้ `IF NOT EXISTS`
- **Context:** ลดความซับซ้อนตอน deploy
- **Consequence:** กำหนดให้ `npm run migrate` เป็น canonical path และบังคับ `npm run migrate:verify` หลังรันทุกครั้ง

## ADR-009 — Deterministic migration policy
- **Decision:** ใช้ single-entry migration (`migrate.ts`) + metadata (`schema_migration_meta`) + verify script
- **Context:** ลด drift ระหว่าง fresh setup กับ existing upgrade
- **Consequence:** wrapper migrations (`migrate11/12/13`) ถูกลดบทบาทเป็น compatibility only; ทีมต้องทำตาม checklist rollout เดียว

## ADR-010 — Auth transport migration: Bearer(localStorage) -> httpOnly cookie (design-first)
- **Decision:** ออกแบบ migration แบบ phased จาก bearer token ใน `localStorage` ไปเป็น `httpOnly` cookie โดยคง backward compatibility ชั่วคราว
- **Context:** ลดความเสี่ยง token exfiltration ฝั่ง browser (XSS, extension, shared terminal) และทำให้ logout/revoke policy enforce ได้สม่ำเสมอขึ้น
- **Consequence:**
  - ระยะสั้น: รองรับ dual mode (Authorization header + cookie) เพื่อไม่ force logout ผู้ใช้เดิม
  - ระยะกลาง: mutation routes บังคับ CSRF token
  - ระยะปลาย: ปิด bearer-from-localStorage เป็น default

### Reverse proxy requirements (mandatory before phase cutover)
- ต้อง terminate TLS เสมอ (HTTPS only)
- ต้อง forward `X-Forwarded-Proto`, `X-Forwarded-For`, `X-Request-Id`
- cookie flags:
  - `Secure=true` (production) — override ด้วย env `COOKIE_SECURE` (default `NODE_ENV === 'production'`); ตั้ง `COOKIE_SECURE=false` เฉพาะ HTTP LAN pilot ชั่วคราว
  - `HttpOnly=true`
  - `SameSite=Lax` (หรือ `None` + Secure เมื่อ cross-site จริง)
  - `Domain` ต้องตรง deployment topology (Need confirmation)
- WebSocket:
  - รองรับ `wss://`
  - preserve `Sec-WebSocket-Protocol`
  - ไม่ log token/raw auth data

## ADR-011 — Viewer role: read-only bets UI

- **Decision:** `viewer` เข้า `/bets` ได้เพื่อดูโพย แต่ UI ซ่อน/disable ทุก mutation (คีย์เลข, ลบ, ย้ายแผ่น, import)
- **Context:** ต้องการให้ผู้ดูข้อมูลตรวจโพยได้โดยไม่แก้ข้อมูล; backend RBAC ยังเป็นชั้นสุดท้าย
- **Consequence:**
  - `/cut`, `/limits`, `/rounds` ยังไม่เปิดให้ viewer (AppShell redirect)
  - `/bets/import` ถูกบล็อกแม้ path ขึ้นต้นด้วย `/bets`
  - ใช้ `canMutate = role !== 'viewer'` ใน `bets/page` และส่งต่อ panels

## ADR-004 — Next rewrite `/api/*` ไป backend
- **Decision:** browser เรียก `/api` ผ่าน frontend origin แล้ว rewrite ไป backend
- **Context:** ลดปัญหา API URL hardcode/local IP และลด CORS friction
- **Consequence:** ต้องกำหนด `BACKEND_INTERNAL_URL` ให้ถูกในทุก environment

## ADR-005 — Role gating ฝั่ง UI สำหรับ operator
- **Decision:** `operator` เข้าได้เฉพาะ `/bets*` (ยกเว้น import) และ `/rounds`
- **Context:** ลดความเสี่ยงใช้งานส่วนตั้งค่าผิดบทบาท
- **Consequence:** Security จริงยังต้องพึ่ง backend authorize เสมอ

## ADR-006 — OCR fallback Paddle → Google Vision
- **Decision:** รองรับหลาย engine และ auto fallback
- **Context:** คุมต้นทุน Vision และความเสถียร OCR
- **Consequence:** image pipeline ซับซ้อนขึ้น, ต้องดูแล python runtime ใน backend image

## ADR-007 — Remove LINE integration
- **Decision:** ถอด LINE webhook และ line-integration API ออกจากระบบทั้งหมด
- **Context:** ทีมยืนยันไม่ใช้ฟีเจอร์ LINE แล้ว และต้องลด attack surface / maintenance cost
- **Consequence:** endpoint `/api/line/webhook` และ `/api/line-integration/*` ถูกยกเลิก, ตาราง legacy ถูกลบด้วย cleanup migration
