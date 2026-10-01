import { useState, useEffect, useCallback } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { OpenSessionForm } from './components/open-session-form';
import { SessionCard } from './components/session-card';
import { CashOutReport } from './components/cash-out-report';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { Loader2, AlertCircle, Vault } from 'lucide-react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

// Mirrors backend/migrations/001_baseline.sql `cash_drawers` table.
export interface CashDrawer {
  id: string;
  location_id: string;
  name: string;
  is_active: boolean;
}

// Mirrors backend/migrations/001_baseline.sql `cash_drawer_movements` table.
export interface CashMovement {
  id: string;
  cash_drawer_session_id: string;
  movement_type: 'paid_in' | 'paid_out' | 'petty_cash' | 'tip_out' | 'no_sale' | 'drop' | 'pickup';
  amount_cents: number;
  reason?: string | null;
  reference_type?: string | null;
  reference_id?: string | null;
  performed_by?: string | null;
  approved_by?: string | null;
  created_at: string;
}

// Mirrors backend/migrations/001_baseline.sql `cash_drawer_sessions` table,
// with `movements` attached client-side by GET /cash-drawers/sessions/{id}.
export interface CashSession {
  id: string;
  cash_drawer_id: string;
  opened_by?: string | null;
  closed_by?: string | null;
  opening_float_cents: number;
  declared_closing_cents?: number | null;
  expected_closing_cents?: number | null;
  over_short_cents?: number | null;
  is_blind_close: boolean;
  status: 'open' | 'closed' | 'reconciled';
  opened_at: string;
  closed_at?: string | null;
  notes?: string | null;
  cashier_label?: string | null;
  movements?: CashMovement[];
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useDrawers(locationId: string | undefined) {
  const [drawers, setDrawers] = useState<CashDrawer[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!locationId) {
      setDrawers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const { data, error: apiErr } = await api.request<CashDrawer[]>(
        'GET',
        `/data/cash_drawers?eq=location_id,${locationId}&eq=is_active,true`,
      );
      if (apiErr) throw new Error(apiErr.message);
      setDrawers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar las cajas.');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  useEffect(() => { void reload(); }, [reload]);

  return { drawers, loading, error, reload };
}

function useOpenSession(drawerId: string) {
  const [session, setSession] = useState<CashSession | null | undefined>(undefined); // undefined = not-yet-loaded
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!drawerId) { setSession(null); return; }
    setLoading(true);
    setError(null);
    api
      .request<CashSession[] | CashSession>('GET', `/cash-drawers/${drawerId}/sessions?status=open`)
      .then(({ data, error: apiErr }) => {
        if (apiErr) throw new Error(apiErr.message);
        const sessions = Array.isArray(data) ? data : data ? [data] : [];
        setSession(sessions[0] || null); // null = no open session
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : String(err));
        setSession(null);
      })
      .finally(() => setLoading(false));
  }, [drawerId]);

  useEffect(() => { reload(); }, [reload]);

  return { session, loading, error, reload };
}

// Fetch full session detail (includes movements array)
function useSessionDetail(sessionId: string | null) {
  const [detail, setDetail] = useState<CashSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    if (!sessionId) { setDetail(null); return; }
    setLoading(true);
    setError(null);
    api.request<CashSession>('GET', `/cash-drawers/sessions/${sessionId}`)
      .then(({ data, error: apiErr }) => {
        if (apiErr) throw new Error(apiErr.message);
        setDetail(data || null);
      })
      .catch((err) => setError(err instanceof Error ? err.message : 'No se pudieron cargar los movimientos.'))
      .finally(() => setLoading(false));
  }, [sessionId]);

  useEffect(() => { reload(); }, [reload]);

  return { detail, loading, error, reload };
}

function useClosedSessions(drawerId: string) {
  const [sessions, setSessions] = useState<CashSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!drawerId) { setSessions([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: apiErr } = await api.request<CashSession[] | CashSession>(
        'GET',
        `/cash-drawers/${drawerId}/sessions?status=closed`,
      );
      if (apiErr) throw new Error(apiErr.message);
      const rows = Array.isArray(data) ? data : data ? [data] : [];
      setSessions(rows.sort((a, b) => Date.parse(b.closed_at || b.opened_at) - Date.parse(a.closed_at || a.opened_at)));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudieron cargar los cierres.');
    } finally {
      setLoading(false);
    }
  }, [drawerId]);

  useEffect(() => { void reload(); }, [reload]);
  return { sessions, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default function CashPage() {
  const { activeLocation, user } = useAuth();
  const locationId = activeLocation?.id;

  // The staff id to pass to the API. Fall back to user id if needed.
  const staffId = user?.id || '';

  const { drawers, loading: drawersLoading, error: drawersError, reload: reloadDrawers } = useDrawers(locationId);
  const [drawerId, setDrawerId] = useState('');
  const [drawerName, setDrawerName] = useState('Caja principal');
  const [creatingDrawer, setCreatingDrawer] = useState(false);
  const [createDrawerError, setCreateDrawerError] = useState<string | null>(null);

  // Auto-select the first drawer when drawers load
  useEffect(() => {
    if (drawers.length > 0 && drawers[0].location_id === locationId && !drawerId) {
      setDrawerId(drawers[0].id);
    }
  }, [drawers, drawerId, locationId]);

  // Open session query (lightweight, just to know if one exists)
  const { session: openSession, loading: sessionLoading, error: sessionError, reload: reloadSession } =
    useOpenSession(drawerId);

  // Full detail (with movements) — fetched once we have a session id
  const { detail, loading: detailLoading, error: detailError, reload: reloadDetail } =
    useSessionDetail(openSession?.id ?? null);
  const { sessions: closedSessions, loading: closedSessionsLoading, error: closedSessionsError, reload: reloadClosedSessions } =
    useClosedSessions(drawerId);

  // After close we show the EOD report
  const [closedSession, setClosedSession] = useState<CashSession | null>(null);

  // When drawer changes, clear closed report
  useEffect(() => { setClosedSession(null); }, [drawerId]);

  useEffect(() => {
    setDrawerId('');
    setClosedSession(null);
  }, [locationId]);

  const handleCreateDrawer = async () => {
    const name = drawerName.trim();
    if (!locationId || !name) return;
    setCreatingDrawer(true);
    setCreateDrawerError(null);
    try {
      const { data, error: apiErr } = await api.request<CashDrawer[] | CashDrawer>(
        'POST',
        '/data/cash_drawers',
        { body: { location_id: locationId, name, is_active: true } },
      );
      if (apiErr) throw new Error(apiErr.message);
      const created = Array.isArray(data) ? data[0] : data;
      await reloadDrawers();
      if (created?.id) setDrawerId(created.id);
    } catch (err) {
      setCreateDrawerError(err instanceof Error ? err.message : 'No se pudo crear la caja.');
    } finally {
      setCreatingDrawer(false);
    }
  };

  const handleSessionOpened = () => {
    setClosedSession(null);
    reloadSession();
  };

  const handleMovementAdded = () => {
    reloadDetail();
  };

  const handleSessionClosed = (sess: CashSession) => {
    setClosedSession(sess);
    reloadSession();
    void reloadClosedSessions();
  };

  // Merge open session with detail (detail has movements)
  const sessionWithMovements =
    detail && openSession && detail.id === openSession.id
      ? { ...openSession, ...detail }
      : openSession;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!locationId) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-3">
        <AlertCircle className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">Seleccioná un local para administrar la caja.</p>
      </div>
    );
  }

  return (
    <PageContainer className="max-w-3xl mx-auto">
      <PageHeader icon={Vault} title="Caja" description="Aperturas, movimientos y cierres diarios." />

      {/* Drawer selector */}
      <div className="space-y-1 max-w-xs">
        <Label htmlFor="drawer-select">Caja</Label>
        {drawersLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Cargando cajas…
          </div>
        ) : drawersError ? (
          <div className="space-y-2 text-sm text-destructive">
            <p>{drawersError}</p>
            <Button variant="outline" size="sm" onClick={() => void reloadDrawers()}>Reintentar</Button>
          </div>
        ) : drawers.length === 0 ? (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm text-muted-foreground">Este local todavía no tiene una caja activa.</p>
            <div className="flex gap-2">
              <Input aria-label="Nombre de la caja" value={drawerName} onChange={(e) => setDrawerName(e.target.value)} />
              <Button onClick={() => void handleCreateDrawer()} disabled={creatingDrawer || !drawerName.trim()}>
                {creatingDrawer ? 'Creando…' : 'Crear caja'}
              </Button>
            </div>
            {createDrawerError && <p role="alert" className="text-sm text-destructive">{createDrawerError}</p>}
          </div>
        ) : (
          <Select value={drawerId} onValueChange={setDrawerId}>
            <SelectTrigger id="drawer-select">
              <SelectValue placeholder="Seleccioná una caja" />
            </SelectTrigger>
            <SelectContent>
              {drawers.map((d) => (
                <SelectItem key={d.id} value={d.id}>
                  {d.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Main content — only show when a drawer is selected */}
      {drawerId && (
        <>
          {/* Loading state */}
          {sessionLoading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Consultando el estado de la caja…
            </div>
          )}

          {/* Error */}
          {sessionError && !sessionLoading && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="h-4 w-4" />
              {sessionError}
            </div>
          )}

          {/* EOD report after a close (shown until drawer changes) */}
          {closedSession && !sessionLoading && (
            <>
              <div className="flex justify-end">
                <Button variant="outline" size="sm" onClick={() => setClosedSession(null)}>Volver a la caja</Button>
              </div>
              <CashOutReport sessionId={closedSession.id} />
            </>
          )}

          {/* No open session + not just closed */}
          {!sessionLoading && openSession === null && !closedSession && (
            <OpenSessionForm
              drawerId={drawerId}
              staffId={staffId}
              onOpened={handleSessionOpened}
            />
          )}

          {/* Open session card */}
          {!sessionLoading && openSession && !closedSession && (
            <>
              {detailError && <p role="alert" className="text-sm text-destructive">{detailError}</p>}
              {detailLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Cargando movimientos…
                </div>
              )}
              <SessionCard
                session={sessionWithMovements || openSession}
                staffId={staffId}
                onMovementAdded={handleMovementAdded}
                onSessionClosed={handleSessionClosed}
              />
            </>
          )}

          <section className="space-y-2 border-t pt-4">
            <h2 className="text-sm font-semibold">Cierres recientes</h2>
            {closedSessionsLoading ? (
              <p className="text-sm text-muted-foreground">Cargando cierres…</p>
            ) : closedSessionsError ? (
              <p role="alert" className="text-sm text-destructive">{closedSessionsError}</p>
            ) : closedSessions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Todavía no hay cierres registrados.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {closedSessions.slice(0, 10).map((session) => (
                  <Button
                    key={session.id}
                    variant={closedSession?.id === session.id ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setClosedSession(session)}
                  >
                    {new Date(session.closed_at || session.opened_at).toLocaleString()}
                  </Button>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </PageContainer>
  );
}
