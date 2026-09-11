/** Mirror of src/domain/orders.ts for the interface; the server re-checks every transition. */
export const ORDER_STATUSES = ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

const TRANSITIONS = {
  NEW: ['CONFIRMED', 'PREPARING', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'READY', 'CANCELLED', 'NEW'],
  PREPARING: ['READY', 'DELIVERED', 'CANCELLED', 'CONFIRMED'],
  READY: ['DELIVERED', 'PREPARING', 'CANCELLED'],
  DELIVERED: ['READY'],
  CANCELLED: ['NEW'],
};

export function nextStatuses(from, role) {
  const list = TRANSITIONS[from] || [];
  return role === 'KITCHEN' ? list.filter((s) => ['CONFIRMED', 'PREPARING', 'READY'].includes(s)) : list;
}

export function modificationText(m) {
  if (!m) return '';
  if (typeof m === 'string') return m;
  return m.textDe || (m.type === 'without' ? `ohne ${m.target}` : m.type === 'replace' ? `${m.replacement} statt ${m.target}` : m.type === 'extra' ? `extra ${m.target}` : m.target);
}
