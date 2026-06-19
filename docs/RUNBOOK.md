# RUNBOOK — Cut Huay

## 1) Local development

### Prerequisites
- Node.js 20+
- npm
- PostgreSQL (local) หรือ docker postgres

### Quick start
1. ตั้งค่า environment จาก `.env.example` (root)
2. ติดตั้ง deps
3. migrate + seed
4. รัน backend/frontend

คำสั่งที่มีอยู่:
- `./start-dev.sh` (ช่วยทำข้อ 1–4 อัตโนมัติ)

**ระวัง:** script นี้ `source` root `.env` แล้ว export `DATABASE_URL/JWT_SECRET` ให้ backend

## 2) Docker Compose

ไฟล์หลัก: `docker-compose.yml`

```bash
docker compose up -d --build
```

Backend container **auto-runs** `migrate` + `verifyMigrate` via `backend/scripts/docker-entrypoint.sh` ก่อน start API (ตั้งแต่ audit 2026-06-17)

### Dev seed credentials

`npm run seed` (dev/test only — refuses `NODE_ENV=production`):

```bash
# ใน root .env หรือ export ก่อน seed
SEED_ADMIN_PASSWORD=your-strong-admin-password
SEED_OPERATOR_PASSWORD=your-strong-operator-password

cd backend && npm run migrate && npm run seed
```

- ถ้าไม่ตั้ง env ระบบสุ่มรหัส one-time แล้วพิมพ์ใน log ครั้งเดียว
- Production: ใช้ `POST /api/auth/bootstrap` หรือสร้าง user ผ่าน admin UI — **ห้าม** รัน seed

### E2E smoke (Playwright)

```bash
# Terminal 1–2: stack ต้องรันอยู่ (docker compose หรือ start-dev.sh)
export SEED_ADMIN_PASSWORD=...   # หรือ E2E_PASS
export SEED_VIEWER_PASSWORD=... # สำหรับเคส viewer read-only (optional)
./scripts/e2e-smoke.sh
# หรือ: cd frontend && npm run test:e2e
```

CI job `Playwright E2E Smoke (required)` รัน stack จริงบน Postgres service + seed ด้วย `E2E_PASS` และ `SEED_VIEWER_PASSWORD`

ชุดทดสอบ:
- `smoke.spec.ts` — login, rounds, viewer read-only
- `bet-summary.spec.ts` — API setup ลูกค้า+โพย → `/bets` → `/summary`

หากต้องการรัน migrate ด้วยตนเอง (เช่น debug):

```bash
docker compose exec -T backend node dist/database/migrate.js
docker compose exec -T backend node dist/database/verifyMigrate.js
```

บริการ:
- `postgres` :5432
- `backend` :4000
- `frontend` :3000
- `redis` :6379 — **optional / unused** โดย backend ปัจจุบัน; เปิดด้วย `docker compose --profile redis up` เท่านั้น (ยังไม่ wire rate-limit store)

### Environment สำคัญ
- `DATABASE_URL`
- `JWT_SECRET` (ต้องยาว >= 32 ตาม zod env schema)
- `CORS_ORIGIN`
- `GOOGLE_APPLICATION_CREDENTIALS` (ถ้าใช้ Vision OCR)

## 3) Health checks

```bash
curl -s http://localhost:4000/health
curl -s http://localhost:4000/api/auth/setup-status
curl -I http://localhost:3000
docker compose ps
```

## 4) Common troubleshooting

### A) Frontend เรียก API ไม่ได้ / CORS
อาการ: login ขึ้น network error

ตรวจ:
1. backend ต้องรันที่ `:4000`
2. `CORS_ORIGIN` ต้อง match URL frontend
3. Next rewrite ถูกต้อง (`frontend/next.config.mjs`)

### B) WebSocket ไม่ต่อ
ตรวจ:
1. token ยังไม่หมดอายุ
2. client ต่อ `ws://host:4000/ws` และส่ง subprotocol `cuthuay.v1` + `auth.jwt.<token>`
3. backend log ไม่มี `Invalid token`

### C) Legacy LINE tables ยังอยู่ใน DB เก่า
ระบบเลิกใช้ LINE แล้ว แต่ฐานเก่าอาจยังมีตารางค้าง:
- `line_integration_settings`
- `line_webhook_log`

แนวทางแก้:
- รัน `npm run migrate12` หรือ `npm run migrate` เวอร์ชันล่าสุด

### D) Auth token ใช้งานไม่ได้หลัง restart
ตรวจ:
1. `JWT_SECRET` เปลี่ยนหรือไม่
2. browser เก็บ token เก่าใน `localStorage`
3. frontend interceptor auto-logout เมื่อเจอ 401

### E) Login สำเร็จแล้วเด้งกลับ `/login` (login bounce)

**อาการ:** เห็น dashboard แวบเดียว แล้วกลับหน้า login; DevTools แสดง `POST /api/auth/refresh` เป็น 500 หรือ 401 ซ้ำ

**สาเหตุที่พบบ่อย:**
1. **Schema drift** — คอลัมน์ `users.token_version` ไม่มี (DB เก่า / ไม่ได้ migrate)
2. `JWT_SECRET` ไม่ตรงกันระหว่าง container restart
3. Rate limit login (`429 Too many login attempts`) — restart backend เพื่อ clear in-memory limiter

**ตรวจสอบ:**

```bash
# 1) คอลัมน์ token_version ต้องมี
docker compose exec postgres psql -U cuthuay -d cuthuay \
  -c "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='token_version';"

# 2) verify migration
docker compose exec backend node dist/database/verifyMigrate.js

# 3) ทดสอบ refresh โดยตรง (แทน browser)
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YOUR_SEED_OR_BOOTSTRAP_PASSWORD"}' | jq -r '.refresh_token')
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:4000/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refresh_token\":\"$TOKEN\"}"
# ต้องได้ 200 ไม่ใช่ 500

# 4) backend logs
docker compose logs backend --tail=100 | rg -i "token_version|42703|auth_schema_drift"
```

**แก้ไข:**
```bash
docker compose exec -T backend node dist/database/migrate.js
docker compose exec -T backend node dist/database/verifyMigrate.js
docker compose restart backend
```

หลัง rebuild image ใหม่ entrypoint จะ migrate อัตโนมัติทุกครั้งที่ container start

## 5) Production deploy notes

สคริปต์ deploy: `scripts/deploy.sh`
- rsync โค้ด
- `docker compose build --no-cache`
- `docker compose up -d`
- รัน `node dist/database/migrate.js` ซ้ำได้

ก่อน deploy:
- ยืนยันว่า `.env` บน server ปลอดภัย
- ยืนยันไม่ได้รัน `seed` บน production
- backup DB ก่อนใช้ flag `RESET_VOLUMES=true` (ลบข้อมูลจริง)

### Deterministic migration process (canonical)

ใช้เฉพาะเส้นทางนี้:

```bash
cd backend
npm run migrate
npm run migrate:verify
```

ห้ามใช้ `migrate11/12/13` เป็น flow หลัก (deprecated compatibility wrappers)

### Checklist: fresh DB

1. สร้าง DB ว่าง
2. รัน `npm run migrate`
3. รัน `npm run migrate:verify`
4. เช็ก `schema_migration_meta` มี row และ `schema_version` ล่าสุด
5. smoke: `GET /health`, login flow

### Checklist: existing DB upgrade

1. backup DB snapshot ก่อน
2. รัน `npm run migrate`
3. รัน `npm run migrate:verify`
4. ตรวจว่าไม่มี legacy line tables ค้าง
5. validate business data sample (rounds/bets/customers) ยังอ่านได้
6. fallback decision: ถ้า verify fail ให้ rollback จาก snapshot

## 6) Incident quick checklist

1. Confirm service status (`docker compose ps`)
2. Check backend logs (`docker compose logs backend --tail=200`)
3. Check DB connectivity (`pg_isready`)
4. Check `/health`
5. Validate auth path (`/api/auth/me` ด้วย token test)
6. If data incident: pause writes, backup DB snapshot, then investigate

## 7) Error traceability (ใหม่)

- ทุก error response มี `code` และ `trace_id`
- backend ตอบ `x-request-id` ทุก request (ใช้ correlate กับ log)
- request logs เป็น JSON structured log (`backend/src/lib/logger.ts`)
- schema ขั้นต่ำใน log: `ts, level, route, method, status, user_id, trace_id`
- debug incident:
  1. เก็บ `trace_id` จาก client error
  2. ค้นหา log ด้วย `trace_id=<id>`
  3. ไล่ต่อที่ DB/app logs ตามเวลาเดียวกัน

### Sample incident triage flow (production)

1. รับ error จาก frontend:
   ```json
   { "error": "Invalid token", "code": "UNAUTHORIZED", "trace_id": "6b2a..." }
   ```
2. ค้นหา log ด้วย trace id:
   - `trace_id=6b2a...`
3. ตรวจ sequence เดียวกัน:
   - `http_request` (entry log)
   - `db_*` หรือ `unhandled_error` (error log)
4. ดู `route/method/status/user_id` เพื่อระบุ impact scope
5. ตัดสินใจ rollback/mitigate ตามประเภท error

## 8) CI quality gate (required vs optional)

Workflow: `.github/workflows/ci-quality-gate.yml`

Required jobs (ต้องผ่านก่อน merge):
1. `Frontend Lint+Build (required)`
2. `Backend Lint+Build+Test (required)`

Optional job (เตือนแต่ไม่ block merge):
1. `Security Baseline (optional)` — `npm audit` + lightweight secret scan

Artifacts/debug:
- แต่ละ job อัปโหลด artifact `ci-debug-*` (node/npm versions)
- ดูตารางผลรวมที่ `CI Summary` ใน GitHub Step Summary

### Reproduce CI locally

```bash
# frontend required
cd frontend && npm ci && npm run lint && npm run build

# backend required
cd ../backend && npm ci && npm run lint && npm run build && npm run test && npm run test:integration

# optional security checks
cd ../frontend && npm audit --omit=dev --audit-level=high
cd ../backend && npm audit --omit=dev --audit-level=high
cd .. && rg -n --hidden --glob '!.git' --glob '!**/node_modules/**' '(AKIA[0-9A-Z]{16}|-----BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY-----|xox[baprs]-[0-9A-Za-z-]{10,}|AIza[0-9A-Za-z\-_]{35}|ghp_[0-9A-Za-z]{36})' .
```

## 9) Design-first runbook: bearer -> cookie migration

### Proposed architecture (target)
- auth transport:
  - access token: httpOnly cookie (short TTL)
  - refresh token: httpOnly cookie (rotation)
- CSRF:
  - mutation routes ต้องมี `X-CSRF-Token`
  - validate กับ csrf cookie/token pair

### Reverse proxy requirements
1. HTTPS only in production
2. preserve headers: `X-Forwarded-Proto`, `X-Forwarded-For`, `X-Request-Id`
3. cookie flags: `Secure`, `HttpOnly`, `SameSite`, `Domain` ตาม topology
4. WebSocket: support `wss` + preserve `Sec-WebSocket-Protocol`

### Rollout phases
1. Phase 1: dual mode (cookie + bearer), observability on
2. Phase 2: enforce CSRF on mutation routes
3. Phase 3: default off for localStorage bearer
4. Phase 4: remove legacy bearer path

### Staging pilot (cookie + CSRF)

ใช้บน staging / dev เท่านั้น — **อย่าเปิดใน production LAN จนกว่า reverse proxy + TLS พร้อม**

Backend `.env` (หรือ compose override):

```env
COOKIE_AUTH_ENABLED=true
CSRF_ENABLED=true
CORS_ORIGIN=http://localhost:3000
```

Frontend `.env.local`:

```env
NEXT_PUBLIC_COOKIE_AUTH_ENABLED=true
NEXT_PUBLIC_CSRF_ENABLED=true
```

Smoke (หลัง login):

1. `POST /api/auth/login` → ได้ `Set-Cookie` `access_token` + `refresh_token` (httpOnly)
2. `POST /api/auth/refresh` **ไม่มี body** แต่ส่ง cookies → 200 + access ใหม่
3. reload frontend (`NEXT_PUBLIC_COOKIE_AUTH_ENABLED=true`) → session คืนผ่าน `restoreSessionFromCookies`
4. (ถ้าเปิด CSRF) `GET /api/auth/csrf` → `csrf_token`; mutation ต้องมี `X-CSRF-Token`
5. `POST /api/auth/logout` → cookies ถูก clear

รัน integration tests แยก:

```bash
cd backend
npm run test:integration:cookie
CSRF_ENABLED=true COOKIE_AUTH_ENABLED=true npm run test:integration:csrf
```

Dual mode: Bearer ใน `localStorage` ยังใช้ได้คู่กับ cookie จนกว่าจะ phase 3 cutover

### Production cutover checklist (Go/No-Go)

**Prerequisites (จาก `SECURITY_CHECKLIST.md`):**
- [ ] TLS terminate ที่ reverse proxy (`deploy/nginx/cuthuay.conf.example`)
- [ ] `X-Forwarded-Proto: https` ถึง backend
- [ ] `CORS_ORIGIN` ตรง origin จริง
- [ ] `COOKIE_SECURE=true` (หรือ `false` เฉพาะ HTTP LAN pilot ชั่วคราว)
- [ ] Ops sign-off สำหรับ cookie default + soak plan

**Env template:** [`scripts/production-cookie.env.example`](../scripts/production-cookie.env.example)

```env
COOKIE_AUTH_ENABLED=true
CSRF_ENABLED=true
COOKIE_SECURE=true
NEXT_PUBLIC_COOKIE_AUTH_ENABLED=true
NEXT_PUBLIC_CSRF_ENABLED=true
CORS_ORIGIN=https://your-host
```

**7-day soak (docs only — ไม่ปิด Bearer default ใน R8):**
1. Login success rate / unexpected logout
2. Refresh rate และ 401 spikes
3. CSRF reject rate (`CSRF_INVALID`)
4. WebSocket drop / reconnect
5. Rollback: ปิด cookie flags → Bearer ยังทำงาน (dual mode)

## 10) Automated database backup

Script: [`scripts/backup-db.sh`](../scripts/backup-db.sh)

```bash
chmod +x scripts/backup-db.sh
./scripts/backup-db.sh
```

Environment overrides:
- `BACKUP_DIR` — default `./backups`
- `RETENTION_DAYS` — default `7`

### Cron example (daily 02:00)

```cron
0 2 * * * cd /opt/cuthuay && ./scripts/backup-db.sh >> /var/log/cuthuay-backup.log 2>&1
```

### Restore drill (one-time validation)

```bash
# stop writers
docker compose stop backend frontend

# restore into fresh DB (example)
docker compose exec -T postgres dropdb -U cuthuay cuthuay_restore_test || true
docker compose exec -T postgres createdb -U cuthuay cuthuay_restore_test
docker compose exec -T postgres pg_restore -U cuthuay -d cuthuay_restore_test < backups/cuthuay_YYYYMMDD_HHMMSS.dump

# smoke: row counts / login on staging copy only
```

Record outcome in [`docs/CHANGELOG_AI.md`](CHANGELOG_AI.md).

## 11) PDPA audit_log retention purge (gated)

Script: [`backend/src/scripts/purgeRetention.ts`](../backend/src/scripts/purgeRetention.ts)

```bash
cd backend
npm run purge:retention
```

**Defaults (safe):** `PDPA_PURGE_ENABLED=false`, `PDPA_PURGE_DRY_RUN=true`, `AUDIT_LOG_RETENTION_DAYS=90`

| Flag | Default | Meaning |
|------|---------|---------|
| `PDPA_PURGE_ENABLED` | `false` | Master switch — ต้อง sign-off ก่อนเปิด |
| `PDPA_PURGE_DRY_RUN` | `true` | รายงานจำนวนแถวที่จะลบเท่านั้น |
| `AUDIT_LOG_RETENTION_DAYS` | `90` | ลบ `audit_log` ที่ `created_at` เก่ากว่า N วัน |

**Live purge (หลัง sign-off):**

```env
PDPA_PURGE_ENABLED=true
PDPA_PURGE_DRY_RUN=false
```

### Cron example (weekly Sunday 03:30 — dry-run until enabled)

```cron
30 3 * * 0 cd /opt/cuthuay/backend && npm run purge:retention >> /var/log/cuthuay-purge.log 2>&1
```

Scope R8: `audit_log` only — ไม่ลบ `customers` หรือ backup archives.

