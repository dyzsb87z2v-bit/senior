import path from 'node:path';
import fs from 'node:fs';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import formbody from '@fastify/formbody';
import fastifyStatic from '@fastify/static';
import { ZodError } from 'zod';
import type { Config } from './config.ts';
import type { Db } from './db/client.ts';
import type { Logger } from './lib/logger.ts';
import { LiveEvents } from './lib/events.ts';
import { HttpError } from './lib/errors.ts';
import authPlugin from './auth/plugin.ts';
import apiRoutes from './api/routes.ts';
import healthRoutes from './api/health.ts';
import twilioRoutes from './voice/twilioRoutes.ts';

declare module 'fastify' {
  interface FastifyInstance { db: Db }
}

export interface AppDeps { config: Config; db: Db; log: Logger; webDist?: string }

/** Builds the HTTP server: security headers, rate limits, cookies, auth, API, voice webhooks, static web app. */
export async function buildApp(deps: AppDeps) {
  const { config, db, log } = deps;
  const app = Fastify({ loggerInstance: log, trustProxy: true, bodyLimit: 256 * 1024, disableRequestLogging: config.NODE_ENV === 'test' });
  const events = new LiveEvents();
  const startedAt = new Date();
  app.decorate('db', db);

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:'], connectSrc: ["'self'"], fontSrc: ["'self'", 'data:'], objectSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"] },
    },
    hsts: config.isProduction ? { maxAge: 15552000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'same-origin' },
  });
  await app.register(rateLimit, { global: true, max: config.RATE_LIMIT_PER_MINUTE, timeWindow: '1 minute' });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(formbody);
  await app.register(authPlugin, { publicOrigin: new URL(config.PUBLIC_URL).origin });

  app.setErrorHandler((err: unknown, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'Ungültige Eingabe', details: err.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`) });
    }
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message, details: err.details });
    const e = err as { statusCode?: number; message?: string };
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: e.message || 'Fehler' });
    req.log.error({ err }, 'unhandled');
    return reply.code(500).send({ error: 'Interner Fehler' });
  });
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'Nicht gefunden' });
    // Single-page app: unknown paths render the web app, which routes them.
    const index = deps.webDist ? path.join(deps.webDist, 'index.html') : '';
    if (index && fs.existsSync(index)) return reply.type('text/html').send(fs.createReadStream(index));
    return reply.code(404).send({ error: 'Nicht gefunden' });
  });

  await app.register(healthRoutes, { db, config, startedAt });
  await app.register(twilioRoutes, { db, config, log, events });
  await app.register(apiRoutes, { db, config, log, events });

  if (deps.webDist && fs.existsSync(deps.webDist)) {
    await app.register(fastifyStatic, { root: deps.webDist, prefix: '/', index: ['index.html'], maxAge: '1h', immutable: false, wildcard: false });
  }
  return { app, events };
}
