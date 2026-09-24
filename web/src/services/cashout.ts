// cashout.js — cash-out report service
//
// Thin wrapper around GET /cash-out/{session_id}. Returns the full shift
// reconciliation: opening float, cash sales, movements, expected vs counted,
// and the over/short variance.

import { api } from '@/lib/api-client';

export interface CashOutReport {
  session_id: string;
  cash_drawer_id: string;
  location_id: string;
  status: string;
  opened_at: string;
  closed_at?: string | null;
  is_blind_close: boolean;
  opening_float_cents: number;
  cash_sales_cents: number;
  movements_net_cents: number;
  expected_cash_cents: number;
  counted_cash_cents?: number | null;
  variance_cents?: number | null;
  is_balanced: boolean;
  declared_closing_cents?: number | null;
  over_short_cents?: number | null;
  movements: Array<{
    id: string;
    movement_type: string;
    amount_cents: number;
    reason?: string | null;
    performed_by?: string | null;
    created_at: string;
  }>;
  [key: string]: unknown;
}

/**
 * Fetch the cash-out report for a cash drawer session.
 *
 * @param sessionId - UUID of the cash_drawer_session
 */
export async function fetchCashOut(sessionId: string) {
  const { data, error } = await api.request<CashOutReport>('GET', `/cash-out/${sessionId}`);
  return { data: data ?? null, error: error ?? null };
}
