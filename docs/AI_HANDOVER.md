# AI_HANDOVER — Cut Huay

## Project snapshot

- Monorepo: Next.js frontend + Express TypeScript backend + PostgreSQL
- ธุรกิจหลัก: รับแทง, จัดการงวด, วิเคราะห์ความเสี่ยง, ตัดส่ง, สรุปผล
- Auth: JWT + role-based
- Deploy: Docker Compose + `scripts/deploy.sh`

## Top priorities (5)

1. ~~Docker local path ต้อง auto-migrate~~ — **done** (`backend/scripts/docker-entrypoint.sh`)
2. monitor login rate-limit และ false-positive
3. ~~ขยาย integration tests (import/summary/bulk/result)~~ — **done** (**28** default); + cookie/csrf scripts แยก; ต่อด้วย export/cut smoke (optional)
4. ~~API error contract มาตรฐานเดียว~~ — done; รักษา consistency ต่อ
5. ~~cookie+CSRF staging pilot~~ — **done** (R6–7); production default ยังปิด

## Known issues / tech debt

- ~~Contract drift: parser/type ซ้ำทั้ง frontend/backend~~ — **mitigated** (`packages/bet-parser` + contract tests; ดู M-02 ใน audit)
- Viewer role: read-only `/bets` (ดูโพย ไม่ mutate), `/bets/search`, `/bets/all`, summary — ดู ADR-011 ใน `DECISIONS.md`
- optional security checks อาจ fail ได้ (non-blocking) ต้องมี triage discipline
- Redis: **optional profile** — ไม่ start โดย default; backend ยังไม่ใช้ (ดู RUNBOOK)
- God components: `bets/page.tsx` (~1,706 LOC), `cut/page.tsx` (~1,123 LOC), `summary/page.tsx` (~433 LOC) — cut แยก `CutRangeTableModal` (R6)
- `useBetsQuery` SSoT step 2 done — ไม่มี `savedBets` duplicate state
- **Resolved (2026-06-17):** login bounce จาก schema drift (`token_version` missing) — entrypoint + CI migrate gate

## Next tasks (ordered)

1. Production cookie cutover execution (TLS soak + enable flags) — playbook R8 พร้อม; ห้ามเปิด default จน ops sign-off
2. monitor login rate-limit false-positive
3. Integration: export-bulk / cut-send smoke (optional)
4. Maintainability: `useBetCommit` hook — bets LOC trim
5. ~~NUMERIC precision (L-01)~~ — **done R8** (`money.ts` + contract tests)
6. PDPA: customer PII purge / backup retention — หลัง finance sign-off (R8 = audit_log dry-run only)

## Cookie migration implementation checklist (PR ถัดไป)

1. Backend:
   - ~~cookie issue/refresh~~ — **done** (`attachAuthCookies`, refresh from cookie)
   - support dual auth transport (cookie + bearer) แบบ feature-flag
2. Frontend:
   - ~~CSRF token fetch/store~~ — **done**
   - ~~cookie staging path~~ — **done** (`persistAuthTokens`, `restoreSessionFromCookies`, AppShell)
   - `withCredentials` when flags on
3. Infra/Proxy:
   - ~~enforce TLS + secure cookie attrs~~ — **playbook R8** (`COOKIE_SECURE`, nginx example)
   - verify forwarded headers + ws requirements
4. QA/SRE:
   - monitor login success rate / unexpected logout rate
   - monitor CSRF rejection rate
5. Cutover:
   - disable localStorage bearer default เมื่อ metrics stable

## Guardrails

- ห้ามเปลี่ยน auth behavior โดยไม่มี migration plan
- ห้ามแตะ payout/risk formula โดยไม่มี regression test
- migration ต้อง idempotent และทดสอบทั้ง empty DB / existing DB
- ห้ามรัน seed บน production
- docs ต้องอัปเดตทุกครั้งเมื่อเพิ่ม endpoint/table/role behavior

## Verification checklist

- [x] `npm run build` ผ่านทั้ง frontend/backend (R8)
- [ ] `npm run migrate` + `npm run migrate:verify` บน DB ว่างผ่าน
- [ ] Docker `docker compose up` auto-migrate ผ่าน entrypoint
- [ ] ไม่มี LINE artifacts ใน DB (`line_*` tables)
- [x] login brute-force baseline ถูกจำกัด
- [x] E2E: 3 Playwright tests (`smoke` + `bet-summary`) — CI `e2e_required`
- [x] integration: **28** default pass (`npm run test:integration`)
- [x] docs sync R8 (`CHANGELOG_AI`, `RUNBOOK`, `AUDIT`, `SECURITY_CHECKLIST`)
- [ ] CI required jobs green ก่อน merge ทุก PR (รวม CI Postgres migrate gate)
- [ ] cookie+csrf phase tests pass before cutover (`test:integration:cookie`, `test:integration:csrf`)
