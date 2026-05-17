#!/usr/bin/env bash
# AuraX — รันทั้งระบบด้วย Docker (postgres + redis + backend + frontend)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

command -v docker >/dev/null 2>&1 || { echo "❌ ต้องติดตั้ง Docker Desktop ก่อน"; exit 1; }
docker compose version >/dev/null 2>&1 || { echo "❌ ต้องมี docker compose (v2)"; exit 1; }

if [[ ! -f .env ]]; then
  echo "📄 สร้าง .env จาก .env.example"
  cp .env.example .env
  # ค่าเริ่มต้นให้ตรงกับ docker-compose (รหัสผ่าน DB / JWT)
  if grep -q '^POSTGRES_PASSWORD=change_this' .env; then
    sed -i.bak 's/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=cuthuay_secret/' .env
    rm -f .env.bak
  fi
  if grep -q '^JWT_SECRET=change_this' .env; then
    sed -i.bak 's/^JWT_SECRET=.*/JWT_SECRET=supersecretkey_change_in_production_min32/' .env
    rm -f .env.bak
  fi
  if grep -q '^DATABASE_URL=.*localhost' .env; then
    sed -i.bak 's|^DATABASE_URL=.*|DATABASE_URL=postgresql://cuthuay:cuthuay_secret@localhost:5432/cuthuay|' .env
    rm -f .env.bak
  fi
  echo "   แก้ POSTGRES_PASSWORD / JWT_SECRET ใน .env ก่อน production"
fi

mkdir -p backend/reports backend/secrets

echo "🧹 หยุด container เก่าของโปรเจกต์นี้ (ถ้ามี)..."
docker compose down --remove-orphans 2>/dev/null || true
# container_name คงที่ (cuthuay_*) — ลบของเก่าที่ค้างนอก compose project
for name in cuthuay_db cuthuay_redis cuthuay_backend cuthuay_frontend; do
  docker rm -f "$name" 2>/dev/null || true
done

echo "🐳 Build images (ครั้งแรกอาจนาน — backend ติดตั้ง PaddleOCR)..."
docker compose build

echo "🚀 Start services..."
docker compose up -d --force-recreate

echo "🗃  รอ backend พร้อม แล้ว migrate + seed..."
ok=0
for i in $(seq 1 40); do
  if docker compose exec -T backend node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    ok=1
    break
  fi
  printf "   รอ backend... (%s/40)\r" "$i"
  sleep 3
done
echo ""

if [[ "$ok" -ne 1 ]]; then
  echo "❌ backend ไม่ขึ้น — ดู log:"
  echo "   docker compose logs backend --tail 80"
  exit 1
fi

docker compose exec -T backend node dist/database/migrate.js
docker compose exec -T backend node dist/database/seed.js

echo ""
echo "✅ ระบบพร้อมใช้งาน"
echo "   แอป:      http://localhost:3000"
echo "   API:      http://localhost:4000/health"
echo "   Login:    admin / admin1234"
echo ""
echo "   ดู log:   npm run docker:logs"
echo "   หยุด:     npm run docker:down"
