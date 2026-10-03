// workspace.tsx — dedicated POS cashier workspace (multi-ticket model).
//
// Toast/Square-style flow:
//   1. Top "tables strip" lists every table for the active location + walk-in
//      tickets the cashier has created in this session. Tap one to make it
//      active.
//   2. Tap an available table → opens a server-side `table_session` and the
//      ticket binds to it. Tap an occupied one → loads its existing orders.
//   3. Menu grid (right) adds items into the active ticket's "New" section.
//   4. "Send" fires only the new items as an additional order on this ticket;
//      they then appear in the read-only "Sent" section. Cashier can keep
//      adding rounds.
//   5. "Charge" opens a payment-method picker → cash or card modal → POST
//      /pos/orders/{id}/charge for each unpaid sent order. If the ticket is
//      table-bound, the backend closes the table_session atomically.
//
// Auth: accepts EITHER a staff PIN session (localStorage) OR a Supabase
// (owner/admin) session via useAuth(). One of them is required.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, Ban, Banknote, BarChart3, ChefHat, CreditCard, Filter, Home, ListOrdered, Loader2, Lock, LogOut, MapPin, MoreHorizontal, Plus, Receipt, RotateCcw, Scissors, Search, Settings2, ShoppingBag, Truck, Unlock, User as UserIcon, UserCheck, Utensils, X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { emojiFor } from '@/lib/item-emoji';
import { normalizeServiceStyle } from '@/lib/service-style';
import { hasAnyAccess } from '@/lib/access-control';

import { useAuth } from '@/context/auth-context';
import { useActor } from '@/context/actor-token-context';
import { usePOSDraft } from '@/context/pos-draft-context';
import { useDateTime, useMoney } from '@/context/locale-context';
import { supabase } from '@/services/supabase-client';
import { useToast } from '@/hooks/use-toast';
import { usePinModal } from '@/hooks/use-pin-modal';
import { api, registerManagerOverrideHandler } from '@/lib/api-client';
import {
  clearStoredRegister,
  getOpenSession,
  getStaff,
  getStaffDisplayName,
  persistRegister,
  readStoredRegister,
  submitPosOrder,
  type CashDrawerSession,
} from '@/services/pos';
import {
  listOpenSessions,
  listTables,
  listSections,
  openTableSession,
  transferSession,
  getSessionDetail,
  type RestaurantTable,
  type Section,
  type TableSession,
} from '@/services/tables';
import { chargeOrdersWithLegs, type TenderLeg } from '@/services/payment';

import { OfflineBanner } from '@/components/ui/sync-status';
import OpenRegisterModal from '@/pages/home/components/open-register-modal';
import ReturnModal from '@/pages/home/components/return-modal';
import { TablesStrip, type TableTileData } from './components/tables-strip';
import ActiveTicketPanel from './components/active-ticket-panel';
import type { Course } from './components/course-select';
import CashTenderModal from './components/cash-tender-modal';
import { CardTenderModal } from './components/card-tender-modal';
import { TablePickerDialog } from './components/table-picker-dialog';
import TenderModal from './components/tender-modal';
import SplitBySeat from './components/split-by-seat';
import ModifierPicker, { useItemHasModifiers, type Modifier } from './components/modifier-picker';
import ReceiptModal from './components/receipt-modal';
import OrderDetailsDialog, { type OrderDetails } from './components/order-details-dialog';
import { useDeliveryZones } from '@/pages/settings/delivery-zones/hooks/use-delivery-zones';
import { deliveryPrice } from '@/services/public-order';
import type { StoreDetail } from '@/services/marketplace';
import ItemNoteDialog from './components/item-note-dialog';

// ---------------------------------------------------------------------------
// Domain types — the POS workspace assembles its own client-side shapes from
// several sources (menu items, table sessions, orders); these mirror the
// backend rows this page actually reads (see per-field comments) and the
// shapes the already-typed child components below expect.
// ---------------------------------------------------------------------------

// Mirrors backend/migrations/001_baseline.sql `items` (subset selected below)
// plus the joined `categories(id, name)` relation.
interface MenuItem {
  id: string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  price: number | string;
  category_id: string;
  is_86ed: boolean;
  daily_quantity?: number | null;
  daily_sold_count?: number | null;
  daily_counter_date?: string | null;
  categories?: { id: string; name: string } | null;
}

// Mirrors backend/migrations/001_baseline.sql `categories` (subset selected below).
interface MenuCategory {
  id: string;
  name: string;
}

// A single unsent cart line on the active ticket.
interface CartLineItem {
  id: string;
  item_id: string;
  name: string;
  price: number;
  qty: number;
  variation_option_ids: string[];
  modifier_ids: string[];
  modifier_names: string[];
  course_id?: string | null;
  notes?: string;
}

interface WorkspaceSentOrderItem {
  order_item_id: string;
  item_name: string;
  quantity: number;
  unit_price: number | string;
  total_cents: number;
  item_status: string;
  notes?: string;
}

interface WorkspaceSentOrder {
  id: string;
  order_number?: string;
  created_at?: string;
  payment_status: string;
  paid_cents: number;
  kitchen_status?: string;
  total_cents: number;
  items: WorkspaceSentOrderItem[];
  // Index signature so this satisfies UnpaidOrder (services/payment.ts),
  // which chargeOrdersWithLegs() requires.
  [key: string]: unknown;
}

interface WorkspaceTicket {
  fulfillment?: 'takeaway' | 'delivery';
  deliveryAddress?: string;
  deliveryZoneID?: string;
  id: string;
  kind: 'walkin' | 'table';
  label?: string;
  sessionId?: string;
  tableId?: string;
  table_number?: string;
  section_name?: string;
  party_size?: number;
	customerId?: string;
	customerName?: string;
	customerPhone?: string;
	notes?: string;
  newItems: CartLineItem[];
  sentOrders: WorkspaceSentOrder[];
}

interface KitchenOrderSnapshot {
  order_id: string;
  station_tickets?: Array<{
    status?: string;
    items?: Array<{ order_item_id?: string }>;
  }>;
}

interface WalkInTileData {
  id: string;
  label: string;
  subtotal_cents: number;
  item_count: number;
}

// ---------------------------------------------------------------------------
// Constants & helpers
// ---------------------------------------------------------------------------

const uuid = () =>
  (crypto?.randomUUID?.() ||
    `cli-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);

function kitchenStatusFromSnapshot(snapshot: KitchenOrderSnapshot): string {
  const stationTickets = Array.isArray(snapshot.station_tickets) ? snapshot.station_tickets : [];
  if (stationTickets.length === 0) return 'pending';
  if (stationTickets.every((ticket) => ticket.status === 'bumped')) return 'bumped';
  if (stationTickets.every((ticket) => ticket.status === 'ready' || ticket.status === 'bumped')) return 'ready';
  if (stationTickets.some((ticket) => ticket.status === 'in_progress')) return 'in_progress';
  return 'fired';
}

function kitchenItemStatusesFromSnapshot(snapshot: KitchenOrderSnapshot): Map<string, string> {
  const statuses = new Map<string, string>();
  for (const ticket of snapshot.station_tickets || []) {
    for (const item of ticket.items || []) {
      if (item.order_item_id) statuses.set(item.order_item_id, ticket.status || 'fired');
    }
  }
  return statuses;
}

/**
 * Compute remaining_today from the raw daily countdown columns.
 * Returns null when daily_quantity is null/undefined (unlimited).
 * Returns GREATEST(daily_quantity - today's sold count, 0) otherwise.
 *
 * `todayStr` is the store's LOCAL trading date and must be passed in. Deriving
 * it here from toISOString() would give the UTC date, so a Los Angeles till
 * would roll over to tomorrow's counters at 16:00 and show today's sold-out
 * items as available again.
 */
function computeRemainingToday(item: MenuItem, todayStr: string): number | null {
  if (item.daily_quantity == null) return null;
  const soldToday =
    item.daily_counter_date === todayStr
      ? (item.daily_sold_count ?? 0)
      : 0;
  return Math.max(item.daily_quantity - soldToday, 0);
}

/**
 * Small inline pill showing the daily countdown for an item tile.
 * Defensive: renders nothing when remaining is null/undefined.
 */
function ItemCountdownPill({ remaining }: { remaining: number | null }) {
  if (remaining === null || remaining === undefined) return null;
  if (remaining === 0) {
    return (
      <span className="absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-destructive text-destructive-foreground leading-none">
        Agotado
      </span>
    );
  }
  // "Running low" is a caution signal (a reversible, needs-attention state,
  // not sold out yet) — the warning token, never the destructive one, which
  // is reserved for the actual "Sold out" case above.
  return (
    <span className="absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-warning text-warning-foreground leading-none tabular-nums">
      Quedan {remaining}
    </span>
  );
}

// Build a fresh client-side ticket for a walk-in / takeaway.
function makeWalkInTicket(n: number): WorkspaceTicket {
  return {
    id: `walkin-${uuid()}`,
    kind: 'walkin',
    label: `Mostrador #${n}`,
    newItems: [],
    sentOrders: [],
  };
}

// Build a ticket from a server-side table_session row + a table row.
function ticketFromSession({ session, table, section, orders = [] }: {
  session: TableSession;
  table?: RestaurantTable;
  section?: Section;
  orders?: WorkspaceSentOrder[];
}): WorkspaceTicket {
  return {
    id: session.id,                 // ticket id == session id
    kind: 'table',
    sessionId: session.id,
    tableId: session.table_id || table?.id,
    table_number: table?.label,
    section_name: section?.name,
    party_size: session.party_size || 1,
    newItems: [],
    sentOrders: orders,
  };
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function PosWorkspacePage() {
  return <PosWorkspaceContent />;
}

export function EmbeddedPosWorkspace() {
  return <PosWorkspaceContent embedded />;
}

function PosWorkspaceContent({ embedded = false }: { embedded?: boolean }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { activeLocation, activeMembership, user, userProfile, signOut } = useAuth();
  const { format, scale, currency } = useMoney();
  const { zones: deliveryZones, loading: loadingDeliveryZones, error: deliveryZonesError, refresh: refreshDeliveryZones } = useDeliveryZones(activeLocation?.id);
  const { today } = useDateTime();
  // The store's local trading date, not the browser's UTC one.
  const todayStr = today();

  // ----- PIN re-auth (actor expiry) -------------------------------------
  // usePinModal auto-triggers the PIN modal when the actor expires while on
  // /pos/workspace, preserving all in-progress cart/ticket state.
  // requestPin is also exported so child actions (e.g. void) can trigger
  // manager-override flows directly.
  const { requestPin } = usePinModal();
  // Make requestPin accessible to sub-handlers via ref so closures stay stable.
  const requestPinRef = useRef(requestPin);
  requestPinRef.current = requestPin;

  // Register the manager-override handler with the api-client for the lifetime
  // of this workspace page. On 403 missing_capability, the client will call
  // this to open the PIN modal and obtain a one-shot manager token, then replay
  // the original request automatically.
  useEffect(() => {
    const unregister = registerManagerOverrideHandler(async ({ capability, reason }) => {
      const token = await requestPinRef.current({
        reason: reason || capability,
        isManagerOverride: true,
      });
      // requestPin's declared return type (Actor | string, see use-pin-modal.ts)
      // covers both the plain PIN-login and manager-override paths; with
      // isManagerOverride: true the resolved value is always the override
      // token string. Cast reflects that call-site guarantee, not a new any.
      return token as string | null | undefined;
    });
    return unregister;
  }, []);

  // ----- actor overlay (T9.5) --------------------------------------------
  const { actor, clearActor } = useActor();
  // Display name comes from:
  //  1. The actor overlay (staff.display_name from /pos/pin-verify)
  //  2. Legacy staff localStorage session
  //  3. Member profile / OAuth name
  const actorDisplayName = actor?.display_name || null;

  // ----- auth gate -------------------------------------------------------
  const staff = useMemo(() => getStaff(), []);
  const staffName = useMemo(() => getStaffDisplayName(), []);
  const displayName = actorDisplayName || staffName
    || userProfile?.full_name
    || user?.email || 'Usuario';
  // The device is authed if: (a) actor overlay set, (b) legacy staff session, or (c) member JWT.
  const isAuthed = Boolean(actor || staff || user);
  useEffect(() => { if (!isAuthed) void navigate('/pos/login', { replace: true }); }, [isAuthed, navigate]);

  // Owner/manager detection — used to gate the "Design floor plan" CTA.
  // Signals, in priority order:
  //   1. Actor PIN overlay → its role string (owner/manager/admin).
  //   2. Legacy staff PIN session → its role string.
  //   3. No staff/actor at all → an owner/admin Supabase email login (full access).
  const isOwnerManager = useMemo(() => {
    const elevated = (r?: string) => ['owner', 'manager', 'admin'].includes(String(r || '').toLowerCase());
    if (actor) return elevated(actor.role);
    if (staff) return elevated(staff.role);
    return elevated(activeMembership?.role);
  }, [actor, staff, activeMembership?.role]);
  const canOpenModule = (capability: string) => hasAnyAccess(activeMembership, [capability], actor?.capabilities, actor?.role);

  // ----- register session ------------------------------------------------
  // Mirrors home/index.jsx: only staff PIN sessions need an open cash drawer.
  // Owners/admins (Supabase email login) can place orders without one — they
  // typically don't have a physical till in front of them anyway.
  const isStaffSession = Boolean(staff);
  const stored = useMemo(() => readStoredRegister(), []);
  const [registerSession, setRegisterSession] = useState<CashDrawerSession | null>(null);
  const [registerLoading, setRegisterLoading] = useState(isStaffSession);
  const [isOpenRegisterOpen, setIsOpenRegisterOpen] = useState(false);
  const [isReturnOpen, setIsReturnOpen] = useState(false);
  // Effective gate used everywhere downstream — `true` when the cashier may
  // place orders. Owners always pass; staff need an open register.
  const canTakeOrders = !isStaffSession || Boolean(registerSession);

  // ----- courses (Wave 11 — T11.2/T11.3) -----------------------------------
  // Loaded once per location; passed down to ticket lines for course assignment.
  const [courses, setCourses] = useState<Course[]>([]);
  useEffect(() => {
    if (!activeLocation?.id) { setCourses([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase
          .from('courses')
          .select('id, name, sort_order, fire_on_previous_course_bumped')
          .eq('location_id', activeLocation.id)
          .eq('is_active', true)
          .order('sort_order', { ascending: true });
        if (!cancelled) setCourses(data || []);
      } catch { /* non-critical */ }
    })();
    return () => { cancelled = true; };
  }, [activeLocation?.id]);

  // ----- menu state ------------------------------------------------------
  const [items, setItems] = useState<MenuItem[]>([]);
  const [categories, setCategories] = useState<MenuCategory[]>([]);
  const [loadingMenu, setLoadingMenu] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('all');
  const [mobileView, setMobileView] = useState<'products' | 'ticket'>('products');

  // ----- tables / sessions ----------------------------------------------
  const [tables, setTables] = useState<RestaurantTable[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [tablesLoading, setTablesLoading] = useState(true);

  // Map<ticketId, Ticket> — both table-bound and walk-in tickets.
  // Using an object (plain map) for predictable React equality.
  const [tickets, setTickets] = useState<Record<string, WorkspaceTicket>>({});
  const [activeTicketId, setActiveTicketId] = useState<string | null>(null);
  const [walkInCounter, setWalkInCounter] = useState(1);
  const [openingTable, setOpeningTable] = useState(false);
  const { scope: draftScope, read: readDraft, save: saveDraft } = usePOSDraft<{
    tickets: Record<string, WorkspaceTicket>;
    activeTicketId: string | null;
    walkInCounter: number;
  }>();
  const [loadedDraftScope, setLoadedDraftScope] = useState<string | null>(null);

  useEffect(() => {
    const draft = readDraft();
    setTickets(draft?.tickets || {});
    setActiveTicketId(draft?.activeTicketId || null);
    setWalkInCounter(draft?.walkInCounter || 1);
    setLoadedDraftScope(draftScope);
  }, [draftScope, readDraft]);

  useEffect(() => {
    if (draftScope && loadedDraftScope === draftScope) saveDraft({ tickets, activeTicketId, walkInCounter });
  }, [draftScope, loadedDraftScope, saveDraft, tickets, activeTicketId, walkInCounter]);

  // A floor plan exists once the location has at least one table row. Until
  // then, dine-in cannot proceed (there is nothing to seat a guest at).
  const hasFloorPlan = tables.length > 0;

  const serviceStyle = normalizeServiceStyle(activeLocation?.service_style) ?? 'dine_in';
  const isDineInMode = serviceStyle === 'dine_in';

  const handleDesignFloor = useCallback(() => {
    void navigate('/floor/edit');
  }, [navigate]);

  // Assign a course to a new (unsent) item on the active ticket.
  // Defined here (after tickets/activeTicketId state) to avoid a temporal
  // dead-zone error from the parallel Wave 11 edits.
  const handleSetCourse = useCallback((clientId: string, courseId: string | null) => {
    if (!activeTicketId) return;
    setTickets((prev) => {
      const t = prev[activeTicketId];
      if (!t) return prev;
      return {
        ...prev,
        [activeTicketId]: {
          ...t,
          newItems: t.newItems.map((ni) =>
            ni.id === clientId ? { ...ni, course_id: courseId || null } : ni,
          ),
        },
      };
    });
  }, [activeTicketId]);

  // ----- send/charge state ----------------------------------------------
  const [sending, setSending] = useState(false);
  const [chargeMethod, setChargeMethod] = useState<'cash' | 'card_in_person' | null>(null);
  const [chargeBusy, setChargeBusy] = useState(false);
  const [showMethodPicker, setShowMethodPicker] = useState(false);

  // ----- assign-table flow -----------------------------------------------
  const [showTablePicker, setShowTablePicker] = useState(false);
  const [assigningTable, setAssigningTable] = useState(false);
	const [showOrderDetails, setShowOrderDetails] = useState(false);
	const [editingNoteItemId, setEditingNoteItemId] = useState<string | null>(null);

  // ----- modifier picker state --------------------------------------------
  const [modifierPickerItem, setModifierPickerItem] = useState<MenuItem | null>(null); // item being customised
  const { check: checkHasModifiers } = useItemHasModifiers();

  // Eat-in entry point. A dine-in order needs a table; if no floor plan has
  // been designed (zero tables for this location) there is nothing to pick, so
  // we surface friendly guidance instead of a destructive toast. In
  // takeaway-only mode this handler is never called from the main flow —
  // it's still reachable from the "Assign Table" header button for walk-ins.
  const handleStartEatIn = useCallback(() => {
    if (!hasFloorPlan) {
      toast({
        title: 'Todavía no hay mesas configuradas',
        description: isOwnerManager
          ? 'Configurá el plano de mesas para atender en el local. Los pedidos para llevar funcionan sin plano.'
          : 'Pedile a un gerente que configure el plano de mesas. Mientras tanto, podés seguir tomando pedidos para llevar.',
      });
      return;
    }
    setShowTablePicker(true);
  }, [hasFloorPlan, isOwnerManager, toast]);

  // ----- split tender (TenderModal) state ---------------------------------
  const [showTenderModal, setShowTenderModal] = useState(false);
  const [tenderError, setTenderError] = useState('');

  // ----- receipt modal state ----------------------------------------------
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [receiptOrderId, setReceiptOrderId] = useState<string | null>(null);

  // ----- split-by-seat state ----------------------------------------------
  const [showSplitBySeat, setShowSplitBySeat] = useState(false);

  // ===== effects =========================================================

  // Register check — only for staff PIN sessions.
  useEffect(() => {
    if (!isStaffSession) { setRegisterLoading(false); return; }
    if (!activeLocation?.id) { setRegisterLoading(false); return; }
    let cancelled = false;
    setRegisterLoading(true);
    (async () => {
      try {
        let drawerId = stored?.drawerId || '';
        if (!drawerId) {
          const { data } = await supabase
            .from('cash_drawers').select('id')
            .eq('location_id', activeLocation.id).eq('is_active', true).limit(1);
          drawerId = data?.[0]?.id || '';
        }
        if (!drawerId) {
          // No drawer configured for this location — staff can't take cash
          // orders until one is created in settings. Show a non-blocking toast
          // rather than auto-popping a modal the cashier can't act on.
          if (!cancelled) {
            setRegisterSession(null);
            toast({
              variant: 'destructive',
              title: 'No hay una caja configurada',
              description: 'Pedile a un administrador que la agregue en Configuración → Local.',
            });
          }
          return;
        }
        const session = await getOpenSession(drawerId);
        if (cancelled) return;
        if (session?.id) {
          setRegisterSession(session);
          persistRegister({ sessionId: session.id, drawerId, openedAt: session.opened_at });
        } else {
          clearStoredRegister();
          setRegisterSession(null);
          setIsOpenRegisterOpen(true);
        }
      } catch (err) {
        if (!cancelled) console.error('Register check failed:', err);
      } finally {
        if (!cancelled) setRegisterLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeLocation?.id, isStaffSession]);

  // Menu load
  useEffect(() => {
    if (!activeLocation?.id) {
      setItems([]); setCategories([]); setLoadingMenu(false);
      return;
    }
    let cancelled = false;
    setLoadingMenu(true);
    (async () => {
      try {
        const [{ data: cats }, { data: rows }] = await Promise.all([
          supabase.from('categories').select('id, name')
            .eq('location_id', activeLocation.id).eq('is_active', true)
            .order('sort_order', { ascending: true }).order('name', { ascending: true }),
          supabase.from('items').select(`
            id, name, description, image_url, price, category_id, is_86ed,
            daily_quantity, daily_sold_count, daily_counter_date,
            categories ( id, name )
          `).eq('location_id', activeLocation.id).eq('is_active', true)
            .order('sort_order', { ascending: true }).order('name', { ascending: true }),
        ]);
        if (cancelled) return;
        setCategories(cats || []);
        setItems(rows || []);
      } catch (err) {
        console.error('Menu load failed:', err);
        if (!cancelled) toast({ variant: 'destructive', title: 'No se pudo cargar el menú', description: err instanceof Error ? err.message : 'Error desconocido' });
      } finally {
        if (!cancelled) setLoadingMenu(false);
      }
    })();
    return () => { cancelled = true; };
  }, [activeLocation?.id, toast]);

  // Tables + open sessions
  const refreshTables = useCallback(async () => {
    if (!activeLocation?.id) return;
    setTablesLoading(true);
    try {
      const [tbls, secs] = await Promise.all([
        listTables(activeLocation.id),
        listSections(activeLocation.id),
      ]);
      setTables(tbls);
      setSections(secs);
    } catch (err) {
      console.error('Tables load failed:', err);
    } finally {
      setTablesLoading(false);
    }
  }, [activeLocation?.id]);

  // Initial load: tables + open sessions → build tickets
  useEffect(() => {
    if (!activeLocation?.id) return;
    let cancelled = false;
    (async () => {
      await refreshTables();
      try {
        const openSessions = await listOpenSessions(activeLocation.id);
        if (cancelled) return;
        // For each open session, hydrate orders via SessionDetail.
        const detailFetches = await Promise.all(
          openSessions.map((s) => getSessionDetail(s.id).catch(() => null)),
        );
        if (cancelled) return;
        const tbls = await listTables(activeLocation.id);
        const secs = await listSections(activeLocation.id);
        if (cancelled) return;
        const next: Record<string, WorkspaceTicket> = {};
        detailFetches.forEach((detail) => {
          if (!detail) return;
          // Session detail carries the complete order snapshot required to
          // restore totals, payment state and line items after a reload.
          const raw = detail as unknown as {
            orders?: Array<{
              id: string;
              order_number?: string;
              created_at?: string;
              payment_status?: string;
              paid_cents?: number;
              kitchen_status?: string;
              total_cents?: number;
              total_amount_cents?: number;
              total?: number;
              customer_id?: string | null;
              customer_name?: string | null;
              customer_phone?: string | null;
              notes?: string | null;
              items?: Array<{
                id: string;
                item_name?: string;
                name?: string;
                quantity?: number;
                unit_price?: string | number;
                total_cents?: number;
                item_status?: string;
                notes?: string;
                modifier_names?: string[];
              }>;
            }>;
          };
          const session = (raw as { session?: TableSession }).session || detail;
          const table = tbls.find((t) => t.id === session.table_id);
          const section = secs.find((s) => s.id === table?.section_id);
          // Hydrate orders attached to this session into "sent" form.
          const sentOrders: WorkspaceSentOrder[] = (raw.orders || []).map((o) => ({
            id: o.id,
            order_number: o.order_number,
            created_at: o.created_at,
            payment_status: o.payment_status || 'pending',
            paid_cents: typeof o.paid_cents === 'number' ? o.paid_cents : 0,
            kitchen_status: o.kitchen_status,
            total_cents: typeof o.total_cents === 'number'
              ? o.total_cents
              : typeof o.total_amount_cents === 'number'
                ? o.total_amount_cents
              : (typeof o.total === 'number' ? Math.round(o.total * scale) : 0),
            items: (o.items || []).map((it) => ({
              order_item_id: it.id,
              item_name: it.item_name || it.name || '',
              quantity: it.quantity || 0,
              unit_price: it.unit_price || 0,
              total_cents: typeof it.total_cents === 'number'
                ? it.total_cents
                : Math.round((parseFloat(String(it.unit_price || 0)) * (it.quantity || 0)) * scale),
              item_status: it.item_status || 'fired',
              notes: it.notes,
              modifier_names: Array.isArray(it.modifier_names) ? it.modifier_names : [],
            })),
          }));
          const rawOrders = raw.orders || [];
          const latestOrder = rawOrders.length > 0 ? rawOrders[rawOrders.length - 1] : undefined;
          next[session.id] = {
            ...ticketFromSession({ session, table, section, orders: sentOrders }),
            customerId: latestOrder?.customer_id || undefined,
            customerName: latestOrder?.customer_name || undefined,
            customerPhone: latestOrder?.customer_phone || undefined,
            notes: latestOrder?.notes || undefined,
          };
        });
        setTickets(current => {
          // Keep local walk-ins and unsent table lines when the server's
          // session snapshot arrives, including a return from another module.
          const merged = { ...next };
          for (const ticket of Object.values(current)) {
            if (ticket.kind === 'walkin') merged[ticket.id] = ticket;
            else if (merged[ticket.id]) merged[ticket.id] = {
              ...merged[ticket.id], newItems: ticket.newItems,
              ...(ticket.newItems.length ? { customerId: ticket.customerId, customerName: ticket.customerName, customerPhone: ticket.customerPhone, notes: ticket.notes } : {}),
            };
          }
          return merged;
        });
      } catch (err) {
        console.error('Open sessions load failed:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [activeLocation?.id, draftScope, refreshTables, scale]);

  // ===== derived =========================================================

  const filteredItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((it) => {
      if (categoryId !== 'all' && it.category_id !== categoryId) return false;
      if (!q) return true;
      return it.name?.toLowerCase().includes(q)
        || it.description?.toLowerCase().includes(q)
        || it.categories?.name?.toLowerCase().includes(q);
    });
  }, [items, categoryId, search]);

  const activeTicket = activeTicketId ? tickets[activeTicketId] : null;
  const orderDetailsValue = useMemo(() => ({
    customerId: activeTicket?.customerId, customerName: activeTicket?.customerName, customerPhone: activeTicket?.customerPhone, notes: activeTicket?.notes,
    fulfillment: activeTicket?.fulfillment, deliveryAddress: activeTicket?.deliveryAddress, deliveryZoneID: activeTicket?.deliveryZoneID,
  }), [activeTicket?.customerId, activeTicket?.customerName, activeTicket?.customerPhone, activeTicket?.notes, activeTicket?.fulfillment, activeTicket?.deliveryAddress, activeTicket?.deliveryZoneID]);
  const isDeliveryTicket = activeTicket?.kind === 'walkin' && activeTicket.fulfillment === 'delivery';
  const deliveryStore: StoreDetail = {
    id: activeLocation?.id || '', name: activeLocation?.name || '', slug: null, city: null, country: null, address: null, description: null,
    offers_delivery: Boolean(activeLocation?.accepts_delivery ?? activeLocation?.offers_delivery) || deliveryZones.length > 0 || isDeliveryTicket,
    offers_collection: true, currency_code: currency,
    estimated_prep_time_minutes: 30, avg_rating: null, review_count: 0, categories: [], online_payment_available: false,
    delivery_zones: deliveryZones.filter(zone => zone.is_active !== false), delivery_zones_required: deliveryZones.length > 0,
    delivery_fee_cents: Math.round(Number(activeLocation?.delivery_fee || 0) * scale),
    free_delivery_threshold_cents: Math.round(Number(activeLocation?.free_delivery_threshold || 0) * scale),
  };
  const draftProductsCents = activeTicket?.newItems.reduce((sum, item) => sum + Math.round(item.price * scale) * item.qty, 0) || 0;
  const deliveryQuote = deliveryPrice(deliveryStore, draftProductsCents, isDeliveryTicket ? 'delivery' : 'collection', isDeliveryTicket ? activeTicket.deliveryZoneID : '');
  const deliveryError = !isDeliveryTicket ? '' : loadingDeliveryZones ? 'Cargando tarifas de envío…' : deliveryZonesError ? 'No pudimos cargar las tarifas. Volvé a abrir Datos para actualizar.' : deliveryQuote.pending ? 'Elegí una zona de entrega en Datos.' : !deliveryQuote.ready ? `Agregá productos hasta alcanzar el mínimo de ${format(deliveryQuote.minimum)} para esta zona.` : (activeTicket.deliveryAddress?.trim().length || 0) < 8 ? 'Completá la dirección de entrega en Datos.' : '';
	const editingNoteItem = activeTicket?.newItems.find((item) => item.id === editingNoteItemId);

	const handleSaveOrderDetails = useCallback((details: OrderDetails) => {
		if (!activeTicketId) return;
		setTickets((previous) => {
			const ticket = previous[activeTicketId];
			if (!ticket) return previous;
			return { ...previous, [activeTicketId]: { ...ticket, ...details } };
		});
		toast({ title: 'Datos del pedido guardados', description: 'Se incluirán en la comanda al enviar a cocina.' });
	}, [activeTicketId, toast]);

	const handleSaveItemNotes = useCallback((notes?: string) => {
		if (!activeTicketId || !editingNoteItemId) return;
		setTickets((previous) => {
			const ticket = previous[activeTicketId];
			if (!ticket) return previous;
			return {
				...previous,
				[activeTicketId]: {
					...ticket,
					newItems: ticket.newItems.map((item) => item.id === editingNoteItemId ? { ...item, notes } : item),
				},
			};
		});
	}, [activeTicketId, editingNoteItemId]);

  // Keep the kitchen state visible beside the order. The sent section used
  // to be a one-time client snapshot, so it stayed on "Enviado" even after
  // cooks started or completed the comanda.
  const sentOrderKey = useMemo(() => Array.from(new Set(
    Object.values(tickets).flatMap((ticket) => ticket.sentOrders.map((order) => order.id)),
  )).sort().join(','), [tickets]);

  useEffect(() => {
    if (!sentOrderKey) return;
    let cancelled = false;

    const syncKitchenStatuses = async () => {
      try {
        const orderIds = sentOrderKey.split(',').filter(Boolean);
        const { data, error } = await api.request<KitchenOrderSnapshot[]>('GET', '/kds/expo');
        if (cancelled) return;

        // The board intentionally removes an order after every station hands
        // it off. Fetch only those missing orders directly so the POS can
        // still advance its last visible state from "Lista" to "Entregada".
        // This also provides a fallback if the board request itself fails.
        const snapshots = !error && Array.isArray(data) ? data : [];
        const snapshotByOrder = new Map(snapshots.map((snapshot) => [snapshot.order_id, snapshot]));
        const missingOrderIds = orderIds.filter((orderId) => !snapshotByOrder.has(orderId));
        if (missingOrderIds.length > 0) {
          const details = await Promise.all(missingOrderIds.map((orderId) =>
            api.request<KitchenOrderSnapshot>('GET', `/kds/orders/${encodeURIComponent(orderId)}/expo`),
          ));
          if (cancelled) return;
          for (const detail of details) {
            if (!detail.error && detail.data?.order_id) {
              snapshotByOrder.set(detail.data.order_id, detail.data);
            }
          }
        }
        if (snapshotByOrder.size === 0) return;

        setTickets((previous) => {
          let changed = false;
          const next: Record<string, WorkspaceTicket> = {};
          for (const [ticketId, ticket] of Object.entries(previous)) {
            let ticketChanged = false;
            const sentOrders = ticket.sentOrders.map((order) => {
              const snapshot = snapshotByOrder.get(order.id);
              if (!snapshot) return order;
              const kitchenStatus = kitchenStatusFromSnapshot(snapshot);
              const itemStatuses = kitchenItemStatusesFromSnapshot(snapshot);
              const items = order.items.map((item) => {
                const itemStatus = itemStatuses.get(item.order_item_id) || kitchenStatus;
                return item.item_status === itemStatus ? item : { ...item, item_status: itemStatus };
              });
              const itemChanged = items.some((item, index) => item !== order.items[index]);
              if (order.kitchen_status === kitchenStatus && !itemChanged) return order;
              changed = true;
              ticketChanged = true;
              return {
                ...order,
                kitchen_status: kitchenStatus,
                items,
              };
            });
            next[ticketId] = ticketChanged ? { ...ticket, sentOrders } : ticket;
          }
          return changed ? next : previous;
        });
      } catch (error) {
        console.error('Kitchen status sync failed:', error);
      }
    };

    void syncKitchenStatuses();
    const interval = window.setInterval(() => { void syncKitchenStatuses(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [sentOrderKey]);

  // Decorate table tiles with the active ticket subtotal
  const tableTiles: TableTileData[] = useMemo(() => {
    return tables.map((t) => {
      const ticket = Object.values(tickets).find((x) => x.kind === 'table' && x.tableId === t.id);
      const subtotal = ticket
        ? subtotalCentsOfTicket(ticket, scale)
        : 0;
      return {
        ...t,
        section_name: sections.find((s) => s.id === t.section_id)?.name,
        subtotal_cents: subtotal,
        // mark as occupied if we have an open ticket for it (covers fresh-opens
        // before refreshTables() has caught up)
        status: ticket ? 'occupied' : t.status,
      };
    });
  }, [tables, sections, tickets, scale]);

  const walkInTiles: WalkInTileData[] = useMemo(() => {
    return Object.values(tickets)
      .filter((t) => t.kind === 'walkin')
      .map((t) => ({
        id: t.id,
        label: t.label || '',
        subtotal_cents: subtotalCentsOfTicket(t, scale),
        item_count: t.newItems.reduce((s, it) => s + it.qty, 0)
                  + t.sentOrders.reduce((s, o) => s + (o.items?.length || 0), 0),
      }));
  }, [tickets, scale]);

  // ===== handlers ========================================================

  const updateTicket = useCallback((ticketId: string, patch: Partial<WorkspaceTicket> | ((t: WorkspaceTicket) => WorkspaceTicket)) => {
    setTickets((prev) => {
      const t = prev[ticketId];
      if (!t) return prev;
      return { ...prev, [ticketId]: typeof patch === 'function' ? patch(t) : { ...t, ...patch } };
    });
  }, []);

  const handleSelectTile = useCallback(async (ticketId: string, kind: 'table' | 'walkin') => {
    if (kind === 'walkin') {
      setActiveTicketId(ticketId);
      return;
    }
    // table tile — find existing ticket bound to this table OR open a session
    const existing = Object.values(tickets).find(
      (t) => t.kind === 'table' && t.tableId === ticketId,
    );
    if (existing) {
      setActiveTicketId(existing.id);
      return;
    }
    if (openingTable) return;
    setOpeningTable(true);
    try {
      const session = await openTableSession({
        tableId: ticketId,
        locationId: activeLocation!.id,
        partySize: 1,
        openedBy: staff?.id || undefined,
      });
      const table = tables.find((t) => t.id === ticketId);
      const section = sections.find((s) => s.id === table?.section_id);
      const newTicket = ticketFromSession({ session, table, section, orders: [] });
      setTickets((prev) => ({ ...prev, [newTicket.id]: newTicket }));
      setActiveTicketId(newTicket.id);
      // mark the table as occupied locally
      setTables((prev) => prev.map((t) => t.id === ticketId ? { ...t, status: 'occupied' as const } : t));
      toast({ title: `Se abrió ${table?.label ? `la mesa ${table.label}` : 'la mesa'}` });
    } catch (err) {
      console.error('Open session failed:', err);
      toast({
        variant: 'destructive',
        title: 'No se pudo abrir esta mesa',
        description: err instanceof Error ? err.message : 'Intentá nuevamente.',
      });
    } finally {
      setOpeningTable(false);
    }
  }, [tickets, openingTable, activeLocation?.id, staff?.id, user?.id, tables, sections, toast]);

  const handleAddWalkIn = useCallback(() => {
    const t = makeWalkInTicket(walkInCounter);
    setWalkInCounter((n) => n + 1);
    setTickets((prev) => ({ ...prev, [t.id]: t }));
    setActiveTicketId(t.id);
  }, [walkInCounter]);

  const handleAddDelivery = () => {
    const ticket = { ...makeWalkInTicket(walkInCounter), fulfillment: 'delivery' as const };
    setWalkInCounter(n => n + 1);
    setTickets(previous => ({ ...previous, [ticket.id]: ticket }));
    setActiveTicketId(ticket.id);
    setShowOrderDetails(true);
  };

  // commitAddItem — called directly (no modifiers) or after modifier picker confirms.
  const commitAddItem = useCallback((item: MenuItem, { extraCents = 0, selectedModifiers = [], linePriceCents = null }: {
    extraCents?: number;
    selectedModifiers?: Modifier[];
    linePriceCents?: number | null;
  } = {}) => {
    const basePrice = parseFloat(String(item.price || 0));
    // Cart lines carry a major-unit price, so minor units are divided back by
    // the currency's scale — 100 would turn a ¥120 modifier into ¥1.20.
    const linePrice = linePriceCents != null ? linePriceCents / scale : basePrice + (extraCents / scale);
    updateTicket(activeTicket!.id, (t) => {
      // Only stack quantity when there are no per-line modifier overrides.
      const canStack = selectedModifiers.length === 0;
      if (canStack) {
        const idx = t.newItems.findIndex((ni) => ni.item_id === item.id && !ni.modifier_ids?.length);
        if (idx >= 0) {
          const next = t.newItems.slice();
          next[idx] = { ...next[idx], qty: next[idx].qty + 1 };
          return { ...t, newItems: next };
        }
      }
      return {
        ...t,
        newItems: [
          ...t.newItems,
          {
            id: uuid(),
            item_id: item.id,
            name: item.name,
            price: linePrice,
            qty: 1,
            variation_option_ids: [],
            modifier_ids: selectedModifiers.map((m) => m.id),
            modifier_names: selectedModifiers.map((m) => m.name),
          },
        ],
      };
    });
  }, [activeTicket, scale]);

  const handleAddItem = useCallback(async (item: MenuItem) => {
    if (!activeTicket) {
      toast({ title: 'Elegí una mesa o iniciá un pedido de mostrador primero' });
      return;
    }
    if (isStaffSession && !registerSession) {
      setIsOpenRegisterOpen(true);
      return;
    }
    // Check if this item has modifier groups — if so, open the picker.
    const has = await checkHasModifiers(item.id);
    if (has) {
      setModifierPickerItem(item);
      return;
    }
    commitAddItem(item);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTicket, registerSession, toast, commitAddItem, checkHasModifiers]);

  // One-tap 86: mark an item sold out (or restore it) straight from the tile —
  // no trip to the back office. Optimistic; reverts on failure.
  const [toggling86, setToggling86] = useState<string | null>(null); // item id mid-flight
  const handleToggle86 = useCallback(async (item: MenuItem) => {
    const next = !item.is_86ed;
    setToggling86(item.id);
    setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, is_86ed: next } : it));
    const { error } = await supabase.from('items').update({ is_86ed: next }).eq('id', item.id);
    setToggling86(null);
    if (error) {
      // revert
      setItems((prev) => prev.map((it) => it.id === item.id ? { ...it, is_86ed: !next } : it));
      toast({ variant: 'destructive', title: 'No se pudo cambiar la disponibilidad', description: error.message });
      return;
    }
    toast({
      title: next ? `${item.name} marcado como agotado` : `${item.name} vuelve a estar disponible`,
      description: next ? 'No se podrá pedir hasta que lo restaures.' : 'Ya está disponible para pedir nuevamente.',
    });
  }, [toast]);

  const handleBumpQty = (clientId: string, delta: number) => {
    if (!activeTicket) return;
    updateTicket(activeTicket.id, (t) => ({
      ...t,
      newItems: t.newItems
        .map((ni) => ni.id === clientId ? { ...ni, qty: Math.max(0, ni.qty + delta) } : ni)
        .filter((ni) => ni.qty > 0),
    }));
  };

  const handleRemoveItem = (clientId: string) => {
    if (!activeTicket) return;
    updateTicket(activeTicket.id, (t) => ({
      ...t,
      newItems: t.newItems.filter((ni) => ni.id !== clientId),
    }));
  };

  const handleSend = useCallback(async () => {
    if (!activeTicket || activeTicket.newItems.length === 0) return;
    if (deliveryError) { toast({ variant: 'destructive', title: 'Revisá la entrega', description: deliveryError }); setShowOrderDetails(true); return; }
    if (isStaffSession && !registerSession) { setIsOpenRegisterOpen(true); return; }
    setSending(true);
    try {
      const result = await submitPosOrder({
        locationId: activeLocation!.id,
        orderType: activeTicket.kind === 'table' ? 'dine_in' : activeTicket.fulfillment || 'takeaway',
        deliveryAddress: activeTicket.deliveryAddress,
        deliveryZoneID: activeTicket.deliveryZoneID,
        expectedDeliveryFeeCents: deliveryQuote.fee,
        tableNumber: activeTicket.kind === 'table' ? String(activeTicket.table_number || activeTicket.label || '') : undefined,
        tableSessionId: activeTicket.kind === 'table' ? activeTicket.sessionId : undefined,
        registerSessionId: registerSession?.id,
				customerId: activeTicket.customerId,
				customerName: activeTicket.customerName,
				customerPhone: activeTicket.customerPhone,
				notes: activeTicket.notes,
        items: activeTicket.newItems.map((ni) => {
          const lineItem: {
            item_id: string;
            quantity: number;
            notes?: string;
            course_id?: string;
            modifiers?: { modifier_id: string }[];
          } = {
            item_id: ni.item_id,
            quantity: ni.qty,
            notes: ni.notes || undefined,
          };
          if (ni.course_id) lineItem.course_id = ni.course_id;
          if (ni.modifier_ids && ni.modifier_ids.length > 0) {
            lineItem.modifiers = ni.modifier_ids.map((id) => ({ modifier_id: id }));
          }
          return lineItem;
        }),
      });
      // Build a "sent order" record from the cart we just sent.
      const sentItems = activeTicket.newItems.map((ni, index) => ({
        order_item_id: result.items?.[index]?.id || `cli-${ni.id}`,
        item_name: ni.name,
        quantity: ni.qty,
        unit_price: ni.price,
        total_cents: Math.round(ni.price * ni.qty * scale),
        item_status: 'fired',
        notes: ni.notes,
        modifier_names: ni.modifier_names,
      }));
      const sentOrder = {
        id: result.order_id,
        order_number: result.order_number,
        created_at: new Date().toISOString(),
        payment_status: 'pending',
        paid_cents: 0,
        kitchen_status: result.kds_ticket_ids.length > 0 ? 'fired' : 'pending',
        total_cents: typeof result.total_minor === 'number' ? result.total_minor : typeof result.total === 'number'
          ? Math.round(result.total * scale)
          : sentItems.reduce((s, it) => s + it.total_cents, 0),
        items: sentItems,
      };
      updateTicket(activeTicket.id, (t) => ({
        ...t,
        newItems: [],
        sentOrders: [...t.sentOrders, sentOrder],
      }));
      toast({
        title: `Pedido n.º ${sentOrder.order_number} enviado a cocina ✓`,
        description: `${sentItems.length} ${sentItems.length === 1 ? 'producto enviado' : 'productos enviados'}`,
      });
    } catch (err) {
      console.error('Send failed:', err);
      toast({ variant: 'destructive', title: 'No se pudo enviar', description: err instanceof Error ? err.message : 'Error desconocido' });
    } finally {
      setSending(false);
    }
  }, [activeTicket, registerSession, activeLocation?.id, toast, scale, deliveryError, deliveryQuote.fee]);

  const handleOpenCharge = () => {
    if (!activeTicket || activeTicket.sentOrders.length === 0) return;
    setTenderError('');
    setShowTenderModal(true);
  };

  const handlePickMethod = (code: 'cash' | 'card_in_person') => {
    setShowMethodPicker(false);
    setChargeMethod(code);
  };

  // Run charge for ALL unpaid orders using split-tender legs from TenderModal.
  const runCharge = async (legs: TenderLeg[]) => {
    if (!activeTicket) return;
    setChargeBusy(true);
    setTenderError('');
    try {
      const unpaid = activeTicket.sentOrders.filter((o) => o.payment_status !== 'paid');
      // Capture the first order id now, before state is cleared, so we can
      // pass it to the receipt modal after the tender modal closes.
      const firstOrderId = unpaid[0]?.id || activeTicket.sentOrders[0]?.id || null;
      const results = await chargeOrdersWithLegs({
        orders: unpaid,
        legs,
        processedByStaffId: staff?.id || actor?.staff_id || undefined,
      });
      const resultByOrder = new Map(results.map((result) => [result.order_id, result]));
      updateTicket(activeTicket.id, (t) => ({
        ...t,
        sentOrders: t.sentOrders.map((o) => {
          const result = resultByOrder.get(o.id);
          return result ? { ...o, payment_status: result.payment_status, paid_cents: result.paid_cents } : o;
        }),
      }));
      const sessionClosed = results.some((result) => result.session_closed);
      const sessionCloseFailed = results.some((result) => result.session_close_error);
      const allPaid = unpaid.every((order) => resultByOrder.get(order.id)?.payment_status === 'paid');
      toast({
        title: allPaid ? 'Pago recibido ✓' : 'Pago parcial registrado',
        description: sessionCloseFailed
          ? 'El pago se registró, pero no se pudo liberar la mesa. Actualizá el plano para reintentar.'
          : sessionClosed
            ? 'Mesa cerrada.'
            : allPaid
              ? 'Pedido marcado como pagado.'
              : 'Todavía queda saldo pendiente.',
        variant: sessionCloseFailed ? 'destructive' : 'default',
      });
      // Close tender modal first, then open receipt after a brief delay so the
      // two dialogs don't stack on top of each other.
      setShowTenderModal(false);
      if (firstOrderId) {
        setTimeout(() => {
          setReceiptOrderId(firstOrderId);
          setReceiptOpen(true);
        }, 150);
      }
      // If table-bound ticket and session closed, drop the ticket and refresh tables.
      if (sessionClosed && activeTicket.kind === 'table') {
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];
          return next;
        });
        setActiveTicketId(null);
        void refreshTables();
      } else if (activeTicket.kind === 'walkin' && allPaid) {
        // walk-in is done — drop it
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];
          return next;
        });
        setActiveTicketId(null);
      }
      setChargeMethod(null);
    } catch (err) {
      console.error('Charge failed:', err);
      setTenderError(err instanceof Error ? err.message : 'No se pudo cobrar');
    } finally {
      setChargeBusy(false);
    }
  };

  // Charge one seat without marking the complete check as paid.
  const handleChargeSplit = useCallback(async (_splitId: string, legs: TenderLeg[]) => {
    if (!activeTicket) return;
    const unpaid = activeTicket.sentOrders.filter((o) => o.payment_status !== 'paid');
    const results = await chargeOrdersWithLegs({
      orders: unpaid,
      legs,
      processedByStaffId: staff?.id || actor?.staff_id || undefined,
    });
    const resultByOrder = new Map(results.map((result) => [result.order_id, result]));
    updateTicket(activeTicket.id, (ticket) => ({
      ...ticket,
      sentOrders: ticket.sentOrders.map((order) => {
        const result = resultByOrder.get(order.id);
        return result ? { ...order, payment_status: result.payment_status, paid_cents: result.paid_cents } : order;
      }),
    }));
    if (results.some((result) => result.session_closed)) {
      setShowSplitBySeat(false);
      setTickets((previous) => {
        const next = { ...previous };
        delete next[activeTicket.id];
        return next;
      });
      setActiveTicketId(null);
      void refreshTables();
    }
  }, [activeTicket, actor?.staff_id, refreshTables, staff?.id, updateTicket]);

  // ----- assign / change table for the active ticket ---------------------
  // Walk-in → table: open a new table_session, move items into a new ticket
  // keyed by session id, drop the old walk-in ticket.
  // Table → table: call transferSession() which moves party + linked orders
  // server-side; rebuild the ticket under the new session id.
  const handleAssignTable = useCallback(async (table: TableTileData) => {
    if (!activeTicket || !table || assigningTable) return;
    setAssigningTable(true);
    try {
      if (activeTicket.kind === 'walkin') {
        const session = await openTableSession({
          tableId: table.id,
          locationId: activeLocation!.id,
          partySize: 1,
          openedBy: staff?.id || undefined,
        });
        const section = sections.find((s) => s.id === table.section_id);
        const newTicket = ticketFromSession({
          session,
          table,
          section,
          orders: activeTicket.sentOrders, // preserve any already-sent rounds (rare for walk-ins, but safe)
        });
        newTicket.newItems = activeTicket.newItems; // carry over unsent items
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];          // drop the walk-in record
          next[newTicket.id] = newTicket;
          return next;
        });
        setActiveTicketId(newTicket.id);
        setTables((prev) => prev.map((t) => t.id === table.id ? { ...t, status: 'occupied' as const } : t));
        toast({ title: `Asignado a la mesa ${table.label}` });
      } else if (activeTicket.kind === 'table') {
        if (table.id === activeTicket.tableId) {
          toast({ title: 'El pedido ya está asignado a esta mesa' });
          return;
        }
        const newSession = await transferSession(activeTicket.sessionId!, {
          toTableId: table.id,
          openedBy: staff?.id || undefined,
          partySize: activeTicket.party_size,
        });
        const section = sections.find((s) => s.id === table.section_id);
        const newTicket = ticketFromSession({
          session: newSession,
          table,
          section,
          orders: activeTicket.sentOrders,
        });
        newTicket.newItems = activeTicket.newItems;
        setTickets((prev) => {
          const next = { ...prev };
          delete next[activeTicket.id];
          next[newTicket.id] = newTicket;
          return next;
        });
        setActiveTicketId(newTicket.id);
        // refresh tables: old one frees up, new one occupies
        void refreshTables();
        toast({ title: `Movido a la mesa ${table.label}` });
      }
      setShowTablePicker(false);
    } catch (err) {
      console.error('Assign table failed:', err);
      toast({
        variant: 'destructive',
        title: 'No se pudo asignar la mesa',
        description: err instanceof Error ? err.message : 'Intentá nuevamente.',
      });
    } finally {
      setAssigningTable(false);
    }
  }, [activeTicket, assigningTable, activeLocation?.id, sections, staff?.id, user?.id, refreshTables, toast]);

  // ----- end shift (actor overlay) ----------------------------------------
  // Used by the "End shift / Switch user" button in the header.
  const handleEndShift = () => {
    clearStoredRegister();
    clearActor();
    // Navigate back to the slug-scoped PIN page that started this session.
    const slug = actor?.slug;
    if (slug) {
      void navigate(`/s/${slug}`, { replace: true });
    } else {
      void navigate('/pos/login', { replace: true });
    }
  };

  // ----- sign out --------------------------------------------------------
  const handleSignOut = async () => {
    clearStoredRegister();
    if (actor) {
      // Actor overlay session — clear actor and go back to PIN screen.
      handleEndShift();
      return;
    }
    if (staff) {
      localStorage.removeItem('bb.auth');
      void navigate('/pos/login', { replace: true });
    } else {
      try { await signOut(); } catch (e) { console.error(e); }
      void navigate('/signin', { replace: true });
    }
  };

  // ===== render ==========================================================

  if (!isAuthed) {
    return (
      <div className={cn('flex items-center justify-center bg-background', embedded ? 'h-full' : 'h-[100dvh]')}>
        <Loader2 className="w-6 h-6 animate-spin text-primary" />
      </div>
    );
  }

  const activeUnpaidCents = activeTicket
    ? activeTicket.sentOrders
        .filter((o) => o.payment_status !== 'paid')
        .reduce((s, o) => s + Math.max(0, (o.total_cents || 0) - (o.paid_cents || 0)), 0)
    : 0;
  const newItemCount = activeTicket?.newItems.reduce((sum, item) => sum + item.qty, 0) || 0;
  const newTotalCents = draftProductsCents + (newItemCount ? deliveryQuote.fee : 0);

  return (
    <div className={cn('pos-workspace flex flex-col overflow-hidden bg-gradient-to-br from-background to-primary/5 dark:to-primary/10', embedded ? 'h-full' : 'h-[100dvh]')}>
      {/* ============================== TOP BAR ============================== */}
      <header className="bg-card border-b border-border shadow-sm shrink-0">
        <div className="flex items-center justify-between gap-2 px-3 py-2 sm:px-4">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <div className="hidden h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-primary/80 shadow-md min-[420px]:flex">
              <Receipt className="w-5 h-5 text-primary-foreground" />
            </div>
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-sm font-bold text-foreground truncate">Punto de venta</span>
              <span className="hidden text-[11px] text-muted-foreground truncate sm:flex items-center gap-1">
                <UserIcon className="w-3 h-3" />
                {displayName}
                {/* Actor overlay chip — shown when staff logged in via /s/:slug PIN.
                    Primary-tinted (identity/role info), not success-green — success
                    is reserved for paid/ready states, not "who is signed in". */}
                {actor && (
                  <span className="ml-0.5 inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-primary/10 border border-primary/25 text-primary text-[9px] font-semibold uppercase tracking-wide">
                    <UserCheck className="w-2.5 h-2.5" />
                    {actor.role || 'Personal'}
                  </span>
                )}
                {!actor && !staff && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded bg-primary/10 text-primary text-[9px] font-semibold uppercase tracking-wide">
                    {isOwnerManager ? 'Administración' : 'Personal'}
                  </span>
                )}
                {activeLocation?.name && (
                  <>
                    <span className="text-border">·</span>
                    <span className="truncate">{activeLocation.name}</span>
                  </>
                )}
              </span>
            </div>
          </div>

          {/* Register pill — only relevant for staff PIN sessions.
              "Open Register" was styled with destructive/red-alert colours,
              which overstates the situation: an unopened drawer is a routine,
              reversible prerequisite (tap it, open it, carry on) — not an
              error. That's exactly the "needs a second look but not
              irreversible" case the warning token exists for, so it now reads
              amber instead of alarm-red. "Register Open" is a completed,
              good-to-go state, which success correctly represents. */}
          {isStaffSession && (
            <div className="hidden sm:flex items-center gap-2">
              {registerLoading ? (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Loader2 className="w-3 h-3 animate-spin" /> Verificando caja…
                </span>
              ) : registerSession ? (
                <button type="button" onClick={() => setIsOpenRegisterOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-success/10 border border-success/30 text-success hover:bg-success/15 text-xs font-semibold transition">
                  <Unlock className="w-3 h-3" /> Caja abierta
                </button>
              ) : (
                <button type="button" onClick={() => setIsOpenRegisterOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-warning/10 border border-warning/30 text-warning hover:bg-warning/15 text-xs font-semibold transition animate-pulse">
                  <Lock className="w-3 h-3" /> Abrir caja
                </button>
              )}
            </div>
          )}

          <div className="flex shrink-0 items-center gap-2">
            <Button size="sm" variant="outline" className="h-11 gap-2 px-3" onClick={() => navigate('/work?tab=pos&view=orders')}>
              <ListOrdered className="h-4 w-4" aria-hidden="true" />Estados
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-11 gap-2 px-3" aria-label="Opciones del punto de venta">
                  <MoreHorizontal className="h-5 w-5" aria-hidden="true" /><span className="hidden sm:inline">Opciones</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64 [&_[role=menuitem]]:min-h-11">
                <DropdownMenuLabel>Esta cuenta</DropdownMenuLabel>
                {activeTicket && isDineInMode && <DropdownMenuItem onSelect={handleStartEatIn}><MapPin />{activeTicket.kind === 'walkin' ? 'Asignar mesa' : 'Cambiar mesa'}</DropdownMenuItem>}
                {activeTicket?.kind === 'table' && activeTicket.sentOrders.length > 0 && <DropdownMenuItem onSelect={() => setShowSplitBySeat(true)}><Scissors />Dividir la cuenta</DropdownMenuItem>}
                <DropdownMenuItem disabled={isStaffSession && !registerSession} onSelect={() => setIsReturnOpen(true)}><RotateCcw />Procesar devolución</DropdownMenuItem>
                {isStaffSession && <DropdownMenuItem onSelect={() => setIsOpenRegisterOpen(true)}><Banknote />{registerSession ? 'Ver caja abierta' : 'Abrir caja'}</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuLabel>Ir a otro módulo</DropdownMenuLabel>
                <DropdownMenuItem onSelect={() => navigate('/home')}><Home />Inicio y pedidos</DropdownMenuItem>
                {canOpenModule('can_kds') && <DropdownMenuItem onSelect={() => navigate('/work?tab=kitchen&view=expo')}><ChefHat />Cocina</DropdownMenuItem>}
                {canOpenModule('can_view_reports') && <DropdownMenuItem onSelect={() => navigate('/reports')}><BarChart3 />Reportes</DropdownMenuItem>}
                {isOwnerManager && <DropdownMenuItem onSelect={() => navigate('/settings')}><Settings2 />Configuración</DropdownMenuItem>}
                <DropdownMenuSeparator />
                {actor && <DropdownMenuItem onSelect={handleEndShift}><UserCheck />Finalizar turno</DropdownMenuItem>}
                <DropdownMenuItem onSelect={handleSignOut}><LogOut />Cerrar sesión</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Tables strip */}
        <div className={cn('px-3 py-2 border-t border-border bg-muted/30', mobileView === 'ticket' && 'hidden md:block')}>
          <TablesStrip
            tables={tableTiles}
            walkIns={walkInTiles}
            activeTicketId={activeTicket?.kind === 'table' ? activeTicket.tableId : activeTicketId}
            onSelect={handleSelectTile}
            onAddWalkIn={handleAddWalkIn}
            loading={tablesLoading}
            canDesignFloor={isOwnerManager}
            onDesignFloor={handleDesignFloor}
            isDineInMode={isDineInMode}
          />
        </div>
      </header>

      {/* Offline / sync strip — this is a chrome-less kiosk screen (no global
          app nav), exactly the surface OfflineBanner was built for. Renders
          nothing when fully synced; a cashier whose connection blips mid-send
          needs this to be impossible to miss, not a subtle top-bar pill. */}
      <OfflineBanner />

      {/* ============================== MAIN ============================== */}
      <div className="grid shrink-0 grid-cols-2 gap-1 border-b bg-muted/40 p-2 md:hidden" role="group" aria-label="Vista del punto de venta">
        <Button variant={mobileView === 'products' ? 'default' : 'ghost'} className="h-11 rounded-xl" aria-pressed={mobileView === 'products'} onClick={() => setMobileView('products')}><Utensils />Productos</Button>
        <Button variant={mobileView === 'ticket' ? 'default' : 'ghost'} className="h-11 rounded-xl" aria-pressed={mobileView === 'ticket'} onClick={() => setMobileView('ticket')}><Receipt />Pedido {newItemCount > 0 && <span className="rounded-full bg-background/20 px-2 tabular-nums">{newItemCount}</span>}</Button>
      </div>
      <main className="pos-workspace-main flex min-h-0 flex-1 overflow-hidden">
        {/* Menu */}
        <section aria-label="Productos del menú" className={cn('pos-products min-h-0 min-w-0 flex-1 flex-col bg-card md:flex', mobileView === 'products' ? 'flex' : 'hidden')}>
          <div className="px-3 py-2 border-b border-border sm:px-4">
            <div className="relative">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Buscar en el menú…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Buscar productos del menú"
                className="pl-10 pr-12 h-12 rounded-xl text-base"
              />
              {search && <Button variant="ghost" size="icon" className="absolute right-1 top-1 h-10 w-10" aria-label="Limpiar búsqueda" onClick={() => setSearch('')}><X /></Button>}
            </div>
          </div>

          {/* Category filter — horizontally scrollable pill row. font-display
              (condensed-black) so a rushed glance across the row lands on the
              active category without needing to read at normal weight. */}
          <div
            role="group"
            aria-label="Filtrar por categoría"
            className="px-3 py-2 border-b border-border overflow-x-auto scrollbar-none"
            style={{ scrollbarWidth: 'none' }}
          >
            <div className="flex gap-1.5 min-w-max">
              <button
                type="button"
                onClick={() => setCategoryId('all')}
                aria-pressed={categoryId === 'all'}
                className={cn(
                  'inline-flex items-center gap-1 h-11 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                  categoryId === 'all'
                    ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                    : 'border-border text-foreground bg-card hover:bg-accent hover:border-primary/40',
                )}
              >
                <Filter className="w-3 h-3" /> Todos
              </button>
              {categories.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setCategoryId(c.id)}
                  aria-pressed={categoryId === c.id}
                  className={cn(
                    'h-11 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                    categoryId === c.id
                      ? 'bg-primary border-primary text-primary-foreground shadow-sm'
                      : 'border-border text-foreground bg-card hover:bg-accent hover:border-primary/40',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-3 sm:p-4">
            {!activeTicket && (
              <div className="mb-4 rounded-2xl border border-border bg-gradient-to-br from-primary/5 to-accent/50 dark:from-primary/10 dark:to-accent/15 p-4 shadow-sm">
                <p className="font-display text-xs uppercase tracking-widest text-primary mb-3 text-center">
                  ¿Cómo hará el pedido el cliente?
                </p>
                <div className="grid grid-cols-2 gap-3">
                    {/* Eat-in and Takeaway are two equal, non-hierarchical
                        starting points — neither is a "success" or "warning"
                        state, so they're differentiated with primary vs
                        secondary tints rather than reusing status colours. */}
                    <button
                      type="button"
                      onClick={handleStartEatIn}
                      aria-label="Iniciar pedido para consumir en el local: seleccionar una mesa"
                      className="flex flex-col items-center justify-center gap-2 px-2 py-4 rounded-2xl border-2 border-primary/30 bg-card hover:bg-primary/10 hover:border-primary/50 active:bg-primary/15 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                    >
                      <Utensils className="w-7 h-7 text-primary" />
                      <span className="text-base font-bold text-foreground">Comer en el local</span>
                      <span className="text-[11px] text-muted-foreground">
                        {hasFloorPlan ? 'Seleccionar una mesa' : 'Primero configurá las mesas'}
                      </span>
                    </button>
                    {/* Takeaway */}
                    <button
                      type="button"
                      onClick={handleAddWalkIn}
                      aria-label="Iniciar pedido para llevar o de mostrador"
                      className="flex flex-col items-center justify-center gap-2 px-2 py-4 rounded-2xl border-2 border-border bg-card hover:bg-accent hover:border-secondary/40 active:bg-accent/70 transition-all shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <ShoppingBag className="w-7 h-7 text-secondary dark:text-foreground/80" />
                      <span className="text-base font-bold text-foreground">Para llevar</span>
                      <span className="text-[11px] text-muted-foreground">Mostrador</span>
                    </button>
                    {deliveryStore.offers_delivery && <button type="button" onClick={handleAddDelivery} aria-label="Iniciar pedido de delivery" className="col-span-2 flex min-h-14 items-center justify-center gap-3 rounded-2xl border-2 bg-card px-3 py-3 font-bold hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring"><Truck className="h-6 w-6 text-primary" />Delivery <span className="text-xs font-normal text-muted-foreground">Dirección y tarifa por zona</span></button>}
                </div>
              </div>
            )}
            {loadingMenu ? (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
                {Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="h-40 rounded-2xl bg-muted animate-pulse" />
                ))}
              </div>
            ) : filteredItems.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-3">
                  <Search className="w-7 h-7 text-muted-foreground/50" />
                </div>
                <p className="text-sm font-semibold text-muted-foreground">No hay productos que coincidan</p>
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    className="mt-2 text-xs text-primary hover:text-primary/80 underline"
                  >
                    Limpiar búsqueda
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(auto-fill,minmax(10rem,1fr))]">
                {filteredItems.map((it) => {
                  const remaining = computeRemainingToday(it, todayStr);
                  const soldOutToday = remaining !== null && remaining === 0;
                  const is86 = !!it.is_86ed;
                  const soldOut = soldOutToday || is86;
                  const isDisabled = !activeTicket || !canTakeOrders || soldOut;
                  const busy86 = toggling86 === it.id;
                  const selectedQty = activeTicket?.newItems.filter(line => line.item_id === it.id).reduce((sum, line) => sum + line.qty, 0) || 0;
                  return (
                    <div key={it.id} className="group relative">
                      <button
                        type="button"
                        onClick={() => handleAddItem(it)}
                        disabled={isDisabled}
                        aria-label={`Agregar ${it.name} — ${format(Math.round(parseFloat(String(it.price || 0)) * scale))}${is86 || soldOutToday ? ' (agotado)' : ''}`}
                        className={cn(
                          'flex h-full w-full flex-col rounded-2xl bg-card border overflow-hidden text-left',
                          'transition-all duration-150',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
                          isDisabled
                            ? 'border-border/50 opacity-50 cursor-not-allowed shadow-none'
                            : 'border-border shadow-sm hover:shadow-lg hover:border-primary/50 hover:-translate-y-0.5 active:scale-95 active:shadow-sm',
                        )}
                      >
                        <div className="h-20 flex items-center justify-center bg-gradient-to-br from-primary/5 via-accent/40 to-primary/10 dark:from-primary/10 dark:via-accent/10 dark:to-primary/15 relative">
                          {it.image_url ? <img src={it.image_url} alt="" loading="lazy" className="h-full w-full object-cover" /> : <span className="text-3xl sm:text-4xl select-none" aria-hidden="true">{emojiFor(it)}</span>}
                          {!isDisabled && <span className="absolute bottom-2 left-2 flex h-8 min-w-8 items-center justify-center rounded-full bg-primary px-2 text-xs font-bold text-primary-foreground shadow-sm" aria-label={selectedQty ? `${selectedQty} en el pedido` : undefined}>{selectedQty ? `${selectedQty}×` : <Plus className="h-4 w-4" aria-hidden="true" />}</span>}
                          {is86 ? (
                            <span className="absolute top-1.5 left-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-destructive text-destructive-foreground leading-none tracking-wide">
                              Agotado
                            </span>
                          ) : (
                            <ItemCountdownPill remaining={remaining} />
                          )}
                        </div>
                        <div className="flex-1 flex flex-col justify-between px-3 py-2.5">
                          <h3 className="text-sm font-semibold text-foreground line-clamp-2 leading-tight">{it.name}</h3>
                          <div className="mt-2">
                            <span className="text-sm font-bold text-foreground tabular-nums sm:text-base">
                              {format(Math.round(parseFloat(String(it.price || 0)) * scale))}
                            </span>
                          </div>
                        </div>
                      </button>
                      {/* One-tap 86 toggle — sibling overlay (avoids nested buttons).
                          Hidden until hover/focus on pointer devices; the "86'd"
                          badge already communicates state when active. Restoring an
                          item to the menu is a "ready/good to sell" state (success);
                          86-ing it live is destructive-adjacent (removes a whole
                          menu item from ordering) so it borrows the destructive
                          hover treatment already used elsewhere in this file. */}
                      <button
                        type="button"
                        onClick={() => handleToggle86(it)}
                        disabled={busy86}
                        title={is86 ? 'Restaurar en el menú' : 'Marcar como agotado'}
                        aria-label={is86 ? `Restaurar ${it.name} en el menú` : `Marcar ${it.name} como agotado`}
                        className={cn(
                          'absolute top-1.5 right-1.5 z-10 inline-flex items-center justify-center rounded-xl w-11 h-11 text-[10px] font-bold shadow-sm transition-all',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-1',
                          is86
                            ? 'bg-success text-success-foreground hover:bg-success/90 focus-visible:ring-success'
                            : 'bg-card/90 text-muted-foreground border border-border opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(pointer:coarse)]:opacity-100 hover:bg-destructive hover:text-destructive-foreground hover:border-destructive focus-visible:ring-destructive',
                          busy86 && 'opacity-60 cursor-wait',
                        )}
                      >
                        {is86 ? <RotateCcw className="w-4 h-4" /> : <Ban className="w-4 h-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Active ticket */}
        <ActiveTicketPanel
          delivery={isDeliveryTicket ? { fee: deliveryQuote.fee, zoneName: deliveryQuote.zone?.name, error: deliveryError, address: activeTicket.deliveryAddress } : undefined}
          className={cn('md:flex', mobileView === 'ticket' ? 'flex' : 'hidden')}
          ticket={activeTicket}
          newItems={activeTicket?.newItems || []}
          sentOrders={activeTicket?.sentOrders || []}
          onBumpQty={handleBumpQty}
          onRemoveItem={handleRemoveItem}
          onEditItemNotes={setEditingNoteItemId}
          onSend={handleSend}
          onCharge={handleOpenCharge}
			onEditDetails={() => { if (isDeliveryTicket) void refreshDeliveryZones(); setShowOrderDetails(true); }}
          onAdjustSuccess={() => {
            // Inline adjustment succeeded — refresh sent orders for the active ticket.
            toast({ title: 'Ajuste aplicado' });
          }}
          locationId={activeLocation?.id || ''}
          sending={sending}
          courses={courses}
          onSetCourse={handleSetCourse}
        />
      </main>
      {mobileView === 'products' && activeTicket && <div className="shrink-0 border-t bg-card p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:hidden">
        <Button className="h-14 w-full justify-between rounded-xl px-4 text-sm sm:text-base" aria-label={newItemCount ? `Revisar pedido · ${newItemCount}` : 'Ver cuenta y cobrar'} onClick={() => setMobileView('ticket')}>
          <span className="flex min-w-0 items-center gap-2"><Receipt /><span className="truncate">{newItemCount ? 'Ver pedido' : 'Ver cuenta'}</span>{newItemCount > 0 && <span className="rounded-full bg-white/20 px-1.5 text-xs">{newItemCount}</span>}</span>
          <span className="flex shrink-0 items-center gap-2 tabular-nums">{format(newTotalCents || activeUnpaidCents)}<ArrowRight /></span>
        </Button>
      </div>}

      {/* ============================== MODALS ============================== */}
      <OpenRegisterModal
        open={isOpenRegisterOpen}
        onOpenChange={setIsOpenRegisterOpen}
        locationId={activeLocation?.id || ''}
        onOpened={({ session }: { session: CashDrawerSession }) => {
          setRegisterSession(session);
          setIsOpenRegisterOpen(false);
          toast({ title: 'Caja abierta', description: 'Ya podés tomar pedidos.' });
        }}
      />
      <ReturnModal
        open={isReturnOpen}
        onOpenChange={setIsReturnOpen}
        locationId={activeLocation?.id || ''}
        onSuccess={() => toast({ title: 'Devolución procesada' })}
      />
		<OrderDetailsDialog
			open={showOrderDetails}
			onOpenChange={setShowOrderDetails}
			orderLabel={activeTicket?.label || (activeTicket?.kind === 'table' ? `Mesa ${activeTicket.table_number || ''}` : 'Pedido de mostrador')}
			orderType={activeTicket?.kind === 'table' ? 'dine_in' : activeTicket?.fulfillment || 'takeaway'}
			deliveryStore={deliveryStore}
			subtotal={draftProductsCents}
			deliveryLocked={Boolean(activeTicket?.sentOrders.length)}
			value={orderDetailsValue}
			onSave={handleSaveOrderDetails}
		/>
		<ItemNoteDialog
			open={Boolean(editingNoteItem)}
			onOpenChange={(open) => { if (!open) setEditingNoteItemId(null); }}
			itemName={editingNoteItem?.name || 'Producto'}
			value={editingNoteItem?.notes}
			onSave={handleSaveItemNotes}
		/>

      {/* Charge — method picker. Cash/Card are two equal payment rails, not a
          good/bad pair — success is reserved for a completed "paid" state
          reached after this choice, and there's no "info-blue" token in the
          palette, so they're told apart with primary vs a neutral card/accent
          tint rather than inventing an off-system colour. */}
      <Dialog open={showMethodPicker} onOpenChange={setShowMethodPicker}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>¿Cómo pagará el cliente?</DialogTitle>
            <DialogDescription>
              Total a cobrar: <span className="font-bold tabular-nums text-foreground">{format(activeUnpaidCents)}</span>
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <button
              type="button"
              onClick={() => handlePickMethod('cash')}
              aria-label="Pagar en efectivo: teclado numérico y cálculo de cambio"
              className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl border-2 border-primary/30 bg-primary/10 hover:bg-primary/15 hover:border-primary/50 active:bg-primary/20 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Banknote className="w-9 h-9 text-primary" />
              <span className="text-base font-bold text-foreground">Efectivo</span>
              <span className="text-[11px] text-muted-foreground">Teclado y cálculo de cambio</span>
            </button>
            <button
              type="button"
              onClick={() => handlePickMethod('card_in_person')}
              aria-label="Pagar con tarjeta en una terminal externa"
              className="flex flex-col items-center justify-center gap-2 py-7 rounded-2xl border-2 border-border bg-accent/40 hover:bg-accent/70 hover:border-secondary/40 active:bg-accent transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <CreditCard className="w-9 h-9 text-accent-foreground" />
              <span className="text-base font-bold text-foreground">Tarjeta</span>
              <span className="text-[11px] text-muted-foreground">Terminal externa</span>
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Charge — cash modal (legacy path, accessible via method picker) */}
      <CashTenderModal
        open={chargeMethod === 'cash'}
        onOpenChange={(o) => { if (!o) setChargeMethod(null); }}
        amountDueCents={activeUnpaidCents}
        submitting={chargeBusy}
        errorMessage={tenderError}
        onConfirm={({ tenderedCents, changeCents }) => {
          void runCharge([{ method: 'cash', amountCents: tenderedCents, changeCents }]);
        }}
      />

      {/* Assign / move table picker — also used by the eat-in order-type selector
          when there is no active ticket yet. In that case we open a new table session
          directly via handleSelectTile instead of reassigning an existing ticket. */}
      <TablePickerDialog
        open={showTablePicker}
        onOpenChange={setShowTablePicker}
        tables={tableTiles}
        sections={sections}
        loading={tablesLoading || assigningTable}
        onSelect={(table) => {
          if (activeTicket) {
            void handleAssignTable(table);
          } else {
            setShowTablePicker(false);
            void handleSelectTile(table.id, 'table');
          }
        }}
      />

      {/* Charge — card modal (legacy path, accessible via method picker) */}
      <CardTenderModal
        open={chargeMethod === 'card_in_person'}
        onOpenChange={(o) => { if (!o) setChargeMethod(null); }}
        amountDueCents={activeUnpaidCents}
        submitting={chargeBusy}
        errorMessage={tenderError}
        onConfirm={({ amountCents, reference }) => {
          void runCharge([{ method: 'card_in_person', amountCents, reference }]);
        }}
      />

      {/* Modifier picker — shown when an item with modifier_groups is tapped */}
      <ModifierPicker
        open={Boolean(modifierPickerItem)}
        onOpenChange={(o) => { if (!o) setModifierPickerItem(null); }}
        item={modifierPickerItem}
        onConfirm={({ selectedModifiers, extraCents, linePriceCents }) => {
          if (modifierPickerItem) {
            commitAddItem(modifierPickerItem, { selectedModifiers, extraCents, linePriceCents });
          }
          setModifierPickerItem(null);
        }}
      />

      {/* Split Tender modal — pay one ticket across multiple methods */}
      <TenderModal
        open={showTenderModal}
        onOpenChange={(o) => { if (!o) setShowTenderModal(false); }}
        totalCents={activeUnpaidCents}
        submitting={chargeBusy}
        errorMessage={tenderError}
        onConfirm={runCharge}
      />

      {/* Split-by-seat — dine-in check splitting per seat */}
      <SplitBySeat
        open={showSplitBySeat}
        onOpenChange={setShowSplitBySeat}
        ticket={activeTicket}
        onChargeSplit={handleChargeSplit}
        staffId={staff?.id || actor?.staff_id || undefined}
      />

      {/* Receipt modal — shown after a successful payment */}
      <ReceiptModal
        orderId={receiptOrderId}
        open={receiptOpen}
        onClose={() => {
          setReceiptOpen(false);
          setReceiptOrderId(null);
        }}
        onNewOrder={() => {
          setReceiptOpen(false);
          setReceiptOrderId(null);
          // Start a fresh walk-in ticket so the cashier can immediately take
          // the next order without any extra tap.
          handleAddWalkIn();
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers used in render that aren't worth hooks
// ---------------------------------------------------------------------------

// `scale` is the active currency's minor units per major unit. Cart lines and
// order items carry major-unit decimals, so converting them with a literal 100
// misprices every currency that is not two-decimal.
function subtotalCentsOfTicket(t: WorkspaceTicket | null | undefined, scale: number): number {
  if (!t) return 0;
  const newC = t.newItems.reduce(
    (sum, ni) => sum + Math.round((parseFloat(String(ni.price)) || 0) * (ni.qty || 0) * scale),
    0,
  );
  const sentC = t.sentOrders.reduce((s, o) => {
    if (typeof o.total_cents === 'number') return s + o.total_cents;
    return s + (o.items || []).reduce((lc, it) => {
      if (typeof it.total_cents === 'number') return lc + it.total_cents;
      return lc + Math.round((parseFloat(String(it.unit_price || 0)) * (it.quantity || 0)) * scale);
    }, 0);
  }, 0);
  return newC + sentC;
}
