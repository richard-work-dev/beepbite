// src/pages/settings/kitchen/index.tsx — Kitchen Routing Settings (Wave 12)
//
// Owner page for managing all kitchen-routing configuration for a location:
//
//   Tab 1 – Stations        : list / create / edit / delete kitchen_stations
//   Tab 2 – Category routes : bind menu categories → station
//   Tab 3 – Item routes     : bind individual items → station (item-level override)
//   Tab 4 – Display groups  : manage kds_display_groups (migration 031)
//                             name, station_ids[], display_order, auto_recall_seconds
//
// All data is read/written via src/services/kitchen-config.js which wraps the
// generic /data/{table} API (api.from(...) builder from @/lib/api-client.js).

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import {
  AlertCircle,
  ChefHat,
  Edit,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Settings2,
  Tag,
  Trash2,
  Utensils,
  type LucideIcon,
} from 'lucide-react';

import { useAuth } from '@/context/auth-context';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '@/components/ui/sheet';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import {
  fetchStations,
  createStation,
  updateStation,
  deleteStation,
  fetchCategoryRoutings,
  setCategoryRouting,
  deleteCategoryRouting,
  fetchItemRoutings,
  setItemRouting,
  deleteItemRouting,
  fetchDisplayGroups,
  createDisplayGroup,
  updateDisplayGroup,
  deleteDisplayGroup,
  fetchCategories,
  fetchItems,
} from '@/services/kitchen-config';

// ---------------------------------------------------------------------------
// Local types — mirror backend/migrations/001_baseline.sql. The kitchen-config
// service goes through the untyped api.from(...) query builder (the one
// documented `any` in the codebase), so these interfaces are applied locally
// to keep this page's own state honestly typed.
// ---------------------------------------------------------------------------

interface KitchenStation {
  id: string;
  location_id: string;
  name: string;
  station_type: string;
  sort_order: number;
  is_active: boolean;
}

interface CategoryLite {
  id: string;
  name: string;
}

interface ItemLite {
  id: string;
  name: string;
  category_id?: string;
}

interface CategoryRouting {
  id: string;
  category_id: string;
  station_id: string;
  is_primary: boolean;
  created_at: string;
}

interface ItemRoutingRow {
  id: string;
  item_id: string;
  station_id: string;
  is_primary: boolean;
  created_at: string;
}

interface DisplayGroup {
  id: string;
  location_id: string;
  name: string;
  station_ids: string[];
  sort_order: number;
  is_active: boolean;
  display_order: number;
  auto_recall_seconds: number | null;
}

// ============================================================
// Root page
// ============================================================

export default function KitchenSettingsPage() {
  const { activeLocation } = useAuth();

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-1">No hay un local seleccionado</h2>
        <p className="text-muted-foreground">
          Seleccioná un local para administrar la configuración de cocina.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* ---- header ---- */}
      <div>
        <h1 className="font-display text-2xl flex items-center gap-2">
          <ChefHat className="h-6 w-6 text-primary" />
          Rutas de cocina
        </h1>
        <p className="text-muted-foreground text-sm mt-0.5">
          Configurá qué estación recibe cada categoría o producto de{' '}
          <strong>{activeLocation.name}</strong>.
        </p>
      </div>

      {/* ---- tabs ---- */}
      <Tabs defaultValue="stations" className="space-y-4">
        <TabsList>
          <TabsTrigger value="stations" className="gap-1.5">
            <Settings2 className="h-4 w-4" />
            Estaciones
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-1.5">
            <Tag className="h-4 w-4" />
            Rutas por categoría
          </TabsTrigger>
          <TabsTrigger value="items" className="gap-1.5">
            <Utensils className="h-4 w-4" />
            Rutas por producto
          </TabsTrigger>
          <TabsTrigger value="groups" className="gap-1.5">
            <Layers className="h-4 w-4" />
            Grupos de pantallas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="stations">
          <StationsTab locationId={activeLocation.id} />
        </TabsContent>
        <TabsContent value="categories">
          <CategoryRoutingTab locationId={activeLocation.id} />
        </TabsContent>
        <TabsContent value="items">
          <ItemRoutingTab locationId={activeLocation.id} />
        </TabsContent>
        <TabsContent value="groups">
          <DisplayGroupsTab locationId={activeLocation.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ============================================================
// Shared helpers
// ============================================================

function LoadingSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 rounded-md bg-muted animate-pulse" />
      ))}
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
      {message}
    </div>
  );
}

function EmptyState({ icon: Icon, label, action }: { icon: LucideIcon; label: string; action?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center">
      <Icon className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
      <p className="font-medium">{label}</p>
      {action}
    </div>
  );
}

// ============================================================
// Tab 1 — Stations
// ============================================================

function StationsTab({ locationId }: { locationId: string }) {
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<KitchenStation | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<KitchenStation | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setStations(await fetchStations(locationId));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las estaciones.');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // load() is fully try/catch/finally-wrapped above — safe fire-and-forget.
  useEffect(() => { void load(); }, [load]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (s: KitchenStation) => { setEditing(s); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async (payload: { name: string; sort_order: number | null }) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updateStation(editing.id, payload);
      } else {
        await createStation({ ...payload, location_id: locationId });
      }
      await load();
      closeSheet();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar la estación.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteStation(toDelete.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo eliminar la estación.'); }
    finally { setToDelete(null); }
  };

  const toggleActive = async (station: KitchenStation) => {
    try {
      await updateStation(station.id, { is_active: !station.is_active });
      await load();
    } catch (e) { alert(e instanceof Error ? e.message : 'No se pudo actualizar la estación.'); }
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Nueva estación
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && stations.length === 0 && (
        <EmptyState
          icon={Settings2}
          label="Todavía no hay estaciones"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> Nueva estación
            </Button>
          }
        />
      )}

      {!loading && stations.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Orden</TableHead>
                <TableHead className="text-center">Activo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {stations.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm">{s.sort_order ?? '—'}</TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={s.is_active ?? true}
                      onCheckedChange={() => toggleActive(s)}
                      aria-label="Cambiar estado activo"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(s)} title="Editar">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(s)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Editar estación' : 'Nueva estación'}</SheetTitle>
            <SheetDescription>
              {editing ? `Actualizá “${editing.name}”` : 'Agregá una estación de cocina para este local.'}
            </SheetDescription>
          </SheetHeader>
          <StationForm initial={editing} onSubmit={handleSubmit} onCancel={closeSheet} saving={saving} />
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={Boolean(toDelete)} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar estación?</AlertDialogTitle>
            <AlertDialogDescription>
              Se eliminará “{toDelete?.name}”. Las rutas existentes que usan esta estación quedarán sin asignar.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} variant="destructive">
              Eliminar estación
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function StationForm({ initial, onSubmit, onCancel, saving }: {
  initial?: KitchenStation | null;
  onSubmit: (payload: { name: string; sort_order: number | null }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [sortOrder, setSortOrder] = useState<number | string>(initial?.sort_order ?? '');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      sort_order: sortOrder !== '' ? Number(sortOrder) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="st-name">Nombre de la estación</Label>
        <Input
          id="st-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Por ejemplo, Parrilla, Fríos, Frituras"
          required
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="st-order">Orden en pantalla</Label>
        <Input
          id="st-order"
          type="number"
          value={sortOrder}
          onChange={(e) => setSortOrder(e.target.value)}
          placeholder="0"
          min={0}
        />
      </div>
      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !name.trim()} className="flex-1">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initial ? 'Guardar cambios' : 'Crear estación'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

// ============================================================
// Tab 2 — Category routes
// ============================================================

function CategoryRoutingTab({ locationId }: { locationId: string }) {
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [categories, setCategories] = useState<CategoryLite[]>([]);
  const [routings, setRoutings] = useState<CategoryRouting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRouting | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<CategoryRouting | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, c, r] = await Promise.all([
        fetchStations(locationId),
        fetchCategories(locationId),
        fetchCategoryRoutings(locationId),
      ]);
      setStations(s);
      setCategories(c);
      setRoutings(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las rutas por categoría.');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // load() is fully try/catch/finally-wrapped above — safe fire-and-forget.
  useEffect(() => { void load(); }, [load]);

  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);
  const categoryById = useMemo(() => Object.fromEntries(categories.map((c) => [c.id, c])), [categories]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (r: CategoryRouting) => { setEditing(r); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async ({ categoryId, stationId }: { categoryId: string; stationId: string | null }) => {
    setSaving(true);
    try {
      await setCategoryRouting(locationId, categoryId, stationId);
      await load();
      closeSheet();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar la ruta por categoría.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteCategoryRouting(toDelete.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo eliminar la ruta por categoría.'); }
    finally { setToDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Enviá todos los productos de una categoría a una estación específica.
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Agregar ruta
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && routings.length === 0 && (
        <EmptyState
          icon={Tag}
          label="Todavía no hay rutas por categoría"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> Agregar ruta
            </Button>
          }
        />
      )}

      {!loading && routings.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Categoría</TableHead>
                <TableHead>Estación</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routings.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {categoryById[r.category_id]?.name ?? <span className="italic text-muted-foreground">{r.category_id?.slice(0, 8)}</span>}
                  </TableCell>
                  <TableCell>
                    {stationById[r.station_id]
                      ? <Badge variant="outline" className="border-primary/40 text-primary">{stationById[r.station_id].name}</Badge>
                      : <span className="italic text-muted-foreground">{r.station_id?.slice(0, 8)}</span>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(r)} title="Editar">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(r)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Editar ruta por categoría' : 'Agregar ruta por categoría'}</SheetTitle>
            <SheetDescription>Asociá una categoría del menú con una estación de cocina.</SheetDescription>
          </SheetHeader>
          <RoutingForm
            initial={editing}
            stations={stations}
            sourceItems={categories}
            sourceLabel="Categoría"
            sourceKey="categoryId"
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      {/* Delete confirm */}
      <DeleteConfirm
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="¿Eliminar ruta por categoría?"
        description={`Se eliminará la ruta de “${(toDelete && categoryById[toDelete.category_id]?.name) ?? toDelete?.category_id}”.`}
        onConfirm={confirmDelete}
        variant="warning"
        confirmLabel="Eliminar ruta"
      />
    </div>
  );
}

// ============================================================
// Tab 3 — Item routes
// ============================================================

function ItemRoutingTab({ locationId }: { locationId: string }) {
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [items, setItems] = useState<ItemLite[]>([]);
  const [routings, setRoutings] = useState<ItemRoutingRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<ItemRoutingRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<ItemRoutingRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, it, r] = await Promise.all([
        fetchStations(locationId),
        fetchItems(locationId),
        fetchItemRoutings(locationId),
      ]);
      setStations(s);
      setItems(it);
      setRoutings(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las rutas por producto.');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // load() is fully try/catch/finally-wrapped above — safe fire-and-forget.
  useEffect(() => { void load(); }, [load]);

  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);
  const itemById = useMemo(() => Object.fromEntries(items.map((it) => [it.id, it])), [items]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (r: ItemRoutingRow) => { setEditing(r); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async ({ categoryId: itemId, stationId }: { categoryId: string; stationId: string | null }) => {
    // RoutingForm uses categoryId key generically; here it maps to itemId
    setSaving(true);
    try {
      await setItemRouting(locationId, itemId, stationId);
      await load();
      closeSheet();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar la ruta por producto.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteItemRouting(toDelete.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo eliminar la ruta por producto.'); }
    finally { setToDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Las rutas por producto tienen prioridad sobre las rutas por categoría.
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Agregar ruta
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && routings.length === 0 && (
        <EmptyState
          icon={Utensils}
          label="Todavía no hay rutas por producto"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> Agregar ruta
            </Button>
          }
        />
      )}

      {!loading && routings.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Producto</TableHead>
                <TableHead>Estación</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {routings.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">
                    {itemById[r.item_id]?.name ?? <span className="italic text-muted-foreground">{r.item_id?.slice(0, 8)}</span>}
                  </TableCell>
                  <TableCell>
                    {stationById[r.station_id]
                      ? <Badge variant="outline" className="border-primary/40 text-primary">{stationById[r.station_id].name}</Badge>
                      : <span className="italic text-muted-foreground">{r.station_id?.slice(0, 8)}</span>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(r)} title="Editar">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(r)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Editar ruta por producto' : 'Agregar ruta por producto'}</SheetTitle>
            <SheetDescription>Elegí qué estación recibe un producto específico del menú.</SheetDescription>
          </SheetHeader>
          <RoutingForm
            initial={editing
              ? { ...editing, category_id: editing.item_id } // normalise key for generic form
              : null
            }
            stations={stations}
            sourceItems={items}
            sourceLabel="Producto"
            sourceKey="categoryId"
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      <DeleteConfirm
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="¿Eliminar ruta por producto?"
        description={`Se eliminará la ruta de “${(toDelete && itemById[toDelete.item_id]?.name) ?? toDelete?.item_id}”.`}
        onConfirm={confirmDelete}
        variant="warning"
        confirmLabel="Eliminar ruta"
      />
    </div>
  );
}

// ---- Generic routing form (shared by category + item tabs) ------------------

/**
 * @param {{ initial, stations, sourceItems, sourceLabel, sourceKey, onSubmit, onCancel, saving }}
 * sourceKey is the field name emitted in the onSubmit payload (always 'categoryId' for generics).
 */
interface RoutingFormInitial {
  category_id?: string;
  station_id?: string;
}

function RoutingForm({ initial, stations, sourceItems, sourceLabel, sourceKey, onSubmit, onCancel, saving }: {
  initial?: RoutingFormInitial | null;
  stations: KitchenStation[];
  sourceItems: { id: string; name: string }[];
  sourceLabel: string;
  sourceKey: string;
  onSubmit: (payload: { categoryId: string; stationId: string }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [sourceId, setSourceId] = useState(initial?.category_id ?? '');
  const [stationId, setStationId] = useState(initial?.station_id ?? '');

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({ [sourceKey]: sourceId, stationId } as { categoryId: string; stationId: string });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label>{sourceLabel}</Label>
        <Select value={sourceId} onValueChange={setSourceId} required>
          <SelectTrigger>
            <SelectValue placeholder={`Seleccioná ${sourceLabel.toLowerCase()}…`} />
          </SelectTrigger>
          <SelectContent>
            {sourceItems.map((it) => (
              <SelectItem key={it.id} value={it.id}>{it.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-1.5">
        <Label>Estación</Label>
        <Select value={stationId} onValueChange={setStationId} required>
          <SelectTrigger>
            <SelectValue placeholder="Seleccioná una estación…" />
          </SelectTrigger>
          <SelectContent>
            {stations.filter((s) => s.is_active !== false).map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !sourceId || !stationId} className="flex-1">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initial ? 'Guardar cambios' : 'Agregar ruta'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

// ============================================================
// Tab 4 — Display groups
// ============================================================

interface DisplayGroupPayload {
  name: string;
  station_ids: string[];
  display_order: number | null;
  auto_recall_seconds: number | null;
}

function DisplayGroupsTab({ locationId }: { locationId: string }) {
  const [stations, setStations] = useState<KitchenStation[]>([]);
  const [groups, setGroups] = useState<DisplayGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DisplayGroup | null>(null);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<DisplayGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [s, g] = await Promise.all([
        fetchStations(locationId),
        fetchDisplayGroups(locationId),
      ]);
      setStations(s);
      setGroups(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar los grupos de pantallas.');
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // load() is fully try/catch/finally-wrapped above — safe fire-and-forget.
  useEffect(() => { void load(); }, [load]);

  const stationById = useMemo(() => Object.fromEntries(stations.map((s) => [s.id, s])), [stations]);

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (g: DisplayGroup) => { setEditing(g); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async (payload: DisplayGroupPayload) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updateDisplayGroup(editing.id, payload as unknown as Record<string, unknown>);
      } else {
        await createDisplayGroup({ ...payload, location_id: locationId });
      }
      await load();
      closeSheet();
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo guardar el grupo de pantallas.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!toDelete) return;
    try { await deleteDisplayGroup(toDelete.id); await load(); }
    catch (e) { alert(e instanceof Error ? e.message : 'No se pudo eliminar el grupo de pantallas.'); }
    finally { setToDelete(null); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Agrupá varias estaciones en una sola pantalla con recuperación automática opcional.
        </p>
        <Button onClick={openNew} className="gap-2">
          <Plus className="h-4 w-4" />
          Nuevo grupo
        </Button>
      </div>

      {error && <ErrorBanner message={error} />}
      {loading && <LoadingSkeleton />}

      {!loading && groups.length === 0 && (
        <EmptyState
          icon={Layers}
          label="Todavía no hay grupos de pantallas"
          action={
            <Button variant="outline" onClick={openNew} className="mt-3 gap-2">
              <Plus className="h-4 w-4" /> Nuevo grupo
            </Button>
          }
        />
      )}

      {!loading && groups.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Estaciones</TableHead>
                <TableHead>Orden</TableHead>
                <TableHead>Recuperación automática</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {(Array.isArray(g.station_ids) ? g.station_ids : []).map((sid) => (
                        <Badge key={sid} variant="outline" className="border-primary/40 text-primary text-xs">
                          {stationById[sid]?.name ?? sid.slice(0, 8)}
                        </Badge>
                      ))}
                      {(!g.station_ids || g.station_ids.length === 0) && (
                        <span className="italic text-muted-foreground text-sm">ninguna</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">{g.display_order ?? '—'}</TableCell>
                  <TableCell className="text-sm">
                    {g.auto_recall_seconds
                      ? <span className="flex items-center gap-1 text-success tabular-nums"><RotateCcw className="h-3.5 w-3.5" />{g.auto_recall_seconds}s</span>
                      : <span className="text-muted-foreground">desactivado</span>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => openEdit(g)} title="Editar">
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="h-8 w-8 p-0 text-destructive hover:text-destructive" onClick={() => setToDelete(g)} title="Eliminar">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="sm:max-w-md overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>{editing ? 'Editar grupo de pantallas' : 'Nuevo grupo de pantallas'}</SheetTitle>
            <SheetDescription>
              {editing ? `Actualizá “${editing.name}”` : 'Creá una vista de cocina que agrupe varias estaciones.'}
            </SheetDescription>
          </SheetHeader>
          <DisplayGroupForm
            initial={editing}
            stations={stations}
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      <DeleteConfirm
        open={Boolean(toDelete)}
        onOpenChange={(v) => !v && setToDelete(null)}
        title="¿Eliminar grupo de pantallas?"
        description={`“${toDelete?.name}” se eliminará definitivamente.`}
        onConfirm={confirmDelete}
        variant="destructive"
        confirmLabel="Eliminar grupo"
      />
    </div>
  );
}

function DisplayGroupForm({ initial, stations, onSubmit, onCancel, saving }: {
  initial?: DisplayGroup | null;
  stations: KitchenStation[];
  onSubmit: (payload: DisplayGroupPayload) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [displayOrder, setDisplayOrder] = useState<number | string>(initial?.display_order ?? '');
  const [autoRecall, setAutoRecall] = useState<number | string>(initial?.auto_recall_seconds ?? '');
  // station_ids is an array; use a Set for toggle UX
  const [selectedStations, setSelectedStations] = useState<Set<string>>(
    new Set(Array.isArray(initial?.station_ids) ? initial.station_ids : [])
  );

  const toggleStation = (id: string) => {
    setSelectedStations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    onSubmit({
      name: name.trim(),
      station_ids: [...selectedStations],
      display_order: displayOrder !== '' ? Number(displayOrder) : null,
      auto_recall_seconds: autoRecall !== '' ? Number(autoRecall) : null,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="dg-name">Nombre del grupo</Label>
        <Input
          id="dg-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Por ejemplo, Calientes, Fríos y ensaladas"
          required
        />
      </div>

      <div className="space-y-2">
        <Label>Estaciones de este grupo</Label>
        {stations.length === 0 && (
          <p className="text-sm text-muted-foreground italic">Todavía no hay estaciones configuradas.</p>
        )}
        <div className="space-y-1.5">
          {stations.map((s) => (
            <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2 hover:bg-accent">
              <input
                type="checkbox"
                className="accent-primary"
                checked={selectedStations.has(s.id)}
                onChange={() => toggleStation(s.id)}
              />
              <span className="text-sm font-medium">{s.name}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dg-order">Orden en pantalla</Label>
        <Input
          id="dg-order"
          type="number"
          value={displayOrder}
          onChange={(e) => setDisplayOrder(e.target.value)}
          placeholder="0"
          min={0}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="dg-recall">Recuperar después de (segundos; vacío = desactivado)</Label>
        <Input
          id="dg-recall"
          type="number"
          value={autoRecall}
          onChange={(e) => setAutoRecall(e.target.value)}
          placeholder="Por ejemplo, 300"
          min={0}
        />
        <p className="text-xs text-muted-foreground">
          Las comandas completadas de este grupo reaparecen automáticamente después de estos segundos.
        </p>
      </div>

      <div className="flex gap-2 pt-2">
        <Button type="submit" disabled={saving || !name.trim()} className="flex-1">
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {initial ? 'Guardar cambios' : 'Crear grupo'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancelar</Button>
      </div>
    </form>
  );
}

// ============================================================
// Shared DeleteConfirm dialog
// ============================================================

// `variant` defaults to "warning" — most call sites here remove a single
// routing link (category route / item route), which is trivially re-added
// from the same tab and doesn't cascade or destroy other config. Call sites
// that delete a whole named config object (display group) or something that
// orphans other records (station) should pass variant="destructive".
function DeleteConfirm({ open, onOpenChange, title, description, onConfirm, variant = 'warning', confirmLabel = 'Eliminar' }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  onConfirm: () => void;
  variant?: 'warning' | 'destructive';
  confirmLabel?: string;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            variant={variant}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
