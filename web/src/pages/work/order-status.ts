export interface POSOrderStatusInput {
  status: string;
  fulfillment_type?: string | null;
  order_type?: string | null;
}

export interface POSOrderAction {
  nextStatus: string;
  label: string;
}

export function fulfillmentLabel(order: POSOrderStatusInput): string {
  const fulfillment = order.fulfillment_type || order.order_type;
  if (fulfillment === 'delivery') return 'Delivery';
  if (fulfillment === 'dine_in') return 'Consumo en el local';
  if (['collection', 'pickup', 'takeaway'].includes(fulfillment || '')) return 'Retiro en el local';
  return 'Modalidad a confirmar';
}

/** POS advances only the hand-off steps; Cocina remains the source of truth for preparation. */
export function nextPOSOrderAction(order: POSOrderStatusInput): POSOrderAction | null {
  const fulfillment = order.fulfillment_type || order.order_type;
  if (order.status === 'pending') return { nextStatus: 'confirmed', label: 'Aceptar pedido' };
  if (order.status === 'ready') {
    if (fulfillment === 'delivery') return { nextStatus: 'out_for_delivery', label: 'Iniciar reparto' };
    if (['collection', 'pickup', 'takeaway'].includes(fulfillment || '')) {
      return { nextStatus: 'completed', label: 'Marcar retirado' };
    }
    if (fulfillment === 'dine_in') return { nextStatus: 'completed', label: 'Marcar servido' };
  }
  if (order.status === 'out_for_delivery' && fulfillment === 'delivery') {
    return { nextStatus: 'delivered', label: 'Confirmar entrega' };
  }
  return null;
}

export function orderStatusLabel(status: string, order?: POSOrderStatusInput): string {
  const fulfillment = order?.fulfillment_type || order?.order_type;
  if (status === 'ready') {
    if (fulfillment === 'delivery') return 'Listo para despacho';
    if (['collection', 'pickup', 'takeaway'].includes(fulfillment || '')) return 'Listo para retirar';
    if (fulfillment === 'dine_in') return 'Listo para servir';
  }
  if (status === 'completed') {
    if (['collection', 'pickup', 'takeaway'].includes(fulfillment || '')) return 'Retirado';
    if (fulfillment === 'dine_in') return 'Servido';
  }
  const labels: Record<string, string> = {
    pending: 'Nuevo pedido',
    confirmed: 'Aceptado',
    preparing: 'En preparación',
    ready: 'Listo',
    out_for_delivery: 'En reparto',
    delivered: 'Entregado',
    completed: 'Finalizado',
    cancelled: 'Cancelado',
    pending_on_delivery: 'Pago pendiente al entregar',
  };
  return labels[status] || 'Estado: ' + status;
}

export function orderStatusGroup(status: string): 'new' | 'kitchen' | 'handoff' | 'closed' {
  if (status === 'pending') return 'new';
  if (status === 'confirmed' || status === 'preparing') return 'kitchen';
  if (status === 'ready' || status === 'out_for_delivery' || status === 'pending_on_delivery') return 'handoff';
  return 'closed';
}
