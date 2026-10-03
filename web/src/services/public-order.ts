import { currencyScale, formatMoney } from '@/lib/currency';
import { type CartItem, type StoreDetail, type CheckoutOrderPayload } from './marketplace';

export type Fulfillment = 'collection' | 'dine_in' | 'delivery';
export const fulfillmentLabels: Record<Fulfillment, string> = {
  collection: 'Para llevar', dine_in: 'Comer en el local', delivery: 'Delivery',
};
export const paymentLabels: Record<string, string> = {
  cash: 'Efectivo', card_machine: 'Tarjeta al recibir', eft: 'Transferencia bancaria',
};
export function paymentLabel(method: string, mode?: Fulfillment): string {
  if (mode === 'dine_in') {
    const dineInLabels: Record<string, string> = {
      cash: 'Efectivo en caja',
      card_machine: 'Tarjeta en caja',
      eft: 'Transferencia bancaria',
    };
    return dineInLabels[method] || paymentLabels[method] || method;
  }
  return paymentLabels[method] || method;
}
export interface OrderLine extends CartItem {
  id: string;
  name: string;
  price: number;
  quantity: number;
  notes: string;
}

export function fulfillmentOptions(store: StoreDetail): Fulfillment[] {
  return [
    ...(store.offers_collection ? ['collection' as const] : []),
    ...(store.offers_dine_in ? ['dine_in' as const] : []),
    ...(store.offers_delivery ? ['delivery' as const] : []),
  ];
}

// Refresh cart names, prices and availability from the public catalogue.
// No locally cached price is sent to the server as a source of truth.
export function reconcileCart(raw: CartItem[], store: StoreDetail): { items: OrderLine[]; changed: boolean } {
  const menu = new Map(store.categories.flatMap(c => c.items).map(i => [i.id, i]));
  const items: OrderLine[] = [];
  let changed = false;
  for (const line of Array.isArray(raw) ? raw : []) {
    if (!line || typeof line !== 'object') { changed = true; continue; }
    const item = menu.get(line.id ?? line.item_id ?? '');
    const quantity = Number(line.quantity);
    if (!item || !Number.isInteger(quantity) || quantity < 1 || !Number.isFinite(Number(item.price))) {
      changed = true; continue;
    }
    const existing = items.find(i => i.id === item.id);
    const requested = quantity + (existing?.quantity ?? 0);
    const available = Math.min(99, item.remaining_today ?? 99);
    const nextQty = Math.min(requested, available);
    if (nextQty <= 0) { changed = true; continue; }
    if (nextQty !== requested || Number(line.price) !== Number(item.price)) changed = true;
    if (existing) existing.quantity = nextQty;
    else items.push({ id: item.id, name: item.name, price: Number(item.price), quantity: nextQty,
      notes: typeof line.notes === 'string' ? line.notes.slice(0, 300) : '' });
  }
  return { items, changed };
}

export function orderTotals(items: OrderLine[], store: StoreDetail, mode: Fulfillment) {
  const scale = currencyScale(store.currency_code);
  const subtotal = items.reduce((sum, item) => sum + Math.round(item.price * scale) * item.quantity, 0);
  const tax = store.tax_inclusive === false ? Math.round(subtotal * (store.tax_rate ?? 0) / 100) : 0;
  const threshold = store.free_delivery_threshold_cents ?? 0;
  const delivery = mode === 'delivery' && !(threshold > 0 && subtotal >= threshold) ? store.delivery_fee_cents ?? 0 : 0;
  return { subtotal, tax, delivery, total: subtotal + tax + delivery };
}

export function publicMoney(cents: number, store: Pick<StoreDetail, 'currency_code' | 'locale'>) {
  return formatMoney(cents, { currency: store.currency_code, locale: store.locale || 'es-AR' });
}

export interface CheckoutDraft {
  customer_name: string;
  customer_phone: string;
  delivery_address: string;
  table_label: string;
  notes: string;
  fulfillment_type: Fulfillment;
  on_delivery_method: string;
}

export function readSession<T>(key: string): T | null {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null') as T | null; } catch { return null; }
}
export function saveSession(key: string, value: unknown) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* Private browsing. */ }
}

// A retry, double click or reload of the same submission reuses its key.
// Changed details/cart produce a new key, so a deliberate second order works.
export function checkoutRequestID(slug: string, payload: CheckoutOrderPayload): string {
  const key = `bb.checkout-request.${slug}`;
  const signature = JSON.stringify(payload);
  const previous = readSession<{ signature: string; id: string }>(key);
  if (previous?.signature === signature) return previous.id;
  const id = crypto.randomUUID();
  saveSession(key, { signature, id });
  return id;
}

export function finishCheckout(slug: string) {
  try {
    sessionStorage.removeItem(`bb.checkout-request.${slug}`);
    sessionStorage.removeItem(`bb.checkout-draft.${slug}`);
  } catch { /* The successful server response remains authoritative. */ }
}
