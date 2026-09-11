/** Mirror of the server's roles for the interface. Enforcement is server-side. */
const AREAS = {
  ADMIN: ['today', 'orders', 'kitchen', 'customers', 'menu', 'calls', 'settings'],
  STAFF: ['today', 'orders', 'kitchen', 'customers', 'menu', 'calls', 'settings'],
  KITCHEN: ['kitchen', 'orders'],
};

export function canSee(role, area) {
  return !!role && (AREAS[role] || []).includes(area);
}
