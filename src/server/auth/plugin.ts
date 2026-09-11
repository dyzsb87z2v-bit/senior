import fp from 'fastify-plugin';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { UserRow } from '../db/schema.ts';
import { SESSION_COOKIE, findSessionUser } from './session.ts';
import type { Role } from './roles.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow | null;
    sessionToken: string | null;
  }
  interface FastifyInstance {
    requireRole: (...roles: Role[]) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

/**
 * Session cookie → request.user, plus role guards and CSRF protection.
 *
 * CSRF: the cookie is SameSite=Strict, and every state-changing /api request
 * must additionally come from our own origin (Origin/Referer check) with a
 * JSON body. A cross-site form post therefore carries no session and is
 * refused twice over. The Twilio webhooks are exempt: they are signed.
 */
export default fp(async function authPlugin(app: FastifyInstance, opts: { publicOrigin: string }) {
  app.decorateRequest('user', null);
  app.decorateRequest('sessionToken', null);

  app.addHook('onRequest', async (req) => {
    const raw = req.cookies[SESSION_COOKIE];
    if (!raw) return;
    const unsigned = req.unsignCookie(raw);
    if (!unsigned.valid || !unsigned.value) return;
    req.sessionToken = unsigned.value;
    req.user = await findSessionUser(app.db, unsigned.value);
  });

  app.addHook('preHandler', async (req) => {
    if (!req.url.startsWith('/api/') || req.url.startsWith('/api/voice/')) return;
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return;
    const origin = req.headers.origin || (req.headers.referer ? new URL(req.headers.referer).origin : '');
    const hostOrigin = `${req.protocol}://${req.headers.host}`;
    if (origin && origin !== opts.publicOrigin && origin !== hostOrigin) throw forbidden('Anfrage von fremder Herkunft abgelehnt');
    const ct = String(req.headers['content-type'] || '');
    if (req.headers['content-length'] !== '0' && ct && !ct.includes('application/json')) throw forbidden('Nur JSON-Anfragen sind erlaubt');
  });

  app.decorate('requireRole', (...roles: Role[]) => async (req: FastifyRequest) => {
    if (!req.user) throw unauthorized();
    if (roles.length && !roles.includes(req.user.role)) throw forbidden();
  });
});
