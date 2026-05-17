import { pool } from '../config/database';

const SQL = `
CREATE TABLE IF NOT EXISTS line_integration_settings (
  singleton         SMALLINT PRIMARY KEY DEFAULT 1 CHECK (singleton = 1),
  webhook_enabled   BOOLEAN NOT NULL DEFAULT FALSE,
  auto_import_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  target_round_id   UUID REFERENCES rounds(id) ON DELETE SET NULL,
  customer_id       UUID REFERENCES customers(id) ON DELETE SET NULL,
  sheet_no          INTEGER NOT NULL DEFAULT 1 CHECK (sheet_no >= 1 AND sheet_no <= 999),
  allowed_group_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  actor_user_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO line_integration_settings (singleton) VALUES (1)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS line_webhook_log (
  id             BIGSERIAL PRIMARY KEY,
  received_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  message_id     TEXT,
  group_id       TEXT,
  user_id        TEXT,
  text_preview   TEXT,
  status         VARCHAR(24) NOT NULL,
  inserted_count INTEGER NOT NULL DEFAULT 0,
  error_detail   TEXT
);

CREATE INDEX IF NOT EXISTS idx_line_webhook_log_received ON line_webhook_log (received_at DESC);
`;

async function migrate9() {
  const client = await pool.connect();
  try {
    await client.query(SQL);
    console.log('Migration 9 (LINE integration) completed successfully');
  } catch (err) {
    console.error('Migration 9 failed:', err);
    throw err;
  } finally {
    client.release();
  }
}

migrate9()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
