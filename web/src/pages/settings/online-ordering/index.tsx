import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Copy, Download, ExternalLink, Globe, Loader2, Save } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

interface OrderingConfig {
  id: string; name: string; slug?: string; is_active?: boolean;
  is_marketplace_visible?: boolean; online_orders_enabled?: boolean;
  accepts_pickup?: boolean; accepts_delivery?: boolean; offers_collection?: boolean; offers_delivery?: boolean;
  service_style?: string; on_delivery_payment_methods?: string[]; currency_code?: string; default_currency_code?: string;
}
export default function OnlineOrderingSettings() {
  const { activeLocation } = useAuth();
  if (!activeLocation) return <p>Seleccioná un local para configurar los pedidos online.</p>;
  return <OrderingSettings key={activeLocation.id} locationID={activeLocation.id} />;
}

function OrderingSettings({ locationID }: { locationID: string }) {
  const { fetchLocations } = useAuth();
  const [config, setConfig] = useState<OrderingConfig | null>(null);
  const [published, setPublished] = useState(false);
  const [enabled, setEnabled] = useState(true);
  const [pickup, setPickup] = useState(true);
  const [delivery, setDelivery] = useState(false);
  const [methods, setMethods] = useState<string[]>([]);
  const [table, setTable] = useState('');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const qr = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void api.request<OrderingConfig[]>('GET', '/data/locations?eq=id,' + encodeURIComponent(locationID)).then(({ data, error: err }) => {
      if (!active) return;
      const row = data?.[0];
      if (err || !row) { setError('No pudimos cargar la configuración del local.'); return; }
      setConfig(row);
      setPublished(row.is_marketplace_visible === true);
      setEnabled(row.online_orders_enabled !== false);
      setPickup(row.accepts_pickup ?? row.offers_collection ?? false);
      setDelivery(row.accepts_delivery ?? row.offers_delivery ?? false);
      setMethods((row.on_delivery_payment_methods || []).filter(m => m === 'cash' || m === 'card_machine'));
    }).catch(() => { if (active) setError('No pudimos conectar con el servidor.'); });
    return () => { active = false; };
  }, [locationID, attempt]);

  if (!config) return <div className="space-y-4">{error ? <><p role="alert">{error}</p><Button variant="outline" onClick={() => { setError(''); setAttempt(n => n + 1); }}>Volver a intentar</Button></> : <p role="status">Cargando pedidos online…</p>}</div>;
  const slug = config.slug || 'pedir-' + locationID;
  const path = '/store/' + encodeURIComponent(slug);
  const url = window.location.origin + path + (table.trim() ? '?mesa=' + encodeURIComponent(table.trim()) : '');
  const live = config.is_marketplace_visible === true && config.is_active !== false;
  const pending = published !== Boolean(config.is_marketplace_visible) || enabled !== (config.online_orders_enabled !== false) ||
    pickup !== (config.accepts_pickup ?? config.offers_collection ?? false) || delivery !== (config.accepts_delivery ?? config.offers_delivery ?? false) ||
    JSON.stringify(methods) !== JSON.stringify((config.on_delivery_payment_methods || []).filter(m => m === 'cash' || m === 'card_machine'));

  async function save() {
    if (!config) return;
    setError(''); setMessage('');
    if (published && enabled && !methods.length) { setError('Elegí al menos un medio de pago para recibir pedidos.'); return; }
    if (published && enabled && !(config.currency_code || config.default_currency_code)) { setError('Configurá la moneda del local antes de habilitar pedidos.'); return; }
    if (published && enabled && !pickup && !delivery && config.service_style === 'takeaway') { setError('Habilitá retiro o delivery para recibir pedidos.'); return; }
    setSaving(true);
    try {
      const body = { slug, is_marketplace_visible: published, online_orders_enabled: enabled,
        accepts_pickup: pickup, offers_collection: pickup, accepts_delivery: delivery, offers_delivery: delivery,
        on_delivery_payment_methods: methods };
      const { data, error: err } = await api.request<OrderingConfig[]>('PATCH', '/data/locations?eq=id,' + encodeURIComponent(locationID), { body });
      if (err || !data?.[0]) throw new Error(err?.message || 'No se pudo guardar.');
      setConfig(data[0]);
      setMessage('Configuración guardada. Ya podés compartir el enlace y el QR.');
      await fetchLocations();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo guardar.'); }
    finally { setSaving(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(url); setMessage('Enlace copiado. Podés pegarlo en WhatsApp, Instagram o tu web.'); }
    catch { setMessage('Seleccioná el enlace y copialo manualmente.'); }
  }
  function download() {
    const svg = qr.current?.querySelector('svg');
    if (!svg) return;
    const blobURL = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
    const anchor = document.createElement('a');
    anchor.href = blobURL; anchor.download = 'menu-' + slug + (table.trim() ? '-mesa' : '') + '.svg'; anchor.click();
    setTimeout(() => URL.revokeObjectURL(blobURL), 1000);
  }
  const toggle = (method: string, checked: boolean) => setMethods(prev => checked ? [...prev, method] : prev.filter(m => m !== method));

  return <div className="min-w-0 space-y-6">
    <div><div className="mb-2 flex items-center gap-2 text-primary"><Globe className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-wider">{config.name}</span></div><h1 className="text-2xl font-bold">Pedidos desde tu enlace</h1><p className="mt-2 text-sm text-muted-foreground">Compartí el menú. Tus clientes eligen, confirman y siguen su pedido desde la web.</p></div>
    {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">{error}</p>}
    {message && <p role="status" className="rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">{message}</p>}
    <section className="space-y-5 rounded-2xl border bg-card p-5">
      <div className="flex items-center justify-between gap-4"><div><Label htmlFor="publish-menu">Publicar menú</Label><p className="mt-1 text-xs text-muted-foreground">Permite que cualquier persona con el enlace vea tus productos.</p></div><Switch id="publish-menu" checked={published} onCheckedChange={setPublished} /></div>
      <div className="flex items-center justify-between gap-4"><div><Label htmlFor="online-enabled">Recibir pedidos online</Label><p className="mt-1 text-xs text-muted-foreground">Podés pausarlos y mantener el menú visible.</p></div><Switch id="online-enabled" checked={enabled} onCheckedChange={setEnabled} /></div>
      <fieldset className="space-y-3 border-t pt-4"><legend className="font-semibold">Modalidades</legend><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={pickup} onChange={e => setPickup(e.target.checked)} />Para llevar / retirar</label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={delivery} onChange={e => setDelivery(e.target.checked)} />Delivery</label><p className="text-sm text-muted-foreground">Comer en el local: {config.service_style === 'takeaway' ? 'deshabilitado' : 'habilitado'}. Se configura desde la modalidad de atención del local.</p></fieldset>
      <fieldset className="space-y-3 border-t pt-4"><legend className="font-semibold">Pago al recibir</legend><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={methods.includes('cash')} onChange={e => toggle('cash', e.target.checked)} />Efectivo</label><label className="flex min-h-11 items-center gap-3"><input type="checkbox" checked={methods.includes('card_machine')} onChange={e => toggle('card_machine', e.target.checked)} />Tarjeta con terminal del local</label></fieldset>
      <p className="text-sm text-muted-foreground">El envío, la moneda y los impuestos usan la configuración del local. <Link className="text-primary underline" to={'/settings/location/' + locationID}>Revisar configuración</Link></p>
      {config.is_active === false && <p className="text-sm text-destructive">El local está inactivo. Activá el local para que el menú sea público.</p>}
      <Button className="min-h-11 w-full sm:w-auto" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Guardar configuración</Button>
      {pending && <p className="text-xs text-muted-foreground">Tenés cambios sin guardar.</p>}
    </section>
    <section className="min-w-0 space-y-4 rounded-2xl border bg-card p-5">
      <h2 className="text-lg font-bold">Tu enlace y código QR</h2>
      {!live && <p className="text-sm text-muted-foreground">Publicá el menú y guardá la configuración para compartirlo.</p>}
      <Label htmlFor="public-link">Enlace del menú</Label><Input id="public-link" readOnly value={url} onFocus={e => e.target.select()} />
      <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={!live} onClick={() => void copy()}><Copy className="mr-2 h-4 w-4" />Copiar enlace</Button>{live && <Button variant="outline" asChild><a href={path} target="_blank" rel="noreferrer"><ExternalLink className="mr-2 h-4 w-4" />Abrir menú</a></Button>}{live && <Button variant="outline" asChild><a href={'https://wa.me/?text=' + encodeURIComponent('¡Hacé tu pedido en ' + config.name + '! Elegí del menú y seguí tu pedido acá: ' + url)} target="_blank" rel="noreferrer">Compartir por WhatsApp</a></Button>}</div>
      <div className="grid items-start gap-5 sm:grid-cols-[220px_minmax(0,1fr)]">
        <div ref={qr} className="flex justify-center rounded-2xl border bg-white p-4"><QRCodeSVG value={url} size={188} marginSize={4} title={'Menú de ' + config.name} /></div>
        <div className="space-y-4"><p className="text-sm text-muted-foreground">Usalo en mostrador, mesas o material impreso. El QR siempre abre el menú actualizado.</p>{config.service_style !== 'takeaway' && <div className="space-y-2"><Label htmlFor="qr-table">QR para una mesa (opcional)</Label><Input id="qr-table" maxLength={60} placeholder="Ejemplo: 4 o Terraza" value={table} onChange={e => setTable(e.target.value)} /><p className="text-xs text-muted-foreground">El cliente verá “Comer en el local” y esta referencia preseleccionadas.</p></div>}<Button variant="outline" disabled={!live} onClick={download}><Download className="mr-2 h-4 w-4" />Descargar QR</Button></div>
      </div>
    </section>
  </div>;
}
