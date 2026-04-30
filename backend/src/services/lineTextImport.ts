import { query, withTransaction } from '../config/database';
import { randomUUID } from 'node:crypto';
import { parseLineBetsTextWithSegments } from '../lib/betParser';
import { BetRow, BetType, DEFAULT_PAYOUT_RATES } from '../models/types';
import { broadcast } from '../websocket/handler';

export type LineIntegrationSettingsRow = {
  singleton: number;
  webhook_enabled: boolean;
  auto_import_enabled: boolean;
  target_round_id: string | null;
  customer_id: string | null;
  sheet_no: number;
  allowed_group_ids: string[];
  actor_user_id: string | null;
  updated_at: Date;
};

async function getRoundPayoutRates(roundId: string): Promise<Record<BetType, number>> {
  const res = await query(
    `SELECT d.rate_2top, d.rate_2bottom, d.rate_3top, d.rate_3tote,
            d.rate_3back, d.rate_1top, d.rate_1bottom
     FROM rounds r JOIN dealers d ON r.dealer_id = d.id
     WHERE r.id = $1`,
    [roundId],
  );
  const d = res.rows[0] as Record<string, unknown> | undefined;
  if (!d) return { ...DEFAULT_PAYOUT_RATES };
  return {
    '2digit_top':    Number(d.rate_2top    ?? DEFAULT_PAYOUT_RATES['2digit_top']),
    '2digit_bottom': Number(d.rate_2bottom ?? DEFAULT_PAYOUT_RATES['2digit_bottom']),
    '3digit_top':    Number(d.rate_3top    ?? DEFAULT_PAYOUT_RATES['3digit_top']),
    '3digit_tote':   Number(d.rate_3tote   ?? DEFAULT_PAYOUT_RATES['3digit_tote']),
    '3digit_back':   Number(d.rate_3back   ?? DEFAULT_PAYOUT_RATES['3digit_back']),
    '1digit_top':    Number(d.rate_1top    ?? DEFAULT_PAYOUT_RATES['1digit_top']),
    '1digit_bottom': Number(d.rate_1bottom ?? DEFAULT_PAYOUT_RATES['1digit_bottom']),
  };
}

type CustomerRates = {
  rate_3top: number | null;
  rate_3tote: number | null;
  rate_3back: number | null;
  rate_2top: number | null;
  rate_2bottom: number | null;
  rate_1top: number | null;
  rate_1bottom: number | null;
};

function payoutForBetType(
  betType: BetType,
  roundRates: Record<BetType, number>,
  customer: CustomerRates | null,
): number {
  const map: Record<BetType, keyof CustomerRates> = {
    '3digit_top':    'rate_3top',
    '3digit_tote':   'rate_3tote',
    '3digit_back':   'rate_3back',
    '2digit_top':    'rate_2top',
    '2digit_bottom': 'rate_2bottom',
    '1digit_top':    'rate_1top',
    '1digit_bottom': 'rate_1bottom',
  };
  const key = map[betType];
  const base = roundRates[betType];
  if (!customer || !key) return base;
  const raw = customer[key];
  const custom = raw != null ? Number(raw) : NaN;
  if (!isNaN(custom) && custom > 0) return custom;
  return base;
}

function validateNumberType(number: string, bet_type: BetType): boolean {
  const len = number.length;
  if (bet_type.startsWith('2digit') && len !== 2) return false;
  if (bet_type.startsWith('3digit') && len !== 3) return false;
  return true;
}

export async function loadLineSettings(): Promise<LineIntegrationSettingsRow> {
  const r = await query<LineIntegrationSettingsRow>(
    `SELECT singleton, webhook_enabled, auto_import_enabled, target_round_id, customer_id,
            sheet_no, allowed_group_ids, actor_user_id, updated_at
     FROM line_integration_settings WHERE singleton = 1`,
  );
  if (!r.rows[0]) {
    await query(`INSERT INTO line_integration_settings (singleton) VALUES (1) ON CONFLICT DO NOTHING`);
    const r2 = await query<LineIntegrationSettingsRow>(
      `SELECT singleton, webhook_enabled, auto_import_enabled, target_round_id, customer_id,
              sheet_no, allowed_group_ids, actor_user_id, updated_at
       FROM line_integration_settings WHERE singleton = 1`,
    );
    return r2.rows[0]!;
  }
  return r.rows[0]!;
}

async function resolveActorUserId(preferred: string | null): Promise<string | null> {
  if (preferred) {
    const ok = await query<{ id: string }>(
      `SELECT id FROM users WHERE id = $1 AND is_active = true AND role IN ('admin','operator')`,
      [preferred],
    );
    if (ok.rows[0]) return ok.rows[0].id;
  }
  const fb = await query<{ id: string }>(
    `SELECT id FROM users WHERE is_active = true AND role IN ('admin','operator')
     ORDER BY CASE role WHEN 'admin' THEN 0 ELSE 1 END, created_at ASC LIMIT 1`,
  );
  return fb.rows[0]?.id ?? null;
}

export type ProcessLineTextResult = {
  status: 'imported' | 'skipped' | 'no_bets' | 'error';
  inserted: number;
  detail?: string;
};

/** ดึงข้อความจากไลน์ → parse → bulk insert (ใช้เมื่อ auto_import เปิด) */
export async function processLineTextMessage(params: {
  text: string;
  groupId: string;
  userId: string;
  messageId?: string;
  settings: LineIntegrationSettingsRow;
}): Promise<ProcessLineTextResult> {
  const { text, groupId, userId, messageId, settings } = params;

  if (!settings.auto_import_enabled) {
    return { status: 'skipped', inserted: 0, detail: 'auto_import_disabled' };
  }

  if (!settings.target_round_id) {
    return { status: 'skipped', inserted: 0, detail: 'no_target_round' };
  }

  const allowed = settings.allowed_group_ids ?? [];
  if (allowed.length > 0 && groupId && !allowed.includes(groupId)) {
    return { status: 'skipped', inserted: 0, detail: 'group_not_allowed' };
  }

  const trimmed = text.trim();
  if (trimmed.length < 2 || !/[\d=]/.test(trimmed)) {
    return { status: 'skipped', inserted: 0, detail: 'not_bet_text' };
  }

  const actorUserId = await resolveActorUserId(settings.actor_user_id);
  if (!actorUserId) {
    return { status: 'error', inserted: 0, detail: 'no_actor_user' };
  }

  const { bets, parsedCount } = parseLineBetsTextWithSegments(trimmed);
  if (!bets.length || parsedCount === 0) {
    return { status: 'no_bets', inserted: 0, detail: `parsed=${parsedCount}` };
  }

  const importBatchId = randomUUID();

  const roundId = settings.target_round_id;
  const roundRates = await getRoundPayoutRates(roundId);

  let customer: CustomerRates | null = null;
  let customerRef: string | null = null;
  if (settings.customer_id) {
    const cr = await query<{ name: string } & CustomerRates>(
                     `SELECT name, rate_3top, rate_3tote, rate_3back, rate_2top, rate_2bottom, rate_1top, rate_1bottom
                      FROM customers WHERE id = $1 AND is_active = true`,
                     [settings.customer_id],
    );
    if (cr.rows[0]) {
      customer = cr.rows[0];
      customerRef = cr.rows[0].name;
    }
  }

  const insertErrors: string[] = [];
  let inserted = 0;

  await withTransaction(async (client) => {
    for (const b of bets) {
      if (!validateNumberType(b.number, b.bet_type)) {
        insertErrors.push(`${b.number}: wrong length for ${b.bet_type}`);
        continue;
      }
      const blockRes = await client.query(
        `SELECT id FROM number_limits
         WHERE round_id = $1 AND number = $2 AND bet_type = $3 AND is_blocked = true
           AND (entity_type = 'all'
                OR (entity_type = 'customer' AND entity_id = $4))`,
        [roundId, b.number, b.bet_type, settings.customer_id ?? null],
      );
      if (blockRes.rowCount && blockRes.rowCount > 0) {
        insertErrors.push(`เลข ${b.number} (${b.bet_type}) ปิดรับแล้ว`);
        continue;
      }

      const payoutRate = payoutForBetType(b.bet_type, roundRates, customer);

      const limitResult = await client.query(
        `SELECT max_amount FROM number_limits
         WHERE round_id = $1 AND number = $2 AND bet_type = $3 AND max_amount IS NOT NULL`,
        [roundId, b.number, b.bet_type],
      );
      const maxAmt = limitResult.rows[0] as { max_amount: string } | undefined;
      if (maxAmt?.max_amount) {
        const totalResult = await client.query<{ total: string }>(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM bets
           WHERE round_id = $1 AND number = $2 AND bet_type = $3`,
          [roundId, b.number, b.bet_type],
        );
        const currentTotal = parseFloat(totalResult.rows[0]?.total ?? '0');
        if (currentTotal + b.amount > parseFloat(maxAmt.max_amount)) {
          insertErrors.push(`เลข ${b.number} เกินเพดาน`);
          continue;
        }
      }

      await client.query<BetRow>(
        `INSERT INTO bets (round_id, number, bet_type, amount, payout_rate, customer_id, customer_ref, sheet_no, created_by, sort_order, import_batch_id, segment_index)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, EXTRACT(EPOCH FROM clock_timestamp()) * 1000, $10, COALESCE($11, 0))`,
        [
          roundId,
          b.number,
          b.bet_type,
          b.amount,
          payoutRate,
          settings.customer_id ?? null,
          customerRef,
          settings.sheet_no,
          actorUserId,
          importBatchId,
          b.segment_index ?? null,
        ],
      );
      inserted++;
    }
  });

  if (inserted > 0) {
    broadcast({ type: 'bets_bulk_added', data: { count: inserted, round_id: roundId } });
  }

  if (inserted === 0 && insertErrors.length > 0) {
    return { status: 'error', inserted: 0, detail: insertErrors.slice(0, 5).join(' · ') };
  }

  return {
    status: inserted > 0 ? 'imported' : 'no_bets',
    inserted,
    detail: insertErrors.length ? insertErrors.slice(0, 3).join(' · ') : undefined,
  };
}

export async function appendWebhookLog(row: {
  message_id: string | null;
  group_id: string | null;
  user_id: string | null;
  text_preview: string;
  status: string;
  inserted_count: number;
  error_detail: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO line_webhook_log (message_id, group_id, user_id, text_preview, status, inserted_count, error_detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      row.message_id,
      row.group_id,
      row.user_id,
      row.text_preview.slice(0, 2000),
      row.status,
      row.inserted_count,
      row.error_detail,
    ],
  );
}
