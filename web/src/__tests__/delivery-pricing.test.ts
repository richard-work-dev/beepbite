import { describe, expect, it } from 'vitest';
import { deliveryPrice, orderTotals, type OrderLine } from '@/services/public-order';
import type { StoreDetail } from '@/services/marketplace';

const store: StoreDetail = {
  id: 'loc-1', name: 'RikoPollo', slug: 'rikopollo', city: null, country: 'AR', address: null, description: null,
  offers_delivery: true, offers_collection: true, currency_code: 'ARS', estimated_prep_time_minutes: 30,
  avg_rating: null, review_count: 0, categories: [], online_payment_available: false, tax_inclusive: true,
  delivery_fee_cents: 99900, delivery_zones_required: true,
  delivery_zones: [
    { id: 'centro', name: 'Centro', delivery_fee_cents: 150000, min_order_cents: 1000000, estimated_eta_minutes: 30 },
    { id: 'norte', name: 'Zona norte', delivery_fee_cents: 300000, min_order_cents: 2000000, estimated_eta_minutes: 45 },
  ],
};
const products: OrderLine[] = [{ id: 'pollo', name: 'Pollo', price: 12500, quantity: 1, notes: '' }];

describe('delivery por zona', () => {
  it('suma la tarifa de la zona a los productos', () => {
    expect(orderTotals(products, store, 'delivery', 'centro')).toMatchObject({ subtotal: 1250000, delivery: 150000, total: 1400000, deliveryReady: true });
  });
  it('actualiza el total al cambiar la zona', () => {
    expect(orderTotals([{ ...products[0], quantity: 2 }], store, 'delivery', 'norte')).toMatchObject({ total: 2800000, deliveryReady: true });
  });
  it('no usa la tarifa base mientras falta seleccionar una zona', () => {
    expect(orderTotals(products, store, 'delivery')).toMatchObject({ delivery: 0, deliveryReady: false, deliveryPending: true });
  });
  it('rechaza una zona que ya no está disponible', () => {
    expect(deliveryPrice(store, 2500000, 'delivery', 'paused').ready).toBe(false);
  });
  it('conserva el mínimo de productos, sin contar el envío', () => {
    expect(orderTotals(products, store, 'delivery', 'norte')).toMatchObject({ minimum: 2000000, delivery: 300000, deliveryReady: false });
  });
  it.each(['collection', 'dine_in'] as const)('no cobra envío para %s', mode => {
    expect(orderTotals(products, store, mode, 'norte')).toMatchObject({ total: 1250000, delivery: 0, deliveryReady: true });
  });
  it('mantiene el envío gratis por monto sin eludir el mínimo de zona', () => {
    const freeStore = { ...store, free_delivery_threshold_cents: 1200000 };
    expect(orderTotals(products, freeStore, 'delivery', 'centro')).toMatchObject({ delivery: 0, deliveryReady: true });
    expect(orderTotals(products, freeStore, 'delivery', 'norte')).toMatchObject({ delivery: 0, deliveryReady: false });
    expect(orderTotals(products, freeStore, 'delivery')).toMatchObject({ deliveryReady: false });
  });
  it('no permite delivery cuando todas las zonas están pausadas', () => {
    expect(deliveryPrice({ ...store, delivery_zones: [] }, 2500000, 'delivery').ready).toBe(false);
  });
  it('mantiene la tarifa general en locales sin zonas configuradas', () => {
    expect(orderTotals(products, { ...store, delivery_zones: [], delivery_zones_required: false }, 'delivery')).toMatchObject({ delivery: 99900, total: 1349900, deliveryReady: true });
  });
  it('suma impuestos no incluidos antes del envío', () => {
    expect(orderTotals(products, { ...store, tax_inclusive: false, tax_rate: 10 }, 'delivery', 'centro')).toMatchObject({ tax: 125000, delivery: 150000, total: 1525000 });
  });
  it('respeta monedas sin centavos', () => {
    const yenStore = { ...store, currency_code: 'JPY', delivery_zones: [{ ...store.delivery_zones![0], delivery_fee_cents: 150, min_order_cents: 1000 }] };
    expect(orderTotals(products, yenStore, 'delivery', 'centro')).toMatchObject({ subtotal: 12500, total: 12650 });
  });
});
