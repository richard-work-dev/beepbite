import { useState } from 'react';
import {
  MapPin,
  Plus,
  Edit,
  Trash2,
  AlertCircle,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
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

import { useAuth } from '@/context/auth-context';
import { useMoney } from '@/context/locale-context';
import { useToast } from '@/hooks/use-toast';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import { useDeliveryZones, type DeliveryZone } from './hooks/use-delivery-zones';
import ZoneForm from './components/zone-form';

// ---- page ----

export default function DeliveryZonesPage() {
  const { activeLocation, activeOrganization } = useAuth();
  const { toast } = useToast();
  const { format: fmtCents } = useMoney();

  const {
    zones,
    loading,
    error,
    createZone,
    updateZone,
    deleteZone,
    toggleActive,
  } = useDeliveryZones(activeLocation?.id);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editing, setEditing] = useState<DeliveryZone | null>(null); // null = new, obj = edit
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<DeliveryZone | null>(null);

  // ---- sheet actions ----

  const openNew = () => { setEditing(null); setSheetOpen(true); };
  const openEdit = (zone: DeliveryZone) => { setEditing(zone); setSheetOpen(true); };
  const closeSheet = () => { setSheetOpen(false); setEditing(null); };

  const handleSubmit = async (payload: Partial<DeliveryZone>) => {
    setSaving(true);
    try {
      if (editing?.id) {
        await updateZone(editing.id, payload);
      } else {
        await createZone(payload);
      }
      closeSheet();
      toast({ title: editing?.id ? 'Zona actualizada.' : 'Zona creada.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: err instanceof Error ? err.message : 'Error desconocido' });
    } finally {
      setSaving(false);
    }
  };

  // ---- delete ----

  const confirmDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteZone(toDelete.id);
      toast({ title: 'Zona desactivada.' });
    } catch (err) {
      toast({ variant: 'destructive', title: 'No se pudo desactivar', description: err instanceof Error ? err.message : 'Error desconocido' });
    } finally {
      setToDelete(null);
    }
  };

  // ---- no location guard ----

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="h-12 w-12 text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-1">No hay un local seleccionado</h2>
        <p className="text-muted-foreground">
          Seleccioná un local para administrar las zonas de entrega.
        </p>
      </div>
    );
  }

  return (
    <PageContainer>

      {/* Header */}
      <PageHeader
        eyebrow="Configuración"
        title="Zonas de entrega"
        description={`Definí las áreas de entrega, sus costos y tiempos estimados para ${activeLocation.name}.`}
        icon={MapPin}
        actions={
          <Button onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            Nueva zona
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-14 rounded-md bg-muted animate-pulse" />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && zones.length === 0 && (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-medium">Todavía no hay zonas de entrega</p>
          <p className="text-sm text-muted-foreground mb-4">
            Creá la primera zona para definir el área de cobertura.
          </p>
          <Button variant="outline" onClick={openNew} className="gap-2">
            <Plus className="h-4 w-4" />
            Nueva zona
          </Button>
        </div>
      )}

      {/* Table */}
      {!loading && zones.length > 0 && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[200px]">Nombre</TableHead>
                <TableHead>Fee</TableHead>
                <TableHead>Pedido mínimo</TableHead>
                <TableHead>ETA</TableHead>
                <TableHead>Prioridad</TableHead>
                <TableHead className="text-center">Activo</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {zones.map((zone) => (
                <TableRow key={zone.id}>
                  <TableCell className="font-medium">{zone.name}</TableCell>
                  <TableCell className="text-sm">
                    {zone.delivery_fee_cents === 0
                      ? <Badge variant="outline" className="text-green-700 border-green-400">Free</Badge>
                      : fmtCents(zone.delivery_fee_cents)
                    }
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {zone.min_order_cents > 0 ? fmtCents(zone.min_order_cents) : '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {zone.estimated_eta_minutes} min
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {zone.priority}
                  </TableCell>
                  <TableCell className="text-center">
                    <Switch
                      checked={zone.is_active}
                      onCheckedChange={() => toggleActive(zone)}
                      aria-label="Cambiar estado activo"
                    />
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0"
                        onClick={() => openEdit(zone)}
                        title="Editar"
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-destructive hover:text-destructive"
                        onClick={() => setToDelete(zone)}
                        title="Desactivar"
                      >
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

      {/* Create / Edit Sheet */}
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
          <SheetHeader className="mb-4">
            <SheetTitle>
              {editing ? 'Editar zona de entrega' : 'Nueva zona de entrega'}
            </SheetTitle>
            <SheetDescription>
              {editing
                ? `Actualizá “${editing.name}”`
                : 'Definí el área y el costo de la nueva zona de entrega.'}
            </SheetDescription>
          </SheetHeader>

          <ZoneForm
            initial={editing}
            locationId={activeLocation?.id}
            organizationId={activeOrganization?.id}
            location={activeLocation}
            onSubmit={handleSubmit}
            onCancel={closeSheet}
            saving={saving}
          />
        </SheetContent>
      </Sheet>

      {/* Delete / deactivate confirmation */}
      <AlertDialog open={Boolean(toDelete)} onOpenChange={(v) => !v && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Desactivar zona?</AlertDialogTitle>
            <AlertDialogDescription>
              "{toDelete?.name}" will be deactivated and hidden from delivery lookups.
              You can re-enable it later from the table.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Desactivar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
