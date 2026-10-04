export interface POSOrderStatusInput {
  status: string;
  fulfillment_type?: string | null;
  order_type?: string | null;
  payment_status?: string | null;
  payment_method?: string | null;
  driver_assignment_status?: string | null;
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
  if (['out_for_delivery', 'pending_on_delivery'].includes(order.status) && fulfillment === 'delivery') {
    return { nextStatus: 'delivered', label: 'Confirmar entrega' };
  }
  return null;
}

export function needsPayment(order: POSOrderStatusInput): boolean {
  return order.status !== 'cancelled' && order.payment_status !== 'paid';
}

export function handoffBlockReason(order: POSOrderStatusInput): string | null {
  const mode = order.fulfillment_type || order.order_type;
  if (mode === 'delivery' && ['offered', 'assigned', 'accepted', 'picked_up'].includes(order.driver_assignment_status || '')) {
    return 'El repartidor asignado confirma el retiro y la entrega desde Reparto.';
  }
  if (order.status !== 'ready' || !needsPayment(order)) return null;
  if (['collection', 'pickup', 'takeaway'].includes(mode || '')) return 'Registrá el pago antes de confirmar el retiro.';
  if (mode === 'delivery' && order.payment_method === 'eft') return 'Verificá y registrá la transferencia antes de despachar.';
  return null;
}

export function orderQueueGroup(order: POSOrderStatusInput): 'new' | 'kitchen' | 'handoff' | 'payment' | 'closed' {
  if (['completed', 'delivered'].includes(order.status) && needsPayment(order)) return 'payment';
  return orderStatusGroup(order.status);
}

export function nextOrderResponsibility(order: POSOrderStatusInput): { owner: string; task: string } {
  const mode = order.fulfillment_type || order.order_type;
  if (order.status === 'cancelled') return { owner: 'Encargado', task: 'Pedido cancelado' };
  if (orderQueueGroup(order) === 'payment') return { owner: 'Caja', task: 'Registrar el cobro pendiente' };
  if (order.status === 'pending') return { owner: 'Caja', task: 'Revisar y aceptar el pedido' };
  if (['confirmed', 'preparing'].includes(order.status)) return { owner: 'Cocina', task: 'Preparar y marcar listo en las comandas' };
  if (order.status === 'ready') {
    if (mode === 'dine_in') return { owner: 'Salón / POS', task: 'Llevar a la mesa y confirmar que está servido' };
    if (mode === 'delivery') {
      if (needsPayment(order) && order.payment_method === 'eft') return { owner: 'Caja', task: 'Verificar la transferencia antes del despacho' };
      return { owner: order.driver_assignment_status ? 'Repartidor asignado' : 'Caja / despacho', task: 'Confirmar el retiro para iniciar el reparto' };
    }
    return needsPayment(order) ? { owner: 'Caja', task: 'Cobrar y luego confirmar el retiro' } : { owner: 'Mostrador / POS', task: 'Entregar al cliente y confirmar el retiro' };
  }
  if (['out_for_delivery', 'pending_on_delivery'].includes(order.status)) return { owner: order.driver_assignment_status ? 'Repartidor asignado' : 'Caja / despacho', task: 'Confirmar que el cliente recibió el pedido' };
  if (['completed', 'delivered'].includes(order.status)) return { owner: 'Sin pendientes', task: 'Entrega y pago registrados' };
  return { owner: 'Encargado', task: 'Revisar el estado del pedido' };
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
  if (['completed', 'delivered', 'cancelled'].includes(status)) return 'closed';
  return 'new'; // Never hide an unfamiliar operational state as completed.
}
