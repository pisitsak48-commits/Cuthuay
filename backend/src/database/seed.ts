import bcrypt from 'bcryptjs';
import { pool } from '../config/database';

async function seed(): Promise<void> {
  const client = await pool.connect();
  try {
    // Admin user
    const adminHash = await bcrypt.hash('admin1234', 12);
    await client.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ('admin', $1, 'admin')
       ON CONFLICT (username) DO NOTHING`,
      [adminHash],
    );

    // Operator user
    const opHash = await bcrypt.hash('operator1234', 12);
    await client.query(
      `INSERT INTO users (username, password_hash, role)
       VALUES ('operator', $1, 'operator')
       ON CONFLICT (username) DO NOTHING`,
      [opHash],
    );

    // Sample open round
    const roundResult = await client.query(
      `INSERT INTO rounds (name, draw_date, status, created_by)
       SELECT 'งวด 16/04/2026', '2026-04-16', 'open', id
       FROM users WHERE username = 'admin'
       ON CONFLICT DO NOTHING
       RETURNING id`,
    );

    if (roundResult.rows.length > 0) {
      const roundId = roundResult.rows[0].id;
      // Sample bets
      const sampleBets = [
        { number: '25', type: '2digit_top',    amount: 5000,  rate: 70  },
        { number: '25', type: '2digit_bottom', amount: 3000,  rate: 70  },
        { number: '78', type: '2digit_top',    amount: 8000,  rate: 70  },
        { number: '99', type: '2digit_top',    amount: 12000, rate: 70  },
        { number: '123', type: '3digit_top',   amount: 2000,  rate: 500 },
        { number: '456', type: '3digit_top',   amount: 1500,  rate: 500 },
        { number: '789', type: '3digit_top',   amount: 3000,  rate: 500 },
        { number: '55', type: '2digit_top',    amount: 7500,  rate: 70  },
        { number: '00', type: '2digit_top',    amount: 6000,  rate: 70  },
        { number: '11', type: '2digit_top',    amount: 4500,  rate: 70  },
      ];

      const adminId = (
        await client.query(`SELECT id FROM users WHERE username='admin'`)
      ).rows[0]?.id;

      for (const bet of sampleBets) {
        await client.query(
          `INSERT INTO bets (round_id, number, bet_type, amount, payout_rate, created_by)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [roundId, bet.number, bet.type, bet.amount, bet.rate, adminId],
        );
      }
    }

    console.log('✅ Seed completed');
    console.log('   Admin:    admin / admin1234');
    console.log('   Operator: operator / operator1234');
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
