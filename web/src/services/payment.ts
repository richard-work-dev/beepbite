// Payment service helpers — thin wrappers around POS charge endpoints and
// client-side currency utilities. Used by the POS workspace checkout flow.

import { api } from '@/lib/api-client';
import { formatMoney, parseMoney } from '@/lib/currency';

// ---- Payment method catalogue -----------------------------------------------

/**
 * Ordered list of payment methods rendered in the checkout UI.
 *
 * These codes must exist in the backend's payment_methods table — order_payments
 * has a foreign key to it, so an unknown code is rejected outright.
 *
 * 'card_in_person' means the shop ran the card on its OWN machine. BeepBite
 * records the amount and the slip reference; it never processes a card.
 */
export const PAYMENT_METHODS: { code: string; label: string; icon: string }[] = [
  { code: 'cash',           label: 'Efectivo', icon: '💵' },
  { code: 'card_in_person', label: 'Tarjeta', icon: '💳' },
  { code: 'eft',            label: 'Transferencia', icon: '🏦' },
];

// ---- Charge -----------------------------------------------------------------

/**
 * Charge a POS order. Supports both single-payment (legacy) and split-tender
 * (multi-leg) modes.
 *
 * Single-payment (legacy):
 *   chargeOrder({ orderId, paymentMethodCode, amountPaidCents, ... })
 *
 * Split-tender (pass `payments` array):
 *   chargeOrder({ orderId, processedByStaffId, payments: [{ payment_method_code, amount_paid_cents, ... }] })
 *
 * Route: POST /pos/orders/{order_id}/charge
 * Returns: { order_id, payment_id, payment_ids, payment_status, session_closed }
 */
export interface PaymentLeg {
  payment_method_code: string;
  amount_paid_cents: number;
  tip_amount_cents?: number;
  change_given_cents?: number;
  payment_reference?: string;
  [key: string]: unknown;
}

export interface ChargeOrderParams {
  orderId: string;
  paymentMethodCode?: string;
  amountPaidCents?: number;
  tipAmountCents?: number;
  changeGivenCents?: number;
  paymentReference?: string;
  processedByStaffId?: string;
  // Split-tender: array of { payment_method_code, amount_paid_cents, ... }
  payments?: PaymentLeg[];
}

interface FetchError extends Error {
  status?: number;
}

export interface ChargeOrderResult {
  order_id: string;
  payment_id: string;
  payment_ids: string[];
  payment_status: 'partial' | 'paid';
  paid_cents: number;
  remaining_cents: number;
  session_closed: boolean;
  session_close_error?: boolean;
}

export async function chargeOrder({
  orderId,
  paymentMethodCode,
  amountPaidCents,
  tipAmountCents,
  changeGivenCents,
  paymentReference,
  processedByStaffId,
  payments,
}: ChargeOrderParams) {
  if (!orderId) throw new Error('Falta identificar el pedido');

  let body: {
    payments?: PaymentLeg[];
    processed_by_staff_id?: string;
    payment_method_code?: string;
    amount_paid_cents?: number;
    tip_amount_cents?: number;
    change_given_cents?: number;
    payment_reference?: string;
  };
  if (payments && payments.length > 0) {
    // Split-tender path
    body = {
      payments,
      processed_by_staff_id: processedByStaffId || undefined,
    };
  } else {
    // Single-payment (backwards-compatible)
    if (!paymentMethodCode) throw new Error('Seleccioná un método de pago');
    body = {
      payment_method_code: paymentMethodCode,
      amount_paid_cents: amountPaidCents,
    };
    if (tipAmountCents != null)   body.tip_amount_cents      = tipAmountCents;
    if (changeGivenCents != null) body.change_given_cents    = changeGivenCents;
    if (paymentReference)         body.payment_reference     = paymentReference;
    if (processedByStaffId)       body.processed_by_staff_id = processedByStaffId;
  }

  const { data, error } = await api.request<ChargeOrderResult>(
    'POST',
    `/pos/orders/${encodeURIComponent(orderId)}/charge`,
    { body },
  );
  if (error) {
    const e: FetchError = new Error(error.message || 'No se pudo cobrar el pedido');
    e.status = error.status;
    throw e;
  }
  return data!;
}

export interface UnpaidOrder {
  id: string;
  total_cents: number;
  paid_cents?: number;
  [key: string]: unknown;
}

export interface TenderLeg {
  method: string;
  amountCents: number;
  reference?: string;
  changeCents?: number;
}

export interface AllocatedOrderPayments {
  order: UnpaidOrder;
  remaining: number;
  payments: PaymentLeg[];
}

export function allocateTenderLegs(orders: UnpaidOrder[], legs: TenderLeg[]): AllocatedOrderPayments[] {
  const remainingByOrder = orders.map((order) => ({
    order,
    remaining: Math.max(0, (order.total_cents || 0) - (order.paid_cents || 0)),
    payments: [] as PaymentLeg[],
  }));
  let orderIndex = 0;

  // Fill outstanding orders in sequence. This preserves every cent and avoids
  // proportional rounding marking one order overpaid while another remains due.
  for (const leg of legs) {
    const change = Math.max(0, Math.round(leg.changeCents || 0));
    let net = Math.round(leg.amountCents) - change;
    if (net <= 0) throw new Error('El importe del pago debe ser mayor que cero');
    if (change > 0 && leg.method !== 'cash') throw new Error('Solo el efectivo puede registrar cambio');
    let lastPayment: PaymentLeg | null = null;

    while (net > 0) {
      while (orderIndex < remainingByOrder.length && remainingByOrder[orderIndex].remaining === 0) orderIndex += 1;
      if (orderIndex >= remainingByOrder.length) throw new Error('El pago supera el saldo pendiente');
      const target = remainingByOrder[orderIndex];
      const allocated = Math.min(net, target.remaining);
      lastPayment = {
        payment_method_code: leg.method,
        amount_paid_cents: allocated,
        change_given_cents: 0,
        payment_reference: leg.reference || '',
      };
      target.payments.push(lastPayment);
      target.remaining -= allocated;
      net -= allocated;
    }

    if (change > 0 && lastPayment) {
      lastPayment.amount_paid_cents += change;
      lastPayment.change_given_cents = change;
    }
  }
  return remainingByOrder;
}

/**
 * Charge all unpaid orders on a ticket using an array of TenderLegs
 * (produced by TenderModal). Each leg becomes a payment_method_code + amount.
 *
 * @param params.orders  — unpaid orders
 * @returns array of charge responses (one per order)
 */
export async function chargeOrdersWithLegs({ orders, legs, processedByStaffId }: {
  orders: UnpaidOrder[];
  legs: TenderLeg[];
  processedByStaffId?: string;
}) {
  if (!orders || orders.length === 0) throw new Error('No hay pedidos pendientes de cobro');
  if (!legs || legs.length === 0) throw new Error('Agregá al menos un método de pago');

  const remainingByOrder = allocateTenderLegs(orders, legs);

  const results: ChargeOrderResult[] = [];
  for (const target of remainingByOrder) {
    if (target.payments.length === 0) continue;
    results.push(await chargeOrder({
      orderId: target.order.id,
      processedByStaffId,
      payments: target.payments,
    }));
  }
  return results;
}

// ---- Currency utilities -----------------------------------------------------

/**
 * Format an integer minor-unit amount for display.
 *
 * Not a hook, so the currency must be passed in — callers inside components
 * should prefer useMoney().format. There is no default currency: an
 * unconfigured location renders a bare number rather than a foreign symbol.
 *
 * @param minor    amount in the currency's smallest unit
 * @param currency ISO 4217 code
 * @param locale   BCP-47 tag; omit for the reader's own
 */
export function formatAmount(minor: number | string, currency?: string, locale?: string): string {
  return formatMoney(minor, { currency, locale });
}

/**
 * Parse a typed major-unit value into integer minor units.
 * e.g. ('12.50', 'USD') → 1250; ('1000', 'JPY') → 1000.
 *
 * The currency decides the scale: a fixed ×100 charges a yen customer 100× the
 * ticket and a dinar customer a tenth of it.
 *
 * @returns minor units; 0 for unparseable or negative input
 */
export function minorFromInput(value: string | number, currency?: string): number {
  const minor = parseMoney(value, currency);
  if (minor == null || minor < 0) return 0;
  return minor;
}
