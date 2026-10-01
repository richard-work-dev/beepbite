// /floor — read-only live floor view.
//
// - Reads sections + tables for the active location and paints them on a
//   canvas-like div. Auto-refreshes every 15s.
// - Click a table:
//     - occupied → navigates to the POS for its open session (placeholder)
//     - otherwise → POSTs /tables/{id}/open-session and shows a confirmation
//       (toast/alert) with the new session id.
// - Loading, empty, and error states are explicit.

import { useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  AlertCircle,
  CalendarClock,
  CheckCircle2,
  LayoutGrid,
  RefreshCw,
  Settings2,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { useTables, type FloorTable, type TableStatus } from './hooks/use-tables';
import SectionTabs from './components/section-tabs';
import FloorCanvas from './components/floor-canvas';

const LIVE_REFRESH_MS = 15_000;

interface Flash {
  type: 'ok' | 'err';
  message: string;
}

export default function FloorLive() {
  const { activeLocation } = useAuth();
  const navigate = useNavigate();
  const locationId = activeLocation?.id;

  const {
    sections,
    tables,
    loading,
    error,
    refresh,
    patchTableLocal,
  } = useTables(locationId, { pollMs: LIVE_REFRESH_MS });

  const [activeSection, setActiveSection] = useState('all');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [flash, setFlash] = useState<Flash | null>(null);

  const visibleTables = useMemo(() => {
    if (activeSection === 'all') return tables;
    return tables.filter((t) => t.section_id === activeSection);
  }, [tables, activeSection]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tables.length };
    for (const s of sections) c[s.id] = 0;
    for (const t of tables) if (t.section_id && c[t.section_id] != null) c[t.section_id]++;
    return c;
  }, [tables, sections]);

  const statusCounts = useMemo(() => {
    const out: Record<TableStatus, number> = { available: 0, occupied: 0, reserved: 0, out_of_service: 0 };
    for (const t of tables) {
      const s = t.status || 'available';
      if (out[s] != null) out[s] += 1;
    }
    return out;
  }, [tables]);

  const handleActivate = async (table: FloorTable) => {
    if (!table || openingId) return;
    // If the row already carries a session id, just route to it.
    if (table.status === 'occupied' && table.table_session_id) {
      void navigate(`/pos?session=${table.table_session_id}`);
      return;
    }
    setOpeningId(table.id);
    setFlash(null);
    try {
      const { data, error: err } = await api.request<{ id?: string }>(
        'POST',
        `/tables/${table.id}/open-session`,
        { body: { location_id: locationId, party_size: 1 } }
      );
      if (err) throw new Error(err.message || 'No se pudo abrir la mesa');
      // Optimistically mark occupied and stash the new session id.
      patchTableLocal(table.id, { status: 'occupied', table_session_id: data?.id });
      setFlash({ type: 'ok', message: `Mesa ${table.label} abierta correctamente` });
      // Refresh to pick up any server-side status changes. refresh()
      // (useTables' fetchAll) is fully try/catch/finally-wrapped — a
      // genuinely safe fire-and-forget.
      void refresh();
    } catch (e) {
      setFlash({ type: 'err', message: e instanceof Error ? e.message : String(e) });
    } finally {
      setOpeningId(null);
    }
  };

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-3" />
        <h2 className="text-xl font-semibold">No hay un local seleccionado</h2>
        <p className="text-muted-foreground mt-1">Seleccioná un local para ver el salón.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={LayoutGrid}
        title="Salón y mesas"
        description={`Estado en vivo de ${activeLocation.name}. Se actualiza cada ${LIVE_REFRESH_MS / 1000} segundos.`}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              Actualizar
            </Button>
            <Button asChild size="sm">
              <Link to="/floor/edit">
                <Settings2 className="h-4 w-4 mr-2" />
                Editar salón
              </Link>
            </Button>
          </div>
        }
      />

      {/* Status summary — same icon+colour pairing as the tiles below, so the
          strip and the canvas always agree on what each status looks like. */}
      <Card>
        <CardContent className="p-4 flex flex-wrap gap-3">
          <Badge className="gap-1.5 bg-success/15 text-success hover:bg-success/15">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            Disponibles {statusCounts.available}
          </Badge>
          <Badge className="gap-1.5 bg-primary/15 text-primary hover:bg-primary/15">
            <UtensilsCrossed className="h-3.5 w-3.5" aria-hidden="true" />
            Ocupadas {statusCounts.occupied}
          </Badge>
          <Badge className="gap-1.5 bg-warning/15 text-warning hover:bg-warning/15">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />
            Reservadas {statusCounts.reserved}
          </Badge>
          {statusCounts.out_of_service > 0 && (
            <Badge variant="secondary" className="gap-1.5">
              <Wrench className="h-3.5 w-3.5" aria-hidden="true" />
              Fuera de servicio {statusCounts.out_of_service}
            </Badge>
          )}
        </CardContent>
      </Card>

      {flash && (
        <div
          role="status"
          aria-live="polite"
          className={`rounded-md border px-3 py-2 text-sm ${
            flash.type === 'ok'
              ? 'border-success/30 bg-success/10 text-success'
              : 'border-destructive/30 bg-destructive/10 text-destructive'
          }`}
        >
          {flash.message}
        </div>
      )}

      {error && !loading && (
        <Card>
          <CardContent className="p-6 text-center">
            <AlertCircle className="h-8 w-8 text-destructive mx-auto mb-2" />
            <h3 className="font-medium text-foreground mb-1">No se pudo cargar el salón</h3>
            <p className="text-sm text-muted-foreground mb-4">{error}</p>
            <Button size="sm" variant="outline" onClick={refresh}>Reintentar</Button>
          </CardContent>
        </Card>
      )}

      {!error && (
        <>
          <SectionTabs
            sections={sections}
            value={activeSection}
            onValueChange={setActiveSection}
            counts={counts}
          />

          {loading && tables.length === 0 ? (
            <Card>
              <CardContent className="p-12 text-center text-muted-foreground">
                Cargando salón…
              </CardContent>
            </Card>
          ) : tables.length === 0 ? (
            <Card>
              <CardContent className="p-10 text-center">
                <LayoutGrid className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <h3 className="font-medium text-foreground mb-1">Todavía no hay un plano del salón</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Diseñá el salón y ubicá las mesas para poder asignar los pedidos desde el punto de venta.
                </p>
                <Button asChild>
                  <Link to="/floor/edit">
                    <Settings2 className="h-4 w-4 mr-2" />
                    Abrir editor del salón
                  </Link>
                </Button>
              </CardContent>
            </Card>
          ) : visibleTables.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground text-sm">
                No hay mesas en esta sección.
              </CardContent>
            </Card>
          ) : (
            <FloorCanvas
              tables={visibleTables}
              editable={false}
              onActivate={handleActivate}
              busyIds={new Set(openingId ? [openingId] : [])}
            />
          )}
        </>
      )}
    </PageContainer>
  );
}
