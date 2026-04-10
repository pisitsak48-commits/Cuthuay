import { pool } from '../config/database';

const SQL = `
-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  username      VARCHAR(50)  UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role          VARCHAR(20)  NOT NULL DEFAULT 'operator'
                             CHECK (role IN ('admin', 'operator', 'viewer')),
  is_active     BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Rounds ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS rounds (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) NOT NULL,
  draw_date     DATE         NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'open'
                             CHECK (status IN ('open', 'closed', 'drawn')),
  result_number VARCHAR(10),
  created_by    UUID         REFERENCES users(id),
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- ─── Bets ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bets (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID           NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  number       VARCHAR(10)    NOT NULL,
  bet_type     VARCHAR(25)    NOT NULL
               CHECK (bet_type IN ('2digit_top','2digit_bottom','3digit_top','3digit_front','3digit_back')),
  amount       NUMERIC(14,2)  NOT NULL CHECK (amount > 0),
  payout_rate  NUMERIC(8,2)   NOT NULL CHECK (payout_rate > 0),
  customer_ref VARCHAR(100),
  created_by   UUID           REFERENCES users(id),
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bets_round_id    ON bets (round_id);
CREATE INDEX IF NOT EXISTS idx_bets_number_type ON bets (round_id, bet_type, number);

-- ─── Number Limits ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS number_limits (
  id             UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id       UUID           NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  number         VARCHAR(10)    NOT NULL,
  bet_type       VARCHAR(25)    NOT NULL,
  max_amount     NUMERIC(14,2),
  custom_payout  NUMERIC(8,2),
  is_blocked     BOOLEAN        NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
  UNIQUE (round_id, number, bet_type)
);

-- ─── Cut Plans ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cut_plans (
  id           UUID           PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id     UUID           NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
  cuts         JSONB          NOT NULL,
  total_cost   NUMERIC(14,2)  NOT NULL,
  risk_limit   NUMERIC(14,2)  NOT NULL,
  dealer_rates JSONB          NOT NULL,
  created_by   UUID           REFERENCES users(id),
  created_at   TIMESTAMPTZ    NOT NULL DEFAULT NOW()
);

-- ─── Audit Log ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id         BIGSERIAL   PRIMARY KEY,
  user_id    UUID        REFERENCES users(id),
  action     VARCHAR(100) NOT NULL,
  details    JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_log (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log (created_at DESC);
`;

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('Running migrations...');
    await client.query(SQL);
    console.log('✅ Migrations completed');
  } finally {
    client.release();
    await pool.end();
  }
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
