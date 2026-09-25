/**
 * API Keys & Webhooks settings page (Wave 22).
 *
 * Two stacked sections:
 *   1. API Keys — list, create (full key shown once), revoke.
 *   2. Webhooks — list, create (signing_secret shown once), edit, delete,
 *      expandable recent-deliveries per endpoint.
 *
 * Route: wired externally; this file is the default export.
 */

import { useState, useEffect, useCallback } from 'react';
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
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { PageHeader, PageContainer } from '@/components/ui/page-header';
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
import {
  Key,
  Webhook,
  Plus,
  Copy,
  Check,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Loader2,
  ShieldOff,
  Globe,
  Clock,
  Activity,
  Pencil,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { listKeys, createKey, revokeKey, type ApiKeySummary, type ApiKeyCreated } from '@/services/api-keys';
import {
  listEndpoints,
  createEndpoint,
  updateEndpoint,
  deleteEndpoint,
  listDeliveries,
  type WebhookEndpoint,
  type WebhookDelivery,
} from '@/services/webhooks';

// ── Constants ─────────────────────────────────────────────────────────────────

const ALL_SCOPES = [
  'read:menu',
  'write:menu',
  'read:orders',
  'write:orders',
  'read:reports',
  'read:customers',
  'write:webhooks',
  'write:items',
  'read:staff',
  'write:staff',
  'read:inventory',
  'write:inventory',
];

const ALL_EVENTS = [
  'order.created',
  'order.paid',
  'order.refunded',
  'item.created',
  'item.updated',
  'staff.invited',
];

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function fmtDateTime(iso?: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function scopeColor(scope: string) {
  if (scope.startsWith('write:')) return 'bg-primary/10 text-primary border-primary/20';
  return 'bg-muted text-muted-foreground border-border';
}

function eventColor() {
  return 'bg-muted text-muted-foreground border-border';
}

function statusColor(status: string) {
  if (status === 'success') return 'bg-success/10 text-success border-success/20';
  if (status === 'failed') return 'bg-destructive/10 text-destructive border-destructive/20';
  return 'bg-warning/10 text-warning border-warning/20';
}

// ── Copy-to-clipboard button ──────────────────────────────────────────────────

function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      className={cn(
        'inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium transition-colors',
        copied
          ? 'bg-success/10 text-success'
          : 'bg-muted text-muted-foreground hover:bg-muted',
        className,
      )}
      title="Copiar al portapapeles"
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      {copied ? 'Copiado' : 'Copiar'}
    </button>
  );
}

// ── "Shown once" secret box ───────────────────────────────────────────────────

function SecretRevealBox({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-2">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-primary mt-0.5 flex-shrink-0" />
        <p className="text-sm font-medium text-primary">
          Guardá este {label}; no se volverá a mostrar
        </p>
      </div>
      <div className="flex items-center gap-2 rounded-md bg-card border border-primary/20 px-3 py-2">
        <code className="flex-1 text-sm font-mono text-foreground break-all select-all">
          {value}
        </code>
        <CopyButton text={value} />
      </div>
      <p className="text-xs text-primary">
        Copialo ahora y guardalo de forma segura. No se puede recuperar después de cerrar esta ventana.
      </p>
    </div>
  );
}

// ── Scope / event checkbox grid ───────────────────────────────────────────────

function CheckboxGrid({ items, selected, onChange, colorFn }: {
  items: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  colorFn: (item: string) => string;
}) {
  function toggle(item: string) {
    const next = selected.includes(item)
      ? selected.filter((s) => s !== item)
      : [...selected, item];
    onChange(next);
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <label
          key={item}
          className="flex items-center gap-2 cursor-pointer rounded-md border border-transparent px-2 py-1.5 hover:bg-muted/50 transition-colors"
        >
          <Checkbox
            checked={selected.includes(item)}
            onCheckedChange={() => toggle(item)}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
          />
          <span
            className={cn(
              'text-xs font-medium px-1.5 py-0.5 rounded border',
              colorFn(item),
            )}
          >
            {item}
          </span>
        </label>
      ))}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// API KEYS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function CreateKeyDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated: (key: ApiKeyCreated) => void;
}) {
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>([]);
  const [environment, setEnvironment] = useState<'live' | 'test'>('live');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdKey, setCreatedKey] = useState<ApiKeyCreated | null>(null);

  function reset() {
    setName('');
    setScopes([]);
    setEnvironment('live');
    setLoading(false);
    setError('');
    setCreatedKey(null);
  }

  function handleClose() {
    if (createdKey) onCreated(createdKey);
    reset();
    onClose();
  }

  async function handleCreate() {
    if (!name.trim()) {
      setError('El nombre de la clave es obligatorio.');
      return;
    }
    if (scopes.length === 0) {
      setError('Seleccioná al menos un permiso.');
      return;
    }
    setError('');
    setLoading(true);
    const { data, error: apiErr } = await createKey({
      name: name.trim(),
      scopes,
      environment,
    });
    setLoading(false);
    if (apiErr) {
      setError(apiErr.message || 'No se pudo crear la clave.');
      return;
    }
    setCreatedKey(data);
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-5 w-5 text-primary" />
            {createdKey ? 'Clave API creada' : 'Crear clave API'}
          </DialogTitle>
          <DialogDescription>
            {createdKey
              ? 'La nueva clave API fue creada. Copiala ahora; no se volverá a mostrar.'
              : 'Asignale un nombre, elegí sus permisos y seleccioná el entorno.'}
          </DialogDescription>
        </DialogHeader>

        {createdKey ? (
          <div className="space-y-4">
            <SecretRevealBox label="clave API" value={createdKey.key} />
            <div className="text-sm text-muted-foreground space-y-1">
              <p>
                <span className="font-medium">Nombre:</span> {createdKey.name}
              </p>
              <p>
                <span className="font-medium">Entorno:</span>{' '}
                <Badge
                  className={cn(
                    'text-xs',
                    createdKey.environment === 'live'
                      ? 'bg-success/10 text-success border-success/20'
                      : 'bg-muted text-muted-foreground',
                  )}
                  variant="outline"
                >
                  {createdKey.environment === 'live' ? 'Producción' : 'Prueba'}
                </Badge>
              </p>
              <p>
                <span className="font-medium">Permisos:</span>{' '}
                {(createdKey.scopes || []).join(', ')}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="key-name">Nombre de la clave</Label>
              <Input
                id="key-name"
                placeholder="Por ejemplo, integración de producción"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Entorno</Label>
              <div className="flex items-center gap-3">
                <Switch
                  checked={environment === 'live'}
                  onCheckedChange={(v) => setEnvironment(v ? 'live' : 'test')}
                  className="data-[state=checked]:bg-primary"
                />
                <span className="text-sm">
                  {environment === 'live' ? (
                    <span className="font-medium text-success">Producción</span>
                  ) : (
                    <span className="font-medium text-muted-foreground">Prueba</span>
                  )}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <Label>Permisos</Label>
              <CheckboxGrid
                items={ALL_SCOPES}
                selected={scopes}
                onChange={setScopes}
                colorFn={scopeColor}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {createdKey ? (
            <Button onClick={handleClose}>
              Listo
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancelar
              </Button>
              <Button
                onClick={handleCreate}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Crear clave
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RevokeKeyDialog({ apiKey, open, onClose, onRevoked }: {
  apiKey: ApiKeySummary;
  open: boolean;
  onClose: () => void;
  onRevoked: (id: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleRevoke() {
    setLoading(true);
    setError('');
    const { error: apiErr } = await revokeKey(apiKey.id);
    setLoading(false);
    if (apiErr) {
      setError(apiErr.message || 'No se pudo revocar la clave.');
      return;
    }
    onRevoked(apiKey.id);
    onClose();
  }

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2 text-destructive">
            <ShieldOff className="h-5 w-5" /> ¿Revocar clave API?
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span className="font-mono font-medium">{apiKey?.prefix_visible}</span>
            {apiKey?.name && ` (${apiKey.name})`} se desactivará inmediatamente. Las
            integraciones que la usen dejarán de funcionar. Esta acción no se puede deshacer.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p className="text-sm text-destructive px-1">{error}</p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={loading}>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRevoke}
            disabled={loading}
            variant="destructive"
          >
            {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Revocar clave
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ApiKeyRow({ apiKey, onRevoked }: { apiKey: ApiKeySummary; onRevoked: (id: string) => void }) {
  const [revokeOpen, setRevokeOpen] = useState(false);
  const isRevoked = !!apiKey.revoked_at;

  return (
    <div
      className={cn(
        'flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3 rounded-lg border transition-colors',
        isRevoked
          ? 'bg-muted/50 border-border opacity-60'
          : 'bg-card border-border hover:border-primary/20',
      )}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground">{apiKey.name}</span>
          {apiKey.environment && (
            <Badge
              variant="outline"
              className={cn(
                'text-xs',
                apiKey.environment === 'live'
                  ? 'bg-success/10 text-success border-success/20'
                  : 'bg-muted text-muted-foreground border-border',
              )}
            >
              {apiKey.environment}
            </Badge>
          )}
          {isRevoked && (
            <Badge variant="outline" className="text-xs bg-destructive/10 text-destructive border-destructive/20">
              Revocada
            </Badge>
          )}
        </div>
        <p className="font-mono text-xs text-muted-foreground">{apiKey.prefix_visible}••••••••</p>
        <div className="flex flex-wrap gap-1">
          {(apiKey.scopes || []).map((s) => (
            <span
              key={s}
              className={cn('inline-block text-xs px-1.5 py-0.5 rounded border', scopeColor(s))}
            >
              {s}
            </span>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4 text-xs text-muted-foreground shrink-0">
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {apiKey.last_used_at ? `Usada ${fmtDate(apiKey.last_used_at)}` : 'Nunca se usó'}
        </span>
        {!isRevoked && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRevokeOpen(true)}
            className="text-destructive hover:text-destructive hover:bg-destructive/10 h-7 px-2"
          >
            <ShieldOff className="h-3.5 w-3.5 mr-1" />
            Revocar
          </Button>
        )}
      </div>

      {!isRevoked && (
        <RevokeKeyDialog
          apiKey={apiKey}
          open={revokeOpen}
          onClose={() => setRevokeOpen(false)}
          onRevoked={onRevoked}
        />
      )}
    </div>
  );
}

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    // listKeys() only wraps the API-error case in { data, error } — a
    // network-level failure (fetch() itself rejecting) propagates as a
    // rejected promise. Without this try/catch/finally, that left the API
    // keys list stuck on its loading spinner forever with the rejection
    // silently swallowed.
    try {
      const { data, error: apiErr } = await listKeys();
      if (apiErr) {
        setError(apiErr.message || 'No se pudieron cargar las claves API.');
        return;
      }
      setKeys(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading API keys:', err);
      setError('No se pudieron cargar las claves API.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleRevoked(id: string) {
    setKeys((prev) =>
      prev.map((k) =>
        k.id === id ? { ...k, revoked_at: new Date().toISOString() } : k,
      ),
    );
  }

  function handleCreated(newKey: ApiKeyCreated) {
    // Merge new key (without the plaintext) into list
    setKeys((prev) => [
      {
        id: newKey.id,
        name: newKey.name,
        prefix_visible: newKey.prefix_visible,
        scopes: newKey.scopes,
        environment: newKey.environment,
        last_used_at: null,
        revoked_at: null,
        created_at: newKey.created_at,
      },
      ...prev,
    ]);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Key className="h-5 w-5 text-primary" />
            Claves API
          </CardTitle>
          <CardDescription className="mt-1">
            Acceso programático a los datos de tu organización. La clave completa se muestra
            una sola vez al crearla.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => setCreateOpen(true)}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-1" />
          Crear clave
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Cargando claves…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-6 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" /> {error}
            <Button variant="ghost" size="sm" onClick={load} className="ml-auto">
              Reintentar
            </Button>
          </div>
        ) : keys.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm gap-2">
            <Key className="h-8 w-8 opacity-30" />
            <p>Todavía no hay claves API.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCreateOpen(true)}
              className="mt-1"
            >
              <Plus className="h-4 w-4 mr-1" /> Crear la primera clave
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            {keys.map((k) => (
              <ApiKeyRow key={k.id} apiKey={k} onRevoked={handleRevoked} />
            ))}
          </div>
        )}
      </CardContent>

      <CreateKeyDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={handleCreated}
      />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// WEBHOOKS SECTION
// ═══════════════════════════════════════════════════════════════════════════════

function AddEndpointDialog({ open, onClose, onCreated, editEndpoint }: {
  open: boolean;
  onClose: () => void;
  onCreated: (ep: WebhookEndpoint) => void;
  editEndpoint?: WebhookEndpoint | null;
}) {
  const isEdit = !!editEndpoint;
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [createdSecret, setCreatedSecret] = useState<{ endpoint: WebhookEndpoint; secret: string } | null>(null);

  // Pre-fill when editing
  useEffect(() => {
    if (editEndpoint) {
      setUrl(editEndpoint.url || '');
      setEvents(editEndpoint.events || []);
      setDescription(editEndpoint.description || '');
    } else {
      setUrl('');
      setEvents([]);
      setDescription('');
    }
    setError('');
    setCreatedSecret(null);
  }, [editEndpoint, open]);

  function reset() {
    setUrl('');
    setEvents([]);
    setDescription('');
    setLoading(false);
    setError('');
    setCreatedSecret(null);
  }

  function handleClose() {
    if (createdSecret) onCreated(createdSecret.endpoint);
    reset();
    onClose();
  }

  function validateUrl(v: string) {
    try {
      const u = new URL(v);
      return u.protocol === 'https:';
    } catch {
      return false;
    }
  }

  async function handleSave() {
    if (!validateUrl(url)) {
      setError('La URL debe ser una dirección https:// válida.');
      return;
    }
    if (events.length === 0) {
      setError('Seleccioná al menos un evento.');
      return;
    }
    setError('');
    setLoading(true);

    if (isEdit) {
      const { data, error: apiErr } = await updateEndpoint(editEndpoint.id, {
        url,
        events,
        description,
      });
      setLoading(false);
      if (apiErr) { setError(apiErr.message || 'No se pudo actualizar.'); return; }
      onCreated(data!);
      reset();
      onClose();
    } else {
      const { data, error: apiErr } = await createEndpoint({ url, events, description });
      setLoading(false);
      if (apiErr) { setError(apiErr.message || 'No se pudo crear el endpoint.'); return; }
      setCreatedSecret({ endpoint: data!, secret: data!.signing_secret });
    }
  }

  const title = isEdit ? 'Editar endpoint de webhook' : 'Agregar endpoint de webhook';

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Webhook className="h-5 w-5 text-primary" />
            {createdSecret ? 'Endpoint de webhook creado' : title}
          </DialogTitle>
          <DialogDescription>
            {createdSecret
              ? 'Guardá el secreto de firma; no se volverá a mostrar.'
              : isEdit
              ? 'Actualizá la URL, los eventos suscriptos o la descripción.'
              : 'Enviaremos una solicitud POST con JSON firmado a tu endpoint HTTPS cuando ocurran eventos.'}
          </DialogDescription>
        </DialogHeader>

        {createdSecret ? (
          <div className="space-y-4">
            <SecretRevealBox label="secreto de firma" value={createdSecret.secret} />
            <p className="text-sm text-muted-foreground">
              El encabezado{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">X-BeepBite-Signature</code>{' '}
              contiene{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">t=&lt;unix&gt;,v1=&lt;hex&gt;</code>
              , donde el valor hexadecimal es{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                HMAC-SHA256(&quot;&lt;t&gt;.&lt;delivery-id&gt;.&lt;raw_body&gt;&quot;, secret)
              </code>{' '}
              y el identificador de entrega se envía en el encabezado{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">X-BeepBite-Delivery</code>{' '}
              .
            </p>
            <p className="text-sm text-muted-foreground">
              Volvé a calcularlo sobre el cuerpo sin procesar y comparalo en tiempo constante. Rechazá un{' '}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">t</code> con más de cinco minutos
              de diferencia respecto de tu reloj, e ignorá los identificadores
              ya aceptados. La firma por sí sola no evita que se repita una solicitud capturada.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="webhook-url">URL del endpoint</Label>
              <Input
                id="webhook-url"
                type="url"
                placeholder="https://example.com/webhooks/beepbite"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">Debe usar HTTPS.</p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="webhook-desc">Descripción (opcional)</Label>
              <Input
                id="webhook-desc"
                placeholder="Por ejemplo, sincronizar pedidos con el ERP"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Eventos a suscribir</Label>
              <CheckboxGrid
                items={ALL_EVENTS}
                selected={events}
                onChange={setEvents}
                colorFn={eventColor}
              />
            </div>

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1">
                <AlertTriangle className="h-3.5 w-3.5" /> {error}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          {createdSecret ? (
            <Button onClick={handleClose}>
              Listo
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={handleClose} disabled={loading}>
                Cancelar
              </Button>
              <Button
                onClick={handleSave}
                disabled={loading}
              >
                {loading && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                {isEdit ? 'Guardar cambios' : 'Agregar endpoint'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeliveriesPanel({ endpointId }: { endpointId: string }) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    listDeliveries(endpointId).then(({ data, error: apiErr }) => {
      if (cancelled) return;
      setLoading(false);
      if (apiErr) { setError(apiErr.message || 'No se pudieron cargar las entregas.'); return; }
      setDeliveries(Array.isArray(data) ? data : []);
    }).catch((err: unknown) => {
      // listDeliveries()'s promise rejects on a network-level failure
      // (fetch() itself throwing, not just an API { error } response) —
      // without this, `loading` stayed true forever.
      if (!cancelled) {
        console.error('Error loading webhook deliveries:', err);
        setLoading(false);
        setError('No se pudieron cargar las entregas.');
      }
    });
    return () => { cancelled = true; };
  }, [endpointId]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 pl-4 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Cargando entregas…
      </div>
    );
  }
  if (error) {
    return (
      <p className="pl-4 py-3 text-sm text-destructive flex items-center gap-1">
        <AlertTriangle className="h-3.5 w-3.5" /> {error}
      </p>
    );
  }
  if (deliveries.length === 0) {
    return (
      <p className="pl-4 py-3 text-sm text-muted-foreground">Todavía no hay entregas registradas.</p>
    );
  }

  return (
    <div className="divide-y divide-border">
      {deliveries.map((d) => (
        <div
          key={d.id}
          className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-xs"
        >
          <span
            className={cn(
              'inline-block px-1.5 py-0.5 rounded border font-mono',
              eventColor(),
            )}
          >
            {d.event}
          </span>
          <span
            className={cn(
              'inline-block px-1.5 py-0.5 rounded border',
              statusColor(d.status),
            )}
          >
            {d.status}
          </span>
          {d.response_code && (
            <span className="text-muted-foreground">HTTP {d.response_code}</span>
          )}
          {d.duration_ms != null && (
            <span className="text-muted-foreground">{d.duration_ms}ms</span>
          )}
          <span className="ml-auto text-muted-foreground">{fmtDateTime(d.delivered_at)}</span>
        </div>
      ))}
    </div>
  );
}

function WebhookEndpointRow({ endpoint, onUpdated, onDeleted }: {
  endpoint: WebhookEndpoint;
  onUpdated: (ep: WebhookEndpoint) => void;
  onDeleted: (id: string) => void;
}) {
  const [deliveriesOpen, setDeliveriesOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [activeToggling, setActiveToggling] = useState(false);

  async function handleToggleActive(checked: boolean) {
    setActiveToggling(true);
    const { data } = await updateEndpoint(endpoint.id, { is_active: checked });
    setActiveToggling(false);
    if (data) onUpdated(data);
  }

  async function handleDelete() {
    await deleteEndpoint(endpoint.id);
    onDeleted(endpoint.id);
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 py-3">
        {/* URL + meta */}
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Globe className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="font-mono text-sm text-foreground break-all">{endpoint.url}</span>
          </div>
          {endpoint.description && (
            <p className="text-xs text-muted-foreground pl-6">{endpoint.description}</p>
          )}
          <div className="flex flex-wrap gap-1 pl-6">
            {(endpoint.events || []).map((e) => (
              <span
                key={e}
                className={cn('text-xs px-1.5 py-0.5 rounded border', eventColor())}
              >
                {e}
              </span>
            ))}
          </div>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3 shrink-0">
          {/* Active toggle */}
          <div className="flex items-center gap-1.5">
            {activeToggling && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
            <Switch
              checked={endpoint.is_active}
              onCheckedChange={handleToggleActive}
              disabled={activeToggling}
              className="data-[state=checked]:bg-primary"
            />
            <span className="text-xs text-muted-foreground">
              {endpoint.is_active ? 'Activo' : 'Pausado'}
            </span>
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setEditOpen(true)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
            title="Editar"
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeleteOpen(true)}
            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
            title="Eliminar"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDeliveriesOpen((v) => !v)}
            className="h-7 px-2 text-muted-foreground hover:text-foreground"
            title="Entregas recientes"
          >
            <Activity className="h-3.5 w-3.5 mr-1" />
            <span className="text-xs">Entregas</span>
            {deliveriesOpen ? (
              <ChevronDown className="h-3.5 w-3.5 ml-0.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 ml-0.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Collapsible deliveries */}
      {deliveriesOpen && (
        <div className="border-t border-border bg-muted/50">
          <DeliveriesPanel endpointId={endpoint.id} />
        </div>
      )}

      {/* Edit dialog */}
      <AddEndpointDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        onCreated={(updated) => { onUpdated(updated); setEditOpen(false); }}
        editEndpoint={endpoint}
      />

      {/* Delete confirmation */}
      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <Trash2 className="h-4 w-4" /> ¿Eliminar endpoint?
            </AlertDialogTitle>
            <AlertDialogDescription>
              <span className="font-mono">{endpoint.url}</span> se eliminará definitivamente.
              No se enviarán más eventos.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              variant="destructive"
            >
              Eliminar endpoint
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function WebhooksSection() {
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [addOpen, setAddOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    // Same failure mode as the API keys list above: listEndpoints() only
    // wraps the API-error case in { data, error } — a network-level
    // rejection left this stuck loading forever.
    try {
      const { data, error: apiErr } = await listEndpoints();
      if (apiErr) { setError(apiErr.message || 'No se pudieron cargar los endpoints.'); return; }
      setEndpoints(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error loading webhook endpoints:', err);
      setError('No se pudieron cargar los endpoints.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleCreated(newEndpoint: WebhookEndpoint) {
    setEndpoints((prev) => [newEndpoint, ...prev]);
  }

  function handleUpdated(updated: WebhookEndpoint) {
    setEndpoints((prev) =>
      prev.map((e) => (e.id === updated.id ? { ...e, ...updated } : e)),
    );
  }

  function handleDeleted(id: string) {
    setEndpoints((prev) => prev.filter((e) => e.id !== id));
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle className="flex items-center gap-2 text-base">
            <Webhook className="h-5 w-5 text-primary" />
            Webhooks
          </CardTitle>
          <CardDescription className="mt-1">
            Recibí notificaciones de eventos en tiempo real en tu endpoint HTTPS. Cada endpoint
            recibe un secreto de firma único que se muestra una sola vez.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={() => setAddOpen(true)}
          className="shrink-0"
        >
          <Plus className="h-4 w-4 mr-1" />
          Agregar endpoint
        </Button>
      </CardHeader>

      <CardContent>
        {loading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Cargando endpoints…
          </div>
        ) : error ? (
          <div className="flex items-center gap-2 py-6 text-destructive text-sm">
            <AlertTriangle className="h-4 w-4" /> {error}
            <Button variant="ghost" size="sm" onClick={load} className="ml-auto">
              Reintentar
            </Button>
          </div>
        ) : endpoints.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground text-sm gap-2">
            <Webhook className="h-8 w-8 opacity-30" />
            <p>No hay endpoints de webhook configurados.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAddOpen(true)}
              className="mt-1"
            >
              <Plus className="h-4 w-4 mr-1" /> Agregar el primer endpoint
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {endpoints.map((ep) => (
              <WebhookEndpointRow
                key={ep.id}
                endpoint={ep}
                onUpdated={handleUpdated}
                onDeleted={handleDeleted}
              />
            ))}
          </div>
        )}
      </CardContent>

      <AddEndpointDialog
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(ep) => { handleCreated(ep); }}
      />
    </Card>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE ROOT
// ═══════════════════════════════════════════════════════════════════════════════

export default function ApiKeysPage() {
  return (
    <PageContainer className="max-w-3xl">
      {/* Page header */}
      <PageHeader
        eyebrow="Configuración"
        title="Claves API y webhooks"
        description="Administrá el acceso programático y las integraciones en tiempo real de tu organización."
        icon={Key}
      />

      {/* Sections */}
      <ApiKeysSection />
      <WebhooksSection />
    </PageContainer>
  );
}
