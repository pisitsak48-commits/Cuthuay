// ─── Domain Types ────────────────────────────────────────────────────────────

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

// ─── Database Row Types ───────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  username: string;
  password_hash: string;
  role: UserRole;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RoundRow {
  id: string;
  name: string;
  draw_date: Date;
  status: RoundStatus;
  result_number: string | null;
  dealer_id: string | null;
  dealer_name?: string | null;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface BetRow {
  id: string;
  round_id: string;
  number: string;
  bet_type: BetType;
  amount: number;
  payout_rate: number;
  customer_ref: string | null;
  created_by: string;
  created_at: Date;
}

export interface NumberLimitRow {
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
  created_at: Date;
}

export interface CutPlanRow {
  id: string;
  round_id: string;
  cuts: CutEntry[];
  total_cost: number;
  risk_limit: number;
  dealer_rates: DealerRates;
  created_by: string;
  created_at: Date;
}

// ─── Business Logic Types ─────────────────────────────────────────────────────

export interface NumberExposure {
  number: string;
  bet_type: BetType;
  total_bet: number;
  payout_rate: number;
  gross_liability: number; // total_bet * payout_rate
  net_pl: number;          // total_revenue - gross_liability (from bookmaker POV)
}

export interface RiskReport {
  round_id: string;
  total_revenue: number;
  max_loss: number;         // worst-case loss (positive = loss)
  max_profit: number;       // best-case profit if no number wins
  risk_percent: number;     // max_loss / total_revenue * 100
  expected_pl: number;      // probability-weighted P&L (uniform assumption)
  exposures: NumberExposure[];
  generated_at: Date;
}

export interface CutEntry {
  number: string;
  bet_type: BetType;
  cut_amount: number;        // baht sent to dealer
  dealer_rate: number;
  before_risk: number;       // loss before cut (positive)
  after_risk: number;        // loss after cut (positive, <= risk_limit)
  hedge_cost: number;        // premium paid = cut_amount (cost of hedging)
  hedge_gain: number;        // gain when this number wins = cut_amount * dealer_rate
}

export interface CutSimulation {
  strategy: 'greedy' | 'min_cost' | 'proportional';
  cuts: CutEntry[];
  total_cut_amount: number;
  total_hedge_cost: number;  // total premium paid upfront to dealer
  risk_before: number;       // max loss before any cuts
  risk_after: number;        // max loss after all cuts
  risk_reduction_percent: number;
  profit_scenarios: ProfitScenario[];
}

export interface ProfitScenario {
  label: string;
  pl: number;
}

export type DealerRates = Record<BetType, number>;

// ─── JWT Payload ──────────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;     // user id
  username: string;
  role: UserRole;
  iat: number;
  exp: number;
}

// ─── Default Payout Rates ────────────────────────────────────────────────────

export const DEFAULT_PAYOUT_RATES: Record<BetType, number> = {
  '2digit_top':     90,
  '2digit_bottom':  65,
  '3digit_top':    700,
  '3digit_tote':   120,
  '3digit_back':   150,
  '1digit_top':    3.2,
  '1digit_bottom': 4.2,
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
