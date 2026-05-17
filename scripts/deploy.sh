#!/usr/bin/env bash
# AuraX — rsync โค้ดขึ้นเซิร์ฟเวอร์แล้ว build Docker
#
# บังคับตั้งค่าก่อนรัน (หรือใช้ deploy-nutanix.sh / deploy.local.env):
#   export SERVER='user@host'
#   export REMOTE_PATH='/path/to/AuraX'    # โฟลเดอร์ที่มี docker-compose.yml
#
# ตัวเลือก:
#   LOCAL_PATH=/other/path ./scripts/deploy.sh   # ค่าเริ่มต้น = โฟลเดอร์เหนือ scripts/
#   INIT_REMOTE_DIR=true ./scripts/deploy.sh     # สร้าง REMOTE_PATH บนเซิร์ฟถ้ายังไม่มี
#   DRY_RUN=true ./scripts/deploy.sh
#   DELETE_REMOTE=false ./scripts/deploy.sh      # rsync ไม่ใช้ --delete
#   RESET_VOLUMES=true ./scripts/deploy.sh       # อันตราย: ลบ volumes Postgres/Redis
#   REMOVE_IMAGES=true ./scripts/deploy.sh
#   PRUNE_BUILDER=true ./scripts/deploy.sh
#   BUILD_CACHE=true ./scripts/deploy.sh         # build ใช้ cache (เร็วกว่า --no-cache)
#   SKIP_MIGRATE=true ./scripts/deploy.sh
#   ENSURE_ENV=true ./scripts/deploy.sh          # ถ้ายังไม่มี .env ให้ copy จาก scripts/nutanix.env.example
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
LOCAL_PATH="${LOCAL_PATH:-$PROJECT_ROOT}"

: "${SERVER:?ตั้ง SERVER: export SERVER=user@192.168.x.x หรือใช้ deploy.local.env}"
: "${REMOTE_PATH:?ตั้ง REMOTE_PATH: export REMOTE_PATH=/home/user/AuraX}"

if [[ ! -f "$LOCAL_PATH/docker-compose.yml" ]]; then
  echo "❌ ไม่พบ docker-compose.yml ใน LOCAL_PATH=$LOCAL_PATH"
  echo "   ตรวจว่ารันจากโฟลเดอร์ AuraX หรือตั้ง LOCAL_PATH ให้ถูก"
  exit 1
fi

RSYNC_OPTS=(-az)
if [[ "${DELETE_REMOTE:-true}" == true ]]; then
  RSYNC_OPTS+=(--delete)
fi

if [[ "${DRY_RUN:-false}" == true ]]; then
  RSYNC_OPTS+=(-n)
  echo "⚠️  DRY RUN (rsync ไม่เขียนไฟล์จริง)"
fi

RSYNC_DEST="${SERVER}:${REMOTE_PATH}/"

echo "===> AuraX deploy"
echo "     Local:  ${LOCAL_PATH}/"
echo "     Remote: ${RSYNC_DEST}"

if [[ "${INIT_REMOTE_DIR:-false}" == true ]]; then
  echo "===> สร้างโฟลเดอร์บนเซิร์ฟ (ถ้ายังไม่มี)"
  ssh -T "$SERVER" "mkdir -p $(printf '%q' "$REMOTE_PATH")"
fi

echo "===> Sync ..."

rsync "${RSYNC_OPTS[@]}" \
  --exclude 'node_modules' \
  --exclude 'frontend/node_modules' \
  --exclude 'backend/node_modules' \
  --exclude 'frontend/.next' \
  --exclude 'frontend/out' \
  --exclude 'backend/dist' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'scripts/deploy.local.env' \
  --exclude 'frontend/.env*' \
  --exclude 'backend/.env*' \
  --exclude '.git' \
  --exclude '.cursor' \
  --exclude '*.log' \
  --exclude '**/tsconfig.tsbuildinfo' \
  --exclude 'backend/reports' \
  --exclude 'reports' \
  --exclude 'backend/secrets' \
  "$LOCAL_PATH/" \
  "$RSYNC_DEST"

echo "===> Sync เสร็จ"

if [[ "${DRY_RUN:-false}" == true ]]; then
  echo "จบ dry-run — ไม่รัน SSH"
  exit 0
fi

echo "===> Remote deploy บน ${SERVER} ..."

# ไม่ใช้ `env VAR=...` — path มีช่องว่างจะพัง; ส่งค่าผ่าน positional args ของ bash -s
ssh -T "$SERVER" bash -s -- \
  "$REMOTE_PATH" \
  "${RESET_VOLUMES:-false}" \
  "${REMOVE_IMAGES:-false}" \
  "${PRUNE_BUILDER:-false}" \
  "${SKIP_MIGRATE:-false}" \
  "${ENSURE_ENV:-false}" \
  "${BUILD_CACHE:-false}" \
  <<'REMOTE_SCRIPT'
set -euo pipefail
REMOTE_PATH="$1"
RESET_VOLUMES="$2"
REMOVE_IMAGES="$3"
PRUNE_BUILDER="$4"
SKIP_MIGRATE="$5"
ENSURE_ENV="$6"
BUILD_CACHE="$7"

cd "$REMOTE_PATH" || { echo "❌ ไม่พบ $REMOTE_PATH — ลอง INIT_REMOTE_DIR=true"; exit 1; }
echo "===> $(pwd)"

if [[ ! -f docker-compose.yml ]]; then
  echo "❌ ไม่พบ docker-compose.yml ใน $(pwd)"
  exit 1
fi

mkdir -p backend/reports backend/secrets

if [[ "$ENSURE_ENV" == true ]] && [[ ! -f .env ]] && [[ -f scripts/nutanix.env.example ]]; then
  cp scripts/nutanix.env.example .env
  echo "⚠️  สร้าง .env จาก scripts/nutanix.env.example — แก้ POSTGRES_PASSWORD และ JWT_SECRET"
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

BUILD_ARGS=()
if [[ "$BUILD_CACHE" != true ]]; then
  BUILD_ARGS+=(--no-cache)
fi

echo "===> docker compose build ${BUILD_ARGS[*]:-}"
docker compose build "${BUILD_ARGS[@]}"

echo "===> docker compose up -d"
docker compose up -d

if [[ "$SKIP_MIGRATE" != true ]]; then
  echo "===> รัน DB migrate (รอ backend พร้อม)"
  ok=0
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if docker compose exec -T backend node dist/database/migrate.js 2>/dev/null; then
      ok=1
      break
    fi
    echo "    ลอง migrate ครั้งที่ $i/15 — รอ 3s"
    sleep 3
  done
  if [[ "$ok" -ne 1 ]]; then
    echo "❌ migrate ล้มเหลว — ดู log: docker compose logs backend --tail 80"
    exit 1
  fi
fi

docker compose ps
docker ps --filter "name=cuthuay" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}" || true
docker image prune -f || true
echo "✅ Deploy เสร็จบนเซิร์ฟเวอร์"
echo "   เปิดเว็บ: http://$(hostname -I 2>/dev/null | awk '{print $1}'):3000 (หรือ IP ที่ตั้งใน CORS_ORIGIN)"
REMOTE_SCRIPT

echo "🚀 Deploy complete"
