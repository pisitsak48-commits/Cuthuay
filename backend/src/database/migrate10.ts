import { pool } from '../config/database';

const SQL = `
ALTER TABLE bets ADD COLUMN IF NOT EXISTS import_batch_id UUID;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS segment_index INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_bets_import_batch ON bets (round_id, import_batch_id, segment_index);
`;

async function migrate10() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 10 (bets import_batch_id, segment_index) completed');
  } catch (err) {
    console.error('Migration 10 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate10()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
