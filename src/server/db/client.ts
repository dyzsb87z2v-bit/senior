import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.ts';

export type Db = ReturnType<typeof createDb>['db'];

/**
 * Hosted databases (Supabase, Neon, Render) require TLS. `sslmode=require` in
 * the URL, or DATABASE_SSL=true, enables it; their certificates are signed by
 * the provider's own CA, so the chain is not verified unless `sslmode=verify-full`.
 */
function sslFor(databaseUrl: string): false | { rejectUnauthorized: boolean } {
  let mode = '';
  try { mode = new URL(databaseUrl).searchParams.get('sslmode') || ''; } catch { /* not a URL */ }
  if (mode === 'disable') return false;
  if (mode === 'verify-full' || mode === 'verify-ca') return { rejectUnauthorized: true };
  if (mode || process.env.DATABASE_SSL === 'true') return { rejectUnauthorized: false };
  return false;
}

export function createDb(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, ssl: sslFor(databaseUrl) });
  const db = drizzle(pool, { schema });
  return { db, pool, close: () => pool.end() };
}
