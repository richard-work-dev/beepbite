import { useState, useEffect } from "react"
import { CreditCard, Loader2, AlertCircle, CheckCircle2 } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { cn } from "@/lib/utils"
import { useMoney } from "@/context/locale-context"

interface CardTenderModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  amountDueCents: number;
  submitting?: boolean;
  errorMessage?: string | null;
  onConfirm: (payload: { amountCents: number; reference: string }) => void;
}

export function CardTenderModal({
  open,
  onOpenChange,
  amountDueCents,
  submitting = false,
  errorMessage,
  onConfirm,
}: CardTenderModalProps) {
  const [reference, setReference] = useState("")
  const [confirmed, setConfirmed] = useState(false)
  const { format } = useMoney()

  // Reset internal state each time the modal opens
  useEffect(() => {
    if (open) {
      setReference("")
      setConfirmed(false)
    }
  }, [open])

  function handleConfirm() {
    if (!confirmed || submitting) return
    onConfirm({ amountCents: amountDueCents, reference: reference.trim() })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5 text-primary" />
            Pago con tarjeta
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-1">
          {/* Instruction */}
          <p className="text-sm text-muted-foreground">
            Procesá el pago en la terminal y confirmalo a continuación.
          </p>

          {/* Amount due — the number a cashier reads back to the terminal /
              customer, so it gets the biggest, boldest treatment on screen. */}
          <div className="rounded-xl border-2 border-primary/25 bg-primary/10 px-4 py-4 text-center">
            <p className="text-xs font-bold uppercase tracking-widest text-primary/80">
              Total a cobrar
            </p>
            <p className="mt-1 font-ticket text-5xl text-primary tabular-nums">
              {format(amountDueCents)}
            </p>
          </div>

          {/* Optional reference */}
          <div className="space-y-1.5">
            <Input
              id="card-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="Opcional: referencia de la terminal"
              maxLength={50}
              disabled={submitting}
            />
            <p className="text-xs text-muted-foreground">
              Ayuda a conciliar el pago con el resumen bancario.
            </p>
          </div>

          {/* Confirmation checkbox */}
          <label
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-lg border-2 p-3 transition-colors",
              confirmed
                ? "border-primary bg-primary/10"
                : "border-border bg-background hover:bg-muted/40",
              submitting && "pointer-events-none opacity-60"
            )}
          >
            <div
              role="checkbox"
              aria-checked={confirmed}
              tabIndex={0}
              onClick={() => !submitting && setConfirmed((v) => !v)}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault()
                  if (!submitting) setConfirmed((v) => !v)
                }
              }}
              className={cn(
                "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 transition-colors",
                confirmed
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/40"
              )}
            >
              {confirmed && <CheckCircle2 className="h-3.5 w-3.5" />}
            </div>
            <span className="text-sm leading-snug">
              Confirmo que la transacción fue aprobada en la terminal
            </span>
          </label>

          {/* Error alert */}
          {errorMessage && (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button
            variant="outline"
            size="touch"
            onClick={() => onOpenChange(false)}
            disabled={submitting}
            aria-label="Cancelar pago con tarjeta"
          >
            Cancelar
          </Button>
          <Button
            size="touch"
            onClick={handleConfirm}
            disabled={!confirmed || submitting}
            aria-label={submitting ? 'Procesando el pago con tarjeta' : 'Marcar el pago con tarjeta como pagado'}
            aria-busy={submitting}
            className="font-bold"
          >
            {submitting ? (
              <span className="flex items-center gap-1.5">
                <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
                Procesando…
              </span>
            ) : (
              "Marcar como pagado"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
