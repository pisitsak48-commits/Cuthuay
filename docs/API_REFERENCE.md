# API Reference — Cut Huay (AuraX)

Base URL (dev): `http://localhost:4000`  
ผ่าน frontend: `http://localhost:3000/api/...` (Next rewrite → backend)

## Authentication

| Header | Value |
|--------|--------|
| `Authorization` | `Bearer <JWT>` |

JWT payload (`backend/src/models/types.ts` → `JwtPayload`): `sub` (user id), `username`, `role`, `iat`, `exp`

ออกโทเคนได้จาก: `POST /api/auth/login`, `POST /api/auth/bootstrap`, `POST /api/auth/refresh`

## Token lifecycle (phased rollout)

- Access token (`token`/`access_token`): ค่าเริ่มต้น `JWT_EXPIRES_IN=8h`
- Refresh token (`refresh_token`): ค่าเริ่มต้น `REFRESH_EXPIRES_IN=7d`
- Refresh signing key: `JWT_REFRESH_SECRET` (fallback = `JWT_SECRET`)
- Revoke strategy: **session versioning** ผ่าน `users.token_version`
  - token ใหม่ฝัง claim `tv`
  - เมื่อ logout/logout-all: `token_version = token_version + 1`
  - token ที่ `tv` ไม่ตรง DB จะถูกปฏิเสธ
- Backward compatibility: access token เก่าที่ไม่มี `tv` ยังผ่านได้เมื่อ `token_version=0`

## Standard error format

จาก `backend/src/middleware/errorHandler.ts`:

```json
{ "error": "Human-readable message", "code": "ERROR_CODE", "trace_id": "uuid-or-request-id" }
```

Header:

| Header | Description |
|--------|-------------|
| `x-request-id` | request/trace id ที่ backend สร้างหรือรับต่อจาก upstream |

ตัวอย่างก่อน/หลัง:

```json
// before
{ "error": "Invalid credentials" }

// after
{ "error": "Invalid credentials", "code": "UNAUTHORIZED", "trace_id": "2de9f..." }
```

| Case | Status | Body |
|------|--------|------|
| Zod validation | 400 | `{ "error": "Validation error", "code": "VALIDATION_ERROR", "trace_id": "...", "details": { "field": ["..."] } }` |
| PG unique (23505) | 409 | `{ "error": "Duplicate entry", "code": "DUPLICATE_ENTRY", "trace_id": "...", "detail": "..." }` |
| PG FK (23503) | 400 | `{ "error": "ข้อมูลอ้างอิงไม่มีในระบบ...", "code": "FOREIGN_KEY_VIOLATION", "trace_id": "...", "detail": "..." }` |
| Auth missing | 401 | `{ "error": "Missing or malformed Authorization header", "code": "UNAUTHORIZED", "trace_id": "..." }` |
| Forbidden role | 403 | `{ "error": "Insufficient permissions", "code": "FORBIDDEN", "trace_id": "..." }` |
| Not found | 404 | `{ "error": "Route not found", "code": "NOT_FOUND", "trace_id": "..." }` หรือข้อความเฉพาะ route |
| Server | 500 | `{ "error": "Internal server error", "code": "INTERNAL_ERROR", "trace_id": "..." }` (+ `stack` ใน `NODE_ENV=development`) |

## Public endpoints (ไม่ต้อง JWT)

| Method | Path | คำอธิบาย |
|--------|------|----------|
| GET | `/health` | `{ status, ts }` |
| GET | `/api/auth/setup-status` | `{ needs_first_user, user_count }` |
| POST | `/api/auth/bootstrap` | สร้าง admin คนแรก (rate limit 30/hr) |
| POST | `/api/auth/login` | Login |

## Auth & users (`routes/auth.ts`)

| Method | Path | Auth | Roles |
|--------|------|------|-------|
| GET | `/api/auth/me` | Bearer (inline verify) | any |
| POST | `/api/auth/refresh` | refresh token in body | any |
| POST | `/api/auth/logout` | ✓ access token | any |
| POST | `/api/auth/logout-all` | ✓ access token | any |
| GET | `/api/auth/users` | ✓ | admin |
| POST | `/api/auth/register` | ✓ | admin |
| PATCH | `/api/auth/users/:id` | ✓ | admin |
| DELETE | `/api/auth/users/:id` | ✓ | admin |

**Login example**

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "..." }
```

```json
{
  "token": "eyJ...",
  "access_token": "eyJ...",
  "refresh_token": "eyJ...",
  "user": { "id": "uuid", "username": "admin", "role": "admin" }
}
```

**Refresh example**

```http
POST /api/auth/refresh
Content-Type: application/json

{ "refresh_token": "<JWT>" }
```

## Rounds (`routes/rounds.ts`) — ทุก route ต้อง `authenticate`

| Method | Path | Roles | หมายเหตุ |
|--------|------|-------|----------|
| GET | `/api/rounds` | any | `?status=open` |
| GET | `/api/rounds/:id` | any | |
| POST | `/api/rounds` | admin, operator | หนึ่งงวดต่อ `draw_date` |
| DELETE | `/api/rounds/:id` | admin | cascade ลบ bets/send_batches |
| PATCH | `/api/rounds/:id/status` | admin | |
| PATCH | `/api/rounds/:id/dealer` | admin | |
| POST | `/api/rounds/:id/result` | admin | บันทึกผล + `result_data` JSON |
| GET | `/api/rounds/:id/result` | any | |
| POST | `/api/rounds/:id/reset-result` | admin | |
| GET | `/api/rounds/:id/export` | admin | JSON backup |
| POST | `/api/rounds/export-bulk` | admin | |
| POST | `/api/rounds/import-preview` | admin | body ใหญ่ได้ (100mb) |
| POST | `/api/rounds/import` | admin | |

## Bets (`routes/bets.ts`) — `authenticate` ทั้ง router

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/bets?round_id=&limit=&cursor=` | any |
| GET | `/api/bets/search?round_id=&mode=` | any |
| POST | `/api/bets` | admin, operator |
| POST | `/api/bets/bulk` | admin, operator (max 500) |
| PATCH | `/api/bets/move-sheet` | admin, operator |
| DELETE | `/api/bets/:id` | admin |
| POST | `/api/bets/bulk-delete` | admin |
| POST | `/api/bets/parse-pdf` | any (multipart) |
| POST | `/api/bets/ocr-image` | any (multipart) |

**Single bet example**

```json
POST /api/bets
{
  "round_id": "uuid",
  "number": "25",
  "bet_type": "2digit_top",
  "amount": 1000,
  "payout_rate": 90
}
```

**List bets (cursor pagination)**

```http
GET /api/bets?round_id=<uuid>&limit=500&cursor=<sort_order>:<bet_uuid>
```

| Query | Default | Notes |
|-------|---------|-------|
| `limit` | 500 | max 1000 |
| `cursor` | — | opaque `sort_order:uuid` from previous `next_cursor` |

```json
{
  "bets": [ /* Bet[] */ ],
  "next_cursor": "42:uuid-or-null",
  "has_more": false
}
```

Frontend `betsApi.listAll()` merges pages client-side for full-sheet views.

## Cut (`routes/cut.ts`)

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/cut/:roundId/risk` | any |
| GET | `/api/cut/:roundId/dealer-rates` | any |
| GET | `/api/cut/:roundId/bet-scope` | any |
| GET | `/api/cut/:roundId/plans` | any |
| POST | `/api/cut/:roundId/simulate` | any |
| POST | `/api/cut/:roundId/range-simulation` | any |
| POST | `/api/cut/:roundId/apply` | admin, operator |
| GET/POST/DELETE | `/api/cut/:roundId/send-batches` | POST/DELETE: admin, operator |

## Limits (`routes/limits.ts`) — write = admin

| Method | Path |
|--------|------|
| GET | `/api/limits/:roundId` |
| PUT | `/api/limits/:roundId` |
| PUT | `/api/limits/:roundId/bulk` |
| DELETE | `/api/limits/:roundId/...` |

## Reports (`routes/reports.ts`) — read-only; `authorize(admin, operator, viewer)`

| Method | Path | Roles |
|--------|------|-------|
| GET | `/api/reports/dashboard` | admin, operator, viewer |
| GET | `/api/reports/:roundId/summary` | admin, operator, viewer |
| GET | `/api/reports/:roundId/pdf` | admin, operator, viewer |
| GET | `/api/reports/:roundId/bet-view` | admin, operator, viewer |
| GET | `/api/reports/:roundId/profit-summary` | admin, operator, viewer |
| GET | `/api/reports/:roundId/dealer-wins` | admin, operator, viewer |
| GET | `/api/reports/:roundId/customer-wins` | admin, operator, viewer |

**Dashboard response** includes server-side batch profit extras (replaces per-round fan-out):

```json
{
  "round_stats": [ { "status": "open", "count": "1" } ],
  "active_bets": { "total_bets": "10", "total_revenue": "50000" },
  "recent_rounds": [ /* up to 24 */ ],
  "profit_by_round": {
    "<round_uuid>": { /* profit summary extras */ }
  }
}
```

## Customers & dealers

| Router | Prefix | Write roles |
|--------|--------|-------------|
| `customers.ts` | `/api/customers` | POST/PUT: admin, operator; DELETE/import/export: admin |
| `dealers.ts` | `/api/dealers` | คล้าย customers |

## WebSocket

- URL: `ws://<host>:4000/ws`
- Auth: ส่ง JWT ผ่าน `Sec-WebSocket-Protocol` รูปแบบ `auth.jwt.<JWT>` พร้อม protocol `cuthuay.v1`
- Server → client: `broadcast()` จาก bets (เช่นหลังสร้างโพย)
- Client ping: `{ "type": "ping" }` → `{ "type": "pong" }`

## Rate limiting

- Global: `express-rate-limit` 5000 / 15 min (`index.ts`)
- Bootstrap: 30 / hour (`auth.ts`)
- Login: dedicated limiter 8 attempts / 15 min (`auth.ts`)
