import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ChefHat, ClipboardList, Clock3, MapPin, Plus, RefreshCw, Search, ShoppingBag, Truck, Utensils } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/auth-context';
import { useActor } from '@/context/actor-token-context';
import { useMoney } from '@/context/locale-context';
import { hasAnyAccess, canRecordOrderPayment } from '@/lib/access-control';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { fulfillmentLabel, needsPayment, nextOrderResponsibility, orderQueueGroup, orderStatusLabel } from '../order-status';
import { customerOrTable, orderTotal, paymentLabel, type POSOrder } from '../order-types';
import OrderDetailDialog from './order-detail-dialog';

type OrderFilter = 'active' | 'new' | 'kitchen' | 'handoff' | 'payment' | 'closed';
const FILTERS: { id: OrderFilter; label: string }[] = [
  { id: 'active', label: 'En curso' }, { id: 'new', label: 'Recibir' },
  { id: 'kitchen', label: 'En cocina' }, { id: 'handoff', label: 'Entregar' },
  { id: 'payment', label: 'Cobrar' }, { id: 'closed', label: 'Historial' },
];
type ModeFilter = 'all' | 'collection' | 'delivery' | 'dine_in';

function elapsed(value?: string | null): string {
  const time = value ? new Date(value).getTime() : NaN;
  if (!Number.isFinite(time)) return 'Hora no disponible';
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60_000));
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function inFilter(order: POSOrder, filter: OrderFilter): boolean {
  if (filter === 'active') return orderQueueGroup(order) !== 'closed';
  if (filter === 'payment') return needsPayment(order);
  return orderQueueGroup(order) === filter;
}

function OrderCard({ order, onOpen }: { order: POSOrder; onOpen: (order: POSOrder) => void }) {
  const { format, scale } = useMoney(order.currency_code ? { currency: order.currency_code } : undefined);
  const responsibility = nextOrderResponsibility(order);
  const mode = order.fulfillment_type || order.order_type;
  const Icon = mode === 'delivery' ? Truck : mode === 'dine_in' ? Utensils : ShoppingBag;
  const group = orderQueueGroup(order);
  return <article aria-label={`Pedido ${order.order_number || order.id}`} className={cn('min-w-0 rounded-2xl border bg-card shadow-sm', group === 'handoff' && 'border-success/40', group === 'payment' && 'border-warning/40')}>
    <button type="button" className="w-full rounded-2xl p-4 text-left outline-none transition-colors hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-primary sm:p-5" onClick={() => onOpen(order)} aria-label={`Abrir pedido ${order.order_number || order.id}`}>
      <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="min-w-0 break-words text-base font-bold">#{order.order_number || order.id.slice(-8)}</h2><Badge variant="outline" className={cn('whitespace-normal', group === 'handoff' ? 'bg-success/10 text-success' : group === 'payment' || group === 'new' ? 'bg-warning/10 text-warning' : '')}>{orderStatusLabel(order.status, order)}</Badge></div>
      <div className="mt-3 flex items-start justify-between gap-3"><p className="min-w-0 break-words font-semibold">{customerOrTable(order)}</p><p className="shrink-0 font-bold tabular-nums">{format(orderTotal(order, scale))}</p></div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground"><span className="flex items-center gap-1"><Icon className="h-3.5 w-3.5" />{fulfillmentLabel(order)}</span><span className="flex items-center gap-1"><Clock3 className="h-3.5 w-3.5" />Hace {elapsed(order.created_at)}</span></div>
      <p className={cn('mt-3 text-sm', needsPayment(order) ? 'font-medium text-warning' : 'text-success')}>{paymentLabel(order)}</p>
      {mode === 'delivery' && order.delivery_address && <p className="mt-2 flex items-start gap-1.5 break-words text-sm text-muted-foreground"><MapPin className="mt-0.5 h-4 w-4 shrink-0" />{order.delivery_address}</p>}
      <div className="mt-4 flex items-center justify-between gap-3 border-t pt-3"><div className="min-w-0"><p className="text-xs font-semibold text-primary">{responsibility.owner}</p><p className="mt-1 text-sm text-muted-foreground">{responsibility.task}</p></div><ArrowRight className="h-5 w-5 shrink-0 text-primary" /></div>
      <span className="mt-3 block text-xs font-medium text-primary">Ver productos y acciones</span>
    </button>
  </article>;
}

export default function OrderStatusBoard() {
  const { activeLocation, activeMembership } = useAuth();
  const { actor } = useActor();
  const { format, scale } = useMoney();
  const canOperate = hasAnyAccess(activeMembership, ['can_pos'], actor?.capabilities, actor?.role);
  const canSettle = canRecordOrderPayment(activeMembership, actor?.capabilities, actor?.role);
  const [orders, setOrders] = useState<POSOrder[]>([]);
  const [selected, setSelected] = useState<POSOrder | null>(null);
  const [filter, setFilter] = useState<OrderFilter>('active');
  const [mode, setMode] = useState<ModeFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [hasMore, setHasMore] = useState(false);
  const hasLoaded = useRef(false);
  const requestSequence = useRef(0);

  const fetchOrders = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!activeLocation?.id) { setOrders([]); setLoading(false); setRefreshing(false); return; }
    setRefreshing(true);
    if (!hasLoaded.current) setLoading(true);
    try {
      // One role-guarded snapshot; financial debt is independent of delivery.
      const { data, error: apiError } = await api.request<{ orders: POSOrder[]; has_more: boolean }>('GET', `/pos/orders/queue?location_id=${encodeURIComponent(activeLocation.id)}`);
      if (sequence !== requestSequence.current) return;
      if (apiError || !data) throw new Error(apiError?.message || 'No se pudieron cargar los pedidos.');
      setOrders(data.orders || []); setHasMore(Boolean(data.has_more));
      setError('');
    } catch (cause) { if (sequence === requestSequence.current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los pedidos.'); }
    finally { if (sequence === requestSequence.current) { hasLoaded.current = true; setLoading(false); setRefreshing(false); } }
  }, [activeLocation?.id]);

  useEffect(() => {
    hasLoaded.current = false; setOrders([]); setSelected(null); setError(''); setLoading(Boolean(activeLocation?.id));
    void fetchOrders();
    const timer = window.setInterval(() => { if (!document.hidden) void fetchOrders(); }, 15_000);
    return () => { window.clearInterval(timer); requestSequence.current += 1; };
  }, [activeLocation?.id, fetchOrders]);
  useEffect(() => { setSelected(null); }, [actor?.staff_id]);

  const counts = useMemo(() => Object.fromEntries(FILTERS.map(option => [option.id, orders.filter(order => inFilter(order, option.id)).length])) as Record<OrderFilter, number>, [orders]);
  const visibleOrders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    const priority = (order: POSOrder) => order.status === 'pending' ? 0 : order.status === 'ready' ? 1 : orderQueueGroup(order) === 'payment' ? 2 : 3;
    return orders.filter(order => {
      if (!inFilter(order, filter)) return false;
      const fulfillment = order.fulfillment_type || order.order_type;
      if (mode !== 'all' && (mode === 'collection' ? !['collection', 'pickup', 'takeaway'].includes(fulfillment || '') : fulfillment !== mode)) return false;
      return !term || [order.order_number, customerOrTable(order), order.customer_phone, order.delivery_address].some(value => String(value || '').toLocaleLowerCase().includes(term));
    }).sort((left, right) => filter === 'closed'
      ? String(right.created_at || '').localeCompare(String(left.created_at || ''))
      : (filter === 'active' ? priority(left) - priority(right) : 0) || String(left.created_at || '').localeCompare(String(right.created_at || '')));
  }, [orders, filter, mode, search]);
  const outstanding = orders.filter(needsPayment).reduce((sum, order) => sum + Math.max(0, orderTotal(order, scale) - Number(order.paid_cents || 0)), 0);

  function orderChanged(updated: POSOrder) {
    requestSequence.current += 1; setRefreshing(false);
    setOrders(previous => previous.map(order => order.id === updated.id ? { ...order, ...updated } : order));
    // Refresh safely after mutations; do not retry a payment automatically.
    void fetchOrders();
  }

  return <main className="h-full min-h-0 overflow-y-auto bg-muted/20 p-3 pb-6 sm:p-5 lg:p-7"><div className="mx-auto max-w-6xl space-y-4 sm:space-y-5">
    <header className="flex items-center justify-between gap-2"><div className="min-w-0"><h1 className="text-xl font-bold tracking-tight sm:text-3xl">Pedidos en curso</h1><p className="mt-1 hidden text-sm text-muted-foreground md:block">Recibí, entregá y cobrá desde el mismo lugar. Abrí un pedido para ver sus productos y la próxima tarea.</p></div><div className="flex shrink-0 gap-2"><Button variant="outline" disabled={refreshing} aria-label="Actualizar pedidos" className="h-11 w-11 px-0 sm:w-auto sm:px-3" onClick={() => void fetchOrders()}><RefreshCw className={cn('h-4 w-4 sm:mr-2', refreshing && 'animate-spin')} /><span className="hidden sm:inline">Actualizar</span></Button>{canOperate && <Button asChild className="hidden min-h-11 sm:inline-flex"><Link to="/work?tab=pos&view=full"><Plus className="mr-2 h-4 w-4" />Nuevo pedido</Link></Button>}</div></header>
    {!activeLocation?.id ? <section className="rounded-2xl border bg-card p-6 text-center"><MapPin className="mx-auto h-8 w-8 text-muted-foreground" /><h2 className="mt-3 font-semibold">Elegí un local</h2><p className="mt-1 text-sm text-muted-foreground">Seleccioná una ubicación activa para ver sus pedidos.</p></section> : <>
      <section aria-label="Prioridades del turno" className="hidden grid-cols-3 gap-3 sm:grid">{[{ id: 'new' as const, label: 'Por recibir', value: String(counts.new) }, { id: 'handoff' as const, label: 'Por entregar', value: String(orders.filter(order => order.status === 'ready').length) }, { id: 'payment' as const, label: 'Por cobrar', value: format(outstanding) }].map(metric => <button key={metric.id} type="button" onClick={() => setFilter(metric.id)} className="min-w-0 rounded-xl border bg-card p-4 text-left focus-visible:outline-primary"><p className="text-xs text-muted-foreground">{metric.label}</p><p className="mt-1 text-xl font-bold tabular-nums lg:text-2xl">{metric.value}</p></button>)}</section>
      <section className="space-y-2 rounded-2xl border bg-card p-2 sm:space-y-3 sm:p-4"><div className="flex gap-2"><div className="relative min-w-0 flex-1"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar pedido" aria-label="Buscar pedidos" className="h-11 rounded-xl pl-10 text-base sm:h-12" /></div><select aria-label="Modalidad del pedido" value={mode} onChange={event => setMode(event.target.value as ModeFilter)} className="h-11 w-24 min-w-0 rounded-xl border bg-background px-2 text-base sm:h-12 sm:w-44"><option value="all">Todas</option><option value="collection">Retiro</option><option value="delivery">Delivery</option><option value="dine_in">En mesa</option></select></div><div role="group" aria-label="Filtrar pedidos por tarea" className="grid grid-cols-3 gap-2 lg:flex lg:flex-wrap">{FILTERS.map(option => <Button key={option.id} type="button" variant={filter === option.id ? 'default' : 'outline'} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)} className="min-h-11 min-w-0 gap-1 rounded-xl px-2 text-xs sm:gap-2 sm:px-3 sm:text-sm">{option.label}<span className="rounded-full bg-muted/30 px-1.5 text-[11px] tabular-nums">{counts[option.id]}</span></Button>)}</div></section>
      {error && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive"><p>{error}</p><Button variant="outline" onClick={() => void fetchOrders()} className="mt-2 min-h-11">Reintentar</Button></div>}
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><p>{visibleOrders.length} pedidos · {filter === 'closed' ? 'Más recientes primero' : 'Pendientes y más antiguos primero'}</p>{filter === 'kitchen' && <ChefHat className="h-4 w-4" />}</div>
      {loading ? <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3" aria-label="Cargando pedidos"><div className="h-48 animate-pulse rounded-2xl bg-muted" /><div className="h-48 animate-pulse rounded-2xl bg-muted" /></div> : visibleOrders.length ? <div className="grid min-w-0 items-start gap-3 md:grid-cols-2 xl:grid-cols-3">{visibleOrders.map(order => <OrderCard key={order.id} order={order} onOpen={setSelected} />)}</div> : <section className="rounded-2xl border border-dashed bg-card px-5 py-10 text-center"><ClipboardList className="mx-auto h-9 w-9 text-muted-foreground" /><h2 className="mt-3 font-semibold">{search ? 'No encontramos ese pedido' : 'No hay pendientes en esta vista'}</h2><p className="mt-1 text-sm text-muted-foreground">{search ? 'Probá con otro nombre, número o dirección.' : 'Podés elegir otra tarea o modalidad.'}</p><Button variant="outline" className="mt-4 min-h-11" onClick={() => { setFilter('active'); setMode('all'); setSearch(''); }}>Ver pedidos en curso</Button></section>}
      {hasMore && <p role="status" className="rounded-xl bg-warning/10 p-3 text-sm">Hay más de 250 pendientes en una cola. Se muestran los más antiguos; resolvelos para ver los siguientes.</p>}
      <p className="py-2 text-center text-xs text-muted-foreground">Actualiza cada 15 segundos · hasta 250 pedidos por cola y 100 en historial · entregar no equivale a cobrar</p>
    </>}
    {selected && <OrderDetailDialog key={selected.id} order={selected} canOperate={canOperate} canSettle={canSettle} onClose={() => setSelected(null)} onChanged={orderChanged} />}
  </div></main>;
}
