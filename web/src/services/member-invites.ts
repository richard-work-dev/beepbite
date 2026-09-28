// Member-invite service — owner/manager invites org members by email + role.
//
// Backend (org-scoped JWT, owner/manager role):
//   POST   /member-invites              { email, role }  → create
//   GET    /member-invites                               → list pending
//   POST   /member-invites/{id}/revoke                   → revoke
//   GET    /members                                      → list active (non-driver)
//   DELETE /members/{profile_id}                         → remove member
//
// On the invitee's side: they sign up with the invited email and the invite
// auto-accepts (AcceptMatchingInvites), granting membership with role-appropriate
// default capabilities.
import { api } from '@/lib/api-client';

// Mirrors backend/internal/handlers/memberinvite/store.go MemberInvite.
export interface MemberInvite {
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

// Mirrors backend/internal/handlers/memberinvite/store.go ActiveMember.
export interface Member {
  profile_id: string;
  email: string;
  full_name: string;
  role: string;
  joined_at: string;
	capabilities?: Record<string, boolean> | string[] | string | null;
}

interface FetchError extends Error {
  status?: number;
}

export async function listMemberInvites(): Promise<MemberInvite[]> {
  const { data, error } = await api.request<MemberInvite[] | { invites: MemberInvite[] }>('GET', '/member-invites');
  if (error) throw new Error(error.message || 'No se pudieron cargar las invitaciones');
  return Array.isArray(data) ? data : (data?.invites ?? []);
}

export async function inviteMember(email: string, role: string): Promise<MemberInvite> {
  const { data, error } = await api.request<MemberInvite>('POST', '/member-invites', {
    body: {
      email: String(email || '').trim(),
      role: String(role || '').trim(),
    },
  });
  if (error) {
    const e: FetchError = new Error(error.message || 'No se pudo invitar al usuario');
    e.status = error.status;
    throw e;
  }
  return data!;
}

export async function renewMemberInvite(id: string): Promise<MemberInvite> {
  const { data, error } = await api.request<MemberInvite>('POST', `/member-invites/${encodeURIComponent(id)}/renew`);
  if (error) throw new Error(error.message || 'No se pudo generar un nuevo enlace');
  return data!;
}

export async function revokeMemberInvite(id: string) {
  const { error } = await api.request('POST', `/member-invites/${id}/revoke`);
  if (error) throw new Error(error.message || 'No se pudo cancelar la invitación');
}

// Active members (accepted, role != driver).
export async function listActiveMembers(): Promise<Member[]> {
  const { data, error } = await api.request<Member[] | { members: Member[] }>('GET', '/members');
  if (error) throw new Error(error.message || 'No se pudieron cargar los usuarios');
  return Array.isArray(data) ? data : (data?.members ?? []);
}

export async function removeMember(profileId: string) {
	const { error } = await api.request('DELETE', `/members/${encodeURIComponent(profileId)}`);
	if (error) throw new Error(error.message || 'No se pudo quitar el acceso');
}

export async function changeMemberRole(profileId: string, role: string) {
  const { data, error } = await api.request<{ profile_id: string; role: string; capabilities: Record<string, boolean> }>(
    'PATCH',
    `/members/${encodeURIComponent(profileId)}`,
    { body: { role } },
  );
  if (error) throw new Error(error.message || 'No se pudo actualizar el rol');
  return data!;
}
