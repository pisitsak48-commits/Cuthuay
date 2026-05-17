import { pool } from '../config/database';

const SQL = `
-- ─── Add entity columns to number_limits ─────────────────────────────────────
ALTER TABLE number_limits
  ADD COLUMN IF NOT EXISTS entity_type  VARCHAR(10)  NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS entity_id    UUID,
  ADD COLUMN IF NOT EXISTS payout_pct   NUMERIC(5,2) NOT NULL DEFAULT 100;

-- Drop old unique constraint (if exists) so we can re-create with entity
ALTER TABLE number_limits
  DROP CONSTRAINT IF EXISTS number_limits_round_id_number_bet_type_key;

-- Partial unique index for 'all' entity (no entity_id)
CREATE UNIQUE INDEX IF NOT EXISTS nl_unique_all
  ON number_limits (round_id, number, bet_type)
  WHERE entity_type = 'all';

-- Partial unique index for customer/dealer (has entity_id)
CREATE UNIQUE INDEX IF NOT EXISTS nl_unique_entity
  ON number_limits (round_id, number, bet_type, entity_id)
  WHERE entity_type != 'all';
`;

async function migrate7() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 7 completed successfully');
  } catch (err) {
    console.error('Migration 7 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate7()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
