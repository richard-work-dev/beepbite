import { describe, expect, it } from 'vitest';
import { fulfillmentLabel, nextPOSOrderAction, orderStatusGroup, orderStatusLabel } from '../pages/work/order-status';

describe('POS order hand-off flow', () => {
  it('accepts new orders, while kitchen owns preparation states', () => {
    expect(nextPOSOrderAction({ status: 'pending', fulfillment_type: 'delivery' }))
      .toEqual({ nextStatus: 'confirmed', label: 'Aceptar pedido' });
    expect(nextPOSOrderAction({ status: 'confirmed', fulfillment_type: 'collection' })).toBeNull();
    expect(nextPOSOrderAction({ status: 'preparing', fulfillment_type: 'dine_in' })).toBeNull();
  });

  it('routes ready orders to the correct hand-off state by fulfillment', () => {
    expect(nextPOSOrderAction({ status: 'ready', fulfillment_type: 'delivery' })?.nextStatus).toBe('out_for_delivery');
    expect(nextPOSOrderAction({ status: 'ready', fulfillment_type: 'collection' })?.label).toBe('Marcar retirado');
    expect(nextPOSOrderAction({ status: 'ready', fulfillment_type: 'pickup' })?.nextStatus).toBe('completed');
    expect(nextPOSOrderAction({ status: 'ready', fulfillment_type: 'takeaway' })?.label).toBe('Marcar retirado');
    expect(nextPOSOrderAction({ status: 'ready', fulfillment_type: 'dine_in' })?.label).toBe('Marcar servido');
    expect(nextPOSOrderAction({ status: 'ready', fulfillment_type: 'unknown' })).toBeNull();
  });

  it('confirms delivery completion only for delivery orders', () => {
    expect(nextPOSOrderAction({ status: 'out_for_delivery', fulfillment_type: 'delivery' })?.nextStatus).toBe('delivered');
    expect(nextPOSOrderAction({ status: 'out_for_delivery', fulfillment_type: 'collection' })).toBeNull();
    expect(nextPOSOrderAction({ status: 'pending_on_delivery', fulfillment_type: 'delivery' })).toBeNull();
  });

  it('labels service modes and groups orders for the board', () => {
    expect(fulfillmentLabel({ status: 'ready', order_type: 'dine_in' })).toBe('Consumo en el local');
    expect(fulfillmentLabel({ status: 'ready', fulfillment_type: 'pickup' })).toBe('Retiro en el local');
    expect(orderStatusGroup('preparing')).toBe('kitchen');
    expect(orderStatusGroup('out_for_delivery')).toBe('handoff');
    expect(orderStatusGroup('pending_on_delivery')).toBe('handoff');
    expect(orderStatusGroup('delivered')).toBe('closed');
    expect(orderStatusLabel('ready', { status: 'ready', fulfillment_type: 'delivery' })).toBe('Listo para despacho');
    expect(orderStatusLabel('ready', { status: 'ready', fulfillment_type: 'dine_in' })).toBe('Listo para servir');
    expect(orderStatusLabel('completed', { status: 'completed', fulfillment_type: 'collection' })).toBe('Retirado');
  });
});
