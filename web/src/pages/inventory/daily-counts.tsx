import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  History,
  RefreshCw,
  Search,
  Sunrise,
  Sunset,
} from 'lucide-react';

import { useAuth } from '@/context/auth-context';
import { useDateTime } from '@/context/locale-context';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import type {
  DailyInventoryItem,
  DailyInventoryResponse,
  DailyInventorySession,
} from './types';

type CountMode = 'opening' | 'closing' | null;

function validCount(value: string | undefined): boolean {
  return value !== undefined && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;
}

function formatQuantity(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return '—';
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Number(value));
}

export default function DailyInventoryCountsPage() {
  const navigate = useNavigate();
  const { activeLocation } = useAuth();
  const { today, formatDate, formatTime } = useDateTime();
  const businessDate = today();
  const [data, setData] = useState<DailyInventoryResponse>({ inventory_items: [], sessions: [] });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [mode, setMode] = useState<CountMode>(null);
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');
  const [search, setSearch] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [detailSession, setDetailSession] = useState<DailyInventorySession | null>(null);

  const fetchCounts = useCallback(async () => {
    if (!activeLocation?.id) return;
    setLoading(true);
    setError('');
    try {
      const { data: response, error: requestError } = await api.request<DailyInventoryResponse>(
        'GET',
        `/inventory/daily-counts?location_id=${encodeURIComponent(activeLocation.id)}`,
      );
      if (requestError) throw new Error(requestError.message);
      setData(response || { inventory_items: [], sessions: [] });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo cargar el control diario');
    } finally {
      setLoading(false);
    }
  }, [activeLocation?.id]);

  useEffect(() => { void fetchCounts(); }, [fetchCounts]);

  const activeSession = useMemo(
    () => data.sessions.find((session) => session.status === 'open') || null,
    [data.sessions],
  );
  const todaySession = useMemo(
    () => data.sessions.find((session) => session.business_date === businessDate) || null,
    [businessDate, data.sessions],
  );
  const displayedBusinessDate = activeSession?.business_date || businessDate;
  const itemByID = useMemo(
    () => new Map(data.inventory_items.map((item) => [item.id, item])),
    [data.inventory_items],
  );

  const countItems = useMemo<DailyInventoryItem[]>(() => {
    if (mode === 'closing' && activeSession) {
      return activeSession.lines.map((line) => ({
        id: line.inventory_item_id,
        name: line.item_name,
        unit: line.unit,
        current_stock: Number(itemByID.get(line.inventory_item_id)?.current_stock ?? line.opening_quantity),
      }));
    }
    return data.inventory_items;
  }, [activeSession, data.inventory_items, itemByID, mode]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es');
    if (!needle) return countItems;
    return countItems.filter((item) => item.name.toLocaleLowerCase('es').includes(needle));
  }, [countItems, search]);

  const completedCount = countItems.filter((item) => validCount(counts[item.id])).length;
  const allCompleted = countItems.length > 0 && completedCount === countItems.length;

  function beginCount(nextMode: Exclude<CountMode, null>) {
    setMode(nextMode);
    setCounts({});
    setNotes('');
    setSearch('');
    setError('');
    setSuccess('');
    window.setTimeout(() => document.getElementById('daily-inventory-count')?.scrollIntoView({ behavior: 'smooth' }), 0);
  }

  function cancelCount() {
    setMode(null);
    setCounts({});
    setNotes('');
    setSearch('');
    setConfirmOpen(false);
  }

  function requestConfirmation() {
    if (!allCompleted) {
      setError(`Faltan ${countItems.length - completedCount} insumos por contar.`);
      return;
    }
    setError('');
    setConfirmOpen(true);
  }

  async function saveCount() {
    if (!activeLocation?.id || !mode || !allCompleted) return;
    if (mode === 'closing' && !activeSession) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const path = mode === 'opening'
        ? '/inventory/daily-counts/open'
        : `/inventory/daily-counts/${activeSession?.id}/close`;
      const body = {
        ...(mode === 'opening' ? { location_id: activeLocation.id, business_date: businessDate } : {}),
        notes: notes.trim() || undefined,
        lines: countItems.map((item) => ({
          inventory_item_id: item.id,
          counted_quantity: Number(counts[item.id]),
        })),
      };
      const { error: requestError } = await api.request('POST', path, { body });
      if (requestError) throw new Error(requestError.message);
      const completedMode = mode;
      cancelCount();
      await fetchCounts();
      setSuccess(completedMode === 'opening'
        ? 'Inventario inicial registrado. La jornada quedó abierta.'
        : 'Inventario final registrado. Las diferencias y el stock quedaron actualizados.');
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudo guardar el conteo');
    } finally {
      setSaving(false);
      setConfirmOpen(false);
    }
  }

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="mb-4 size-12 text-muted-foreground" />
        <p className="text-muted-foreground">Seleccioná un local para controlar el inventario diario.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={ClipboardCheck}
        title="Control diario de inventario"
        description={`Apertura y cierre de ${activeLocation.name} · ${formatDate(`${displayedBusinessDate}T12:00:00`)}`}
        actions={(
          <Button variant="outline" onClick={() => void fetchCounts()} disabled={loading || saving}>
            <RefreshCw className={`mr-2 size-4 ${loading ? 'animate-spin' : ''}`} /> Actualizar
          </Button>
        )}
      />

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" /> {error}
        </div>
      )}
      {success && (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 p-3 text-sm text-success">
          <CheckCircle2 className="size-4 shrink-0" /> {success}
        </div>
      )}

      {loading && data.sessions.length === 0 ? (
        <div className="grid gap-4 md:grid-cols-3">
          {[0, 1, 2].map((key) => <div key={key} className="h-32 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : (
        <Card variant="elevated">
          <CardContent className="grid gap-5 p-5 sm:p-6 lg:grid-cols-[1fr_auto] lg:items-center">
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge variant={activeSession ? 'success' : todaySession?.status === 'closed' ? 'secondary' : 'warning'}>
                  {activeSession ? 'Jornada abierta' : todaySession?.status === 'closed' ? 'Jornada cerrada' : 'Apertura pendiente'}
                </Badge>
                <span className="text-sm text-muted-foreground">{displayedBusinessDate}</span>
                {activeSession && activeSession.business_date !== businessDate && <Badge variant="warning">Cierre atrasado</Badge>}
              </div>
              <h2 className="text-lg font-semibold text-foreground">
                {activeSession
                  ? `Apertura registrada a las ${formatTime(activeSession.opened_at, { hour: '2-digit', minute: '2-digit' })}`
                  : todaySession?.status === 'closed'
                    ? `Cierre registrado a las ${formatTime(todaySession.closed_at || todaySession.opened_at, { hour: '2-digit', minute: '2-digit' })}`
                    : 'Registrá el conteo físico antes de comenzar la operación'}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeSession
                  ? activeSession.business_date !== businessDate
                    ? 'Esta jornada quedó abierta de un día anterior. Registrá el cierre antes de iniciar una nueva apertura.'
                    : 'Al finalizar el día, contá nuevamente cada insumo. El sistema mostrará y ajustará las diferencias.'
                  : todaySession?.status === 'closed'
                    ? `${todaySession.closing_variance_count} insumos tuvieron diferencia al cierre.`
                    : 'La apertura compara el conteo real con el stock del sistema y deja una base confiable para el día.'}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 lg:justify-end">
              {!activeSession && !todaySession && (
                <Button size="lg" onClick={() => beginCount('opening')} disabled={data.inventory_items.length === 0 || saving}>
                  <Sunrise className="mr-2 size-5" /> Registrar apertura
                </Button>
              )}
              {activeSession && (
                <Button size="lg" onClick={() => beginCount('closing')} disabled={saving}>
                  <Sunset className="mr-2 size-5" /> Registrar cierre
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {!loading && data.inventory_items.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <AlertCircle className="mx-auto mb-3 size-10 text-warning" />
            <h2 className="font-semibold text-foreground">Primero configurá los insumos</h2>
            <p className="mx-auto mt-1 max-w-lg text-sm text-muted-foreground">Definí qué productos se contarán y en qué unidad. Luego podrás registrar la apertura y el cierre diario.</p>
            <Button className="mt-4" onClick={() => navigate('/inventory/items')}>Configurar insumos</Button>
          </CardContent>
        </Card>
      )}

      {mode && (
        <Card id="daily-inventory-count" variant="elevated">
          <CardHeader className="border-b border-border pb-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  {mode === 'opening' ? <Sunrise className="size-5 text-primary" /> : <Sunset className="size-5 text-primary" />}
                  Conteo de {mode === 'opening' ? 'apertura' : 'cierre'}
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">Ingresá la cantidad física de cada insumo. Los campos no se completan automáticamente para asegurar un conteo real.</p>
              </div>
              <Badge variant={allCompleted ? 'success' : 'warning'}>
                {completedCount} de {countItems.length} contados
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-4 sm:p-6">
            <div className="relative max-w-md">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar insumo…"
                className="pl-9"
                aria-label="Buscar insumo"
              />
            </div>

            <div className="overflow-hidden rounded-lg border-2 border-border">
              <div className="hidden grid-cols-[minmax(0,1fr)_140px_170px_120px] gap-3 bg-muted/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground md:grid">
                <span>Insumo</span><span className="text-right">Stock del sistema</span><span>Conteo físico</span><span className="text-right">Diferencia</span>
              </div>
              <div className="divide-y divide-border">
                {visibleItems.map((item) => {
                  const value = counts[item.id] ?? '';
                  const variance = validCount(value) ? Number(value) - Number(item.current_stock || 0) : null;
                  return (
                    <div key={item.id} className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_140px_170px_120px] md:items-center">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{item.name}</p>
                        <p className="text-xs text-muted-foreground md:hidden">Sistema: {formatQuantity(item.current_stock)} {item.unit}</p>
                      </div>
                      <p className="hidden text-right tabular-nums text-muted-foreground md:block">{formatQuantity(item.current_stock)} {item.unit}</p>
                      <div>
                        <label className="sr-only" htmlFor={`count-${item.id}`}>Conteo físico de {item.name}</label>
                        <div className="flex items-center gap-2">
                          <Input
                            id={`count-${item.id}`}
                            type="number"
                            min="0"
                            step="0.001"
                            inputMode="decimal"
                            value={value}
                            onChange={(event) => setCounts((current) => ({ ...current, [item.id]: event.target.value }))}
                            className="text-right tabular-nums"
                            placeholder="0"
                          />
                          <span className="w-12 shrink-0 text-xs text-muted-foreground">{item.unit}</span>
                        </div>
                      </div>
                      <p className={`text-right font-semibold tabular-nums ${variance === null || Math.abs(variance) < 0.000001 ? 'text-muted-foreground' : variance > 0 ? 'text-success' : 'text-destructive'}`}>
                        {variance === null ? 'Pendiente' : `${variance > 0 ? '+' : ''}${formatQuantity(variance)} ${item.unit}`}
                      </p>
                    </div>
                  );
                })}
                {visibleItems.length === 0 && <p className="p-8 text-center text-sm text-muted-foreground">No hay insumos que coincidan con la búsqueda.</p>}
              </div>
            </div>

            <div>
              <label htmlFor="count-notes" className="mb-1.5 block text-sm font-medium">Observaciones opcionales</label>
              <Textarea
                id="count-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Roturas, mermas, productos pendientes de recepción…"
                maxLength={500}
              />
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="outline" onClick={cancelCount} disabled={saving}>Cancelar</Button>
              <Button onClick={requestConfirmation} disabled={saving || !allCompleted}>
                {mode === 'opening' ? <Sunrise className="mr-2 size-4" /> : <Sunset className="mr-2 size-4" />}
                {mode === 'opening' ? 'Confirmar apertura' : 'Confirmar cierre'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2"><History className="size-5 text-primary" /> Historial de jornadas</CardTitle>
        </CardHeader>
        <CardContent>
          {data.sessions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Todavía no hay jornadas de inventario registradas.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Fecha</th>
                    <th className="pb-2 font-medium">Estado</th>
                    <th className="pb-2 text-right font-medium">Insumos</th>
                    <th className="pb-2 text-right font-medium">Diferencias de apertura</th>
                    <th className="pb-2 text-right font-medium">Diferencias de cierre</th>
                    <th className="pb-2 text-right font-medium">Horario</th>
                    <th className="pb-2 text-right font-medium">Detalle</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.sessions.slice(0, 30).map((session: DailyInventorySession) => (
                    <tr key={session.id}>
                      <td className="py-3 font-medium">{formatDate(`${session.business_date}T12:00:00`)}</td>
                      <td className="py-3"><Badge variant={session.status === 'open' ? 'success' : 'secondary'}>{session.status === 'open' ? 'Abierta' : 'Cerrada'}</Badge></td>
                      <td className="py-3 text-right tabular-nums">{session.lines.length}</td>
                      <td className="py-3 text-right tabular-nums">{session.opening_variance_count}</td>
                      <td className="py-3 text-right tabular-nums">{session.status === 'closed' ? session.closing_variance_count : '—'}</td>
                      <td className="py-3 text-right text-muted-foreground">
                        {formatTime(session.opened_at, { hour: '2-digit', minute: '2-digit' })}
                        {session.closed_at && ` – ${formatTime(session.closed_at, { hour: '2-digit', minute: '2-digit' })}`}
                      </td>
                      <td className="py-3 text-right"><Button size="sm" variant="outline" onClick={() => setDetailSession(session)}>Ver detalle</Button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={!!detailSession} onOpenChange={(open) => { if (!open) setDetailSession(null); }}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
          {detailSession && (
            <>
              <DialogHeader>
                <DialogTitle>Inventario del {formatDate(`${detailSession.business_date}T12:00:00`)}</DialogTitle>
                <DialogDescription>
                  Apertura {formatTime(detailSession.opened_at, { hour: '2-digit', minute: '2-digit' })}
                  {detailSession.closed_at && ` · Cierre ${formatTime(detailSession.closed_at, { hour: '2-digit', minute: '2-digit' })}`}
                </DialogDescription>
              </DialogHeader>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full min-w-[760px] text-sm">
                  <thead>
                    <tr className="border-b bg-muted/60 text-xs text-muted-foreground">
                      <th className="px-3 py-2 text-left font-medium">Insumo</th>
                      <th className="px-3 py-2 text-right font-medium">Sistema al abrir</th>
                      <th className="px-3 py-2 text-right font-medium">Apertura física</th>
                      <th className="px-3 py-2 text-right font-medium">Ajuste de apertura</th>
                      <th className="px-3 py-2 text-right font-medium">Antes del cierre</th>
                      <th className="px-3 py-2 text-right font-medium">Cierre físico</th>
                      <th className="px-3 py-2 text-right font-medium">Ajuste de cierre</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {detailSession.lines.map((line) => (
                      <tr key={line.id}>
                        <td className="px-3 py-2 font-medium">{line.item_name}<span className="ml-1 text-xs text-muted-foreground">({line.unit})</span></td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(line.system_opening_quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(line.opening_quantity)}</td>
                        <td className={`px-3 py-2 text-right font-medium tabular-nums ${Math.abs(Number(line.opening_variance)) < 0.000001 ? 'text-muted-foreground' : Number(line.opening_variance) > 0 ? 'text-success' : 'text-destructive'}`}>{Number(line.opening_variance) > 0 ? '+' : ''}{formatQuantity(line.opening_variance)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(line.expected_closing_quantity)}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{formatQuantity(line.closing_quantity)}</td>
                        <td className={`px-3 py-2 text-right font-medium tabular-nums ${line.closing_variance == null || Math.abs(Number(line.closing_variance)) < 0.000001 ? 'text-muted-foreground' : Number(line.closing_variance) > 0 ? 'text-success' : 'text-destructive'}`}>{line.closing_variance != null && Number(line.closing_variance) > 0 ? '+' : ''}{formatQuantity(line.closing_variance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {(detailSession.opening_notes || detailSession.closing_notes) && (
                <div className="grid gap-3 text-sm sm:grid-cols-2">
                  {detailSession.opening_notes && <div className="rounded-lg bg-muted/50 p-3"><p className="font-medium">Observaciones de apertura</p><p className="mt-1 text-muted-foreground">{detailSession.opening_notes}</p></div>}
                  {detailSession.closing_notes && <div className="rounded-lg bg-muted/50 p-3"><p className="font-medium">Observaciones de cierre</p><p className="mt-1 text-muted-foreground">{detailSession.closing_notes}</p></div>}
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{mode === 'opening' ? '¿Confirmar la apertura?' : '¿Confirmar el cierre?'}</AlertDialogTitle>
            <AlertDialogDescription>
              El conteo físico reemplazará el stock del sistema cuando exista una diferencia. Cada ajuste quedará registrado con fecha y responsable.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={saving}>Revisar conteo</AlertDialogCancel>
            <AlertDialogAction onClick={(event) => { event.preventDefault(); void saveCount(); }} disabled={saving} variant={mode === 'closing' ? 'warning' : 'default'}>
              {saving ? 'Guardando…' : mode === 'opening' ? 'Abrir jornada' : 'Cerrar jornada'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
