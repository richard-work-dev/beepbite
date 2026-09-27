import type { OrganizationMembership } from '@/context/auth-context';

type CapabilitySet = Record<string, boolean> | string[] | string | null | undefined;

/** The API used can_kds first; accept the older kitchen spelling while old staff records are migrated. */
const aliases: Record<string, string[]> = {
  can_kds: ['can_kitchen'],
  can_kitchen: ['can_kds'],
};

function isElevatedRole(role?: string | null): boolean {
  return ['owner', 'manager', 'admin'].includes(String(role || '').trim().toLowerCase());
}

export function capabilityEnabled(capabilities: CapabilitySet, capability: string): boolean {
  const accepted = [capability, ...(aliases[capability] ?? [])];
  if (Array.isArray(capabilities)) return accepted.some((name) => capabilities.includes(name));
  if (typeof capabilities === 'string') {
    try { return capabilityEnabled(JSON.parse(capabilities), capability); } catch { return false; }
  }
  return Boolean(capabilities && accepted.some((name) => capabilities[name] === true));
}

export function membershipHasAccess(membership: OrganizationMembership | null, capability?: string): boolean {
  if (!membership) return false;
  if (isElevatedRole(membership.role)) return true;
  return !capability || capabilityEnabled(membership.capabilities, capability);
}

export function hasAnyAccess(
  membership: OrganizationMembership | null,
  capabilities: string[],
  actorCapabilities?: string[] | null,
  actorRole?: string | null,
): boolean {
  if (isElevatedRole(actorRole)) return true;
  if (actorCapabilities) return capabilities.some((capability) => capabilityEnabled(actorCapabilities, capability));
  return capabilities.some((capability) => membershipHasAccess(membership, capability));
}
