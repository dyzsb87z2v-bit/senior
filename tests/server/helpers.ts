import { sql } from 'drizzle-orm';
import { loadConfig } from '../../src/server/config.ts';
import { createDb } from '../../src/server/db/client.ts';
import { runMigrations } from '../../src/server/db/migrate.ts';
import { createLogger } from '../../src/server/lib/logger.ts';
import { buildApp } from '../../src/server/app.ts';
import { createUser } from '../../src/server/services/users.ts';
import { computeTwilioSignature } from '../../src/domain/twilio.ts';

/**
 * A real server on a real PostgreSQL (TEST_DATABASE_URL, default the local
 * senior_lunch_test database). Every test file starts from empty tables.
 */
export const TEST_DB = process.env.TEST_DATABASE_URL || 'postgres://postgres@127.0.0.1:5433/senior_lunch_test';
export const AUTH_TOKEN = 'twilio-test-auth-token';
export const PUBLIC_URL = 'http://localhost:3000';

export async function startTestApp(extraEnv: Record<string, string> = {}) {
  const config = loadConfig({
    NODE_ENV: 'test', DATABASE_URL: TEST_DB, PUBLIC_URL, SESSION_SECRET: 'test-session-secret-that-is-long-enough-123',
    TWILIO_AUTH_TOKEN: AUTH_TOKEN, LUNCH_HANDOFF_NUMBER: '+493012345678', LOG_LEVEL: 'silent', LOGIN_RATE_LIMIT: '1000', ...extraEnv,
  } as NodeJS.ProcessEnv);
  await runMigrations(TEST_DB);
  const { db, close } = createDb(TEST_DB);
  await db.execute(sql`truncate table alerts, audit_logs, order_modifications, order_status_history, orders, calls, menu_items, menu_days, customers, sessions, users, settings restart identity cascade`);
  const log = createLogger('silent', false);
  const { app, events } = await buildApp({ config, db, log });
  await app.ready();
  return { app, db, events, config, close: async () => { await app.close(); await close(); } };
}

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;

export async function loginAs(t: TestApp, role: 'ADMIN' | 'STAFF' | 'KITCHEN', email = `${role.toLowerCase()}@test.de`) {
  await createUser(t.db, { email, password: 'geheim-passwort-123', role });
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email, password: 'geheim-passwort-123' }, headers: { origin: PUBLIC_URL } });
  if (res.statusCode !== 200) throw new Error('login failed: ' + res.body);
  const cookie = res.cookies.find((c) => c.name === 'lunch_session')!;
  return { cookie: `${cookie.name}=${cookie.value}`, user: res.json().user as { id: string } };
}

/** Requests as a signed-in user, with the headers the browser sends. */
export function api(t: TestApp, cookie: string) {
  return (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, payload?: unknown) =>
    t.app.inject({ method, url, payload: payload as never, headers: { cookie, origin: PUBLIC_URL, ...(payload !== undefined ? { 'content-type': 'application/json' } : {}) } });
}

/** A Twilio webhook request, correctly signed for the configured URL. */
export async function twilioPost(t: TestApp, path: string, params: Record<string, string>) {
  const url = PUBLIC_URL + path;
  const signature = await computeTwilioSignature(AUTH_TOKEN, url, params);
  return t.app.inject({ method: 'POST', url: path, payload: new URLSearchParams(params).toString(), headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': signature } });
}
