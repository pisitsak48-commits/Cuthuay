import { Pool, PoolClient, types } from 'pg';
import { env } from './env';

// Parse NUMERIC / DECIMAL (OID 1700) as float instead of string
types.setTypeParser(1700, (val: string) => parseFloat(val));
// Return timestamps as raw strings to preserve microsecond precision
types.setTypeParser(1114, (val: string) => val); // timestamp
types.setTypeParser(1184, (val: string) => val); // timestamptz

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error:', err);
});

/**
 * Execute a query with automatic connection management.
 */
export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number | null }> {
  const start = Date.now();
  const result = await pool.query<T & Record<string, unknown>>(text, params);
  if (env.NODE_ENV === 'development') {
    console.debug(`[SQL] ${text.slice(0, 80)} — ${Date.now() - start}ms`);
  }
  return result;
}

/**
 * Run multiple queries inside a transaction. Rolls back automatically on error.
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
