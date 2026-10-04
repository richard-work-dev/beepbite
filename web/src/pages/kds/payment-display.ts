export type PaymentTone = 'paid' | 'deferred' | 'attention' | 'neutral';

export interface KdsPaymentDisplay {
  statusLabel: string;
  methodLabel: string;
  tone: PaymentTone;
}

export const PAYMENT_TONE_CLASSES: Record<PaymentTone, string> = {
  paid: 'bg-emerald-900 text-emerald-200',
  deferred: 'bg-sky-900 text-sky-200',
  attention: 'bg-amber-900 text-amber-200',
  neutral: 'bg-slate-800 text-slate-300',
};

const METHOD_LABELS: Record<string, string> = {
  cash: 'Efectivo',
  cash_on_delivery: 'Efectivo al entregar',
  card_machine: 'Tarjeta',
  card_in_person: 'Tarjeta',
  card_on_delivery: 'Tarjeta al entregar',
  eft: 'Transferencia bancaria',
  split: 'Pago dividido',
};

const STATUS_LABELS: Record<string, string> = {
  paid: 'Pagado',
  completed: 'Pagado',
  partial: 'Pago parcial',
  pending: 'Pendiente de cobro',
  pending_on_delivery: 'Se cobra al entregar',
  refunded: 'Reintegrado',
  partially_refunded: 'Reintegro parcial',
  void: 'Anulado',
};

export function kdsPaymentDisplay(
  orderType?: string | null,
  paymentStatus?: string | null,
  paymentMethod?: string | null,
): KdsPaymentDisplay {
  const status = paymentStatus?.trim().toLowerCase() || 'pending';
  const method = paymentMethod?.trim().toLowerCase() || '';
  const isPaid = status === 'paid' || status === 'completed';
  const deferredDineIn = orderType === 'dine_in' && !method && !isPaid;

  return {
    statusLabel: deferredDineIn
      ? 'A pagar al final'
      : method === 'eft' && !isPaid && status === 'pending'
        ? 'Transferencia por verificar'
        : STATUS_LABELS[status] || 'Pendiente de cobro',
    methodLabel: METHOD_LABELS[method] || (deferredDineIn ? 'A definir en caja' : method || 'Sin método indicado'),
    tone: isPaid ? 'paid' : deferredDineIn ? 'deferred' : status === 'refunded' || status === 'partially_refunded' || status === 'void' ? 'neutral' : 'attention',
  };
}

