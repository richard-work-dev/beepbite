import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, ShieldCheck, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FulfillmentPicker, OrderSummary } from '@/components/public-order';
import { getStore, createOrder, clearCart, readCart, readCartMeta, writeCart, writeCartMeta, type StoreDetail, type CheckoutOrderPayload, type Order } from '@/services/marketplace';
import { fulfillmentOptions, fulfillmentLabels, paymentLabels, orderTotals, publicMoney, reconcileCart, readSession, saveSession, checkoutRequestID, finishCheckout, type CheckoutDraft, type OrderLine } from '@/services/public-order';
import { currencyScale } from '@/lib/currency';

export default function CheckoutPage() {
  const { slug: routeSlug } = useParams();
  const location = useLocation();
  const legacy = location.state as { slug?: string } | null;
  const slug = routeSlug || legacy?.slug || '';
  return <Checkout key={slug} slug={slug} />;
}

function Checkout({ slug }: { slug: string }) {
  const navigate = useNavigate();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [items, setItems] = useState<OrderLine[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<'details' | 'review'>('details');
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<Order | null>(null);
  const sending = useRef(false);
  const [draft, setDraft] = useState<CheckoutDraft>(() => {
    const meta = readCartMeta(slug);
    return readSession<CheckoutDraft>('bb.checkout-draft.' + slug) || {
      customer_name: '', customer_phone: '', notes: '', delivery_address: meta.delivery_address || '',
      table_label: meta.table_label || '', fulfillment_type: meta.fulfillment_type || 'collection', on_delivery_method: '',
    };
  });

  useEffect(() => {
    if (!slug) return;
    let active = true;
    setError('');
    void getStore(slug).then(({ data, error: err }) => {
      if (!active) return;
      if (err || !data) { setError('No pudimos cargar los datos del local. Volvé a intentar.'); return; }
      const cart = reconcileCart(readCart(slug), data);
      setItems(cart.items);
      writeCart(slug, cart.items);
      if (cart.changed) { setNotice('El menú cambió. Actualizamos los productos, cantidades y precios de tu pedido. Revisalos antes de confirmar.'); setStep('details'); }
      const modes = fulfillmentOptions(data);
      const methods = data.on_delivery_payment_methods || [];
      setDraft(prev => ({ ...prev,
        fulfillment_type: modes.includes(prev.fulfillment_type) ? prev.fulfillment_type : modes[0] || 'collection',
        on_delivery_method: methods.includes(prev.on_delivery_method) ? prev.on_delivery_method : methods[0] || '',
      }));
      setStore(data);
    }).catch(() => { if (active) setError('No pudimos conectar con el local. Tu carrito sigue guardado.'); });
    return () => { active = false; };
  }, [slug, attempt]);

  useEffect(() => {
    if (result) return;
    saveSession('bb.checkout-draft.' + slug, draft);
    writeCartMeta(slug, { fulfillment_type: draft.fulfillment_type, delivery_address: draft.delivery_address, table_label: draft.table_label });
  }, [draft, slug, result]);

  function update<K extends keyof CheckoutDraft>(key: K, value: CheckoutDraft[K]) {
    setDraft(prev => ({ ...prev, [key]: value }));
    setError('');
  }
  function review(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (draft.customer_name.trim().length < 2) { setError('Ingresá tu nombre para identificar el pedido.'); return; }
    if (draft.customer_phone.replace(/\D/g, '').length < 8) { setError('Ingresá un teléfono válido, con código de área.'); return; }
    if (draft.fulfillment_type === 'delivery' && draft.delivery_address.trim().length < 8) { setError('Completá calle, altura y localidad para la entrega.'); return; }
    if (!draft.on_delivery_method) { setError('Elegí cómo vas a pagar.'); return; }
    setError('');
    setStep('review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function submit() {
    if (!store || sending.current || !items.length) return;
    sending.current = true;
    setSubmitting(true);
    setError('');
    const payload: CheckoutOrderPayload = {
      customer_name: draft.customer_name.trim(), customer_phone: draft.customer_phone.trim(),
      fulfillment_type: draft.fulfillment_type, on_delivery_method: draft.on_delivery_method,
      notes: draft.notes.trim(),
      ...(draft.fulfillment_type === 'delivery' ? { delivery_address: draft.delivery_address.trim() } : {}),
      ...(draft.fulfillment_type === 'dine_in' ? { table_label: draft.table_label.trim() } : {}),
      items: items.map(i => ({ item_id: i.id, quantity: i.quantity, notes: i.notes })),
      expected_total_cents: orderTotals(items, store, draft.fulfillment_type).total,
    };
    payload.request_id = checkoutRequestID(slug, payload);
    try {
      const { data, error: err } = await createOrder(slug, payload);
      if (err || !data?.order_id) {
        setError(err?.message || 'No recibimos la confirmación. Reintentá desde acá para evitar duplicados.');
        if (err?.status === 409 || err?.status === 422) setStep('details');
        return;
      }
      clearCart(slug);
      finishCheckout(slug);
      setResult(data);
      if (data.tracking_token) {
        saveSession('bb.last-order.' + slug, data.tracking_token);
        void navigate('/track/' + encodeURIComponent(data.tracking_token), { replace: true });
      }
    } catch {
      setError('Se cortó la conexión. Podés volver a confirmar: recuperaremos el mismo pedido si ya fue recibido.');
    } finally {
      sending.current = false;
      setSubmitting(false);
    }
  }

  const menuURL = slug ? '/store/' + encodeURIComponent(slug) : '/discover';
  if (!slug) return <main className="mx-auto max-w-lg space-y-4 p-6 py-20 text-center"><h1 className="text-2xl font-bold">Elegí un local para pedir</h1><Button asChild><Link to="/discover">Ver locales</Link></Button></main>;
  if (!store) return <main className="mx-auto max-w-lg space-y-4 p-6 py-20 text-center">{error ? <><p role="alert">{error}</p><Button onClick={() => setAttempt(n => n + 1)}>Volver a intentar</Button></> : <p role="status">Cargando tu pedido…</p>}<p><Link className="underline" to={menuURL}>Volver al menú</Link></p></main>;
  if (result) return <main className="mx-auto max-w-lg space-y-5 p-6 py-16 text-center"><CheckCircle2 className="mx-auto h-16 w-16 text-success" /><h1 className="text-2xl font-bold">¡Pedido recibido!</h1><p className="break-all">{result.order_number}</p><p>Total: {publicMoney(result.total_cents ?? Math.round(result.total * currencyScale(store.currency_code)), store)}</p><p>El local recibió tu pedido. Pagás al recibir.</p><Button asChild><Link to={menuURL}>Volver al menú</Link></Button></main>;
  if (!items.length) return <main className="mx-auto max-w-lg space-y-4 p-6 py-20 text-center"><ShoppingBag className="mx-auto h-12 w-12 text-primary" /><h1 className="text-2xl font-bold">Tu carrito está vacío</h1><p>Agregá productos del menú para continuar.</p><Button asChild><Link to={menuURL}>Elegir productos</Link></Button></main>;
  const canOrder = store.accepting_orders !== false && fulfillmentOptions(store).includes(draft.fulfillment_type) && Boolean(draft.on_delivery_method);
  const total = orderTotals(items, store, draft.fulfillment_type).total;

  return <div className="min-h-dvh bg-muted/20 pb-10">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4"><Link to={menuURL} aria-label="Volver al menú" className="rounded-lg p-2 hover:bg-muted"><ArrowLeft className="h-5 w-5" /></Link><div className="min-w-0"><p className="truncate font-bold">{store.name}</p><p className="text-xs text-muted-foreground">Finalizar pedido · Sin registro</p></div></div></header>
    <main className="mx-auto max-w-5xl space-y-5 p-4 pb-32 sm:p-6 sm:pb-32 xl:pb-6">
      <ol aria-label="Pasos del pedido" className="flex flex-wrap gap-3 text-sm"><li className="text-muted-foreground">1. Productos</li><li aria-current={step === 'details' ? 'step' : undefined} className={step === 'details' ? 'font-bold text-primary' : ''}>2. Tus datos</li><li aria-current={step === 'review' ? 'step' : undefined} className={step === 'review' ? 'font-bold text-primary' : 'text-muted-foreground'}>3. Confirmar</li></ol>
      {notice && <p role="status" className="rounded-xl border bg-primary/5 p-4 text-sm">{notice}</p>}
      {error && <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><button className="underline" type="button" onClick={() => { setStore(null); setAttempt(n => n + 1); }}>Actualizar precios y disponibilidad</button></div>}
      {!canOrder && <p role="status" className="rounded-xl border p-4 text-sm">El local no está recibiendo pedidos con esta configuración. Volvé al menú o consultá al local.</p>}
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {step === 'details' ? <form id="checkout-details-form" onSubmit={review} className="min-w-0 space-y-6 rounded-2xl border bg-card p-4 sm:p-6">
          <h1 className="text-2xl font-bold">Ya casi está.</h1>
          <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>Sin cuenta ni datos de tarjeta. El local recibe tu teléfono y, si elegís delivery, tu dirección para coordinar el pedido. <Link className="underline" to="/legal/privacy">Ver privacidad</Link>.</span></p>
          <FulfillmentPicker store={store} value={draft.fulfillment_type} onChange={value => update('fulfillment_type', value)} />
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="customer-name">Tu nombre</Label><Input id="customer-name" autoComplete="name" required minLength={2} maxLength={100} placeholder="¿A nombre de quién?" value={draft.customer_name} onChange={e => update('customer_name', e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="customer-phone">Teléfono de contacto</Label><Input id="customer-phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={24} placeholder="Código de área + número" value={draft.customer_phone} onChange={e => update('customer_phone', e.target.value)} /><p className="text-xs text-muted-foreground">Solo para coordinar este pedido. Incluí el código de área.</p></div>
          </div>
          {draft.fulfillment_type === 'delivery' && <div className="space-y-2"><Label htmlFor="delivery-address">Dirección de entrega</Label><Textarea id="delivery-address" autoComplete="street-address" required minLength={8} maxLength={500} placeholder="Calle, altura, piso/depto y localidad" value={draft.delivery_address} onChange={e => update('delivery_address', e.target.value)} /></div>}
          {draft.fulfillment_type === 'collection' && <p className="rounded-xl bg-muted/50 p-3 text-sm">Retirás en {store.address || store.name}.</p>}
          {draft.fulfillment_type === 'dine_in' && <div className="space-y-2"><Label htmlFor="table-label">Mesa o referencia (opcional)</Label><Input id="table-label" maxLength={60} placeholder="Por ejemplo: Mesa 4" value={draft.table_label} onChange={e => update('table_label', e.target.value)} /></div>}
          <fieldset className="space-y-3"><legend className="font-semibold">¿Cómo vas a pagar?</legend><p className="text-sm text-muted-foreground">Pagás al recibir o en el local.</p><div className="flex flex-wrap gap-3">{(store.on_delivery_payment_methods || []).map(method => <label key={method} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-4 py-3 text-sm"><input type="radio" name="payment" required value={method} checked={draft.on_delivery_method === method} onChange={() => update('on_delivery_method', method)} />{paymentLabels[method] || method}</label>)}</div></fieldset>
          <div className="space-y-2"><Label htmlFor="order-notes">Aclaraciones del pedido (opcional)</Label><Textarea id="order-notes" maxLength={500} placeholder="Indicaciones para la entrega o el local" value={draft.notes} onChange={e => update('notes', e.target.value)} /></div>
          <Button type="submit" disabled={!canOrder} className="hidden h-12 w-full rounded-xl xl:flex">Revisar pedido · {publicMoney(total, store)} <ArrowRight className="ml-2 h-4 w-4" /></Button>
          <p className="text-center text-xs text-muted-foreground">Todavía no se envía: vas a revisar los datos y confirmar en el siguiente paso.</p>
        </form> : <section className="min-w-0 space-y-5 rounded-2xl border bg-card p-4 sm:p-6">
          <h1 className="text-2xl font-bold">Revisá y confirmá</h1>
          <p className="text-sm text-muted-foreground">Al confirmar, el pedido se envía al local para su preparación.</p>
          <dl className="space-y-3 rounded-xl bg-muted/40 p-4 text-sm">
            {[['Modalidad', fulfillmentLabels[draft.fulfillment_type]], ['Nombre', draft.customer_name], ['Teléfono', draft.customer_phone], [draft.fulfillment_type === 'delivery' ? 'Entregar en' : draft.fulfillment_type === 'dine_in' ? 'Mesa / referencia' : 'Retiro en', draft.fulfillment_type === 'delivery' ? draft.delivery_address : draft.fulfillment_type === 'dine_in' ? draft.table_label || 'Sin referencia' : store.address || store.name], ['Pago', paymentLabels[draft.on_delivery_method] || draft.on_delivery_method], ['Aclaraciones', draft.notes || 'Sin aclaraciones']].map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
          </dl>
          <div className="xl:hidden"><OrderSummary items={items} store={store} mode={draft.fulfillment_type} /></div>
          <Button type="button" onClick={() => void submit()} disabled={submitting || !canOrder} className="h-auto min-h-12 w-full whitespace-normal rounded-xl py-3">{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando pedido…</> : 'Confirmar pedido · ' + publicMoney(total, store)}</Button>
          <Button type="button" variant="outline" disabled={submitting} onClick={() => setStep('details')} className="h-11 w-full">Editar mis datos</Button>
          <p className="text-center text-xs text-muted-foreground">Después de confirmar vas a poder seguir el estado desde esta web.</p>
        </section>}
        <aside className={'min-w-0 self-start rounded-2xl border bg-card p-5 xl:sticky xl:top-5 ' + (step === 'review' ? 'hidden xl:block' : '')}><div className="flex justify-between gap-2"><h2 className="text-lg font-bold">Tu pedido</h2><Link to={menuURL} className="text-sm text-primary underline">Editar</Link></div><OrderSummary items={items} store={store} mode={draft.fulfillment_type} /></aside>
      </div>
    </main>
    {step === 'details' && <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur xl:hidden"><Button type="submit" form="checkout-details-form" disabled={!canOrder} className="h-14 w-full justify-between rounded-xl px-4 sm:px-5"><span>Revisar pedido</span><span className="tabular-nums">{publicMoney(total, store)} <ArrowRight className="ml-1 inline h-4 w-4" /></span></Button></div>}
  </div>;
}
