import { pool } from '../config/database';

/** เพิ่ม updated_at ให้ bets — ใช้แยกเวลาคีย์ครั้งแรก (created_at) กับครั้งแก้ไขล่าสุด */
const SQL = `
ALTER TABLE bets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
UPDATE bets SET updated_at = created_at WHERE updated_at IS NULL;
ALTER TABLE bets ALTER COLUMN updated_at SET DEFAULT NOW();
ALTER TABLE bets ALTER COLUMN updated_at SET NOT NULL;
`;

async function migrate11() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 11 (bets.updated_at) completed');
  } catch (err) {
    console.error('Migration 11 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate11()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
