# SECURITY CHECKLIST — Cut Huay

สถานะประเมินจากโค้ดปัจจุบัน (Done / Missing / Recommended)

## Done

- [x] Helmet เปิดใช้ทั้งแอป (`backend/src/index.ts`)
- [x] CORS จำกัดผ่าน `CORS_ORIGIN` (`backend/src/index.ts`)
- [x] JWT ตรวจสอบใน middleware (`backend/src/middleware/auth.ts`)
- [x] RBAC แยก role (`admin/operator/viewer`) (`backend/src/models/types.ts`, route-level authorize)
- [x] Input validation ด้วย Zod ใน route สำคัญ (`auth.ts`, `bets.ts`, `rounds.ts`, `cut.ts`)
- [x] PostgreSQL queries เป็น parameterized query (ส่วนใหญ่)
- [x] Global rate limit เปิดใช้งาน (`backend/src/index.ts`)
- [x] ไม่ commit `.env` ใน deploy rsync (`scripts/deploy.sh` exclude)

## Missing (ต้องทำ)

- [x] Login rate limiter เฉพาะ endpoint (`POST /api/auth/login`) เปิดใช้แล้ว
- [x] มี server-side revoke capability แบบ session versioning (`users.token_version`)
- [x] WebSocket auth ย้ายไป `Sec-WebSocket-Protocol` แล้ว (ไม่ใช้ query token)
- [x] Seed ใช้ credential จาก env (`SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_PASSWORD`) หรือ random one-time log — ไม่มีรหัสตายตัวใน source (`backend/src/database/seed.ts`)
- [x] ถอด LINE feature ออก และมี cleanup migration (`migrate12.ts`)
- [x] Docker backend auto-migrate + verify on container start (`docker-entrypoint.sh`)
- [x] CI provisions Postgres + runs migrate/verify before integration tests
- [x] CSRF strategy (double-submit): infra ready — `backend/src/middleware/csrf.ts`, `GET /api/auth/csrf`, `CSRF_ENABLED` + `COOKIE_AUTH_ENABLED` flags (**default off**); FE `NEXT_PUBLIC_CSRF_ENABLED` + `ensureCsrfToken` ใน `api.ts`
- [ ] Bearer + refresh ยังอยู่ใน `localStorage` (H-01) เมื่อ cookie flags ปิด — staging path: `NEXT_PUBLIC_COOKIE_AUTH_ENABLED` + ไม่ persist token ใน localStorage
- [x] Error model standardized code/trace_id (`errorHandler` + legacy mapper)
- [x] Audit บาง mutation สำคัญ: round delete, bulk delete bets, round import (`rounds.ts`, `bets.ts`) — ยังไม่ครบทุก mutation

## Recommended

- [x] เพิ่ม brute-force protection: login limiter (8/15m)
- [ ] เพิ่ม secret scanning ใน CI (gitleaks/trufflehog) — มี regex baseline แล้ว
- [x] ใช้ refresh token + access token lifecycle (ต้อง tune TTL ตาม production data)
- [ ] พิจารณา cookie-based WS auth (`httpOnly + sameSite`) สำหรับ hardening เพิ่มเติม
- [x] เพิ่ม structured logging + request/trace id สำหรับ trace incident
- [ ] เพิ่ม security headers policy ที่ละเอียดขึ้น (CSP ตาม asset ที่ใช้งานจริง)
- [x] เพิ่ม dependency audit gate ใน CI (`npm audit --omit=dev --audit-level=high`) แบบ optional
- [x] เพิ่ม lightweight secret scan ใน CI (regex baseline) แบบ optional

## CI gates policy

- **Required before merge**
  - frontend lint + build
  - backend lint + build + test + integration test
  - Playwright E2E (`e2e_required` job) — 3 tests: `smoke.spec.ts` (admin + viewer) + `bet-summary.spec.ts`
- **Optional (non-blocking)**
  - dependency audit
  - lightweight secret scan

หาก optional fail: ต้อง triage และเปิด task ไม่ควรปิดเงียบ

## Logging redaction policy

- redact fields อัตโนมัติใน logger:
  - `password`, `password_hash`
  - `token`, `access_token`, `refresh_token`
  - `authorization`, `cookie`, `set-cookie`
- หลีกเลี่ยง log payload ที่มี PII โดยตรงใน route handlers
- incident debugging ใช้ `trace_id` เป็นหลัก แทน dump request body

## Quick mitigations (ทำได้ทันที)

1. ~~**เพิ่ม login limiter**~~ — done
2. ~~**ปิด/จำกัด seed ใน production**~~ — production guard in seed.ts
3. ~~**รัน/ยืนยัน migrate ทุก environment**~~ — Docker entrypoint + CI gate (2026-06-17)
4. **หมุน JWT_SECRET production** และตรวจ entropy (0.5 วัน, Ops)
5. **เพิ่ม runbook incident security** — login bounce ใน RUNBOOK §4E; full audit ใน `AUDIT_FULL_REPORT.md`

## Threat model (token leak — short)

- Access token leak:
  - ผลกระทบ: ใช้งานได้จนหมดอายุ
  - บรรเทา: อายุสั้น + revoke ผ่าน `logout-all` (bump token_version)
- Refresh token leak:
  - ผลกระทบ: สร้าง access token ใหม่ได้จนกว่าจะ revoke/หมดอายุ
  - บรรเทา: refresh TTL จำกัด + revoke capability + audit `token_refreshed`
- Device compromise:
  - ผลกระทบ: token ทั้งคู่เสี่ยง
  - บรรเทา: ผู้ใช้สั่ง `logout-all` เพื่อ invalidate ทุก token generation เดิม

## Cookie migration checklist (infra R6–7 + playbook R8)

**สถานะโค้ด:** dual mode + CSRF infra + FE staging path พร้อม — flags **default off**; production cutover ยัง ops-gated (ดู `RUNBOOK.md` §9, `scripts/production-cookie.env.example`, `deploy/nginx/cuthuay.conf.example`)

### Architecture (target)
- Access token transport: `httpOnly` cookie (short TTL)
- Refresh token transport: `httpOnly` cookie (longer TTL, rotation)
- CSRF protection: double-submit token
  - server ออก `csrf_token` (readable cookie หรือ endpoint)
  - client ส่ง `X-CSRF-Token` ใน mutation requests
  - server validate cookie-token pair

### Trade-offs
- Pros:
  - ลด token theft จาก JS runtime
  - align กับ browser security model ดีขึ้น
- Cons:
  - ต้องพึ่ง reverse proxy/TLS/cookie domain setup มากขึ้น
  - ต้อง implement CSRF layer และ test matrix เพิ่ม

### Rollout phases (security view)
1. Phase 0 (current): bearer + refresh in localStorage
2. Phase 1: dual mode (cookie + bearer) + telemetry
3. Phase 2: CSRF required for mutation routes
4. Phase 3: disable bearer-from-localStorage by default
5. Phase 4: cleanup legacy paths

### Go/No-Go criteria
- Go:
  - reverse proxy + TLS terminate (`deploy/nginx/cuthuay.conf.example`)
  - `COOKIE_SECURE=true` เมื่อ HTTPS; `COOKIE_SECURE=false` เฉพาะ HTTP LAN pilot ชั่วคราว
  - `CORS_ORIGIN` ตรง browser origin
  - CSRF tests ผ่านทุก mutation route สำคัญ (`npm run test:integration:csrf`)
  - error/trace logs ไม่มี token leak
- No-Go:
  - พบ cookie mis-scope/domain mismatch
  - CSRF false-positive สูงจนกระทบธุรกิจ
  - session drop rate สูงผิดปกติหลังเปิด dual mode

## PDPA / data retention (internal LAN — needs business sign-off)

**Template + automation skeleton (R8):** live purge ยังปิด default — ใช้ dry-run จน sign-off

| Data class | Location | Proposed retention | Automation (R8) | Action owner |
|------------|----------|-------------------|-----------------|--------------|
| Customer PII | `customers` table | Active accounts + N months after last bet | **None** — manual policy only | Ops + finance |
| Audit logs | `audit_log` | 90 days default (`AUDIT_LOG_RETENTION_DAYS`) | `backend/src/scripts/purgeRetention.ts` + `npm run purge:retention` — `PDPA_PURGE_ENABLED=false`, `PDPA_PURGE_DRY_RUN=true` default | Ops |
| DB backups | `BACKUP_DIR` / off-host | 7 days default (`RETENTION_DAYS`) | `scripts/backup-db.sh` | Ops |
| Browser notes | `localStorage` `/notebook` | User-controlled | N/A (client-side) | N/A |

- **Customer PII:** names, phone numbers in `customers` — retain only as long as operational need; define purge policy with finance/legal.
- **Audit logs:** dry-run รายงานจำนวนแถวที่จะลบ; live DELETE ต้อง `PDPA_PURGE_ENABLED=true` + `PDPA_PURGE_DRY_RUN=false` + sign-off — ดู `RUNBOOK.md` §11.
- **Backups:** encrypted at rest on backup host; access limited to ops; test restore quarterly (see `RUNBOOK.md` §10).
- **Notebook notes:** browser `localStorage` only — not server PDPA scope; users informed on `/notebook` page.

## Need confirmation

- ใช้งานผ่าน reverse proxy ใดใน production (Nginx/Traefik/Cloud LB) เพื่อกำหนด secure cookie / header policy
- มี WAF / firewall rules หน้า API หรือไม่
- มีข้อกำกับ compliance เฉพาะ (PDPA/log retention) หรือไม่
