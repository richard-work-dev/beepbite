import { useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useMoney } from '@/context/locale-context';
import { api } from '@/lib/api-client';
import { chargeOrder } from '@/services/payment';
import { fulfillmentLabel, handoffBlockReason, needsPayment, nextOrderResponsibility, nextPOSOrderAction, orderStatusLabel } from '../order-status';
import { customerOrTable, orderTotal, paymentLabel, type POSOrder, type OrderTransition } from '../order-types';

interface OrderDetail {
  status?: string; payment_status?: string; payment_method?: string; paid_cents?: number;
  total_cents?: number; delivery_fee_cents?: number; delivery_zone_name?: string;
  line_items?: { order_item_id: string; item_name: string; quantity: number; total_price_cents: number; notes?: string; modifiers?: { name: string }[] }[];
  status_history?: OrderTransition[];
}

export default function OrderDetailDialog({ order, canOperate, canSettle, onClose, onChanged }: {
  order: POSOrder; canOperate: boolean; canSettle: boolean;
  onClose: () => void; onChanged: (order: POSOrder) => void;
}) {
  const { format, parse, scale, decimals } = useMoney(order.currency_code ? { currency: order.currency_code } : undefined);
  const [snapshot, setSnapshot] = useState(order);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [step, setStep] = useState<'detail' | 'payment' | 'handoff'>('detail');
  const [method, setMethod] = useState(order.payment_method === 'eft' ? 'eft' : 'cash');
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [verified, setVerified] = useState(false);
  const sequence = useRef(0);
  const balance = Math.max(0, orderTotal(snapshot, scale) - Number(snapshot.paid_cents || 0));
  const action = nextPOSOrderAction(snapshot);
  const blocked = handoffBlockReason(snapshot);
  const responsibility = nextOrderResponsibility(snapshot);
  const amount = parse(received) || 0;

  useEffect(() => {
    const request = ++sequence.current;
    api.request<OrderDetail>('GET', `/orders/${encodeURIComponent(order.id)}/receipt`).then(({ data, error: apiError }) => {
      if (request !== sequence.current) return;
      if (apiError || !data) throw new Error(apiError?.message || 'No se pudieron cargar los productos y el saldo.');
      setDetail(data);
      setSnapshot(previous => ({ ...previous, ...data }));
    }).catch(cause => {
      if (request === sequence.current) setError(cause instanceof Error ? cause.message : 'No se pudo abrir el pedido.');
    }).finally(() => { if (request === sequence.current) setLoading(false); });
    return () => { sequence.current += 1; };
  }, [order.id]);

  async function confirmHandoff() {
    if (!action || blocked || !canOperate || busy || loading) return;
    setBusy(true); setError('');
    try {
      const { data, error: apiError } = await api.request<POSOrder>('POST', `/pos/orders/${encodeURIComponent(order.id)}/status`, { body: { status: action.nextStatus, expected_status: snapshot.status } });
      if (apiError || !data) throw new Error(apiError?.message || 'No se pudo confirmar. Actualizá el pedido.');
      onChanged({ ...snapshot, ...data }); onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el pedido.'); }
    finally { setBusy(false); }
  }

  async function registerPayment() {
    if (busy || !canSettle || !verified || balance <= 0 || amount < balance || (method !== 'cash' && amount !== balance)) return;
    setBusy(true); setError('');
    try {
      const result = await chargeOrder({ orderId: order.id, paymentMethodCode: method, amountPaidCents: amount, changeGivenCents: method === 'cash' ? amount - balance : 0, paymentReference: reference.trim() });
      const updated = { ...snapshot, status: result.status || snapshot.status, payment_status: result.payment_status, paid_cents: result.paid_cents, payment_method: method };
      setSnapshot(updated); onChanged(updated); setStep('detail');
      setFeedback('Pago registrado. La entrega se confirma por separado.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo registrar el pago.'); }
    finally { setBusy(false); }
  }

  function openPayment() {
    setReceived((balance / scale).toFixed(decimals)); setVerified(false); setError(''); setFeedback(''); setStep('payment');
  }

  return <Dialog open onOpenChange={open => { if (!open && !busy) onClose(); }}>
    <DialogContent className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-xl flex-col gap-0 overflow-hidden p-0" onEscapeKeyDown={event => { if (busy) event.preventDefault(); }} onPointerDownOutside={event => { if (busy) event.preventDefault(); }}>
      <DialogHeader className="shrink-0 border-b p-4 pr-12 sm:p-5">
        <DialogTitle className="break-words text-xl">{step === 'payment' ? 'Registrar pago recibido' : step === 'handoff' ? 'Confirmar entrega real' : `Pedido #${snapshot.order_number || snapshot.id.slice(-8)}`}</DialogTitle>
        <DialogDescription>#{snapshot.order_number || snapshot.id.slice(-8)} · {customerOrTable(snapshot)} · {fulfillmentLabel(snapshot)}</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <div className="rounded-xl bg-muted/50 p-3 text-sm"><p className="font-semibold">{orderStatusLabel(snapshot.status, snapshot)}</p><p className="mt-1">{paymentLabel(snapshot)}</p><p className="mt-2 text-muted-foreground">Responsable: <span className="font-medium text-foreground">{responsibility.owner}</span></p><p className="text-muted-foreground">{responsibility.task}</p></div>
        {error && <p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
        {feedback && <p role="status" className="rounded-xl bg-success/10 p-3 text-sm text-success">{feedback}</p>}
        {loading ? <p role="status" className="flex items-center gap-2 text-sm"><LoaderCircle className="h-4 w-4 animate-spin" />Cargando productos y saldo…</p> : step === 'payment' ? <>
          <div><p className="text-sm text-muted-foreground">Saldo a cobrar</p><p className="text-3xl font-bold tabular-nums">{format(balance)}</p></div>
          <fieldset><legend className="mb-2 text-sm font-semibold">¿Cómo recibiste el pago?</legend><div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-3">{[{ code: 'cash', label: 'Efectivo' }, { code: 'card_in_person', label: 'Tarjeta' }, { code: 'eft', label: 'Transferencia' }].map(option => <Button key={option.code} type="button" variant={method === option.code ? 'default' : 'outline'} aria-pressed={method === option.code} disabled={busy} className="min-h-12 px-2" onClick={() => { setMethod(option.code); setVerified(false); setReceived((balance / scale).toFixed(decimals)); }}>{option.label}</Button>)}</div></fieldset>
          <label className="block text-sm font-medium">{method === 'cash' ? 'Efectivo recibido' : 'Importe recibido'}<Input inputMode="decimal" value={received} disabled={busy} onChange={event => setReceived(event.target.value)} className="mt-2 min-h-12 text-base" /></label>
          {method === 'cash' && amount > balance && <p className="text-sm font-medium">Vuelto: {format(amount - balance)}</p>}
          {method !== 'cash' && <label className="block text-sm font-medium">Referencia / comprobante (opcional)<Input value={reference} maxLength={200} disabled={busy} onChange={event => setReference(event.target.value)} className="mt-2 min-h-12 text-base" /></label>}
          <label className="flex min-h-12 items-start gap-3 rounded-xl border p-3 text-sm"><input type="checkbox" checked={verified} disabled={busy} onChange={event => setVerified(event.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 accent-primary" /><span>{method === 'eft' ? 'Verifiqué el ingreso de la transferencia en la cuenta del local.' : method === 'card_in_person' ? 'Confirmé que el pago fue aprobado en la terminal del local.' : 'Recibí el efectivo y comprobé el importe.'}</span></label>
          <p className="text-xs text-muted-foreground">Esto registra dinero ya recibido: no procesa pagos ni valida comprobantes automáticamente.</p>
        </> : step === 'handoff' ? <>
          <p className="text-base font-semibold">{action?.label} · #{snapshot.order_number || snapshot.id.slice(-8)}</p>
          <p className="text-sm text-muted-foreground">Confirmá únicamente si {snapshot.status === 'pending' ? 'revisaste el pedido y el local puede prepararlo' : action?.nextStatus === 'out_for_delivery' ? 'el repartidor ya retiró el pedido del local' : (snapshot.fulfillment_type || snapshot.order_type) === 'dine_in' ? 'la comida ya llegó a la mesa' : 'el cliente ya recibió el pedido'}. No se marca por terminar de cocinar.</p>
          {needsPayment(snapshot) && <p className="rounded-xl border border-warning/30 bg-warning/10 p-3 text-sm">El pago sigue pendiente. Caja deberá registrar el cobro.</p>}
        </> : <>
          {snapshot.customer_phone && <p className="text-sm">Contacto: <a className="text-primary underline" href={`tel:${snapshot.customer_phone}`}>{snapshot.customer_phone}</a></p>}
          {snapshot.delivery_address && <p className="break-words text-sm">Entrega: {snapshot.delivery_address}</p>}
          <section aria-label="Productos del pedido"><h3 className="mb-2 text-sm font-semibold">Productos</h3>{detail?.line_items?.length ? <ul className="divide-y">{detail.line_items.map(item => <li key={item.order_item_id} className="py-3"><div className="flex justify-between gap-3 text-sm"><span className="min-w-0 break-words"><strong>{item.quantity}×</strong> {item.item_name}</span><span className="shrink-0 tabular-nums">{format(item.total_price_cents)}</span></div>{item.modifiers?.length ? <p className="mt-1 text-xs text-muted-foreground">{item.modifiers.map(modifier => modifier.name).join(' · ')}</p> : null}{item.notes && <p className="mt-1 break-words text-sm text-muted-foreground">{item.notes}</p>}</li>)}</ul> : <p className="text-sm text-muted-foreground">No hay productos disponibles en el detalle.</p>}</section>
          <div className="space-y-2 border-t pt-3 text-sm">{Number(detail?.delivery_fee_cents || 0) > 0 && <p className="flex justify-between gap-2"><span>Envío{detail?.delivery_zone_name ? ` · ${detail.delivery_zone_name}` : ''}</span><span>{format(Number(detail?.delivery_fee_cents))}</span></p>}<p className="flex justify-between font-semibold"><span>Total</span><span>{format(orderTotal(snapshot, scale))}</span></p>{needsPayment(snapshot) && <p className="flex justify-between"><span>Por cobrar</span><span>{format(balance)}</span></p>}</div>
          {blocked && <p className="rounded-xl bg-warning/10 p-3 text-sm">{blocked}</p>}
          {!!snapshot.status_history?.length && <details className="rounded-xl border p-3"><summary className="min-h-8 cursor-pointer text-sm font-medium">Historial y responsables</summary><ol className="mt-2 space-y-2 text-xs text-muted-foreground">{snapshot.status_history.map((event, index) => <li key={`${event.at}-${index}`}><p className="font-medium text-foreground">{orderStatusLabel(event.to, snapshot)}</p><p>{new Date(event.at).toLocaleString('es-AR')} · {event.actor_name && event.actor_name !== event.actor_id ? event.actor_name : ({ owner: 'Propietario', admin: 'Administrador', manager: 'Encargado', pos: 'Caja', staff: 'Equipo POS', kitchen: 'Cocina', driver: 'Repartidor' } as Record<string, string>)[event.actor_role || ''] || 'Personal autorizado'}</p></li>)}</ol></details>}
        </>}
      </div>
      <footer className="grid shrink-0 gap-2 border-t bg-card p-4 sm:grid-cols-2 sm:p-5">
        {step !== 'detail' ? <><Button variant="outline" disabled={busy} className="min-h-12" onClick={() => { setStep('detail'); setError(''); }}>Volver al pedido</Button><Button disabled={busy || loading || (step === 'payment' ? !verified || balance <= 0 || amount < balance || (method !== 'cash' && amount !== balance) : !!blocked)} className="min-h-12" onClick={() => void (step === 'payment' ? registerPayment() : confirmHandoff())}>{busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : null}{step === 'payment' ? 'Registrar pago' : action?.label || 'Confirmar'}</Button></> : <>
          {canSettle && needsPayment(snapshot) ? <Button variant={blocked || !action ? 'default' : 'outline'} className="min-h-12" disabled={loading || !detail || balance <= 0} onClick={openPayment}>Registrar cobro · {format(balance)}</Button> : <Button variant="outline" className="min-h-12" onClick={onClose}>Cerrar detalle</Button>}
          {canOperate && action && <Button className="min-h-12" disabled={loading || !detail || !!blocked} onClick={() => { setStep('handoff'); setError(''); }}>{action.label}</Button>}
        </>}
      </footer>
    </DialogContent>
  </Dialog>;
}
