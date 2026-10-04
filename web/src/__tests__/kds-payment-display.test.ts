import { describe, expect, it } from 'vitest';
import { kdsPaymentDisplay } from '@/pages/kds/payment-display';

describe('kitchen ticket payment summary', () => {
  it('explains deferred payment for an unpaid dine-in order without a selected method', () => {
    expect(kdsPaymentDisplay('dine_in', 'pending', '')).toEqual({
      statusLabel: 'A pagar al final',
      methodLabel: 'A definir en caja',
      tone: 'deferred',
    });
  });

  it('shows an EFT order as waiting for manual verification', () => {
    expect(kdsPaymentDisplay('delivery', 'pending', 'eft')).toEqual({
      statusLabel: 'Transferencia por verificar',
      methodLabel: 'Transferencia bancaria',
      tone: 'attention',
    });
  });

  it('shows the recorded method when the order has been paid', () => {
    expect(kdsPaymentDisplay('dine_in', 'paid', 'card_machine')).toEqual({
      statusLabel: 'Pagado',
      methodLabel: 'Tarjeta',
      tone: 'paid',
    });
  });

  it('recognizes the POS card tender code', () => {
    expect(kdsPaymentDisplay('dine_in', 'paid', 'card_in_person').methodLabel).toBe('Tarjeta');
  });
});
