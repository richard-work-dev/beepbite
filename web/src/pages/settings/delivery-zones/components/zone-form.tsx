import { useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import PolygonEditor from './polygon-editor';
import type { DeliveryZone, GeoJSONPolygon } from '../hooks/use-delivery-zones';
import type { Location } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';

function field(label: string, children: ReactNode) {
  return (
    <div className="space-y-1">
      <Label className="block space-y-2 text-sm font-medium"><span>{label}</span>{children}</Label>
    </div>
  );
}

interface ZoneFormProps {
  initial?: DeliveryZone | null;
  organizationId?: string;
  locationId?: string;
  location?: Location | null;
  onSubmit: (payload: Partial<DeliveryZone>) => void;
  onCancel: () => void;
  saving: boolean;
}

export default function ZoneForm({ initial, organizationId, locationId, location, onSubmit, onCancel, saving }: ZoneFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const { scale, currency } = useMoney();
  const [deliveryFee, setDeliveryFee] = useState(String((initial?.delivery_fee_cents ?? 0) / scale));
  const [minOrder, setMinOrder] = useState(String((initial?.min_order_cents ?? 0) / scale));
  const [etaMinutes, setEtaMinutes] = useState<number | string>(initial?.estimated_eta_minutes ?? 30);
  const [priority, setPriority] = useState<number | string>(initial?.priority ?? 0);
  const [isActive, setIsActive] = useState(initial?.is_active ?? true);
  const [polygon, setPolygon] = useState<GeoJSONPolygon | null>(initial?.polygon ?? null);
  const [polygonError, setPolygonError] = useState('');
  const [showMap, setShowMap] = useState(false);

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!name.trim()) return;
    if (polygon && (polygon.coordinates?.[0]?.length ?? 0) < 4) {
      setPolygonError('El área debe tener al menos 3 puntos.');
      return;
    }
    setPolygonError('');
    onSubmit({
      organization_id: organizationId,
      location_id: locationId,
      name: name.trim(),
      polygon,
      delivery_fee_cents: Math.round(Number(deliveryFee) * scale),
      min_order_cents: Math.round(Number(minOrder) * scale),
      estimated_eta_minutes: Number(etaMinutes),
      priority: Number(priority),
      is_active: isActive,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {field('Nombre de la zona *',
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Por ejemplo, centro"
          required
        />
      )}

      <div className="grid grid-cols-2 gap-3">
        {field(`Costo de envío (${currency})`,
          <Input
            type="number"
            min="0"
            max={1e12 / scale}
            step={1 / scale}
            required
            inputMode="decimal"
            value={deliveryFee}
            onChange={(e) => setDeliveryFee(e.target.value)}
          />
        )}
        {field(`Pedido mínimo (${currency})`,
          <Input
            type="number"
            min="0"
            max={1e12 / scale}
            step={1 / scale}
            required
            inputMode="decimal"
            value={minOrder}
            onChange={(e) => setMinOrder(e.target.value)}
          />
        )}
        {field('Tiempo estimado (minutos)',
          <Input
            type="number"
            min="1"
            max="1440"
            required
            value={etaMinutes}
            onChange={(e) => setEtaMinutes(e.target.value)}
          />
        )}
        {field('Prioridad',
          <Input
            type="number"
            min="-10000"
            max="10000"
            value={priority}
            onChange={(e) => setPriority(e.target.value)}
            title="Si las áreas se superponen, se usa la zona con mayor prioridad"
          />
        )}
      </div>

      <div className="flex items-center gap-3">
        <Switch checked={isActive} onCheckedChange={setIsActive} id="zone-active" />
        <Label htmlFor="zone-active" className="cursor-pointer">Zona habilitada para recibir pedidos</Label>
      </div>

      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">Usá el nombre del barrio o área que el cliente reconocerá. El precio se suma automáticamente al pedido. No hace falta dibujar un mapa.</p>
        <Button type="button" variant="outline" onClick={() => setShowMap(value => !value)} aria-expanded={showMap}>{showMap ? 'Ocultar mapa' : 'Dibujar área en el mapa (opcional)'}</Button>
        {showMap && <PolygonEditor
          value={polygon}
          onChange={setPolygon}
          center={
            location?.latitude && location?.longitude
              ? [Number(location.latitude), Number(location.longitude)]
              : undefined
          }
        />}
        {polygonError && (
          <p className="text-xs text-destructive mt-1">{polygonError}</p>
        )}
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving} className="flex-1">
          {saving ? 'Guardando…' : (initial ? 'Guardar cambios' : 'Crear zona')}
        </Button>
        <Button type="button" variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
      </div>
    </form>
  );
}
