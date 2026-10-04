import { fireEvent, render, screen } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import ZoneForm from '@/pages/settings/delivery-zones/components/zone-form';
import { LocaleProvider } from '@/context/locale-context';
import type { DeliveryZone } from '@/pages/settings/delivery-zones/hooks/use-delivery-zones';

vi.mock('@/pages/settings/delivery-zones/components/polygon-editor', () => ({ default: () => <div>Mapa opcional</div> }));
beforeAll(() => vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} }));
afterAll(() => vi.unstubAllGlobals());

describe('configuración de tarifas por zona', () => {
  it('permite crear una zona por nombre con importes en pesos y sin dibujar mapa', () => {
    const save = vi.fn();
    render(<LocaleProvider value={{ currency: 'ARS', locale: 'es-AR' }}><ZoneForm locationId="loc-1" organizationId="org-1" onSubmit={save} onCancel={() => {}} saving={false} /></LocaleProvider>);
    fireEvent.change(screen.getByLabelText('Nombre de la zona *'), { target: { value: 'Centro' } });
    fireEvent.change(screen.getByLabelText('Costo de envío (ARS)'), { target: { value: '1500.50' } });
    fireEvent.change(screen.getByLabelText('Pedido mínimo (ARS)'), { target: { value: '10000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Crear zona' }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Centro', location_id: 'loc-1', delivery_fee_cents: 150050, min_order_cents: 1000000, polygon: null, is_active: true }));
    expect(screen.queryByText('Mapa opcional')).toBeNull();
  });
  it('muestra la tarifa guardada en unidades de moneda, no centavos', () => {
    const initial = { name: 'Centro', delivery_fee_cents: 150000, min_order_cents: 1000000 } as DeliveryZone;
    render(<LocaleProvider value={{ currency: 'ARS' }}><ZoneForm initial={initial} locationId="loc-1" onSubmit={() => {}} onCancel={() => {}} saving={false} /></LocaleProvider>);
    expect(screen.getByLabelText('Costo de envío (ARS)')).toHaveValue(1500);
    expect(screen.getByLabelText('Pedido mínimo (ARS)')).toHaveValue(10000);
  });
});
