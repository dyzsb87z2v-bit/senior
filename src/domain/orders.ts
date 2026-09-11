/** Order status rules shared by the API and the UI. */
import type { OrderStatus } from './types.ts';

export const ORDER_STATUSES: OrderStatus[] = ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'];

export const STATUS_LABELS_DE: Record<OrderStatus, string> = {
  NEW: 'Neu',
  CONFIRMED: 'Bestätigt',
  PREPARING: 'In Zubereitung',
  READY: 'Fertig',
  DELIVERED: 'Geliefert',
  CANCELLED: 'Storniert',
};

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  NEW: ['CONFIRMED', 'PREPARING', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'READY', 'CANCELLED', 'NEW'],
  PREPARING: ['READY', 'DELIVERED', 'CANCELLED', 'CONFIRMED'],
  READY: ['DELIVERED', 'PREPARING', 'CANCELLED'],
  DELIVERED: ['READY'],
  CANCELLED: ['NEW'],
};

export function isOrderStatus(s: unknown): s is OrderStatus {
  return typeof s === 'string' && (ORDER_STATUSES as string[]).includes(s);
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || (TRANSITIONS[from] || []).includes(to);
}

/** What each role may set. The kitchen moves food along; it does not cancel or un-deliver. */
export function roleMaySetStatus(role: 'admin' | 'staff' | 'kitchen', to: OrderStatus): boolean {
  if (role === 'kitchen') return ['CONFIRMED', 'PREPARING', 'READY'].includes(to);
  return true;
}
