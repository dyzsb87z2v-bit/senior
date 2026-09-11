import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../lib/logger.ts';
import type { LiveEvents } from '../lib/events.ts';
import { audit } from '../lib/audit.ts';
import { badRequest, forbidden, notFound } from '../lib/errors.ts';
import { SESSION_COOKIE, createSession, deleteSession } from '../auth/session.ts';
import { roleMaySetStatus } from '../auth/roles.ts';
import { authenticate, createUser, listUsers, toPublicUser, updateUser } from '../services/users.ts';
import { createCustomer, deleteCustomer, exportCustomer, getCustomer, listCustomers, nextFreeCode, updateCustomer } from '../services/customers.ts';
import { duplicateDay, getDay, saveDay } from '../services/menu.ts';
import { createManualOrder, getOrder, listOrders, setOrderStatus } from '../services/orders.ts';
import { getCall, listAlerts, listCalls, resolveAlert, applyRetention, persistTurn, stateFromRow } from '../services/calls.ts';
import { getSettings, saveSettings } from '../services/settings.ts';
import { addDays, todayInBerlin } from '../../domain/dates.ts';
import { initialState, runTurn } from '../../domain/dialog.ts';
import { applyEffects, buildDialogContext } from '../voice/context.ts';
import { voiceUrls } from '../voice/twilioRoutes.ts';
import { CustomerInput, Id, IsoDate, LoginInput, ManualOrderInput, MenuDayInput, SettingsInput, SimulateInput, StatusInput, UserCreateInput, UserUpdateInput } from './schemas.ts';
import { auditLogs } from '../db/schema.ts';
import { desc } from 'drizzle-orm';

export interface ApiDeps { db: Db; config: Config; log: Logger; events: LiveEvents }

/**
 * The staff REST API. Reads are role-scoped; every write is validated with
 * zod, authorised by role, written to the audit log and announced on the
 * event stream so open dashboards update without a reload.
 */
export default async function apiRoutes(app: FastifyInstance, deps: ApiDeps) {
  const { db, config, log, events } = deps;
  const ADMIN = app.requireRole('ADMIN');
  const STAFF = app.requireRole('ADMIN', 'STAFF');
  const ANY = app.requireRole('ADMIN', 'STAFF', 'KITCHEN');
  const who = (req: { user: { email: string; role: string } | null }) => ({ actorEmail: req.user?.email, actorRole: req.user?.role });

  // ── Auth ─────────────────────────────────────────────────────────────
  app.post('/api/auth/login', { config: { rateLimit: { max: config.LOGIN_RATE_LIMIT, timeWindow: '1 minute' } } }, async (req, reply) => {
    const input = LoginInput.parse(req.body);
    const user = await authenticate(db, input.email, input.password);
    const { token, expiresAt } = await createSession(db, user.id, config.SESSION_TTL_HOURS, String(req.headers['user-agent'] || ''));
    reply.setCookie(SESSION_COOKIE, token, { path: '/', httpOnly: true, sameSite: 'strict', secure: config.isProduction, signed: true, expires: expiresAt });
    await audit(db, log, { actorEmail: user.email, actorRole: user.role, action: 'auth.login', entity: 'users', entityId: user.id });
    return { user: toPublicUser(user) };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    if (req.sessionToken) await deleteSession(db, req.sessionToken);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => ({ user: req.user ? toPublicUser(req.user) : null }));

  // ── Users (admin) ────────────────────────────────────────────────────
  app.get('/api/users', { preHandler: ADMIN }, async () => ({ users: await listUsers(db) }));
  app.post('/api/users', { preHandler: ADMIN }, async (req, reply) => {
    const input = UserCreateInput.parse(req.body);
    const user = await createUser(db, input);
    await audit(db, log, { ...who(req), action: 'user.create', entity: 'users', entityId: user.id, summary: `${user.email} als ${user.role} angelegt` });
    return reply.code(201).send({ user });
  });
  app.patch('/api/users/:id', { preHandler: ADMIN }, async (req) => {
    const id = Id.parse((req.params as { id: string }).id);
    const input = UserUpdateInput.parse(req.body);
    if (id === req.user!.id && (input.role || input.active === false)) throw badRequest('Die eigene Rolle oder der eigene Zugang kann nicht geändert werden');
    const user = await updateUser(db, id, input);
    await audit(db, log, { ...who(req), action: 'user.update', entity: 'users', entityId: id, summary: `${user.email}: ${Object.keys(input).filter((k) => k !== 'password').join(', ')}${input.password ? ', Passwort' : ''}` });
    return { user };
  });

  // ── Customers ────────────────────────────────────────────────────────
  app.get('/api/customers', { preHandler: STAFF }, async (req) => {
    const q = z.object({ q: z.string().max(80).default(''), inactive: z.enum(['0', '1']).default('0') }).parse(req.query);
    return { customers: await listCustomers(db, q.q, q.inactive === '1') };
  });
  app.get('/api/customers/next-code', { preHandler: STAFF }, async () => ({ customerCode: await nextFreeCode(db) }));
  app.get('/api/customers/:id', { preHandler: STAFF }, async (req) => ({ customer: await getCustomer(db, Id.parse((req.params as { id: string }).id)) }));
  app.get('/api/customers/:id/orders', { preHandler: STAFF }, async (req) => ({ orders: await listOrders(db, { customerId: Id.parse((req.params as { id: string }).id), limit: 200 }) }));
  app.post('/api/customers', { preHandler: STAFF }, async (req, reply) => {
    const input = CustomerInput.parse(req.body);
    const customer = await createCustomer(db, input);
    await audit(db, log, { ...who(req), action: 'customer.create', entity: 'customers', entityId: customer.id, summary: `Kunde ${customer.customerCode} angelegt` });
    events.publish({ type: 'customer', action: 'create', id: customer.id });
    return reply.code(201).send({ customer });
  });
  app.patch('/api/customers/:id', { preHandler: STAFF }, async (req) => {
    const id = Id.parse((req.params as { id: string }).id);
    const input = CustomerInput.partial().extend({ active: z.boolean().optional() }).parse(req.body);
    const { before, after } = await updateCustomer(db, id, input);
    const changed = Object.keys(input).filter((k) => (input as Record<string, unknown>)[k] !== (before as Record<string, unknown>)[k]);
    await audit(db, log, { ...who(req), action: input.active === undefined ? 'customer.update' : input.active ? 'customer.activate' : 'customer.deactivate', entity: 'customers', entityId: id, summary: `Kunde ${before.customerCode}: ${changed.join(', ') || 'keine Änderung'}` });
    events.publish({ type: 'customer', action: 'update', id });
    return { customer: after };
  });
  app.get('/api/customers/:id/export', { preHandler: ADMIN }, async (req) => {
    const id = Id.parse((req.params as { id: string }).id);
    const data = await exportCustomer(db, id);
    await audit(db, log, { ...who(req), action: 'customer.export', entity: 'customers', entityId: id, summary: `Datenexport für Kunde ${data.customer.customerCode}` });
    return data;
  });
  app.delete('/api/customers/:id', { preHandler: ADMIN }, async (req) => {
    const id = Id.parse((req.params as { id: string }).id);
    const result = await deleteCustomer(db, id);
    await audit(db, log, { ...who(req), action: 'customer.delete', entity: 'customers', entityId: id, summary: `Kunde ${result.code} gelöscht (${result.deletedCalls} Anrufe gelöscht, ${result.anonymisedOrders} Bestellungen anonymisiert)` });
    events.publish({ type: 'customer', action: 'delete', id });
    return { ok: true, ...result };
  });

  // ── Menu ─────────────────────────────────────────────────────────────
  app.get('/api/menu/today', { preHandler: ANY }, async () => { const date = todayInBerlin(); return { date, ...(await getDay(db, date)) }; });
  app.get('/api/menu/:date', { preHandler: ANY }, async (req) => { const date = IsoDate.parse((req.params as { date: string }).date); return { date, ...(await getDay(db, date)) }; });
  app.put('/api/menu/:date', { preHandler: STAFF }, async (req) => {
    const date = IsoDate.parse((req.params as { date: string }).date);
    const input = MenuDayInput.parse(req.body);
    const result = await saveDay(db, date, { published: input.published, orderDeadline: input.orderDeadline, note: input.note }, input.items);
    await audit(db, log, { ...who(req), action: 'menu.save', entity: 'menu_days', entityId: result.day.id, summary: `Speiseplan ${date}: ${result.items.length} Gerichte gespeichert, ${result.removed} entfernt, ${input.published ? 'veröffentlicht' : 'Entwurf'}` });
    events.publish({ type: 'menu', action: 'update', id: date });
    return { date, day: result.day, items: result.items };
  });
  app.post('/api/menu/:date/duplicate', { preHandler: STAFF }, async (req) => {
    const date = IsoDate.parse((req.params as { date: string }).date);
    const from = z.object({ fromDate: IsoDate.optional() }).parse(req.body || {}).fromDate || addDays(date, -1);
    const result = await duplicateDay(db, date, from);
    await audit(db, log, { ...who(req), action: 'menu.duplicate', entity: 'menu_days', entityId: result.day.id, summary: `Speiseplan ${from} nach ${date} kopiert (${result.items.length} Gerichte, als Entwurf)` });
    events.publish({ type: 'menu', action: 'update', id: date });
    return { date, ...result };
  });

  // ── Orders ───────────────────────────────────────────────────────────
  app.get('/api/orders/today', { preHandler: ANY }, async () => ({ date: todayInBerlin(), orders: await listOrders(db, { date: todayInBerlin() }) }));
  app.get('/api/orders', { preHandler: ANY }, async (req) => {
    const q = z.object({ date: IsoDate.optional(), status: StatusInput.shape.status.optional() }).parse(req.query);
    return { orders: await listOrders(db, { date: q.date, status: q.status }) };
  });
  app.get('/api/orders/:id', { preHandler: ANY }, async (req) => ({ order: await getOrder(db, Id.parse((req.params as { id: string }).id)) }));
  app.post('/api/orders', { preHandler: STAFF }, async (req, reply) => {
    const input = ManualOrderInput.parse(req.body);
    const order = await createManualOrder(db, input, req.user!.email);
    await audit(db, log, { ...who(req), action: 'order.create', entity: 'orders', entityId: order.id, orderId: order.id, summary: `Manuelle Bestellung für Kunde ${order.customerCode}: ${order.itemName}` });
    events.publish({ type: 'order', action: 'create', id: order.id, data: order });
    return reply.code(201).send({ order });
  });
  app.patch('/api/orders/:id/status', { preHandler: ANY }, async (req) => {
    const id = Id.parse((req.params as { id: string }).id);
    const { status } = StatusInput.parse(req.body);
    if (!roleMaySetStatus(req.user!.role, status)) throw forbidden();
    const { before, after } = await setOrderStatus(db, id, status, req.user!.email);
    await audit(db, log, { ...who(req), action: 'order.status', entity: 'orders', entityId: id, orderId: id, summary: `Bestellung #${before.customerCode} ${before.itemName}: ${before.status} → ${status}`, before: { status: before.status }, after: { status } });
    events.publish({ type: 'order', action: 'update', id, data: after });
    return { order: after };
  });

  // ── Calls & alerts ───────────────────────────────────────────────────
  app.get('/api/calls', { preHandler: STAFF }, async (req) => {
    const q = z.object({ since: z.string().datetime({ offset: true }).optional(), limit: z.coerce.number().int().min(1).max(500).default(200) }).parse(req.query);
    return { calls: await listCalls(db, q.limit, q.since) };
  });
  app.get('/api/calls/:id', { preHandler: STAFF }, async (req) => { const call = await getCall(db, Id.parse((req.params as { id: string }).id)); if (!call) throw notFound('Anruf nicht gefunden'); return { call }; });
  app.get('/api/alerts', { preHandler: STAFF }, async (req) => {
    const q = z.object({ all: z.enum(['0', '1']).default('0') }).parse(req.query);
    return { alerts: await listAlerts(db, q.all !== '1') };
  });
  app.post('/api/alerts/:id/resolve', { preHandler: STAFF }, async (req) => {
    const id = Id.parse((req.params as { id: string }).id);
    const alert = await resolveAlert(db, id, req.user!.email);
    if (!alert) throw notFound('Meldung nicht gefunden');
    await audit(db, log, { ...who(req), action: 'alert.resolve', entity: 'alerts', entityId: id, summary: 'Meldung erledigt' });
    events.publish({ type: 'alert', action: 'update', id, data: alert });
    return { alert };
  });

  // ── Settings, audit, health ──────────────────────────────────────────
  app.get('/api/settings', { preHandler: STAFF }, async () => ({ settings: await getSettings(db), voiceUrls: voiceUrls(config.PUBLIC_URL, config) }));
  app.put('/api/settings', { preHandler: ADMIN }, async (req) => {
    const input = SettingsInput.parse(req.body);
    const settings = await saveSettings(db, input);
    await audit(db, log, { ...who(req), action: 'settings.save', entity: 'settings', entityId: '1', summary: `Einstellungen geändert: ${Object.keys(input).join(', ')}`, after: input as Record<string, unknown> });
    events.publish({ type: 'settings', action: 'update', id: '1' });
    return { settings };
  });
  app.get('/api/audit', { preHandler: ADMIN }, async () => ({ entries: await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(100) }));
  app.post('/api/retention/run', { preHandler: ADMIN }, async (req) => {
    const settings = await getSettings(db);
    const today = todayInBerlin();
    const callCutoff = addDays(today, -Math.max(1, settings.callRetentionDays));
    const orderCutoff = addDays(today, -Math.max(7, settings.orderRetentionDays));
    const deleted = await applyRetention(db, callCutoff + 'T00:00:00Z', orderCutoff);
    await audit(db, log, { ...who(req), action: 'retention.run', entity: 'calls', summary: `Aufbewahrung: ${deleted.calls} Anrufe, ${deleted.orders} Bestellungen, ${deleted.alerts} erledigte Meldungen gelöscht (Anrufe vor ${callCutoff}, Bestellungen vor ${orderCutoff}).` });
    log.info({ ...deleted, callCutoff, orderCutoff }, 'retention.run');
    return { ok: true, deleted, callCutoff, orderCutoff };
  });

  // ── Text simulator: the real dialog engine, typed instead of spoken ─────
  app.post('/api/voice/simulate', { preHandler: STAFF }, async (req) => {
    const input = SimulateInput.parse(req.body);
    const now = new Date();
    const today = todayInBerlin(now);
    const existing = input.callId ? await getCall(db, input.callId) : null;
    if (input.callId && !existing) throw notFound('Testanruf nicht gefunden');
    if (existing && existing.provider !== 'simulator') throw badRequest('Kein Testanruf');
    const callSid = existing ? existing.callSid : `sim-${crypto.randomUUID()}`;
    const { ctx, settings, fableActive } = await buildDialogContext({ db, config, log, events }, today, callSid);
    const state = (existing && stateFromRow(existing)) || initialState(today, input.callerNumber || null);
    const turnInput = existing ? { utterance: input.utterance ?? '', sttConfidence: 0.9, callerNumber: input.callerNumber || null, now } : { utterance: null, callerNumber: input.callerNumber || null, now };
    const turn = await runTurn(state, turnInput, ctx);
    const row = await persistTurn(db, existing, callSid, 'simulator', turn, settings.storeTranscripts, now);
    await applyEffects({ db, config, log, events }, turn.effects, row.id, turn.state);
    if (!existing) await audit(db, log, { ...who(req), action: 'call.simulate', entity: 'calls', entityId: row.id, summary: 'Testanruf im Simulator gestartet' });
    return { callId: row.id, say: turn.say, action: turn.action, stage: turn.state.stage, effects: turn.effects.map((e) => e.type), model: fableActive ? config.LUNCH_AI_MODEL : null };
  });

  // ── Live updates (Server-Sent Events) ────────────────────────────────
  app.get('/api/events', { preHandler: ANY }, async (req, reply) => {
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ role: req.user!.role, at: new Date().toISOString() })}\n\n`);
    const unsubscribe = events.subscribe((e) => {
      // Kitchen accounts get orders only; everyone else gets everything.
      if (req.user!.role === 'KITCHEN' && e.type !== 'order' && e.type !== 'menu') return;
      reply.raw.write(`event: ${e.type}\ndata: ${JSON.stringify({ action: e.action, id: e.id, data: e.data ?? null })}\n\n`);
    });
    const ping = setInterval(() => reply.raw.write(': ping\n\n'), 25000);
    req.raw.on('close', () => { clearInterval(ping); unsubscribe(); });
    await new Promise<void>((resolve) => req.raw.on('close', () => resolve()));
  });
}
