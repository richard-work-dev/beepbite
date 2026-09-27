import { describe, expect, it } from 'vitest';
import { formatKitchenOrderNumber } from '@/pages/kds/order-number';

describe('código visible de cocina', () => {
  it('reduce el número POS a hora y sufijo', () => {
    expect(formatKitchenOrderNumber('POS-260927105730-278')).toBe('105730-278');
  });

  it('conserva números cortos y recorta identificadores técnicos', () => {
    expect(formatKitchenOrderNumber(42)).toBe('42');
    expect(formatKitchenOrderNumber('1234567890abcdef')).toBe('12345678…');
    expect(formatKitchenOrderNumber(null)).toBe('—');
  });
});
