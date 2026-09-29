// Driver-invite service — owner/manager invites a driver by email.
//
// Backend (org-scoped JWT, owner/manager role):
//   POST   /driver-invites              { email }      → create
//   GET    /driver-invites                              → list pending
//   POST   /driver-invites/{id}/revoke                  → revoke
//
// On the driver's side: they sign up with the invited email and the invite
// auto-accepts (AcceptMatchingInvites), granting driver-role + can_drive.
import { api } from '@/lib/api-client';

// Mirrors backend/internal/handlers/driverinvite/store.go DriverInvite.
export interface DriverInvite {
  id: string;
  organization_id: string;
  email: string;
  role: string;
  status: string;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
	expires_at?: string;
	is_expired?: boolean;
	registration_token?: string;
}

// Mirrors backend/internal/handlers/driverinvite/store.go ActiveDriver.
export interface Driver {
  member_id: string;
  profile_id: string;
  email: string;
  full_name: string;
  joined_at: string;
}

export interface DriverAssignment {
  id: string;
  order_id: string;
  driver_member_id: string;
  driver_name?: string;
  driver_email?: string;
  status: 'offered' | 'accepted' | 'picked_up';
  offered_at: string;
}

interface FetchError extends Error {
  status?: number;
}

export async function listDriverInvites(): Promise<DriverInvite[]> {
  const { data, error } = await api.request<DriverInvite[] | { invites: DriverInvite[] }>('GET', '/driver-invites');
  if (error) throw new Error(error.message || 'Failed to load driver invites');
  return Array.isArray(data) ? data : (data?.invites ?? []);
}

export async function inviteDriver(email: string): Promise<DriverInvite> {
  const { data, error } = await api.request<DriverInvite>('POST', '/driver-invites', {
    body: { email: String(email || '').trim() },
  });
  if (error) {
    const e: FetchError = new Error(error.message || 'Failed to invite driver');
    e.status = error.status;
    throw e;
  }
	return data!;
}

export async function renewDriverInvite(id: string): Promise<DriverInvite> {
  const { data, error } = await api.request<DriverInvite>('POST', `/driver-invites/${encodeURIComponent(id)}/renew`);
  if (error) throw new Error(error.message || 'No se pudo generar un nuevo enlace');
  return data!;
}

export async function revokeDriverInvite(id: string) {
  const { error } = await api.request('POST', `/driver-invites/${id}/revoke`);
  if (error) throw new Error(error.message || 'Failed to revoke invite');
}

// Active drivers (accepted members with role=driver).
export async function listActiveDrivers(): Promise<Driver[]> {
  const { data, error } = await api.request<Driver[] | { drivers: Driver[] }>('GET', '/drivers');
  if (error) throw new Error(error.message || 'Failed to load drivers');
  return Array.isArray(data) ? data : (data?.drivers ?? []);
}

export async function removeDriver(profileId: string) {
  const { error } = await api.request('DELETE', `/drivers/${profileId}`);
  if (error) throw new Error(error.message || 'Failed to remove driver');
}

export async function assignDriverToOrder(orderId: string, driverMemberId: string) {
  if (!orderId || !driverMemberId) throw new Error('Elegí un repartidor y un pedido.');
  const { data, error } = await api.request('POST', `/orders/${encodeURIComponent(orderId)}/driver-assignment`, {
    body: { driver_member_id: driverMemberId },
  });
  if (error) {
    const message = error.status === 403
      ? 'Solo un encargado puede asignar repartidores.'
      : error.status === 404
      ? 'No se encontró el pedido o el repartidor activo.'
      : error.status === 409
      ? 'El pedido ya está en reparto o finalizado.'
      : error.status === 422
      ? 'Solo se pueden asignar pedidos de entrega.'
      : error.message || 'No se pudo asignar el repartidor.';
    throw new Error(message);
  }
  return data;
}

export async function getDriverAssignmentForOrder(orderId: string): Promise<DriverAssignment | null> {
  const { data, error } = await api.request<DriverAssignment>(
    'GET',
    `/orders/${encodeURIComponent(orderId)}/driver-assignment`,
  );
  if (error) {
    throw new Error(error.status === 403
      ? 'Solo un encargado puede consultar la asignación.'
      : error.message || 'No se pudo consultar la asignación del pedido.');
  }
  return data || null;
}
