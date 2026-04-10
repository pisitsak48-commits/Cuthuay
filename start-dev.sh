#!/usr/bin/env bash
# ─── CutHuay — Quick Start (Development) ────────────────────────────────────
set -e

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 1. Check prerequisites ───────────────────────────────────────────────────
command -v node  >/dev/null 2>&1 || { echo "❌ Node.js not found"; exit 1; }
command -v npm   >/dev/null 2>&1 || { echo "❌ npm not found";     exit 1; }
command -v psql  >/dev/null 2>&1 || echo "⚠  psql not found — make sure PostgreSQL is running"

# ── 2. Copy .env if not present ──────────────────────────────────────────────
if [ ! -f "$ROOT/.env" ]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  echo "✅ .env created — please edit DATABASE_URL and JWT_SECRET before proceeding"
fi

# ── 3. Install dependencies ──────────────────────────────────────────────────
echo "📦 Installing backend dependencies..."
cd "$ROOT/backend" && npm install --silent

echo "📦 Installing frontend dependencies..."
cd "$ROOT/frontend" && npm install --silent

# ── 4. Migrate + seed DB ─────────────────────────────────────────────────────
echo "🗃  Running database migrations..."
cd "$ROOT/backend"
source "$ROOT/.env"
export DATABASE_URL JWT_SECRET
npm run migrate

echo "🌱 Seeding database..."
npm run seed

# ── 5. Start dev servers ─────────────────────────────────────────────────────
echo ""
echo "🚀 Starting servers..."
echo "   Backend:  http://localhost:4000"
echo "   Frontend: http://localhost:3000"
echo "   API Docs: http://localhost:4000/health"
echo ""

# Run both in parallel
cd "$ROOT/backend"  && npm run dev &
BACKEND_PID=$!

cd "$ROOT/frontend" && npm run dev &
FRONTEND_PID=$!

# Handle shutdown
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null" INT TERM
wait $BACKEND_PID $FRONTEND_PID
