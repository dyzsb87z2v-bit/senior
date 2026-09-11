import { and, asc, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { menuDays, menuItems, type MenuItemRow } from '../db/schema.ts';
import type { MenuItem } from '../../domain/types.ts';
import { addDays } from '../../domain/dates.ts';
import { badRequest, conflict, notFound } from '../lib/errors.ts';

export function toMenuItem(row: MenuItemRow): MenuItem {
  return {
    id: row.id, date: row.date, position: row.position, nameDe: row.nameDe, descriptionDe: row.descriptionDe || undefined,
    category: row.category, available: row.available, components: row.components, allergens: row.allergens, ingredients: row.ingredients,
    allowedModifications: row.allowedModifications, aliases: row.aliases,
  };
}

/** Today's dishes, sorted by position, or [] when the day is not published. */
export async function loadPublishedMenu(db: Db, date: string): Promise<MenuItem[]> {
  const day = (await db.select().from(menuDays).where(eq(menuDays.date, date)).limit(1))[0];
  if (!day || !day.published) return [];
  const rows = await db.select().from(menuItems).where(eq(menuItems.date, date)).orderBy(asc(menuItems.position));
  return rows.map(toMenuItem);
}

export async function getDay(db: Db, date: string) {
  const day = (await db.select().from(menuDays).where(eq(menuDays.date, date)).limit(1))[0] || null;
  const items = await db.select().from(menuItems).where(eq(menuItems.date, date)).orderBy(asc(menuItems.position));
  return { day, items };
}

export interface MenuItemInput {
  id?: string; position: number; nameDe: string; descriptionDe?: string; category?: MenuItem['category']; available?: boolean;
  components?: string[]; allergens?: string[]; ingredients?: string[]; allowedModifications?: string[]; aliases?: string[];
}

export async function saveDay(db: Db, date: string, day: { published: boolean; orderDeadline: string; note: string }, items: MenuItemInput[]) {
  const positions = items.map((i) => i.position);
  if (new Set(positions).size !== positions.length) throw badRequest('Jede Nummer darf nur einmal vorkommen');
  return db.transaction(async (tx) => {
    const [dayRow] = await tx.insert(menuDays).values({ date, ...day })
      .onConflictDoUpdate({ target: menuDays.date, set: { ...day, updatedAt: new Date() } }).returning();
    const existing = await tx.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.date, date));
    const existingIds = new Set(existing.map((e) => e.id));
    const keep: string[] = [];
    // Two passes: clear positions first so a reorder never collides with the unique (date, position) index.
    const toUpdate = items.filter((it) => it.id && existingIds.has(it.id));
    for (const it of toUpdate) await tx.update(menuItems).set({ position: -1000 - it.position }).where(eq(menuItems.id, it.id as string));
    await tx.delete(menuItems).where(and(eq(menuItems.date, date), notInArray(menuItems.id, toUpdate.map((i) => i.id as string).concat(['00000000-0000-0000-0000-000000000000']))));
    const saved: MenuItemRow[] = [];
    for (const it of items) {
      const { id, ...data } = it;
      const values = { ...data, descriptionDe: data.descriptionDe || '', category: data.category || 'main', available: data.available !== false,
        components: data.components || [], allergens: data.allergens || [], ingredients: data.ingredients || [], allowedModifications: data.allowedModifications || [], aliases: data.aliases || [] };
      if (id && existingIds.has(id)) {
        const [row] = await tx.update(menuItems).set({ ...values, updatedAt: new Date() }).where(eq(menuItems.id, id)).returning();
        saved.push(row); keep.push(id);
      } else {
        const [row] = await tx.insert(menuItems).values({ ...values, date, menuDayId: dayRow.id }).returning();
        saved.push(row); keep.push(row.id);
      }
    }
    return { day: dayRow, items: saved.sort((a, b) => a.position - b.position), removed: existing.length - toUpdate.length };
  });
}

export async function duplicateDay(db: Db, toDate: string, fromDate = addDays(toDate, -1)) {
  const source = await db.select().from(menuItems).where(eq(menuItems.date, fromDate)).orderBy(asc(menuItems.position));
  if (!source.length) throw notFound(`Für ${fromDate} gibt es keinen Speiseplan`);
  const target = await db.select({ id: menuItems.id }).from(menuItems).where(eq(menuItems.date, toDate));
  if (target.length) throw conflict(`Für ${toDate} gibt es bereits einen Speiseplan`);
  return db.transaction(async (tx) => {
    const [day] = await tx.insert(menuDays).values({ date: toDate, published: false }).onConflictDoUpdate({ target: menuDays.date, set: { updatedAt: new Date() } }).returning();
    const items = await tx.insert(menuItems).values(source.map((s) => ({
      menuDayId: day.id, date: toDate, position: s.position, nameDe: s.nameDe, descriptionDe: s.descriptionDe, category: s.category, available: true,
      components: s.components, allergens: s.allergens, ingredients: s.ingredients, allowedModifications: s.allowedModifications, aliases: s.aliases,
    }))).returning();
    return { day, items };
  });
}

export async function getMenuItems(db: Db, ids: string[]): Promise<MenuItemRow[]> {
  if (!ids.length) return [];
  return db.select().from(menuItems).where(inArray(menuItems.id, ids));
}
