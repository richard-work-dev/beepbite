import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Banknote, ChefHat, CheckCircle2, ClipboardList, Clock3, CreditCard,
  LoaderCircle, MapPin, PackageCheck, RefreshCw, Search, ShoppingBag,
  Truck, UserRound, Utensils,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { fulfillmentLabel, nextPOSOrderAction, orderStatusGroup, orderStatusLabel } from '../order-status';

interface POSOrder {
  id: string;
  order_number?: string;
  status: string;
  fulfillment_type?: string | null;
  order_type?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  table_label?: string | null;
  table_number?: string | number | null;
  delivery_address?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  total_cents?: number | string | null;
  total?: number | string | null;
  currency_code?: string | null;
  created_at?: string | null;
}

type OrderFilter = 'all' | 'new' | 'kitchen' | 'handoff' | 'closed';

const FILTERS: { id: OrderFilter; label: string }[] = [
  { id: 'all', label: 'Todos' },
  { id: 'new', label: 'Nuevos' },
  { id: 'kitchen', label: 'En cocina' },
  { id: 'handoff', label: 'Entrega y retiro' },
  { id: 'closed', label: 'Finalizados' },
];

function paymentLabel(order: POSOrder): string {
  if (order.payment_status === 'paid') return 'Pagado';
  if (order.payment_status === 'partial') return 'Pago parcial';
  const methods: Record<string, string> = {
    cash: 'Efectivo al recibir', cash_on_delivery: 'Efectivo al recibir',
    card_machine: 'Tarjeta al recibir', card_on_delivery: 'Tarjeta al recibir',
    eft: 'Transferencia pendiente', split: 'Pago dividido',
  };
  return methods[order.payment_method || ''] || (order.payment_status === 'unpaid' ? 'A pagar en el local' : 'Pago pendiente');
}

function orderTotal(order: POSOrder, scale: number): number {
  const cents = order.total_cents == null ? Number.NaN : Number(order.total_cents);
  if (Number.isFinite(cents)) return cents;
  const total = Number(order.total);
  return Number.isFinite(total) ? Math.round(total * scale) : 0;
}

function createdTime(value?: string | null): string {
  if (!value) return 'Hora no disponible';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Hora no disponible'
    : new Intl.DateTimeFormat('es-AR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

function customerOrTable(order: POSOrder): string {
  if (order.customer_name?.trim()) return order.customer_name.trim();
  const table = order.table_label || order.table_number;
  if (table !== undefined && table !== null && String(table).trim()) return `Mesa ${table}`;
  return 'Cliente sin nombre';
}

function serviceIcon(order: POSOrder) {
  const fulfillment = order.fulfillment_type || order.order_type;
  if (fulfillment === 'delivery') return Truck;
  if (fulfillment === 'dine_in') return Utensils;
  return ShoppingBag;
}

function paymentIcon(order: POSOrder) {
  return order.payment_method === 'cash' || order.payment_method === 'cash_on_delivery' ? Banknote : CreditCard;
}

function OrderCard({ order, busy, onAdvance }: {
  order: POSOrder;
  busy: boolean;
  onAdvance: (order: POSOrder) => void;
}) {
  const { format, scale } = useMoney(order.currency_code ? { currency: order.currency_code } : undefined);
  const action = nextPOSOrderAction(order);
  const ServiceIcon = serviceIcon(order);
  const PaymentIcon = paymentIcon(order);
  const statusTone = order.status === 'pending' || order.status === 'pending_on_delivery'
    ? 'border-warning/30 bg-warning/10 text-warning'
    : order.status === 'ready' || order.status === 'out_for_delivery'
      ? 'border-success/30 bg-success/10 text-success'
      : order.status === 'cancelled'
        ? 'border-destructive/30 bg-destructive/10 text-destructive'
        : 'border-primary/20 bg-primary/10 text-primary';

  return (
    <article className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5" aria-label={`Pedido ${order.order_number || order.id}`}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-base font-bold">#{order.order_number || order.id.slice(-8)}</h2>
            <Badge variant="outline" className={cn('max-w-full whitespace-normal text-center', statusTone)}>{orderStatusLabel(order.status, order)}</Badge>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-medium text-foreground">
            <UserRound className="h-4 w-4 shrink-0 text-muted-foreground" />
            <span className="break-words">{customerOrTable(order)}</span>
          </p>
        </div>
        <p className="shrink-0 text-right text-base font-bold tabular-nums">{format(orderTotal(order, scale))}</p>
      </div>

      <div className="mt-3 grid gap-2 text-sm text-muted-foreground sm:grid-cols-2">
        <p className="flex min-w-0 items-center gap-2"><ServiceIcon className="h-4 w-4 shrink-0" /><span>{fulfillmentLabel(order)}</span></p>
        <p className="flex min-w-0 items-center gap-2"><PaymentIcon className="h-4 w-4 shrink-0" /><span className="truncate">{paymentLabel(order)}</span></p>
        {(order.fulfillment_type || order.order_type) === 'delivery' && order.delivery_address && (
          <p className="flex min-w-0 items-start gap-2 sm:col-span-2"><MapPin className="mt-0.5 h-4 w-4 shrink-0" /><span className="break-words">{order.delivery_address}</span></p>
        )}
        <p className="flex items-center gap-2"><Clock3 className="h-4 w-4 shrink-0" />Ingresó {createdTime(order.created_at)}</p>
      </div>

      {action ? (
        <Button type="button" disabled={busy} onClick={() => onAdvance(order)} className="mt-4 min-h-12 w-full rounded-xl text-sm font-semibold sm:w-auto sm:min-w-52">
          {busy ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : order.status === 'pending' ? <CheckCircle2 className="mr-2 h-4 w-4" /> : order.status === 'ready' ? <PackageCheck className="mr-2 h-4 w-4" /> : <Truck className="mr-2 h-4 w-4" />}
          {action.label}
        </Button>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs text-muted-foreground">
          {orderStatusGroup(order.status) === 'kitchen' ? <ChefHat className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          {orderStatusGroup(order.status) === 'kitchen'
            ? 'Cocina actualiza preparación y disponibilidad desde sus comandas.'
            : order.status === 'pending_on_delivery'
              ? <>Cobro pendiente al entregar. <Link to="/home" className="font-medium text-primary underline">Abrir pedidos en curso</Link>.</>
              : order.status === 'cancelled' ? 'Este pedido fue cancelado.' : 'No hay acciones pendientes para este pedido.'}
        </p>
      )}
    </article>
  );
}

export default function OrderStatusBoard() {
  const { activeLocation } = useAuth();
  const { format, scale } = useMoney();
  const [orders, setOrders] = useState<POSOrder[]>([]);
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const [savingIds, setSavingIds] = useState<Set<string>>(() => new Set());
  const hasLoaded = useRef(false);
  const requestSequence = useRef(0);

  const fetchOrders = useCallback(async () => {
    const requestId = ++requestSequence.current;
    if (!activeLocation?.id) {
      setOrders([]);
      setLoading(false);
      setRefreshing(false);
      hasLoaded.current = true;
      return;
    }
    setRefreshing(true);
    if (!hasLoaded.current) setLoading(true);
    try {
      const [activeResult, closedResult] = await Promise.all([
        api.from('orders')
          .select('*')
          .eq('location_id', activeLocation.id)
          .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'out_for_delivery', 'pending_on_delivery'])
          .order('created_at', { ascending: false })
          .limit(250),
        api.from('orders')
          .select('*')
          .eq('location_id', activeLocation.id)
          .in('status', ['delivered', 'completed', 'cancelled'])
          .order('created_at', { ascending: false })
          .limit(100),
      ]);
      if (requestId !== requestSequence.current) return;
      if (activeResult.error || closedResult.error) {
        throw new Error(activeResult.error?.message || closedResult.error?.message || 'No se pudieron cargar los pedidos.');
      }
      const activeOrders = (activeResult.data || []) as POSOrder[];
      const closedOrders = (closedResult.data || []) as POSOrder[];
      setOrders([...activeOrders, ...closedOrders].sort((left, right) =>
        String(right.created_at || '').localeCompare(String(left.created_at || ''))));
      setError('');
    } catch (cause) {
      if (requestId === requestSequence.current) {
        setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los pedidos.');
      }
    } finally {
      if (requestId === requestSequence.current) {
        hasLoaded.current = true;
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [activeLocation?.id]);

  useEffect(() => {
    requestSequence.current += 1;
    hasLoaded.current = false;
    setOrders([]);
    setError('');
    setLoading(Boolean(activeLocation?.id));
    void fetchOrders();
    const timer = window.setInterval(() => void fetchOrders(), 15_000);
    return () => {
      window.clearInterval(timer);
      requestSequence.current += 1;
    };
  }, [activeLocation?.id, fetchOrders]);

  const counts = useMemo(() => {
    const values: Record<OrderFilter, number> = { all: orders.length, new: 0, kitchen: 0, handoff: 0, closed: 0 };
    for (const order of orders) values[orderStatusGroup(order.status)] += 1;
    return values;
  }, [orders]);

  const visibleOrders = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return orders.filter(order => {
      if (filter !== 'all' && orderStatusGroup(order.status) !== filter) return false;
      if (!term) return true;
      return [order.order_number, order.customer_name, order.customer_phone, order.table_label, order.table_number, order.delivery_address, order.status]
        .some(value => String(value || '').toLocaleLowerCase().includes(term));
    });
  }, [filter, orders, search]);

  async function advanceOrder(order: POSOrder) {
    const action = nextPOSOrderAction(order);
    if (!action || savingIds.has(order.id)) return;
    setSavingIds(previous => new Set(previous).add(order.id));
    setError('');
    setFeedback('');
    try {
      const { error: apiError } = await api.from('orders')
        .update({ status: action.nextStatus })
        .eq('id', order.id)
        .eq('location_id', activeLocation?.id);
      if (apiError) throw new Error(apiError.message || 'No se pudo actualizar el estado. Revisá el pedido e intentá otra vez.');
      requestSequence.current += 1;
      setRefreshing(false);
      setOrders(previous => previous.map(item => item.id === order.id
        ? { ...item, status: action.nextStatus, updated_at: new Date().toISOString() }
        : item));
      setFeedback(`Pedido #${order.order_number || order.id.slice(-8)}: ${action.label.toLocaleLowerCase()}.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo actualizar el estado. Revisá el pedido e intentá otra vez.');
    } finally {
      setSavingIds(previous => {
        const next = new Set(previous);
        next.delete(order.id);
        return next;
      });
    }
  }

  const activeTotal = orders
    .filter(order => orderStatusGroup(order.status) !== 'closed')
    .reduce((sum, order) => sum + orderTotal(order, scale), 0);

  return (
    <main className="h-full min-h-0 overflow-y-auto bg-muted/20 p-3 pb-6 sm:p-5 lg:p-7">
      <div className="mx-auto max-w-5xl space-y-5">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary">Punto de venta</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Seguimiento de pedidos</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Aceptá pedidos y gestioná su entrega. Cocina actualiza preparación y disponibilidad desde sus comandas.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => void fetchOrders()} disabled={refreshing} className="min-h-11 w-full shrink-0 rounded-xl sm:w-auto">
            <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />Actualizar
          </Button>
        </header>

        {!activeLocation?.id ? (
          <section className="rounded-2xl border bg-card p-6 text-center">
            <MapPin className="mx-auto h-8 w-8 text-muted-foreground" />
            <h2 className="mt-3 font-semibold">Elegí un local</h2>
            <p className="mt-1 text-sm text-muted-foreground">Seleccioná una ubicación activa para ver sus pedidos.</p>
          </section>
        ) : <>
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">Pedidos activos</p><p className="mt-1 text-2xl font-bold tabular-nums">{orders.length - counts.closed}</p></div>
            <div className="rounded-2xl border bg-card p-4"><p className="text-xs font-medium text-muted-foreground">Requieren atención</p><p className="mt-1 text-2xl font-bold tabular-nums">{counts.new + counts.handoff}</p></div>
            <div className="col-span-2 rounded-2xl border bg-card p-4 sm:col-span-1"><p className="text-xs font-medium text-muted-foreground">Importe activo</p><p className="mt-1 text-2xl font-bold tabular-nums">{format(activeTotal)}</p></div>
          </section>

          <section className="space-y-3 rounded-2xl border bg-card p-3 sm:p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por pedido, cliente o dirección" aria-label="Buscar pedidos" className="h-12 rounded-xl pl-10 text-base" />
            </div>
            <div role="group" aria-label="Filtrar pedidos por estado" className="flex gap-2 overflow-x-auto pb-1">
              {FILTERS.map(option => (
                <Button key={option.id} type="button" size="sm" variant={filter === option.id ? 'default' : 'outline'} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)} className="min-h-10 shrink-0 rounded-full px-4">
                  {option.label}<span className="ml-2 rounded-full bg-background/20 px-1.5 py-0.5 text-[11px] tabular-nums">{counts[option.id]}</span>
                </Button>
              ))}
            </div>
          </section>

          {error && <div role="alert" className="flex flex-col gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive sm:flex-row sm:items-center sm:justify-between"><p>{error}</p><Button type="button" size="sm" variant="outline" onClick={() => void fetchOrders()} className="min-h-10 shrink-0">Reintentar</Button></div>}
          {feedback && <p role="status" aria-live="polite" className="rounded-xl border border-success/30 bg-success/10 p-3 text-sm text-success">{feedback}</p>}

          {loading ? (
            <div className="grid gap-3 md:grid-cols-2" aria-label="Cargando pedidos"><div className="h-48 animate-pulse rounded-2xl bg-muted" /><div className="h-48 animate-pulse rounded-2xl bg-muted" /></div>
          ) : visibleOrders.length ? (
            <div className="grid min-w-0 gap-3 md:grid-cols-2">
              {visibleOrders.map(order => <OrderCard key={order.id} order={order} busy={savingIds.has(order.id)} onAdvance={advanceOrder} />)}
            </div>
          ) : (
            <section className="rounded-2xl border border-dashed bg-card px-5 py-12 text-center">
              <ClipboardList className="mx-auto h-10 w-10 text-muted-foreground" />
              <h2 className="mt-3 font-semibold">{search ? 'No encontramos ese pedido' : 'No hay pedidos en esta vista'}</h2>
              <p className="mt-1 text-sm text-muted-foreground">{search ? 'Probá con otro nombre, número o dirección.' : 'Cuando ingresen pedidos, vas a poder seguirlos y avanzar su entrega desde acá.'}</p>
            </section>
          )}
          <p className="flex items-center justify-center gap-2 py-2 text-center text-xs text-muted-foreground"><RefreshCw className="h-3 w-3 shrink-0" />Actualiza cada 15 segundos · incluye los 100 últimos pedidos finalizados</p>
        </>}
      </div>
    </main>
  );
}
