import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { AlertCircle, CookingPot, Download, Edit, PackageOpen, Plus, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

interface InventoryCatalogItem {
  id: string;
  location_id: string;
  name: string;
  unit: string;
  current_stock: number;
  minimum_stock: number;
  is_active?: boolean;
}

interface ItemForm {
  name: string;
  unit: string;
  minimum_stock: string;
  is_active: boolean;
}

const EMPTY_FORM: ItemForm = { name: '', unit: 'unidad', minimum_stock: '0', is_active: true };
const UNITS = ['unidad', 'kg', 'g', 'L', 'ml', 'paquete', 'caja', 'docena'];

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Number(value || 0));
}

export default function InventoryItemsPage() {
  const { activeLocation } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<InventoryCatalogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<InventoryCatalogItem | null>(null);
  const [form, setForm] = useState<ItemForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchItems = useCallback(async () => {
    if (!activeLocation?.id) return;
    setLoading(true);
    setError('');
    try {
      const query = `eq=location_id,${encodeURIComponent(activeLocation.id)}&order=name.asc`;
      const { data, error: requestError } = await api.request<InventoryCatalogItem[]>('GET', `/data/inventory_items?${query}`);
      if (requestError) throw new Error(requestError.message);
      setItems(data || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar los insumos');
    } finally {
      setLoading(false);
    }
  }, [activeLocation?.id]);

  useEffect(() => { void fetchItems(); }, [fetchItems]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es');
    if (!needle) return items;
    return items.filter((item) => item.name.toLocaleLowerCase('es').includes(needle));
  }, [items, search]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError('');
    setDialogOpen(true);
  }

  function openEdit(item: InventoryCatalogItem) {
    setEditing(item);
    setForm({
      name: item.name,
      unit: item.unit || 'unidad',
      minimum_stock: String(item.minimum_stock ?? 0),
      is_active: item.is_active !== false,
    });
    setFormError('');
    setDialogOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const minimum = Number(form.minimum_stock);
    if (!form.name.trim()) {
      setFormError('El nombre es obligatorio.');
      return;
    }
    if (!Number.isFinite(minimum) || minimum < 0) {
      setFormError('El stock mínimo debe ser cero o mayor.');
      return;
    }
    if (!activeLocation?.id) return;
    const duplicate = items.some((item) => item.id !== editing?.id && item.name.trim().toLocaleLowerCase('es') === form.name.trim().toLocaleLowerCase('es'));
    if (duplicate) {
      setFormError('Ya existe un insumo con ese nombre.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      const body = {
        location_id: activeLocation.id,
        name: form.name.trim(),
        unit: form.unit,
        minimum_stock: minimum,
        is_active: form.is_active,
        ...(editing ? {} : { current_stock: 0, cost_per_unit: 0 }),
      };
      const path = editing
        ? `/data/inventory_items?eq=id,${encodeURIComponent(editing.id)}`
        : '/data/inventory_items';
      const { error: requestError } = await api.request(editing ? 'PATCH' : 'POST', path, { body });
      if (requestError) throw new Error(requestError.message);
      setDialogOpen(false);
      setEditing(null);
      await fetchItems();
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'No se pudo guardar el insumo');
    } finally {
      setSaving(false);
    }
  }

  function exportInventory() {
    if (items.length === 0) return;
    const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
    const lines = [
      ['Insumo', 'Unidad', 'Stock actual', 'Stock mínimo', 'Estado'],
      ...items.map((item) => [
        item.name,
        item.unit,
        item.current_stock,
        item.minimum_stock,
        item.is_active === false ? 'Inactivo' : Number(item.current_stock) <= Number(item.minimum_stock || 0) ? 'Stock bajo' : 'Activo',
      ]),
    ].map((row) => row.map(escape).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${lines}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `beepbite-inventario-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="mb-4 size-12 text-muted-foreground" />
        <p className="text-muted-foreground">Seleccioná un local para gestionar sus insumos.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={PackageOpen}
        title="Insumos de inventario"
        description={`Productos que se contarán al abrir y cerrar ${activeLocation.name}`}
        actions={(
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportInventory} disabled={loading || items.length === 0}><Download className="mr-2 size-4" /> Descargar reporte</Button>
            <Button variant="outline" onClick={() => navigate('/inventory/recipes')}><CookingPot className="mr-2 size-4" /> Recetas</Button>
            <Button onClick={openCreate}><Plus className="mr-2 size-4" /> Nuevo insumo</Button>
          </div>
        )}
      />

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar insumos…" className="pl-9" />
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((key) => <div key={key} className="h-32 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <PackageOpen className="mx-auto mb-3 size-12 text-muted-foreground" />
            <p className="text-muted-foreground">{search ? 'Ningún insumo coincide con la búsqueda.' : 'Todavía no hay insumos. Creá el primero antes de abrir el inventario.'}</p>
            {!search && <Button onClick={openCreate} className="mt-4"><Plus className="mr-2 size-4" /> Nuevo insumo</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((item) => {
            const lowStock = Number(item.current_stock) <= Number(item.minimum_stock || 0);
            return (
              <Card key={item.id} variant="interactive">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{item.name}</CardTitle>
                    <Badge variant={item.is_active === false ? 'secondary' : lowStock ? 'warning' : 'success'}>
                      {item.is_active === false ? 'Inactivo' : lowStock ? 'Stock bajo' : 'Activo'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div><p className="text-xs text-muted-foreground">Stock actual</p><p className="font-semibold tabular-nums">{formatQuantity(item.current_stock)} {item.unit}</p></div>
                    <div><p className="text-xs text-muted-foreground">Stock mínimo</p><p className="font-semibold tabular-nums">{formatQuantity(item.minimum_stock)} {item.unit}</p></div>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openEdit(item)}><Edit className="mr-1 size-3" /> Editar</Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) setEditing(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar insumo' : 'Nuevo insumo'}</DialogTitle>
            <DialogDescription>
              {editing ? 'El stock actual se modifica mediante apertura, cierre o recepción de mercadería.' : 'El primer conteo de apertura establecerá el stock real.'}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && <p role="alert" className="text-sm text-destructive">{formError}</p>}
            <div className="space-y-1.5">
              <Label htmlFor="inventory-name">Nombre</Label>
              <Input id="inventory-name" value={form.name} onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} autoFocus required />
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="inventory-unit">Unidad de conteo</Label>
                <Select value={form.unit} onValueChange={(unit) => setForm((current) => ({ ...current, unit }))}>
                  <SelectTrigger id="inventory-unit"><SelectValue /></SelectTrigger>
                  <SelectContent>{UNITS.map((unit) => <SelectItem key={unit} value={unit}>{unit}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="minimum-stock">Stock mínimo</Label>
                <Input id="minimum-stock" type="number" min="0" step="0.001" inputMode="decimal" value={form.minimum_stock} onChange={(event) => setForm((current) => ({ ...current, minimum_stock: event.target.value }))} />
              </div>
            </div>
            {editing && (
              <label className="flex items-center gap-2 text-sm font-medium" htmlFor="inventory-active">
                <input id="inventory-active" type="checkbox" checked={form.is_active} onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} className="size-4" />
                Incluir en los conteos diarios
              </label>
            )}
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)} className="flex-1" disabled={saving}>Cancelar</Button>
              <Button type="submit" className="flex-1" disabled={saving}>{saving ? 'Guardando…' : editing ? 'Guardar cambios' : 'Crear insumo'}</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
