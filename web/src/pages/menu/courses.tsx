// courses.tsx — CRUD UI for kitchen fire courses at the active location.
//
// Lives at /menu/courses (accessible from the main-layout app shell).
// Uses the generic REST data layer via `api.from('courses')`.
//
// Columns: id, location_id, name, sort_order, is_active,
//          fire_on_previous_course_bumped, created_at, updated_at.
//
// RLS on the `courses` table is location→org scoped so only members of the
// owning org can read / write.

import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import {
  ChefHat,
  Plus,
  Pencil,
  Trash2,
  AlertCircle,
  Loader2,
  ToggleRight,
  ToggleLeft,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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

import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { PageContainer, PageHeader } from '@/components/ui/page-header';

// Mirrors backend/migrations/001_baseline.sql `courses` table.
interface Course {
  id: string;
  location_id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  fire_on_previous_course_bumped: boolean;
  created_at?: string;
  updated_at?: string;
}

// Payload shape for create()/update() — location_id is added at the create()
// call site, not part of the form itself.
interface CourseInput {
  name: string;
  sort_order: number;
  fire_on_previous_course_bumped: boolean;
  is_active: boolean;
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

function useCourses(locationId: string | null) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(async () => {
    if (!locationId) { setCourses([]); return; }
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await api
        .from('courses')
        .select('*')
        .eq('location_id', locationId)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (err) throw new Error(err.message);
      setCourses(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [locationId]);

  // fetch() is fully try/catch/finally-wrapped above.
  useEffect(() => { void fetch(); }, [fetch]);

  const create = useCallback(async (body: CourseInput & { location_id: string }) => {
    const { data, error: err } = await api.from('courses').insert(body);
    if (err) throw new Error(err.message);
    await fetch();
    return data;
  }, [fetch]);

  const update = useCallback(async (id: string, body: Partial<CourseInput>) => {
    const { data, error: err } = await api
      .from('courses').update(body).eq('id', id);
    if (err) throw new Error(err.message);
    await fetch();
    return data;
  }, [fetch]);

  const remove = useCallback(async (id: string) => {
    const { error: err } = await api.from('courses').delete().eq('id', id);
    if (err) throw new Error(err.message);
    await fetch();
  }, [fetch]);

  return { courses, loading, error, refresh: fetch, create, update, remove };
}

// ---------------------------------------------------------------------------
// Form dialog
// ---------------------------------------------------------------------------

// Editable-form shape: sort_order becomes `string` while the <input> is
// being edited (raw text) and is parsed back to a number on submit — same
// pattern as menu/index.tsx's MenuFormData.
interface CourseForm {
  name: string;
  sort_order: number | string;
  fire_on_previous_course_bumped: boolean;
  is_active: boolean;
}

const EMPTY_FORM: CourseForm = {
  name: '',
  sort_order: 0,
  fire_on_previous_course_bumped: false,
  is_active: true,
};

interface CourseFormDialogProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (values: CourseInput) => void;
  initial: Course | null;
  submitting: boolean;
}

function CourseFormDialog({ open, onClose, onSubmit, initial, submitting }: CourseFormDialogProps) {
  const [form, setForm] = useState<CourseForm>(EMPTY_FORM);

  useEffect(() => {
    if (open) setForm(initial ? { ...initial } : EMPTY_FORM);
  }, [open, initial]);

  const set = <K extends keyof CourseForm>(key: K, value: CourseForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    onSubmit({
      name: form.name.trim(),
      sort_order: parseInt(String(form.sort_order), 10) || 0,
      fire_on_previous_course_bumped: Boolean(form.fire_on_previous_course_bumped),
      is_active: Boolean(form.is_active),
    });
  };

  const isEdit = Boolean(initial?.id);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? 'Editar tiempo' : 'Nuevo tiempo'}</DialogTitle>
          <DialogDescription>
            Los tiempos agrupan y envían las comandas a cocina por etapas (entrada → principal → postre).
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Nombre</label>
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="Ej.: Entrada, Principal, Postre"
              required
              autoFocus
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Orden</label>
            <Input
              type="number"
              value={form.sort_order}
              onChange={(e) => set('sort_order', e.target.value)}
              min={0}
              className="w-24"
            />
            <p className="text-xs text-muted-foreground">
              Los números menores salen primero. Entrada = 1, Principal = 2, Postre = 3.
            </p>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Enviar cuando termine el tiempo anterior</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Cuando cocina entrega el tiempo anterior, este se envía automáticamente.
              </p>
            </div>
            <Switch
              checked={Boolean(form.fire_on_previous_course_bumped)}
              onCheckedChange={(v) => set('fire_on_previous_course_bumped', v)}
            />
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">Activo</p>
              <p className="text-xs text-muted-foreground mt-0.5">Los tiempos inactivos no aparecen en el punto de venta.</p>
            </div>
            <Switch
              checked={Boolean(form.is_active)}
              onCheckedChange={(v) => set('is_active', v)}
            />
          </div>

          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={submitting || !form.name.trim()}
            >
              {submitting ? (
                <><Loader2 className="w-4 h-4 mr-1.5 animate-spin" /> Guardando…</>
              ) : (
                isEdit ? 'Guardar cambios' : 'Crear tiempo'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function CoursesPage() {
  const { activeLocation } = useAuth();
  const { toast } = useToast();
  const locationId = activeLocation?.id || null;

  const { courses, loading, error, create, update, remove } = useCourses(locationId);

  const [formOpen, setFormOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Course | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);

  const openCreate = () => { setEditTarget(null); setFormOpen(true); };
  const openEdit = (c: Course) => { setEditTarget(c); setFormOpen(true); };

  const handleSubmit = async (values: CourseInput) => {
    if (!locationId) return;
    setSubmitting(true);
    try {
      if (editTarget) {
        await update(editTarget.id, values);
        toast({ title: 'Tiempo actualizado' });
      } else {
        await create({ ...values, location_id: locationId });
        toast({ title: 'Tiempo creado' });
      }
      setFormOpen(false);
      setEditTarget(null);
    } catch (e) {
      toast({ variant: 'destructive', title: 'No se pudo guardar', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await remove(deleteTarget.id);
      toast({ title: `Se eliminó “${deleteTarget.name}”` });
    } catch (e) {
      toast({ variant: 'destructive', title: 'No se pudo eliminar', description: e instanceof Error ? e.message : String(e) });
    } finally {
      setDeleteTarget(null);
    }
  };

  const handleToggleActive = async (c: Course) => {
    try {
      await update(c.id, { is_active: !c.is_active });
    } catch (e) {
      toast({ variant: 'destructive', title: 'No se pudo actualizar', description: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <PageContainer className="max-w-3xl mx-auto">
      <PageHeader
        icon={ChefHat}
        title="Tiempos de cocina"
        description={`Gestioná la salida por etapas para ${activeLocation?.name || 'este local'}.`}
        actions={
          <Button onClick={openCreate} disabled={!locationId}>
            <Plus className="w-4 h-4 mr-1.5" />
            Agregar tiempo
          </Button>
        }
      />

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <AlertCircle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {!locationId && (
        <div className="rounded-lg border border-warning/20 bg-warning/10 px-4 py-3 text-sm text-warning">
          Seleccioná un local primero.
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="w-6 h-6 animate-spin mr-2" />
          Cargando tiempos…
        </div>
      ) : courses.length === 0 && locationId ? (
        <div className="text-center py-16 text-muted-foreground">
          <ChefHat className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm font-medium">Todavía no hay tiempos</p>
          <p className="text-xs mt-1">Agregá Entrada, Principal y Postre para organizar la salida por etapas.</p>
          <Button onClick={openCreate} variant="outline" className="mt-4 border-primary/25 text-primary">
            <Plus className="w-4 h-4 mr-1.5" /> Agregar primer tiempo
          </Button>
        </div>
      ) : courses.length > 0 ? (
        <div className="rounded-xl border border-border overflow-hidden">
          <Table>
            <TableHeader className="bg-muted">
              <TableRow>
                <TableHead className="w-10 text-center">#</TableHead>
                <TableHead>Nombre</TableHead>
                <TableHead className="text-center">Salida automática</TableHead>
                <TableHead className="text-center">Estado</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {courses.map((c) => (
                <TableRow key={c.id} className="hover:bg-primary/5">
                  <TableCell className="text-center text-sm text-muted-foreground tabular-nums font-medium">
                    {c.sort_order}
                  </TableCell>
                  <TableCell>
                    <span className="text-sm font-semibold text-foreground">{c.name}</span>
                  </TableCell>
                  <TableCell className="text-center">
                    {c.fire_on_previous_course_bumped ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
                        <ToggleRight className="w-3.5 h-3.5" /> Sí
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                        <ToggleLeft className="w-3.5 h-3.5" /> No
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-center">
                    <button
                      type="button"
                      onClick={() => handleToggleActive(c)}
                      className="focus:outline-none"
                      title={c.is_active ? 'Desactivar' : 'Activar'}
                    >
                      {c.is_active ? (
                        <Badge variant="outline" className="bg-success/10 text-success border-success/25 cursor-pointer hover:bg-success/20">
                          Activo
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="cursor-pointer hover:bg-muted">
                          Inactivo
                        </Badge>
                      )}
                    </button>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1 justify-end">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => openEdit(c)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                        title="Editar"
                        aria-label={`Editar ${c.name}`}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setDeleteTarget(c)}
                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                        title="Eliminar"
                        aria-label={`Eliminar ${c.name}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : null}

      {/* Form dialog */}
      <CourseFormDialog
        open={formOpen}
        onClose={() => { setFormOpen(false); setEditTarget(null); }}
        onSubmit={handleSubmit}
        initial={editTarget}
        submitting={submitting}
      />

      {/* Delete confirm */}
      <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar &quot;{deleteTarget?.name}&quot;?</AlertDialogTitle>
            <AlertDialogDescription>
              Esta acción elimina el tiempo. Los productos de pedidos anteriores conservarán su referencia histórica.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              variant="destructive"
            >
              Eliminar tiempo
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
