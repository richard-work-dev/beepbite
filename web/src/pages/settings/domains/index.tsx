/**
 * Custom Domains settings page (Wave 23 / Now-13 + T7.6).
 *
 * Allows org members to:
 *   • Add a custom hostname to their location.
 *   • See the required TXT and CNAME DNS records.
 *   • Click "Verificar" to trigger DNS verification and cert issuance.
 *   • Remove a domain.
 *
 * Route: wired externally; this file is the default export.
 * Wire example (routes.jsx):
 *   { path: 'settings/domains', element: <DomainsSettingsPage /> }
 */

import { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Plus,
  Trash2,
  RefreshCw,
  Copy,
  Check,
  Loader2,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ShieldCheck,
} from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

import { useAuth } from '@/context/auth-context';
import {
  listDomains,
  addDomain,
  removeDomain,
  verifyDomain,
  type Domain,
} from '@/services/domains';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  pending:      'DNS pendiente',
  verifying:    'Verificando',
  verified:     'Verificado',
  cert_issuing: 'Emitiendo certificado',
  live:         'Publicado',
  failed:       'Falló',
};

// Semantic per-status signal instead of one hue ("default" orange) for every
// non-terminal state: pending/verifying are neutral (nothing to act on yet),
// verified/live are the "this is good" success signal, cert_issuing is a
// transient in-progress caution, failed is the genuinely destructive one.
const STATUS_VARIANT: Record<string, string> = {
  pending:      'secondary',
  verifying:    'secondary',
  verified:     'success',
  cert_issuing: 'warning',
  live:         'success',
  failed:       'destructive',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={(STATUS_VARIANT[status] ?? 'secondary') as 'secondary' | 'success' | 'warning' | 'destructive'}>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

// ---------------------------------------------------------------------------
// Copy-to-clipboard button
// ---------------------------------------------------------------------------

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* silent */
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className="ml-2 inline-flex items-center text-muted-foreground hover:text-foreground transition-colors"
      title="Copiar al portapapeles"
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// DNS instructions card
// ---------------------------------------------------------------------------

function DnsInstructions({ domain }: { domain: Domain }) {
  const txtHost = `_beepbite-verify.${domain.hostname}`;
  const txtValue = domain.verification_token;
  const cnameTarget = 'mystore.beepbite.io';

  return (
    <div className="rounded-md border bg-muted/40 p-4 space-y-4 text-sm">
      <p className="font-medium">Agregá estos registros DNS en el proveedor de tu dominio:</p>

      {/* TXT record */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase tracking-wide">
          <span className="bg-secondary rounded px-1 py-0.5">TXT</span>
          <span>Verificación de propiedad</span>
        </div>
        <div className="grid gap-1">
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Host</span>
            <code className="font-mono break-all">{txtHost}</code>
            <CopyButton value={txtHost} />
          </div>
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Valor</span>
            <code className="font-mono break-all">{txtValue}</code>
            <CopyButton value={txtValue} />
          </div>
        </div>
      </div>

      <Separator />

      {/* CNAME record */}
      <div className="space-y-1">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase tracking-wide">
          <span className="bg-secondary rounded px-1 py-0.5">CNAME</span>
          <span>Enrutamiento del tráfico</span>
        </div>
        <div className="grid gap-1">
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Host</span>
            <code className="font-mono break-all">{domain.hostname}</code>
            <CopyButton value={domain.hostname} />
          </div>
          <div className="flex items-center">
            <span className="w-14 shrink-0 text-muted-foreground">Destino</span>
            <code className="font-mono break-all">{cnameTarget}</code>
            <CopyButton value={cnameTarget} />
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Los cambios de DNS pueden demorar hasta 48 horas en propagarse. Hacé clic en{' '}
        <strong>Verificar</strong> cuando ambos registros estén configurados.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Domain row
// ---------------------------------------------------------------------------

function DomainRow({ domain, onVerify, onRemove, verifying }: {
  domain: Domain;
  onVerify: (id: string) => void;
  onRemove: (domain: Domain) => void;
  verifying: string | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const needsDns = ['pending', 'verifying', 'failed'].includes(domain.status);

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="font-medium truncate">{domain.hostname}</span>
          <StatusBadge status={domain.status} />
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {needsDns && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => onVerify(domain.id)}
              disabled={verifying === domain.id}
            >
              {verifying === domain.id ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              )}
              Verificar
            </Button>
          )}
          {needsDns && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded((v) => !v)}
            >
              Instrucciones DNS
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="text-destructive hover:text-destructive"
            onClick={() => onRemove(domain)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && needsDns && <DnsInstructions domain={domain} />}

      {domain.status === 'live' && (
        <div className="flex items-center gap-1.5 text-xs text-success">
          <CheckCircle2 className="h-3.5 w-3.5" />
          <span>
            Activo: las visitas a{' '}
            <strong>{domain.hostname}</strong> se dirigen a este local.
          </span>
        </div>
      )}

      {domain.status === 'cert_issuing' && (
        <div className="flex items-center gap-1.5 text-xs text-warning">
          <Clock className="h-3.5 w-3.5" />
          <span>Se está emitiendo el certificado SSL; puede demorar unos minutos.</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page component
// ---------------------------------------------------------------------------

export default function DomainsSettingsPage() {
  const { activeLocation } = useAuth();

  const [domains, setDomains] = useState<Domain[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add dialog state
  const [addOpen, setAddOpen] = useState(false);
  const [hostname, setHostname] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // Verify state
  const [verifying, setVerifying] = useState<string | null>(null); // domain id being verified
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Remove alert state
  const [removeTarget, setRemoveTarget] = useState<Domain | null>(null);
  const [removing, setRemoving] = useState(false);

  // ---------------------------------------------------------------------------
  // Load
  // ---------------------------------------------------------------------------

  const load = useCallback(async () => {
    if (!activeLocation?.id) return;
    setLoading(true);
    setError(null);
    // listDomains() only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) propagates as a
    // rejected promise. Without this try/catch/finally, that left the
    // custom-domains settings page stuck loading forever.
    try {
      const { data, error: err } = await listDomains(activeLocation.id);
      if (err) {
        setError(err.message || 'No se pudieron cargar los dominios');
      } else {
        setDomains(Array.isArray(data) ? data : (data?.data ?? []));
      }
    } catch (err) {
      console.error('Error loading domains:', err);
      setError('No se pudieron cargar los dominios');
    } finally {
      setLoading(false);
    }
  }, [activeLocation?.id]);

  useEffect(() => { void load(); }, [load]);

  // ---------------------------------------------------------------------------
  // Add
  // ---------------------------------------------------------------------------

  async function handleAdd() {
    if (!hostname.trim()) { setAddError('El nombre del host es obligatorio'); return; }
    if (!activeLocation) return;
    setAdding(true);
    setAddError(null);

    const { data, error: err } = await addDomain({
      locationId: activeLocation.id,
      hostname: hostname.trim().toLowerCase(),
    });

    if (err) {
      setAddError(err.message || 'No se pudo agregar el dominio');
      setAdding(false);
      return;
    }

    setDomains((prev) => [data!, ...prev]);
    setHostname('');
    setAddOpen(false);
    setAdding(false);
  }

  // ---------------------------------------------------------------------------
  // Verify
  // ---------------------------------------------------------------------------

  async function handleVerify(id: string) {
    setVerifying(id);
    setVerifyError(null);

    const { data, error: err } = await verifyDomain(id);

    if (err) {
      setVerifyError(err.message || 'La verificación falló');
    } else {
      setDomains((prev) => prev.map((d) => (d.id === id ? data! : d)));
    }
    setVerifying(null);
  }

  // ---------------------------------------------------------------------------
  // Remove
  // ---------------------------------------------------------------------------

  async function handleConfirmRemove() {
    if (!removeTarget) return;
    setRemoving(true);

    const { error: err } = await removeDomain(removeTarget.id);

    if (!err) {
      setDomains((prev) => prev.filter((d) => d.id !== removeTarget.id));
    }
    setRemoving(false);
    setRemoveTarget(null);
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  if (!activeLocation) {
    return (
      <div className="flex items-center gap-2 p-6 text-muted-foreground">
        <AlertTriangle className="h-4 w-4" />
        <span>Seleccioná un local para administrar sus dominios personalizados.</span>
      </div>
    );
  }

  return (
    <PageContainer className="max-w-3xl">
      {/* Header */}
      <PageHeader
        eyebrow="Configuración"
        title="Dominios personalizados"
        icon={Globe}
        description={
          <>
            Conectá tu propio nombre de host (por ejemplo,{' '}
            <code className="font-mono text-xs bg-muted px-1 rounded">
              pedidos.rikopollo.com
            </code>
            ) con <strong>{activeLocation.name}</strong>.
          </>
        }
        actions={
          <>
            <Button
              size="sm"
              variant="outline"
              onClick={load}
              disabled={loading}
            >
              <RefreshCw className={cn('h-3.5 w-3.5 mr-1', loading && 'animate-spin')} />
              Actualizar
            </Button>
            <Button size="sm" onClick={() => { setAddError(null); setHostname(''); setAddOpen(true); }}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              Agregar dominio
            </Button>
          </>
        }
      />

      {/* Verify error banner */}
      {verifyError && (
        <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 flex items-start gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="font-medium">La verificación falló</p>
            <p>{verifyError}</p>
          </div>
          <button
            type="button"
            className="ml-auto text-xs underline"
            onClick={() => setVerifyError(null)}
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Domain list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dominios</CardTitle>
          <CardDescription>
            Agregá tu nombre de host, configurá el DNS y verificá para publicarlo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading && (
            <div className="flex items-center gap-2 text-muted-foreground py-6 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Cargando dominios…</span>
            </div>
          )}

          {!loading && error && (
            <div className="text-destructive text-sm py-4 text-center">{error}</div>
          )}

          {!loading && !error && domains.length === 0 && (
            <div className="text-muted-foreground text-sm py-8 text-center">
              Todavía no hay dominios personalizados.{' '}
              <button
                type="button"
                className="underline"
                onClick={() => { setAddError(null); setHostname(''); setAddOpen(true); }}
              >
                Agregar uno
              </button>
              .
            </div>
          )}

          {!loading && !error && domains.map((domain) => (
            <DomainRow
              key={domain.id}
              domain={domain}
              onVerify={handleVerify}
              onRemove={setRemoveTarget}
              verifying={verifying}
            />
          ))}
        </CardContent>
      </Card>

      {/* How it works */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Cómo funciona</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <ol className="list-decimal list-inside space-y-1">
            <li>Agregá arriba tu nombre de host personalizado.</li>
            <li>
              Abrí las <strong>instrucciones DNS</strong> para ver los registros TXT y CNAME
              que debés agregar en tu proveedor de dominio.
            </li>
            <li>
              Cuando los registros estén configurados (puede demorar hasta 48 horas), presioná{' '}
              <strong>Verificar</strong>.
            </li>
            <li>
              El sistema emite automáticamente un certificado SSL y dirige el tráfico
              a este local.
            </li>
          </ol>
        </CardContent>
      </Card>

      {/* ── Add domain dialog ── */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Agregar dominio personalizado</DialogTitle>
            <DialogDescription>
              Ingresá el nombre de host que querés dirigir a{' '}
              <strong>{activeLocation.name}</strong>.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="hostname">Nombre del host</Label>
              <Input
                id="hostname"
                placeholder="pedidos.rikopollo.com"
                value={hostname}
                onChange={(e) => setHostname(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                disabled={adding}
              />
              <p className="text-xs text-muted-foreground">
                Usá un subdominio (por ejemplo, <code>pedidos.ejemplo.com</code>) para
                obtener la mejor compatibilidad con DNS.
              </p>
            </div>
            {addError && (
              <p className="text-sm text-destructive">{addError}</p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddOpen(false)} disabled={adding}>
              Cancelar
            </Button>
            <Button onClick={handleAdd} disabled={adding}>
              {adding && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Agregar dominio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove confirmation dialog ── */}
      <AlertDialog open={!!removeTarget} onOpenChange={(o) => !o && setRemoveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>¿Eliminar dominio?</AlertDialogTitle>
            <AlertDialogDescription>
              Si eliminás <strong>{removeTarget?.hostname}</strong>, el tráfico dejará
              de dirigirse a este local. Esta acción no se puede deshacer.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removing}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmRemove}
              disabled={removing}
              variant="destructive"
            >
              {removing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Eliminar dominio
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageContainer>
  );
}
