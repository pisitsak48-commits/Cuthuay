import { pool } from '../config/database';

// Migration 2: Add dealers table and fix bets bet_type constraint
const SQL = `
-- Drop old bet_type constraint and add updated one
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_bet_type_check;
ALTER TABLE bets ADD CONSTRAINT bets_bet_type_check
  CHECK (bet_type IN (
    '2digit_top','2digit_bottom',
    '3digit_top','3digit_tote','3digit_back',
    '1digit_top','1digit_bottom'
  ));

-- Add customer_id FK if missing (backfill from migrate.ts)
ALTER TABLE bets ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

-- ─── Dealers (เจ้ามือ) ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dealers (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100)  NOT NULL,
  sender_name   VARCHAR(100),
  -- ลด % per bet type
  pct_3top      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_3tote     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_3back     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_2top      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_2bottom   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_1top      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_1bottom   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  -- จ่าย rates
  rate_3top     NUMERIC(10,2),
  rate_3tote    NUMERIC(10,2),
  rate_3back    NUMERIC(10,2),
  rate_2top     NUMERIC(10,2),
  rate_2bottom  NUMERIC(10,2),
  rate_1top     NUMERIC(10,4),
  rate_1bottom  NUMERIC(10,4),
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
`;

async function migrate2() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 2 complete: dealers table created');
  } catch (err) {
    console.error('Migration 2 failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate2();
