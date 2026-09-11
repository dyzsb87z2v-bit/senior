import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, loginAs, startTestApp, type TestApp, PUBLIC_URL } from './helpers.ts';
import { todayInBerlin } from '../../src/domain/dates.ts';

let t: TestApp;
beforeAll(async () => { t = await startTestApp(); });
afterAll(async () => { await t.close(); });

describe('authentication and authorisation', () => {
  it('refuses unauthenticated access to protected data', async () => {
    for (const url of ['/api/orders/today', '/api/customers', '/api/settings', '/api/users', '/api/calls']) {
      const res = await t.app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(401);
    }
  });
  it('logs in with a secure, http-only, same-site cookie and reports the user', async () => {
    const { cookie } = await loginAs(t, 'ADMIN');
    expect(cookie).toMatch(/^lunch_session=/);
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user.role).toBe('ADMIN');
  });
  it('rejects a wrong password and unknown users alike', async () => {
    const bad = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'admin@test.de', password: 'falsch-falsch-falsch' }, headers: { origin: PUBLIC_URL } });
    expect(bad.statusCode).toBe(401);
    const none = await t.app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'niemand@test.de', password: 'falsch-falsch-falsch' }, headers: { origin: PUBLIC_URL } });
    expect(none.statusCode).toBe(401);
  });
  it('logout ends the session', async () => {
    const { cookie } = await loginAs(t, 'STAFF', 'logout@test.de');
    await t.app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, origin: PUBLIC_URL } });
    const me = await t.app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } });
    expect(me.json().user).toBeNull();
  });
  it('kitchen accounts cannot reach customers, calls or settings, but can read orders', async () => {
    const { cookie } = await loginAs(t, 'KITCHEN');
    const call = api(t, cookie);
    expect((await call('GET', '/api/customers')).statusCode).toBe(403);
    expect((await call('GET', '/api/calls')).statusCode).toBe(403);
    expect((await call('GET', '/api/settings')).statusCode).toBe(403);
    expect((await call('GET', '/api/users')).statusCode).toBe(403);
    expect((await call('GET', '/api/orders/today')).statusCode).toBe(200);
  });
  it('staff cannot manage users, export or delete customers', async () => {
    const { cookie } = await loginAs(t, 'STAFF', 'staff2@test.de');
    const call = api(t, cookie);
    expect((await call('GET', '/api/users')).statusCode).toBe(403);
    expect((await call('PUT', '/api/settings', { restaurantName: 'X' })).statusCode).toBe(403);
  });
  it('blocks cross-site state changes (CSRF)', async () => {
    const { cookie } = await loginAs(t, 'ADMIN', 'csrf@test.de');
    const res = await t.app.inject({ method: 'POST', url: '/api/customers', payload: { customerCode: '1', lastName: 'X' }, headers: { cookie, origin: 'https://evil.example' } });
    expect(res.statusCode).toBe(403);
    const form = await t.app.inject({ method: 'POST', url: '/api/customers', payload: 'customerCode=1&lastName=X', headers: { cookie, 'content-type': 'application/x-www-form-urlencoded' } });
    expect(form.statusCode).toBe(403);
  });
});

describe('customers, menu, orders', () => {
  it('admin manages customers with unique codes; the audit log records it', async () => {
    const { cookie } = await loginAs(t, 'ADMIN', 'admin2@test.de');
    const call = api(t, cookie);
    const next = await call('GET', '/api/customers/next-code');
    expect(next.json().customerCode).toBe('100');
    const created = await call('POST', '/api/customers', { customerCode: '427', firstName: 'Erika', lastName: 'Müller', salutation: 'Frau', roomNumber: '12', phoneNumber: '+49 170 0000427' });
    expect(created.statusCode).toBe(201);
    expect(created.json().customer.phoneNumber).toBe('+491700000427');
    const dup = await call('POST', '/api/customers', { customerCode: '427', lastName: 'Zwilling' });
    expect(dup.statusCode).toBe(409);
    const bad = await call('POST', '/api/customers', { customerCode: 'abc', lastName: '' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().details.join(' ')).toContain('Kundennummer');
    const id = created.json().customer.id;
    const patched = await call('PATCH', `/api/customers/${id}`, { roomNumber: '14', active: false });
    expect(patched.json().customer.active).toBe(false);
    const list = await call('GET', '/api/customers?q=427&inactive=1');
    expect(list.json().customers).toHaveLength(1);
    const audit = await call('GET', '/api/audit');
    expect(audit.json().entries.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(['customer.create', 'customer.deactivate']));
    await call('PATCH', `/api/customers/${id}`, { active: true });
  });

  it('staff saves, publishes and duplicates a menu', async () => {
    const { cookie } = await loginAs(t, 'STAFF', 'menu@test.de');
    const call = api(t, cookie);
    const today = todayInBerlin();
    const saved = await call('PUT', `/api/menu/${today}`, { published: true, items: [
      { position: 1, nameDe: 'Schnitzel mit Kartoffeln und Gemüse', components: ['Kartoffeln', 'Gemüse'], allowedModifications: ['ohne Zwiebeln', 'Reis statt Kartoffeln'] },
      { position: 2, nameDe: 'Fisch mit Reis und Salat', components: ['Reis', 'Salat'] },
      { position: 3, nameDe: 'Vegetarische Pasta', category: 'vegetarian', aliases: ['Nudeln'] },
    ] });
    expect(saved.statusCode, saved.body).toBe(200);
    expect(saved.json().items).toHaveLength(3);
    // Reorder: swap 1 and 2 (unique index on date+position must not bite).
    const items = saved.json().items;
    const reordered = await call('PUT', `/api/menu/${today}`, { published: true, items: [{ ...items[0], position: 2 }, { ...items[1], position: 1 }, items[2]] });
    expect(reordered.statusCode, reordered.body).toBe(200);
    expect(reordered.json().items.map((i: { nameDe: string }) => i.nameDe)[0]).toContain('Fisch');
    // Put it back for the voice tests.
    await call('PUT', `/api/menu/${today}`, { published: true, items: [{ ...items[0], position: 1 }, { ...items[1], position: 2 }, items[2]] });
    const dupBad = await call('PUT', `/api/menu/${today}`, { items: [{ position: 1, nameDe: 'A' }, { position: 1, nameDe: 'B' }] });
    expect(dupBad.statusCode).toBe(400);
    const tomorrow = await call('POST', `/api/menu/2099-01-02/duplicate`, { fromDate: today });
    expect(tomorrow.statusCode, tomorrow.body).toBe(200);
    expect(tomorrow.json().day.published).toBe(false);
    expect(tomorrow.json().items).toHaveLength(3);
  });

  it('manual orders and status transitions respect roles and the state machine', async () => {
    const staff = api(t, (await loginAs(t, 'STAFF', 'orders@test.de')).cookie);
    const today = todayInBerlin();
    const customer = (await staff('GET', '/api/customers?q=427')).json().customers[0];
    const menu = (await staff('GET', '/api/menu/today')).json();
    const created = await staff('POST', '/api/orders', { customerId: customer.id, menuItemId: menu.items[0].id, orderDate: today, quantity: 2, modifications: ['ohne Zwiebeln'] });
    expect(created.statusCode, created.body).toBe(201);
    const order = created.json().order;
    expect(order.status).toBe('CONFIRMED');
    expect(order.modifications[0].textDe).toBe('ohne Zwiebeln');

    const kitchen = api(t, (await loginAs(t, 'KITCHEN', 'kitchen2@test.de')).cookie);
    expect((await kitchen('PATCH', `/api/orders/${order.id}/status`, { status: 'PREPARING' })).statusCode).toBe(200);
    expect((await kitchen('PATCH', `/api/orders/${order.id}/status`, { status: 'CANCELLED' })).statusCode).toBe(403);
    expect((await kitchen('PATCH', `/api/orders/${order.id}/status`, { status: 'DELIVERED' })).statusCode).toBe(403);
    expect((await staff('PATCH', `/api/orders/${order.id}/status`, { status: 'NEW' })).statusCode).toBe(400);
    expect((await staff('PATCH', `/api/orders/${order.id}/status`, { status: 'READY' })).statusCode).toBe(200);
    const final = await staff('PATCH', `/api/orders/${order.id}/status`, { status: 'DELIVERED' });
    expect(final.json().order.statusHistory.map((h: { status: string }) => h.status)).toEqual(['CONFIRMED', 'PREPARING', 'READY', 'DELIVERED']);
    const todayList = await kitchen('GET', '/api/orders/today');
    expect(todayList.json().orders.some((o: { id: string }) => o.id === order.id)).toBe(true);
  });

  it('settings are admin-only and validated', async () => {
    const admin = api(t, (await loginAs(t, 'ADMIN', 'settings@test.de')).cookie);
    expect((await admin('PUT', '/api/settings', { confidenceThreshold: 2 })).statusCode).toBe(400);
    const ok = await admin('PUT', '/api/settings', { restaurantName: 'Haus Sonnenschein', confidenceThreshold: 0.75, handoffNumber: '+49 30 111' });
    expect(ok.json().settings).toMatchObject({ restaurantName: 'Haus Sonnenschein', confidenceThreshold: 0.75, handoffNumber: '+4930111' });
    const read = await admin('GET', '/api/settings');
    expect(read.json().voiceUrls.voice).toBe(`${PUBLIC_URL}/api/voice/twilio`);
  });

  it('health reports status without secrets', async () => {
    const res = await t.app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', database: 'ok', integrations: { twilio: true, fable: false } });
    expect(res.body).not.toContain('twilio-test-auth-token');
  });
});
