#!/usr/bin/env bash
# Deploy ไปเครื่อง Nutanix (รันบน Mac ในโฟลเดอร์โปรเจกต์)
#
#   ./scripts/deploy-nutanix.sh
#
# จะถามรหัส SSH จาก ssh/rsync (หรือตั้ง SSH key ไว้จะไม่ถาม)
# ไม่ต้องส่งรหัสในแชท
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

export SERVER="nutanix-linux@192.168.101.198"
export REMOTE_PATH="/home/nutanix-linux/Cut Huay"
export LOCAL_PATH="/Users/pisitsak.kr/Desktop/Cut Huay"

# ครั้งแรกถ้ายังไม่มี .env บนเซิร์ฟ จะคัดลอกจาก scripts/nutanix.env.example
export ENSURE_ENV="${ENSURE_ENV:-true}"

exec "$SCRIPT_DIR/deploy.sh"
