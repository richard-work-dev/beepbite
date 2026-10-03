// active-ticket-panel.jsx — the left-hand "current ticket" panel.
//
// Renders the active ticket — either a table-bound tab (with a table_session)
// or a walk-in/takeaway ticket. Has two distinct sections:
//
//   1. "Sent" — items already fired to the kitchen (read-only). Grouped by
//      "round" (each Send creates a new order with its own number). The
//      cashier can't edit these — they're in the kitchen.
//
//   2. "New" — items being built up but not yet sent. Editable: qty +/-,
//      remove. These become a new `order` row + KDS tickets when the cashier
//      hits Send.
//
// Footer carries the two primary actions:
//
//   - **Send to Kitchen**: POSTs only the New items as an additional order on
//     this ticket. After success, those items move into Sent and clear the
//     New section.
//   - **Charge Customer**: opens the payment flow. Disabled until there's
//     something to charge (at least one sent order, or new items the cashier
//     wants to send-and-charge in one go — TBD by parent).
//
// Pure presentational. Parent owns all state.

import { useRef, useState } from 'react';
import {
  ChefHat,
  CreditCard,
  Loader2,
  Minus,
  Plus,
  Trash2,
  Users,
  Utensils,
  Receipt,
  ShoppingCart,
  CheckCircle2,
  Clock,
  StickyNote,
	Pencil,
	Phone,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
	AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
	AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
	AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { useMoney } from '@/context/locale-context';
import { hasCapability } from '@/services/pos';
import AdjustmentMenu from './adjustment-menu';
import CourseSelect, { type Course } from './course-select';

// ---------------------------------------------------------------------------
// Domain shapes — the active ticket is assembled client-side in
// workspace.jsx from several sources (orders, order_items, table sessions);
// these mirror the shapes documented in this file's header comment rather
// than any single backend DTO.
// ---------------------------------------------------------------------------

export interface TicketLike {
  fulfillment?: 'takeaway' | 'delivery';
  // `string & {}` (not bare `string`) keeps 'walkin'/'table' from being
  // swallowed by the wider type — IDE autocomplete still suggests them,
  // while any other string is still accepted.
  kind?: 'walkin' | 'table' | (string & {});
  id: string;
  label?: string;
  table_number?: number | string;
  section_name?: string;
  party_size?: number;
	customerName?: string;
	customerPhone?: string;
	notes?: string;
}

export interface SentOrderItem {
  order_item_id?: string;
  id?: string;
  item_status?: string;
  item_name?: string;
  name?: string;
  unit_price?: string | number;
  quantity?: number;
  total_cents?: number;
  notes?: string;
}

export interface SentOrder {
  id: string;
  order_number?: string;
  items: SentOrderItem[];
  created_at?: string;
  fired_at?: string;
  payment_status?: string;
  paid_cents?: number;
  kitchen_status?: string;
  total_cents?: number;
}

export interface NewTicketItem {
  id: string;
  item_id?: string;
  name: string;
  price: string | number;
  qty: number;
  course_id?: string | null;
  modifier_names?: string[];
  notes?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function shortOrderNum(order?: { order_number?: string; id?: string } | null) {
  return order?.order_number ?? (order?.id ? `#${String(order.id).slice(0, 6)}` : '?');
}

const KITCHEN_STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: 'Pendiente de cocina', className: 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800' },
  fired: { label: 'Nueva en cocina', className: 'text-orange-700 dark:text-orange-300 bg-orange-50 dark:bg-orange-950/40 border-orange-200 dark:border-orange-800' },
  in_progress: { label: 'En preparación', className: 'text-sky-700 dark:text-sky-300 bg-sky-50 dark:bg-sky-950/40 border-sky-200 dark:border-sky-800' },
  ready: { label: 'Lista para entregar', className: 'text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800' },
  bumped: { label: 'Entregada por cocina', className: 'text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-800 border-gray-300 dark:border-gray-700' },
  cancelled: { label: 'Cancelada', className: 'text-red-700 dark:text-red-300 bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800' },
};

// ---------------------------------------------------------------------------
// Header — the "who/where" line for the active ticket
// ---------------------------------------------------------------------------

interface TicketHeaderProps {
  ticket: TicketLike | null;
  onAdjustGuests?: () => void;
	onEditDetails?: () => void;
}

function TicketHeader({ ticket, onAdjustGuests, onEditDetails }: TicketHeaderProps) {
  if (!ticket) {
    return (
      <div className="px-4 py-4 border-b border-border bg-muted/40">
        <p className="text-sm font-medium text-gray-500 dark:text-gray-400">No hay una cuenta seleccionada</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Elegí una mesa o agregá una venta de mostrador.</p>
      </div>
    );
  }

	const walkIn = ticket.kind === 'walkin';
	const title = walkIn ? (ticket.label || `Mostrador #${ticket.id}`) : `Mesa ${ticket.table_number ?? '?'}`;
  return (
		<div className="border-b border-border bg-card">
			<div className="flex items-center justify-between gap-2 px-4 py-3">
				<div className="min-w-0">
					<p className="mb-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">{walkIn ? 'Mostrador' : `${ticket.section_name ? `${ticket.section_name} · ` : ''}Mesa`}</p>
					<p className="truncate text-base font-bold text-gray-900 dark:text-white">{title}</p>
				</div>
				{walkIn ? (
					<span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-400"><Receipt className="h-3 w-3" />{ticket.fulfillment === 'delivery' ? 'Delivery' : 'Para llevar'}</span>
				) : onAdjustGuests ? (
					<button type="button" onClick={onAdjustGuests} aria-label={`Ajustar cantidad de comensales: ${ticket.party_size || 1}`} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><Users className="h-3.5 w-3.5" />{ticket.party_size || 1} {(ticket.party_size || 1) === 1 ? 'comensal' : 'comensales'}</button>
				) : null}
			</div>
			<div className="flex items-start gap-2 border-t border-border/60 bg-muted/30 px-4 py-2.5">
				<div className="min-w-0 flex-1 text-xs">
					<p className="truncate font-semibold text-foreground">{ticket.customerName || (walkIn ? 'Cliente de mostrador' : `Consumo en mesa ${ticket.table_number ?? ''}`)}</p>
					{ticket.customerPhone && <p className="mt-0.5 flex items-center gap-1 text-muted-foreground"><Phone className="h-3 w-3" />{ticket.customerPhone}</p>}
					{ticket.notes && <p className="mt-1 line-clamp-2 flex items-start gap-1 text-muted-foreground"><StickyNote className="mt-0.5 h-3 w-3 shrink-0" />{ticket.notes}</p>}
				</div>
				{onEditDetails && <Button type="button" variant="outline" size="sm" onClick={onEditDetails} className="h-11 shrink-0"><Pencil className="h-3.5 w-3.5" />Datos</Button>}
			</div>
		</div>
  );
}

// ---------------------------------------------------------------------------
// Sent section — fired orders, read-only
// ---------------------------------------------------------------------------

// SentItemRow — individual fired line item.
// Right-click / long-press opens the AdjustmentMenu for per-item comp/discount.
interface SentItemRowProps {
  item: SentOrderItem;
  orderId: string;
  locationId: string;
  onAdjustSuccess?: (data: unknown) => void;
}

function SentItemRow({ item, orderId, locationId, onAdjustSuccess }: SentItemRowProps) {
  const { format, scale } = useMoney();
  const status = item.item_status || 'fired';
  const statusMeta = KITCHEN_STATUS[status] || KITCHEN_STATUS.fired;

  const itemId     = item.order_item_id || item.id || null;
  // `unit_price` arrives as a major-unit decimal string; the multiplier that
  // turns it into minor units is the currency's, not 100 (¥500 is 500 minor).
  const priceCents = item.total_cents ?? Math.round(
    (parseFloat(String(item.unit_price ?? 0)) * (item.quantity || 0)) * scale,
  );
  const canActOnItem = hasCapability('can_comp');

  return (
    <AdjustmentMenu
      orderId={orderId}
      itemId={itemId}
      currentPriceCents={priceCents}
      locationId={locationId}
      onSuccess={onAdjustSuccess}
      disabled={!canActOnItem || !itemId}
      label={item.item_name || item.name}
    >
      <div
        className={cn(
          'grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2 py-3 pl-3 pr-10',
          canActOnItem && itemId && 'hover:bg-muted/60 transition-colors',
        )}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-sm font-semibold text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
              {item.quantity}×
            </span>
            <span className="break-words text-sm text-gray-700 dark:text-gray-300">{item.item_name || item.name}</span>
          </div>
          {item.notes && (
            <p className="mt-0.5 text-[11px] text-gray-500 dark:text-gray-400 truncate flex items-center gap-1">
              <StickyNote className="w-2.5 h-2.5" />
              {item.notes}
            </p>
          )}
        </div>
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300 tabular-nums shrink-0">
          {format(priceCents)}
        </span>
        <span className={cn('col-span-2 w-fit rounded border px-2 py-1 text-[11px] font-medium', statusMeta.className)}>{statusMeta.label}</span>
      </div>
    </AdjustmentMenu>
  );
}

// SentOrderGroup — one round of sent items.
// The group header supports right-click / long-press for order-level void.
interface SentOrderGroupProps {
  order: SentOrder;
  locationId: string;
  onAdjustSuccess?: (data: unknown) => void;
}

function SentOrderGroup({ order, locationId, onAdjustSuccess }: SentOrderGroupProps) {
  const { format } = useMoney();
  const items = Array.isArray(order.items) ? order.items : [];
  if (items.length === 0) return null;

  const firedAt = order.created_at || order.fired_at;
  const firedDisplay = firedAt
    ? new Date(firedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : '';

  const canVoid = hasCapability('can_void');
  const kitchenStatus = order.kitchen_status || items[0]?.item_status || 'fired';
  const statusMeta = KITCHEN_STATUS[kitchenStatus] || KITCHEN_STATUS.fired;

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-card overflow-hidden shadow-sm">
      {/* Header — the AdjustmentMenu renders its own always-visible "more
          actions" button (top-right of this row) for Void; right-click /
          long-press remain as shortcuts on top of it. */}
      <AdjustmentMenu
        orderId={order.id}
        itemId={null}
        locationId={locationId}
        onSuccess={onAdjustSuccess}
        disabled={!canVoid}
        label={`pedido ${shortOrderNum(order)}`}
      >
        <div
          className={cn(
            'flex flex-wrap items-center justify-between gap-2 py-3 pl-3 pr-10 bg-success/10 border-b border-success/20',
            canVoid && 'hover:bg-muted/60 transition-colors',
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center gap-2 text-[11px] font-bold">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="truncate text-foreground">Pedido {shortOrderNum(order)}</span>
            <span className={cn('shrink-0 rounded-full border px-2 py-0.5', statusMeta.className)}>
              {statusMeta.label}
            </span>
            <span className={cn(
              'shrink-0 rounded-full border px-2 py-0.5',
              order.payment_status === 'paid'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300'
                : order.payment_status === 'partial'
                  ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'border-gray-300 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300',
            )}>
              {order.payment_status === 'paid'
                ? 'Pagado'
                : order.payment_status === 'partial'
                  ? `Pago parcial ${format(order.paid_cents || 0)}`
                  : 'Por cobrar'}
            </span>
          </div>
          {firedDisplay && (
            <span className="text-[10px] text-gray-400 dark:text-gray-500 inline-flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" />
              {firedDisplay}
            </span>
          )}
        </div>
      </AdjustmentMenu>

      {/* Item rows — each has its own comp/discount context menu */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {items.map((it, idx) => (
          <SentItemRow
            key={it.order_item_id || it.id || idx}
            item={it}
            orderId={order.id}
            locationId={locationId}
            onAdjustSuccess={onAdjustSuccess}
          />
        ))}
      </div>
    </div>
  );
}

interface SentSectionProps {
  sentOrders: SentOrder[];
  locationId: string;
  onAdjustSuccess?: (data: unknown) => void;
}

function SentSection({ sentOrders, locationId, onAdjustSuccess }: SentSectionProps) {
  if (!sentOrders || sentOrders.length === 0) return null;
  return (
    <div className="px-3 py-2.5 space-y-2">
      <div className="flex items-center gap-1.5 px-1 text-[10px] uppercase tracking-widest font-bold text-gray-400 dark:text-gray-500">
        <ChefHat className="w-3.5 h-3.5" />
        Enviado a cocina
        <span className="ml-1 text-gray-300 dark:text-gray-600">·</span>
        <span>{sentOrders.length} {sentOrders.length === 1 ? 'ronda' : 'rondas'}</span>
      </div>
      <div className="space-y-2">
        {sentOrders.map((order) => (
          <SentOrderGroup
            key={order.id}
            order={order}
            locationId={locationId}
            onAdjustSuccess={onAdjustSuccess}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// New section — items not yet sent, editable
// ---------------------------------------------------------------------------

interface NewItemRowProps {
  item: NewTicketItem;
  onBumpQty: (itemId: string, delta: number) => void;
  onRemove: (itemId: string) => void;
  onEditNotes?: (itemId: string) => void;
  courses?: Course[];
  onSetCourse?: (itemId: string, courseId: string | null) => void;
}

function NewItemRow({ item, onBumpQty, onRemove, onEditNotes, courses, onSetCourse }: NewItemRowProps) {
  const { format, scale } = useMoney();
  const lineCents = Math.round((parseFloat(String(item.price ?? 0)) * (item.qty || 0)) * scale);
  return (
    <div className="flex flex-col px-3 py-2.5 bg-card gap-1.5">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="break-words text-sm font-semibold text-gray-900 dark:text-white leading-snug">{item.name}</p>
          {item.modifier_names && item.modifier_names.length > 0 && (
            <p className="text-[11px] text-primary truncate mt-0.5">
              {item.modifier_names.join(', ')}
            </p>
          )}
          {item.notes && (
            <p className="mt-1 flex items-start gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
              <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{item.notes}</span>
            </p>
          )}
          <p className="text-xs text-gray-400 dark:text-gray-500 tabular-nums mt-0.5">
            {format(Math.round(parseFloat(String(item.price ?? 0)) * scale))} cada uno
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Qty decrease — min 44px touch target */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onBumpQty(item.id, -1)}
            aria-label={`Disminuir cantidad de ${item.name}`}
            className="h-11 w-11 p-0 rounded-xl border-primary/25 hover:bg-primary/10 hover:border-primary/50 focus-visible:ring-2 focus-visible:ring-ring transition"
          >
            <Minus className="w-4 h-4" />
          </Button>
          <span className="w-5 text-center text-sm font-bold tabular-nums select-none">{item.qty}</span>
          {/* Qty increase */}
          <Button
            size="sm"
            onClick={() => onBumpQty(item.id, +1)}
            aria-label={`Aumentar cantidad de ${item.name}`}
            className="h-11 w-11 p-0 rounded-xl bg-primary hover:bg-primary/90 focus-visible:ring-2 focus-visible:ring-ring transition"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>
      <div className="flex items-center justify-between pl-0.5">
        {/* Course assignment pill */}
        {courses && courses.length > 0 ? (
          <div className="flex items-center gap-1.5">
            <CourseSelect
              courseId={item.course_id || null}
              courses={courses}
              onChange={(courseId) => onSetCourse && onSetCourse(item.id, courseId)}
            />
          </div>
        ) : <span />}
        <div className="flex items-center gap-2">
          {onEditNotes && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => onEditNotes(item.id)}
              className="h-11 px-2 text-xs text-muted-foreground"
              aria-label={`${item.notes ? 'Editar' : 'Agregar'} instrucciones para ${item.name}`}
            >
              <StickyNote className="mr-1 h-3.5 w-3.5" />
              {item.notes ? 'Editar nota' : 'Agregar nota'}
            </Button>
          )}
          <span className="text-sm font-bold text-gray-900 dark:text-white tabular-nums">
            {format(lineCents)}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onRemove(item.id)}
            aria-label={`Quitar ${item.name} del pedido`}
            className="h-11 w-11 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-xl focus-visible:ring-2 focus-visible:ring-destructive transition"
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

interface NewSectionProps {
  newItems: NewTicketItem[];
  onBumpQty: (itemId: string, delta: number) => void;
  onRemove: (itemId: string) => void;
  onEditNotes?: (itemId: string) => void;
  courses?: Course[];
  onSetCourse?: (itemId: string, courseId: string | null) => void;
}

function NewSection({ newItems, onBumpQty, onRemove, onEditNotes, courses, onSetCourse }: NewSectionProps) {
  if (!newItems || newItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
        <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mb-3">
          <ShoppingCart className="w-7 h-7 text-primary/40" />
        </div>
        <p className="text-sm font-semibold text-gray-600 dark:text-gray-400">El carrito está vacío</p>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 max-w-[16ch] mx-auto">Tocá un producto para agregarlo.</p>
      </div>
    );
  }
  return (
    <div className="px-3 py-2.5">
      <div className="flex items-center gap-1.5 px-1 mb-2 text-[10px] uppercase tracking-widest font-bold text-primary">
        <Utensils className="w-3 h-3" />
        Nuevo — todavía sin enviar
      </div>
      <div className="rounded-xl border border-primary/25 bg-card overflow-hidden divide-y divide-primary/15 shadow-sm">
        {newItems.map((it) => (
          <NewItemRow
            key={it.id}
            item={it}
            onBumpQty={onBumpQty}
            onRemove={onRemove}
            onEditNotes={onEditNotes}
            courses={courses}
            onSetCourse={onSetCourse}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Footer — totals + Send + Charge
// ---------------------------------------------------------------------------

interface TicketDelivery {
  fee: number;
  zoneName?: string;
  error?: string;
  address?: string;
}

interface TicketFooterProps {
  delivery?: TicketDelivery;
  ticket: TicketLike | null;
  newSubtotalCents: number;
  sentSubtotalCents: number;
  totalCents: number;
  onSend?: () => void;
  onEditDetails?: () => void;
  onCharge?: () => void;
  sending?: boolean;
  hasUnpaidOrders: boolean;
  newItemsCount: number;
  newItems: NewTicketItem[];
}

function TicketFooter({
  delivery,
  ticket,
  newSubtotalCents,
  sentSubtotalCents,
  totalCents,
  onSend,
  onEditDetails,
  onCharge,
  sending,
  hasUnpaidOrders,
  newItemsCount,
  newItems,
}: TicketFooterProps) {
  const { format, scale } = useMoney();
  const [reviewOpen, setReviewOpen] = useState(false);
  const editDetailsAfterClose = useRef(false);
  const canSend = newItemsCount > 0 && !sending && Boolean(ticket) && !delivery?.error;
  const canCharge = hasUnpaidOrders && !sending && Boolean(ticket);

  return (
    <div className="shrink-0 border-t border-border bg-card px-3 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2 shadow-[0_-2px_8px_rgba(0,0,0,0.04)] sm:px-4">
      {/* Subtotal breakdown */}
      {(sentSubtotalCents > 0 || newSubtotalCents > 0) && (
        <div className="text-xs space-y-1 rounded-lg bg-gray-50 dark:bg-gray-800/60 px-3 py-2">
          {sentSubtotalCents > 0 && (
            <div className="flex justify-between text-gray-500 dark:text-gray-400">
              <span>Ya enviados</span>
              <span className="tabular-nums font-medium">{format(sentSubtotalCents)}</span>
            </div>
          )}
          {newSubtotalCents > 0 && (
            <div className="flex justify-between text-primary font-semibold">
              <span>Productos nuevos</span>
              <span className="tabular-nums">{format(newSubtotalCents)}</span>
            </div>
          )}
        </div>
      )}

      {/* Grand total */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-gray-600 dark:text-gray-400">Total</span>
        <span className="text-2xl font-bold text-gray-900 dark:text-white tabular-nums tracking-tight">{format(totalCents)}</span>
      </div>

      {delivery && newItemsCount > 0 && <div className="flex justify-between gap-2 text-sm"><span>Envío{delivery.zoneName ? ` · ${delivery.zoneName}` : ''}</span><strong className="shrink-0 tabular-nums">{format(delivery.fee)}</strong></div>}
      {delivery?.error && newItemsCount > 0 && <p role="status" className="text-xs text-destructive">{delivery.error}</p>}
      {/* Send / Charge — min-height 56px for thumb-friendly tap targets */}
      <div className="grid grid-cols-1 gap-2">
		<AlertDialog open={reviewOpen} onOpenChange={setReviewOpen}>
			<AlertDialogTrigger asChild>
				<Button disabled={!canSend} aria-label={sending ? 'Enviando el pedido a cocina' : `Revisar y enviar ${newItemsCount} producto${newItemsCount === 1 ? '' : 's'} a cocina`} aria-busy={sending} className={cn('h-14 font-bold text-base shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1', canSend ? 'bg-primary hover:bg-primary/90 active:bg-primary/95 text-primary-foreground' : 'bg-muted text-muted-foreground cursor-not-allowed shadow-none')}>
					{sending ? <span className="flex items-center gap-1.5"><Loader2 className="h-4 w-4 animate-spin" />Enviando…</span> : <span className="flex items-center gap-1.5"><ChefHat className="h-4 w-4" />Revisar y enviar{newItemsCount > 0 && <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white/25 text-[11px] font-bold leading-none">{newItemsCount}</span>}</span>}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent onCloseAutoFocus={event => {
              if (!editDetailsAfterClose.current) return;
              event.preventDefault();
              editDetailsAfterClose.current = false;
              // Wait for the old focus/pointer lock to be released before
              // mounting the next modal, including its exit animation.
              requestAnimationFrame(() => onEditDetails?.());
            }} className="flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] max-w-[42rem] min-w-0 flex-col overflow-hidden p-4 sm:p-6">
				<AlertDialogHeader>
					<AlertDialogTitle>Enviar pedido a cocina</AlertDialogTitle>
					<AlertDialogDescription>Revisá los datos antes de crear la comanda. Después de que cocina comience a prepararla, los productos ya no se podrán editar.</AlertDialogDescription>
				</AlertDialogHeader>
				<div className="min-h-0 min-w-0 space-y-3 overflow-y-auto overscroll-contain">
				<div className="min-w-0 space-y-2 rounded-lg border bg-muted/40 p-3 text-sm">
					<div className="grid min-w-0 grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2"><span>Destino</span><strong className="min-w-0 break-words text-right">{ticket?.kind === 'table' ? `Mesa ${ticket.table_number || ''}` : delivery ? 'Delivery' : 'Para llevar'}</strong></div>
                    {delivery && <><div className="flex justify-between gap-3"><span>Zona / envío</span><strong className="min-w-0 break-words text-right">{delivery.zoneName || 'Tarifa general'} · {format(delivery.fee)}</strong></div><p className="break-words text-sm">{delivery.address}</p><div className="flex justify-between gap-3"><span>Total nuevo</span><strong>{format(newSubtotalCents + delivery.fee)}</strong></div></>}
					<div className="grid min-w-0 grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2"><span>Cliente</span><strong className="min-w-0 break-words text-right">{ticket?.customerName || 'Mostrador'}</strong></div>
					<div className="grid min-w-0 grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2"><span>Teléfono</span><strong className="min-w-0 break-words text-right">{ticket?.customerPhone || 'Sin teléfono'}</strong></div>
					<div className="grid min-w-0 grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2"><span>Productos</span><strong className="min-w-0 text-right">{newItemsCount}</strong></div>
					<div className="grid min-w-0 grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-2"><span>Subtotal nuevo</span><strong className="min-w-0 text-right tabular-nums">{format(newSubtotalCents)}</strong></div>
					{ticket?.notes && <div className="border-t pt-2"><span className="text-muted-foreground">Observaciones:</span><p className="mt-1 font-medium text-foreground">{ticket.notes}</p></div>}
				</div>
				<ul className="divide-y rounded-xl border px-3">{newItems.map(item => <li key={item.id} className="flex items-start justify-between gap-3 py-3 text-sm"><div className="min-w-0"><p className="break-words font-semibold">{item.qty}× {item.name}</p>{item.modifier_names?.length ? <p className="mt-1 text-xs text-muted-foreground">{item.modifier_names.join(', ')}</p> : null}{item.notes && <p className="mt-1 break-words text-xs text-muted-foreground">{item.notes}</p>}</div><span className="shrink-0 tabular-nums">{format(Math.round(parseFloat(String(item.price || 0)) * scale) * item.qty)}</span></li>)}</ul>
				</div>
				<AlertDialogFooter className="grid w-full shrink-0 grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_1.35fr] sm:space-x-0">
					<AlertDialogCancel className="m-0 w-full">Seguir editando</AlertDialogCancel>
					{onEditDetails && <AlertDialogCancel className="m-0 w-full" onClick={() => { editDetailsAfterClose.current = true; }}>Editar datos</AlertDialogCancel>}
					<AlertDialogAction className="m-0 w-full whitespace-normal" onClick={() => onSend?.()}><ChefHat className="mr-2 h-4 w-4 shrink-0" />Confirmar y enviar</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
        {hasUnpaidOrders && <Button
          onClick={onCharge}
          disabled={!canCharge}
          aria-label="Cobrar al cliente y registrar el pago"
          className={cn(
            'h-11 font-bold text-base shadow-sm transition-all focus-visible:ring-2 focus-visible:ring-success focus-visible:ring-offset-1',
            canCharge
              ? 'bg-success hover:bg-success/90 active:bg-success/95 text-success-foreground'
              : 'bg-muted text-muted-foreground cursor-not-allowed shadow-none',
          )}
        >
          <span className="flex items-center gap-1.5">
            <CreditCard className="w-4 h-4" />
            Cobrar
          </span>
        </Button>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

interface ActiveTicketPanelProps {
  delivery?: TicketDelivery;
  className?: string;
  ticket: TicketLike | null;
  newItems?: NewTicketItem[];
  sentOrders?: SentOrder[];
  onBumpQty: (itemId: string, delta: number) => void;
  onRemoveItem: (itemId: string) => void;
  onEditItemNotes?: (itemId: string) => void;
  onSend?: () => void;
  onCharge?: () => void;
  onAdjustGuests?: () => void;
	onEditDetails?: () => void;
  onAdjustSuccess?: (data: unknown) => void;
  locationId?: string;
  sending?: boolean;
  courses?: Course[];
  onSetCourse?: (itemId: string, courseId: string | null) => void;
}

export default function ActiveTicketPanel({
  delivery,
  className,
  ticket,                // active ticket object or null
  newItems = [],         // unsent items: [{ id, item_id, name, price, qty, course_id, ... }]
  sentOrders = [],       // sent rounds: [{ id, order_number, items: [...], created_at }]
  onBumpQty,             // (clientLineId, delta) => void
  onRemoveItem,          // (clientLineId) => void
  onEditItemNotes,
  onSend,                // () => void
  onCharge,              // () => void
  onAdjustGuests,        // optional () => void
	onEditDetails,
  onAdjustSuccess,       // optional (data) => void — called after inline adjustment success
  locationId = '',       // location_id for scoping adjustment reasons + manager list
  sending = false,
  courses = [],          // [{ id, name, sort_order }] for CourseSelect (Wave 11 T11.3)
  onSetCourse,           // optional (clientLineId, courseId | null) => void
}: ActiveTicketPanelProps) {
  const { scale } = useMoney();

  const newSubtotalCents = newItems.reduce(
    (sum, it) => sum + Math.round((parseFloat(String(it.price ?? 0)) * (it.qty || 0)) * scale),
    0,
  );
  const sentSubtotalCents = sentOrders.reduce((orderSum, order) => {
    if (typeof order.total_cents === 'number') return orderSum + order.total_cents;
    const items = Array.isArray(order.items) ? order.items : [];
    return orderSum + items.reduce((lineSum, it) => {
      if (typeof it.total_cents === 'number') return lineSum + it.total_cents;
      return lineSum + Math.round((parseFloat(String(it.unit_price ?? 0)) * (it.quantity || 0)) * scale);
    }, 0);
  }, 0);
  const totalCents = newSubtotalCents + sentSubtotalCents + (newItems.length ? delivery?.fee || 0 : 0);

  const hasUnpaidOrders = sentOrders.some((o) => o.payment_status !== 'paid');

  return (
    <aside
      aria-label="Comanda del pedido"
      className={cn(
        'pos-ticket h-full min-h-0 w-full shrink-0 flex-col bg-muted/30 md:w-[min(360px,43vw)] md:border-l xl:w-[400px]',
        className,
      )}
    >
		<TicketHeader ticket={ticket} onAdjustGuests={onAdjustGuests} onEditDetails={onEditDetails} />

      {/* Scrollable middle (Sent + New) */}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {(newItems.length > 0 || sentOrders.length === 0) && <NewSection
          newItems={newItems}
          onBumpQty={onBumpQty}
          onRemove={onRemoveItem}
          onEditNotes={onEditItemNotes}
          courses={courses}
          onSetCourse={onSetCourse}
        />}
        {sentOrders.length > 0 && <details className="border-t" open={newItems.length === 0}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">En cocina · {sentOrders.length} {sentOrders.length === 1 ? 'envío' : 'envíos'}</summary>
          <SentSection sentOrders={sentOrders} locationId={locationId} onAdjustSuccess={onAdjustSuccess} />
        </details>}
      </div>

      <TicketFooter
        delivery={delivery}
        ticket={ticket}
        newSubtotalCents={newSubtotalCents}
        sentSubtotalCents={sentSubtotalCents}
        totalCents={totalCents}
        onSend={onSend}
        onEditDetails={onEditDetails}
        onCharge={onCharge}
        sending={sending}
        hasUnpaidOrders={hasUnpaidOrders}
        newItemsCount={newItems.reduce((s, it) => s + (it.qty || 0), 0)}
        newItems={newItems}
      />
    </aside>
  );
}
