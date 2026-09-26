// ticket-card.jsx â€” one card in the per-station KDS grid.
//
// Rendered by src/pages/kds/station.jsx. The parent owns the ticket list and
// the bump/recall/refire/rush callbacks; this component is purely presentational
// except for elapsed-time formatting (which it derives from the shared 1Hz
// ticker so we don't run one interval per card) and the local
// "Recipe panel open?/checkbox checked?" state inside each <RecipeSection/>.
//
// The summary `ticket` prop carries the SSE/list payload (id, items, fired_atâ€¦).
// The optional `details` prop carries the GET /kds/tickets/{id}/details
// payload â€” ingredients, prep steps, variations, per-item status. The card
// gracefully renders without `details`; the parent fetches lazily and the
// recipe panel shows a quiet placeholder until the data lands.

import { useMemo } from 'react';
import {
  AlertTriangle, Bell, Check, Flame, Loader2, MapPin, Play, RotateCcw, StickyNote, Utensils,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { RecipeSection } from './recipe-section';
import type { KdsTicket, KdsTicketDetail, KdsTicketItem } from '../types';

// Color thresholds (minutes since fired).
const AMBER_MIN = 5;
const RED_MIN = 10;

function ageBucket(elapsedMs: number) {
  const mins = elapsedMs / 60000;
  if (mins >= RED_MIN) return 'red';
  if (mins >= AMBER_MIN) return 'amber';
  return 'green';
}

function fmtElapsed(elapsedMs: number) {
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return '0:00';
  const totalSec = Math.floor(elapsedMs / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// ---- Urgency color palette ----
// Backgrounds are strong so they read across a kitchen. Timer text is very
// large and uses maximum-contrast foreground colors.

const CARD_BY_BUCKET: Record<string, {
  card: string; header: string; headerText: string; timer: string;
  label: string; labelCls: string; pulseDot: string;
}> = {
  // Fresh ticket (< 5 min): dark emerald header, subtle border
  green: {
    card:   'bg-gray-900 border-2 border-emerald-600',
    header: 'bg-emerald-800',
    headerText: 'text-emerald-50',
    timer:  'text-emerald-200',
    label:  'Nuevo',
    labelCls: 'bg-emerald-700 text-emerald-100',
    pulseDot: 'bg-emerald-400',
  },
  // Warming (5-10 min): amber header, stronger border
  amber: {
    card:   'bg-gray-900 border-2 border-amber-500',
    header: 'bg-amber-700',
    headerText: 'text-amber-50',
    timer:  'text-amber-100',
    label:  'En espera',
    labelCls: 'bg-amber-600 text-amber-50',
    pulseDot: 'bg-amber-300 animate-pulse',
  },
  // Late (>= 10 min): red header, bright ring â€” demands immediate attention
  red: {
    card:   'bg-gray-900 border-2 border-red-500 ring-2 ring-red-500/50',
    header: 'bg-red-700',
    headerText: 'text-red-50',
    timer:  'text-red-100',
    label:  'Demorado',
    labelCls: 'bg-red-500 text-white animate-pulse',
    pulseDot: 'bg-red-300 animate-ping',
  },
};

// Per-item color: subtle dots and pills readable at a glance.
const ITEM_STATUS_STYLES: Record<string, { dot: string; pill: string; label: string }> = {
  fired: {
    dot:   'bg-gray-500',
    pill:  'bg-gray-700 text-gray-300',
    label: 'Nuevo',
  },
  in_progress: {
    dot:   'bg-amber-400',
    pill:  'bg-amber-900/60 text-amber-300',
    label: 'En preparaciÃ³n',
  },
  ready: {
    dot:   'bg-emerald-400',
    pill:  'bg-emerald-900/60 text-emerald-300',
    label: 'Listo',
  },
};

interface TicketCardProps {
  ticket: KdsTicket;
  details?: KdsTicketDetail | null;   // optional; from GET /kds/tickets/{id}/details
  detailsLoading?: boolean;
  now: number;
  onStart?: (ticket: KdsTicket) => void;
  onReady?: (ticket: KdsTicket) => void;
  onBump?: (ticket: KdsTicket) => void;
  onRecall?: (ticket: KdsTicket) => void;
  onRefire?: (ticket: KdsTicket) => void;
  onRush?: (ticket: KdsTicket) => void;
  showRecall?: boolean;
  busy?: boolean;
}

export function TicketCard({
  ticket,
  details,
  detailsLoading,
  now,
  onStart,
  onReady,
  onBump,
  onRecall,
  onRefire,
  onRush,
  showRecall = false,
  busy = false,
}: TicketCardProps) {
  const firedAtMs = ticket.fired_at
    ? Date.parse(ticket.fired_at)
    : (details?.fired_at ? Date.parse(details.fired_at) : Date.now());
  const elapsed = Math.max(0, now - firedAtMs);
  const bucket = ageBucket(elapsed);
  const theme = CARD_BY_BUCKET[bucket];

  const isBumped = ticket.status === 'bumped';
  const isFired = ticket.status === 'fired';
  const isPreparing = ticket.status === 'in_progress';
  const isReady = ticket.status === 'ready';
  const label = ticket.order_type
    || (ticket.table_number ? `Mesa ${ticket.table_number}` : null)
    || (details?.table_number ? `Mesa ${details.table_number}` : null)
    || 'Pedido';

  // Prefer the detailed item list when we have it (carries variations,
  // ingredients, prep_steps, notes, per-item status). Otherwise fall back
  // to the summary list from the SSE feed.
  const items = useMemo(() => {
    const fromDetails = Array.isArray(details?.items) ? details.items : null;
    if (fromDetails && fromDetails.length) return fromDetails;
    return Array.isArray(ticket.items) ? ticket.items : [];
  }, [details, ticket.items]);

  // Default the recipe panel open while the ticket is freshly fired and
  // collapse it once it transitions to in_progress on the backend. Local
  // "user ticked a step" wins inside RecipeSection itself.
  const recipeDefaultOpen = ticket.status !== 'in_progress';

  const orderNumber = ticket.ticket_number
    ?? details?.order_number
    ?? ticket.order_number
    ?? 'â€”';
  const tableNumber = ticket.table_number || details?.table_number || null;
  const serviceLabel = ({ dine_in: 'En salÃ³n', pickup: 'Para retirar', takeaway: 'Para retirar', delivery: 'EnvÃ­o a domicilio' } as Record<string, string>)[details?.order_type || ticket.order_type || ''] || label;
  const customerContext = [details?.customer_name ?? ticket.customer_name, details?.customer_phone ?? ticket.customer_phone].filter(Boolean).join(' · ');
  const deliveryAddress = details?.delivery_address ?? ticket.delivery_address;

  return (
    <div
      className={cn(
        'flex flex-col overflow-hidden rounded-xl shadow-xl transition-all duration-200',
        'animate-in fade-in-50 slide-in-from-bottom-2 duration-300',
        theme.card,
      )}
      role="article"
      aria-label={`Comanda ${orderNumber}`}
    >
      {/* ------------------------------------------------------------------ */}
      {/* Card header â€” order number, timer, urgency label                    */}
      {/* ------------------------------------------------------------------ */}
      <div className={cn('relative flex items-center justify-between gap-3 px-4 py-3', theme.header)}>
        {/* Left: order number + location */}
        <div className="flex min-w-0 flex-col gap-0.5">
          <div className="flex items-center gap-2">
            <Flame className={cn('size-5 shrink-0', theme.headerText)} aria-hidden="true" />
            <span className={cn('font-mono text-4xl font-black leading-none tabular-nums', theme.headerText)}>
              #{orderNumber}
            </span>
          </div>
          <span className={cn('ml-7 flex items-center gap-1 text-sm font-medium opacity-90', theme.headerText)}>
            {tableNumber && <MapPin className="size-3.5 shrink-0" aria-hidden="true" />}
            {tableNumber ? `Mesa ${tableNumber}` : serviceLabel}
          </span>
        </div>

        {/* Right: timer + status badges */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          {/* Big clock */}
          <div className={cn('flex items-center gap-1.5', theme.timer)}>
            <span className={cn('inline-block size-2.5 rounded-full shrink-0', theme.pulseDot)} aria-hidden="true" />
            <span className="font-mono text-3xl font-black tabular-nums leading-none">
              {fmtElapsed(elapsed)}
            </span>
          </div>

          {/* Urgency label + rush badge */}
          <div className="flex items-center gap-1.5">
            <span className={cn('rounded-full px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide', theme.labelCls)}>
              {theme.label}
            </span>
            {ticket.priority > 0 && (
              <span className="flex items-center gap-1 rounded-full bg-red-600 px-2 py-0.5 text-xs font-extrabold uppercase tracking-wide text-white">
                <Bell className="size-3" aria-hidden="true" /> Urgente
              </span>
            )}
            {detailsLoading && (
              <Loader2 className="size-3.5 animate-spin text-white/60" aria-hidden="true" />
            )}
          </div>
        </div>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Card body â€” items, notes, actions                                   */}
      {/* ------------------------------------------------------------------ */}
      <div className="flex flex-1 flex-col gap-3 p-4">
        {/* Item list */}
        {items.length === 0 ? (
          <p className="italic text-gray-500">(no items)</p>
        ) : (
          <ul className="flex-1 space-y-2.5">
            {items.map((it, idx) => (
              <TicketItem
                key={it.ticket_item_id || it.id || `${it.item_name || it.name}-${idx}`}
                item={it}
                recipeDefaultOpen={recipeDefaultOpen}
                storageKey={`${ticket.id}-${it.ticket_item_id || it.id || idx}`}
              />
            ))}
          </ul>
        )}

        {/* Ticket-level notes */}
        {(ticket.notes || details?.notes) && (
          <p className="rounded-lg border border-amber-700/40 bg-amber-900/30 px-3 py-2.5 text-sm font-medium italic text-amber-300">
            <StickyNote className="mr-1.5 inline size-3.5 align-text-bottom text-amber-400" aria-hidden="true" />
            {ticket.notes || details?.notes}
          </p>
        )}

        {(customerContext || deliveryAddress) && (
          <div className="space-y-1 rounded-lg border border-sky-800/50 bg-sky-950/30 px-3 py-2 text-xs text-sky-200">
            {customerContext && <p><span className="font-bold text-sky-300">Cliente:</span> {customerContext}</p>}
            {deliveryAddress && <p><span className="font-bold text-sky-300">Entrega:</span> {deliveryAddress}</p>}
          </div>
        )}

        {/* Action buttons */}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
          {isFired && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onStart?.(ticket)}
                className={cn(
                  'flex h-14 flex-1 min-w-[9rem] items-center justify-center gap-2 rounded-xl',
                  'bg-emerald-600 text-white text-lg font-extrabold',
                  'transition-colors hover:bg-emerald-500 active:bg-emerald-700',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
                aria-label={`Iniciar la preparaciÃ³n de la comanda ${orderNumber}`}
              >
                <Play className="size-6 shrink-0" aria-hidden="true" />
                Iniciar preparaciÃ³n
              </button>

              {/* Rush button â€” secondary, narrower */}
              <button
                type="button"
                disabled={busy || ticket.priority > 0}
                onClick={() => onRush?.(ticket)}
                title="Marcar como prioridad urgente"
                aria-label={`Dar prioridad a la comanda ${orderNumber}`}
                className={cn(
                  'flex h-14 items-center justify-center gap-2 rounded-xl px-4',
                  'border-2 border-orange-500 bg-orange-500/10 text-orange-400 text-sm font-bold',
                  'transition-colors hover:bg-orange-500/20 hover:text-orange-300',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
                  'disabled:opacity-40 disabled:cursor-not-allowed',
                )}
              >
                <Bell className="size-5 shrink-0" aria-hidden="true" />
              </button>
            </>
          )}

          {isPreparing && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onReady?.(ticket)}
              className={cn(
                'flex h-14 flex-1 items-center justify-center gap-2 rounded-xl',
                'bg-emerald-600 text-white text-lg font-extrabold transition-colors hover:bg-emerald-500',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              <Check className="size-6 shrink-0" aria-hidden="true" />
              Marcar listo
            </button>
          )}

          {isReady && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={() => onBump?.(ticket)}
                className={cn(
                  'flex h-14 flex-1 items-center justify-center gap-2 rounded-xl',
                  'bg-emerald-600 text-white text-lg font-extrabold transition-colors hover:bg-emerald-500',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
                  'disabled:opacity-50 disabled:cursor-not-allowed',
                )}
              >
                <Check className="size-6 shrink-0" aria-hidden="true" />
                Completar entrega
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => onRefire?.(ticket)}
                className="flex h-14 items-center justify-center rounded-xl border-2 border-gray-600 px-4 text-gray-200 transition-colors hover:bg-gray-700 disabled:opacity-50"
                title="Volver a preparar"
              >
                <RotateCcw className="size-5" aria-hidden="true" />
              </button>
            </>
          )}

          {isBumped && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRefire?.(ticket)}
              className={cn(
                'flex h-14 flex-1 items-center justify-center gap-2 rounded-xl',
                'bg-gray-700 text-gray-200 text-lg font-extrabold',
                'transition-colors hover:bg-gray-600',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
              aria-label={`Volver a preparar la comanda ${orderNumber}`}
            >
              <RotateCcw className="size-6 shrink-0" aria-hidden="true" />
              Volver a preparar
            </button>
          )}

          {showRecall && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onRecall?.(ticket)}
              title="Recall last bump"
              className={cn(
                'flex h-10 items-center gap-1.5 rounded-lg px-3',
                'border border-gray-600 bg-gray-800 text-gray-300 text-sm font-semibold',
                'transition-colors hover:bg-gray-700 hover:text-white',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gray-500',
                'disabled:opacity-50',
              )}
            >
              <RotateCcw className="size-4" aria-hidden="true" /> Recall
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---- TicketItem ----
// One row in the ticket: name, qty, variations, notes, optional recipe panel.

interface TicketItemProps {
  item: KdsTicketItem;
  recipeDefaultOpen: boolean;
  storageKey: string;
}

function TicketItem({ item, recipeDefaultOpen, storageKey }: TicketItemProps) {
  const name = item.item_name || item.name || 'Producto';
  const qty = Number(item.quantity ?? 1);
  const variations = Array.isArray(item.variations) ? item.variations : [];
  const allergens = Array.isArray(item.allergens) ? item.allergens : [];
  const statusKey = item.status || item.item_status || null;
  const status = statusKey ? ITEM_STATUS_STYLES[statusKey] || null : null;

  return (
    <li className="space-y-2 rounded-xl border border-gray-700 bg-gray-800/60 p-3">
      {/* Item name row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          {/* Status dot */}
          {status && (
            <span
              className={cn('inline-block size-3 shrink-0 rounded-full', status.dot)}
              title={status.label}
              aria-label={status.label}
            />
          )}
          <Utensils className="size-4 shrink-0 text-gray-500" aria-hidden="true" />
          <span className="text-xl font-extrabold leading-tight text-gray-50">{name}</span>
        </div>

        {/* Right side: status pill + qty */}
        <div className="flex shrink-0 items-center gap-2">
          {status && (
            <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide', status.pill)}>
              {status.label}
            </span>
          )}
          {/* Quantity badge â€” bold orange so it pops */}
          <span className="rounded-lg bg-orange-500/20 px-3 py-1 font-mono text-lg font-black tabular-nums text-orange-400">
            Ã—{qty}
          </span>
        </div>
      </div>

      {/* Allergens â€” safety-critical, rendered in red and high in the row */}
      {allergens.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 rounded-lg border border-red-500/50 bg-red-950/40 px-2 py-1.5">
          <AlertTriangle className="size-4 shrink-0 text-red-400" aria-hidden="true" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-red-400">AlÃ©rgenos</span>
          {allergens.map((a, i) => (
            <span
              key={`${a}-${i}`}
              className="rounded-full bg-red-500/25 px-2 py-0.5 text-xs font-bold text-red-200 ring-1 ring-inset ring-red-500/50"
            >
              {a}
            </span>
          ))}
        </div>
      )}

      {/* Variations / modifiers */}
      {variations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {variations.map((v, i) => (
            <span
              key={`${v}-${i}`}
              className="rounded-full border border-orange-700/40 bg-orange-900/20 px-2.5 py-0.5 text-xs font-semibold text-orange-300"
            >
              {v}
            </span>
          ))}
        </div>
      )}

      {/* Item-level notes */}
      {item.notes && (
        <p className="rounded-lg border border-amber-700/30 bg-amber-900/20 px-2.5 py-2 text-sm italic text-amber-300">
          <StickyNote className="mr-1 inline size-3.5 align-text-bottom text-amber-400" aria-hidden="true" />
          {item.notes}
        </p>
      )}

      {/* Recipe / prep steps panel */}
      <RecipeSection
        item={item}
        defaultOpen={recipeDefaultOpen}
        storageKey={storageKey}
      />
    </li>
  );
}

export default TicketCard;

