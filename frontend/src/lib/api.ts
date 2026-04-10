import axios, { AxiosError } from 'axios';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

export const api = axios.create({
  baseURL: BASE_URL,
  timeout: 30_000,
  headers: { 'Content-Type': 'application/json' },
});

// Attach JWT from localStorage on every request
api.interceptors.request.use((config) => {
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
};

// ─── Rounds ────────────────────────────────────────────────────────────────────
process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
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
};

// ─── Bets ─────────────────────────────────────────────────────────────────────
export const betsApi = {
  list:   (roundId: string, customerId?: string) =>
    api.get('/bets', { params: { round_id: roundId, ...(customerId ? { customer_id: customerId } : {}) } }),
  create: (data: Record<string, unknown>) => api.post('/bets', data),
  bulk:   (roundId: string, bets: Record<string, unknown>[]) =>
    api.post('/bets/bulk', { round_id: roundId, bets }),
  delete: (id: string) => api.delete(`/bets/${id}`),
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
};

// ─── Dealers ──────────────────────────────────────────────────────────────────
export const dealersApi = {
  list:   ()                                          => api.get('/dealers'),
  create: (data: Record<string, unknown>)             => api.post('/dealers', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/dealers/${id}`, data),
  delete: (id: string)                                => api.delete(`/dealers/${id}`),
};

// ─── Cut ─────────────────────────────────────────────────────────────────────
export const cutApi = {
  getRisk:        (roundId: string) => api.get(`/cut/${roundId}/risk`),
  getDealerRates: (roundId: string) => api.get(`/cut/${roundId}/dealer-rates`),
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
