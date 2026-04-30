#!/usr/bin/env bash
# Cut Huay — rsync โค้ดขึ้นเซิร์ฟเวอร์แล้ว build Docker
#
# บังคับตั้งค่าก่อนรัน:
#   export SERVER='user@host'
#   export REMOTE_PATH='/path/to/Cut Huay'    # โฟลเดอร์ที่มี docker-compose.yml
#
# ตัวเลือก:
#   LOCAL_PATH=/other/path ./scripts/deploy.sh   # ค่าเริ่มต้น = โฟลเดอร์เหนือ scripts/
#   DRY_RUN=true ./scripts/deploy.sh
#   DELETE_REMOTE=false ./scripts/deploy.sh      # rsync ไม่ใช้ --delete
#   RESET_VOLUMES=true ./scripts/deploy.sh       # อันตราย: ลบ volumes Postgres/Redis
#   REMOVE_IMAGES=true ./scripts/deploy.sh
#   PRUNE_BUILDER=true ./scripts/deploy.sh
#   SKIP_MIGRATE=true ./scripts/deploy.sh
#   ENSURE_ENV=true ./scripts/deploy.sh          # ถ้ายังไม่มี .env ให้ copy จาก scripts/nutanix.env.example
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCAL_PATH="${LOCAL_PATH:-$(cd "$SCRIPT_DIR/.." && pwd)}"

: "${SERVER:?ตั้ง SERVER: export SERVER=user@192.168.x.x}"
: "${REMOTE_PATH:?ตั้ง REMOTE_PATH: export REMOTE_PATH=/home/user/Cut-Huay}"

RSYNC_OPTS=(-az)
if [[ "${DELETE_REMOTE:-true}" == true ]]; then
  RSYNC_OPTS+=(--delete)
fi

if [[ "${DRY_RUN:-false}" == true ]]; then
  RSYNC_OPTS+=(-n)
  echo "⚠️  DRY RUN (rsync ไม่เขียนไฟล์จริง)"
fi

RSYNC_DEST="${SERVER}:${REMOTE_PATH}/"

echo "===> Sync: ${LOCAL_PATH}/ → ${RSYNC_DEST}"

rsync "${RSYNC_OPTS[@]}" \
  --exclude 'node_modules' \
  --exclude 'frontend/.next' \
  --exclude 'frontend/out' \
  --exclude 'backend/dist' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'frontend/.env*' \
  --exclude 'backend/.env*' \
  --exclude '.git' \
  --exclude '.cursor' \
  --exclude '*.log' \
  --exclude '**/tsconfig.tsbuildinfo' \
  --exclude 'backend/reports' \
  --exclude 'reports' \
  "$LOCAL_PATH/" \
  "$RSYNC_DEST"

echo "===> Sync เสร็จ"

if [[ "${DRY_RUN:-false}" == true ]]; then
  echo "จบ dry-run — ไม่รัน SSH"
  exit 0
fi

echo "===> Remote deploy บน ${SERVER} ..."

# ไม่ใช้ `env VAR=...` — path มีช่องว่าง (เช่น Cut Huay) จะทำให้ env เห็น Huay เป็นคำสั่ง
# ส่งค่าผ่าน positional args ของ bash -s แทน
ssh -T "$SERVER" bash -s -- \
  "$REMOTE_PATH" \
  "${RESET_VOLUMES:-false}" \
  "${REMOVE_IMAGES:-false}" \
  "${PRUNE_BUILDER:-false}" \
  "${SKIP_MIGRATE:-false}" \
  "${ENSURE_ENV:-false}" \
  <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE_PATH="$1"
RESET_VOLUMES="$2"
REMOVE_IMAGES="$3"
PRUNE_BUILDER="$4"
SKIP_MIGRATE="$5"
ENSURE_ENV="$6"

cd "$REMOTE_PATH" || { echo "❌ ไม่พบ $REMOTE_PATH"; exit 1; }
echo "===> $(pwd)"

if [[ "$ENSURE_ENV" == true ]] && [[ ! -f .env ]] && [[ -f scripts/nutanix.env.example ]]; then
  cp scripts/nutanix.env.example .env
  echo "⚠️  สร้าง .env จาก scripts/nutanix.env.example — ควรแก้ POSTGRES_PASSWORD และ JWT_SECRET"
fi

DOWN_FLAGS=()
if [[ "$RESET_VOLUMES" == true ]]; then
  echo "⚠️  RESET_VOLUMES — ลบ Docker volumes (ข้อมูล DB หาย)"
  DOWN_FLAGS+=(-v)
fi
if [[ "$REMOVE_IMAGES" == true ]]; then
  DOWN_FLAGS+=(--rmi local)
fi

echo "===> docker compose down"
if ((${#DOWN_FLAGS[@]})); then
  docker compose down "${DOWN_FLAGS[@]}" || true
else
  docker compose down || true
fi

if [[ "$PRUNE_BUILDER" == true ]]; then
  echo "===> docker builder prune -a -f"
  docker builder prune -a -f || true
fi

echo "===> docker compose build --no-cache"
docker compose build --no-cache

echo "===> docker compose up -d"
docker compose up -d

if [[ "$SKIP_MIGRATE" != true ]]; then
  echo "===> รัน DB migrate (รอ backend พร้อม)"
  ok=0
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if docker compose exec -T backend node dist/database/migrate.js; then
      ok=1
      break
    fi
    echo "    ลอง migrate ครั้งที่ $i/10 — รอ 3s"
    sleep 3
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "❌ migrate ล้มเหลว — ดู log: docker compose logs backend"
    exit 1
  fi
fi

docker ps --filter "name=cuthuay" || true
docker image prune -f || true
echo "✅ Deploy เสร็จบนเซิร์ฟเวอร์"
REMOTE_SCRIPT

echo "🚀 Deploy complete"
