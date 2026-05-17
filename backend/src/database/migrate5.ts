import { pool } from '../config/database';

const SQL = `
-- ─── Add commission_rate_run for วิ่ง (1-digit) types ─────────────────────────
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS commission_rate_run NUMERIC(5,2) NOT NULL DEFAULT 0;
`;

async function migrate5() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 5 completed successfully');
  } catch (err) {
    console.error('Migration 5 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate5()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
