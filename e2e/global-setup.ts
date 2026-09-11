import { sql } from 'drizzle-orm';
import { createDb } from '../src/server/db/client.ts';
import { runMigrations } from '../src/server/db/migrate.ts';
import { createUser } from '../src/server/services/users.ts';
import { saveSettings } from '../src/server/services/settings.ts';

/** Empty database, one staff account, one admin, one kitchen account. The menu is created in the test itself. */
export default async function globalSetup() {
  if (process.env.PLAYWRIGHT_BASE_URL) return; // external server: leave its data alone
  const url = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/senior_lunch_test';
  await runMigrations(url);
  const { db, close } = createDb(url);
  await db.execute(sql`truncate table alerts, audit_logs, order_modifications, order_status_history, orders, calls, menu_items, menu_days, customers, sessions, users, settings restart identity cascade`);
  await saveSettings(db, { orderDeadline: '' });
  await createUser(db, { email: 'staff@e2e.de', password: 'e2e-passwort-123', name: 'Test Mitarbeiter', role: 'STAFF' });
  await createUser(db, { email: 'admin@e2e.de', password: 'e2e-passwort-123', name: 'Test Verwaltung', role: 'ADMIN' });
  await createUser(db, { email: 'kueche@e2e.de', password: 'e2e-passwort-123', name: 'Test Küche', role: 'KITCHEN' });
  await close();
}
