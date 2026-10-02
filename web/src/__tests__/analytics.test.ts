import { beforeEach, describe, expect, it, vi } from 'vitest';

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock('../lib/api-client', () => ({ api: { request } }));

import analyticsService from '../services/analytics';

describe('reportes de ventas', () => {
  beforeEach(() => request.mockReset());

  it('combina pedidos con business_date y pedidos POS históricos que solo tienen created_at', async () => {
    request
      .mockResolvedValueOnce({ data: [], error: null })
      .mockResolvedValueOnce({
        data: [{
          id: 'web-1', business_date: '2026-10-01', created_at: '2026-10-01T06:30:00Z',
          order_type: 'pickup', subtotal_cents: 10000, discount_cents: 1000, total_cents: 12000,
        }], error: null,
      })
      .mockResolvedValueOnce({
        data: [
          { id: 'web-1', business_date: '2026-10-01', created_at: '2026-10-01T06:30:00Z', order_type: 'pickup', subtotal_cents: 10000, discount_cents: 1000, total_cents: 12000 },
          { id: 'pos-old', created_at: '2026-10-01T06:45:00Z', order_type: 'dine_in', subtotal_cents: 5000, total_cents: 5750 },
        ], error: null,
      });

    const rows = await analyticsService.getDailySalesSummary(
      { from: new Date(2026, 9, 1), to: new Date(2026, 9, 1) },
      'location-1',
      'America/Argentina/Buenos_Aires',
    );

    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.order_type === 'pickup')).toMatchObject({
      order_count: 1, gross_subtotal_cents: 10000, discount_total_cents: 1000, net_sales_cents: 9000,
    });
    expect(rows.find(row => row.order_type === 'dine_in')).toMatchObject({
      order_count: 1, gross_subtotal_cents: 5000, net_sales_cents: 5000,
    });
    expect(request.mock.calls[2][1]).toContain('created_at');
    expect(request.mock.calls[2][1]).toContain('lt=created_at,');
  });

  it('deriva ventas de la tabla de pedidos cuando las vistas de analítica no están disponibles', async () => {
    request
      .mockResolvedValueOnce({ data: null, error: { message: 'vista no disponible' } })
      .mockResolvedValueOnce({ data: [{ id: 'order-1', business_date: '2026-10-01', order_type: 'delivery', subtotal_cents: 4200 }], error: null })
      .mockResolvedValueOnce({ data: [], error: null });

    const rows = await analyticsService.getDailySalesSummary(
      { from: new Date(2026, 9, 1), to: new Date(2026, 9, 1) }, 'location-1', 'America/Argentina/Buenos_Aires',
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      order_count: 1, net_sales_cents: 4200, order_type: 'delivery', gross_profit_available: false,
    });
  });
});
