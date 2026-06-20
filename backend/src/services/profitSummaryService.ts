import { query } from '../config/database';
import { moneyToNumber } from '../lib/money';

type CustomerPctRow = {
  pct_3top: string; pct_3tote: string; pct_3back: string;
  pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
};

function formatCustomerCommissionDisplay(c: CustomerPctRow | undefined): string {
  if (!c) return '—';
  const keys = ['pct_3top', 'pct_3tote', 'pct_3back', 'pct_2top', 'pct_2bottom', 'pct_1top', 'pct_1bottom'] as const;
  const set = new Set<string>();
  for (const k of keys) {
    const v = moneyToNumber(c[k]);
    if (Number.isNaN(v)) continue;
    const r = Math.round(v * 100) / 100;
    set.add(String(r));
  }
  if (!set.size) return '—';
  return [...set].map((x) => x + '%').join(' · ');
}

export type ProfitSummaryPayload = {
  round: { id: string; name: string; draw_date: string; result_data: Record<string, unknown> | null };
  profit: number;
  sell: { total: number; pct: number; remaining: number; payout: number; net: number };
  send: { total: number; pct: number; remaining: number; payout: number; net: number };
  unsold_count: number;
  unsold_by_type: Record<string, number>;
  min_bet_per_number: number;
  max_bet_per_number: number;
  customers: unknown[];
  dealers: unknown[];
  by_type_sell: Record<string, { sold: number; pct: number; payout: number; net: number }>;
  limits: unknown[];
};

export async function buildProfitSummary(roundId: string): Promise<ProfitSummaryPayload | null> {
    // Fetch round + result_data
    const roundRes = await query<{
      id: string; name: string; draw_date: string; result_number: string | null;
      result_data: unknown; dealer_id: string | null;
    }>('SELECT id, name, draw_date, result_number, result_data, dealer_id FROM rounds WHERE id = $1', [roundId]);
    const round = roundRes.rows[0];
    if (!round) return null;

    // Parse result data
    const rd = (typeof round.result_data === 'string'
      ? JSON.parse(round.result_data) : round.result_data) as Record<string, unknown> | null;

    let winSets: Record<string, Set<string>> = {};
    if (rd) {
      const str = (v: unknown) => (Array.isArray(v) ? v : [v]).map(String);
      winSets = {
        '3digit_top':    new Set(str(rd.prize_3top)),
        '3digit_tote':   new Set(str(rd.tote_numbers)),
        '3digit_back':   new Set(str(rd.prize_3bottom)),
        '2digit_top':    new Set(str(rd.prize_2top)),
        '2digit_bottom': new Set(str(rd.prize_2bottom)),
        '1digit_top':    new Set(str(rd.prize_1top)),
        '1digit_bottom': new Set(str(rd.prize_1bottom)),
      };
    }

    // Fetch number limits for this round (for payout override calculation)
    const limitsRes = await query<{
      number: string; bet_type: string; entity_type: string; entity_id: string | null;
      custom_payout: string | null; payout_pct: string; is_blocked: boolean;
    }>(
      `SELECT number, bet_type, entity_type, entity_id, custom_payout, payout_pct, is_blocked
       FROM number_limits WHERE round_id = $1`,
      [roundId],
    );
    // Build a lookup: key = `number||bet_type` → array of limits
    const limitsMap = new Map<string, typeof limitsRes.rows>();
    for (const lim of limitsRes.rows) {
      const k = `${lim.number}||${lim.bet_type}`;
      if (!limitsMap.has(k)) limitsMap.set(k, []);
      limitsMap.get(k)!.push(lim);
    }
    /** Get effective payout rate for a bet, considering number limits */
    const getEffectiveRateWithLimits = (
      cid: string | null, betType: string, number: string, baseRate: number,
    ): number => {
      const k = `${number}||${betType}`;
      const lims = limitsMap.get(k);
      if (!lims || !lims.length) return baseRate;
      // Priority: entity-specific > 'all'
      const exact = lims.find(l => l.entity_type === 'customer' && l.entity_id === cid);
      const global = lims.find(l => l.entity_type === 'all');
      const chosen = exact ?? global;
      if (!chosen) return baseRate;
      if (chosen.is_blocked) return 0; // blocked = 0 payout
      if (chosen.custom_payout) return moneyToNumber(chosen.custom_payout);
      const pct = moneyToNumber(chosen.payout_pct);
      if (pct > 0 && pct !== 100) return baseRate * pct / 100;
      return baseRate;
    };

    // Fetch all bets
    const betsRes = await query<{      id: string; number: string; bet_type: string;
      amount: string; payout_rate: string;
      customer_id: string | null; customer_ref: string | null;
      sheet_no: number;
    }>(
      `SELECT b.id, b.number, b.bet_type, b.amount, b.payout_rate,
              b.customer_id, b.customer_ref, b.sheet_no
       FROM bets b WHERE b.round_id = $1`, [roundId],
    );
    const bets = betsRes.rows;

    // Fetch customers (with their configured payout rates)
    const custRes = await query<{
      id: string; name: string;
      pct_3top: string; pct_3tote: string; pct_3back: string;
      pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
      rate_3top: string | null; rate_3tote: string | null; rate_3back: string | null;
      rate_2top: string | null; rate_2bottom: string | null;
      rate_1top: string | null; rate_1bottom: string | null;
    }>(
      `SELECT DISTINCT c.id, c.name,
              c.pct_3top, c.pct_3tote, c.pct_3back, c.pct_2top, c.pct_2bottom, c.pct_1top, c.pct_1bottom,
              c.rate_3top, c.rate_3tote, c.rate_3back,
              c.rate_2top, c.rate_2bottom, c.rate_1top, c.rate_1bottom
       FROM customers c
       INNER JOIN bets b ON b.customer_id = c.id AND b.round_id = $1`, [roundId],
    );
    const custMap = new Map(custRes.rows.map(c => [c.id, c]));

    // Per-type pct map for customers
    const PCT_MAP: Record<string, string> = {
      '3digit_top': 'pct_3top', '3digit_tote': 'pct_3tote', '3digit_back': 'pct_3back',
      '2digit_top': 'pct_2top', '2digit_bottom': 'pct_2bottom',
      '1digit_top': 'pct_1top', '1digit_bottom': 'pct_1bottom',
    };
    const getCustCommRate = (cid: string, betType: string): number => {
      const c = custMap.get(cid);
      if (!c) return 0;
      const key = PCT_MAP[betType];
      return key ? moneyToNumber((c as unknown as Record<string, string>)[key]) : 0;
    };

    // Helper: get effective payout rate for a customer + bet_type
    // Uses the customer's configured rate first, falls back to the stored bet rate
    const getEffectiveRate = (
      cid: string, betType: string, storedRate: string,
    ): number => {
      const c = custMap.get(cid);
      if (c) {
        const rateMap: Record<string, string | null> = {
          '3digit_top':    c.rate_3top,
          '3digit_tote':   c.rate_3tote,
          '3digit_back':   c.rate_3back,
          '2digit_top':    c.rate_2top,
          '2digit_bottom': c.rate_2bottom,
          '1digit_top':    c.rate_1top,
          '1digit_bottom': c.rate_1bottom,
        };
        const r = rateMap[betType];
        if (r != null) {
          const v = moneyToNumber(r);
          if (v > 0) return v;
        }
      }
      return moneyToNumber(storedRate);
    };

    // Determine winning bets
    const isWin = (bet_type: string, number: string): boolean =>
      winSets[bet_type]?.has(number) ?? false;

    // Per-customer aggregation
    interface CustSummary {
      customer_id: string; name: string;
      commission_display: string;
      sold: number; pct_sold: number; remaining_sold: number;
      payout: number; net: number;
      by_type: Record<string, { sold: number; pct: number; payout: number }>;
      by_sheet: Record<number, { sold: number; pct: number; payout: number }>;
      /** แยกยอดตามแผ่น × ประเภท (คีย์แผ่นเป็น string จาก JSON) */
      by_sheet_by_type: Record<string, Record<string, { sold: number; pct: number; payout: number }>>;
    }
    const custSummaryMap = new Map<string, CustSummary>();

    const BET_TYPES = ['3digit_top','3digit_tote','3digit_back','2digit_top','2digit_bottom','1digit_top','1digit_bottom'];

    for (const bet of bets) {
      const cid = bet.customer_id ?? '__none__';
      const c = custMap.get(cid);
      const commRate = getCustCommRate(cid, bet.bet_type);
      const name = c?.name ?? (bet.customer_ref ?? 'ไม่ระบุ');
      if (!custSummaryMap.has(cid)) {
        const by_type: Record<string, { sold: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { by_type[t] = { sold: 0, pct: 0, payout: 0 }; });
        custSummaryMap.set(cid, {
          customer_id: cid, name,
          commission_display: formatCustomerCommissionDisplay(c as CustomerPctRow | undefined),
          sold: 0, pct_sold: 0, remaining_sold: 0, payout: 0, net: 0,
          by_type, by_sheet: {}, by_sheet_by_type: {},
        });
      }
      const cs = custSummaryMap.get(cid)!;
      // Round to สตางค์ before accumulating to prevent floating point drift across many bets
      const amt      = Math.round(moneyToNumber(bet.amount) * 100) / 100;
      const pctAmt   = Math.round(amt * commRate) / 100;
      const won = isWin(bet.bet_type, bet.number);
      const baseRate = getEffectiveRate(cid, bet.bet_type, bet.payout_rate);
      const effectiveRate = getEffectiveRateWithLimits(bet.customer_id, bet.bet_type, bet.number, baseRate);
      const payoutAmt = won ? Math.round(amt * effectiveRate * 100) / 100 : 0;

      cs.sold       += amt;
      cs.pct_sold   += pctAmt;
      cs.payout     += payoutAmt;

      if (cs.by_type[bet.bet_type]) {
        cs.by_type[bet.bet_type].sold   += amt;
        cs.by_type[bet.bet_type].pct    += pctAmt;
        cs.by_type[bet.bet_type].payout += payoutAmt;
      }

      // By sheet
      const sn = bet.sheet_no ?? 1;
      if (!cs.by_sheet[sn]) cs.by_sheet[sn] = { sold: 0, pct: 0, payout: 0 };
      cs.by_sheet[sn].sold   += amt;
      cs.by_sheet[sn].pct    += pctAmt;
      cs.by_sheet[sn].payout += payoutAmt;

      const snKey = String(sn);
      if (!cs.by_sheet_by_type[snKey]) {
        const empty: Record<string, { sold: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { empty[t] = { sold: 0, pct: 0, payout: 0 }; });
        cs.by_sheet_by_type[snKey] = empty;
      }
      const sbt = cs.by_sheet_by_type[snKey];
      if (sbt[bet.bet_type]) {
        sbt[bet.bet_type].sold += amt;
        sbt[bet.bet_type].pct += pctAmt;
        sbt[bet.bet_type].payout += payoutAmt;
      }
    }

    // All summaries (including null-customer bets) for correct totals
    const allCustSummaries = Array.from(custSummaryMap.values()).map(cs => {
      cs.remaining_sold = cs.sold - cs.pct_sold;
      cs.net = cs.remaining_sold - cs.payout;
      return cs;
    });
    // Only linked customers shown in per-customer list
    const customers = allCustSummaries.filter(cs => cs.customer_id !== '__none__');

    // Totals — selling side (includes unlinked bets)
    const totalSold       = allCustSummaries.reduce((s, c) => s + c.sold, 0);
    const totalPctSold    = allCustSummaries.reduce((s, c) => s + c.pct_sold, 0);
    const totalRemSold    = totalSold - totalPctSold;
    const totalPayoutSold = allCustSummaries.reduce((s, c) => s + c.payout, 0);
    const totalNetSold    = totalRemSold - totalPayoutSold;

    // Per-type totals (selling side, includes unlinked bets)
    const byTypeSell: Record<string, { sold: number; pct: number; payout: number; net: number }> = {};
    BET_TYPES.forEach(t => { byTypeSell[t] = { sold: 0, pct: 0, payout: 0, net: 0 }; });
    for (const cs of allCustSummaries) {
      for (const t of BET_TYPES) {
        byTypeSell[t].sold   += cs.by_type[t]?.sold   ?? 0;
        byTypeSell[t].pct    += cs.by_type[t]?.pct    ?? 0;
        byTypeSell[t].payout += cs.by_type[t]?.payout ?? 0;
      }
    }
    for (const t of BET_TYPES) {
      byTypeSell[t].net = byTypeSell[t].sold - byTypeSell[t].pct - byTypeSell[t].payout;
    }

    // Dealer / cut side
    // Fetch both send_batches (confirmed sends) and cut_plans (fallback)
    const [sendBatchesRes, planRes] = await Promise.all([
      query<{
        id: string; bet_type: string; items: unknown; total: string;
        dealer_id: string | null; dealer_name: string | null;
      }>(
        `SELECT id, bet_type, items, total, dealer_id, dealer_name
         FROM send_batches WHERE round_id = $1 ORDER BY created_at ASC`,
        [roundId],
      ),
      query<{ cuts: unknown; dealer_rates: unknown }>(
        `SELECT cuts, dealer_rates FROM cut_plans WHERE round_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [roundId],
      ),
    ]);
    const plan = planRes.rows[0];
    const sendBatches = sendBatchesRes.rows;

    interface DealerSummary {
      dealer_id: string; name: string;
      sent: number; pct_sent: number; remaining_sent: number;
      payout: number; net: number;
      by_type: Record<string, { sent: number; pct: number; payout: number }>;
    }
    const dealerSummaries: DealerSummary[] = [];

    // ── Path A: use send_batches when they exist ──────────────────────────────
    if (sendBatches.length > 0) {
      // Collect unique dealer_ids from batches; fallback to round.dealer_id
      const batchDealerIds = new Set(
        sendBatches.map(b => b.dealer_id ?? round.dealer_id ?? 'unknown'),
      );

      // Fetch dealer rate rows for those ids
      const knownIds = [...batchDealerIds].filter(id => id !== 'unknown');
      const dealerRatesMap = new Map<string, {
        name: string;
        pct_3top: number; pct_3tote: number; pct_3back: number;
        pct_2top: number; pct_2bottom: number; pct_1top: number; pct_1bottom: number;
        rate_3top: number; rate_3tote: number; rate_3back: number;
        rate_2top: number; rate_2bottom: number; rate_1top: number; rate_1bottom: number;
      }>();
      if (knownIds.length > 0) {
        // Use parameterized query with ANY($1::uuid[]) — safe, no interpolation
        const drRes = await query<{
          id: string; name: string;
          pct_3top: string; pct_3tote: string; pct_3back: string;
          pct_2top: string; pct_2bottom: string; pct_1top: string; pct_1bottom: string;
          rate_3top: string | null; rate_3tote: string | null; rate_3back: string | null;
          rate_2top: string | null; rate_2bottom: string | null;
          rate_1top: string | null; rate_1bottom: string | null;
        }>(
          `SELECT id, name,
                  pct_3top, pct_3tote, pct_3back, pct_2top, pct_2bottom, pct_1top, pct_1bottom,
                  rate_3top, rate_3tote, rate_3back, rate_2top, rate_2bottom, rate_1top, rate_1bottom
           FROM dealers WHERE id = ANY($1::uuid[])`,
          [knownIds],
        );
        for (const dr of drRes.rows) {
          dealerRatesMap.set(dr.id, {
            name: dr.name,
            pct_3top:    Number(dr.pct_3top    ?? 0), pct_3tote:   Number(dr.pct_3tote   ?? 0),
            pct_3back:   Number(dr.pct_3back   ?? 0), pct_2top:    Number(dr.pct_2top    ?? 0),
            pct_2bottom: Number(dr.pct_2bottom ?? 0), pct_1top:    Number(dr.pct_1top    ?? 0),
            pct_1bottom: Number(dr.pct_1bottom ?? 0),
            rate_3top:    Number(dr.rate_3top    ?? 0), rate_3tote:  Number(dr.rate_3tote  ?? 0),
            rate_3back:   Number(dr.rate_3back   ?? 0), rate_2top:   Number(dr.rate_2top   ?? 0),
            rate_2bottom: Number(dr.rate_2bottom ?? 0), rate_1top:   Number(dr.rate_1top   ?? 0),
            rate_1bottom: Number(dr.rate_1bottom ?? 0),
          });
        }
      }

      for (const did of batchDealerIds) {
        const dr = dealerRatesMap.get(did);
        // Resolve display name: from DB rates, then from any batch's dealer_name, then fallback
        const batchWithName = sendBatches.find(b => (b.dealer_id ?? round.dealer_id ?? 'unknown') === did && b.dealer_name);
        const dealerName = dr?.name ?? batchWithName?.dealer_name ?? 'เจ้ามือ';

        const pctMap: Record<string, number> = {
          '3digit_top': dr?.pct_3top ?? 0, '3digit_tote': dr?.pct_3tote ?? 0,
          '3digit_back': dr?.pct_3back ?? 0, '2digit_top': dr?.pct_2top ?? 0,
          '2digit_bottom': dr?.pct_2bottom ?? 0, '1digit_top': dr?.pct_1top ?? 0,
          '1digit_bottom': dr?.pct_1bottom ?? 0,
        };
        const rateMap: Record<string, number> = {
          '3digit_top': dr?.rate_3top ?? 0, '3digit_tote': dr?.rate_3tote ?? 0,
          '3digit_back': dr?.rate_3back ?? 0, '2digit_top': dr?.rate_2top ?? 0,
          '2digit_bottom': dr?.rate_2bottom ?? 0, '1digit_top': dr?.rate_1top ?? 0,
          '1digit_bottom': dr?.rate_1bottom ?? 0,
        };

        const by_type: Record<string, { sent: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { by_type[t] = { sent: 0, pct: 0, payout: 0 }; });

        const batchesForDealer = sendBatches.filter(
          b => (b.dealer_id ?? round.dealer_id ?? 'unknown') === did,
        );

        for (const batch of batchesForDealer) {
          const items = (typeof batch.items === 'string'
            ? JSON.parse(batch.items) : batch.items) as Array<{ number: string; amount: number }>;
          for (const item of items) {
            const sentAmt    = item.amount ?? 0;
            const pctAmt     = sentAmt * (pctMap[batch.bet_type] ?? 0) / 100;
            const won        = isWin(batch.bet_type, item.number);
            const baseRate   = rateMap[batch.bet_type] ?? 0;
            const effRate    = getEffectiveRateWithLimits(null, batch.bet_type, item.number, baseRate);
            const payAmt     = won ? sentAmt * effRate : 0;

            if (by_type[batch.bet_type]) {
              by_type[batch.bet_type].sent   += sentAmt;
              by_type[batch.bet_type].pct    += pctAmt;
              by_type[batch.bet_type].payout += payAmt;
            }
          }
        }

        let sent = 0, pct_sent = 0, payout = 0;
        for (const t of BET_TYPES) {
          sent     += by_type[t].sent;
          pct_sent += by_type[t].pct;
          payout   += by_type[t].payout;
        }
        const remaining_sent = sent - pct_sent;
        dealerSummaries.push({
          dealer_id: did, name: dealerName,
          sent, pct_sent, remaining_sent,
          payout, net: payout - remaining_sent,
          by_type,
        });
      }
    }

    // ── Path B: fallback to cut_plans when no send_batches exist ─────────────
    if (sendBatches.length === 0 && plan) {
      const parsedCuts = (typeof plan.cuts === 'string' ? JSON.parse(plan.cuts) : plan.cuts) as Array<{
        number: string; bet_type: string; cut_amount: number; dealer_id?: string;
      }>;
      const parsedRates = (typeof plan.dealer_rates === 'string'
        ? JSON.parse(plan.dealer_rates) : plan.dealer_rates) as Record<string, {
          id: string; name: string;
          pct_3top?: number; pct_3tote?: number; pct_3back?: number;
          pct_2top?: number; pct_2bottom?: number; pct_1top?: number; pct_1bottom?: number;
          rate_3top?: number; rate_3tote?: number; rate_3back?: number;
          rate_2top?: number; rate_2bottom?: number; rate_1top?: number; rate_1bottom?: number;
        }>;

      // If no dealer_id on cuts, use round.dealer_id
      const dealerIds = new Set(parsedCuts.map(c => c.dealer_id ?? round.dealer_id ?? 'unknown'));

      for (const did of dealerIds) {
        const dr = parsedRates[did] ?? Object.values(parsedRates)[0];
        const dealerName = dr?.name ?? 'เจ้ามือ';

        const pctMap: Record<string, number> = {
          '3digit_top': dr?.pct_3top ?? 0, '3digit_tote': dr?.pct_3tote ?? 0,
          '3digit_back': dr?.pct_3back ?? 0, '2digit_top': dr?.pct_2top ?? 0,
          '2digit_bottom': dr?.pct_2bottom ?? 0, '1digit_top': dr?.pct_1top ?? 0,
          '1digit_bottom': dr?.pct_1bottom ?? 0,
        };
        const rateMap: Record<string, number> = {
          '3digit_top': dr?.rate_3top ?? 0, '3digit_tote': dr?.rate_3tote ?? 0,
          '3digit_back': dr?.rate_3back ?? 0, '2digit_top': dr?.rate_2top ?? 0,
          '2digit_bottom': dr?.rate_2bottom ?? 0, '1digit_top': dr?.rate_1top ?? 0,
          '1digit_bottom': dr?.rate_1bottom ?? 0,
        };

        const by_type: Record<string, { sent: number; pct: number; payout: number }> = {};
        BET_TYPES.forEach(t => { by_type[t] = { sent: 0, pct: 0, payout: 0 }; });

        const cutsForDealer = parsedCuts.filter(c =>
          c.dealer_id === did || (!c.dealer_id && (did === round.dealer_id || did === 'unknown')));

        for (const cut of cutsForDealer) {
          const sentAmt  = cut.cut_amount ?? 0;
          const pctAmt   = sentAmt * (pctMap[cut.bet_type] ?? 0) / 100;
          const won      = isWin(cut.bet_type, cut.number);
          const baseRate = rateMap[cut.bet_type] ?? 0;
          const effRate  = getEffectiveRateWithLimits(null, cut.bet_type, cut.number, baseRate);
          const payAmt   = won ? sentAmt * effRate : 0;

          if (by_type[cut.bet_type]) {
            by_type[cut.bet_type].sent   += sentAmt;
            by_type[cut.bet_type].pct    += pctAmt;
            by_type[cut.bet_type].payout += payAmt;
          }
        }

        let sent = 0, pct_sent = 0, payout = 0;
        for (const t of BET_TYPES) {
          sent    += by_type[t].sent;
          pct_sent += by_type[t].pct;
          payout  += by_type[t].payout;
        }
        const remaining_sent = sent - pct_sent;
        dealerSummaries.push({
          dealer_id: did, name: dealerName,
          sent, pct_sent, remaining_sent,
          payout, net: payout - remaining_sent,
          by_type,
        });
      }
    }

    const totalSent      = dealerSummaries.reduce((s, d) => s + d.sent, 0);
    const totalPctSent   = dealerSummaries.reduce((s, d) => s + d.pct_sent, 0);
    const totalRemSent   = totalSent - totalPctSent;
    const totalPaySent   = dealerSummaries.reduce((s, d) => s + d.payout, 0);
    const totalNetSent   = totalPaySent - totalRemSent;

    const profit = totalNetSold + totalNetSent;

    // ── Number-level stats ─────────────────────────────────────────────────
    const TOTAL_NUMS_BY_TYPE: Record<string, number> = {
      '3digit_top': 1000, '3digit_tote': 1000, '3digit_back': 1000,
      '2digit_top': 100,  '2digit_bottom': 100,
      '1digit_top': 10,   '1digit_bottom': 10,
    };
    const soldByType = new Map<string, Set<string>>();
    const perNumberAmt = new Map<string, number>();
    for (const bet of bets) {
      if (!soldByType.has(bet.bet_type)) soldByType.set(bet.bet_type, new Set());
      soldByType.get(bet.bet_type)!.add(bet.number);
      const k = `${bet.number}||${bet.bet_type}`;
      perNumberAmt.set(k, (perNumberAmt.get(k) ?? 0) + moneyToNumber(bet.amount));
    }
    // นับเฉพาะ bet_type ที่มีการแทงจริงในงวดนี้
    const unsold_by_type: Record<string, number> = {};
    let unsold_count = 0;
    for (const bt of [...soldByType.keys()]) {
      const u = (TOTAL_NUMS_BY_TYPE[bt] ?? 0) - (soldByType.get(bt)?.size ?? 0);
      unsold_by_type[bt] = u;
      unsold_count += u;
    }
    const numAmounts = [...perNumberAmt.values()];
    const min_bet_per_number = numAmounts.length > 0 ? Math.min(...numAmounts) : 0;
    const max_bet_per_number = numAmounts.length > 0 ? Math.max(...numAmounts) : 0;

    return {
      round: { id: round.id, name: round.name, draw_date: round.draw_date, result_data: rd },
      profit,
      sell: {
        total: totalSold, pct: totalPctSold, remaining: totalRemSold,
        payout: totalPayoutSold, net: totalNetSold,
      },
      send: {
        total: totalSent, pct: totalPctSent, remaining: totalRemSent,
        payout: totalPaySent, net: totalNetSent,
      },
      unsold_count,
      unsold_by_type,
      min_bet_per_number,
      max_bet_per_number,
      customers,
      dealers: dealerSummaries,
      by_type_sell: byTypeSell,
      limits: limitsRes.rows,
    };
}
