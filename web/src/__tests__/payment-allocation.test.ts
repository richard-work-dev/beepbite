import { describe, expect, it } from 'vitest';

import { allocateTenderLegs } from '@/services/payment';

describe('allocateTenderLegs', () => {
  it('allocates a partial seat payment against remaining order balances', () => {
    const allocation = allocateTenderLegs(
      [
        { id: 'order-1', total_cents: 1000, paid_cents: 200 },
        { id: 'order-2', total_cents: 700, paid_cents: 0 },
      ],
      [{ method: 'card_in_person', amountCents: 900 }],
    );

    expect(allocation[0].payments).toEqual([
      expect.objectContaining({ amount_paid_cents: 800, change_given_cents: 0 }),
    ]);
    expect(allocation[0].remaining).toBe(0);
    expect(allocation[1].payments).toEqual([
      expect.objectContaining({ amount_paid_cents: 100, change_given_cents: 0 }),
    ]);
    expect(allocation[1].remaining).toBe(600);
  });

  it('keeps cash change while applying the exact net amount', () => {
    const allocation = allocateTenderLegs(
      [
        { id: 'order-1', total_cents: 500 },
        { id: 'order-2', total_cents: 500 },
      ],
      [{ method: 'cash', amountCents: 1200, changeCents: 200 }],
    );

    expect(allocation[0].payments[0]).toEqual(expect.objectContaining({ amount_paid_cents: 500, change_given_cents: 0 }));
    expect(allocation[1].payments[0]).toEqual(expect.objectContaining({ amount_paid_cents: 700, change_given_cents: 200 }));
    expect(allocation.every((entry) => entry.remaining === 0)).toBe(true);
  });

  it('rejects a payment above the outstanding balance', () => {
    expect(() => allocateTenderLegs(
      [{ id: 'order-1', total_cents: 500 }],
      [{ method: 'cash', amountCents: 501 }],
    )).toThrow('El pago supera el saldo pendiente');
  });
});
