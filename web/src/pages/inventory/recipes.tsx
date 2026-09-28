import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, ChefHat, PackageOpen, Search, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

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
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';

interface MenuItem {
  id: string;
  name: string;
  is_86ed?: boolean;
  auto_86_when_inventory_empty?: boolean;
}

interface InventoryItem {
  id: string;
  name: string;
  unit: string;
  current_stock: number;
  minimum_stock?: number;
  is_active?: boolean;
}

interface RecipeComponent {
  id: string;
  menu_item_id: string;
  inventory_item_id: string;
  quantity: number;
}

interface InventoryRecipesResponse {
  menu_items: MenuItem[];
  inventory_items: InventoryItem[];
  components: RecipeComponent[];
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat('es-AR', { maximumFractionDigits: 3 }).format(Number(value || 0));
}

export default function InventoryRecipesPage() {
  const { activeLocation } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [components, setComponents] = useState<RecipeComponent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const fetchRecipes = useCallback(async () => {
    if (!activeLocation?.id) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: requestError } = await api.request<InventoryRecipesResponse>(
        'GET',
        `/inventory/recipes?location_id=${encodeURIComponent(activeLocation.id)}`,
      );
      if (requestError) throw new Error(requestError.message);
      setMenuItems(data?.menu_items || []);
      setInventoryItems(data?.inventory_items || []);
      setComponents(data?.components || []);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'No se pudieron cargar las recetas de inventario.');
    } finally {
      setLoading(false);
    }
  }, [activeLocation?.id]);

  useEffect(() => { void fetchRecipes(); }, [fetchRecipes]);

  const componentsByMenuItem = useMemo(() => {
    const grouped = new Map<string, RecipeComponent[]>();
    components.forEach((component) => {
      const rows = grouped.get(component.menu_item_id) || [];
      rows.push(component);
      grouped.set(component.menu_item_id, rows);
    });
    return grouped;
  }, [components]);

  const inventoryByID = useMemo(
    () => new Map(inventoryItems.map((item) => [item.id, item])),
    [inventoryItems],
  );

  const filteredMenuItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('es');
    if (!needle) return menuItems;
    return menuItems.filter((item) => item.name.toLocaleLowerCase('es').includes(needle));
  }, [menuItems, search]);

  function openRecipe(item: MenuItem) {
    const next: Record<string, string> = {};
    (componentsByMenuItem.get(item.id) || []).forEach((component) => {
      next[component.inventory_item_id] = String(component.quantity);
    });
    setSelectedItem(item);
    setQuantities(next);
    setFormError('');
  }

  async function saveRecipe() {
    if (!selectedItem || !activeLocation?.id) return;
    const recipeComponents: Array<{ inventory_item_id: string; quantity: number }> = [];
    for (const item of inventoryItems) {
      const raw = quantities[item.id]?.trim();
      if (!raw) continue;
      const quantity = Number(raw.replace(',', '.'));
      if (!Number.isFinite(quantity) || quantity < 0) {
        setFormError(`La cantidad de ${item.name} debe ser cero o mayor.`);
        return;
      }
      if (quantity > 0) recipeComponents.push({ inventory_item_id: item.id, quantity });
    }
    setSaving(true);
    setFormError('');
    try {
      const { error: requestError } = await api.request(
        'PUT',
        `/inventory/recipes/${encodeURIComponent(selectedItem.id)}`,
        { body: { location_id: activeLocation.id, components: recipeComponents } },
      );
      if (requestError) throw new Error(requestError.message);
      setSelectedItem(null);
      await fetchRecipes();
      toast({
        title: recipeComponents.length > 0 ? 'Receta de inventario guardada' : 'Receta eliminada',
        description: recipeComponents.length > 0
          ? 'El stock se descontará automáticamente cuando el producto se envíe a cocina.'
          : 'Este producto ya no descontará insumos automáticamente.',
      });
    } catch (requestError) {
      setFormError(requestError instanceof Error ? requestError.message : 'No se pudo guardar la receta.');
    } finally {
      setSaving(false);
    }
  }

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="mb-4 size-12 text-muted-foreground" />
        <p className="text-muted-foreground">Seleccioná un local para gestionar sus recetas de inventario.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={ChefHat}
        title="Recetas de inventario"
        description="Definí cuánto insumo consume cada producto cuando se envía a cocina"
      />

      <Card className="border-primary/20 bg-primary/5">
        <CardContent className="flex flex-col gap-3 p-4 text-sm sm:flex-row sm:items-center sm:justify-between">
          <p>
            El descuento se registra una sola vez por pedido. Si falta stock, el producto se marca como agotado y el pedido no se envía.
          </p>
          <Button variant="outline" size="sm" onClick={() => navigate('/inventory/items')}>
            <PackageOpen className="mr-2 size-4" /> Gestionar insumos
          </Button>
        </CardContent>
      </Card>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar producto del menú…" className="pl-9" />
      </div>

      {error && (
        <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="size-4" /> {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((key) => <div key={key} className="h-40 animate-pulse rounded-lg bg-muted" />)}
        </div>
      ) : inventoryItems.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <PackageOpen className="mx-auto mb-3 size-12 text-muted-foreground" />
            <p className="text-muted-foreground">Primero creá los insumos que querés descontar con cada venta.</p>
            <Button className="mt-4" onClick={() => navigate('/inventory/items')}>Crear insumos</Button>
          </CardContent>
        </Card>
      ) : filteredMenuItems.length === 0 ? (
        <Card><CardContent className="p-10 text-center text-muted-foreground">No hay productos que coincidan con la búsqueda.</CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredMenuItems.map((menuItem) => {
            const recipe = componentsByMenuItem.get(menuItem.id) || [];
            const portions = recipe.length === 0
              ? null
              : Math.max(0, Math.floor(Math.min(...recipe.map((component) => {
                const inventoryItem = inventoryByID.get(component.inventory_item_id);
                return Number(inventoryItem?.current_stock || 0) / Number(component.quantity || 1);
              }))));
            const unavailable = recipe.length > 0 && portions === 0;
            return (
              <Card key={menuItem.id} variant="interactive">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-base">{menuItem.name}</CardTitle>
                    <Badge variant={recipe.length === 0 ? 'secondary' : unavailable ? 'destructive' : 'success'}>
                      {recipe.length === 0 ? 'Sin configurar' : unavailable ? 'Sin stock' : `${portions} porciones`}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {recipe.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Todavía no descuenta inventario.</p>
                  ) : (
                    <div className="space-y-1.5 text-sm">
                      {recipe.slice(0, 3).map((component) => {
                        const inventoryItem = inventoryByID.get(component.inventory_item_id);
                        return (
                          <div key={component.id} className="flex justify-between gap-3">
                            <span className="truncate text-muted-foreground">{inventoryItem?.name || 'Insumo'}</span>
                            <span className="shrink-0 tabular-nums">{formatQuantity(component.quantity)} {inventoryItem?.unit}</span>
                          </div>
                        );
                      })}
                      {recipe.length > 3 && <p className="text-xs text-muted-foreground">+ {recipe.length - 3} insumo(s)</p>}
                    </div>
                  )}
                  <Button size="sm" variant="outline" onClick={() => openRecipe(menuItem)}>
                    <Settings2 className="mr-1.5 size-4" /> {recipe.length > 0 ? 'Editar receta' : 'Configurar receta'}
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Dialog open={Boolean(selectedItem)} onOpenChange={(open) => { if (!open && !saving) setSelectedItem(null); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receta de {selectedItem?.name}</DialogTitle>
            <DialogDescription>
              Ingresá la cantidad consumida por una unidad vendida. Dejar el campo vacío o en cero excluye el insumo.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {formError && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{formError}</p>}
            <div className="space-y-2">
              {inventoryItems.map((item) => (
                <div key={item.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_11rem] sm:items-center">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Label htmlFor={`recipe-${item.id}`} className="font-medium">{item.name}</Label>
                      {item.is_active === false && <Badge variant="secondary">Inactivo</Badge>}
                    </div>
                    <p className="text-xs text-muted-foreground">Disponible: {formatQuantity(item.current_stock)} {item.unit}</p>
                  </div>
                  <div className="relative">
                    <Input
                      id={`recipe-${item.id}`}
                      type="number"
                      min="0"
                      step="0.001"
                      inputMode="decimal"
                      value={quantities[item.id] || ''}
                      onChange={(event) => setQuantities((current) => ({ ...current, [item.id]: event.target.value }))}
                      placeholder="0"
                      className="pr-16 text-right tabular-nums"
                    />
                    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">{item.unit}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row">
              <Button type="button" variant="outline" onClick={() => setSelectedItem(null)} className="flex-1" disabled={saving}>Cancelar</Button>
              <Button type="button" onClick={() => void saveRecipe()} className="flex-1" disabled={saving}>
                {saving ? 'Guardando…' : 'Guardar receta'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
