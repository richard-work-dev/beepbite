import React, { useState, useEffect } from 'react';
import { api } from '@/lib/api-client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CardResult, type IssueResult } from './card-result';
import { AlertCircle, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useLocale, useMoney, useDateTime } from '@/context/locale-context';
import { supabase } from '@/services/supabase-client';
import CustomerSearch from '@/pages/pos/components/customer-search';

// Sentinel used in the staff <Select> to represent "no selection".
const STAFF_NONE = '__none__';

// Mirrors backend/migrations/001_baseline.sql `staff` table (subset selected below).
interface StaffOption {
  id: string;
  first_name: string | null;
  last_name: string | null;
}

function isStaffOption(value: unknown): value is StaffOption {
  return typeof value === 'object' && value !== null &&
    'id' in value && typeof value.id === 'string' &&
    'first_name' in value && (typeof value.first_name === 'string' || value.first_name === null) &&
    'last_name' in value && (typeof value.last_name === 'string' || value.last_name === null);
}

// Shape returned by pos/components/customer-search.jsx's onSelect (that
// component is still untyped JS, so this is asserted from usage, not
// imported).
interface SelectedCustomer {
  id: string;
  name?: string;
  phone?: string;
}

/**
 * IssueForm — the "Issue" tab content.
 * POSTs to /gift-cards/issue and shows a CardResult on success.
 *
 * Organisation ID is sourced implicitly from the active organisation context.
 * Customer and staff fields use polished pickers instead of raw UUID inputs.
 */
export function IssueForm() {
  const { activeOrganization, activeLocation } = useAuth();
  const { currency } = useLocale();
  const { parse: parseAmount, scale, decimals } = useMoney({ currency });
  const { today } = useDateTime();

  const [balanceInput, setBalanceInput] = useState('');
  const [cardType, setCardType] = useState('digital'); // 'physical' | 'digital'
  const [expiresAt, setExpiresAt] = useState('');      // local date string yyyy-mm-dd
  const [pin, setPin] = useState('');

  // Customer: store the full object returned by CustomerSearch so we can
  // display the name; only the id is sent in the POST body.
  const [selectedCustomer, setSelectedCustomer] = useState<SelectedCustomer | null>(null);

  // Staff: id string ('' = unset), populated from supabase for active location.
  const [issuedByStaffId, setIssuedByStaffId] = useState('');
  const [staffList, setStaffList] = useState<StaffOption[]>([]);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<IssueResult | null>(null);

  // Fetch active staff for the current location so the dropdown is populated.
  useEffect(() => {
    if (!activeLocation) {
      setStaffList([]);
      return;
    }

    supabase
      .from('staff')
      .select('id, first_name, last_name')
      .eq('location_id', activeLocation.id)
      .eq('is_active', true)
      .order('first_name', { ascending: true })
      .then(({ data, error: staffErr }) => {
        if (staffErr) {
          console.error('Failed to fetch staff for gift-card form:', staffErr);
          return;
        }
        setStaffList(Array.isArray(data) ? data.filter(isStaffOption) : []);
      })
      .catch((err: unknown) => {
        // A network-level failure (fetch() itself rejecting) previously
        // left this as an unhandled rejection — the staff dropdown just
        // stays empty either way (no dedicated loading/error state), but
        // this at least logs it instead of failing silently.
        console.error('Failed to fetch staff for gift-card form:', err);
      });
  }, [activeLocation]);

  function resetForm() {
    setBalanceInput('');
    setCardType('digital');
    setExpiresAt('');
    setPin('');
    setSelectedCustomer(null);
    setIssuedByStaffId('');
    setError('');
    setResult(null);
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError('');

    // parseAmount scales by the currency's own exponent, so ¥1000 becomes 1000
    // minor units and KD 1.000 becomes 1000 — not the 100000 and 100 a literal
    // *100 would produce.
    const balanceCents = parseAmount(balanceInput);
    if (balanceCents === null || balanceCents <= 0) {
      setError('Ingresá un saldo inicial válido.');
      return;
    }

    if (pin && (pin.length < 4 || pin.length > 6)) {
      setError('El PIN debe tener entre 4 y 6 dígitos.');
      return;
    }

    // Build expires_at as RFC3339 (end-of-day UTC) or omit if blank.
    let expiresAtRFC3339: string | null = null;
    if (expiresAt) {
      expiresAtRFC3339 = new Date(`${expiresAt}T23:59:59Z`).toISOString();
    }

    // activeOrganization is guaranteed non-null here: the form only renders
    // (and can only be submitted) past the "no active organisation" guard below.
    const body = {
      organization_id: activeOrganization!.id,
      initial_balance_cents: balanceCents,
      card_type: cardType,
      ...(pin ? { pin } : {}),
      ...(selectedCustomer ? { issued_to_customer_id: selectedCustomer.id } : {}),
      ...(issuedByStaffId ? { issued_by_staff_id: issuedByStaffId } : {}),
      ...(expiresAtRFC3339 ? { expires_at: expiresAtRFC3339 } : { expires_at: null }),
    };

    setLoading(true);
    try {
      const { data, error: err } = await api.request<IssueResult>('POST', '/gift-cards/issue', { body });
      if (err) throw new Error(err.message || 'No se pudo emitir la tarjeta.');
      if (!data) throw new Error('No se recibió la tarjeta emitida.');
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo emitir la tarjeta.');
    } finally {
      setLoading(false);
    }
  }

  // After issue, show the result card until user dismisses.
  if (result) {
    return <CardResult result={result} onDismiss={resetForm} />;
  }

  // Guard: no active organisation — the org id is required to issue a card.
  if (!activeOrganization) {
    return (
      <Card>
        <CardContent className="py-10 flex flex-col items-center gap-3 text-center">
          <AlertCircle className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No hay una organización activa. Seleccioná una organización antes de emitir una tarjeta.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Emitir tarjeta de regalo</CardTitle>
        <CardDescription>Los campos con * son obligatorios.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Initial balance */}
          <div className="space-y-1.5">
            <Label htmlFor="balance">Saldo inicial{currency ? ` (${currency})` : ''} *</Label>
            <Input
              id="balance"
              type="number"
              min={(1 / scale).toFixed(decimals)}
              step={(1 / scale).toFixed(decimals)}
              placeholder={(0).toFixed(decimals)}
              value={balanceInput}
              onChange={(e) => setBalanceInput(e.target.value)}
              required
            />
          </div>

          {/* Card type */}
          <div className="space-y-2">
            <Label>Tipo de tarjeta *</Label>
            <RadioGroup
              value={cardType}
              onValueChange={setCardType}
              className="flex gap-6"
            >
              <div className="flex items-center gap-2">
                <RadioGroupItem value="digital" id="type-digital" />
                <Label htmlFor="type-digital" className="cursor-pointer font-normal">
                  Digital
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="physical" id="type-physical" />
                <Label htmlFor="type-physical" className="cursor-pointer font-normal">
                  Física
                </Label>
              </div>
            </RadioGroup>
          </div>

          {/* Expiry */}
          <div className="space-y-1.5">
            <Label htmlFor="expires">Vencimiento (opcional)</Label>
            <Input
              id="expires"
              type="date"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              min={today()}
            />
          </div>

          {/* PIN */}
          <div className="space-y-1.5">
            <Label htmlFor="pin">PIN (opcional, 4–6 dígitos)</Label>
            <Input
              id="pin"
              type="password"
              placeholder="••••"
              maxLength={6}
              pattern="\d{4,6}"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            />
          </div>

          {/* Customer picker */}
          <div className="space-y-1.5">
            <Label>Cliente (opcional)</Label>
            {selectedCustomer ? (
              /* Show the selected customer as a dismissible chip */
              <div className="flex items-center justify-between rounded-md border border-input bg-muted/40 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium truncate">{selectedCustomer.name}</p>
                  {selectedCustomer.phone && (
                    <p className="text-xs text-muted-foreground truncate">
                      {selectedCustomer.phone}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0 ml-2"
                  onClick={() => setSelectedCustomer(null)}
                  aria-label="Quitar cliente seleccionado"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              /* Typeahead search — reuses the POS customer-search widget */
              <CustomerSearch
                onSelect={setSelectedCustomer}
                placeholder="Buscar por nombre o teléfono…"
                className={undefined}
              />
            )}
          </div>

          {/* Staff picker */}
          <div className="space-y-1.5">
            <Label htmlFor="staff-select">Emitida por (opcional)</Label>
            <Select
              value={issuedByStaffId || STAFF_NONE}
              onValueChange={(v) => setIssuedByStaffId(v === STAFF_NONE ? '' : v)}
            >
              <SelectTrigger id="staff-select">
                <SelectValue placeholder="Seleccionar personal…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={STAFF_NONE}>— Sin asignar —</SelectItem>
                {staffList.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.first_name} {s.last_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}

          <Button type="submit" disabled={loading} className="w-full sm:w-auto">
            {loading && <RefreshCw className="h-4 w-4 animate-spin mr-2" />}
            Emitir tarjeta
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
