import { ShoppingBag, UtensilsCrossed, Truck, Minus, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { currencyScale } from '@/lib/currency';
import type { StoreDetail } from '@/services/marketplace';
import { fulfillmentLabels, fulfillmentOptions, orderTotals, publicMoney, type Fulfillment, type OrderLine } from '@/services/public-order';

const icons = { collection: ShoppingBag, dine_in: UtensilsCrossed, delivery: Truck };
export function FulfillmentPicker({ store, value, onChange, disabled = false }: {
  store: StoreDetail; value: Fulfillment; onChange: (value: Fulfillment) => void; disabled?: boolean;
}) {
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <legend className="text-base font-semibold">¿Cómo querés tu pedido?</legend>
    <div className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
      {fulfillmentOptions(store).map(mode => {
        const Icon = icons[mode];
        return <label key={mode} className={cn('flex min-h-20 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 px-2 py-3 text-center text-sm transition-colors sm:min-h-14 sm:flex-row sm:gap-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring', value === mode ? 'border-primary bg-primary/5 text-primary' : 'border-border bg-card')}>
          <input type="radio" name="fulfillment" value={mode} checked={value === mode} onChange={() => onChange(mode)} className="sr-only" />
          <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="font-semibold">{fulfillmentLabels[mode]}</span>
        </label>;
      })}
    </div>
  </fieldset>;
}

export function QuantityControl({ name, quantity, onMinus, onPlus, max = 99 }: {
  name: string; quantity: number; onMinus: () => void; onPlus: () => void; max?: number;
}) {
  return <div className="flex shrink-0 items-center gap-1 rounded-xl border bg-background p-1">
    <Button type="button" variant="ghost" size="icon" className="h-11 w-11" onClick={onMinus} aria-label={`Quitar uno de ${name}`}><Minus className="h-4 w-4" /></Button>
    <span className="min-w-6 text-center text-sm font-bold tabular-nums" aria-live="polite">{quantity}</span>
    <Button type="button" variant="ghost" size="icon" className="h-11 w-11" onClick={onPlus} disabled={quantity >= max} aria-label={`Agregar uno de ${name}`}><Plus className="h-4 w-4" /></Button>
  </div>;
}

export function DeliveryZonePicker({ store, value, onChange, subtotal }: { store: StoreDetail; value: string; onChange: (value: string) => void; subtotal: number }) {
  const zones = store.delivery_zones || [];
  if (!store.delivery_zones_required && !zones.length) return null;
  const selected = zones.find(zone => zone.id === value);
  return <div className="min-w-0 space-y-2 rounded-2xl border bg-card p-4">
    <label htmlFor="delivery-zone" className="block font-semibold">Zona de entrega</label>
    <select id="delivery-zone" required value={selected ? value : ''} onChange={event => onChange(event.target.value)} className="h-12 w-full min-w-0 rounded-xl border border-input bg-background px-3 text-base focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <option value="" disabled>Elegí tu barrio o zona</option>
      {zones.map(zone => <option key={zone.id} value={zone.id}>{zone.name} · {zone.delivery_fee_cents ? publicMoney(zone.delivery_fee_cents, store) : 'Sin cargo'}</option>)}
    </select>
    <p className="text-xs text-muted-foreground">Elegí la zona que corresponde a tu dirección. El envío se suma al total del pedido.</p>
    {!zones.length && <p role="alert" className="text-sm text-destructive">No hay zonas de entrega habilitadas. Elegí retiro en el local.</p>}
    {selected && <div className="space-y-1 text-sm"><p>Entrega estimada: {selected.estimated_eta_minutes} min.</p>{selected.min_order_cents > 0 && <p className={subtotal < selected.min_order_cents ? 'text-destructive' : 'text-muted-foreground'}>Pedido mínimo en productos: {publicMoney(selected.min_order_cents, store)}.{subtotal < selected.min_order_cents && ` Agregá ${publicMoney(selected.min_order_cents - subtotal, store)} para pedir en esta zona.`}</p>}</div>}
  </div>;
}

export function OrderSummary({ items, store, mode, zoneID = '' }: { items: OrderLine[]; store: StoreDetail; mode: Fulfillment; zoneID?: string }) {
  const totals = orderTotals(items, store, mode, zoneID);
  return <div className="min-w-0 space-y-4">
    <ul className="divide-y">
      {items.map(item => <li key={item.id} className="flex items-start justify-between gap-3 py-3 text-sm">
        <div className="min-w-0"><p className="break-words"><span className="font-semibold text-primary">{item.quantity}×</span> {item.name}</p>{item.notes && <p className="mt-1 break-words text-xs text-muted-foreground">{item.notes}</p>}</div>
        <span className="shrink-0 tabular-nums">{publicMoney(Math.round(item.price * currencyScale(store.currency_code)) * item.quantity, store)}</span>
      </li>)}
    </ul>
    <dl className="space-y-2 border-t pt-4 text-sm">
      <div className="flex justify-between gap-3"><dt>Productos</dt><dd>{publicMoney(totals.subtotal, store)}</dd></div>
      {totals.tax > 0 && <div className="flex justify-between gap-3"><dt>Impuestos</dt><dd>{publicMoney(totals.tax, store)}</dd></div>}
      {mode === 'delivery' && <div className="flex justify-between gap-3"><dt>Envío{totals.deliveryZone ? ` · ${totals.deliveryZone.name}` : ''}</dt><dd>{totals.deliveryPending ? 'Elegí zona' : totals.delivery > 0 ? publicMoney(totals.delivery, store) : 'Sin cargo'}</dd></div>}
      <div className="flex justify-between gap-3 pt-2 text-lg font-bold"><dt>{totals.deliveryPending ? 'Subtotal provisional' : 'Total'}</dt><dd>{publicMoney(totals.total, store)}</dd></div>
    </dl>
    <p className="text-xs text-muted-foreground">{store.currency_code === 'ARS' ? 'Precios en pesos argentinos.' : `Moneda: ${store.currency_code || 'consultar al local'}.`} {store.tax_inclusive !== false ? 'Impuestos incluidos.' : ''}</p>
  </div>;
}
