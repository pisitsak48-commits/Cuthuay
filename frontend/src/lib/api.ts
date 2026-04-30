import axios, { AxiosError } from 'axios';

/** ฝั่งเบราว์เซอร์ใช้ /api (rewrite → backend ใน Docker / dev) — ไม่พึ่ง NEXT_PUBLIC ตอน build */
function apiBaseUrl(): string {
  if (typeof window !== 'undefined') {
    return '/api';
  }
  const internal = process.env.BACKEND_INTERNAL_URL;
  if (internal) {
    return `${String(internal).replace(/\/$/, '')}/api`;
  }
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:4000/api';
}

export const api = axios.create({
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// baseURL ต่อ request — กันโหลดบน SSR แล้วค้าง localhost
api.interceptors.request.use((config) => {
  config.baseURL = apiBaseUrl();
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem('token');
    if (token) config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Auto-logout on 401
api.interceptors.response.use(
  (res) => res,
  (err: AxiosError) => {
    if (err.response?.status === 401 && typeof window !== 'undefined') {
      localStorage.removeItem('token');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  },
);

// ─── Auth ──────────────────────────────────────────────────────────────────────
export const authApi = {
  login: (username: string, password: string) =>
    api.post<{ token: string; user: { id: string; username: string; role: string } }>(
      '/auth/login', { username, password }),
  me: () => api.get('/auth/me'),
  setupStatus: () =>
    api.get<{ needs_first_user: boolean; user_count: number }>('/auth/setup-status'),
  bootstrap: (username: string, password: string) =>
    api.post<{ token: string; user: { id: string; username: string; role: string } }>(
      '/auth/bootstrap',
      { username, password },
    ),
  listUsers: () =>
    api.get<{ users: Array<{ id: string; username: string; role: string; is_active: boolean }> }>(
      '/auth/users',
    ),
};

// ─── Rounds ────────────────────────────────────────────────────────────────────

export type ImportPreviewRow =
  | {
      index: number;
      round_id: string;
      name: string;
      draw_date: string;
      status: 'new' | 'id_exists' | 'date_conflict' | 'invalid';
      message?: string;
    }
  | { index: number; status: 'invalid'; message: string };

export type ImportPreviewResponse =
  | {
      ok: true;
      bulk: true;
      rounds: ImportPreviewRow[];
      counts: { new: number; id_exists: number; date_conflict: number; invalid: number };
    }
  | {
      ok: true;
      bulk: false;
      round: {
        round_id: string;
        name: string;
        draw_date: string;
        status: 'new' | 'id_exists' | 'date_conflict' | 'invalid';
        message?: string;
      };
      counts: { new: number; id_exists: number; date_conflict: number; invalid: number };
    };

export const roundsApi = {
  list:         (status?: string) => api.get('/rounds', { params: status ? { status } : {} }),
  get:          (id: string)      => api.get(`/rounds/${id}`),
  create:       (data: { name: string; draw_date: string }) => api.post('/rounds', data),
  delete:       (id: string)      => api.delete(`/rounds/${id}`),
  updateStatus: (id: string, status: string, result_number?: string) =>
    api.patch(`/rounds/${id}/status`, { status, result_number }),
  setDealer:    (id: string, dealer_id: string | null) =>
    api.patch(`/rounds/${id}/dealer`, { dealer_id }),
  submitResult: (id: string, data: {
    result_prize_1st?: string;
    result_3top: string;
    result_2bottom: string;
    result_3bottom?: string[];
    result_3front?: string[];
  }) =>
    api.post(`/rounds/${id}/result`, data),
  getResult:    (id: string) => api.get(`/rounds/${id}/result`),
  resetResult:  (id: string) => api.post(`/rounds/${id}/reset-result`, {}),
  exportRound:  (id: string) => api.get(`/rounds/${id}/export`, { responseType: 'blob' }),
  /** ส่งออกหลายงวดเป็น JSON เดียว (รวมใน key `rounds`) */
  exportBulk:   (body: { round_ids?: string[]; include_archived?: boolean }) =>
    api.post('/rounds/export-bulk', body, { responseType: 'blob' }),
  importRound:  (data: Record<string, unknown>) => api.post('/rounds/import', data),
  /** ตรวจสอบก่อนนำเข้า — ซ้ำ id / วันออก */
  importPreview: (data: Record<string, unknown>) =>
    api.post<ImportPreviewResponse>('/rounds/import-preview', data),
};

// ─── Bets ─────────────────────────────────────────────────────────────────────
export const betsApi = {
  list:   (roundId: string, customerId?: string) =>
    api.get('/bets', { params: { round_id: roundId, ...(customerId ? { customer_id: customerId } : {}) } }),
  create: (data: Record<string, unknown>) => api.post('/bets', data),
  bulk:   (roundId: string, bets: Record<string, unknown>[]) =>
    api.post('/bets/bulk', { round_id: roundId, bets }),
  delete: (id: string) => api.delete(`/bets/${id}`),
  bulkDelete: (ids: string[]) => api.post('/bets/bulk-delete', { ids }),
  moveSheet: (ids: string[], sheet_no: number, customer_id?: string | null, customer_ref?: string | null) =>
    api.patch('/bets/move-sheet', { ids, sheet_no, customer_id, customer_ref }),
  search: (params: {
    round_id: string;
    mode: 'top' | 'has' | 'exceed';
    bet_type?: string;
    limit?: number;
    number?: string;
    customer_id?: string;
    min_amount?: number;
  }) => api.get('/bets/search', { params }),
};

// ─── Customers ────────────────────────────────────────────────────────────────
export const customersApi = {
  list:   ()                                          => api.get('/customers'),
  create: (data: Record<string, unknown>)             => api.post('/customers', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/customers/${id}`, data),
  delete: (id: string)                                => api.delete(`/customers/${id}`),
  /** สำรอง JSON (admin) — response เป็น Blob; ค่าเริ่มต้นเฉพาะที่ใช้งาน */
  exportJson: (opts?: { includeInactive?: boolean }) =>
    api.get('/customers/export', {
      responseType: 'blob',
      params: opts?.includeInactive ? { include_inactive: '1' } : {},
    }),
  /** นำเข้า { customers: [...] } จากไฟล์ export — upsert ตาม id */
  importJson: (data: Record<string, unknown>) =>
    api.post<{ ok: boolean; imported: number }>('/customers/import', data),
};

export type LineIntegrationSettingsDto = {
  singleton: number;
  webhook_enabled: boolean;
  auto_import_enabled: boolean;
  target_round_id: string | null;
  customer_id: string | null;
  sheet_no: number;
  allowed_group_ids: string[];
  actor_user_id: string | null;
  updated_at: string;
  target_round_name?: string | null;
  customer_name?: string | null;
  actor_username?: string | null;
  webhook_url_hint?: string;
};

export type LineWebhookLogRow = {
  id: number;
  received_at: string;
  message_id: string | null;
  group_id: string | null;
  user_id: string | null;
  text_preview: string | null;
  status: string;
  inserted_count: number;
  error_detail: string | null;
};

/** รับข้อความจาก LINE Messaging API (ตั้งค่า admin) */
export const lineIntegrationApi = {
  getSettings: () => api.get<LineIntegrationSettingsDto>('/line-integration/settings'),
  patchSettings: (data: Record<string, unknown>) =>
    api.patch<LineIntegrationSettingsDto>('/line-integration/settings', data),
  getLogs: (limit?: number) =>
    api.get<{ logs: LineWebhookLogRow[] }>('/line-integration/logs', { params: { limit } }),
};

// ─── Dealers ──────────────────────────────────────────────────────────────────
export const dealersApi = {
  list:   ()                                          => api.get('/dealers'),
  create: (data: Record<string, unknown>)             => api.post('/dealers', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/dealers/${id}`, data),
  delete: (id: string)                                => api.delete(`/dealers/${id}`),
  exportJson: (opts?: { includeInactive?: boolean }) =>
    api.get('/dealers/export', {
      responseType: 'blob',
      params: opts?.includeInactive ? { include_inactive: '1' } : {},
    }),
  importJson: (data: Record<string, unknown>) =>
    api.post<{ ok: boolean; imported: number }>('/dealers/import', data),
};

// ─── Cut ─────────────────────────────────────────────────────────────────────
export const cutApi = {
  getRisk:        (roundId: string) => api.get(`/cut/${roundId}/risk`),
  getDealerRates: (roundId: string) => api.get(`/cut/${roundId}/dealer-rates`),
  getBetScope:    (roundId: string) => api.get<{ sheets: number[] }>(`/cut/${roundId}/bet-scope`),
  rangeSim:  (roundId: string, data: Record<string, unknown>) =>
    api.post(`/cut/${roundId}/range-simulation`, data),
  simulate:  (roundId: string, data: Record<string, unknown>) =>
    api.post(`/cut/${roundId}/simulate`, data),
  apply:     (roundId: string, data: Record<string, unknown>) =>
    api.post(`/cut/${roundId}/apply`, data),
  listPlans:       (roundId: string) => api.get(`/cut/${roundId}/plans`),
  listSendBatches: (roundId: string) => api.get(`/cut/${roundId}/send-batches`),
  createSendBatch: (roundId: string, data: Record<string, unknown>) =>
    api.post(`/cut/${roundId}/send-batches`, data),
  deleteSendBatch: (roundId: string, batchId: string) =>
    api.delete(`/cut/${roundId}/send-batches/${batchId}`),
};

// ─── Limits ───────────────────────────────────────────────────────────────────
export const limitsApi = {
  list:       (roundId: string, params?: Record<string, string>) =>
    api.get(`/limits/${roundId}`, { params }),
  upsert:     (roundId: string, data: Record<string, unknown>) =>
    api.put(`/limits/${roundId}`, data),
  bulkUpsert: (roundId: string, limits: Record<string, unknown>[]) =>
    api.put(`/limits/${roundId}/bulk`, { limits }),
  deleteById: (roundId: string, id: string) =>
    api.delete(`/limits/${roundId}/by-id/${id}`),
  deleteAll:  (roundId: string, entityType?: string) =>
    api.delete(`/limits/${roundId}`, { params: entityType ? { entity_type: entityType } : {} }),
  delete:     (roundId: string, number: string, betType: string) =>
    api.delete(`/limits/${roundId}/${number}/${betType}`),
};

// ─── Reports ──────────────────────────────────────────────────────────────────
const reportsApi = {
  dashboard:     () => api.get('/reports/dashboard'),
  summary:       (roundId: string) => api.get(`/reports/${roundId}/summary`),
  pdf:           (roundId: string) => api.get(`/reports/${roundId}/pdf`, { responseType: 'blob' }),
  betView:       (roundId: string, betType?: string) =>
    api.get(`/reports/${roundId}/bet-view`, { params: betType ? { bet_type: betType } : {} }),
  profitSummary: (roundId: string) => api.get(`/reports/${roundId}/profit-summary`),
  customerWins:  (roundId: string, customerId?: string) =>
    api.get(`/reports/${roundId}/customer-wins`, { params: customerId ? { customer_id: customerId } : {} }),
  dealerWins:    (roundId: string) => api.get(`/reports/${roundId}/dealer-wins`),
};
export { reportsApi };
