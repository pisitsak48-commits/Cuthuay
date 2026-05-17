#!/usr/bin/env bash
# AuraX — Deploy ไปเครื่อง Nutanix (รันบน Mac ในโฟลเดอร์โปรเจกต์)
#
#   ./scripts/deploy-nutanix.sh
#
# ตั้งค่าเครื่องคุณครั้งเดียว:
#   cp scripts/deploy.local.env.example scripts/deploy.local.env
#   # แก้ SERVER / REMOTE_PATH ใน deploy.local.env
#
# จะถามรหัส SSH จาก ssh/rsync (หรือตั้ง SSH key ไว้จะไม่ถาม)
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ -f "$SCRIPT_DIR/deploy.local.env" ]]; then
  set -a
  # shellcheck source=/dev/null
  source "$SCRIPT_DIR/deploy.local.env"
  set +a
fi

export SERVER="${SERVER:-nutanix-linux@192.168.101.198}"
# โฟลเดอร์บนเซิร์ฟ (ยังเป็น Cut Huay ที่รันอยู่) — ชื่อบน Mac เป็น AuraX ได้ ไม่ต้องตรงกัน
_DEFAULT_REMOTE_PATH='/home/nutanix-linux/Cut Huay'
export REMOTE_PATH="${REMOTE_PATH:-$_DEFAULT_REMOTE_PATH}"

# ไม่ตั้ง LOCAL_PATH — sync จากโฟลเดอร์ที่รันสคริปต์ เช่น ~/AuraX

# เซิร์ฟมี .env อยู่แล้ว — ไม่สร้างทับ (rsync ก็ไม่ส่ง .env ขึ้นไป)
export ENSURE_ENV="${ENSURE_ENV:-false}"

exec "$SCRIPT_DIR/deploy.sh"
