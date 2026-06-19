# CHANGELOG_AI

บันทึกนี้เน้น “การเปลี่ยนแปลงเชิงระบบ” เพื่อให้ AI/ทีมต่อยอดงานได้เร็ว

## 2026-06-19 (Docs sync — gap audit)

### What changed
- **Docs vs code audit:** ตรวจ docs ทั้งชุดเทียบกับโค้ดจริง พบ 4 จุดที่ไม่ตรง
- **Frontend routes:** เพิ่ม `/dealers` (redirect → `/customers?tab=dealer`), `/reports` (report viewer), `/results` (redirect → `/summary`) ใน `SYSTEM_DOCUMENTATION.md` + `README_SYSTEM.md`
- **Backend modules:** เพิ่ม `money.ts`, `profitSummaryService.ts`, `dashboardProfits.ts`, `reportService.ts` ใน module map ของ `SYSTEM_DOCUMENTATION.md` + `README_SYSTEM.md`
- **DB_SCHEMA:** อัพเดท migration wrapper table เพิ่ม `migrate10.ts`; แก้ "Need confirmation" float parsing → ระบุว่าแก้แล้ว (R8) ด้วย `money.ts`
- **DECISIONS ADR-001:** แก้ "ยังไม่มี shared package types" → ระบุว่า `packages/bet-parser` มีอยู่แล้ว

### Impact
- docs สะท้อนโค้ดจริงครบถ้วนสำหรับ frontend routes, backend modules, และ migration list
- ลบ "Need confirmation" ล้าสมัยออกจาก DB_SCHEMA เพื่อไม่ให้ทีมใหม่เข้าใจผิด

## 2026-06-17 (Maintainability Round 8)

### What changed
- **E2E bet→summary:** `bet-summary.spec.ts` + shared `e2e/helpers.ts` (3 tests รวม smoke)
- **NUMERIC (L-01):** OID 1700 คืน string; `lib/money.ts`; `profitSummaryService`, `reports`, `bets` ใช้ `moneyToNumber`; contract + summary integration tests
- **PDPA purge skeleton:** `purgeRetention.ts` + env flags (default off/dry-run); `RUNBOOK` §11; integration dry-run test
- **Cookie prod playbook:** `COOKIE_SECURE` env; `deploy/nginx/cuthuay.conf.example`; `scripts/production-cookie.env.example`; RUNBOOK production cutover checklist

### Metrics
- E2E: 3 tests (2 smoke + bet-summary)
- Integration: **28** default (+ money contract, purge dry-run, numeric summary) + cookie/csrf scripts แยก

### Impact
- ลดความเสี่ยง float บนเงิน; PDPA purge พร้อม dry-run โดยไม่ลบข้อมูล default; production cookie unblock ด้วย `COOKIE_SECURE` + proxy playbook

## 2026-06-17 (Maintainability Round 7)

### What changed
- **E2E required:** CI `e2e_required` (ลบ `continue-on-error`); smoke + viewer read-only test; seed `viewer` user
- **Redis hygiene:** documented optional/unused ใน RUNBOOK, compose comment
- **Cookie staging FE:** `persistAuthTokens`, `restoreSessionFromCookies`, refresh จาก httpOnly cookie; logout clears cookies
- **Cookie test:** `cookie.integration.test.ts` + `test:integration:cookie`
- **Docs:** SECURITY_CHECKLIST CI gates, PDPA template table, AI_HANDOVER/AUDIT sync

### Metrics
- E2E: 2 smoke tests (admin + viewer)
- Integration: 22 default + 1 cookie (flags on) + 2 CSRF (flags on)

### Impact
- CI บล็อก merge ถ้า Playwright พัง; staging cookie path พร้อมทดสอบโดยไม่เปิด production default

## 2026-06-17 (Maintainability Round 6)

### What changed
- **Docs sync:** `SECURITY_CHECKLIST`, `AUDIT` §5–7, `AI_HANDOVER` — CSRF infra ready; integration coverage จริง
- **Staging pilot:** `.env.example` + `RUNBOOK` §9 staging block; FE `NEXT_PUBLIC_COOKIE_AUTH_ENABLED` + `withCredentials`
- **CSRF tests:** `csrf.integration.test.ts` (skip unless flags on); `test:integration:csrf` script; +2 auth unauthenticated tests → **22** default
- **Cut:** `CutRangeTableModal` — แยก range table overlay จาก `cut/page.tsx`
- **Viewer UX:** read-only `/bets` (ADR-011); `canMutate` ใน panels; sidebar + `rbac.ts` เปิด path

### Metrics
- `cut/page.tsx`: ~1,262 → **~1,123 LOC** (เป้า &lt;1,100 — ใกล้เป้า)
- Integration tests: 20 → **22** (CSRF +2 เมื่อรัน `test:integration:csrf`)

### Impact
- audit docs ตรงโค้ด; พร้อม staging cookie+CSRF pilot; viewer ดูโพยได้โดยไม่ mutate ผ่าน UI

## 2026-06-17 (Maintainability Round 5)

### What changed
- **Bets SSoT step 2:** ลบ `savedBets` state — อ่านจาก `useBetsQuery` โดยตรง; `useBetFetcher` ไม่ใช้ `setBets` callback
- **Bets panels:** `BetKeyInputPanel`, `BetSummaryPanel` — แยกช่องคีย์ + แผงสรุปขวา
- **Integration tests:** `bets.bulk`, `rounds.result`, `GET /auth/csrf` (+1 auth test)
- **CSRF phase 2 infra:** `GET /api/auth/csrf`, `csrfProtection` middleware, `CSRF_ENABLED` flag (default off); FE `NEXT_PUBLIC_CSRF_ENABLED` + `ensureCsrfToken` หลัง login
- **Polish:** `cut` `handleDeleteBatch`, `limits` dealer limits load → `showApiError`

### Metrics
- `bets/page.tsx`: ~1,907 → **~1,702 LOC**
- Integration tests: 17 → **20**
- `savedBets` duplicate state: **removed**

### Impact
- bets maintainability ดีขึ้น; RQ เป็นแหล่งข้อมูลหลัก; CSRF พร้อมเปิดด้วย env flag

## 2026-06-17 (Maintainability Round 4)

### What changed
- **Docs sync Round 3:** LOC + M-01 ใน `AUDIT_FULL_REPORT`, `AI_HANDOVER`; CHANGELOG Round 3
- **Cut:** `CutSendBatchesPanel`; `lib/cut/cutBatchPrint.ts` (`buildBatchPrintHtml`); `showApiError` ใน `handleDealerChange`
- **Bets SSoT step 1:** `useBetsQuery(selectedRoundId)` + cache → `savedBets` sync; `invalidateBets` + `refreshBetsAfterMutation` ครบทุก mutation path + WS reload
- **Polish:** ลบ `setMsg('เกิดข้อผิดพลาด')` ซ้ำใน `limits/page`; `settings/users` toggle active → `showApiError`

### Metrics
- `cut/page.tsx`: ~1,574 → **~1,260 LOC** (เป้า &lt;1,400)
- `bets/page.tsx`: ~1,879 → **~1,907 LOC** (+RQ wiring; ยัง &lt;2,200)
- Build + `test:integration` **17/17** ผ่าน

### Impact
- cut god-page ลดลงมาก; bets พร้อม migrate SSoT step 2 ในรอบถัดไป

## 2026-06-17 (Maintainability Round 3)

### What changed
- **Docs sync Round 2:** LOC + M-01 ใน `AUDIT_FULL_REPORT`, `AI_HANDOVER`; CHANGELOG Round 2
- **Bets:** `BetMoveSheetModal`; แทน `alert` ลบแผ่นด้วย `setParseError`
- **Cut:** `CutToolbar`, `CutRiskPanel`, `cutTypes.ts`; `showApiError` ใน dealer/risk/sendBatches load
- **Toast rollout:** `showToastMessage` (success); customers import/export + settings/users delete

### Metrics
- `bets/page.tsx`: ~1,912 → **~1,879 LOC**
- `cut/page.tsx`: ~1,943 → **~1,574 LOC**
- `alert()` ใน `app/`: **0**

### Impact
- cut maintainability ดีขึ้น; docs ต้อง sync ต่อทุกรอบ extraction

## 2026-06-17 (Maintainability Round 2)

### What changed
- **React Query:** `useRoundsQuery` ใน `bets/search`, `bets/all`, `summary/compare` — ไม่มี `roundsApi.list()` นอก hook
- **Error rollout:** `limits/page` save/create handlers ใช้ `showApiError`
- **Bets libs:** `betRates.ts`, `betBulkResponse.ts`, `betPrintSlip.ts`
- **Bets components:** `BetSheetEditableGrid`, `BetVoiceAuditBar`, `BetLineImportModal` — presentation แยกจาก orchestration
- Global error toast + RQ hooks foundation จาก Round 1 คงเดิม

### Metrics
- `bets/page.tsx`: ~2,917 → **~1,912 LOC** (เป้า &lt;2,200)
- `summary/page.tsx`: **~433 LOC**
- `cut/page.tsx`: **~1,943 LOC** (ยังไม่แตะในรอบนี้)

### Impact
- รับแทงหลัก maintainable ขึ้นมาก; cut ยังเป็น god-page หลักที่เหลือ
- Build + `test:integration` 17/17 ผ่าน

## 2026-06-17 (Docs vs code gap — sync + partial impl)

### What changed
- Synced `AUDIT_FULL_REPORT.md` findings (H-02, M-02–05, L-02/L-03), grades, verification curl
- Synced `SYSTEM_DOCUMENTATION.md` §6 viewer RBAC, `API_REFERENCE.md` (`profit_by_round`, bets pagination), `SECURITY_CHECKLIST.md` seed
- Wired `useSummaryData` + `useSummaryRounds` in summary page; `BetSheetTable` in bets import preview
- Extracted `lib/betSheetSort.ts`, `components/cut/cutChartParts.tsx`, lazy `CutStackedBarChart` on cut page
- `scripts/e2e-smoke.sh`; CI `e2e_optional` runs real Playwright against migrated+seeded stack
- `RUNBOOK.md` — `SEED_*` flow, E2E instructions; removed `admin1234` from curl examples

### Impact
- Audit/docs reflect remediation status (~76–78 code score vs stale ~68 doc score)
- God pages reduced incrementally; E2E runnable locally and in optional CI

## 2026-06-17 (Phased remediation — Phases 1–6)

### What changed
- **Phase 1:** `packages/bet-parser` shared package + contract tests; RBAC on reports + AppShell viewer gating; WebSocket `token_version` revoke
- **Phase 2:** Production JWT fail-fast; seed passwords from env; refresh rate limit + audit; `scripts/backup-db.sh`; `handleApiError` on dashboard/import/customers
- **Phase 3:** Integration tests (reports summary, rounds import, RBAC); CI fails if DB missing; Playwright smoke baseline
- **Phase 4:** Dashboard `profit_by_round` batch API; bets cursor pagination; DB indexes; lazy chart bundles on dashboard
- **Phase 5:** `useBetFetcher`, `BetSheetTable`; React Query on rounds; Redis moved to compose profile `redis`
- **Phase 6:** `COOKIE_AUTH_ENABLED` dual bearer+cookie (phase 1); notebook local-only notice; RUNBOOK backup §10

### Restore drill
- Documented in `docs/RUNBOOK.md` §10 — run `pg_restore` smoke on staging copy before production reliance on backups.

## 2026-06-17 (Full audit + quick wins)

### What changed
- สร้าง `docs/AUDIT_FULL_REPORT.md` — 12-dimension audit, findings, UX matrix, roadmap
- เพิ่ม `backend/scripts/docker-entrypoint.sh` — auto `migrate` + `verifyMigrate` ก่อน start API
- อัปเดต `backend/Dockerfile` ใช้ entrypoint แทน `CMD node dist/index.js`
- แก้ `POST /api/auth/refresh` — invalid/expired JWT ตอบ 401 `INVALID_REFRESH_TOKEN` (ไม่ใช่ 500)
- เพิ่ม defensive log `auth_schema_drift` ใน `authenticate` เมื่อ PG 42703 (missing column)
- อัปเดต `docs/RUNBOOK.md` — section E: login bounce troubleshooting + verify commands
- อัปเดต CI `backend_required` — Postgres service + migrate + verify ก่อน integration tests
- เพิ่ม integration test: invalid refresh token → 401
- sync `AI_HANDOVER.md`, `SECURITY_CHECKLIST.md`

### Why
- ป้องกัน incident ซ้ำ: `docker compose up` ไม่ migrate → `token_version` missing → login bounce
- แยก client error (bad JWT) จาก server error (500) ใน refresh path
- CI ต้องมี DB จริงเพื่อ integration tests ไม่ skip เงียบๆ

### Impact
- Local Docker path สอดคล้องกับ `scripts/deploy.sh` (migrate enforced)
- Ops มี runbook + audit report เป็น single source of truth
- PR ที่ทำลาย schema migration จะ fail ใน CI

## 2026-06-02

### What changed
- เพิ่มเอกสารระบบครบชุดใน `docs/`:
  - `README_SYSTEM.md`
  - `API_REFERENCE.md`
  - `DB_SCHEMA.md`
  - `RUNBOOK.md`
  - `SECURITY_CHECKLIST.md`
  - `DECISIONS.md`
  - `AI_HANDOVER.md`
  - `CHANGELOG_AI.md`
- ทำ system review จากโค้ดจริง ครอบคลุม architecture, auth, DB, security, reliability, operability
- ระบุ critical risks ที่กระทบ production:
  1) seed credential ตายตัว
  2) login ไม่มี rate limiter

## 2026-06-02 (Hardening + LINE cleanup)

### What changed
- ลบ LINE feature ทั้งระบบ:
  - ลบ `backend/src/routes/lineWebhook.ts`
  - ลบ `backend/src/routes/lineIntegration.ts`
  - ลบ `backend/src/services/lineTextImport.ts`
  - ลบ `backend/src/database/migrate9.ts`
  - ตัดหน้า/client LINE จาก frontend settings + api client
- เพิ่ม `loginLimiter` ใน `POST /api/auth/login` (8 ครั้ง / 15 นาที)
- เพิ่ม audit failed login ลง `audit_log` (ไม่เก็บรหัสผ่าน)
- เพิ่ม production guard ใน `seed.ts` (ห้ามรันบน production)
- เพิ่ม cleanup migration `backend/src/database/migrate12.ts` (drop LINE tables if exists)
- เพิ่ม integration tests baseline (`backend/src/tests/auth.integration.test.ts`)

### Why
- ลด attack surface และความซับซ้อนจากฟีเจอร์ที่เลิกใช้
- ปิดช่องโหว่ brute-force และความเสี่ยง seed บน production
- เพิ่มความเชื่อมั่นก่อน deploy ด้วย integration test ขั้นต่ำ

### Impact
- API กลุ่ม LINE ถูกถอดออกแบบ breaking change
- auth endpoint มีพฤติกรรม rate-limit ใหม่
- DB เก่าสามารถ cleanup artifacts ได้แบบ idempotent

## 2026-06-02 (Error envelope + traceability)

### What changed
- เพิ่ม request trace middleware (`backend/src/middleware/trace.ts`)
- เพิ่ม canonical error envelope ใน `errorHandler`:
  - รูปแบบมาตรฐาน: `{ error, code, trace_id }`
  - รองรับรายละเอียดเพิ่ม (`details`, `detail`) โดยไม่ทำลาย compatibility
- เพิ่ม legacy error mapper middleware เพื่อ map response เก่าให้เป็น format ใหม่อัตโนมัติ
- เพิ่ม trace id ใน access logs (`morgan`)
- เพิ่ม integration test assertions สำหรับ `code` และ `trace_id` ใน auth + business route error

### Why
- ทำ incident triage ให้เร็วขึ้นและตามรอย request ได้จริง
- ลด format drift ของ error responses ระหว่าง routes
- ลดโอกาส breaking change ด้วย compatibility mapping

### Impact
- error response หลักของระบบมี schema เดียว
- ทีม frontend/ops ใช้ `trace_id` เชื่อม API error กับ backend logs ได้ทันที

## 2026-06-02 (CI quality gate)

### What changed
- เพิ่ม workflow `.github/workflows/ci-quality-gate.yml`
  - required: frontend lint/build
  - required: backend lint/build/test/integration-test
  - optional: dependency audit + lightweight secret scan
- เพิ่ม CI summary job เพื่อสรุป required/optional result ใน Step Summary
- เพิ่ม debug artifacts (`ci-debug-*`) ทุก job เพื่อช่วย triage
- อัปเดต docs (`RUNBOOK`, `SECURITY_CHECKLIST`, `AI_HANDOVER`) พร้อมคำสั่ง reproduce local

### Why
- บังคับ quality gate ก่อน merge แบบชัดเจน
- แยก required vs optional เพื่อลด merge friction แต่ยังคุม security baseline
- ลดเวลา debug เมื่อ CI fail

### Impact
- PR จะ fail ทันทีถ้า lint/build/test หลักล้ม
- optional security findings ไม่ block merge แต่ต้องถูกติดตามเป็นงาน

## 2026-06-02 (Refresh token + revoke strategy)

### What changed
- เพิ่ม access+refresh lifecycle ใน auth routes:
  - `POST /api/auth/refresh`
  - `POST /api/auth/logout`
  - `POST /api/auth/logout-all`
- เลือก revoke strategy แบบ session versioning (`users.token_version`)
- เพิ่ม migration `backend/src/database/migrate13.ts` และรวม `ALTER TABLE ... token_version` ใน `migrate.ts`
- อัปเดต `authenticate` ให้ validate `token_type`/`tv` กับค่าใน DB
- frontend รองรับ refresh flow ขั้นต่ำ:
  - เก็บ `refresh_token`
  - auto refresh บน 401 หนึ่งครั้ง แล้ว retry request
- เพิ่ม integration tests: login -> refresh -> revoke -> denied + expired token denied

### Why
- ลด blast radius เมื่อ token leak
- เพิ่มความสามารถ revoke ฝั่ง server โดยไม่ต้อง refactor ใหญ่
- ทำ phased rollout โดยไม่ force logout ผู้ใช้เดิมทันที

### Impact
- auth response เพิ่ม `access_token` และ `refresh_token` (ยังคง `token` เพื่อ backward compatibility)
- logout มีผล invalidate token generation ของผู้ใช้คนนั้น

## 2026-06-02 (Structured logging + incident triage)

### What changed
- เพิ่ม structured logger กลาง: `backend/src/lib/logger.ts`
- เพิ่ม request log middleware: `backend/src/middleware/requestLogger.ts`
- ปรับ backend ให้ log เป็น JSON พร้อม fields มาตรฐาน:
  - `ts`, `level`, `route`, `method`, `status`, `user_id`, `trace_id`
- ผูก error log (`db_*`, `unhandled_error`) กับ `trace_id` และ error envelope
- เพิ่ม redaction policy ใน logger (token/password/cookie related fields)
- อัปเดต runbook/security checklist สำหรับ incident triage flow จริง

### Why
- ลดเวลา debug production incident
- ทำให้ trace request เดียวจาก entry -> error ได้ทันที
- ลดความเสี่ยงข้อมูลอ่อนไหวหลุดใน log

### Impact
- logs อ่านง่ายและ query-friendly สำหรับ SIEM/log aggregator
- ทีม ops สามารถ triage จาก `trace_id` โดยไม่ต้องเดาจากเวลาอย่างเดียว

## 2026-06-02 (Deterministic migration process)

### What changed
- กำหนด migration policy ชัดใน `migrate.ts` (single canonical entrypoint)
- เพิ่ม schema metadata table: `schema_migration_meta`
- เพิ่ม verify script: `backend/src/database/verifyMigrate.ts`
- เพิ่ม npm script: `npm run migrate:verify`
- ปรับ `migrate11.ts`, `migrate12.ts`, `migrate13.ts` เป็น deprecated compatibility wrappers พร้อม warning
- อัปเดต `DB_SCHEMA`, `RUNBOOK`, `DECISIONS` ด้วย checklist fresh/existing + fallback plan

### Why
- ลด migration drift และ ambiguity ระหว่างทีม
- ให้ setup ใหม่กับ upgrade ฐานเดิมใช้ flow เดียวกัน
- ทำให้ rollout ตรวจซ้ำได้ (deterministic + verifiable)

### Impact
- คนใหม่ในทีมมี checklist ชัดเจนรันตามได้
- deploy pipeline สามารถ enforce ขั้น verify หลัง migrate

### Why
- ลด onboarding time
- ทำให้ทีมและ AI มี source of truth เดียว
- เปลี่ยนจาก “ความรู้กระจาย” เป็น “runbook + backlog ที่ลงมือทำได้ทันที”

### Impact
- ทีมสามารถเริ่ม sprint แรกได้ทันทีโดยไม่ต้อง reverse-engineer ใหม่
- ความเสี่ยง deploy/release ถูกทำให้มองเห็นและจัดลำดับได้
- งานต่อไปชัดเจนทั้ง quick wins และ mid-term hardening
