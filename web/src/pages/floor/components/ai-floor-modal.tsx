// AI floor-plan modal — describe a space in plain English, preview the
// proposed sections/tables, then apply them to the floor.
//
// Flow:
//   1. Owner types a description → Generate → backend returns a plan.
//   2. We render a non-destructive PREVIEW (sections + per-section table
//      counts, plus totals) so they can review before committing.
//   3. Apply to floor → confirm the plan → onApplied() so the parent reloads.
//
// The backend only ADDS to the layout; the existing one is preserved. The
// copy makes that explicit so owners aren't afraid of losing work.

import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { generateFloor, applyFloor } from '@/services/ai-floor';

const PLACEHOLDER =
  '20 mesas en total: 8 para dos, 8 para cuatro y 4 para seis; una barra con 6 banquetas y un patio con 4 mesas';

// Mirrors backend/internal/ai/floor.go FloorTable/FloorSection/FloorPlan.
interface AIFloorTable {
  label?: string;
  capacity?: number;
  x?: number;
  y?: number;
}

interface AIFloorSection {
  name?: string;
  tables?: AIFloorTable[];
}

interface AIFloorPlan {
  sections?: AIFloorSection[];
}

function planTotals(plan: AIFloorPlan | null) {
  const sections = Array.isArray(plan?.sections) ? plan.sections : [];
  let tables = 0;
  let seats = 0;
  for (const s of sections) {
    const ts = Array.isArray(s.tables) ? s.tables : [];
    tables += ts.length;
    for (const t of ts) seats += Number(t.capacity) || 0;
  }
  return { sectionCount: sections.length, tables, seats };
}

interface AIFloorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  locationId?: string;
  onApplied?: () => void;
}

export default function AIFloorModal({ open, onOpenChange, locationId, onApplied }: AIFloorModalProps) {
  const [description, setDescription] = useState('');
  const [plan, setPlan] = useState<AIFloorPlan | null>(null);
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset everything each time the dialog opens.
  useEffect(() => {
    if (open) {
      setDescription('');
      setPlan(null);
      setGenerating(false);
      setApplying(false);
      setError(null);
    }
  }, [open]);

  const totals = useMemo(() => (plan ? planTotals(plan) : null), [plan]);

  const handleGenerate = async () => {
    setError(null);
    if (!description.trim()) {
      setError('Describí primero el espacio del local.');
      return;
    }
    setGenerating(true);
    try {
      const { plan: next } = await generateFloor(locationId as string, description.trim());
      const nextPlan = (next as AIFloorPlan) || null;
      setPlan(nextPlan);
      if (!nextPlan?.sections?.length) {
        setError('No se propusieron secciones. Agregá más detalles a la descripción.');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    setError(null);
    setApplying(true);
    try {
      await applyFloor(locationId as string, plan);
      onOpenChange(false);
      if (typeof onApplied === 'function') onApplied();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const busy = generating || applying;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!busy) onOpenChange(v); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            Crear plano con IA
          </DialogTitle>
          <DialogDescription>
            Describí el espacio y vamos a proponer sectores y mesas. Solo se
            agregan elementos nuevos: tu plano actual se conserva.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="ai-floor-desc">Describí el espacio</Label>
            <Textarea
              id="ai-floor-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={PLACEHOLDER}
              rows={4}
              disabled={busy}
              aria-describedby="ai-floor-hint"
            />
            <p id="ai-floor-hint" className="mt-1 text-xs text-muted-foreground">
              Indicá cuántas mesas hay, cuántas personas admite cada una y si tenés barra, patio u otro sector.
            </p>
          </div>

          {plan && totals && (
            <div
              className="rounded-md border border-primary/25 bg-primary/5 p-3"
              aria-live="polite"
            >
              <p className="text-sm font-medium text-foreground flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                Vista previa — {totals.sectionCount} {totals.sectionCount === 1 ? 'sección' : 'secciones'},{' '}
                {totals.tables} {totals.tables === 1 ? 'mesa' : 'mesas'}, {totals.seats} {totals.seats === 1 ? 'lugar' : 'lugares'}
              </p>
              <ul className="mt-2 space-y-1">
                {(plan.sections || []).map((s, i) => {
                  const ts = Array.isArray(s.tables) ? s.tables : [];
                  const seats = ts.reduce((sum, t) => sum + (Number(t.capacity) || 0), 0);
                  return (
                    <li
                      key={`${s.name || 'section'}-${i}`}
                      className="flex items-center justify-between text-sm text-foreground/80"
                    >
                      <span className="font-medium">{s.name || `Sección ${i + 1}`}</span>
                      <span className="text-muted-foreground">
                        {ts.length} {ts.length === 1 ? 'mesa' : 'mesas'} · {seats} {seats === 1 ? 'lugar' : 'lugares'}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-2 text-xs text-muted-foreground">
                Revisá la propuesta y aplicala cuando estés conforme. Las mesas existentes no se mueven.
              </p>
            </div>
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </p>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          {!plan ? (
            <Button
              onClick={handleGenerate}
              disabled={busy || !description.trim()}
            >
              {generating ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-2" />
              )}
              Generar propuesta
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleGenerate} disabled={busy}>
                {generating ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Regenerar
              </Button>
              <Button
                onClick={handleApply}
                disabled={busy}
              >
                {applying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                Aplicar al salón
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
