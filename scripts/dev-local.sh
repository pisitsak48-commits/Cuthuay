#!/usr/bin/env bash
# รัน backend + frontend บนเครื่อง (hot reload) — ใช้ Postgres จาก Docker
# ก่อนรัน: docker compose up -d postgres redis
#          docker compose stop frontend backend   (กัน port 3000/4000 ชน)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "สร้าง .env แล้ว — ตรวจ DATABASE_URL (Docker ใช้พอร์ต 5433 บน host)"
fi

# ชี้ไป Postgres ใน Docker (host 5433) ถ้ายังเป็น 5432
if grep -q '@localhost:5432/' .env 2>/dev/null; then
  echo "ℹ️  ปรับ DATABASE_URL → localhost:5433 (Postgres ใน Docker)"
  sed -i.bak 's|@localhost:5432/|@localhost:5433/|' .env
  rm -f .env.bak
fi

if lsof -i :3000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "❌ พอร์ต 3000 ถูกใช้อยู่ (มักเป็น cuthuay_frontend ใน Docker)"
  echo "   รัน: docker compose stop frontend backend"
  exit 1
fi
if lsof -i :4000 -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "❌ พอร์ต 4000 ถูกใช้อยู่ (มักเป็น cuthuay_backend ใน Docker)"
  echo "   รัน: docker compose stop frontend backend"
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "$ROOT/.env"
set +a
export DATABASE_URL JWT_SECRET

echo "🗃  migrate (ครั้งเดียวตอนเริ่ม)..."
(cd "$ROOT/backend" && npm run migrate)

echo ""
echo "🚀 Dev servers (hot reload)"
echo "   Frontend: http://localhost:3000"
echo "   Backend:  http://localhost:4000"
echo ""

cd "$ROOT/backend" && npm run dev &
BACKEND_PID=$!
cd "$ROOT/frontend" && npm run dev &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" INT TERM
wait $BACKEND_PID $FRONTEND_PID
