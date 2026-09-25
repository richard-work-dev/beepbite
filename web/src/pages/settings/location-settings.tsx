import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageHeader, PageContainer } from "@/components/ui/page-header";
import { Reveal } from "@/components/ui/motion";
import AddressAutocomplete from "@/components/address-autocomplete";
import {
  MapPin,
  Settings as SettingsIcon,
  Save,
  CheckCircle,
  Loader2,
  AlertCircle,
  Truck,
  ArrowLeft,
  Activity,
  UtensilsCrossed,
  ShoppingBag,
  Globe,
} from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { supabase } from '@/services/supabase-client';
import { cn } from "@/lib/utils";
import { currencyDecimals, currencySymbol, formatMoney } from '@/lib/currency';
import {
  countryOptions,
  currencyOptions,
  detectedTimezone,
  timezoneOptions,
} from '@/lib/locale-data';

// ---------------------------------------------------------------------------
// Service-style localStorage helpers (same key as workspace.jsx)
// ---------------------------------------------------------------------------
function getServiceStyleLS(locId?: string): 'dine_in' | 'takeaway' {
  if (!locId) return 'dine_in';
  try {
    const v = localStorage.getItem(`bb_service_style_${locId}`);
    return v === 'takeaway' ? 'takeaway' : 'dine_in';
  } catch {
    return 'dine_in';
  }
}
function setServiceStyleLS(locId: string, value: string) {
  if (!locId) return;
  try { localStorage.setItem(`bb_service_style_${locId}`, value); } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// Regional-settings validation
// ---------------------------------------------------------------------------
// Each of these mirrors a CHECK constraint added by migration 056. Validating
// here is not redundant with the database: a constraint violation surfaces as an
// opaque driver error ("new row violates check constraint
// locations_tax_rate_range"), which tells an operator nothing about which field
// to fix. The database remains the authority; this exists to say what is wrong.

/** BCP-47 well-formedness. Intl canonicalises valid tags and throws on the rest. */
function isValidLocale(tag: string): boolean {
  if (!tag) return true; // empty means "use the reader's own", which is valid
  try {
    return Intl.getCanonicalLocales(tag).length > 0;
  } catch {
    return false;
  }
}

/** Whether the runtime's tzdata recognises this zone name. */
function isValidTimezone(zone: string): boolean {
  if (!zone) return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

// Mirrors backend/migrations/001_baseline.sql `locations` table (subset used
// by this page). supabase.from(...) goes through the untyped api.from(...)
// query builder (the one documented `any` in the codebase), so this
// interface is applied locally to keep this page's own state honestly typed.
interface LocationDetail {
  id: string;
  organization_id: string;
  name: string;
  description?: string | null;
  whatsapp_number?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  country?: string | null;
  currency_code?: string | null;
  timezone: string;
  locale?: string | null;
  tax_rate: number;
  tax_inclusive: boolean;
  tax_label?: string | null;
  phone_country_code?: string | null;
  delivery_fee: number;
  free_delivery_threshold: number;
  max_delivery_distance_km: number;
  estimated_prep_time: number;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  is_active: boolean;
}

interface LocationFormData {
  name: string;
  description: string;
  whatsapp_number: string;
  address: string;
  latitude: string | number;
  longitude: string | number;
  country: string;
  currency_code: string;
  timezone: string;
  locale: string;
  tax_rate: string | number;
  tax_inclusive: boolean;
  tax_label: string;
  phone_country_code: string;
  delivery_fee: string | number;
  free_delivery_threshold: string | number;
  max_delivery_distance_km: string | number;
  estimated_prep_time: string | number;
  accepts_delivery: boolean;
  accepts_pickup: boolean;
  is_active: boolean;
}

const LocationSettings = () => {
  const { activeOrganization, fetchLocations } = useAuth();
  const { locationId } = useParams();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState('details');
  const [locationData, setLocationData] = useState<LocationDetail | null>(null);
  // Service style — stored locally per-location. Loaded on mount; persisted on save.
  const [serviceStyle, setServiceStyle] = useState(() => getServiceStyleLS(locationId));
  const [formData, setFormData] = useState<LocationFormData>({
    // Location details
    name: '',
    description: '',
    whatsapp_number: '',
    address: '',
    latitude: '',
    longitude: '',

    // Regional settings. Every one of these starts EMPTY (or UTC, which belongs
    // to no country) rather than carrying a default, because a wrong currency or
    // tax rate is worse than a missing one: the missing one is a visible gap and
    // the wrong one is a silent mispricing.
    country: '',
    currency_code: '',
    timezone: 'UTC',
    locale: '',
    tax_rate: '',
    tax_inclusive: true,
    tax_label: '',
    phone_country_code: '',

    // Delivery settings
    delivery_fee: '',
    free_delivery_threshold: '',
    max_delivery_distance_km: '',
    estimated_prep_time: '',
    accepts_delivery: true,
    accepts_pickup: true,
    is_active: true
  });

  // Option lists are built from Intl and are large (~250 countries, ~400
  // timezones), so they are memoised against the locale that names them rather
  // than rebuilt on every keystroke elsewhere in the form.
  const uiLocale = formData.locale.trim();
  const countries = useMemo(() => countryOptions(uiLocale), [uiLocale]);
  const currencies = useMemo(() => currencyOptions(uiLocale), [uiLocale]);
  const timezones = useMemo(() => timezoneOptions(), []);

  // A worked example beats a description: it shows the operator exactly what
  // their currency, locale and tax choices will do to a real amount before they
  // commit to them. 123456 minor units is chosen to exercise the grouping mark,
  // the decimal mark and (in JPY or KWD) the non-2 exponent all at once.
  const moneyPreview = formatMoney(123456, {
    currency: formData.currency_code,
    locale: uiLocale,
  });
  const symbolPreview = currencySymbol(formData.currency_code, uiLocale);

  // The delivery-money inputs used step="0.01", which is the rand's (and the
  // dollar's) smallest unit but not every currency's: a JPY location should step
  // in whole yen and a KWD one in thousandths. These fields are stored in MAJOR
  // units, so the step is one minor unit expressed as a major-unit fraction.
  const moneyStep = String(1 / 10 ** currencyDecimals(formData.currency_code));

  useEffect(() => {
    if (locationId) {
      // loadLocationData() is fully try/catch/finally-wrapped below.
      void loadLocationData();
    }
  }, [locationId]);

  const loadLocationData = async () => {
    if (!locationId) return;

    setLoading(true);
    try {
      // Load location data by ID
      const { data: location, error: locationError } = await supabase
        .from('locations')
        .select('*')
        .eq('id', locationId)
        .single();

      if (locationError) {
        console.error('Error loading location data:', locationError);
        // NOTE: 'code' is a PostgREST-specific field (PGRST116 = "no rows").
        // ApiError (src/lib/api-client.ts) — the shape the Go backend
        // actually returns post-Supabase-migration — has no `code` field, so
        // this branch never fires; the location-not-found empty state below
        // (via locationData staying null) is what actually handles this case.
        // Pre-existing dead code; not fixed here (out of scope).
        if ((locationError as unknown as { code?: string }).code === 'PGRST116') {
          // Location not found
          void navigate('/settings/organization');
          return;
        }
        return;
      }

      // Check if location belongs to active organization
      if (activeOrganization && location.organization_id !== activeOrganization.id) {
        console.error('El local no pertenece a la organización activa');
        void navigate('/settings/organization');
        return;
      }

      setLocationData(location);
      setFormData({
        name: location.name || '',
        description: location.description || '',
        whatsapp_number: location.whatsapp_number || '',
        address: location.address || '',
        latitude: location.latitude || '',
        longitude: location.longitude || '',
        country: location.country || '',
        currency_code: location.currency_code || '',
        timezone: location.timezone || 'UTC',
        locale: location.locale || '',
        // ?? rather than || so that a genuine 0% rate round-trips as "0" and is
        // not re-rendered as an unset field.
        tax_rate: location.tax_rate ?? '',
        tax_inclusive: location.tax_inclusive ?? true,
        tax_label: location.tax_label || '',
        phone_country_code: location.phone_country_code || '',
        delivery_fee: location.delivery_fee || '',
        free_delivery_threshold: location.free_delivery_threshold || '',
        max_delivery_distance_km: location.max_delivery_distance_km || '',
        estimated_prep_time: location.estimated_prep_time || '',
        accepts_delivery: location.accepts_delivery ?? true,
        accepts_pickup: location.accepts_pickup ?? true,
        is_active: location.is_active ?? true
      });
      // Sync service style from localStorage
      setServiceStyle(getServiceStyleLS(locationId));
    } catch (error) {
      console.error('Error loading location data:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = <K extends keyof LocationFormData>(field: K, value: LocationFormData[K]) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));

    if (saveMessage) {
      setSaveMessage('');
    }
  };

  const saveLocationSettings = async () => {
    if (!locationId) return;

    setSaving(true);
    setSaveMessage('');

    try {
      // Validate required fields
      if (!formData.name.trim()) {
        throw new Error('El nombre del local es obligatorio');
      }

      const taxRate = formData.tax_rate === '' ? 0 : Number(formData.tax_rate);
      if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
        throw new Error('El impuesto debe ser un porcentaje entre 0 y 100');
      }
      if (!isValidTimezone(formData.timezone)) {
        throw new Error(`“${formData.timezone}” no es una zona horaria IANA reconocida`);
      }
      if (!isValidLocale(formData.locale.trim())) {
        throw new Error(
          `“${formData.locale.trim()}” no es una configuración regional BCP-47 válida (por ejemplo, es-AR)`
        );
      }
      const dialCode = formData.phone_country_code.replace(/\D/g, '');
      if (formData.phone_country_code && !/^[0-9]{1,4}$/.test(dialCode)) {
        throw new Error('El código telefónico del país debe tener entre 1 y 4 dígitos, sin el signo más');
      }

      // Update location data
      const { error: locationError } = await supabase
        .from('locations')
        .update({
          name: formData.name.trim(),
          description: formData.description.trim() || null,
          whatsapp_number: formData.whatsapp_number.trim() || null,
          address: formData.address.trim() || null,
          latitude: formData.latitude ? parseFloat(String(formData.latitude)) : null,
          longitude: formData.longitude ? parseFloat(String(formData.longitude)) : null,
          // Empty regional fields are written as NULL, not as a placeholder
          // value: NULL reads unambiguously as "not configured", whereas any
          // stand-in ('XXX', 'en-US') would be indistinguishable from a
          // deliberate choice.
          country: formData.country || null,
          currency_code: formData.currency_code || null,
          timezone: formData.timezone || 'UTC',
          locale: formData.locale.trim() || null,
          tax_rate: taxRate,
          tax_inclusive: formData.tax_inclusive,
          tax_label: formData.tax_label.trim() || null,
          phone_country_code: dialCode || null,
          delivery_fee: formData.delivery_fee ? parseFloat(String(formData.delivery_fee)) : null,
          free_delivery_threshold: formData.free_delivery_threshold ? parseFloat(String(formData.free_delivery_threshold)) : null,
          max_delivery_distance_km: formData.max_delivery_distance_km ? parseFloat(String(formData.max_delivery_distance_km)) : null,
          estimated_prep_time: formData.estimated_prep_time ? parseInt(String(formData.estimated_prep_time)) : null,
          accepts_delivery: formData.accepts_delivery,
          accepts_pickup: formData.accepts_pickup,
          is_active: formData.is_active,
          updated_at: new Date().toISOString()
        })
        .eq('id', locationId);

      if (locationError) throw locationError;

      // Persist service style to localStorage
      setServiceStyleLS(locationId, serviceStyle);

      setSaveMessage('Configuración guardada correctamente.');

      // Refresh locations in auth context
      await fetchLocations();

      // Reload location data to reflect changes
      await loadLocationData();

      setTimeout(() => {
        setSaveMessage('');
      }, 3000);

    } catch (error) {
      console.error('Error saving location settings:', error);
      setSaveMessage(error instanceof Error ? error.message : 'No se pudo guardar la configuración. Intentá nuevamente.');

      setTimeout(() => {
        setSaveMessage('');
      }, 5000);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-start gap-3">
          <Skeleton className="h-11 w-11 rounded-2xl" />
          <div className="space-y-2">
            <Skeleton className="h-8 w-52" />
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        <Skeleton className="h-[72px] w-full rounded-2xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-72 w-full rounded-2xl" />
      </PageContainer>
    );
  }

  if (!locationData) {
    return (
      <PageContainer>
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-muted mb-4">
            <AlertCircle className="w-7 h-7 text-muted-foreground" />
          </span>
          <h2 className="font-display text-xl font-semibold text-foreground mb-2">No se encontró el local</h2>
          <p className="text-sm text-muted-foreground mb-6 max-w-sm">
            El local que buscás no existe o no tenés acceso.
          </p>
          <Button onClick={() => navigate('/settings/organization')} variant="outline" className="rounded-xl">
            <ArrowLeft className="w-4 h-4 mr-2" />

            Volver a la configuración de la organización
          </Button>
        </div>
      </PageContainer>
    );
  }

  const isSuccess = saveMessage === 'Configuración guardada correctamente.';

  return (
    <PageContainer>
      {/* Back breadcrumb + page header */}
      <Reveal>
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate('/settings/organization')}
            className="text-muted-foreground hover:text-primary -ml-2 rounded-lg h-8 px-2 gap-1.5"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="text-xs">Organización</span>
          </Button>

          <PageHeader
            eyebrow="Local"
            title={locationData?.name || 'Configuración del local'}
            description={`Administrá la dirección, las entregas y el estado de este local.`}
            icon={MapPin}
            actions={
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="hidden sm:inline-flex shadow-sm transition-all duration-200"
              >
                {saving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />

                    Guardando…
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />

                    Guardar cambios
                  </>
                )}
              </Button>
            }
          />
        </div>
      </Reveal>

      {/* Save message */}
      {saveMessage && (
        <Reveal delay={0.05}>
          <div
            className={cn(
              'flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-medium',
              isSuccess
                ? 'bg-success/10 text-success border-success/20'
                : 'bg-destructive/10 text-destructive border-destructive/20'
            )}
          >
            {isSuccess ? (
              <CheckCircle className="w-4 h-4 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 shrink-0" />
            )}
            <span>{saveMessage}</span>
          </div>
        </Reveal>
      )}

      {/* Location status banner */}
      <Reveal delay={0.07}>
        <Card variant="feature" className="border-primary/20">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                <MapPin className="w-5 h-5" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-foreground truncate">{locationData?.name}</p>
                <p className="text-xs text-muted-foreground">
                  {formData.is_active ? 'Activo' : 'Inactivo'} ·{' '}
                  {formData.accepts_delivery && formData.accepts_pickup
                    ? 'Entrega y retiro'
                    : formData.accepts_delivery
                    ? 'Solo entrega'
                    : formData.accepts_pickup
                    ? 'Solo retiro'
                    : 'Sin modalidades habilitadas'}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </Reveal>

      {/* Settings tabs */}
      <Reveal delay={0.1}>
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4 h-auto p-1 bg-muted/60 rounded-xl">
            <TabsTrigger
              value="details"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <MapPin className="w-4 h-4" />
              <span>Datos</span>
            </TabsTrigger>
            <TabsTrigger
              value="regional"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <Globe className="w-4 h-4" />
              <span>Configuración regional</span>
            </TabsTrigger>
            <TabsTrigger
              value="delivery"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <Truck className="w-4 h-4" />
              <span>Entrega</span>
            </TabsTrigger>
            <TabsTrigger
              value="status"
              className="flex items-center gap-2 text-xs sm:text-sm py-2.5 rounded-lg data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-primary"
            >
              <SettingsIcon className="w-4 h-4" />
              <span>Estado</span>
            </TabsTrigger>
          </TabsList>

          {/* ── Details tab ── */}
          <TabsContent value="details" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <MapPin className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Datos del local</CardTitle>
                      <CardDescription className="mt-0.5">Nombre, contacto, dirección y coordenadas.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="loc-name" className="block text-sm font-medium text-foreground">

                        Nombre del local <span className="text-destructive">*</span>
                      </label>
                      <Input
                        id="loc-name"
                        placeholder="Sucursal principal, centro, etc."
                        value={formData.name}
                        onChange={(e) => handleInputChange('name', e.target.value)}
                        className="rounded-xl h-10"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="whatsapp" className="block text-sm font-medium text-foreground">

                        Número de WhatsApp
                      </label>
                      <Input
                        id="whatsapp"
                        type="tel"
                        // The example follows the location's own dial code once
                        // one is configured; until then it stays a shape hint
                        // rather than any particular country's number.
                        placeholder={
                          formData.phone_country_code
                            ? `+${formData.phone_country_code.replace(/\D/g, '')} …`
                            : 'Formato internacional, por ejemplo +<código de país> <número>'
                        }
                        value={formData.whatsapp_number}
                        onChange={(e) => handleInputChange('whatsapp_number', e.target.value)}
                        className="rounded-xl h-10"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <label htmlFor="description" className="block text-sm font-medium text-foreground">

                      Descripción
                    </label>
                    <Textarea
                      id="description"
                      placeholder="Describí este local…"
                      value={formData.description}
                      onChange={(e) => handleInputChange('description', e.target.value)}
                      rows={3}
                      className="rounded-xl resize-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-sm font-medium text-foreground">

                      Dirección
                    </label>
                    <AddressAutocomplete
                      placeholder="Comenzá a escribir una dirección…"
                      value={formData.address}
                      onChange={(text) => handleInputChange('address', text)}
                      onSelect={(s) => {
                        handleInputChange('address', s.place_name || s.street || formData.address);
                        if (s.lat != null) handleInputChange('latitude', String(s.lat));
                        if (s.lng != null) handleInputChange('longitude', String(s.lng));
                      }}
                      className="rounded-xl"
                    />
                    <p className="text-xs text-muted-foreground">

                      Elegí una sugerencia para completar las coordenadas.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="latitude" className="block text-sm font-medium text-foreground">

                        Latitud
                      </label>
                      <Input
                        id="latitude"
                        type="number"
                        step="0.000001"
                        // The old placeholders were Johannesburg's coordinates.
                        // A valid range is the useful hint and belongs to no city.
                        placeholder="Grados decimales, de −90 a 90"
                        value={formData.latitude}
                        onChange={(e) => handleInputChange('latitude', e.target.value)}
                        className="rounded-xl h-10"
                      />
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="longitude" className="block text-sm font-medium text-foreground">

                        Longitud
                      </label>
                      <Input
                        id="longitude"
                        type="number"
                        step="0.000001"
                        placeholder="Grados decimales, de −180 a 180"
                        value={formData.longitude}
                        onChange={(e) => handleInputChange('longitude', e.target.value)}
                        className="rounded-xl h-10"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save */}
            <div className="sm:hidden">
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Guardar configuración del local</>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* ── Regional tab ── */}
          <TabsContent value="regional" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Globe className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Moneda y formato</CardTitle>
                      <CardDescription className="mt-0.5">
                        Moneda del local y formato de importes y fechas.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-foreground">

                        País
                      </label>
                      <Select
                        value={formData.country || undefined}
                        onValueChange={(v) => handleInputChange('country', v)}
                      >
                        <SelectTrigger className="rounded-xl h-10">
                          <SelectValue placeholder="Seleccionar país…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {countries.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.name} ({c.code})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Se usa para la dirección y los impuestos. La moneda y la zona horaria
                        se configuran por separado.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-foreground">

                        Moneda
                      </label>
                      <Select
                        value={formData.currency_code || undefined}
                        onValueChange={(v) => handleInputChange('currency_code', v)}
                      >
                        <SelectTrigger className="rounded-xl h-10">
                          <SelectValue placeholder="Seleccionar moneda…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {currencies.map((c) => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.code} — {c.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Todos los precios, reportes y comprobantes de este local usan esta moneda.
                        Cambiarla no convierte los importes existentes.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label className="block text-sm font-medium text-foreground">

                        Zona horaria
                      </label>
                      <Select
                        value={formData.timezone || undefined}
                        onValueChange={(v) => handleInputChange('timezone', v)}
                      >
                        <SelectTrigger className="rounded-xl h-10">
                          <SelectValue placeholder="Seleccionar zona horaria…" />
                        </SelectTrigger>
                        <SelectContent className="max-h-72">
                          {timezones.map((z) => (
                            <SelectItem key={z} value={z}>
                              {z}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs text-muted-foreground">
                          Define cuándo comienza y termina la jornada comercial del local.
                        </p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-xs shrink-0"
                          onClick={() => handleInputChange('timezone', detectedTimezone())}
                        >
                          Usar la mía
                        </Button>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="loc-locale" className="block text-sm font-medium text-foreground">

                        Formato regional
                      </label>
                      <Input
                        id="loc-locale"
                        placeholder="Dejá vacío para usar la configuración del navegador"
                        value={formData.locale}
                        onChange={(e) => handleInputChange('locale', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Una etiqueta BCP-47 como <code>es-AR</code>, <code>pt-BR</code> o{' '}
                        <code>en-GB</code>. Controla el formato de números y fechas, pero no la moneda.
                      </p>
                    </div>
                  </div>

                  {/* Worked example of the choices above */}
                  <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-primary/5 rounded-xl border border-primary/15">
                    <div>
                      <p className="text-xs font-semibold text-foreground">Vista previa</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Así verán el importe el personal y los clientes en los comprobantes.
                      </p>
                    </div>
                    <p className="font-display text-xl font-bold text-primary">
                      {formData.currency_code ? moneyPreview : 'No hay una moneda seleccionada'}
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            <Reveal delay={0.05}>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <SettingsIcon className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Impuestos</CardTitle>
                      <CardDescription className="mt-0.5">
                        Porcentaje, modalidad y nombre que aparece en los comprobantes.
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="tax_rate" className="block text-sm font-medium text-foreground">

                        Impuesto (%)
                      </label>
                      <Input
                        id="tax_rate"
                        type="number"
                        step="0.01"
                        min="0"
                        max="100"
                        placeholder="0"
                        value={formData.tax_rate}
                        onChange={(e) => handleInputChange('tax_rate', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Dejalo en 0 si el local no cobra impuestos en la caja.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="tax_label" className="block text-sm font-medium text-foreground">

                        Nombre del impuesto
                      </label>
                      <Input
                        id="tax_label"
                        placeholder="IVA, impuesto a las ventas…"
                        value={formData.tax_label}
                        onChange={(e) => handleInputChange('tax_label', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">
                        Nombre de la línea de impuesto en comprobantes y reportes. Si queda vacío,
                        se mostrará “Impuesto”.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border/50">
                    <div className="pr-4">
                      <p className="text-sm font-medium text-foreground">Los precios incluyen impuestos</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Si está activado, los precios del menú ya incluyen el impuesto. Si está
                        desactivado, el impuesto se agrega al cobrar. Esta opción modifica el total
                        que paga el cliente.
                      </p>
                    </div>
                    <Switch
                      id="tax_inclusive"
                      checked={formData.tax_inclusive}
                      onCheckedChange={(checked) => handleInputChange('tax_inclusive', checked)}
                      aria-label="Los precios incluyen impuestos"
                      className="shrink-0"
                    />
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            <Reveal delay={0.1}>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Teléfonos</CardTitle>
                  <CardDescription className="mt-0.5">
                    Código usado para interpretar números locales en formato internacional.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-1.5 md:max-w-xs">
                    <label htmlFor="phone_country_code" className="block text-sm font-medium text-foreground">

                      Código telefónico del país
                    </label>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-muted-foreground">+</span>
                      <Input
                        id="phone_country_code"
                        inputMode="numeric"
                        placeholder="1–4 dígitos"
                        value={formData.phone_country_code}
                        onChange={(e) => handleInputChange('phone_country_code', e.target.value)}
                        className="rounded-xl h-10"
                      />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Solo dígitos, sin el signo más. Los números locales se guardarán con este
                      código para evitar contactos duplicados. Si queda vacío, los números deben
                      ingresarse en formato internacional completo.
                    </p>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save */}
            <div className="sm:hidden">
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Guardar configuración del local</>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* ── Delivery tab ── */}
          <TabsContent value="delivery" className="mt-5 space-y-5">
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Truck className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Configuración de entregas</CardTitle>
                      <CardDescription className="mt-0.5">Costos, montos mínimos, distancias y tiempos de preparación de este local.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="delivery_fee" className="block text-sm font-medium text-foreground">

                        Costo de entrega{symbolPreview ? ` (${symbolPreview})` : ''}
                      </label>
                      <Input
                        id="delivery_fee"
                        type="number"
                        step={moneyStep}
                        min="0"
                        placeholder="0"
                        value={formData.delivery_fee}
                        onChange={(e) => handleInputChange('delivery_fee', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Costo estándar de entrega cobrado al cliente</p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="free_delivery_threshold" className="block text-sm font-medium text-foreground">

                        Monto mínimo para entrega gratuita{symbolPreview ? ` (${symbolPreview})` : ''}
                      </label>
                      <Input
                        id="free_delivery_threshold"
                        type="number"
                        step={moneyStep}
                        min="0"
                        placeholder="0"
                        value={formData.free_delivery_threshold}
                        onChange={(e) => handleInputChange('free_delivery_threshold', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Monto mínimo del pedido para obtener entrega gratuita</p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                    <div className="space-y-1.5">
                      <label htmlFor="max_delivery_distance_km" className="block text-sm font-medium text-foreground">

                        Distancia máxima de entrega (km)
                      </label>
                      <Input
                        id="max_delivery_distance_km"
                        type="number"
                        step="0.1"
                        min="0"
                        placeholder="10.0"
                        value={formData.max_delivery_distance_km}
                        onChange={(e) => handleInputChange('max_delivery_distance_km', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Distancia máxima para pedidos con entrega</p>
                    </div>

                    <div className="space-y-1.5">
                      <label htmlFor="estimated_prep_time" className="block text-sm font-medium text-foreground">

                        Tiempo estimado de preparación (minutos)
                      </label>
                      <Input
                        id="estimated_prep_time"
                        type="number"
                        min="1"
                        placeholder="30"
                        value={formData.estimated_prep_time}
                        onChange={(e) => handleInputChange('estimated_prep_time', e.target.value)}
                        className="rounded-xl h-10"
                      />
                      <p className="text-xs text-muted-foreground">Tiempo promedio de preparación de los pedidos</p>
                    </div>
                  </div>

                  {/* Fulfilment toggles */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border/50">
                      <div>
                        <p className="text-sm font-medium text-foreground">Aceptar entregas</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Recibir pedidos con entrega</p>
                      </div>
                      <Switch
                        id="accepts_delivery"
                        checked={formData.accepts_delivery}
                        onCheckedChange={(checked) => handleInputChange('accepts_delivery', checked)}
                        aria-label="Aceptar entregas"
                      />
                    </div>

                    <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border/50">
                      <div>
                        <p className="text-sm font-medium text-foreground">Aceptar retiros</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Recibir pedidos para retirar</p>
                      </div>
                      <Switch
                        id="accepts_pickup"
                        checked={formData.accepts_pickup}
                        onCheckedChange={(checked) => handleInputChange('accepts_pickup', checked)}
                        aria-label="Aceptar retiros"
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save */}
            <div className="sm:hidden">
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Guardar configuración del local</>
                )}
              </Button>
            </div>
          </TabsContent>

          {/* ── Status tab ── */}
          <TabsContent value="status" className="mt-5 space-y-5">

            {/* Service style card */}
            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <UtensilsCrossed className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Modalidad de atención</CardTitle>
                      <CardDescription className="mt-0.5">Indicá cómo atiende este local para mostrar las funciones adecuadas en el punto de venta.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {/* Dine-in option */}
                    <button
                      type="button"
                      onClick={() => setServiceStyle('dine_in')}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        serviceStyle === 'dine_in'
                          ? 'border-primary bg-primary/5'
                          : 'border-border/50 bg-muted/30 hover:border-border hover:bg-muted/60'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'dine_in' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <UtensilsCrossed className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Consumo en el local</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Restaurante o cafetería con mesas. Muestra el plano, la selección de asientos y el flujo de consumo en el local.</p>
                      </div>
                    </button>

                    {/* Takeaway option */}
                    <button
                      type="button"
                      onClick={() => setServiceStyle('takeaway')}
                      className={cn(
                        'flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                        serviceStyle === 'takeaway'
                          ? 'border-primary bg-primary/5'
                          : 'border-border/50 bg-muted/30 hover:border-border hover:bg-muted/60'
                      )}
                    >
                      <span className={cn(
                        'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg',
                        serviceStyle === 'takeaway' ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground'
                      )}>
                        <ShoppingBag className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-sm font-semibold text-foreground">Para llevar / mostrador</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">Puesto, carrito, atención por mostrador o solo entrega. No requiere plano ni selección de mesas.</p>
                      </div>
                    </button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Podés cambiar esta opción en cualquier momento. “Para llevar” oculta el flujo de mesas en el punto de venta.
                  </p>
                </CardContent>
              </Card>
            </Reveal>

            <Reveal>
              <Card variant="elevated">
                <CardHeader className="pb-4">
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                      <Activity className="h-4 w-4" />
                    </span>
                    <div>
                      <CardTitle>Estado del local</CardTitle>
                      <CardDescription className="mt-0.5">Controlá si el local está visible y acepta pedidos.</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="flex items-center justify-between p-4 bg-muted/50 rounded-xl border border-border/50">
                    <div>
                      <p className="text-sm font-medium text-foreground">Local activo</p>
                      <p className="text-xs text-muted-foreground mt-0.5">

                        Los locales inactivos no aparecen en las búsquedas de clientes
                      </p>
                    </div>
                    <Switch
                      id="is_active"
                      checked={formData.is_active}
                      onCheckedChange={(checked) => handleInputChange('is_active', checked)}
                      aria-label="Local activo"
                      className="shrink-0"
                    />
                  </div>

                  {/* Live summary */}
                  <div className="grid grid-cols-3 gap-3 p-4 bg-primary/5 rounded-xl border border-primary/15">
                    <div className="text-center">
                      <p className={cn('text-xl font-bold font-display', formData.is_active ? 'text-primary' : 'text-muted-foreground')}>
                        {formData.is_active ? 'Sí' : 'No'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Estado</p>
                    </div>
                    <div className="text-center border-x border-primary/15">
                      <p className={cn('text-xl font-bold font-display', formData.accepts_delivery ? 'text-primary' : 'text-muted-foreground')}>
                        {formData.accepts_delivery ? 'Sí' : 'No'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Entrega</p>
                    </div>
                    <div className="text-center">
                      <p className={cn('text-xl font-bold font-display', formData.accepts_pickup ? 'text-primary' : 'text-muted-foreground')}>
                        {formData.accepts_pickup ? 'Sí' : 'No'}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">Retiro</p>
                    </div>
                  </div>

                  <div className="p-4 bg-muted/40 rounded-xl border border-border/40 space-y-1.5">
                    <p className="text-xs font-semibold text-foreground">Consejos</p>
                    <ul className="space-y-1 text-xs text-muted-foreground list-disc list-inside">
                      <li>Los locales inactivos no aparecen en las búsquedas de clientes</li>
                      <li>Podés desactivar la entrega o el retiro por separado</li>
                      <li>Configurá tiempos de preparación realistas</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </Reveal>

            {/* Mobile save */}
            <div className="sm:hidden">
              <Button
                onClick={saveLocationSettings}
                disabled={saving}
                className="w-full rounded-xl h-11"
              >
                {saving ? (
                  <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Guardando…</>
                ) : (
                  <><Save className="w-4 h-4 mr-2" />Guardar configuración del local</>
                )}
              </Button>
            </div>
          </TabsContent>
        </Tabs>
      </Reveal>

      {/* Mobile floating save button */}
      <Button
        onClick={saveLocationSettings}
        disabled={saving}
        size="icon"
        className="fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-elevated hover:shadow-glow transition-all duration-300 z-40 sm:hidden"
      >
        {saving ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : (
          <Save className="w-5 h-5" />
        )}
      </Button>
    </PageContainer>
  );
};

export default LocationSettings;
