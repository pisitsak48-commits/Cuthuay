import { pool } from '../config/database';

// Migration 3: Add result_data jsonb to rounds for full lottery result storage
const SQL = `
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS result_data jsonb;
`;

async function migrate3() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 3 complete: result_data column added to rounds');
  } catch (err) {
    console.error('Migration 3 failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate3();
