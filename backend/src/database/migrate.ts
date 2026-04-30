import { pool } from '../config/database';

/** สคีมาเริ่มต้น (โปรเจกต์เก่า) */
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

/**
 * ส่วนต่อจาก migrate2–8 + ตาราง customers — deploy รันแค่ไฟล์นี้เดียว
 * (import backup / แอปจริงต้องใช้คอลัมน์เหล่านี้)
 */
const SQL_EXTENSIONS = `
-- ─── Customers (ต้องมีก่อน FK จาก bets.customer_id) ───────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name                  VARCHAR(100) NOT NULL,
  phone                 VARCHAR(20),
  note                  VARCHAR(500),
  commission_rate       NUMERIC(5,2) NOT NULL DEFAULT 0,
  commission_rate_run   NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_3top              NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_3tote             NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_3back             NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_2top              NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_2bottom           NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_1top              NUMERIC(5,2) NOT NULL DEFAULT 0,
  pct_1bottom           NUMERIC(5,2) NOT NULL DEFAULT 0,
  rate_3top             NUMERIC(10,2),
  rate_3tote            NUMERIC(10,2),
  rate_3back            NUMERIC(10,2),
  rate_2top             NUMERIC(10,2),
  rate_2bottom          NUMERIC(10,2),
  rate_1top             NUMERIC(10,4),
  rate_1bottom          NUMERIC(10,4),
  is_active             BOOLEAN      NOT NULL DEFAULT true,
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- migrate2: ประเภทโพย + dealers + customer_id
ALTER TABLE bets DROP CONSTRAINT IF EXISTS bets_bet_type_check;
ALTER TABLE bets ADD CONSTRAINT bets_bet_type_check
  CHECK (bet_type IN (
    '2digit_top','2digit_bottom',
    '3digit_top','3digit_tote','3digit_back',
    '1digit_top','1digit_bottom'
  ));

ALTER TABLE bets ADD COLUMN IF NOT EXISTS customer_id UUID REFERENCES customers(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS dealers (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100)  NOT NULL,
  sender_name   VARCHAR(100),
  pct_3top      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_3tote     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_3back     NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_2top      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_2bottom   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_1top      NUMERIC(5,2)  NOT NULL DEFAULT 0,
  pct_1bottom   NUMERIC(5,2)  NOT NULL DEFAULT 0,
  rate_3top     NUMERIC(10,2),
  rate_3tote    NUMERIC(10,2),
  rate_3back    NUMERIC(10,2),
  rate_2top     NUMERIC(10,2),
  rate_2bottom  NUMERIC(10,2),
  rate_1top     NUMERIC(10,4),
  rate_1bottom  NUMERIC(10,4),
  keep_net_pct  NUMERIC(5,2)  NOT NULL DEFAULT 100,
  is_active     BOOLEAN       NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- ฐานเก่าที่สร้าง dealers ก่อนมี keep_net_pct
ALTER TABLE dealers ADD COLUMN IF NOT EXISTS keep_net_pct NUMERIC(5,2) NOT NULL DEFAULT 100;

ALTER TABLE rounds ADD COLUMN IF NOT EXISTS dealer_id UUID REFERENCES dealers(id) ON DELETE SET NULL;
ALTER TABLE rounds ADD COLUMN IF NOT EXISTS result_data jsonb;

-- migrate4: archived + send_batches
ALTER TABLE rounds DROP CONSTRAINT IF EXISTS rounds_status_check;
ALTER TABLE rounds
  ADD CONSTRAINT rounds_status_check
  CHECK (status IN ('open', 'closed', 'drawn', 'archived'));

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

-- migrate5 / 6: เติมคอลัมน์ลูกค้า (ถ้าสร้างตารางเก่าไม่ครบ)
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS commission_rate_run NUMERIC(5,2) NOT NULL DEFAULT 0;
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS pct_3top     NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_3tote    NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_3back    NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_2top     NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_2bottom  NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_1top     NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pct_1bottom  NUMERIC(5,2) NOT NULL DEFAULT 0;

UPDATE customers SET
  pct_3top    = commission_rate,
  pct_3tote   = commission_rate,
  pct_3back   = commission_rate,
  pct_2top    = commission_rate,
  pct_2bottom = commission_rate,
  pct_1top    = commission_rate_run,
  pct_1bottom = commission_rate_run
WHERE pct_3top = 0 AND commission_rate IS NOT NULL;

-- migrate7: number_limits entity
ALTER TABLE number_limits
  ADD COLUMN IF NOT EXISTS entity_type  VARCHAR(10)  NOT NULL DEFAULT 'all',
  ADD COLUMN IF NOT EXISTS entity_id    UUID,
  ADD COLUMN IF NOT EXISTS payout_pct   NUMERIC(5,2) NOT NULL DEFAULT 100;

ALTER TABLE number_limits
  DROP CONSTRAINT IF EXISTS number_limits_round_id_number_bet_type_key;

CREATE UNIQUE INDEX IF NOT EXISTS nl_unique_all
  ON number_limits (round_id, number, bet_type)
  WHERE entity_type = 'all';

CREATE UNIQUE INDEX IF NOT EXISTS nl_unique_entity
  ON number_limits (round_id, number, bet_type, entity_id)
  WHERE entity_type != 'all';

-- migrate8 + โพย import
ALTER TABLE bets ADD COLUMN IF NOT EXISTS sheet_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bets ADD COLUMN IF NOT EXISTS sort_order FLOAT;
UPDATE bets SET sort_order = EXTRACT(EPOCH FROM created_at) * 1000
  WHERE sort_order IS NULL;
CREATE INDEX IF NOT EXISTS idx_bets_sort_order ON bets (round_id, sort_order);
`;

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    console.log('Running base schema...');
    await client.query(SQL);
    console.log('Running extensions (migrate 2–8 + customers)...');
    await client.query(SQL_EXTENSIONS);
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
