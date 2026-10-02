import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, Clock, MapPin, Plus, Search, ShieldCheck, ShoppingBag, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { FulfillmentPicker, OrderSummary, QuantityControl } from '@/components/public-order';
import { getStore, readCart, writeCart, readCartMeta, writeCartMeta, type StoreDetail, type MarketplaceMenuItem } from '@/services/marketplace';
import { fulfillmentOptions, orderTotals, publicMoney, reconcileCart, type OrderLine, type Fulfillment } from '@/services/public-order';
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
      setItems(cart.items);
      if (cart.changed) setNotice('Actualizamos tu carrito con los precios y productos disponibles.');
      setStore(data);
    }).catch(() => { if (active) setError('No pudimos cargar el menú. Comprobá tu conexión e intentá nuevamente.'); });
    return () => { active = false; };
  }, [slug, attempt, params]);

  useEffect(() => {
    if (!store) return;
    writeCart(slug, items);
    writeCartMeta(slug, { ...readCartMeta(slug), fulfillment_type: mode, table_label: tableLabel });
  }, [items, mode, slug, store, tableLabel]);

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

  const canOrder = store.accepting_orders !== false && fulfillmentOptions(store).length > 0;
  const count = items.reduce((n, i) => n + i.quantity, 0);
  const total = orderTotals(items, store, mode).total;
  const subtotal = orderTotals(items, store, mode).subtotal;
  const deliveryThreshold = store.free_delivery_threshold_cents ?? 0;
  const amountUntilFreeDelivery = Math.max(0, deliveryThreshold - subtotal);
  const normalize = (v: string) => v.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const categories = store.categories.filter(c => category === 'all' || c.id === category).map(c => ({ ...c,
    items: c.items.filter(i => normalize(i.name + ' ' + (i.description || '')).includes(normalize(query.trim()))),
  })).filter(c => c.items.length);
  const menuByID = new Map(store.categories.flatMap(c => c.items).map(i => [i.id, i]));
  const cart = <div className="space-y-4">
    <div className="flex items-center justify-between gap-3"><h2 className="text-xl font-bold">Tu pedido</h2>{count > 0 && <span className="rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{count}</span>}</div>
    {items.length ? <>
      <ul className="space-y-4">{items.map(item => <li key={item.id} className="space-y-2 border-b pb-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="min-w-0 flex-1 break-words font-medium">{item.name}</span><QuantityControl name={item.name} quantity={item.quantity} onMinus={() => remove(item.id)} onPlus={() => { const product = menuByID.get(item.id); if (product) add(product); }} max={Math.min(99, menuByID.get(item.id)?.remaining_today ?? 99)} /></div>
        <Input aria-label={'Aclaraciones para ' + item.name} placeholder="Sin cebolla, bien cocido… (opcional)" maxLength={300} value={item.notes} onChange={e => setItems(current => current.map(i => i.id === item.id ? { ...i, notes: e.target.value } : i))} />
      </li>)}</ul>
      <OrderSummary items={items} store={store} mode={mode} />
      {mode === 'delivery' && deliveryThreshold > 0 && <p className="rounded-xl bg-primary/5 p-3 text-sm" role="status">{amountUntilFreeDelivery > 0 ? `Te faltan ${publicMoney(amountUntilFreeDelivery, store)} para obtener envío gratis.` : '¡Tu envío es gratis con este pedido!'}</p>}
      <Button asChild className="h-12 w-full rounded-xl"><Link to={'/store/' + encodeURIComponent(slug) + '/checkout'} aria-disabled={!canOrder} onClick={e => { if (!canOrder) e.preventDefault(); }}>Continuar para finalizar <ArrowRight className="ml-2 h-4 w-4" /></Link></Button>
      <p className="flex items-center justify-center gap-1.5 text-center text-xs text-muted-foreground"><ShieldCheck className="h-3.5 w-3.5 shrink-0" />Sin registrarte. Revisás el total antes de confirmar y pagás al recibir.</p>
    </> : <div className="rounded-2xl border border-dashed p-8 text-center"><ShoppingBag className="mx-auto mb-3 h-9 w-9 text-muted-foreground" /><p className="font-medium">¿Qué vas a pedir hoy?</p><p className="mt-1 text-sm text-muted-foreground">Elegí tus favoritos del menú.</p></div>}
  </div>;

  return <div className="min-h-dvh bg-background pb-28 lg:pb-8">
    <header className="border-b bg-card"><div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4"><span className="flex min-w-0 items-center gap-2 font-bold"><UtensilsCrossed className="h-5 w-5 shrink-0 text-primary" /><span className="truncate">{store.name}</span></span><span className="shrink-0 text-xs text-muted-foreground">Pedidos online</span></div></header>
    <main className="mx-auto max-w-6xl space-y-6 px-4 pt-6 sm:px-6">
      <section className="rounded-3xl border border-primary/15 bg-primary/5 p-5 sm:p-8">
        <p className="mb-2 text-xs font-bold uppercase tracking-widest text-primary">Recién hecho, a tu manera</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">Hoy se come rico.</h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{store.description || 'Elegí lo que más te gusta de ' + store.name + '. Armá tu pedido y seguí su preparación desde acá.'}</p>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-muted-foreground">{store.address && <span className="flex items-center gap-1"><MapPin className="h-4 w-4" />{store.address}</span>}{store.estimated_prep_time_minutes > 0 && <span className="flex items-center gap-1"><Clock className="h-4 w-4" />Preparación estimada: {store.estimated_prep_time_minutes} min</span>}</div>
      </section>
      {!canOrder && <p role="status" className="rounded-xl border bg-muted p-4">Por el momento el local no recibe pedidos online. Podés consultar el menú y volver más tarde.</p>}
      {notice && <p role="status" className="rounded-xl bg-primary/10 p-3 text-sm">{notice}</p>}
      <FulfillmentPicker store={store} value={mode} onChange={setMode} />
      {mode === 'dine_in' && tableLabel && <p className="text-sm text-primary">Mesa: {tableLabel}. Podés cambiarla al confirmar.</p>}
      <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="sticky top-0 z-10 space-y-3 bg-background/95 py-3 backdrop-blur">
            <div className="relative"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><Input className="h-11 rounded-xl pl-10" aria-label="Buscar productos" placeholder="Buscá un producto…" value={query} onChange={e => setQuery(e.target.value)} /></div>
            <nav aria-label="Categorías del menú" className="flex gap-2 overflow-x-auto pb-1">
              {[{ id: 'all', name: 'Todo el menú' }, ...store.categories].map(c => <button type="button" key={c.id} aria-pressed={category === c.id} onClick={() => setCategory(c.id)} className={'min-h-11 shrink-0 rounded-full border px-4 text-sm font-medium ' + (category === c.id ? 'border-primary bg-primary text-primary-foreground' : 'bg-card')}>{c.name}</button>)}
            </nav>
          </div>
          <div className="space-y-7 pt-4">
            {!categories.length && <p className="rounded-2xl border border-dashed px-5 py-10 text-center text-muted-foreground">{query ? 'No encontramos productos con ese nombre.' : 'El local está actualizando su menú. Volvé a consultar en unos minutos.'}</p>}
            {categories.map(c => <section key={c.id} aria-labelledby={'category-' + c.id}><h2 id={'category-' + c.id} className="mb-3 text-xl font-bold">{c.name}</h2><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">{c.items.map(item => {
              const qty = items.find(i => i.id === item.id)?.quantity ?? 0;
              return <article key={item.id} className="flex min-w-0 flex-col rounded-2xl border bg-card p-4 shadow-sm">
                <div className="flex gap-3"><div className="min-w-0 flex-1"><h3 className="break-words font-semibold">{item.name}</h3>{item.description && <p className="mt-1 text-sm text-muted-foreground">{item.description}</p>}</div>{item.image_url && <img src={item.image_url} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-xl object-cover" />}</div>
                <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-4"><span className="font-bold tabular-nums">{publicMoney(Math.round(Number(item.price) * currencyScale(store.currency_code)), store)}</span>{canOrder && (qty ? <QuantityControl name={item.name} quantity={qty} onMinus={() => remove(item.id)} onPlus={() => add(item)} max={Math.min(99, item.remaining_today ?? 99)} /> : <Button className="h-11 rounded-xl" size="sm" onClick={() => add(item)} disabled={item.remaining_today === 0} aria-label={'Agregar ' + item.name}><Plus className="mr-1 h-4 w-4" />Agregar</Button>)}</div>
                {item.remaining_today != null && item.remaining_today < 10 && <p className="mt-2 text-xs text-muted-foreground">Quedan {item.remaining_today} disponibles</p>}
              </article>;
            })}</div></section>)}
          </div>
        </div>
        <aside className="sticky top-4 hidden max-h-[calc(100dvh-2rem)] self-start overflow-y-auto rounded-2xl border bg-card p-5 lg:block">{cart}</aside>
      </div>
      <footer className="flex flex-wrap justify-between gap-3 border-t pt-6 text-xs text-muted-foreground"><span>{store.name} · Pedidos online</span><Link to="/legal/privacy">Privacidad</Link></footer>
    </main>
    {count > 0 && <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden"><Button className="flex h-14 w-full justify-between rounded-xl px-5" onClick={() => setCartOpen(true)}><span className="flex items-center gap-2"><ShoppingBag className="h-5 w-5" />Ver pedido y finalizar ({count})</span><span>{publicMoney(total, store)}</span></Button></div>}
    <Sheet open={cartOpen} onOpenChange={setCartOpen}><SheetContent side="bottom" className="max-h-[90dvh] overflow-y-auto rounded-t-3xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-6"><SheetHeader className="mb-5 pr-8 text-left"><SheetTitle>Revisá tus productos</SheetTitle><SheetDescription>Podés ajustar cantidades y agregar aclaraciones.</SheetDescription></SheetHeader>{cart}</SheetContent></Sheet>
  </div>;
}
