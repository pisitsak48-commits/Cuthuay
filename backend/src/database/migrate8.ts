import { pool } from '../config/database';

const SQL = `
-- Add sort_order FLOAT to bets for insert-between ordering
-- (created_at stays as the real wall-clock insert time for display)
ALTER TABLE bets
  ADD COLUMN IF NOT EXISTS sort_order FLOAT;

-- Back-fill existing rows: use epoch millis of created_at so order is preserved
UPDATE bets SET sort_order = EXTRACT(EPOCH FROM created_at) * 1000
  WHERE sort_order IS NULL;

CREATE INDEX IF NOT EXISTS idx_bets_sort_order ON bets (round_id, sort_order);
`;

async function migrate8() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 8 completed successfully');
  } catch (err) {
    console.error('Migration 8 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate8()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
