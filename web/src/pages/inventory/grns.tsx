import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Package, AlertCircle, CheckCircle, RefreshCw } from 'lucide-react';
import { useAuth } from '@/context/auth-context';
import { api } from '@/lib/api-client';
import { PageContainer, PageHeader } from '@/components/ui/page-header';
import type { GoodsReceipt, ReceiveGRNResult } from './types';

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-AR');
}

export default function GRNsPage() {
  const { activeLocation } = useAuth();
  const [grns, setGRNs] = useState<GoodsReceipt[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const [confirmGRN, setConfirmGRN] = useState<GoodsReceipt | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [receiveResult, setReceiveResult] = useState<ReceiveGRNResult | null>(null);
  const [receiveErr, setReceiveErr] = useState('');

  const fetchGRNs = useCallback(async () => {
    if (!activeLocation) return;
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await api.request<GoodsReceipt[]>(
        'GET',
        `/inventory/goods-receipts?location_id=${encodeURIComponent(activeLocation.id)}`,
      );
      if (err) throw new Error(err.message);
      setGRNs(data || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudieron cargar las recepciones');
    } finally {
      setLoading(false);
    }
  }, [activeLocation]);

  // fetchGRNs() is fully try/catch/finally-wrapped above.
  useEffect(() => { void fetchGRNs(); }, [fetchGRNs]);

  async function handleReceive() {
    if (!confirmGRN) return;
    setReceiving(true);
    setReceiveErr('');
    setReceiveResult(null);
    try {
      const { data, error: err } = await api.request<ReceiveGRNResult>(
        'POST',
        `/inventory/goods-receipts/${confirmGRN.id}/receive`,
        { body: {} }
      );
      if (err) throw new Error(err.message);
      setReceiveResult(data);
      await fetchGRNs();
    } catch (e) {
      setReceiveErr(e instanceof Error ? e.message : 'No se pudo confirmar la recepción');
    } finally {
      setReceiving(false);
    }
  }

  function openConfirm(grn: GoodsReceipt) {
    setConfirmGRN(grn);
    setReceiveResult(null);
    setReceiveErr('');
  }

  function closeConfirm() {
    setConfirmGRN(null);
    setReceiveResult(null);
    setReceiveErr('');
  }

  const isReceived = (grn: GoodsReceipt) => !!grn.received_at;

  if (!activeLocation) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <AlertCircle className="w-12 h-12 text-muted-foreground mb-4" />
        <p className="text-muted-foreground">Seleccioná un local para consultar las recepciones.</p>
      </div>
    );
  }

  return (
    <PageContainer>
      <PageHeader
        icon={Package}
        title="Recepciones de mercadería"
        description={`Ingresos de stock de ${activeLocation.name}`}
        actions={
          <Button variant="outline" onClick={fetchGRNs}>
            <RefreshCw className="mr-2 size-4" /> Actualizar
          </Button>
        }
      />

      {loading && (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
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

      {!loading && !error && grns.length === 0 && (
        <Card>
          <CardContent className="p-10 text-center">
            <Package className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">No hay recepciones pendientes ni completadas.</p>
            <p className="mt-1 text-sm text-muted-foreground">Desde una orden enviada podés registrar la recepción de mercadería.</p>
          </CardContent>
        </Card>
      )}

      {!loading && !error && grns.length > 0 && (
        <div className="space-y-2">
          {grns.map((grn) => {
            const received = isReceived(grn);
            return (
              <Card key={grn.id} variant="interactive">
                <CardContent className="p-4 flex items-center gap-4">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-foreground">
                        {grn.receipt_number || grn.id.slice(0, 8)}
                      </span>
                      <Badge variant={received ? 'success' : 'warning'}>
                        {received ? 'Recibida' : 'Pendiente'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Orden: {grn.po_number || `${grn.purchase_order_id?.slice(0, 8)}…`}
                      {grn.supplier_name && ` · ${grn.supplier_name}`}
                      &middot; Creada {fmtDate(grn.created_at)}
                      {received && ` · Recibida ${fmtDate(grn.received_at)}`}
                    </p>
                    {grn.delivery_note_number && (
                      <p className="text-xs text-muted-foreground">Remito: {grn.delivery_note_number}</p>
                    )}
                    <p className="text-xs text-muted-foreground">{grn.line_count ?? 0} {(grn.line_count ?? 0) === 1 ? 'insumo' : 'insumos'}</p>
                  </div>
                  {!received && (
                    <Button
                      size="sm"
                      onClick={() => openConfirm(grn)}
                      className="shrink-0"
                    >
                      Confirmar ingreso
                    </Button>
                  )}
                  {received && (
                    <CheckCircle className="w-5 h-5 text-success shrink-0" />
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Confirm receive dialog */}
      <Dialog open={!!confirmGRN} onOpenChange={(v) => { if (!v) closeConfirm(); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Confirmar recepción</DialogTitle>
            <DialogDescription>
              Esta acción actualizará las existencias y registrará un movimiento de compra por cada producto.
            </DialogDescription>
          </DialogHeader>

          {confirmGRN && !receiveResult && (
            <div className="text-sm text-foreground space-y-1">
              <p>Recepción: <strong>{confirmGRN.receipt_number || confirmGRN.id.slice(0, 8)}</strong></p>
              <p>Orden: {confirmGRN.po_number || `${confirmGRN.purchase_order_id?.slice(0, 8)}…`}</p>
              {confirmGRN.supplier_name && <p>Proveedor: {confirmGRN.supplier_name}</p>}
              <div className="mt-3 overflow-hidden rounded border border-border">
                {(confirmGRN.lines || []).map((line) => (
                  <div key={line.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0">
                    <span className="truncate font-medium">{line.item_name}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {line.quantity_received} {line.unit}
                    </span>
                  </div>
                ))}
                {(confirmGRN.lines || []).length === 0 && (
                  <p className="px-3 py-2 text-muted-foreground">{confirmGRN.line_count ?? 0} insumos</p>
                )}
              </div>
            </div>
          )}

          {receiveResult && (
            <div className="flex items-center gap-2 text-success bg-success/10 rounded p-3 text-sm">
              <CheckCircle className="w-4 h-4" />
              <span>Se recibieron {receiveResult.lines_processed} {receiveResult.lines_processed === 1 ? 'insumo' : 'insumos'}. El stock fue actualizado.</span>
            </div>
          )}

          {receiveErr && <p className="text-sm text-destructive">{receiveErr}</p>}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={closeConfirm} className="flex-1">
              {receiveResult ? 'Cerrar' : 'Cancelar'}
            </Button>
            {!receiveResult && (
              <Button
                onClick={handleReceive}
                disabled={receiving}
                className="flex-1"
              >
                {receiving ? 'Actualizando…' : 'Confirmar recepción'}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
