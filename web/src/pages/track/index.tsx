import { Suspense, lazy, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Check, CheckCircle2, ChefHat, Copy, MapPin, RefreshCw, ShoppingBag, Truck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchTracking, type TrackingPayload } from '@/services/tracking';
import { formatMoney } from '@/lib/currency';
import { fulfillmentLabels, paymentLabel, type Fulfillment } from '@/services/public-order';

const terminalStatuses = new Set(['completed', 'delivered', 'cancelled']);
const TrackingMap = lazy(() => import('./components/TrackingMap'));

export default function TrackOrderPage() {
  const { token = '' } = useParams();
  return <Tracking key={token} token={token} />;
}

function Tracking({ token }: { token: string }) {
  const [tracking, setTracking] = useState<TrackingPayload | null>(null);
  const [error, setError] = useState('');
  const [unavailable, setUnavailable] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [copyMessage, setCopyMessage] = useState('');
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      let finished = false;
      try {
        const { data, error: err } = await fetchTracking(token);
        if (!active) return;
        if (err || !data) {
          const missing = err?.status === 404;
          setUnavailable(missing);
          setError(missing ? 'El enlace no existe o venció. Consultá al local con tu número de pedido.' : 'No pudimos actualizar el estado. Reintentaremos automáticamente.');
          finished = missing;
        } else {
          setTracking(data); setError(''); setUnavailable(false); setUpdated(new Date());
          finished = terminalStatuses.has(data.status);
        }
      } catch {
        if (active) setError('Se interrumpió la conexión. Conservamos el último estado recibido.');
      } finally {
        if (active && !finished) timer = setTimeout(() => { void load(); }, 10000);
      }
    }
    void load();
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [token, attempt]);

  async function copyBankDetail(value: string) {
    try { await navigator.clipboard.writeText(value); setCopyMessage('Dato bancario copiado.'); }
    catch { setCopyMessage('Mantené presionado el dato para copiarlo.'); }
  }

  async function copyLink() {
    try { await navigator.clipboard.writeText(window.location.href); setCopyMessage('Enlace copiado'); }
    catch { setCopyMessage('Podés guardar el enlace desde la barra de direcciones.'); }
  }

  if (!tracking) return <main className="mx-auto max-w-lg space-y-5 px-5 py-20 text-center"><ShoppingBag className="mx-auto h-12 w-12 text-primary" /><h1 className="text-2xl font-bold">{unavailable ? 'Seguimiento no disponible' : 'Seguimiento de tu pedido'}</h1>{error ? <><p role="alert">{error}</p>{!unavailable && <Button onClick={() => setAttempt(n => n + 1)}>Volver a intentar</Button>}</> : <p role="status">Consultando el estado…</p>}</main>;

  const mode = tracking.fulfillmentType;
  const delivery = mode === 'delivery';
  const collected = mode === 'collection' || mode === 'pickup';
  // Only delivery orders can be in transit; old or malformed pickup/local
  // orders with that status stay on the truthful "ready" step.
  const status = tracking.status === 'out_for_delivery' && !delivery ? 'ready' : tracking.status;
  const done = status === 'completed' || status === 'delivered';
  const cancelled = status === 'cancelled';
  const steps = [
    { label: 'Recibido', icon: ShoppingBag },
    { label: 'En preparación', icon: ChefHat },
    { label: collected ? 'Listo para retirar' : 'Listo', icon: CheckCircle2 },
    ...(delivery ? [{ label: 'En camino', icon: Truck }] : []),
    { label: delivery ? 'Entregado' : collected ? 'Retirado' : 'Completado', icon: Check },
  ];
  const index = done ? steps.length - 1 : status === 'out_for_delivery' && delivery ? 3 : status === 'ready' ? 2 : status === 'preparing' ? 1 : 0;
  const title = cancelled ? 'Pedido cancelado' : done ? '¡Que lo disfrutes!' : status === 'out_for_delivery' ? 'Tu pedido está en camino' : status === 'ready' ? collected ? '¡Ya podés retirar tu pedido!' : '¡Tu pedido está listo!' : status === 'preparing' ? 'Estamos preparando tu pedido' : '¡Recibimos tu pedido!';
  const money = (value: number) => formatMoney(value, { currency: tracking.currency, locale: tracking.locale || 'es-AR' });
  const menuURL = tracking.store?.slug ? '/store/' + encodeURIComponent(tracking.store.slug) : null;
  const whatsappDigits = (tracking.store?.whatsapp_number || '').replace(/\D/g, '');
  const countryDigits = (tracking.store?.phone_country_code || '').replace(/\D/g, '');
  const contactDigits = countryDigits && !whatsappDigits.startsWith(countryDigits) ? countryDigits + whatsappDigits : whatsappDigits;
  const whatsappURL = contactDigits ? 'https://wa.me/' + contactDigits + '?text=' + encodeURIComponent('Hola, consulto por el pago del pedido ' + (tracking.orderNumber || '') + '.') : '';

  return <div className="min-h-dvh bg-muted/20 pb-10">
    <header className="border-b bg-background"><div className="mx-auto flex max-w-2xl items-center justify-between gap-3 px-4 py-4"><p className="min-w-0 truncate font-bold">{tracking.store?.name || 'Tu pedido'}</p>{menuURL && <Link to={menuURL} className="shrink-0 text-sm text-primary underline">Ver menú</Link>}</div></header>
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      <section className={'rounded-3xl border p-6 text-center ' + (cancelled ? 'border-destructive/30 bg-destructive/5' : 'border-primary/20 bg-primary/5')}>
        <CheckCircle2 className={'mx-auto mb-4 h-12 w-12 ' + (cancelled ? 'text-destructive' : 'text-primary')} />
        <h1 className="text-2xl font-bold" aria-live="polite">{title}</h1>
        <p className="mt-2 break-all text-sm font-semibold">{tracking.orderNumber}</p>
        <p className="mt-2 text-sm text-muted-foreground">{cancelled ? 'Consultá al local si necesitás ayuda.' : done ? 'Gracias por elegirnos.' : 'Podés seguir la preparación desde este enlace. No hace falta enviar un mensaje.'}</p>
        {!done && !cancelled && index < 2 && Boolean(tracking.prepMinutes) && <p className="mt-3 text-sm">Preparación estimada: {tracking.prepMinutes} minutos. Puede variar según la demanda.</p>}
      </section>
      {error && <p role="alert" className="rounded-xl border bg-card p-3 text-sm">{error}</p>}
      {!cancelled && <section className="rounded-2xl border bg-card p-5"><h2 className="mb-5 font-bold">Estado del pedido</h2><ol className="space-y-4">{steps.map((step, i) => {
        const Icon = step.icon;
        return <li key={step.label} aria-current={i === index ? 'step' : undefined} className={'flex items-center gap-3 ' + (i > index ? 'text-muted-foreground' : 'text-primary')}><span className={'flex h-9 w-9 items-center justify-center rounded-full ' + (i <= index ? 'bg-primary/10' : 'bg-muted')}>{i < index ? <Check className="h-4 w-4" /> : <Icon className="h-4 w-4" />}</span><span className={i === index ? 'font-bold' : 'text-sm'}>{step.label}</span>{i === index && !done && <span className="ml-auto text-xs">Actual</span>}</li>;
      })}</ol></section>}
      <section className="space-y-4 rounded-2xl border bg-card p-5">
        <h2 className="font-bold">Detalle de tu pedido</h2>
        <p className="text-sm">{fulfillmentLabels[mode as Fulfillment] || (collected ? 'Para llevar' : mode)}</p>
        {(delivery ? tracking.delivery_address.label : tracking.store?.address) && <p className="flex items-start gap-2 text-sm"><MapPin className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{delivery ? tracking.delivery_address.label : tracking.store?.address}</p>}
        {mode === 'dine_in' && tracking.tableLabel && <p className="text-sm">Mesa / referencia: {tracking.tableLabel}</p>}
        <ul className="divide-y">{tracking.items?.map((item, i) => <li key={i} className="flex justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="break-words">{item.quantity}× {item.name}</p>{item.notes && <p className="mt-1 break-words text-xs text-muted-foreground">{item.notes}</p>}</div><span className="shrink-0">{money(item.total_cents)}</span></li>)}</ul>
        {tracking.totalCents != null && <div className="flex justify-between gap-3 border-t pt-4 text-lg font-bold"><span>Total</span><span>{money(tracking.totalCents)}</span></div>}
        <p className="text-sm text-muted-foreground">{tracking.paymentStatus === 'paid' ? 'Pago registrado' : tracking.paymentMethod === 'eft' ? 'Transferencia pendiente de verificación por el local' : mode === 'dine_in' ? `Pago pendiente al final${tracking.paymentMethod ? '' : ' · método a definir en caja'}` : mode === 'collection' ? 'Pago pendiente al retirar' : 'Pago pendiente al recibir'}{tracking.paymentMethod ? ' · ' + paymentLabel(tracking.paymentMethod, mode as Fulfillment) : ''}</p>
      </section>
      {delivery && (tracking.store?.lat != null || tracking.delivery_address.lat != null) && <section className="h-72 overflow-hidden rounded-2xl border bg-card" aria-label="Mapa del recorrido"><Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-muted-foreground">Cargando mapa…</div>}><TrackingMap store={tracking.store} delivery={tracking.delivery_address} driver={tracking.driver} /></Suspense></section>}
      {tracking.paymentMethod === 'eft' && tracking.paymentStatus !== 'paid' && tracking.transferDetails && <section className="space-y-3 rounded-2xl border border-primary/20 bg-primary/5 p-5"><div><h2 className="font-bold">Transferencia bancaria</h2><p className="mt-1 text-sm text-muted-foreground">El pago queda pendiente hasta que el local revise y confirme la transferencia. Si ya transferiste, conservá el comprobante.</p></div><dl className="space-y-2 text-sm">{[['Titular', tracking.transferDetails.account_holder], ['Alias', tracking.transferDetails.alias], ['CBU / CVU', tracking.transferDetails.cbu]].filter((entry): entry is [string, string] => Boolean(entry[1])).map(([label, value]) => <div key={label} className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted-foreground">{label}</dt><dd className="flex items-center gap-2 break-all font-semibold">{value}<button type="button" className="inline-flex min-h-9 shrink-0 items-center gap-1 rounded-md border bg-background px-2 text-xs" onClick={() => void copyBankDetail(value)} aria-label={'Copiar ' + label}><Copy className="h-3.5 w-3.5" />Copiar</button></dd></div>)}</dl>{whatsappURL && <Button variant="outline" asChild className="min-h-11 w-full"><a href={whatsappURL} target="_blank" rel="noreferrer">Consultar el pago al local por WhatsApp</a></Button>}</section>}
      <div className="flex flex-wrap gap-3"><Button variant="outline" onClick={() => void copyLink()} className="min-h-11 flex-1"><Copy className="mr-2 h-4 w-4" />Guardar enlace</Button>{!done && !cancelled && <Button variant="outline" onClick={() => setAttempt(n => n + 1)} className="min-h-11 flex-1"><RefreshCw className="mr-2 h-4 w-4" />Actualizar</Button>}</div>
      {copyMessage && <p role="status" className="text-center text-sm">{copyMessage}</p>}
      <p className="text-center text-xs text-muted-foreground">{updated ? 'Última actualización: ' + updated.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' }) : ''}. Este enlace es privado: compartilo solo con quien deba seguir el pedido.</p>
    </main>
  </div>;
}
