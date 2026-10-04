import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Clock, MapPin, Plus, Search, ShieldCheck, ShoppingBag, StickyNote, UtensilsCrossed, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { DeliveryZonePicker, FulfillmentPicker, QuantityControl } from '@/components/public-order';
import { getStore, readCart, writeCart, readCartMeta, writeCartMeta, type StoreDetail, type MarketplaceMenuItem } from '@/services/marketplace';
import { fulfillmentLabels, fulfillmentOptions, orderTotals, publicMoney, reconcileCart, type OrderLine, type Fulfillment } from '@/services/public-order';
import { currencyScale } from '@/lib/currency';

export default function StoreDetailPage() {
  const { slug = '' } = useParams();
  return <Storefront key={slug} slug={slug} />;
}

function Storefront({ slug }: { slug: string }) {
  const [params] = useSearchParams();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [items, setItems] = useState<OrderLine[]>([]);
  const [mode, setMode] = useState<Fulfillment>('collection');
  const [cartOpen, setCartOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [tableLabel, setTableLabel] = useState('');
  const [zoneID, setZoneID] = useState('');

  useEffect(() => {
    let active = true;
    setError('');
    void getStore(slug).then(({ data, error: err }) => {
      if (!active) return;
      if (err || !data) { setError('Este menú no está disponible. Revisá el enlace o consultá al local.'); return; }
      const cart = reconcileCart(readCart(slug), data);
      const meta = readCartMeta(slug);
      const table = (params.get('mesa') || meta.table_label || '').slice(0, 60);
      const available = fulfillmentOptions(data);
      const requested = table ? 'dine_in' : meta.fulfillment_type;
      setMode(requested && available.includes(requested) ? requested : available[0] || 'collection');
      setTableLabel(table);
      setZoneID(data.delivery_zones?.some(zone => zone.id === meta.delivery_zone_id) ? meta.delivery_zone_id || '' : '');
      setItems(cart.items);
      if (cart.changed) setNotice('Actualizamos tu carrito con los precios y productos disponibles.');
      setStore(data);
    }).catch(() => { if (active) setError('No pudimos cargar el menú. Comprobá tu conexión e intentá nuevamente.'); });
    return () => { active = false; };
  }, [slug, attempt, params]);

  useEffect(() => {
    if (!store) return;
    writeCart(slug, items);
    writeCartMeta(slug, { ...readCartMeta(slug), fulfillment_type: mode, table_label: tableLabel, delivery_zone_id: zoneID });
  }, [items, mode, slug, store, tableLabel, zoneID]);

  function add(item: MarketplaceMenuItem) {
    if (!items.some(i => i.id === item.id) && items.length >= 20) {
      setNotice('El carrito admite hasta 20 productos diferentes por pedido. Quitá un producto para seguir.');
      return;
    }
    const existing = items.find(i => i.id === item.id);
    if ((existing?.quantity ?? 0) >= Math.min(99, item.remaining_today ?? 99)) return;
    setItems(current => {
      if (current.some(i => i.id === item.id)) return current.map(i => i.id === item.id ? { ...i, quantity: i.quantity + 1 } : i);
      return [...current, { id: item.id, name: item.name, price: Number(item.price), quantity: 1, notes: '' }];
    });
  }
  function remove(id: string) { setItems(current => current.map(i => i.id === id ? { ...i, quantity: i.quantity - 1 } : i).filter(i => i.quantity > 0)); }

  if (error) return <main className="mx-auto max-w-lg space-y-5 px-5 py-20 text-center"><ShoppingBag className="mx-auto h-12 w-12 text-primary" /><h1 className="text-2xl font-bold">No pudimos abrir el menú</h1><p role="alert">{error}</p><Button onClick={() => setAttempt(n => n + 1)}>Volver a intentar</Button></main>;
  if (!store) return <main className="mx-auto max-w-6xl animate-pulse space-y-6 p-5" role="status" aria-label="Cargando menú"><div className="h-44 rounded-3xl bg-muted" /><div className="h-20 rounded-2xl bg-muted" /><div className="grid gap-4 sm:grid-cols-2">{[0, 1, 2, 3].map(i => <div key={i} className="h-40 rounded-2xl bg-muted" />)}</div><span className="sr-only">Cargando menú…</span></main>;

  const fulfillmentModes = fulfillmentOptions(store);
  const canOrder = store.accepting_orders !== false && fulfillmentModes.length > 0;
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const totals = orderTotals(items, store, mode, zoneID);
  const total = totals.total;
  const subtotal = totals.subtotal;
  const deliveryThreshold = store.free_delivery_threshold_cents ?? 0;
  const amountUntilFreeDelivery = Math.max(0, deliveryThreshold - subtotal);
  const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const categories = store.categories.filter(c => category === 'all' || c.id === category).map(c => ({ ...c,
    items: c.items.filter(i => normalize(i.name + ' ' + (i.description || '')).includes(normalize(query.trim()))),
  })).filter(c => c.items.length);
  const menuByID = new Map(store.categories.flatMap(c => c.items).map(i => [i.id, i]));
  const cartLines = items.length ? <ul className="divide-y">{items.map(item => <li key={item.id} className="space-y-3 py-4 first:pt-0">
    <p className="break-words font-semibold leading-snug">{item.name}</p>
    <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium tabular-nums">{publicMoney(Math.round(item.price * currencyScale(store.currency_code)) * item.quantity, store)}</span><QuantityControl name={item.name} quantity={item.quantity} onMinus={() => remove(item.id)} onPlus={() => { const product = menuByID.get(item.id); if (product) add(product); }} max={Math.min(99, menuByID.get(item.id)?.remaining_today ?? 99)} /></div>
    <details open={Boolean(item.notes)} className="group">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><StickyNote className="h-4 w-4" />{item.notes ? 'Editar aclaración' : 'Agregar aclaración'} <span className="text-xs">(opcional)</span></summary>
      <Input className="text-base" aria-label={'Aclaraciones para ' + item.name} placeholder="Ej.: sin cebolla…" maxLength={300} value={item.notes} onChange={e => setItems(current => current.map(i => i.id === item.id ? { ...i, notes: e.target.value } : i))} />
    </details>
  </li>)}</ul> : <div className="rounded-2xl border border-dashed p-6 text-center"><ShoppingBag className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">¿Qué vas a pedir hoy?</p><p className="mt-1 text-sm text-muted-foreground">Elegí tus favoritos del menú.</p></div>;
  const cartFooter = items.length > 0 && <div className="space-y-3 border-t bg-card px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <dl className="space-y-2 border-t pt-3 text-sm">
        <div className="flex justify-between gap-3"><dt>Productos</dt><dd>{publicMoney(totals.subtotal, store)}</dd></div>
        {totals.tax > 0 && <div className="flex justify-between gap-3"><dt>Impuestos</dt><dd>{publicMoney(totals.tax, store)}</dd></div>}
        {mode === 'delivery' && <div className="flex justify-between gap-3"><dt>Envío{totals.deliveryZone ? ` · ${totals.deliveryZone.name}` : ''}</dt><dd>{totals.deliveryPending ? 'Elegí zona' : totals.delivery > 0 ? publicMoney(totals.delivery, store) : 'Sin cargo'}</dd></div>}
        <div className="flex justify-between gap-3 pt-1 text-lg font-bold"><dt>{totals.deliveryPending ? 'Subtotal provisional' : 'Total'}</dt><dd>{publicMoney(total, store)}</dd></div>
      </dl>
      {mode === 'delivery' && deliveryThreshold > 0 && <p className="rounded-xl bg-primary/5 p-3 text-sm" role="status">{amountUntilFreeDelivery > 0 ? `Te faltan ${publicMoney(amountUntilFreeDelivery, store)} para obtener envío gratis.` : '¡Tu envío es gratis con este pedido!'}</p>}
      <Button asChild className="h-14 w-full rounded-xl text-base"><Link to={'/store/' + encodeURIComponent(slug) + '/checkout'} aria-disabled={!canOrder} onClick={e => { if (!canOrder) e.preventDefault(); }}>Continuar <ArrowRight className="h-4 w-4" /></Link></Button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />Sin registrarte. Revisás el total antes de confirmar.</p>
    </div>;

  return <div className="min-h-dvh bg-background pb-28 lg:pb-8">
    <header className="border-b bg-card"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4"><span className="flex min-w-0 items-center gap-2 font-bold"><UtensilsCrossed className="h-5 w-5 shrink-0 text-primary" /><span className="truncate">{store.name}</span></span><span className="shrink-0 text-xs text-muted-foreground">Pedidos online</span></div></header>
    <main className="mx-auto max-w-6xl space-y-4 px-4 pt-4 sm:px-6 sm:pt-5">
      <section className="rounded-3xl border border-primary/15 bg-primary/5 p-4 sm:p-6">
        <p className="mb-1.5 text-[11px] font-bold uppercase tracking-widest text-primary">Recién hecho, a tu manera</p>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Hoy se come rico.</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{store.description || 'Elegí lo que más te gusta de ' + store.name + '. Armá tu pedido y seguí su preparación desde acá.'}</p>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          {store.address && <span className="flex items-center gap-1"><MapPin className="h-4 w-4 shrink-0" />{store.address}</span>}
          {store.estimated_prep_time_minutes > 0 && <span className="flex items-center gap-1"><Clock className="h-4 w-4 shrink-0" />Listo en aprox. {store.estimated_prep_time_minutes} min</span>}
          {fulfillmentModes.length === 1 && <span className="rounded-full border border-primary/20 bg-background/70 px-2.5 py-1 font-medium text-foreground">{fulfillmentLabels[fulfillmentModes[0]]}</span>}
        </div>
      </section>
      {!canOrder && <p role="status" className="rounded-xl border bg-muted p-4">Por el momento el local no recibe pedidos online. Podés consultar el menú y volver más tarde.</p>}
      {notice && <p role="status" className="rounded-xl bg-primary/10 p-3 text-sm">{notice}</p>}
      {fulfillmentModes.length > 1 && <FulfillmentPicker store={store} value={mode} onChange={setMode} />}
      {mode === 'delivery' && <DeliveryZonePicker store={store} value={zoneID} onChange={setZoneID} subtotal={subtotal} />}
      {mode === 'dine_in' && tableLabel && <p className="text-sm text-primary">Mesa: {tableLabel}. Podés cambiarla al confirmar.</p>}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="sticky top-0 z-10 space-y-3 bg-background/95 py-3 backdrop-blur">
            <div className="relative"><Search className="absolute left-3 top-4 h-4 w-4 text-muted-foreground" /><Input className="h-12 rounded-xl pl-10 pr-12 text-base" aria-label="Buscar productos" placeholder="Buscá un producto…" value={query} onChange={e => setQuery(e.target.value)} />{query && <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-10 w-10" onClick={() => setQuery('')} aria-label="Limpiar búsqueda"><X /></Button>}</div>
            <nav aria-label="Categorías del menú" className="flex gap-2 overflow-x-auto pb-1">
              {[{ id: 'all', name: 'Todo el menú' }, ...store.categories].map(c => <button type="button" key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ' + (category === c.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{c.name}</button>)}
            </nav>
          </div>
          <div className="space-y-7 pt-4">
            {!categories.length && <div className="rounded-2xl border border-dashed px-5 py-10 text-center text-muted-foreground"><p>{query ? 'No encontramos productos con ese nombre.' : 'El local está actualizando su menú. Volvé a consultar en unos minutos.'}</p>{(query || category !== 'all') && <Button className="mt-3" variant="outline" onClick={() => { setQuery(''); setCategory('all'); }}>Ver todo el menú</Button>}</div>}
            {categories.map(c => <section key={c.id} aria-labelledby={'category-' + c.id}><h2 id={'category-' + c.id} className="mb-3 text-xl font-bold">{c.name}</h2><div className="grid gap-3 sm:grid-cols-2">{c.items.map(item => {
              const qty = items.find(i => i.id === item.id)?.quantity ?? 0;
              return <article key={item.id} className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex gap-3"><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{item.name}</h3>{item.description && <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{item.description}</p>}</div>{item.image_url && <img src={item.image_url} alt="" loading="lazy" className="h-16 w-16 shrink-0 rounded-xl object-cover xl:h-20 xl:w-20" />}</div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4"><span className="font-bold tabular-nums">{publicMoney(Math.round(Number(item.price) * currencyScale(store.currency_code)), store)}</span>{canOrder && (qty ? <QuantityControl name={item.name} quantity={qty} onMinus={() => remove(item.id)} onPlus={() => add(item)} max={Math.min(99, item.remaining_today ?? 99)} /> : <Button className="h-11 rounded-xl" size="sm" onClick={() => add(item)} disabled={item.remaining_today === 0} aria-label={'Agregar ' + item.name}><Plus className="mr-1 h-4 w-4" />Agregar</Button>)}</div>
                {item.remaining_today != null && item.remaining_today < 10 && <p className="mt-2 text-xs text-muted-foreground">Quedan {item.remaining_today} disponibles</p>}
              </article>;
            })}</div></section>)}
          </div>
        </div>
        <aside aria-label="Tu pedido" className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] min-h-0 flex-col self-start overflow-hidden rounded-2xl border bg-card shadow-sm lg:flex">
          <div className="flex shrink-0 items-center justify-between gap-3 border-b p-4"><h2 className="text-xl font-bold">Tu pedido</h2><span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{count}</span></div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{cartLines}</div>{cartFooter}
        </aside>
      </div>
      <footer className="flex flex-wrap justify-between gap-3 border-t pt-6 text-xs text-muted-foreground"><span>{store.name} · Pedidos online</span><Link to="/legal/privacy">Privacidad</Link></footer>
    </main>
    {count > 0 && <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"><Button className="flex h-14 w-full justify-between rounded-xl px-4 text-base sm:px-5" onClick={() => setCartOpen(true)}><span className="flex min-w-0 items-center gap-2"><ShoppingBag className="h-5 w-5 shrink-0" /><span className="truncate">Ver pedido · {count}</span></span><span className="flex shrink-0 items-center gap-2 tabular-nums">{publicMoney(total, store)}<ArrowRight /></span></Button></div>}
    <span className="sr-only" role="status">{count} productos en tu pedido.</span>
    <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent side="bottom" className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden rounded-t-3xl p-0 sm:mx-auto sm:max-w-xl"><SheetHeader className="shrink-0 border-b p-4 pr-14 text-left"><SheetTitle>Tu pedido · {count}</SheetTitle><SheetDescription>Ajustá cantidades y aclaraciones antes de continuar.</SheetDescription></SheetHeader><div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4">{cartLines}</div>{cartFooter}</SheetContent></Sheet>
  </div>;
}
