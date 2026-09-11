import type { OrderStatus } from '../../domain/types.ts';

export type Role = 'ADMIN' | 'STAFF' | 'KITCHEN';

/** What each role may set. The kitchen moves food along; it does not cancel or un-deliver. */
export function roleMaySetStatus(role: Role, to: OrderStatus): boolean {
  if (role === 'KITCHEN') return ['CONFIRMED', 'PREPARING', 'READY'].includes(to);
  return true;
}

export const ROLES: Role[] = ['ADMIN', 'STAFF', 'KITCHEN'];
