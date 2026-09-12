import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.ts';
import { createDb } from './db/client.ts';
import { runMigrations } from './db/migrate.ts';
import { createLogger } from './lib/logger.ts';
import { buildApp } from './app.ts';
import { purgeExpiredSessions } from './auth/session.ts';
import { getSettings } from './services/settings.ts';
import { applyRetention } from './services/calls.ts';
import { addDays, todayInBerlin } from '../domain/dates.ts';
import { seed } from './db/seed.ts';

const here = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const config = loadConfig();
  const log = createLogger(config.LOG_LEVEL, !config.isProduction && config.NODE_ENV !== 'test');
  await runMigrations(config.DATABASE_URL, path.resolve(here, '../../drizzle'));
  // First start: the admin account from ADMIN_EMAIL/ADMIN_PASSWORD (only while no user exists) and, if asked, sample data.
  if (config.ADMIN_EMAIL && config.ADMIN_PASSWORD) {
    const seeded = await seed(config.DATABASE_URL, { adminEmail: config.ADMIN_EMAIL, adminPassword: config.ADMIN_PASSWORD, sample: config.SEED_SAMPLE === 'true' });
    if (seeded.adminCreated || seeded.sampleCreated) log.info(seeded, 'seed');
  }
  const { db, close } = createDb(config.DATABASE_URL);
  const webDist = path.resolve(here, '../../web/dist');
  const { app } = await buildApp({ config, db, log, webDist });

  // Housekeeping: expired sessions hourly, data retention nightly (03:30 Berlin, checked every 10 minutes).
  const hourly = setInterval(() => purgeExpiredSessions(db).catch((err) => log.error({ err }, 'sessions.purge.failed')), 3600_000);
  let lastRetentionDay = '';
  const retention = setInterval(async () => {
    try {
      const today = todayInBerlin();
      const hhmm = new Intl.DateTimeFormat('de-DE', { timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date());
      if (hhmm < '03:30' || lastRetentionDay === today) return;
      lastRetentionDay = today;
      const s = await getSettings(db);
      const deleted = await applyRetention(db, addDays(today, -Math.max(1, s.callRetentionDays)) + 'T00:00:00Z', addDays(today, -Math.max(7, s.orderRetentionDays)));
      log.info(deleted, 'retention.nightly');
    } catch (err) { log.error({ err }, 'retention.failed'); }
  }, 600_000);

  const shutdown = async (signal: string) => {
    log.info({ signal }, 'shutting down');
    clearInterval(hourly); clearInterval(retention);
    await app.close();
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  await app.listen({ port: config.PORT, host: config.HOST });
  log.info({ port: config.PORT, publicUrl: config.PUBLIC_URL, fable: !!config.ANTHROPIC_API_KEY, twilio: !!config.TWILIO_AUTH_TOKEN }, 'senior-lunch-voice started');
}

main().catch((err) => { console.error(err); process.exit(1); });
