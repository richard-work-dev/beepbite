// stamps-config.tsx — owner-facing settings form for the stamp programme.
//
// Allows an org owner to:
//   • Toggle the stamp programme on / off
//   • Set how many stamps are required for a free item
//   • Optionally pin the programme to a specific qualifying item UUID
//
// Uses shadcn/ui form primitives consistent with the rest of the settings pages.

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { Stamp, Save, Loader2 } from 'lucide-react';

import { Button }   from '@/components/ui/button';
import { Input }    from '@/components/ui/input';
import { Label }    from '@/components/ui/label';
import { Switch }   from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader, PageContainer } from '@/components/ui/page-header';

import { getStampConfig, setStampConfig } from '@/services/loyalty-stamps';

// ---------------------------------------------------------------------------

const DEFAULT_REQUIRED = 10;

export default function StampsConfig() {
  const [loading, setLoading]   = useState(true);
  const [saving,  setSaving]    = useState(false);
  const [error,   setError]     = useState<string | null>(null);
  const [success, setSuccess]   = useState(false);

  const [enabled,  setEnabled]  = useState(false);
  const [required, setRequired] = useState<number | string>(DEFAULT_REQUIRED);
  const [itemId,   setItemId]   = useState('');

  // Load current config on mount.
  useEffect(() => {
    let cancelled = false;
    // getStampConfig() only wraps the API-error case in { data, error } —
    // a network-level failure (fetch() itself rejecting) throws instead.
    // Without this try/catch, that left the loyalty stamps settings page
    // stuck on its loading spinner forever with the rejection silently
    // swallowed.
    (async () => {
      try {
        const { data, error: err } = await getStampConfig();
        if (cancelled) return;
        if (err) {
          setError(err.message ?? 'No se pudo cargar la configuración de sellos');
        } else if (data) {
          setEnabled(data.stamps_enabled ?? false);
          setRequired(data.stamps_required ?? DEFAULT_REQUIRED);
          setItemId(data.stamp_item_id ?? '');
        }
      } catch (err) {
        console.error('Error loading stamp config:', err);
        if (!cancelled) setError('No se pudo cargar la configuración de sellos');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    const req = parseInt(String(required), 10);
    if (!req || req < 1) {
      setError('La cantidad de sellos debe ser un número positivo.');
      return;
    }

    setSaving(true);
    const { error: err } = await setStampConfig({
      stampsEnabled:  enabled,
      stampsRequired: req,
      stampItemId:    itemId.trim() || null,
    });
    setSaving(false);

    if (err) {
      setError(err.message ?? 'No se pudo guardar la configuración de sellos');
    } else {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 3000);
    }
  }

  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <PageContainer>
        <PageHeader
          eyebrow="Configuración"
          title="Fidelización"
          description="Premiá a tus clientes frecuentes con una tarjeta digital de sellos."
          icon={Stamp}
        />
        <div className="flex items-center gap-2 py-8 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Cargando configuración de sellos…</span>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        eyebrow="Configuración"
        title="Fidelización"
        description="Premiá a tus clientes frecuentes con una tarjeta digital de sellos."
        icon={Stamp}
      />
      <Card className="max-w-lg">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Stamp className="h-5 w-5 text-primary" />
          <CardTitle>Programa de sellos</CardTitle>
        </div>
        <CardDescription>
          Premiá a tus clientes con una tarjeta digital de “comprá N y recibí 1 gratis”.
          Los sellos se suman en el punto de venta y se reinician al obtener una recompensa.
        </CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSave} className="space-y-6">

          {/* Enabled toggle */}
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div>
              <p className="font-medium leading-none">Activar programa de sellos</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Los clientes obtienen un sello en las compras que cumplen las condiciones.
              </p>
            </div>
            <Switch
              checked={enabled}
              onCheckedChange={setEnabled}
              id="stamps-enabled"
              aria-label="Activar programa de sellos"
            />
          </div>

          {/* Stamps required */}
          <div className="space-y-2">
            <Label htmlFor="stamps-required">Sellos necesarios para el producto gratis</Label>
            <Input
              id="stamps-required"
              type="number"
              min={1}
              max={100}
              value={required}
              onChange={(e) => setRequired(e.target.value)}
              disabled={!enabled}
              className="w-32"
            />
            <p className="text-xs text-muted-foreground">
              Al completar esta cantidad, el contador del cliente se reinicia y se entrega la recompensa.
            </p>
          </div>

          {/* Qualifying item */}
          <div className="space-y-2">
            <Label htmlFor="stamp-item-id">ID del producto participante (opcional)</Label>
            <Input
              id="stamp-item-id"
              type="text"
              placeholder="Dejalo vacío para otorgar un sello con cualquier compra"
              value={itemId}
              onChange={(e) => setItemId(e.target.value)}
              disabled={!enabled}
            />
            <p className="text-xs text-muted-foreground">
              Pegá el UUID de un producto del menú. Si lo completás, solo se otorgan sellos
              cuando ese producto forma parte del pedido.
            </p>
          </div>

          {/* Feedback */}
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          {success && (
            <p className="rounded-md bg-success/10 px-3 py-2 text-sm text-success">
              Configuración de sellos guardada.
            </p>
          )}

          <Button type="submit" disabled={saving} className="gap-2">
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin" />Guardando…</>
              : <><Save className="h-4 w-4" />Guardar cambios</>}
          </Button>
        </form>
      </CardContent>
      </Card>
    </PageContainer>
  );
}
