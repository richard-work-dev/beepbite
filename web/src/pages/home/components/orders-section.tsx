import { useState, type ReactNode } from 'react';
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Search,
  Package,
  Timer,
  Eye,
  Edit,
  PhoneCall,
  X,
  ArrowLeft,
  User,
  MapPin,
  Banknote,
  CreditCard,
  ShoppingBag,
  FileText,
  Calendar,
  Utensils,
  AlertCircle,
  ChevronRight,
} from 'lucide-react';
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from 'date-fns';
import { es } from 'date-fns/locale';
import { markPaidOnDelivery } from '@/services/payments';
import { hasCapability } from '@/services/pos';
import { useMoney } from '@/context/locale-context';
import type { HomeOrder, HomeOrderDetails, HomeOrderEditFormData } from '../types';

// ── Status colour helpers (kept in this file so they stay co-located) ───────

// Shorter label for CTA buttons
function getStatusLabelShort(status: string): string {
  const labels: Record<string, string> = {
    pending:          'Pendiente',
    confirmed:        'Confirmado',
    preparing:        'En preparación',
    ready:            'Listo',
    out_for_delivery: 'En reparto',
    delivered:        'Entregado',
    completed:        'Completado',
    cancelled:        'Cancelado',
  };
  return labels[status] || status;
}

// ── Skeleton card ─────────────────────────────────────────────────────────────

function OrderCardSkeleton() {
  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3 animate-pulse">
      <div className="flex items-center justify-between">
        <Skeleton className="h-5 w-24 rounded" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3.5 w-40 rounded" />
        <Skeleton className="h-3.5 w-28 rounded" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1 rounded-lg" />
        <Skeleton className="h-9 w-9 rounded-lg" />
        <Skeleton className="h-9 w-9 rounded-lg" />
      </div>
    </div>
  );
}

// ── Info row (used in detail / edit panels) ───────────────────────────────────

interface InfoRowProps {
  label: string;
  children?: ReactNode;
  className?: string;
}

function InfoRow({ label, children, className }: InfoRowProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3 py-2 border-b border-border last:border-0', className)}>
      <span className="text-xs font-medium text-muted-foreground flex-shrink-0 pt-0.5">{label}</span>
      <div className="text-sm text-foreground text-right">{children}</div>
    </div>
  );
}

// ── Panel header (back + title + badge) ───────────────────────────────────────

interface PanelHeaderProps {
  onBack: () => void;
  title: string;
  orderNumber: string;
  statusBadge?: ReactNode;
}

function PanelHeader({ onBack, title, orderNumber, statusBadge }: PanelHeaderProps) {
  return (
    <div className="flex-shrink-0 flex items-center gap-2 px-4 py-3 border-b border-border bg-card">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={onBack}
        aria-label="Volver a la lista de pedidos"
        className="h-8 w-8 rounded-full text-muted-foreground hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary flex-shrink-0"
      >
        <ArrowLeft className="w-4 h-4" aria-hidden="true" />
      </Button>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="text-sm font-bold text-foreground">{title}</h2>
          {statusBadge}
        </div>
        <p className="text-xs text-muted-foreground">#{orderNumber}</p>
      </div>
    </div>
  );
}

// ── Order Details View ─────────────────────────────────────────────────────────

interface OrderDetailsViewProps {
  order: HomeOrder;
  selectedOrderDetails: HomeOrderDetails | null;
  loadingOrderDetails: boolean;
  onBack: () => void;
  onEdit: (order: HomeOrder) => void;
  updateOrderStatus: (orderId: string, newStatus: string) => void;
  getStatusColor: (status: string) => string;
  getNextStatus: (status: string) => string | undefined;
  getStatusLabel: (status: string) => string;
}

function OrderDetailsView({
  order,
  selectedOrderDetails,
  loadingOrderDetails,
  onBack,
  onEdit,
  updateOrderStatus,
  getStatusColor,
  getNextStatus,
  getStatusLabel,
}: OrderDetailsViewProps) {
  // Line prices arrive as major-unit floats; `scale` is 1 in JPY and 1000 in
  // KWD, so a literal 100 would misplace the decimal point.
  const { format, scale } = useMoney();
  const toMinor = (major: number | string | null | undefined) => Math.round(parseFloat(String(major || 0)) * scale);

  return (
    <div className="absolute inset-0 flex flex-col">
      <PanelHeader
        onBack={onBack}
        title="Detalles del pedido"
        orderNumber={order.order_number}
        statusBadge={
          <Badge className={cn('text-xs font-medium px-2 py-0.5', getStatusColor(order.status))}>
            {getStatusLabel(order.status)}
          </Badge>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {loadingOrderDetails ? (
          <div className="p-4 space-y-3">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-28 w-full rounded-xl" />
            ))}
          </div>
        ) : selectedOrderDetails ? (
          <div className="p-4 space-y-4 pb-6">
            {/* Order Items */}
            <section aria-label="Productos del pedido">
              <div className="flex items-center gap-1.5 mb-2">
                <Utensils className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Productos</h3>
              </div>
              <div className="rounded-xl border border-border bg-card overflow-hidden divide-y divide-border">
                {selectedOrderDetails.order_items && selectedOrderDetails.order_items.length > 0 ? (
                  <>
                    {selectedOrderDetails.order_items.map((item, index) => (
                      <div key={index} className="flex justify-between items-start p-3 gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="font-medium text-sm text-foreground truncate">
                            {item.items?.name || item.name || 'Producto desconocido'}
                          </p>
                          {item.items?.description && (
                            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{item.items.description}</p>
                          )}
                          {item.order_item_modifiers && item.order_item_modifiers.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {item.order_item_modifiers.map((mod, vIndex) => (
                                <span
                                  key={vIndex}
                                  className="inline-block bg-primary/10 text-primary rounded-full px-2 py-0.5 text-xs"
                                >
                                  {mod.name_snapshot}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                        <div className="text-right flex-shrink-0">
                          <p className="font-bold text-sm text-primary">
                            {format(toMinor(item.total_price))}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {Number(item.quantity) % 1 === 0 ? item.quantity : parseFloat(String(item.quantity)).toFixed(2)} × {format(toMinor(item.unit_price))}
                          </p>
                        </div>
                      </div>
                    ))}
                    {/* Total row */}
                    <div className="flex justify-between items-center px-3 py-2.5 bg-primary/10">
                      <span className="text-sm font-semibold text-foreground">Total</span>
                      <span className="font-bold text-primary">
                        {format(selectedOrderDetails.order_items.reduce((t, i) => t + toMinor(i.total_price), 0))}
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center py-8 gap-2">
                    <Utensils className="w-8 h-8 text-muted-foreground" aria-hidden="true" />
                    <p className="text-sm text-muted-foreground">No se encontraron productos</p>
                  </div>
                )}
              </div>
            </section>

            {/* Customer */}
            <section aria-label="Información del cliente">
              <div className="flex items-center gap-1.5 mb-2">
                <User className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Cliente</h3>
              </div>
              <div className="rounded-xl border border-border bg-card px-3 py-1">
                <InfoRow label="Nombre">
                  {selectedOrderDetails.customers?.first_name} {selectedOrderDetails.customers?.last_name || 'N/A'}
                </InfoRow>
                <InfoRow label="Teléfono">
                  <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded-full text-xs font-medium">
                    <PhoneCall className="w-3 h-3" aria-hidden="true" />
                    {selectedOrderDetails.customers?.whatsapp_number || 'Sin teléfono'}
                  </span>
                </InfoRow>
                {selectedOrderDetails.customers?.email && (
                  <InfoRow label="Correo">{selectedOrderDetails.customers.email}</InfoRow>
                )}
              </div>
            </section>

            {/* Order Info */}
            <section aria-label="Información del pedido">
              <div className="flex items-center gap-1.5 mb-2">
                <ShoppingBag className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Datos del pedido</h3>
              </div>
              <div className="rounded-xl border border-border bg-card px-3 py-1">
                <InfoRow label="Tipo">
                  <span className="capitalize bg-muted text-muted-foreground px-2 py-0.5 rounded text-xs">
                    {selectedOrderDetails.order_type === 'delivery'
                      ? 'Entrega a domicilio'
                      : selectedOrderDetails.order_type === 'pickup'
                        ? 'Retiro'
                        : selectedOrderDetails.order_type === 'dine_in'
                          ? 'Consumo en el local'
                          : selectedOrderDetails.order_type || 'Entrega a domicilio'}
                  </span>
                </InfoRow>
                <InfoRow label="Creado">
                  <span className="inline-flex items-center gap-1 text-muted-foreground text-xs">
                    <Calendar className="w-3 h-3" aria-hidden="true" />
                    {formatDistanceToNow(new Date(selectedOrderDetails.created_at), { addSuffix: true, locale: es })}
                  </span>
                </InfoRow>
                {selectedOrderDetails.estimated_prep_time && (
                  <InfoRow label="Tiempo de preparación">
                    <span className="inline-flex items-center gap-1 bg-primary/10 text-primary px-2 py-0.5 rounded text-xs">
                      <Timer className="w-3 h-3" aria-hidden="true" />
                      {selectedOrderDetails.estimated_prep_time} min
                    </span>
                  </InfoRow>
                )}
                <InfoRow label="Estado">
                  <Badge className={cn('text-xs px-2 py-0.5', getStatusColor(selectedOrderDetails.status))}>
                    {getStatusLabel(selectedOrderDetails.status)}
                  </Badge>
                </InfoRow>
              </div>
            </section>

            {/* Delivery */}
            {selectedOrderDetails.delivery_address && (
              <section aria-label="Información de entrega">
                <div className="flex items-center gap-1.5 mb-2">
                  <MapPin className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entrega</h3>
                </div>
                <div className="rounded-xl border border-border bg-card px-3 py-1">
                  <InfoRow label="Dirección">{selectedOrderDetails.delivery_address}</InfoRow>
                  {selectedOrderDetails.delivery_instructions && (
                    <InfoRow label="Instrucciones">
                      <span className="bg-warning/10 text-warning px-2 py-0.5 rounded text-xs">
                        {selectedOrderDetails.delivery_instructions}
                      </span>
                    </InfoRow>
                  )}
                </div>
              </section>
            )}

            {/* Notes */}
            {(selectedOrderDetails.notes || selectedOrderDetails.kitchen_notes) && (
              <section aria-label="Notas del pedido">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notas</h3>
                </div>
                <div className="rounded-xl border border-border bg-card px-3 py-1">
                  {selectedOrderDetails.notes && (
                    <InfoRow label="General">
                      <span className="bg-muted text-muted-foreground px-2 py-0.5 rounded text-xs">
                        {selectedOrderDetails.notes}
                      </span>
                    </InfoRow>
                  )}
                  {selectedOrderDetails.kitchen_notes && (
                    <InfoRow label="Cocina">
                      <span className="bg-primary/10 text-primary px-2 py-0.5 rounded text-xs">
                        {selectedOrderDetails.kitchen_notes}
                      </span>
                    </InfoRow>
                  )}
                </div>
              </section>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              {(() => {
                const nextStatus = getNextStatus(order.status);
                return nextStatus && (
                  <Button
                    onClick={() => updateOrderStatus(order.id, nextStatus)}
                    className="flex-1 h-11 rounded-xl text-sm font-semibold"
                  >
                    {getStatusLabelShort(nextStatus)}
                    <ChevronRight className="w-4 h-4 ml-1" aria-hidden="true" />
                  </Button>
                );
              })()}
              <Button
                variant="outline"
                onClick={() => onEdit(order)}
                className="h-11 px-4 rounded-xl border-border hover:bg-muted text-sm"
              >
                Editar
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 p-6">
            <AlertCircle className="w-12 h-12 text-muted-foreground" aria-hidden="true" />
            <p className="text-sm text-muted-foreground">No se pudieron cargar los detalles del pedido</p>
            <Button variant="outline" size="sm" onClick={onBack} className="rounded-lg">
              Volver
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Order Edit View ────────────────────────────────────────────────────────────

interface OrderEditViewProps {
  order: HomeOrder;
  editFormData: HomeOrderEditFormData;
  onInputChange: (field: keyof HomeOrderEditFormData, value: string | number) => void;
  onSave: () => void;
  onBack: () => void;
  getStatusColor: (status: string) => string;
  getStatusLabel: (status: string) => string;
}

function OrderEditView({
  order,
  editFormData,
  onInputChange,
  onSave,
  onBack,
  getStatusColor,
  getStatusLabel,
}: OrderEditViewProps) {
  return (
    <div className="absolute inset-0 flex flex-col">
      <PanelHeader
        onBack={onBack}
        title="Editar pedido"
        orderNumber={order.order_number}
        statusBadge={
          <Badge className={cn('text-xs font-medium px-2 py-0.5', getStatusColor(order.status))}>
            {getStatusLabel(order.status)}
          </Badge>
        }
      />

      <div className="flex-1 overflow-y-auto">
        <div className="p-4 space-y-4 pb-6">
          {/* Delivery Information */}
          <section aria-label="Información de entrega">
            <div className="flex items-center gap-1.5 mb-2">
              <MapPin className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Entrega</h3>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 space-y-3">
              <div>
                <label htmlFor="edit-delivery-address" className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Dirección de entrega
                </label>
                <Textarea
                  id="edit-delivery-address"
                  value={editFormData.delivery_address || ''}
                  onChange={(e) => onInputChange('delivery_address', e.target.value)}
                  placeholder="Ingresá la dirección de entrega…"
                  rows={2}
                  className="w-full text-sm rounded-lg border-border focus:border-primary focus:ring-primary/20"
                />
              </div>
              <div>
                <label htmlFor="edit-delivery-instructions" className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Instrucciones de entrega
                </label>
                <Textarea
                  id="edit-delivery-instructions"
                  value={editFormData.delivery_instructions || ''}
                  onChange={(e) => onInputChange('delivery_instructions', e.target.value)}
                  placeholder="Instrucciones especiales de entrega…"
                  rows={2}
                  className="w-full text-sm rounded-lg border-border focus:border-primary focus:ring-primary/20"
                />
              </div>
            </div>
          </section>

          {/* Order Settings */}
          <section aria-label="Configuración del pedido">
            <div className="flex items-center gap-1.5 mb-2">
              <Timer className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Configuración</h3>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <label htmlFor="edit-prep-time" className="block text-xs font-medium text-muted-foreground mb-1.5">
                Tiempo estimado de preparación (minutos)
              </label>
              <Input
                id="edit-prep-time"
                type="number"
                value={editFormData.estimated_prep_time || 30}
                onChange={(e) => onInputChange('estimated_prep_time', parseInt(e.target.value))}
                className="w-full text-sm rounded-lg border-border focus:border-primary focus:ring-primary/20"
                min="5"
                max="120"
              />
            </div>
          </section>

          {/* Notes */}
          <section aria-label="Notas del pedido">
            <div className="flex items-center gap-1.5 mb-2">
              <FileText className="w-3.5 h-3.5 text-primary" aria-hidden="true" />
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notas</h3>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 space-y-3">
              <div>
                <label htmlFor="edit-notes" className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Notas generales
                </label>
                <Textarea
                  id="edit-notes"
                  value={editFormData.notes || ''}
                  onChange={(e) => onInputChange('notes', e.target.value)}
                  placeholder="Notas generales del pedido…"
                  rows={2}
                  className="w-full text-sm rounded-lg border-border focus:border-primary focus:ring-primary/20"
                />
              </div>
              <div>
                <label htmlFor="edit-kitchen-notes" className="block text-xs font-medium text-muted-foreground mb-1.5">
                  Notas de cocina
                </label>
                <Textarea
                  id="edit-kitchen-notes"
                  value={editFormData.kitchen_notes || ''}
                  onChange={(e) => onInputChange('kitchen_notes', e.target.value)}
                  placeholder="Instrucciones especiales para cocina…"
                  rows={2}
                  className="w-full text-sm rounded-lg border-border focus:border-primary focus:ring-primary/20"
                />
              </div>
            </div>
          </section>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <Button
              onClick={onSave}
              className="flex-1 h-11 rounded-xl text-sm font-semibold"
            >
              Guardar cambios
            </Button>
            <Button
              variant="outline"
              onClick={onBack}
              className="h-11 px-4 rounded-xl border-border hover:bg-muted text-sm"
            >
              Cancelar
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Orders List View ───────────────────────────────────────────────────────────

type MarkPaidMethod = 'cash' | 'card_machine';

interface OrderCardProps {
  order: HomeOrder;
  getStatusColor: (status: string) => string;
  getNextStatus: (status: string) => string | undefined;
  getStatusLabel: (status: string) => string;
  updateOrderStatus: (orderId: string, newStatus: string) => void;
  onViewDetails: (order: HomeOrder) => void;
  onEditOrder: (order: HomeOrder) => void;
  canSettle: boolean;
  markingPaid: Record<string, MarkPaidMethod | null | undefined>;
  onMarkPaid: (orderId: string, method: MarkPaidMethod) => void;
}

function OrderCard({
  order,
  getStatusColor,
  getNextStatus,
  getStatusLabel,
  updateOrderStatus,
  onViewDetails,
  onEditOrder,
  canSettle,
  markingPaid,
  onMarkPaid,
}: OrderCardProps) {
  const nextStatus = getNextStatus(order.status);

  return (
    <article
      aria-label={`Pedido #${order.order_number}`}
      className="rounded-xl border border-border bg-card hover:border-primary/20 hover:shadow-sm transition-all duration-150 overflow-hidden"
    >
      <div className="p-3.5">
        {/* Top row: order number + status badge */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <h4 className="font-bold text-foreground text-sm truncate">#{order.order_number}</h4>
          <Badge
            className={cn('text-xs font-medium px-2 py-0.5 flex-shrink-0', getStatusColor(order.status))}
          >
            {getStatusLabel(order.status)}
          </Badge>
        </div>

        {/* Customer info */}
        <div className="space-y-0.5 mb-3">
          {order.customers?.first_name && (
            <p className="text-sm font-medium text-foreground truncate">
              {order.customers.first_name} {order.customers.last_name}
            </p>
          )}
          <p className="text-xs text-muted-foreground flex items-center gap-1 truncate">
            <PhoneCall className="w-3 h-3 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="truncate">{order.customers?.whatsapp_number || 'Sin teléfono'}</span>
          </p>
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Timer className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
            <span>{formatDistanceToNow(new Date(order.created_at), { addSuffix: true, locale: es })}</span>
          </p>
        </div>

        {/* Action row */}
        <div className="flex gap-1.5">
          {nextStatus && order.status !== 'pending_on_delivery' && (
            <Button
              size="sm"
              onClick={() => updateOrderStatus(order.id, nextStatus)}
              aria-label={`Avanzar pedido #${order.order_number} a ${getStatusLabel(nextStatus)}`}
              className="flex-1 h-9 rounded-lg text-xs font-semibold truncate"
            >
              {getStatusLabelShort(nextStatus)}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => onEditOrder(order)}
            aria-label={`Editar pedido #${order.order_number}`}
            className="h-9 w-9 p-0 flex-shrink-0 rounded-lg border-border hover:bg-primary/10 hover:border-primary/20 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Edit className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => onViewDetails(order)}
            aria-label={`Ver detalles del pedido #${order.order_number}`}
            className="h-9 w-9 p-0 flex-shrink-0 rounded-lg border-border hover:bg-primary/10 hover:border-primary/20 focus-visible:ring-2 focus-visible:ring-primary"
          >
            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
          </Button>
        </div>

        {/* Mark-paid buttons for pending_on_delivery orders */}
        {order.status === 'pending_on_delivery' && canSettle && (
          <div className="flex gap-1.5 mt-1.5">
            <Button
              size="sm"
              variant="outline"
              disabled={!!markingPaid[order.id]}
              onClick={() => onMarkPaid(order.id, 'cash')}
              aria-label="Marcar como pagado en efectivo"
              className="flex-1 border-success/30 text-success hover:bg-success/10 h-9 rounded-lg text-xs gap-1 font-medium"
            >
              {markingPaid[order.id] === 'cash' ? (
                <>
                  <span
                    className="inline-block h-3 w-3 border-2 border-success border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                  />
                  Marcando…
                </>
              ) : (
                <>
                  <Banknote className="w-3.5 h-3.5" aria-hidden="true" />
                  Efectivo
                </>
              )}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={!!markingPaid[order.id]}
              onClick={() => onMarkPaid(order.id, 'card_machine')}
              aria-label="Marcar como pagado con tarjeta"
              className="flex-1 border-success/30 text-success hover:bg-success/10 h-9 rounded-lg text-xs gap-1 font-medium"
            >
              {markingPaid[order.id] === 'card_machine' ? (
                <>
                  <span
                    className="inline-block h-3 w-3 border-2 border-success border-t-transparent rounded-full animate-spin"
                    aria-hidden="true"
                  />
                  Marcando…
                </>
              ) : (
                <>
                  <CreditCard className="w-3.5 h-3.5" aria-hidden="true" />
                  Tarjeta
                </>
              )}
            </Button>
          </div>
        )}
      </div>
    </article>
  );
}

// ── Main Component ─────────────────────────────────────────────────────────────

interface OrdersSectionProps {
  orders: HomeOrder[];
  loadingOrders: boolean;
  orderSearchTerm: string;
  setOrderSearchTerm: (term: string) => void;
  orderStatusFilter: string;
  setOrderStatusFilter: (filter: string) => void;
  filteredOrders: HomeOrder[];
  updateOrderStatus: (orderId: string, newStatus: string) => void;
  setEditingOrder: (order: HomeOrder | null) => void;
  setIsOrderEditModalOpen: (open: boolean) => void;
  viewOrderDetails: (order: HomeOrder) => void;
  getStatusColor: (status: string) => string;
  getNextStatus: (status: string) => string | undefined;
  getStatusLabel: (status: string) => string;
  isOrdersExpanded: boolean;
}

type OrdersSectionView = 'list' | 'details' | 'edit';

const OrdersSection = ({
  orders,
  loadingOrders,
  orderSearchTerm,
  setOrderSearchTerm,
  orderStatusFilter,
  setOrderStatusFilter,
  filteredOrders,
  updateOrderStatus,
  setEditingOrder,
  setIsOrderEditModalOpen,
  viewOrderDetails,
  getStatusColor,
  getNextStatus,
  getStatusLabel,
  isOrdersExpanded,
}: OrdersSectionProps) => {
  // Local state for inline views
  const [currentView, setCurrentView] = useState<OrdersSectionView>('list');
  const [selectedOrder, setSelectedOrder] = useState<HomeOrder | null>(null);
  const [selectedOrderDetails, setSelectedOrderDetails] = useState<HomeOrderDetails | null>(null);
  const [loadingOrderDetails, setLoadingOrderDetails] = useState(false);
  const [editFormData, setEditFormData] = useState<HomeOrderEditFormData>({});

  // Mark-paid-on-delivery state
  const [markingPaid, setMarkingPaid] = useState<Record<string, MarkPaidMethod | null | undefined>>({});
  const [markPaidError, setMarkPaidError] = useState<string | null>(null);

  const canSettle = hasCapability('can_settle');

  const handleMarkPaid = async (orderId: string, method: MarkPaidMethod) => {
    if (!canSettle) {
      setMarkPaidError("Necesitás permiso para marcar como pagado. Consultá con un encargado.");
      return;
    }
    setMarkingPaid((prev) => ({ ...prev, [orderId]: method }));
    try {
      const { error } = await markPaidOnDelivery(orderId, method);
      if (error) {
        if (error.status === 403) {
          setMarkPaidError("Necesitás permiso para marcar como pagado. Consultá con un encargado.");
        } else {
          setMarkPaidError(error.message || 'No se pudo marcar como pagado.');
        }
        return;
      }
      updateOrderStatus(orderId, 'completed');
    } finally {
      setMarkingPaid((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
    }
  };

  const handleViewDetails = async (order: HomeOrder) => {
    setSelectedOrder(order);
    setCurrentView('details');
    setLoadingOrderDetails(true);
    try {
      const { supabase } = await import('@/services/supabase-client');
      const { data: orderDetails, error: orderError } = await supabase
        .from('pedidos')
        .select(`
          *,
          customers (
            id,
            first_name,
            last_name,
            whatsapp_number,
            email
          )
        `)
        .eq('id', order.id)
        .single();

      if (orderError) throw orderError;

      const { data: orderItems, error: itemsError } = await supabase
        .from('order_items')
        .select(`
          *,
          items (
            id,
            name,
            description
          ),
          order_item_modifiers (
            name_snapshot,
            price_cents_snapshot
          )
        `)
        .eq('order_id', order.id);

      if (itemsError) throw itemsError;

      setSelectedOrderDetails({ ...orderDetails, order_items: orderItems || [] });
    } catch (error) {
      console.error('Error fetching order details:', error);
      alert('No se pudieron cargar los detalles del pedido');
      handleBackToList();
    } finally {
      setLoadingOrderDetails(false);
    }
  };

  const handleEditOrder = (order: HomeOrder) => {
    setSelectedOrder(order);
    setEditFormData({
      delivery_address: order.delivery_address || '',
      delivery_instructions: order.delivery_instructions || '',
      notes: order.notes || '',
      kitchen_notes: order.kitchen_notes || '',
      estimated_prep_time: order.estimated_prep_time || 30,
    });
    setCurrentView('edit');
  };

  const handleBackToList = () => {
    setCurrentView('list');
    setSelectedOrder(null);
    setSelectedOrderDetails(null);
    setLoadingOrderDetails(false);
    setEditFormData({});
  };

  // Not async: no await in the body. (Separately, and out of scope for
  // this lint pass: this only logs + navigates back — it doesn't actually
  // persist editFormData anywhere yet.)
  const handleSaveEdit = () => {
    console.log('Saving order edit:', selectedOrder?.id, editFormData);
    handleBackToList();
  };

  const handleInputChange = (field: keyof HomeOrderEditFormData, value: string | number) => {
    setEditFormData((prev) => ({ ...prev, [field]: value }));
  };

  // ── Sub-view routing ───────────────────────────────────────────────────────

  if (currentView === 'details' && selectedOrder) {
    return (
      <OrderDetailsView
        order={selectedOrder}
        selectedOrderDetails={selectedOrderDetails}
        loadingOrderDetails={loadingOrderDetails}
        onBack={handleBackToList}
        onEdit={handleEditOrder}
        updateOrderStatus={updateOrderStatus}
        getStatusColor={getStatusColor}
        getNextStatus={getNextStatus}
        getStatusLabel={getStatusLabel}
      />
    );
  }

  if (currentView === 'edit' && selectedOrder) {
    return (
      <OrderEditView
        order={selectedOrder}
        editFormData={editFormData}
        onInputChange={handleInputChange}
        onSave={handleSaveEdit}
        onBack={handleBackToList}
        getStatusColor={getStatusColor}
        getStatusLabel={getStatusLabel}
      />
    );
  }

  // ── Default: List view ─────────────────────────────────────────────────────

  return (
    <div className="absolute inset-0 flex flex-col">
      {/* Permission error modal */}
      {markPaidError && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="perm-error-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
        >
          <div className="bg-card rounded-2xl shadow-2xl max-w-sm w-full p-5 space-y-4">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" aria-hidden="true" />
              <div>
                <p id="perm-error-title" className="font-semibold text-foreground text-sm">Permiso requerido</p>
                <p className="text-sm text-muted-foreground mt-1">{markPaidError}</p>
              </div>
            </div>
            <div className="flex justify-end">
              <Button
                size="sm"
                onClick={() => setMarkPaidError(null)}
                className="rounded-lg h-9 px-4"
              >
                OK
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Search + filter header */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-border bg-muted/80">
        <div className="flex gap-2 items-center">
          {/* Search */}
          <div className="relative flex-1">
            <Search
              className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground w-3.5 h-3.5 pointer-events-none"
              aria-hidden="true"
            />
            <Input
              placeholder="Buscar pedidos…"
              value={orderSearchTerm}
              onChange={(e) => setOrderSearchTerm(e.target.value)}
              aria-label="Buscar pedidos"
              className="pl-8 h-9 text-sm border-border focus:border-primary focus:ring-primary/20 rounded-lg pr-8"
            />
            {orderSearchTerm && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setOrderSearchTerm('')}
                aria-label="Limpiar búsqueda"
                className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </Button>
            )}
          </div>

          {/* Status filter */}
          <div
            role="group"
            aria-label="Filtro de estado del pedido"
            className="flex gap-1 flex-shrink-0"
          >
            {['active', 'all'].map((f) => (
              <Button
                key={f}
                type="button"
                size="sm"
                variant={orderStatusFilter === f ? 'default' : 'outline'}
                onClick={() => setOrderStatusFilter(f)}
                aria-pressed={orderStatusFilter === f}
                className={cn(
                  'h-9 px-3 text-xs font-medium focus-visible:ring-2 focus-visible:ring-primary',
                  orderStatusFilter !== f && 'hover:bg-primary/10 hover:border-primary/20'
                )}
              >
                {f === 'active' ? 'Activos' : 'Todos'}
              </Button>
            ))}
          </div>
        </div>
      </div>

      {/* Orders list */}
      <div className="flex-1 overflow-y-auto p-3" role="feed" aria-label="Lista de pedidos" aria-busy={loadingOrders}>
        {loadingOrders ? (
          <div className="space-y-2.5">
            {[...Array(4)].map((_, i) => (
              <OrderCardSkeleton key={i} />
            ))}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full min-h-[200px] gap-3 py-8">
            <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center">
              <Package className="w-7 h-7 text-muted-foreground" aria-hidden="true" />
            </div>
            <div className="text-center">
              <p className="text-sm font-medium text-muted-foreground">
                {orderSearchTerm ? 'No se encontraron pedidos' : 'No hay pedidos'}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {orderSearchTerm
                  ? 'Probá con otra búsqueda o filtro'
                  : orderStatusFilter === 'all'
                    ? 'No hay pedidos en este momento'
                    : 'No hay pedidos con este estado en este momento'}
              </p>
            </div>
            {orderSearchTerm && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={() => setOrderSearchTerm('')}
                className="h-auto p-0 text-xs text-primary hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-primary"
              >
                Limpiar búsqueda
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-2.5">
            {filteredOrders.map((order) => (
              <OrderCard
                key={order.id}
                order={order}
                getStatusColor={getStatusColor}
                getNextStatus={getNextStatus}
                getStatusLabel={getStatusLabel}
                updateOrderStatus={updateOrderStatus}
                onViewDetails={handleViewDetails}
                onEditOrder={handleEditOrder}
                canSettle={canSettle}
                markingPaid={markingPaid}
                onMarkPaid={handleMarkPaid}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default OrdersSection;
