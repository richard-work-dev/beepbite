// src/pages/work/index.jsx — Unified Workspace (Wave 35 / Now-27)
//
// A single page with TWO top-level tabs: POS and Kitchen.
//
// POS views:     Orders | Full | Quick | Floor
// Kitchen views: Station | Expo | Bump-bar
//
// Role-aware tab visibility:
//   - members with ONLY can_kitchen see only the Kitchen tab
//   - members with can_pos see the POS tab
//   - owner / manager / admin see both tabs regardless of capability flags
//
// Capabilities are read from the Go backend's auth/me scope by querying
// organization_members for the current user's membership row.
//
// Last view per tab is persisted via userprefs service (falls back to
// localStorage). This means preferences sync across devices when connected.
//
// The chrome-less deep links (/kds/expo etc.) are untouched — do NOT modify.
//
// IMPORTANT: view components are imported READ-ONLY. Do NOT modify them.
// The KDS Station view uses useParams() so it is wrapped in a MemoryRouter
// with the selected station id injected.

import React, {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { MemoryRouter, Routes, Route, useSearchParams } from 'react-router-dom';
import { ChefHat, Loader2, Monitor, RefreshCw, ShieldAlert } from 'lucide-react';

import { useAuth } from '@/context/auth-context';
import { useActor } from '@/context/actor-token-context';
import { api } from '@/lib/api-client';
import { cn } from '@/lib/utils';
import { fetchPrefs, savePOSView, saveKDSView } from '@/services/userprefs';
import { Button } from '@/components/ui/button';
import { SyncStatusBadge } from '@/components/ui/sync-status';

type PosViewId = 'full' | 'orders' | 'quick' | 'floor';
type KdsViewId = 'station' | 'expo';

interface KdsStation {
  id: string;
  name: string;
  location_id: string;
}

interface MembershipCaps {
  can_pos?: boolean;
  can_kds?: boolean;
  can_kitchen?: boolean;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Lazy view imports — read-only; do NOT modify these files.
// ---------------------------------------------------------------------------

// POS views
const PosWorkspace = lazy(() => import('@/pages/pos/workspace').then((module) => ({ default: module.EmbeddedPosWorkspace })));
const QuickPOS = lazy(() => import('@/pages/quick-pos').then((module) => ({ default: module.EmbeddedQuickPOS })));
const FloorLive = lazy(() => import('@/pages/floor'));
const OrderStatusBoard = lazy(() => import('@/pages/work/components/order-status-board'));

// Kitchen views
const StationPage = lazy(() => import('@/pages/kds/station').then((module) => ({ default: module.EmbeddedStationPage })));
const ExpoPage = lazy(() => import('@/pages/kds/expo').then((module) => ({ default: module.EmbeddedExpoPage })));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POS_VIEWS: { id: PosViewId; label: string }[] = [
  { id: 'orders', label: 'En curso' },
  { id: 'full', label: 'Nuevo pedido' },
  { id: 'quick', label: 'Venta rápida' },
  { id: 'floor', label: 'Mesas' },
];

const KDS_VIEWS: { id: KdsViewId; label: string }[] = [
  { id: 'station', label: 'Comandas' },
  { id: 'expo', label: 'Despacho' },
];

// ---------------------------------------------------------------------------
// Role helpers
// ---------------------------------------------------------------------------

/**
 * Determine which top-level tabs the user can access.
 *
 * Logic (from migration 019_owner_default_capabilities.sql):
 *   - role owner/manager/admin → ambas pestañas
 *   - capacidad can_pos → pestaña POS
 *   - solo can_kitchen → pestaña Cocina
 *   - sin capacidades → sin acceso al espacio de trabajo
 *
 * @param {string[]} roles    — role strings from membership rows
 * @param {object}   caps     — merged capability flags { can_pos, can_kitchen, … }
 */
function resolveTabAccess(roles: string[], caps: MembershipCaps) {
  const isOwnerManager = roles.some((r) => ['owner', 'manager', 'admin'].includes(String(r).toLowerCase()));
  const hasPos = Boolean(caps.can_pos);
  const hasKitchen = Boolean(caps.can_kds || caps.can_kitchen);

  return {
    showPOS: isOwnerManager || hasPos,
    showKitchen: isOwnerManager || hasKitchen,
  };
}

// ---------------------------------------------------------------------------
// useMembership — fetch roles + capabilities for the current user
// ---------------------------------------------------------------------------

function useMembership() {
  const { user, activeOrganization, hasLoadedOrganizations } = useAuth();
  const [state, setState] = useState<{ roles: string[]; caps: MembershipCaps; loading: boolean; error: string | null }>({ roles: [], caps: {}, loading: true, error: null });

  useEffect(() => {
    if (!user?.id) {
      setState({ roles: [], caps: {}, loading: false, error: 'No hay una sesión activa para validar tus permisos.' });
      return;
    }
    if (!activeOrganization?.id) {
      if (!hasLoadedOrganizations) {
        setState({ roles: [], caps: {}, loading: true, error: null });
        return;
      }
      setState({ roles: [], caps: {}, loading: false, error: 'No hay una organización activa para validar tus permisos.' });
      return;
    }

    setState((current) => ({ ...current, loading: true, error: null }));

    let cancelled = false;

    // api.from(...) only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) throws instead.
    // Without this try/catch, that skipped setState() entirely, leaving
    // `loading: true` forever — and this hook drives showPOS/showKitchen
    // gating for the whole /work page, so a network blip on mount must end in
    // an explicit retry state rather than a permanent loading spinner.
    (async () => {
      try {
        const { data, error } = await api
          .from('organization_members')
          .select('role,capabilities')
          .eq('profile_id', user.id)
          .eq('organization_id', activeOrganization.id);

        if (cancelled) return;

        if (error || !data?.length) {
          setState({ roles: [], caps: {}, loading: false, error: 'No se pudieron validar tus permisos de acceso.' });
          return;
        }

        const roles: string[] = data.map((m: { role: string }) => m.role).filter(Boolean);
        const caps: MembershipCaps = {};
        for (const m of data) {
          let parsed = m.capabilities;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = {}; }
          }
          Object.assign(caps, parsed || {});
        }
        setState({ roles, caps, loading: false, error: null });
      } catch (err) {
        console.error('Membership fetch failed:', err);
        if (!cancelled) {
          setState({ roles: [], caps: {}, loading: false, error: 'No se pudieron validar tus permisos de acceso.' });
        }
      }
    })();

    return () => { cancelled = true; };
  }, [user?.id, activeOrganization?.id, hasLoadedOrganizations]);

  return state;
}

// ---------------------------------------------------------------------------
// useKdsStations — fetch the station list for the active location
// ---------------------------------------------------------------------------

function useKdsStations() {
  const { activeLocation } = useAuth();
  const [stations, setStations] = useState<KdsStation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!activeLocation?.id) {
      setStations([]);
      setLoading(false);
      return;
    }

    let cancelled = false;

    // Same failure mode as useMembership above: a network-level rejection
    // (not just an { error } response) skipped setLoading(false), leaving
    // the KDS station list stuck loading forever.
    const loadStations = async () => {
      try {
        const { data, error } = await api
          .from('kitchen_stations')
          .select('id,name,location_id')
          .eq('location_id', activeLocation.id)
          .eq('is_active', true)
          .order('name', { ascending: true });

        if (cancelled) return;
        setStations(error ? [] : (data || []));
      } catch (err) {
        console.error('Kitchen stations fetch failed:', err);
        if (!cancelled) setStations([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    void loadStations();
    // The first order can provision Cocina principal. Retry only while the
    // station list is empty so staff do not need to leave and re-enter Cocina.
    const retry = window.setInterval(() => {
      if (stations.length === 0) void loadStations();
    }, 5_000);

    return () => { cancelled = true; window.clearInterval(retry); };
  }, [activeLocation?.id, stations.length]);

  return { stations, loading };
}

// ---------------------------------------------------------------------------
// Loading fallback
// ---------------------------------------------------------------------------

function ViewLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab button
// ---------------------------------------------------------------------------

interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function TabButton({ active, onClick, children }: TabButtonProps) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        // font-display: this is the "which screen am I on" label — read at a
        // glance while reaching for the tab, same job as a KDS ticket header.
        'h-auto shrink-0 rounded-none border-b-2 px-3 py-3 font-display text-xs tracking-wide hover:bg-transparent sm:px-5 sm:text-sm',
        active
          ? 'border-primary text-primary'
          : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted',
      )}
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// View pill (sub-tab)
// ---------------------------------------------------------------------------

interface ViewPillProps {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

function ViewPill({ active, onClick, children }: ViewPillProps) {
  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      aria-pressed={active}
      className="h-11 shrink-0 rounded-xl px-3.5 text-sm font-semibold"
    >
      {children}
    </Button>
  );
}

// ---------------------------------------------------------------------------
// KDS Station view wrapper
// ---------------------------------------------------------------------------

// StationPage uses useParams() — we wrap it in a MemoryRouter so we can
// inject the chosen station ID without altering station.jsx.
function StationView({ stationId }: { stationId: string | null }) {
  if (!stationId) return null;
  return (
    <MemoryRouter initialEntries={[`/kds/${stationId}`]}>
      <Routes>
        <Route
          path="/kds/:stationId"
          element={
            <Suspense fallback={<ViewLoader />}>
              <StationPage />
            </Suspense>
          }
        />
      </Routes>
    </MemoryRouter>
  );
}

// ---------------------------------------------------------------------------
// KDS Panel — station picker + view
// ---------------------------------------------------------------------------

interface KitchenPanelProps {
  kdsView: KdsViewId;
}

function KitchenPanel({ kdsView }: KitchenPanelProps) {
  const { stations, loading: stationsLoading } = useKdsStations();
  const [selectedStation, setSelectedStation] = useState<string | null>(null);

  // Auto-select the first station when list loads.
  useEffect(() => {
    if (stations.length && !selectedStation) {
      setSelectedStation(stations[0].id);
    }
  }, [stations, selectedStation]);

  const needsStation = kdsView === 'station';

  // The whole Kitchen tab is scoped `dark` — station.jsx/expo.jsx (owned
  // elsewhere) render their own permanently-charcoal chrome (bg-gray-950/900,
  // no light-mode variant; it's a wall-mounted kitchen screen, not something
  // that follows the app's light/dark toggle). Scoping the *tokens* dark here
  // — rather than hardcoding gray-9xx of our own — means our station picker,
  // empty-state and loading fallback pick up the same charcoal/orange
  // pairing (bg-card/border-border/bg-primary resolve to the .dark values in
  // index.css, which were tuned to sit next to those literal grays) instead
  // of flashing light before the KDS view mounts.
  return (
    <div className="dark flex flex-col h-full bg-background">
      {stationsLoading ? (
        <ViewLoader />
      ) : (
        <>
          {/* Station picker (shown when view needs a station) */}
          {needsStation && stations.length > 1 && (
            <div className="flex gap-2 px-4 py-2 border-b border-border bg-card/60 overflow-x-auto">
              {stations.map((s) => (
                <ViewPill
                  key={s.id}
                  active={selectedStation === s.id}
                  onClick={() => setSelectedStation(s.id)}
                >
                  {s.name}
                </ViewPill>
              ))}
            </div>
          )}

          {/* No stations configured */}
          {needsStation && stations.length === 0 && (
            <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted-foreground">
              <ChefHat className="h-10 w-10" />
              <p className="text-sm">La primera comanda enviada crea automáticamente la estación Cocina principal.</p>
              <p className="text-xs">Después podés agregar estaciones y rutas desde Configuración.</p>
            </div>
          )}

          {/* View content */}
          <div className="flex-1 overflow-auto">
            {kdsView === 'station' && selectedStation && (
              <StationView stationId={selectedStation} />
            )}
            {kdsView === 'expo' && (
              <Suspense fallback={<ViewLoader />}>
                <ExpoPage />
              </Suspense>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// POS Panel
// ---------------------------------------------------------------------------

function POSPanel({ posView }: { posView: PosViewId }) {
  return (
    <div className="relative h-full flex-1 overflow-auto">
      {posView === 'full' && (
        <Suspense fallback={<ViewLoader />}>
          <PosWorkspace />
        </Suspense>
      )}
      {posView === 'quick' && (
        <Suspense fallback={<ViewLoader />}>
          <QuickPOS />
        </Suspense>
      )}
      {posView === 'orders' && (
        <Suspense fallback={<ViewLoader />}>
          <OrderStatusBoard />
        </Suspense>
      )}
      {posView === 'floor' && (
        <Suspense fallback={<ViewLoader />}>
          <FloorLive />
        </Suspense>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Workspace page
// ---------------------------------------------------------------------------

export default function WorkspacePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { roles, caps, loading: memberLoading, error: membershipError } = useMembership();
  const { actor } = useActor();

  const { showPOS, showKitchen } = useMemo(
    () => actor ? resolveTabAccess([actor.role], Object.fromEntries(actor.capabilities.map(capability => [capability, true]))) : resolveTabAccess(roles, caps),
    [roles, caps, actor],
  );

  // Top-level tab: 'pos' | 'kitchen'
  const [activeTab, setActiveTab] = useState<'pos' | 'kitchen' | null>(null);
  // POS sub-view
  const [posView, setPosView] = useState<PosViewId>('full');
  // KDS sub-view
  const [kdsView, setKdsView] = useState<KdsViewId>('station');
  // Preferences loaded flag
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load persisted preferences once on mount. fetchPrefs() has its own
  // try/catch (see services/userprefs.ts) and always resolves — it falls
  // back to localStorage on any error, network or otherwise — so this is a
  // genuinely safe fire-and-forget, not a swallowed-rejection risk.
  useEffect(() => {
    void fetchPrefs().then(({ lastViewPOS, lastViewKDS }) => {
      // Unknown or legacy saved views fall back to the default POS workspace.
      const posView = (POS_VIEWS.some((v) => v.id === lastViewPOS) ? lastViewPOS : 'full') as PosViewId;
      setPosView(posView);
      const kdsView = (KDS_VIEWS.some((v) => v.id === lastViewKDS) ? lastViewKDS : 'station') as KdsViewId;
      setKdsView(kdsView);
      setPrefsLoaded(true);
    });
  }, []);

  // Set initial active tab based on role access (once membership resolves).
  useEffect(() => {
    if (memberLoading || activeTab !== null) return;
    if (showPOS) setActiveTab('pos');
    else if (showKitchen) setActiveTab('kitchen');
  }, [memberLoading, showPOS, showKitchen, activeTab]);

  useEffect(() => {
    if (activeTab === 'pos' && !showPOS && showKitchen) setActiveTab('kitchen');
    if (activeTab === 'kitchen' && !showKitchen && showPOS) setActiveTab('pos');
  }, [activeTab, showPOS, showKitchen]);

  // Explicit navigation links take precedence over a device's last saved view.
  // This also makes Back/Forward and shared links restore the visible screen.
  useEffect(() => {
    if (memberLoading || !prefsLoaded) return;
    const tab = searchParams.get('tab');
    const view = searchParams.get('view');
    if (tab === 'pos' && showPOS) {
      setActiveTab('pos');
      if (POS_VIEWS.some(v => v.id === view)) setPosView(view as PosViewId);
    } else if (tab === 'kitchen' && showKitchen) {
      setActiveTab('kitchen');
      if (KDS_VIEWS.some(v => v.id === view)) setKdsView(view as KdsViewId);
    }
  }, [searchParams, memberLoading, prefsLoaded, showPOS, showKitchen]);

  // Handlers with preference persistence.
  const handlePosView = useCallback(
    (view: PosViewId) => {
      setPosView(view);
      setSearchParams({ tab: 'pos', view });
      // savePOSView() has its own try/catch (services/userprefs.ts) and
      // always resolves — the localStorage write is optimistic and a
      // server-sync failure is tolerated silently by design.
      void savePOSView(view);
    },
    [setSearchParams],
  );

  const handleKdsView = useCallback(
    (view: KdsViewId) => {
      setKdsView(view);
      setSearchParams({ tab: 'kitchen', view });
      // Same as handlePosView above: saveKDSView() self-catches and always
      // resolves.
      void saveKDSView(view);
    },
    [setSearchParams],
  );

  const handleTab = useCallback(
    (tab: 'pos' | 'kitchen') => {
      setActiveTab(tab);
      setSearchParams({ tab, view: tab === 'pos' ? posView : kdsView });
    },
    [setSearchParams, posView, kdsView],
  );

  // Show loader while membership resolves or prefs are loading.
  if (memberLoading || !prefsLoaded) {
    return <ViewLoader />;
  }

  if (membershipError || (!showPOS && !showKitchen)) {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div role="alert" className="w-full max-w-md rounded-xl border border-destructive/30 bg-card p-6 text-center shadow-sm">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive" aria-hidden="true" />
          <h1 className="mt-3 text-lg font-bold text-foreground">No se pudo habilitar el espacio de trabajo</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {membershipError || 'Tu usuario no tiene permisos para pedidos, caja ni cocina.'}
          </p>
          <Button type="button" variant="outline" className="mt-5" onClick={() => window.location.reload()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Reintentar
          </Button>
        </div>
      </div>
    );
  }

  if (activeTab === null) return <ViewLoader />;

  return (
    <div className="operational-workspace flex h-full flex-col overflow-hidden bg-background">
      {/* ----------------------------------------------------------------- */}
      {/* Top bar: tab switcher + view picker                               */}
      {/*                                                                   */}
      {/* Scoped `dark` on purpose, independent of the app's own light/dark */}
      {/* toggle: this bar is the one piece of chrome that's ALWAYS on      */}
      {/* screen no matter which half a small operation is looking at, and  */}
      {/* the Kitchen half underneath it (station.jsx/expo.jsx) is a        */}
      {/* permanently-charcoal kitchen display that never goes light. A     */}
      {/* light bar sitting over a black KDS board every time staff tap     */}
      {/* over to Kitchen would read as two products bolted together; a     */}
      {/* charcoal bar that also sits fine over the (light, "warm paper")   */}
      {/* POS half reads as one deliberate till bezel instead. index.css's  */}
      {/* .dark tokens were tuned to match the KDS's literal grays/orange   */}
      {/* for exactly this reason.                                         */}
      {/* ----------------------------------------------------------------- */}
      <div className="flex shrink-0 flex-col gap-0 border-b border-border bg-card sm:flex-row sm:items-center">
        {/* Tab buttons */}
        <div role="group" aria-label="Área de trabajo" className={cn('hidden w-full items-center border-b border-border sm:w-auto sm:border-b-0 sm:border-r sm:pr-4', showPOS && showKitchen && 'sm:flex')}>
          <div className="hidden items-center gap-2.5 pl-4 pr-3 min-[420px]:flex" aria-hidden="true">
            <span className="h-6 w-1 rounded-full bg-primary" />
            <Monitor className="h-4 w-4 text-muted-foreground" />
          </div>
          {showPOS && (
            <TabButton
              active={activeTab === 'pos'}
              onClick={() => handleTab('pos')}
            >
              Pedidos y caja
            </TabButton>
          )}
          {showKitchen && (
            <TabButton
              active={activeTab === 'kitchen'}
              onClick={() => handleTab('kitchen')}
            >
              Cocina
            </TabButton>
          )}
        </div>

        {/* View pills */}
        <div role="group" aria-label="Vista del área de trabajo" className="flex w-full items-center gap-1 p-2 sm:w-auto sm:flex-wrap sm:px-3 sm:py-2">
          {activeTab === 'pos' && <>
            <div className="flex min-w-0 flex-1 gap-1 sm:hidden">{POS_VIEWS.filter(v => v.id === 'orders' || v.id === 'full').map(v => <Button key={v.id} variant={posView === v.id ? 'default' : 'outline'} aria-pressed={posView === v.id} onClick={() => handlePosView(v.id)} className="h-11 min-w-0 flex-1 rounded-xl px-2 text-xs font-semibold">{v.id === 'full' ? 'Nuevo pedido' : v.label}</Button>)}</div>
            <select aria-label="Otras vistas del punto de venta" value={posView === 'quick' || posView === 'floor' ? posView : ''} onChange={event => handlePosView(event.target.value as PosViewId)} className="h-11 min-w-0 max-w-24 rounded-xl border bg-background px-1.5 text-xs sm:hidden"><option value="" disabled>Más vistas</option><option value="quick">Venta rápida</option><option value="floor">Mesas</option></select>
            <div className="hidden gap-2 sm:flex">{POS_VIEWS.map((v) => (
              <ViewPill
                key={v.id}
                active={posView === v.id}
                onClick={() => handlePosView(v.id)}
              >
                {v.label}
              </ViewPill>
            ))}</div></>}
          {activeTab === 'kitchen' &&
            KDS_VIEWS.map((v) => (
              <ViewPill
                key={v.id}
                active={kdsView === v.id}
                onClick={() => handleKdsView(v.id)}
              >
                {v.label}
              </ViewPill>
            ))}
        </div>

        {/* Sync status — this is the one chrome-bearing screen in the app
            (unlike the chrome-less POS/KDS, which use the full-width
            OfflineBanner instead), so the compact top-bar badge belongs here
            rather than a banner. */}
        <div className="ml-auto hidden shrink-0 items-center px-4 lg:flex">
          <SyncStatusBadge className="hidden sm:inline-flex" />
        </div>
      </div>

      {/* ----------------------------------------------------------------- */}
      {/* View content area                                                 */}
      {/* ----------------------------------------------------------------- */}
      <div className="operational-content min-h-0 flex-1 overflow-hidden">
        {activeTab === 'pos' && <POSPanel posView={posView} />}
        {activeTab === 'kitchen' && (
          <KitchenPanel kdsView={kdsView} />
        )}
      </div>
    </div>
  );
}
