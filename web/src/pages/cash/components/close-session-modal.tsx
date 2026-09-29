import { useState, type FormEvent } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { DenominationGrid } from './denomination-grid';
import { api } from '@/lib/api-client';
import { useMoney } from '@/context/locale-context';
import { cn } from '@/lib/utils';
import { Loader2, LockKeyhole, CheckCircle2, AlertTriangle, AlertOctagon } from 'lucide-react';
import type { CashSession } from '../index';

interface CloseSessionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: CashSession;
  staffId: string;
  expectedCents: number;
  onClosed?: (closedSession: CashSession) => void;
}

export function CloseSessionModal({
  open,
  onOpenChange,
  session,
  staffId,
  expectedCents,
  onClosed,
}: CloseSessionModalProps) {
  const { format, parse, symbol, scale, decimals } = useMoney();
  const [denomCounts, setDenomCounts] = useState<Record<string, number>>({});
  const [denomTotalCents, setDenomTotalCents] = useState(0);
  const [useDenomsForTotal, setUseDenomsForTotal] = useState(false);
  const [manualCents, setManualCents] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isBlind = session?.is_blind_close ?? false;
  const declaredCents = useDenomsForTotal ? denomTotalCents : parse(manualCents) ?? 0;
  const hasExpected = !isBlind && typeof expectedCents === 'number';
  const discrepancyCents = hasExpected ? declaredCents - expectedCents : 0;
  const absDiscrepancyCents = Math.abs(discrepancyCents);
  const smallVarianceCents = scale * 5;
  const varianceLevel = !hasExpected
    ? null
    : absDiscrepancyCents === 0
      ? 'balanced'
      : absDiscrepancyCents <= smallVarianceCents
        ? 'warning'
        : 'destructive';

  const handleDenomChange = (counts: Record<string, number>, totalCents: number) => {
    setDenomCounts(counts);
    setDenomTotalCents(totalCents);
  };

  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!session?.id) return;

    setSubmitting(true);
    try {
      const { data, error: apiErr } = await api.request<CashSession>(
        'POST',
        `/cash-drawers/sessions/${session.id}/close`,
        {
          body: {
            closed_by_staff_id: staffId || '',
            declared_closing_cents: declaredCents,
            denominations: denomCounts,
            notes,
          },
        },
      );
      if (apiErr) throw new Error(apiErr.message);
      onOpenChange(false);
      if (data) onClosed?.(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo cerrar la caja.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LockKeyhole className="h-5 w-5 text-destructive" />
            Cerrar caja
          </DialogTitle>
          {!isBlind && (
            <DialogDescription>
              Saldo esperado: <span className="tabular-nums">{format(expectedCents)}</span>
            </DialogDescription>
          )}
          {isBlind && (
            <DialogDescription>
              Cierre ciego: contá el efectivo sin ver el importe esperado.
            </DialogDescription>
          )}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 pt-2">
          <div className="flex items-center gap-3">
            <Switch
              id="use-denoms"
              checked={useDenomsForTotal}
              onCheckedChange={setUseDenomsForTotal}
            />
            <Label htmlFor="use-denoms" className="cursor-pointer">
              Contar por denominación
            </Label>
          </div>

          {useDenomsForTotal ? (
            <DenominationGrid counts={denomCounts} onChange={handleDenomChange} />
          ) : (
            <div className="space-y-1">
              <Label htmlFor="declared-amount">Efectivo contado ({symbol})</Label>
              <input
                id="declared-amount"
                type="number"
                min="0"
                step={(1 / scale).toFixed(decimals)}
                placeholder={(0).toFixed(decimals)}
                value={manualCents}
                onChange={(e) => setManualCents(e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring md:text-sm"
              />
            </div>
          )}

          <div className="flex justify-between text-sm rounded-md bg-muted px-3 py-2">
            <span className="text-muted-foreground">Total contado</span>
            <span className="font-semibold tabular-nums">{format(declaredCents)}</span>
          </div>

          {hasExpected && (
            <div
              role="status"
              className={cn(
                'flex items-center justify-between gap-3 rounded-lg border-2 px-4 py-3',
                varianceLevel === 'balanced' && 'border-success/30 bg-success/10',
                varianceLevel === 'warning' && 'border-warning/30 bg-warning/10',
                varianceLevel === 'destructive' && 'border-destructive/30 bg-destructive/10',
              )}
            >
              <div>
                <p
                  className={cn(
                    'text-xs font-semibold uppercase tracking-wide',
                    varianceLevel === 'balanced' && 'text-success',
                    varianceLevel === 'warning' && 'text-warning',
                    varianceLevel === 'destructive' && 'text-destructive',
                  )}
                >
                  {varianceLevel === 'balanced' ? 'Cuadra' : discrepancyCents > 0 ? 'Sobra' : 'Falta'}
                </p>
                <p
                  className={cn(
                    'font-display text-2xl font-bold tabular-nums leading-tight',
                    varianceLevel === 'balanced' && 'text-success',
                    varianceLevel === 'warning' && 'text-warning',
                    varianceLevel === 'destructive' && 'text-destructive',
                  )}
                >
                  {varianceLevel === 'balanced'
                    ? format(0)
                    : `${discrepancyCents > 0 ? '+' : '-'}${format(absDiscrepancyCents)}`}
                </p>
                {varianceLevel === 'destructive' && (
                  <p className="text-xs text-destructive/80 mt-0.5">
                    La diferencia es importante. Agregá una nota para explicarla.
                  </p>
                )}
              </div>
              {varianceLevel === 'balanced' && <CheckCircle2 className="h-7 w-7 text-success flex-shrink-0" aria-hidden="true" />}
              {varianceLevel === 'warning' && <AlertTriangle className="h-7 w-7 text-warning flex-shrink-0" aria-hidden="true" />}
              {varianceLevel === 'destructive' && <AlertOctagon className="h-7 w-7 text-destructive flex-shrink-0" aria-hidden="true" />}
            </div>
          )}

          <div className="space-y-1">
            <Label htmlFor="close-notes">Notas (opcional)</Label>
            <Textarea
              id="close-notes"
              placeholder="Dejá un comentario sobre este cierre…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
            />
          </div>

          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
              Volver
            </Button>
            <Button type="submit" variant={varianceLevel === 'destructive' ? 'destructive' : 'default'} disabled={submitting}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Confirmar cierre
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
