import { and, asc, desc, eq, ilike, or, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { alerts, calls, customers, orders, type CustomerRow } from '../db/schema.ts';
import type { Customer } from '../../domain/types.ts';
import { conflict, notFound } from '../lib/errors.ts';

export function toCustomer(row: CustomerRow | undefined | null): Customer | null {
  if (!row) return null;
  return {
    id: row.id, customerCode: row.customerCode, firstName: row.firstName || undefined, lastName: row.lastName,
    salutation: row.salutation || undefined, phoneNumber: row.phoneNumber || undefined, roomNumber: row.roomNumber || undefined,
    active: row.active, notes: row.notes || undefined,
  };
}

export function displayName(c: { salutation?: string | null; firstName?: string | null; lastName: string }): string {
  return [c.salutation, c.firstName, c.lastName].filter(Boolean).join(' ');
}

export interface CustomerInput {
  customerCode: string; firstName?: string; lastName: string; salutation?: string; phoneNumber?: string; roomNumber?: string; notes?: string;
}

export async function listCustomers(db: Db, q = '', includeInactive = false): Promise<CustomerRow[]> {
  const needle = q.trim();
  const where = and(
    includeInactive ? undefined : eq(customers.active, true),
    needle ? or(ilike(customers.customerCode, `${needle}%`), ilike(customers.lastName, `%${needle}%`), ilike(customers.firstName, `%${needle}%`), ilike(customers.roomNumber, `${needle}%`), ilike(customers.phoneNumber, `%${needle}%`)) : undefined,
  );
  return db.select().from(customers).where(where).orderBy(asc(sql`length(${customers.customerCode})`), asc(customers.customerCode)).limit(2000);
}

export async function getCustomer(db: Db, id: string): Promise<CustomerRow> {
  const rows = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!rows[0]) throw notFound('Kunde nicht gefunden');
  return rows[0];
}

export async function findByCode(db: Db, code: string): Promise<CustomerRow | null> {
  const rows = await db.select().from(customers).where(eq(customers.customerCode, code)).limit(1);
  return rows[0] || null;
}

export async function findActiveByPhone(db: Db, phone: string): Promise<CustomerRow | null> {
  if (!phone) return null;
  const rows = await db.select().from(customers).where(and(eq(customers.phoneNumber, phone), eq(customers.active, true))).limit(1);
  return rows[0] || null;
}

export async function nextFreeCode(db: Db): Promise<string> {
  const rows = await db.select({ code: customers.customerCode }).from(customers);
  const used = new Set(rows.map((r) => Number(r.code)));
  let n = 100;
  while (used.has(n)) n++;
  return String(n);
}

export async function createCustomer(db: Db, input: CustomerInput): Promise<CustomerRow> {
  if (await findByCode(db, input.customerCode)) throw conflict(`Kundennummer ${input.customerCode} ist bereits vergeben`);
  const [row] = await db.insert(customers).values({
    customerCode: input.customerCode, firstName: input.firstName || '', lastName: input.lastName, salutation: input.salutation || '',
    phoneNumber: input.phoneNumber || '', roomNumber: input.roomNumber || '', notes: input.notes || '', active: true,
  }).returning();
  return row;
}

export async function updateCustomer(db: Db, id: string, input: Partial<CustomerInput> & { active?: boolean }): Promise<{ before: CustomerRow; after: CustomerRow }> {
  const before = await getCustomer(db, id);
  if (input.customerCode && input.customerCode !== before.customerCode && (await findByCode(db, input.customerCode))) {
    throw conflict(`Kundennummer ${input.customerCode} ist bereits vergeben`);
  }
  const [after] = await db.update(customers).set({ ...input, updatedAt: new Date() }).where(eq(customers.id, id)).returning();
  return { before, after };
}

/** GDPR Art. 15/20: everything stored about one customer. */
export async function exportCustomer(db: Db, id: string) {
  const customer = await getCustomer(db, id);
  const customerOrders = await db.select().from(orders).where(eq(orders.customerId, id)).orderBy(desc(orders.orderDate));
  const customerCalls = await db.select().from(calls).where(eq(calls.customerId, id)).orderBy(desc(calls.startedAt));
  const customerAlerts = await db.select().from(alerts).where(eq(alerts.customerId, id)).orderBy(desc(alerts.createdAt));
  return { exportedAt: new Date().toISOString(), customer, orders: customerOrders, calls: customerCalls, alerts: customerAlerts };
}

/** GDPR Art. 17: the customer and every call are deleted; orders are kept for the kitchen's records but anonymised. */
export async function deleteCustomer(db: Db, id: string): Promise<{ deletedCalls: number; anonymisedOrders: number; code: string }> {
  const customer = await getCustomer(db, id);
  return db.transaction(async (tx) => {
    const deletedCalls = (await tx.delete(calls).where(eq(calls.customerId, id)).returning({ id: calls.id })).length;
    const anonymised = await tx.update(orders).set({
      customerId: null, customerName: 'Gelöschter Kunde', roomNumber: '',
      allergyNote: sql`case when ${orders.allergyNote} = '' then '' else '[gelöscht]' end`,
      specialRequest: sql`case when ${orders.specialRequest} = '' then '' else '[gelöscht]' end`,
      callId: null, updatedAt: new Date(),
    }).where(eq(orders.customerId, id)).returning({ id: orders.id });
    await tx.delete(alerts).where(eq(alerts.customerId, id));
    await tx.delete(customers).where(eq(customers.id, id));
    return { deletedCalls, anonymisedOrders: anonymised.length, code: customer.customerCode };
  });
}
