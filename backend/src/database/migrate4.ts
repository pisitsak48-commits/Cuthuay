import { pool } from '../config/database';

const SQL = `
-- ─── Extend rounds status to allow 'archived' ─────────────────────────────────
ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
ALTER TABLE rounds
  ADD CONSTRAINT rounds_status_check
  CHECK (status IN ('open', 'closed', 'drawn', 'archived'));

-- ─── Send Batches: records confirmed send-to-dealer actions ───────────────────
CREATE TABLE IF NOT EXISTS send_batches (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id    UUID NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  bet_type    VARCHAR(25) NOT NULL,
  threshold   NUMERIC(14,2) NOT NULL,
  items       JSONB NOT NULL,
  total       NUMERIC(14,2) NOT NULL,
  dealer_id   UUID REFERENCES dealers(id),
  dealer_name VARCHAR(100),
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_send_batches_round ON send_batches(round_id);
`;

async function migrate4() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 4 completed successfully');
  } catch (err) {
    console.error('Migration 4 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate4()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
