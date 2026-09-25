import { describe, expect, it } from 'vitest';

import { normalizeServiceStyle } from '@/lib/service-style';

describe('normalizeServiceStyle', () => {
  it('acepta las modalidades persistidas por la API', () => {
    expect(normalizeServiceStyle('dine_in')).toBe('dine_in');
    expect(normalizeServiceStyle('takeaway')).toBe('takeaway');
  });

  it('rechaza valores ausentes o desconocidos', () => {
    expect(normalizeServiceStyle(undefined)).toBeNull();
    expect(normalizeServiceStyle('delivery')).toBeNull();
  });
});
