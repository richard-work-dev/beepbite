// adjustment-menu.jsx
//
// Inline adjustment context menu for sent ticket lines.
//
// Usage — wraps either a SentItemRow (comp/discount) or a SentOrderGroup
// header (void):
//
//   <AdjustmentMenu
//     orderId={order.id}
//     itemId={item.order_item_id}   // null for order-level void
//     currentPriceCents={item.total_cents}
//     locationId={locationId}
//     onSuccess={() => ...}
//   >
//     {/* the row content */}
//   </AdjustmentMenu>
//
// Desktop: right-click opens the menu.
// Touch  : long-press (500 ms) opens the menu.
//
// Capability gating:
//   Void    → can_void    (order-level, itemId must be null)
//   Comp    → can_comp    (item-level, itemId required)
//   Discount → can_comp   (item-level price-override, itemId required)
//
// Manager approval:
//   If the selected reason has requires_manager_approval=true, step 2 shows a
//   manager-select + PIN entry form.  On submit the raw approver_staff_id and
//   approver_pin are sent to the backend which does its own bcrypt check.
//   (The usePinModal session-auth hook is for actor re-auth, not this flow.)

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import type { ReactNode } from 'react';
import { Ban, ChevronRight, Gift, Loader2, MoreVertical, Tag, X } from 'lucide-react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useMoney } from '@/context/locale-context';
import { api } from '@/lib/api-client';
import { hasCapability, getStaff } from '@/services/pos';
import { useAdjustmentReasons, type AdjustmentReason } from '@/components/order-adjustments/use-adjustment-reasons';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LONG_PRESS_MS = 500;

type AdjustmentType = 'void' | 'comp' | 'price_override';

// Which types are supported at each level
const ORDER_TYPES: AdjustmentType[] = ['void'];
const ITEM_TYPES: AdjustmentType[]  = ['comp', 'price_override'];

// Manager records come from the scoped data API. Only active staff with a
// manager-capable role are offered as approvers.
interface ManagerOption {
  id: string;
  name?: string;
  first_name?: string;
  last_name?: string;
  full_name?: string;
  display_name?: string;
  email?: string;
  role?: string;
  is_active?: boolean;
}

const TYPE_META: Record<AdjustmentType, {
  label: string;
  short: string;
  icon: typeof Ban;
  colorClass: string;
  capability: string;
}> = {
  void: {
    label: 'Anular pedido',
    short: 'Anular',
    icon: Ban,
    colorClass: 'text-red-700 bg-red-50 hover:bg-red-100 border-red-200',
    capability: 'can_void',
  },
  comp: {
    label: 'Bonificar producto',
    short: 'Bonificar',
    icon: Gift,
    // These three are one axis — how much money leaves the till — so they run
    // as a severity ramp rather than three unrelated hues: red voids the whole
    // order, orange comps an item away at full value, amber takes some of the
    // price off. Purple said nothing about which of those was happening.
    colorClass: 'text-orange-700 bg-orange-50 hover:bg-orange-100 border-orange-200',
    capability: 'can_comp',
  },
  price_override: {
    label: 'Aplicar descuento',
    short: 'Descuento',
    icon: Tag,
    colorClass: 'text-amber-700 bg-amber-50 hover:bg-amber-100 border-amber-200',
    capability: 'can_comp',
  },
};

// ---------------------------------------------------------------------------
// Build the correct backend endpoint
// ---------------------------------------------------------------------------

function buildEndpoint(type: AdjustmentType, orderId: string, itemId: string | null) {
  switch (type) {
    case 'void':
      return `/orders/${orderId}/void`;
    case 'comp':
      return `/orders/${orderId}/items/${itemId}/comp`;
    case 'price_override':
      return `/orders/${orderId}/items/${itemId}/price-override`;
    default:
      // The switch above is exhaustive over AdjustmentType, so TS narrows
      // `type` to `never` here — String(type) instead of a bare template
      // interpolation so this still reports something useful if an
      // un-narrowed value ever reaches this branch at runtime.
      throw new Error(`Unknown adjustment type: ${String(type)}`);
  }
}

// ---------------------------------------------------------------------------
// Inner flow — shown inside the PopoverContent
// ---------------------------------------------------------------------------

const STEP_PICK   = 'pick';    // choose action + reason
const STEP_MANAGER = 'manager'; // manager credentials (if required)
type Step = typeof STEP_PICK | typeof STEP_MANAGER;

interface AdjustmentFlowProps {
  orderId: string;
  itemId: string | null;
  currentPriceCents: number | null;
  locationId: string;
  onSuccess?: (data: unknown) => void;
  onClose: () => void;
}

function AdjustmentFlow({
  orderId,
  itemId,
  currentPriceCents,
  locationId,
  onSuccess,
  onClose,
}: AdjustmentFlowProps) {
  const { toast } = useToast();
  const { format, parse, symbol, scale, decimals } = useMoney();

  const [step, setStep]           = useState<Step>(STEP_PICK);
  const [adjType, setAdjType]     = useState<AdjustmentType | null>(null);
  const [reasonCode, setReasonCode] = useState('');
  const [reasonObj, setReasonObj]   = useState<AdjustmentReason | null>(null);
  // Held as a major-unit string because that is what the <input type="number">
  // carries; it is converted back through the currency, never through 100.
  const [newPriceMajor, setNewPriceMajor] = useState(
    currentPriceCents != null ? (currentPriceCents / scale).toFixed(decimals) : '',
  );

  // Manager step
  const [managers, setManagers]         = useState<ManagerOption[]>([]);
  const [loadingManagers, setLoadingManagers] = useState(false);
  const [approverStaffId, setApproverStaffId] = useState('');
  const [approverPin, setApproverPin]     = useState('');
  const [pinError, setPinError]           = useState('');

  const [submitting, setSubmitting] = useState(false);

  const currentStaff = getStaff();

  // Fetch reasons
  const { reasons, loading: loadingReasons } = useAdjustmentReasons(locationId);

  // Derive which types are available to this actor at this level
  const availableTypes = (itemId ? ITEM_TYPES : ORDER_TYPES).filter(
    (t) => hasCapability(TYPE_META[t].capability),
  );

  // Fetch managers when we know we'll need them (on step change or when reasons loaded)
  const fetchManagers = useCallback(async () => {
    if (!locationId) return;
    setLoadingManagers(true);
    // api.request() only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) propagates as a
    // rejected promise. Without this try/catch/finally, that left the
    // manager-approval step stuck loading forever with the rejection
    // silently swallowed.
    try {
      const { data, error } = await api
        .from('staff')
        .select('id,first_name,last_name,display_name,email,role,is_active')
        .eq('location_id', locationId);
      if (!error && Array.isArray(data)) {
        setManagers((data as ManagerOption[]).filter((member) =>
          member.is_active !== false && ['owner', 'manager', 'admin'].includes(member.role || ''),
        ));
      }
    } catch (err) {
      console.error('Error fetching managers:', err);
    } finally {
      setLoadingManagers(false);
    }
  }, [locationId]);

  useEffect(() => {
    if (step === STEP_MANAGER && managers.length === 0) {
      void fetchManagers();
    }
  }, [step, managers.length, fetchManagers]);

  // ---- step 1 helpers -------------------------------------------------------

  function handleTypeSelect(type: AdjustmentType) {
    setAdjType(type);
    setReasonCode('');
    setReasonObj(null);
  }

  function handleReasonChange(code: string) {
    const r = reasons.find((x) => (x.code ?? x.id) === code);
    setReasonCode(code);
    setReasonObj(r ?? null);
  }

  function handleNext() {
    if (!adjType || !reasonCode) return;
    if (adjType === 'price_override') {
      const p = parse(newPriceMajor);
      if (p == null || p < 0) return;
    }
    if (reasonObj?.requires_manager_approval) {
      setStep(STEP_MANAGER);
    } else {
      void handleSubmit();
    }
  }

  // ---- submission -----------------------------------------------------------

  async function handleSubmit(managerOverride = false) {
    setSubmitting(true);
    setPinError('');

    const body: {
      reason_code: string;
      applied_by_staff_id: string;
      approver_staff_id: string;
      approver_pin: string;
      new_price_cents?: number;
    } = {
      reason_code: reasonCode,
      applied_by_staff_id: currentStaff?.id || '',
      approver_staff_id: managerOverride ? approverStaffId : (currentStaff?.id || ''),
      approver_pin: managerOverride ? approverPin : '',
    };

    if (adjType === 'price_override') {
      body.new_price_cents = parse(newPriceMajor) ?? 0;
    }

    let endpoint: string;
    try {
      endpoint = buildEndpoint(adjType!, orderId, itemId);
    } catch (err) {
      toast({ variant: 'destructive', title: 'Error', description: err instanceof Error ? err.message : String(err) });
      setSubmitting(false);
      return;
    }

    // api.request() only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) propagates as a
    // rejected promise. Without this try/catch/finally, that skipped
    // setSubmitting(false), permanently disabling this order adjustment
    // (refund/comp/price-override) form's submit button with no error
    // shown, and left the caller unsure whether the adjustment went
    // through.
    try {
      const { data, error } = await api.request('POST', endpoint, { body });

      if (error) {
        if (error.status === 401 && managerOverride) {
          setApproverPin('');
          setPinError(error.message || 'PIN incorrecto. Intentá nuevamente.');
          return;
        }
        if (error.status === 409) {
          toast({
            variant: 'destructive',
            title: 'No se puede realizar el ajuste',
            description: error.message || 'Este pedido ya fue ajustado.',
          });
          onClose();
          return;
        }
        toast({
          variant: 'destructive',
          title: 'No se pudo realizar el ajuste',
          description: error.message || 'Ocurrió un error inesperado.',
        });
        return;
      }

      toast({ title: `${(adjType ? TYPE_META[adjType]?.label : undefined) ?? 'Ajuste'} aplicado` });
      if (onSuccess) onSuccess(data);
      onClose();
    } catch (err) {
      console.error('Adjustment submit failed:', err);
      toast({
        variant: 'destructive',
        title: 'No se pudo realizar el ajuste',
        description: 'No se pudo conectar con el servidor. Intentá nuevamente.',
      });
    } finally {
      setSubmitting(false);
    }
  }

  // ---- derived validity -----------------------------------------------------

  const step1Valid =
    adjType &&
    reasonCode &&
    (adjType !== 'price_override' || (newPriceMajor !== '' && (parse(newPriceMajor) ?? -1) >= 0));

  const step2Valid = approverStaffId && approverPin.length >= 4;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (availableTypes.length === 0) {
    return (
      <p className="text-xs text-gray-500 px-1">No tenés permisos para realizar ajustes.</p>
    );
  }

  return (
    <div className="space-y-3 w-64">
      {/* Header */}
      <div className="flex items-center justify-between">
        <p className="text-xs font-bold uppercase tracking-wide text-gray-500">
          {step === STEP_PICK ? 'Ajustar pedido' : 'Autorización de gerente'}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="p-0.5 rounded text-gray-400 hover:text-gray-600 transition"
          aria-label="Cerrar"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* ---- Step 1: pick action + reason ---- */}
      {step === STEP_PICK && (
        <>
          {/* Action selector */}
          <div className="flex gap-1.5 flex-wrap">
            {availableTypes.map((t) => {
              const meta = TYPE_META[t];
              const Icon = meta.icon;
              const active = adjType === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => handleTypeSelect(t)}
                  className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded border text-[11px] font-semibold transition ${meta.colorClass} ${active ? 'ring-2 ring-offset-1 ring-orange-400' : ''}`}
                >
                  <Icon className="w-3 h-3" />
                  {meta.short}
                </button>
              );
            })}
          </div>

          {adjType && (
            <>
              {/* Reason picker */}
              <div className="space-y-1">
                <Label className="text-[11px] font-semibold text-gray-600">
                  Motivo
                </Label>
                <Select
                  value={reasonCode}
                  onValueChange={handleReasonChange}
                  disabled={loadingReasons}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue
                      placeholder={loadingReasons ? 'Cargando…' : 'Seleccionar motivo'}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {reasons.map((r) => (
                      <SelectItem
                        key={r.code ?? r.id}
                        value={r.code ?? r.id}
                        className="text-xs"
                      >
                        {r.label ?? (r as AdjustmentReason & { name?: string }).name ?? r.code ?? r.id}
                        {r.requires_manager_approval && (
                          <span className="ml-1 text-[10px] text-amber-600 font-medium">
                            (gerente)
                          </span>
                        )}
                      </SelectItem>
                    ))}
                    {!loadingReasons && reasons.length === 0 && (
                      <SelectItem value="other">Otro</SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>

              {/* New price input for discount */}
              {adjType === 'price_override' && (
                <div className="space-y-1">
                  <Label className="text-[11px] font-semibold text-gray-600">
                    Nuevo precio ({symbol})
                    {currentPriceCents != null && (
                      <span className="ml-1 font-normal text-gray-400">
                        — actual: {format(currentPriceCents)}
                      </span>
                    )}
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step={String(1 / scale)}
                    value={newPriceMajor}
                    onChange={(e) => setNewPriceMajor(e.target.value)}
                    className="h-8 text-xs"
                    placeholder="0.00"
                  />
                </div>
              )}

              {reasonObj?.requires_manager_approval && (
                <p className="text-[10px] text-amber-600 font-medium">
                  Este motivo requiere la autorización de un gerente.
                </p>
              )}

              {/* The submit button's colour must match what it actually does:
                  Void is irreversible → destructive red. Comp/discount are
                  reversible business decisions, not disasters → the normal
                  primary colour is enough. Reusing one orange "Apply" button
                  for both is exactly the "same shape as the safe action"
                  problem the rest of the app now avoids. */}
              <Button
                size="sm"
                variant={adjType === 'void' ? 'destructive' : 'default'}
                onClick={handleNext}
                disabled={!step1Valid || submitting}
                className="w-full h-8 text-xs"
              >
                {submitting ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <>
                    {reasonObj?.requires_manager_approval ? (
                      <>Continuar <ChevronRight className="w-3 h-3 ml-0.5" /></>
                    ) : adjType === 'void' ? (
                      'Anular pedido'
                    ) : (
                      'Aplicar'
                    )}
                  </>
                )}
              </Button>
            </>
          )}
        </>
      )}

      {/* ---- Step 2: manager PIN ---- */}
      {step === STEP_MANAGER && (
        <>
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-gray-600">
              Gerente que autoriza
            </Label>
            <Select
              value={approverStaffId}
              onValueChange={setApproverStaffId}
              disabled={loadingManagers}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue
                  placeholder={loadingManagers ? 'Cargando…' : 'Seleccionar gerente'}
                />
              </SelectTrigger>
              <SelectContent>
                {managers.map((m) => (
                  <SelectItem key={m.id} value={m.id} className="text-xs">
                    {m.name ?? m.full_name ?? m.display_name
                      ?? ([m.first_name, m.last_name].filter(Boolean).join(' ') || m.email || m.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-[11px] font-semibold text-gray-600">
              PIN del gerente
            </Label>
            <Input
              type="password"
              inputMode="numeric"
              maxLength={6}
              value={approverPin}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '');
                setApproverPin(v);
                if (pinError) setPinError('');
              }}
              placeholder="4 a 6 dígitos"
              autoComplete="off"
              className="h-8 text-xs"
            />
            {pinError && (
              <p className="text-[11px] text-red-600">{pinError}</p>
            )}
          </div>

          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => { setStep(STEP_PICK); setPinError(''); }}
              disabled={submitting}
              className="flex-1 h-8 text-xs"
            >
              Volver
            </Button>
            <Button
              size="sm"
              variant={adjType === 'void' ? 'destructive' : 'default'}
              onClick={() => handleSubmit(true)}
              disabled={!step2Valid || submitting}
              className="flex-1 h-8 text-xs"
            >
              {submitting ? <Loader2 className="w-3 h-3 animate-spin" /> : adjType === 'void' ? 'Autorizar anulación' : 'Autorizar'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Public component — adds context-menu trigger to children
// ---------------------------------------------------------------------------

/**
 * AdjustmentMenu
 *
 * Wraps any children.  Right-click (desktop) or long-press (touch) opens an
 * inline Popover with the adjustment flow.
 *
 * Props:
 *   orderId           string          — required
 *   itemId            string | null   — null → order-level (Void only)
 *                                       non-null → item-level (Comp / Discount)
 *   currentPriceCents number | null   — optional hint for price_override
 *   locationId        string          — scopes reason list + manager list
 *   onSuccess         (data) => void  — called after successful adjustment
 *   disabled          boolean         — skip context menu entirely
 *   label             string          — accessible name for the visible
 *                                       trigger button, e.g. "order #1042" or
 *                                       "Cheeseburger". Falls back to a
 *                                       generic label if omitted.
 *   children          ReactNode
 *
 * Right-click / long-press remain as power-user shortcuts, but neither is
 * discoverable or keyboard-operable on its own — a manager voiding an order
 * from a keyboard/scanner terminal, or a first-shift cashier who has never
 * been told to long-press a ticket row, would otherwise have no way to reach
 * this at all. The small "more actions" button below is the primary,
 * always-visible, tab-reachable entry point; the gestures are additive.
 */
interface AdjustmentMenuProps {
  orderId: string;
  itemId?: string | null;
  currentPriceCents?: number | null;
  locationId?: string;
  onSuccess?: (data: unknown) => void;
  disabled?: boolean;
  label?: string;
  children: ReactNode;
}

export default function AdjustmentMenu({
  orderId,
  itemId = null,
  currentPriceCents = null,
  locationId = '',
  onSuccess,
  disabled = false,
  label = '',
  children,
}: AdjustmentMenuProps) {
  const [open, setOpen] = useState(false);

  // Long-press support
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMoved     = useRef(false);

  const openMenu  = useCallback(() => { if (!disabled) setOpen(true); }, [disabled]);
  const closeMenu = useCallback(() => setOpen(false), []);

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    openMenu();
  }

  function handleTouchStart() {
    touchMoved.current = false;
    longPressTimer.current = window.setTimeout(() => {
      if (!touchMoved.current) openMenu();
    }, LONG_PRESS_MS);
  }

  function handleTouchMove() {
    touchMoved.current = true;
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  function handleTouchEnd() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
  }

  // No visible capabilities → render children as-is, no context wrapper
  const hasAny = (itemId ? ITEM_TYPES : ORDER_TYPES).some(
    (t) => hasCapability(TYPE_META[t].capability),
  );

  if (!hasAny || disabled) return <>{children}</>;

  const actionWord = itemId ? 'Bonificar o descontar' : 'Anular';
  const triggerLabel = label ? `${actionWord} ${label}` : `${actionWord} — más acciones`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="group/adjust relative">
        <PopoverTrigger asChild>
          <div
            onContextMenu={handleContextMenu}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            className="select-none"
          >
            {children}
          </div>
        </PopoverTrigger>
        {/* Always-visible, keyboard-reachable trigger — the long-press/
            right-click above are shortcuts on top of this, not a
            replacement for it. */}
        <button
          type="button"
          onClick={openMenu}
          aria-label={triggerLabel}
          aria-haspopup="dialog"
          title={triggerLabel}
          className={cn(
            'absolute right-1.5 top-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-md',
            'text-muted-foreground hover:bg-muted hover:text-foreground',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1',
            'opacity-60 group-hover/adjust:opacity-100 focus-visible:opacity-100',
          )}
        >
          <MoreVertical className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <PopoverContent
        className="p-3 w-auto"
        align="start"
        side="right"
        sideOffset={6}
        onInteractOutside={closeMenu}
      >
        <AdjustmentFlow
          orderId={orderId}
          itemId={itemId}
          currentPriceCents={currentPriceCents}
          locationId={locationId}
          onSuccess={onSuccess}
          onClose={closeMenu}
        />
      </PopoverContent>
    </Popover>
  );
}
