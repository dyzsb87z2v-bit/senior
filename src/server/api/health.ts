import type { FastifyInstance } from 'fastify';
import { sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import type { Config } from '../config.ts';
import { todayInBerlin } from '../../domain/dates.ts';
import { loadPublishedMenu } from '../services/menu.ts';
import { getSettings } from '../services/settings.ts';

/** GET /health — never exposes a secret, only whether each integration is configured. */
export default async function healthRoutes(app: FastifyInstance, deps: { db: Db; config: Config; startedAt: Date }) {
  app.get('/health', async (_req, reply) => {
    const started = Date.now();
    let database = 'ok';
    let menuItemsToday = 0;
    let handoff = !!deps.config.LUNCH_HANDOFF_NUMBER;
    try {
      await deps.db.execute(sql`select 1`);
      menuItemsToday = (await loadPublishedMenu(deps.db, todayInBerlin())).filter((m) => m.available).length;
      if ((await getSettings(deps.db)).handoffNumber) handoff = true;
    } catch (e) {
      database = 'error: ' + (e as Error).message;
    }
    const ok = database === 'ok' && (!!deps.config.TWILIO_AUTH_TOKEN || deps.config.allowUnsignedWebhooks);
    return reply.code(ok ? 200 : 503).send({
      status: ok ? 'ok' : 'degraded',
      service: 'senior-lunch-voice',
      version: process.env.npm_package_version || '1.0.0',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round((Date.now() - deps.startedAt.getTime()) / 1000),
      today: todayInBerlin(),
      database,
      menuItemsToday,
      integrations: { twilio: !!deps.config.TWILIO_AUTH_TOKEN, fable: !!deps.config.ANTHROPIC_API_KEY, fableModel: deps.config.LUNCH_AI_MODEL, handoffNumber: handoff },
      latencyMs: Date.now() - started,
    });
  });
}
