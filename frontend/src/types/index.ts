// ─── Shared Frontend Types ────────────────────────────────────────────────────

export type UserRole = 'admin' | 'operator' | 'viewer';
export type RoundStatus = 'open' | 'closed' | 'drawn' | 'archived';
export type BetType =
  | '2digit_top'
  | '2digit_bottom'
  | '3digit_top'
  | '3digit_tote'
  | '3digit_back'
  | '1digit_top'
  | '1digit_bottom';

export interface User {
  id: string;
  username: string;
  role: UserRole;
}

export interface Round {
  id: string;
  name: string;
  draw_date: string;
  status: RoundStatus;
  result_number: string | null;
  dealer_id: string | null;
  dealer_name: string | null;
  bet_count: number;
  total_revenue: number;
  created_at: string;
}

export interface Bet {
  id: string;
  round_id: string;
  number: string;
  bet_type: BetType;
  amount: number;
  payout_rate: number;
  customer_ref: string | null;
  customer_id:  string | null;
  created_by: string;
  created_by_name?: string;
  created_at: string;
  sheet_no: number;
  sort_order: number | null;
  /** นำเข้าเดียวกัน (กดรับไลน์ครั้งเดียว) — แยกแถวตามข้อความย่อย */
  import_batch_id?: string | null;
  segment_index?: number;
}

export interface Customer {
  id:                   string;
  name:                 string;
  phone:                string | null;
  note:                 string | null;
  commission_rate:      number;
  commission_rate_run:  number;
  pct_3top:             number;
  pct_3tote:            number;
  pct_3back:            number;
  pct_2top:             number;
  pct_2bottom:          number;
  pct_1top:             number;
  pct_1bottom:          number;
  rate_3top:            number | null;
  rate_3tote:           number | null;
  rate_3back:           number | null;
  rate_2top:            number | null;
  rate_2bottom:         number | null;
  rate_1top:            number | null;
  rate_1bottom:         number | null;
  is_active:            boolean;
  created_at:           string;
  updated_at:           string;
}

export interface Dealer {
  id:           string;
  name:         string;
  sender_name:  string | null;
  pct_3top:     number;
  pct_3tote:    number;
  pct_3back:    number;
  pct_2top:     number;
  pct_2bottom:  number;
  pct_1top:     number;
  pct_1bottom:  number;
  rate_3top:    number | null;
  rate_3tote:   number | null;
  rate_3back:   number | null;
  rate_2top:    number | null;
  rate_2bottom: number | null;
  rate_1top:    number | null;
  rate_1bottom: number | null;
  keep_net_pct: number;
  is_active:    boolean;
  created_at:   string;
  updated_at:   string;
}

export interface NumberExposure {
  number: string;
  bet_type: BetType;
  total_bet: number;
  payout_rate: number;
  gross_liability: number;
  net_pl: number;
}

export interface RiskReport {
  round_id: string;
  total_revenue: number;
  max_loss: number;
  max_profit: number;
  risk_percent: number;
  expected_pl: number;
  exposures: NumberExposure[];
  generated_at: string;
}

export interface CutEntry {
  number: string;
  bet_type: BetType;
  cut_amount: number;
  dealer_rate: number;
  before_risk: number;
  after_risk: number;
  hedge_cost: number;
  hedge_gain: number;
}

export interface CutSimulation {
  strategy: 'greedy' | 'min_cost' | 'proportional';
  cuts: CutEntry[];
  total_cut_amount: number;
  total_hedge_cost: number;
  risk_before: number;
  risk_after: number;
  risk_reduction_percent: number;
  profit_scenarios: { label: string; pl: number }[];
}

export interface NumberLimit {
  id: string;
  round_id: string;
  number: string;
  bet_type: BetType;
  entity_type: 'all' | 'customer' | 'dealer';
  entity_id: string | null;
  max_amount: number | null;
  custom_payout: number | null;
  payout_pct: number;
  is_blocked: boolean;
}

export interface DashboardStats {
  round_stats: { status: string; count: number }[];
  active_bets: { total_bets: number; total_revenue: number };
  recent_rounds: Round[];
}

export type DealerRates = Record<BetType, number>;

export const DEFAULT_PAYOUT_RATES: Record<BetType, number> = {
  '2digit_top':     70,
  '2digit_bottom':  70,
  '3digit_top':    500,
  '3digit_tote':   100,
  '3digit_back':   100,
  '1digit_top':    3.0,
  '1digit_bottom': 4.0,
};

export const DEFAULT_DEALER_RATES: DealerRates = {
  '2digit_top':     85,
  '2digit_bottom':  60,
  '3digit_top':    650,
  '3digit_tote':   110,
  '3digit_back':   140,
  '1digit_top':    3.0,
  '1digit_bottom': 4.0,
};

export const BET_TYPE_LABELS: Record<BetType, string> = {
  '2digit_top':    '2 ตัวบน',
  '2digit_bottom': '2 ตัวล่าง',
  '3digit_top':    '3 ตัวบน',
  '3digit_tote':   '3 ตัวโต็ด',
  '3digit_back':   '3 ตัวล่าง',
  '1digit_top':    'วิ่งบน',
  '1digit_bottom': 'วิ่งล่าง',
};

export function getRiskLevel(riskPercent: number): 'low' | 'medium' | 'high' | 'critical' {
  if (riskPercent < 30)  return 'low';
  if (riskPercent < 60)  return 'medium';
  if (riskPercent < 100) return 'high';
  return 'critical';
}

// ─── Range Simulation ─────────────────────────────────────────────────────────

export interface RangeSimRow {
  row: number;
  threshold_pct: number;
  threshold: number;
  count_fully_kept: number;
  total_kept: number;
  max_gain: number;
  min_gain: number | null;
  max_loss: number | null;
  min_loss: number | null;
  avg_gain: number | null;
  avg_loss: number | null;
  pct_win: number;
  pct_lose: number;
}

export interface SendBatch {
  id: string;
  round_id: string;
  bet_type: BetType;
  threshold: number;
  items: { number: string; amount: number }[];
  total: number;
  dealer_id: string | null;
  dealer_name: string | null;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

export interface RangeSimResponse {
  rows: RangeSimRow[];
  /** ผลได้เสียที่ยอดเก็บตัวละ = active_threshold (ถ้าส่งใน request) */
  at_threshold?: RangeSimRow | null;
  /** ขอบเขตที่ใช้คำนวณ (แผ่นโพย / ลูกค้า) */
  cut_scope?: { sheet_no: number | null; customer_id: string | null };
  bet_type: BetType;
  total_revenue: number;
  max_single_bet: number;
  min_single_bet?: number;
  unique_numbers: number;
  distribution: { number: string; total: number; is_blocked?: boolean; custom_payout?: number | null }[];
  dealer_params?: {
    upper_rate: number;
    effective_rate?: number;
    commission_pct?: number;
    dealer_pct?: number;
    customer_pct?: number;
    net_comm_pct?: number;
    keep_net_pct: number;
  };
}
