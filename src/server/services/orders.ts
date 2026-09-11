import { and, asc, desc, eq, inArray, lt, ne } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { customers, menuItems, orderModifications, orderStatusHistory, orders, type OrderRow } from '../db/schema.ts';
import type { Customer, Modification, OrderDraft, OrderStatus, PreviousOrder } from '../../domain/types.ts';
import { canTransition } from '../../domain/orders.ts';
import { badRequest, notFound } from '../lib/errors.ts';
import { displayName } from './customers.ts';

export interface OrderView extends OrderRow {
  modifications: Modification[];
  statusHistory: { status: OrderStatus; by: string; at: string }[];
}

async function attach(db: Db, rows: OrderRow[]): Promise<OrderView[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const mods = await db.select().from(orderModifications).where(inArray(orderModifications.orderId, ids)).orderBy(asc(orderModifications.position));
  const hist = await db.select().from(orderStatusHistory).where(inArray(orderStatusHistory.orderId, ids)).orderBy(asc(orderStatusHistory.changedAt));
  return rows.map((r) => ({
    ...r,
    modifications: mods.filter((m) => m.orderId === r.id).map((m) => ({ type: m.type, target: m.target, replacement: m.replacement || undefined, textDe: m.textDe, allowed: m.allowed })),
    statusHistory: hist.filter((h) => h.orderId === r.id).map((h) => ({ status: h.status, by: h.changedBy, at: h.changedAt.toISOString() })),
  }));
}

export async function listOrders(db: Db, filter: { date?: string; status?: OrderStatus; customerId?: string; limit?: number }): Promise<OrderView[]> {
  const where = and(
    filter.date ? eq(orders.orderDate, filter.date) : undefined,
    filter.status ? eq(orders.status, filter.status) : undefined,
    filter.customerId ? eq(orders.customerId, filter.customerId) : undefined,
  );
  const rows = await db.select().from(orders).where(where).orderBy(desc(orders.createdAt)).limit(filter.limit ?? 500);
  return attach(db, rows);
}

export async function getOrder(db: Db, id: string): Promise<OrderView> {
  const rows = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!rows[0]) throw notFound('Bestellung nicht gefunden');
  return (await attach(db, rows))[0];
}

/** The customer's most recent order before `today`, never a cancelled one. */
export async function previousOrderOf(db: Db, customerId: string, today: string): Promise<PreviousOrder | null> {
  const rows = await db.select().from(orders).where(and(eq(orders.customerId, customerId), lt(orders.orderDate, today), ne(orders.status, 'CANCELLED'))).orderBy(desc(orders.orderDate), desc(orders.createdAt)).limit(1);
  const r = rows[0];
  if (!r) return null;
  const [view] = await attach(db, [r]);
  return { orderDate: r.orderDate, itemName: r.itemName, itemPosition: r.itemPosition ?? undefined, menuItemId: r.menuItemId ?? undefined, modifications: view.modifications, quantity: r.quantity };
}

export async function saveVoiceOrder(db: Db, draft: OrderDraft, customer: Customer, orderDate: string, callId: string): Promise<OrderView> {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(orders).values({
      orderDate, customerId: customer.id, customerCode: customer.customerCode, customerName: displayName(customer), roomNumber: customer.roomNumber || '',
      menuItemId: draft.menuItemId, itemPosition: draft.itemPosition, itemName: draft.itemName, components: draft.components, quantity: draft.quantity,
      specialRequest: draft.specialRequest || '', allergyNote: draft.allergyNote || '', needsReview: draft.needsReview, reviewReason: draft.reviewReason || '',
      status: 'NEW', source: 'voice', callId, confirmedByCustomer: true,
    }).returning();
    if (draft.modifications.length) {
      await tx.insert(orderModifications).values(draft.modifications.map((m, i) => ({ orderId: row.id, type: m.type, target: m.target, replacement: m.replacement || '', textDe: m.textDe, allowed: !!m.allowed, position: i })));
    }
    await tx.insert(orderStatusHistory).values({ orderId: row.id, status: 'NEW', changedBy: 'voice' });
    return (await attach(tx as unknown as Db, [row]))[0];
  });
}

export interface ManualOrderInput {
  customerId: string; menuItemId: string; orderDate: string; quantity: number; modifications: string[]; specialRequest: string; allergyNote: string;
}

export async function createManualOrder(db: Db, input: ManualOrderInput, by: string): Promise<OrderView> {
  const customer = (await db.select().from(customers).where(eq(customers.id, input.customerId)).limit(1))[0];
  if (!customer) throw notFound('Kunde nicht gefunden');
  const item = (await db.select().from(menuItems).where(eq(menuItems.id, input.menuItemId)).limit(1))[0];
  if (!item || item.date !== input.orderDate) throw badRequest('Gericht gehört nicht zum Speiseplan dieses Tages');
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(orders).values({
      orderDate: input.orderDate, customerId: customer.id, customerCode: customer.customerCode, customerName: displayName(customer), roomNumber: customer.roomNumber,
      menuItemId: item.id, itemPosition: item.position, itemName: item.nameDe, components: item.components, quantity: input.quantity,
      specialRequest: input.specialRequest, allergyNote: input.allergyNote, needsReview: !!input.allergyNote, reviewReason: input.allergyNote ? 'Allergie-/Unverträglichkeitshinweis: ' + input.allergyNote : '',
      status: 'CONFIRMED', source: 'manual', confirmedByCustomer: false,
    }).returning();
    if (input.modifications.length) {
      await tx.insert(orderModifications).values(input.modifications.map((t, i) => ({ orderId: row.id, type: 'note' as const, target: t, replacement: '', textDe: t, allowed: true, position: i })));
    }
    await tx.insert(orderStatusHistory).values({ orderId: row.id, status: 'CONFIRMED', changedBy: by });
    return (await attach(tx as unknown as Db, [row]))[0];
  });
}

export async function setOrderStatus(db: Db, id: string, status: OrderStatus, by: string): Promise<{ before: OrderRow; after: OrderView }> {
  const before = (await db.select().from(orders).where(eq(orders.id, id)).limit(1))[0];
  if (!before) throw notFound('Bestellung nicht gefunden');
  if (!canTransition(before.status, status)) throw badRequest(`Wechsel von ${before.status} nach ${status} ist nicht vorgesehen`);
  return db.transaction(async (tx) => {
    const [row] = await tx.update(orders).set({ status, updatedAt: new Date() }).where(eq(orders.id, id)).returning();
    await tx.insert(orderStatusHistory).values({ orderId: id, status, changedBy: by });
    return { before, after: (await attach(tx as unknown as Db, [row]))[0] };
  });
}
