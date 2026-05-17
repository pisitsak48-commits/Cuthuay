import { pool } from '../config/database';

const SQL = `
-- ─── Add per-type commission pct columns to customers (like dealers) ──────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pct_3top     NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_3tote    NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_3back    NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_2top     NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_2bottom  NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_1top     NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_1bottom  NUMERIC(5,2) NOT NULL DEFAULT 0;

-- migrate existing commission_rate / commission_rate_run into the new per-type columns
-- (previous single-rate becomes the initial value for all columns in that group)
UPDATE customers SET
  pct_3top    = commission_rate,
  pct_3tote   = commission_rate,
  pct_3back   = commission_rate,
  pct_2top    = commission_rate,
  pct_2bottom = commission_rate,
  pct_1top    = commission_rate_run,
  pct_1bottom = commission_rate_run
WHERE pct_3top = 0;
`;

async function migrate6() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 6 completed successfully');
  } catch (err) {
    console.error('Migration 6 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate6()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
