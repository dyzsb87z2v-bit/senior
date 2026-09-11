/** Applies the SQL migrations under ./drizzle. Safe to run on every deploy. */
import 'dotenv/config';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb } from './client.ts';

export async function runMigrations(databaseUrl: string, migrationsFolder = 'drizzle') {
  const { db, close } = createDb(databaseUrl);
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}

if (process.argv[1] && process.argv[1].endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js')) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('DATABASE_URL is not set'); process.exit(2); }
  runMigrations(url).then(() => { console.log('migrations applied'); }).catch((e) => { console.error(e); process.exit(1); });
}
