import type { POSOrderStatusInput } from './order-status';

export interface OrderTransition {
  from: string; to: string; at: string; actor_id: string; actor_name?: string; actor_role?: string;
}

export interface POSOrder extends POSOrderStatusInput {
  id: string;
  order_number?: string;
  customer_name?: string | null;
  customer_phone?: string | null;
  table_label?: string | null;
  table_number?: string | number | null;
  delivery_address?: string | null;
  delivery_zone_name?: string | null;
  delivery_fee_cents?: number;
  paid_cents?: number;
  total_cents?: number | string | null;
  total?: number | string | null;
  currency_code?: string | null;
  created_at?: string | null;
  status_history?: OrderTransition[];
}

export function orderTotal(order: POSOrder, scale: number): number {
  const cents = order.total_cents == null ? Number.NaN : Number(order.total_cents);
  if (Number.isFinite(cents)) return cents;
  const total = Number(order.total);
  return Number.isFinite(total) ? Math.round(total * scale) : 0;
}

export function customerOrTable(order: POSOrder): string {
  const table = order.table_label || order.table_number;
  if ((order.fulfillment_type || order.order_type) === 'dine_in' && table != null && String(table).trim()) return /^mesa\b/i.test(String(table)) ? String(table) : `Mesa ${table}`;
  return order.customer_name?.trim() || (table != null ? `Mesa ${table}` : 'Cliente de mostrador');
}

export function paymentLabel(order: POSOrder): string {
  const method = ({ cash: 'Efectivo', cash_on_delivery: 'Efectivo', card_machine: 'Tarjeta', card_in_person: 'Tarjeta', card_on_delivery: 'Tarjeta', eft: 'Transferencia', split: 'Pago dividido' } as Record<string, string>)[order.payment_method || ''] || 'Método a confirmar';
  return `${order.payment_status === 'paid' ? 'Pagado' : order.payment_status === 'partial' ? 'Pago parcial' : 'Por cobrar'} · ${method}`;
}
