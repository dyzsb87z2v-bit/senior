/**
 * First data: the admin account from ADMIN_EMAIL / ADMIN_PASSWORD (created
 * only if no user exists), the settings row, and — with SEED_SAMPLE=true —
 * three sample customers and today's sample menu for a first test call.
 */
import 'dotenv/config';
import { eq } from 'drizzle-orm';
import { loadConfig } from '../config.ts';
import { createDb } from './client.ts';
import { customers, menuDays, menuItems } from './schema.ts';
import { countUsers, createUser } from '../services/users.ts';
import { saveSettings } from '../services/settings.ts';
import { todayInBerlin } from '../../domain/dates.ts';

export async function seed(databaseUrl: string, opts: { adminEmail?: string; adminPassword?: string; sample?: boolean }) {
  const { db, close } = createDb(databaseUrl);
  const result = { adminCreated: false, sampleCreated: false };
  try {
    await saveSettings(db, {});
    if ((await countUsers(db)) === 0) {
      if (!opts.adminEmail || !opts.adminPassword) throw new Error('No users exist yet: set ADMIN_EMAIL and ADMIN_PASSWORD to create the first admin');
      await createUser(db, { email: opts.adminEmail, password: opts.adminPassword, name: 'Verwaltung', role: 'ADMIN' });
      result.adminCreated = true;
    }
    if (opts.sample) {
      const today = todayInBerlin();
      const existing = await db.select({ id: customers.id }).from(customers).where(eq(customers.customerCode, '427'));
      if (!existing.length) {
        await db.insert(customers).values([
          { customerCode: '427', firstName: 'Erika', lastName: 'Müller', salutation: 'Frau', roomNumber: '12' },
          { customerCode: '315', firstName: 'Karl', lastName: 'Schmidt', salutation: 'Herr', roomNumber: '7' },
          { customerCode: '108', firstName: 'Hildegard', lastName: 'Weber', salutation: 'Frau', roomNumber: '3', notes: 'Laktoseintoleranz (laut Angehörigen)' },
        ]);
      }
      const day = await db.select({ id: menuDays.id }).from(menuDays).where(eq(menuDays.date, today));
      if (!day.length) {
        const [d] = await db.insert(menuDays).values({ date: today, published: true }).returning();
        await db.insert(menuItems).values([
          { menuDayId: d.id, date: today, position: 1, nameDe: 'Schnitzel mit Kartoffeln und Gemüse', category: 'main', components: ['Kartoffeln', 'Gemüse'], allergens: ['Gluten'], ingredients: ['Schweinefleisch', 'Zwiebeln'], allowedModifications: ['ohne Zwiebeln', 'Reis statt Kartoffeln'] },
          { menuDayId: d.id, date: today, position: 2, nameDe: 'Fisch mit Reis und Salat', category: 'main', components: ['Reis', 'Salat'], allergens: ['Fisch'], allowedModifications: ['ohne Salat'] },
          { menuDayId: d.id, date: today, position: 3, nameDe: 'Vegetarische Pasta', category: 'vegetarian', components: ['Pasta', 'Tomatensoße'], allergens: ['Gluten'], aliases: ['Nudeln'], allowedModifications: ['ohne Käse'] },
        ]);
      }
      result.sampleCreated = true;
    }
    return result;
  } finally {
    await close();
  }
}

if (process.argv[1] && /seed\.(ts|js)$/.test(process.argv[1])) {
  const config = loadConfig();
  seed(config.DATABASE_URL, { adminEmail: config.ADMIN_EMAIL, adminPassword: config.ADMIN_PASSWORD, sample: process.env.SEED_SAMPLE === 'true' })
    .then((r) => { console.log(JSON.stringify(r)); })
    .catch((e) => { console.error(e.message); process.exit(1); });
}
