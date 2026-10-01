// schedule-list.tsx — left-rail list of menu schedules + "New schedule" dialog.

import { useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { Plus, Trash2, Clock, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { MenuSchedule, CreateScheduleInput } from '../hooks/use-schedules';

interface ScheduleListProps {
  schedules: MenuSchedule[];
  selectedId?: string;
  onSelect: (schedule: MenuSchedule) => void;
  onDelete: (id: string) => Promise<void>;
  onCreate: (form: CreateScheduleInput) => Promise<void>;
  loading: boolean;
}

export default function ScheduleList({ schedules, selectedId, onSelect, onDelete, onCreate, loading }: ScheduleListProps) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CreateScheduleInput>({ name: '', code: '', description: '' });
  const [formError, setFormError] = useState('');

  const handleOpen = () => {
    setForm({ name: '', code: '', description: '' });
    setFormError('');
    setOpen(true);
  };

  const handleNameChange = (e: ChangeEvent<HTMLInputElement>) => {
    const name = e.target.value;
    // auto-derive a slug from the name
    const code = name.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
    setForm((prev) => ({ ...prev, name, code }));
  };

  const handleCreate = async () => {
    if (!form.name.trim()) {
      setFormError('El nombre es obligatorio.');
      return;
    }
    if (!form.code.trim()) {
      setFormError('El código o slug es obligatorio.');
      return;
    }
    setSaving(true);
    setFormError('');
    try {
      await onCreate(form);
      setOpen(false);
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'No se pudo crear el horario.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (e: MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm('¿Eliminar este horario y todas sus franjas?')) return;
    try {
      await onDelete(id);
    } catch (e) {
      alert(e instanceof Error ? e.message : 'No se pudo eliminar el horario.');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* header */}
      <div className="flex items-center justify-between px-4 py-3 border-b">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wide">Horarios</h2>
        <Button size="sm" variant="ghost" onClick={handleOpen} className="h-7 w-7 p-0">
          <Plus className="h-4 w-4" />
        </Button>
      </div>

      {/* list */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="space-y-2 p-4">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-10 bg-muted rounded animate-pulse" />
            ))}
          </div>
        ) : schedules.length === 0 ? (
          <div className="p-4 text-center text-sm text-muted-foreground">
            <Clock className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            Todavía no hay horarios.
          </div>
        ) : (
          <ul className="py-1">
            {schedules.map((s) => (
              <li
                key={s.id}
                onClick={() => onSelect(s)}
                className={cn(
                  'group flex items-center justify-between px-4 py-2 cursor-pointer text-sm hover:bg-muted',
                  selectedId === s.id && 'bg-orange-50 border-r-2 border-orange-500 font-medium text-orange-700',
                )}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <span className="truncate">{s.name}</span>
                  {!s.is_active && (
                    <Badge variant="outline" className="text-xs text-muted-foreground border-border shrink-0">
                      inactivo
                    </Badge>
                  )}
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 text-red-400 hover:text-red-600 hover:bg-red-50 shrink-0"
                  onClick={(e) => handleDelete(e, s.id)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* new schedule dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-orange-500" />
              Nuevo horario
            </DialogTitle>
            <DialogDescription>
              Creá una franja con nombre (por ejemplo, Desayuno o Promoción).
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            <div>
              <Label htmlFor="sched-name">Nombre *</Label>
              <Input
                id="sched-name"
                value={form.name}
                onChange={handleNameChange}
                placeholder="Ej. Desayuno"
              />
            </div>

            <div>
              <Label htmlFor="sched-code">Código / slug *</Label>
              <Input
                id="sched-code"
                value={form.code}
                onChange={(e) => setForm((p) => ({ ...p, code: e.target.value }))}
                placeholder="Ej. desayuno"
              />
              <p className="text-xs text-muted-foreground mt-1">Usá minúsculas, números y guiones bajos. Debe ser único en el local.</p>
            </div>

            <div>
              <Label htmlFor="sched-desc">Descripción</Label>
              <Input
                id="sched-desc"
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Descripción opcional"
              />
            </div>

            {formError && (
              <div className="flex items-center gap-2 text-sm text-red-600">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {formError}
              </div>
            )}

            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving} className="flex-1">
                Cancelar
              </Button>
              <Button onClick={handleCreate} disabled={saving} className="flex-1">
                {saving ? 'Creando…' : 'Crear'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
