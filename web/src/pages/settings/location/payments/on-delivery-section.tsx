import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { useToast } from '@/hooks/use-toast';
import { Loader2 } from 'lucide-react';
import { api } from '@/lib/api-client';

interface OnDeliverySectionProps {
  locationId: string;
  initialMethods?: string[];
  initialTransferAccountHolder?: string;
  initialTransferAlias?: string;
  initialTransferCBU?: string;
  onMethodsChange?: (methods: string[]) => void;
}

/**
 * OnDeliverySection — "Payment on delivery" card in the payments settings page.
 */
export function OnDeliverySection({ locationId, initialMethods = [], initialTransferAccountHolder = '', initialTransferAlias = '', initialTransferCBU = '', onMethodsChange }: OnDeliverySectionProps) {
  const { toast } = useToast();

  const [acceptCash, setAcceptCash] = useState(initialMethods.includes('cash'));
  const [acceptCard, setAcceptCard] = useState(initialMethods.includes('card_machine'));
  const [acceptTransfer, setAcceptTransfer] = useState(initialMethods.includes('eft'));
  const [accountHolder, setAccountHolder] = useState(initialTransferAccountHolder);
  const [alias, setAlias] = useState(initialTransferAlias);
  const [cbu, setCbu] = useState(initialTransferCBU);
  const [saving, setSaving] = useState(false);

  // Keep checkboxes in sync if parent re-loads with new initialMethods
  React.useEffect(() => {
    setAcceptCash(initialMethods.includes('cash'));
    setAcceptCard(initialMethods.includes('card_machine'));
    setAcceptTransfer(initialMethods.includes('eft'));
  }, [initialMethods.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    setAccountHolder(initialTransferAccountHolder);
    setAlias(initialTransferAlias);
    setCbu(initialTransferCBU);
  }, [initialTransferAccountHolder, initialTransferAlias, initialTransferCBU]);

  async function handleSave() {
    const methods = [
      ...(acceptCash ? ['cash'] : []),
      ...(acceptCard ? ['card_machine'] : []),
      ...(acceptTransfer ? ['eft'] : []),
    ];
    const normalizedCBU = cbu.replace(/\D/g, '');
    if (acceptTransfer && (!accountHolder.trim() || (!alias.trim() && normalizedCBU.length !== 22))) {
      toast({ variant: 'destructive', title: 'Completá los datos para transferencias', description: 'Indicá el titular y un alias o CBU/CVU de 22 dígitos.' });
      return;
    }
    if (cbu.trim() && (!/^[\d\s-]+$/.test(cbu) || normalizedCBU.length !== 22)) {
      toast({ variant: 'destructive', title: 'Revisá el CBU/CVU', description: 'Debe tener 22 dígitos.' });
      return;
    }

    setSaving(true);
    try {
      const { error } = await api.request('PATCH', `/locations/${encodeURIComponent(locationId)}`, {
        body: {
          on_delivery_payment_methods: methods,
          transfer_account_holder: accountHolder.trim(),
          transfer_alias: alias.trim(),
          transfer_cbu: normalizedCBU,
        },
      });
      if (error) {
        toast({ variant: 'destructive', title: 'No se pudo guardar', description: error.message });
        return;
      }
      toast({ title: 'Medios de pago guardados.' });
      onMethodsChange?.(methods);
    } catch {
      toast({ variant: 'destructive', title: 'No se pudo conectar', description: 'Revisá tu conexión y volvé a intentar.' });
    } finally {
      setSaving(false);
    }
  }

  const dirty =
    acceptCash !== initialMethods.includes('cash') ||
    acceptCard !== initialMethods.includes('card_machine') ||
    acceptTransfer !== initialMethods.includes('eft') ||
    accountHolder !== initialTransferAccountHolder || alias !== initialTransferAlias || cbu !== initialTransferCBU;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Pagos de pedidos online</CardTitle>
        <p className="text-sm text-muted-foreground">
          Elegí qué medios vas a ofrecer en pedidos online. La transferencia se valida manualmente; el efectivo y la tarjeta se cobran al entregar o retirar.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Checkbox
              id="accept-cash"
              checked={acceptCash}
              onCheckedChange={(v) => setAcceptCash(Boolean(v))}
            />
            <Label htmlFor="accept-cash" className="cursor-pointer text-sm font-normal">
              Aceptar efectivo al entregar
            </Label>
          </div>

          <div className="flex items-center gap-3">
            <Checkbox
              id="accept-card"
              checked={acceptCard}
              onCheckedChange={(v) => setAcceptCard(Boolean(v))}
            />
            <Label htmlFor="accept-card" className="cursor-pointer text-sm font-normal">
              Aceptar tarjeta al entregar{' '}
              <span className="text-muted-foreground">(tengo un lector de tarjetas)</span>
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <Checkbox id="accept-transfer" checked={acceptTransfer} onCheckedChange={(v) => setAcceptTransfer(Boolean(v))} />
            <div className="space-y-1"><Label htmlFor="accept-transfer" className="cursor-pointer text-sm font-normal">Aceptar transferencia bancaria</Label><p className="text-xs text-muted-foreground">El cliente verá estos datos al finalizar. El pago se verifica manualmente.</p></div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border bg-muted/30 p-4">
          <div><p className="font-semibold text-sm">Datos para recibir transferencias</p><p className="text-xs text-muted-foreground">Se muestran solo a quien selecciona transferencia para su pedido.</p></div>
          <div className="space-y-2"><Label htmlFor="transfer-holder">Titular de la cuenta</Label><Input id="transfer-holder" maxLength={100} autoComplete="name" value={accountHolder} onChange={(event) => setAccountHolder(event.target.value)} placeholder="Nombre o razón social" /></div>
          <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor="transfer-alias">Alias</Label><Input id="transfer-alias" maxLength={40} autoCapitalize="none" value={alias} onChange={(event) => setAlias(event.target.value)} placeholder="mi.alias.banco" /></div><div className="space-y-2"><Label htmlFor="transfer-cbu">CBU / CVU (opcional)</Label><Input id="transfer-cbu" inputMode="numeric" maxLength={30} value={cbu} onChange={(event) => setCbu(event.target.value)} placeholder="22 dígitos" /></div></div>
          <p className="text-xs text-muted-foreground">Completá el titular y al menos un alias o CBU/CVU. BeepBite no procesa ni confirma automáticamente la transferencia.</p>
        </div>

        <Button
          size="sm"
          className="bg-orange-500 hover:bg-orange-600 text-white"
          onClick={handleSave}
          disabled={saving || !dirty}
        >
          {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
          Guardar
        </Button>
      </CardContent>
    </Card>
  );
}
