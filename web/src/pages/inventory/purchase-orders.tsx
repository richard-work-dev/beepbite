import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { ShoppingCart, Plus, AlertCircle, ChevronRight, Send, PackageCheck } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { useDateTime, useLocale } from '@/context/locale-context';
import { formatMoney } from '@/lib/currency';
import { usePOs, type POStatus, type PurchaseOrder } from './hooks/use-pos';
import { useSuppliers } from './hooks/use-suppliers';
import { POForm, type POFormPayload } from './components/po-form';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import { api } from '@/lib/api-client';

const STATUS_OPTIONS: { value: POStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'draft', label: 'Borrador' },
  { value: 'sent', label: 'Enviada' },
  { value: 'partially_received', label: 'Recepción parcial' },
  { value: 'received', label: 'Recibida' },
  { value: 'cancelled', label: 'Cancelada' },
  { value: 'closed', label: 'Cerrada' },
];

const PO_STATUS_LABEL: Record<string, string> = Object.fromEntries(
  STATUS_OPTIONS.filter((option) => option.value !== 'all').map((option) => [option.value, option.label]),
);

// Badge variant per PO status — draft is a plain outline (nothing committed
// yet), sent is the primary in-flight state, partially_received still needs
// a follow-up so it reads as warning, received is the success state,
// cancelled is the dead-end (destructive), closed is just filed away.
function poStatusVariant(status: string): 'outline' | 'default' | 'warning' | 'success' | 'destructive' | 'secondary' {
  switch (status) {
    case 'draft': return 'outline';
    case 'sent': return 'default';
    case 'partially_received': return 'warning';
    case 'received': return 'success';
    case 'cancelled': return 'destructive';
    case 'closed': return 'secondary';
    default: return 'secondary';
  }
}

export default function PurchaseOrdersPage() {
  const navigate = useNavigate();
  const { activeLocation, activeOrganization } = useAuth();
  const { locale } = useLocale();
  const { formatDate } = useDateTime();
  const [statusFilter, setStatusFilter] = useState<POStatus | 'all'>('all');
  const { pos, loading, error, createPO, submitPO } = usePOs(activeLocation?.id, statusFilter);
  const { suppliers } = useSuppliers(activeOrganization?.id);

  const [newPOOpen, setNewPOOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');

  const [detailPO, setDetailPO] = useState<PurchaseOrder | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitErr, setSubmitErr] = useState('');
  const [creatingReceipt, setCreatingReceipt] = useState(false);

  // Each PO carries its own currency: a supplier may invoice the store in a
  // currency the store does not trade in, so the record wins over the location.
  const fmtCents = (cents: number | null | undefined, currency: string) =>
    formatMoney(cents ?? 0, { currency, locale });

  const fmtDate = (iso: string | null | undefined) => (iso ? formatDate(iso) : '—');

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Seleccioná un local para consultar las órdenes de compra.</p>
      </div>
    );
  }

  async function handleCreatePO(payload: POFormPayload) {
    if (!activeLocation) return;
    setSaving(true);
    setSaveErr('');
    try {
      const created = await createPO({ ...payload, location_id: activeLocation.id });
      setNewPOOpen(false);
      setDetailPO(created);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : 'No se pudo crear la orden de compra');
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmitPO(po: PurchaseOrder) {
    setSubmitting(true);
    setSubmitErr('');
    try {
      const updated = await submitPO(po.id);
      setDetailPO(updated);
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'No se pudo enviar la orden de compra');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateReceipt(po: PurchaseOrder) {
    setCreatingReceipt(true);
    setSubmitErr('');
    try {
      const { error } = await api.request('POST', '/inventory/goods-receipts', {
        body: { purchase_order_id: po.id },
      });
      if (error) throw new Error(error.message);
      void navigate('/inventory/grns');
    } catch (e) {
      setSubmitErr(e instanceof Error ? e.message : 'No se pudo preparar la recepción');
    } finally {
      setCreatingReceipt(false);
    }
  }

  const supplierMap: Record<string, string> = Object.fromEntries(suppliers.map((s) => [s.id, s.name]));

  return (
    <PageContainer>
      <PageHeader
        icon={ShoppingCart}
        title="Órdenes de compra"
        description={activeLocation.name}
        actions={
          <Button onClick={() => { setSaveErr(''); setNewPOOpen(true); }}>
            <Plus className="w-4 h-4 mr-2" /> Nueva orden
          </Button>
        }
      />

      {/* Status filter */}
      <div className="max-w-xs">
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as POStatus | 'all')}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* States */}
      {loading && (
        <div className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />
          ))}
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center gap-2 text-destructive bg-destructive/10 border border-destructive/20 rounded p-3">
          <AlertCircle className="w-4 h-4" />
          <span>{error}</span>
        </div>
      )}

      {!loading && !error && pos.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <ShoppingCart className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No hay órdenes de compra. Creá la primera.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && pos.length > 0 && (
        <div className="space-y-2">
          {pos.map((po) => (
            <Card
              key={po.id}
              variant="interactive"
              className="cursor-pointer"
              onClick={() => { setSubmitErr(''); setDetailPO(po); }}
            >
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-foreground">{po.po_number}</span>
                    <Badge variant={poStatusVariant(po.status)}>
                      {PO_STATUS_LABEL[po.status] || po.status}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {supplierMap[String(po.supplier_id)] || 'Sin proveedor'} &middot; {fmtDate(po.created_at)}
                    {po.expected_delivery_date && ` &middot; Entrega estimada: ${fmtDate(po.expected_delivery_date)}`}
                  </p>
                </div>
                <div className="text-right shrink-0">
                  <p className="font-semibold text-foreground tabular-nums">{fmtCents(po.total_cents, po.currency)}</p>
                  <p className="text-xs text-muted-foreground">{po.currency}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* New PO Dialog */}
      <Dialog open={newPOOpen} onOpenChange={(v) => { if (!v) setNewPOOpen(false); }}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Nueva orden de compra</DialogTitle>
            <DialogDescription>Creá una orden de compra para {activeLocation.name}</DialogDescription>
          </DialogHeader>
          {saveErr && <p className="text-sm text-destructive">{saveErr}</p>}
          <POForm
            locationId={activeLocation.id}
            suppliers={suppliers}
            onSubmit={handleCreatePO}
            onCancel={() => setNewPOOpen(false)}
            saving={saving}
          />
        </DialogContent>
      </Dialog>

      {/* Detail Dialog */}
      <Dialog open={!!detailPO} onOpenChange={(v) => { if (!v) setDetailPO(null); }}>
        <DialogContent className="max-w-lg">
          {detailPO && (
            <>
              <DialogHeader>
                <DialogTitle>Orden {detailPO.po_number}</DialogTitle>
                <DialogDescription>
                  <Badge variant={poStatusVariant(detailPO.status)}>{PO_STATUS_LABEL[detailPO.status] || detailPO.status}</Badge>
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2 text-sm text-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <div><span className="text-muted-foreground">Proveedor</span><br />{supplierMap[String(detailPO.supplier_id)] || '—'}</div>
                  <div><span className="text-muted-foreground">Creada</span><br />{fmtDate(detailPO.created_at)}</div>
                  <div><span className="text-muted-foreground">Entrega estimada</span><br />{fmtDate(detailPO.expected_delivery_date)}</div>
                  <div><span className="text-muted-foreground">Moneda</span><br />{detailPO.currency}</div>
                </div>
                <div className="border border-border rounded p-3 space-y-1 mt-2 tabular-nums">
                  <div className="flex justify-between"><span>Subtotal</span><span>{fmtCents(detailPO.subtotal_cents, detailPO.currency)}</span></div>
                  <div className="flex justify-between"><span>Impuestos</span><span>{fmtCents(detailPO.tax_cents, detailPO.currency)}</span></div>
                  <div className="flex justify-between"><span>Envío</span><span>{fmtCents(detailPO.shipping_cents, detailPO.currency)}</span></div>
                  <div className="flex justify-between font-semibold border-t border-border pt-1"><span>Total</span><span>{fmtCents(detailPO.total_cents, detailPO.currency)}</span></div>
                </div>
                {detailPO.notes && <p className="text-muted-foreground italic">{detailPO.notes}</p>}
              </div>

              {submitErr && <p className="text-sm text-destructive">{submitErr}</p>}

              <div className="flex gap-3 pt-2">
                <Button variant="outline" onClick={() => setDetailPO(null)} className="flex-1">Cerrar</Button>
                {detailPO.status === 'draft' && (
                  <Button
                    onClick={() => handleSubmitPO(detailPO)}
                    disabled={submitting}
                    className="flex-1"
                  >
                    <Send className="w-4 h-4 mr-2" />
                    {submitting ? 'Enviando…' : 'Enviar al proveedor'}
                  </Button>
                )}
                {(detailPO.status === 'sent' || detailPO.status === 'partially_received') && (
                  <Button onClick={() => void handleCreateReceipt(detailPO)} disabled={creatingReceipt} className="flex-1">
                    <PackageCheck className="w-4 h-4 mr-2" />
                    {creatingReceipt ? 'Preparando…' : 'Registrar recepción'}
                  </Button>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
