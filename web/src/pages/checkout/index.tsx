import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CheckCircle2, Copy, Loader2, ShieldCheck, ShoppingBag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { FulfillmentPicker, OrderSummary } from '@/components/public-order';
import { getStore, createOrder, clearCart, readCart, readCartMeta, writeCart, writeCartMeta, type StoreDetail, type CheckoutOrderPayload, type Order } from '@/services/marketplace';
import { fulfillmentOptions, fulfillmentLabels, paymentLabel, orderTotals, publicMoney, reconcileCart, readSession, saveSession, checkoutRequestID, finishCheckout, type CheckoutDraft, type OrderLine } from '@/services/public-order';
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
  const [copyMessage, setCopyMessage] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [step, setStep] = useState<'details' | 'payment' | 'review'>('details');
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
  function advanceCheckout(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (step === 'details') {
      if (draft.fulfillment_type === 'dine_in' && !draft.table_label.trim()) { setError('Ingresá el número de mesa para identificar tu pedido.'); return; }
      if (draft.fulfillment_type !== 'dine_in' && draft.customer_name.trim().length < 2) { setError('Ingresá tu nombre para identificar el pedido.'); return; }
      if (draft.fulfillment_type !== 'dine_in' && draft.customer_phone.replace(/\D/g, '').length < 8) { setError('Ingresá un teléfono válido, con código de área.'); return; }
      if (draft.fulfillment_type === 'delivery' && draft.delivery_address.trim().length < 8) { setError('Completá calle, altura y localidad para la entrega.'); return; }
    } else if (!draft.on_delivery_method && draft.fulfillment_type !== 'dine_in') {
      setError('Elegí cómo vas a pagar.');
      return;
    }
    setError('');
    setStep(step === 'details' ? 'payment' : 'review');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function goBack() {
    setError('');
    setStep(step === 'review' ? 'payment' : 'details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  async function submit() {
    if (!store || sending.current || !items.length) return;
    sending.current = true;
    setSubmitting(true);
    setError('');
    const payload: CheckoutOrderPayload = {
      customer_name: draft.fulfillment_type === 'dine_in' ? '' : draft.customer_name.trim(),
      customer_phone: draft.fulfillment_type === 'dine_in' ? '' : draft.customer_phone.trim(),
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

  async function copyTransferValue(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyMessage('Dato copiado.'); }
    catch { setCopyMessage('No se pudo copiar automáticamente; mantené presionado el dato para copiarlo.'); }
  }

  const menuURL = slug ? '/store/' + encodeURIComponent(slug) : '/discover';
  if (!slug) return <main className="mx-auto max-w-lg space-y-4 p-6 py-20 text-center"><h1 className="text-2xl font-bold">Elegí un local para pedir</h1><Button asChild><Link to="/discover">Ver locales</Link></Button></main>;
  if (!store) return <main className="mx-auto max-w-lg space-y-4 p-6 py-20 text-center">{error ? <><p role="alert">{error}</p><Button onClick={() => setAttempt(n => n + 1)}>Volver a intentar</Button></> : <p role="status">Cargando tu pedido…</p>}<p><Link className="underline" to={menuURL}>Volver al menú</Link></p></main>;
  if (result) return <main className="mx-auto max-w-lg space-y-5 p-6 py-16 text-center"><CheckCircle2 className="mx-auto h-16 w-16 text-success" /><h1 className="text-2xl font-bold">¡Pedido recibido!</h1><p className="break-all">{result.order_number}</p><p>Total: {publicMoney(result.total_cents ?? Math.round(result.total * currencyScale(store.currency_code)), store)}</p><p>{result.payment_method === 'eft' ? 'El pedido quedó recibido y la transferencia pendiente de verificación por el local.' : draft.fulfillment_type === 'dine_in' ? 'El local recibió tu pedido. Pagás al final en caja.' : 'El local recibió tu pedido. Pagás al retirar o recibir.'}</p><Button asChild><Link to={menuURL}>Volver al menú</Link></Button></main>;
  if (!items.length) return <main className="mx-auto max-w-lg space-y-4 p-6 py-20 text-center"><ShoppingBag className="mx-auto h-12 w-12 text-primary" /><h1 className="text-2xl font-bold">Tu carrito está vacío</h1><p>Agregá productos del menú para continuar.</p><Button asChild><Link to={menuURL}>Elegir productos</Link></Button></main>;
  const isDineIn = draft.fulfillment_type === 'dine_in';
  const canUseMode = store.accepting_orders !== false && fulfillmentOptions(store).includes(draft.fulfillment_type);
  const paymentReady = (Boolean(draft.on_delivery_method) || isDineIn) && (draft.on_delivery_method !== 'eft' || Boolean(store.transfer_details?.account_holder && (store.transfer_details.alias || store.transfer_details.cbu)));
  const canOrder = canUseMode && paymentReady;
  const canAdvance = canUseMode && (step !== 'payment' || paymentReady);
  const total = orderTotals(items, store, draft.fulfillment_type).total;
  const itemCount = items.reduce((count, item) => count + item.quantity, 0);
  const reviewDetails: [string, string][] = [
    ['Modalidad', fulfillmentLabels[draft.fulfillment_type]],
    ...(!isDineIn ? [['Nombre', draft.customer_name], ['Teléfono', draft.customer_phone]] as [string, string][] : []),
    [isDineIn ? 'Número de mesa' : draft.fulfillment_type === 'delivery' ? 'Dirección de entrega' : 'Retiro en', isDineIn ? draft.table_label : draft.fulfillment_type === 'delivery' ? draft.delivery_address : store.address || store.name],
    ['Pago', draft.on_delivery_method ? paymentLabel(draft.on_delivery_method, draft.fulfillment_type) : (isDineIn ? 'A pagar al final en caja' : draft.on_delivery_method)],
    ['Aclaraciones', draft.notes || 'Sin aclaraciones'],
  ];

  return <div className="min-h-dvh bg-muted/20 pb-10">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-4"><Link to={menuURL} aria-label="Volver al menú" className="rounded-lg p-2 hover:bg-muted"><ArrowLeft className="h-5 w-5" /></Link><div className="min-w-0"><p className="truncate font-bold">{store.name}</p><p className="text-xs text-muted-foreground">Finalizar pedido · Sin registro</p></div></div></header>
    <main className="mx-auto max-w-5xl space-y-5 p-4 pb-32 sm:p-6 sm:pb-32 xl:pb-6">
      <ol aria-label="Pasos para completar el pedido" className="grid grid-cols-3 gap-2 text-xs sm:text-sm">
        {(['details', 'payment', 'review'] as const).map((current, index) => {
          const active = step === current;
          const complete = ['details', 'payment', 'review'].indexOf(step) > index;
          const labels = ['Entrega y contacto', 'Pago y aclaraciones', 'Revisar pedido'];
          return <li key={current} aria-current={active ? 'step' : undefined} className={cn('flex min-w-0 items-center gap-2 border-b-2 px-1 pb-2', active ? 'border-primary font-semibold text-primary' : complete ? 'border-success/60 text-foreground' : 'border-border text-muted-foreground')}><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-muted text-[11px]">{index + 1}</span><span className="leading-tight">{labels[index]}</span></li>;
        })}
      </ol>
      {notice && <p role="status" className="rounded-xl border bg-primary/5 p-4 text-sm">{notice}</p>}
      {error && <div role="alert" className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><button className="underline" type="button" onClick={() => { setStore(null); setAttempt(n => n + 1); }}>Actualizar precios y disponibilidad</button></div>}
      {!canUseMode && <p role="status" className="rounded-xl border p-4 text-sm">El local no está recibiendo pedidos con esta modalidad. Volvé al menú o consultá al local.</p>}
      <details className="rounded-2xl border bg-card px-4 py-3 xl:hidden">
        <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 text-sm font-semibold [&::-webkit-details-marker]:hidden">
          <span>Tu pedido <span className="font-normal text-muted-foreground">· {itemCount} productos</span></span>
          <span className="shrink-0 tabular-nums">{publicMoney(total, store)}</span>
        </summary>
        <div className="pt-2"><OrderSummary items={items} store={store} mode={draft.fulfillment_type} /></div>
      </details>
      <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {step !== 'review' ? <form id="checkout-step-form" onSubmit={advanceCheckout} className="min-w-0 space-y-6 rounded-2xl border bg-card p-4 sm:p-6">
          <h1 className="text-2xl font-bold">{step === 'details' ? '¿Cómo recibís tu pedido?' : 'Elegí cómo pagar'}</h1>
          {step === 'details' && <p className="flex items-start gap-2 rounded-xl bg-muted/60 p-3 text-sm text-muted-foreground"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{isDineIn ? 'El local recibe tu número de mesa y los datos necesarios para preparar el pedido; no pedimos nombre ni teléfono.' : 'Sin cuenta ni datos de tarjeta. El local recibe tu teléfono y, si elegís delivery, tu dirección para coordinar el pedido.'} <Link className="underline" to="/legal/privacy">Ver privacidad</Link>.</span></p>}
          {step === 'details' && <>
          <FulfillmentPicker store={store} value={draft.fulfillment_type} onChange={value => update('fulfillment_type', value)} />
          {draft.fulfillment_type !== 'dine_in' ? <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="customer-name">Nombre del cliente</Label><Input id="customer-name" autoComplete="name" autoCapitalize="words" required minLength={2} maxLength={100} placeholder="¿A nombre de quién?" value={draft.customer_name} onChange={e => update('customer_name', e.target.value)} className="h-12 text-base" /></div>
            <div className="space-y-2"><Label htmlFor="customer-phone">Teléfono de contacto</Label><Input id="customer-phone" type="tel" inputMode="tel" autoComplete="tel" required maxLength={24} placeholder="Código de área + número" value={draft.customer_phone} onChange={e => update('customer_phone', e.target.value)} className="h-12 text-base" /><p className="text-xs text-muted-foreground">Solo para coordinar este pedido. Incluí el código de área.</p></div>
          </div> : <p className="rounded-xl bg-muted/50 p-3 text-sm text-muted-foreground">Para comer en el local no hace falta dejar tu nombre ni teléfono: identificamos el pedido por el número de mesa.</p>}
          {draft.fulfillment_type === 'delivery' && <div className="space-y-2"><Label htmlFor="delivery-address">Dirección de entrega</Label><Textarea id="delivery-address" autoComplete="street-address" required minLength={8} maxLength={500} placeholder="Calle, altura, piso/depto y localidad" value={draft.delivery_address} onChange={e => update('delivery_address', e.target.value)} className="min-h-24 text-base" /></div>}
          {draft.fulfillment_type === 'collection' && <p className="rounded-xl bg-muted/50 p-3 text-sm">Retirás en {store.address || store.name}.</p>}
          {draft.fulfillment_type === 'dine_in' && <div className="space-y-2"><Label htmlFor="table-label">Número de mesa</Label><Input id="table-label" inputMode="numeric" autoComplete="off" required maxLength={60} placeholder="Por ejemplo: 4" value={draft.table_label} onChange={e => update('table_label', e.target.value)} className="h-12 text-base" /><p className="text-xs text-muted-foreground">Lo usamos para llevar el pedido a tu mesa.</p></div>}
          <Button type="submit" disabled={!canAdvance} className="hidden h-12 w-full rounded-xl xl:flex">Continuar al pago <ArrowRight className="ml-2 h-4 w-4" /></Button>
          </>}
          {step === 'payment' && <>
          <fieldset className="space-y-3"><legend className="font-semibold">¿Cómo vas a pagar?</legend><p className="text-sm text-muted-foreground">{isDineIn ? 'Podés elegir ahora o dejarlo para el final en caja.' : 'Elegí el medio que te resulte más cómodo.'}</p><div className="grid gap-2 sm:grid-cols-2">{(store.on_delivery_payment_methods || []).map(method => <label key={method} className={'flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-sm ' + (draft.on_delivery_method === method ? 'border-primary bg-primary/5 ring-1 ring-primary' : '')}><input type="radio" name="payment" required={!isDineIn} value={method} checked={draft.on_delivery_method === method} onChange={() => update('on_delivery_method', method)} />{paymentLabel(method, draft.fulfillment_type)}</label>)}</div>{isDineIn && !draft.on_delivery_method && <p className="rounded-lg bg-muted/60 p-3 text-sm">Sin elegir un medio ahora: el pedido queda pendiente y caja registra el pago al finalizar.</p>}{draft.on_delivery_method === 'eft' && store.transfer_details && <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4"><div><p className="font-semibold">Datos para transferir</p><p className="text-sm text-muted-foreground">El pago queda pendiente hasta que el local lo verifique.</p></div><dl className="space-y-2 text-sm">{[['Titular', store.transfer_details.account_holder], ['Alias', store.transfer_details.alias], ['CBU / CVU', store.transfer_details.cbu]].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, value]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="flex items-center gap-2 break-all font-semibold">{value}<button type="button" className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border bg-background px-2 text-xs" onClick={() => void copyTransferValue(value)} aria-label={'Copiar ' + label}><Copy className="h-3.5 w-3.5" />Copiar</button></dd></div>)}</dl>{copyMessage && <p role="status" className="text-xs">{copyMessage}</p>}</div>}{!canOrder && draft.on_delivery_method === 'eft' && <p role="alert" className="text-sm text-destructive">El local todavía no configuró los datos de transferencia. Elegí otro medio o consultá al local.</p>}</fieldset>
          <div className="space-y-2"><Label htmlFor="order-notes">Aclaraciones del pedido (opcional)</Label><Textarea id="order-notes" maxLength={500} placeholder="Indicaciones para la entrega o el local" value={draft.notes} onChange={e => update('notes', e.target.value)} className="min-h-24 text-base" /></div>
          <Button type="submit" disabled={!canAdvance} className="hidden h-12 w-full rounded-xl xl:flex">Revisar pedido <ArrowRight className="ml-2 h-4 w-4" /></Button>
          <p className="text-center text-xs text-muted-foreground">Todavía no se envía: vas a revisar tus datos antes de confirmar.</p>
          </>}
        </form> : <section className="min-w-0 space-y-5 rounded-2xl border bg-card p-4 sm:p-6">
          <h1 className="text-2xl font-bold">Revisá y confirmá</h1>
          <p className="text-sm text-muted-foreground">Al confirmar, el pedido se envía al local para su preparación.</p>
          <dl className="space-y-3 rounded-xl bg-muted/40 p-4 text-sm">
            {reviewDetails.map(([label, value]) => <div key={label} className="grid grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)] gap-3"><dt className="text-muted-foreground">{label}</dt><dd className="break-words font-medium">{value}</dd></div>)}
          </dl>
          {draft.on_delivery_method === 'eft' && <p className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">Al confirmar, el pedido se enviará al local. La transferencia quedará pendiente de verificación hasta que el local confirme el pago.</p>}
          <Button type="button" onClick={() => void submit()} disabled={submitting || !canOrder} className="hidden min-h-12 w-full whitespace-normal rounded-xl xl:flex">{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando pedido…</> : 'Confirmar pedido · ' + publicMoney(total, store)}</Button>
          <Button type="button" variant="outline" disabled={submitting} onClick={goBack} className="hidden h-11 w-full xl:flex">Volver a pago</Button>
          <p className="text-center text-xs text-muted-foreground">Después de confirmar vas a poder seguir el estado desde esta web.</p>
        </section>}
        <aside className="hidden min-w-0 self-start rounded-2xl border bg-card p-5 xl:sticky xl:top-5 xl:block"><div className="flex justify-between gap-2"><h2 className="text-lg font-bold">Tu pedido</h2><Link to={menuURL} className="text-sm text-primary underline">Editar</Link></div><OrderSummary items={items} store={store} mode={draft.fulfillment_type} /></aside>
      </div>
    </main>
    <div className="fixed inset-x-0 bottom-0 z-20 border-t bg-background/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur xl:hidden">
      {step === 'review' ? <div className="mx-auto flex max-w-5xl gap-2">
        <Button type="button" variant="outline" disabled={submitting} onClick={goBack} className="h-14 shrink-0 rounded-xl px-4"><ArrowLeft className="mr-1 h-4 w-4" />Volver</Button>
        <Button type="button" onClick={() => void submit()} disabled={submitting || !canOrder} className="h-14 min-w-0 flex-1 justify-between gap-2 rounded-xl px-3 text-sm sm:px-5">{submitting ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando…</> : <><span className="min-w-0 truncate">Confirmar pedido</span><span className="shrink-0 text-xs tabular-nums sm:text-sm">{publicMoney(total, store)}</span></>}</Button>
      </div> : <div className="mx-auto flex max-w-5xl gap-2">
        {step === 'payment' && <Button type="button" variant="outline" onClick={goBack} className="h-14 shrink-0 rounded-xl px-4"><ArrowLeft className="mr-1 h-4 w-4" />Volver</Button>}
        <Button type="submit" form="checkout-step-form" disabled={!canAdvance} className="h-14 min-w-0 flex-1 justify-between rounded-xl px-4 sm:px-5">
          <span>{step === 'details' ? 'Continuar al pago' : 'Revisar pedido'}</span>
          <span className="shrink-0 tabular-nums">{publicMoney(total, store)} <ArrowRight className="ml-1 inline h-4 w-4" /></span>
        </Button>
      </div>}
    </div>
  </div>;
}
