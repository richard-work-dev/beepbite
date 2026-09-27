import { afterEach, describe, expect, it } from 'vitest';
import { _actorRef } from '@/context/actor-token-context';
import { hasAnyAccess, membershipHasAccess } from '@/lib/access-control';
import { hasCapability } from '@/services/pos';

afterEach(() => {
  _actorRef.current = null;
  localStorage.clear();
});

describe('control de acceso administrativo', () => {
  it.each(['owner', 'manager', 'admin', 'ADMIN'])(
    'otorga todas las capacidades al rol elevado %s',
    (role) => {
      expect(membershipHasAccess({ organization_id: 'org-1', role }, 'can_void')).toBe(true);
      expect(hasAnyAccess(null, ['can_kds'], [], role)).toBe(true);
    },
  );

  it('mantiene las restricciones para un actor operativo', () => {
    expect(hasAnyAccess(null, ['can_void'], ['can_pos'], 'staff')).toBe(false);
    expect(hasAnyAccess(null, ['can_pos'], ['can_pos'], 'staff')).toBe(true);
  });

  it('aplica los permisos del actor activo a las acciones del POS', () => {
    _actorRef.current = {
      member_id: 'member-1', staff_id: 'staff-1', location_id: 'location-1',
      display_name: 'Caja', role: 'staff', capabilities: ['can_pos'], slug: null,
      _token: 'test', _expiresAt: Date.now() + 60_000,
    };
    expect(hasCapability('can_pos')).toBe(true);
    expect(hasCapability('can_void')).toBe(false);
  });

  it('permite todas las acciones del POS a un actor administrador', () => {
    _actorRef.current = {
      member_id: 'member-1', staff_id: 'admin-1', location_id: 'location-1',
      display_name: 'Administrador', role: 'admin', capabilities: [], slug: null,
      _token: 'test', _expiresAt: Date.now() + 60_000,
    };
    expect(hasCapability('can_void')).toBe(true);
    expect(hasCapability('can_settle')).toBe(true);
  });
});
