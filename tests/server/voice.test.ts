import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { api, loginAs, startTestApp, twilioPost, type TestApp } from './helpers.ts';
import { todayInBerlin } from '../../src/domain/dates.ts';
import type { LiveEvent } from '../../src/server/lib/events.ts';

/**
 * The whole pipeline, minus the telephone: signed Twilio webhooks in, TwiML
 * out, and a real order in a real database at the end — announced on the
 * event stream the dashboard listens to.
 */
let t: TestApp;
let staff: ReturnType<typeof api>;
const today = todayInBerlin();

beforeAll(async () => {
  t = await startTestApp();
  staff = api(t, (await loginAs(t, 'STAFF', 'voice@test.de')).cookie);
  // No order deadline: the tests run at any time of day.
  await api(t, (await loginAs(t, 'ADMIN', 'voiceadmin@test.de')).cookie)('PUT', '/api/settings', { orderDeadline: '' });
  await staff('POST', '/api/customers', { customerCode: '427', firstName: 'Erika', lastName: 'Müller', salutation: 'Frau', roomNumber: '12', phoneNumber: '+491700000427' });
  await staff('POST', '/api/customers', { customerCode: '315', firstName: 'Karl', lastName: 'Schmidt', salutation: 'Herr', roomNumber: '7' });
  await staff('PUT', `/api/menu/${today}`, { published: true, items: [
    { position: 1, nameDe: 'Schnitzel mit Kartoffeln und Gemüse', components: ['Kartoffeln', 'Gemüse'], allowedModifications: ['ohne Zwiebeln', 'Reis statt Kartoffeln'] },
    { position: 2, nameDe: 'Fisch mit Reis und Salat', components: ['Reis', 'Salat'] },
    { position: 3, nameDe: 'Vegetarische Pasta', category: 'vegetarian', aliases: ['Nudeln'] },
  ] });
});
afterAll(async () => { await t.close(); });

const sid = () => 'CA' + Math.random().toString(16).slice(2, 12);

describe('Twilio voice webhook', () => {
  it('refuses unsigned or badly signed requests', async () => {
    const unsigned = await t.app.inject({ method: 'POST', url: '/api/voice/twilio', payload: 'CallSid=CA1&From=%2B491700000427', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
    expect(unsigned.statusCode).toBe(403);
    const forged = await t.app.inject({ method: 'POST', url: '/api/voice/twilio', payload: 'CallSid=CA1', headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': 'nope' } });
    expect(forged.statusCode).toBe(403);
  });

  it('CALL → SAY CODE → SAY FOOD → CONFIRM: the order lands in the database and on the event stream', async () => {
    const callSid = sid();
    const events: LiveEvent[] = [];
    const unsubscribe = t.events.subscribe((e) => events.push(e));

    const start = await twilioPost(t, '/api/voice/twilio', { CallSid: callSid, From: '+491700000427', CallStatus: 'ringing' });
    expect(start.statusCode).toBe(200);
    expect(start.headers['content-type']).toContain('text/xml');
    expect(start.body).toContain('Willkommen beim Mittagessen-Service');
    expect(start.body).toContain('<Gather input="speech dtmf" language="de-DE"');

    const code = await twilioPost(t, '/api/voice/twilio', { CallSid: callSid, From: '+491700000427', SpeechResult: 'vier zwei sieben', Confidence: '0.91' });
    expect(code.body).toContain('Kundennummer vier zwei sieben erkannt');
    expect(code.body).toContain('Was möchten Sie heute zum Mittagessen bestellen?');

    const food = await twilioPost(t, '/api/voice/twilio', { CallSid: callSid, From: '+491700000427', SpeechResult: 'Ich hätte gerne Schnitzel mit Kartoffeln und Gemüse. Aber bitte ohne Zwiebeln.', Confidence: '0.88' });
    expect(food.body).toContain('Ich wiederhole Ihre Bestellung');
    expect(food.body).toContain('Schnitzel mit Kartoffeln und Gemüse, ohne Zwiebeln.');
    expect(food.body).toContain('Ist das richtig?');

    const yes = await twilioPost(t, '/api/voice/twilio', { CallSid: callSid, From: '+491700000427', SpeechResult: 'Ja.', Confidence: '0.95' });
    expect(yes.body).toContain('Ihre Bestellung wurde erfolgreich aufgenommen');
    expect(yes.body).toContain('<Hangup/>');
    unsubscribe();

    const orders = (await staff('GET', '/api/orders/today')).json().orders;
    const order = orders.find((o: { callId: string | null }) => !!o.callId);
    expect(order).toMatchObject({ customerCode: '427', customerName: 'Frau Erika Müller', roomNumber: '12', itemName: 'Schnitzel mit Kartoffeln und Gemüse', status: 'NEW', source: 'voice', confirmedByCustomer: true, needsReview: false });
    expect(order.modifications).toEqual([expect.objectContaining({ type: 'without', target: 'Zwiebeln', allowed: true })]);
    expect(events.some((e) => e.type === 'order' && e.action === 'create' && e.id === order.id)).toBe(true);

    const calls = (await staff('GET', '/api/calls')).json().calls;
    const call = calls.find((c: { callSid: string }) => c.callSid === callSid);
    expect(call).toMatchObject({ callStatus: 'completed', confirmation: 'confirmed', customerCode: '427', orderId: order.id, turns: 4 });
    expect(call.transcript.filter((l: { role: string }) => l.role === 'customer')).toHaveLength(3);
    expect(call.detectedOrder.confidence.customer).toBeGreaterThan(0.8);

    const status = await twilioPost(t, '/api/voice/twilio/status', { CallSid: callSid, CallStatus: 'completed', CallDuration: '61' });
    expect(status.statusCode).toBe(204);
    const closed = (await staff('GET', `/api/calls/${call.id}`)).json().call;
    expect(closed.durationSeconds).toBe(61);
    expect(closed.callStatus).toBe('completed');
  });

  it('a call that is hung up without an order is recorded as abandoned', async () => {
    const callSid = sid();
    await twilioPost(t, '/api/voice/twilio', { CallSid: callSid, From: '+491700000315' });
    await twilioPost(t, '/api/voice/twilio', { CallSid: callSid, SpeechResult: '315', Confidence: '0.9' });
    await twilioPost(t, '/api/voice/twilio/status', { CallSid: callSid, CallStatus: 'completed', CallDuration: '20' });
    const call = (await staff('GET', '/api/calls')).json().calls.find((c: { callSid: string }) => c.callSid === callSid);
    expect(call.callStatus).toBe('abandoned');
  });

  it('unknown customer twice → handoff with an alert; "Pizza" → today\'s choices; "Mitarbeiter" → dial', async () => {
    const a = sid();
    await twilioPost(t, '/api/voice/twilio', { CallSid: a });
    await twilioPost(t, '/api/voice/twilio', { CallSid: a, SpeechResult: '999', Confidence: '0.9' });
    const handoff = await twilioPost(t, '/api/voice/twilio', { CallSid: a, SpeechResult: '999', Confidence: '0.9' });
    expect(handoff.body).toContain('<Dial timeout="30">+493012345678</Dial>');
    const alerts = (await staff('GET', '/api/alerts')).json().alerts;
    expect(alerts.map((x: { type: string }) => x.type)).toEqual(expect.arrayContaining(['unknown_customer', 'human_handoff']));

    const b = sid();
    await twilioPost(t, '/api/voice/twilio', { CallSid: b });
    await twilioPost(t, '/api/voice/twilio', { CallSid: b, SpeechResult: '427', Confidence: '0.9' });
    const pizza = await twilioPost(t, '/api/voice/twilio', { CallSid: b, SpeechResult: 'Ich möchte Pizza.', Confidence: '0.9' });
    expect(pizza.body).toContain('Pizza haben wir heute leider nicht');
    const person = await twilioPost(t, '/api/voice/twilio', { CallSid: b, SpeechResult: 'Ich möchte mit einem Mitarbeiter sprechen', Confidence: '0.9' });
    expect(person.body).toContain('Ich verbinde Sie jetzt mit dem Restaurant');
  });

  it('"das gleiche wie gestern" resolves the previous order from the database', async () => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const customer = (await staff('GET', '/api/customers?q=315')).json().customers[0];
    await staff('PUT', `/api/menu/${yesterday}`, { published: true, items: [{ position: 1, nameDe: 'Fisch mit Reis und Salat', components: ['Reis', 'Salat'] }] });
    const yItem = (await staff('GET', `/api/menu/${yesterday}`)).json().items[0];
    await staff('POST', '/api/orders', { customerId: customer.id, menuItemId: yItem.id, orderDate: yesterday, modifications: ['ohne Salat'] });
    const c = sid();
    await twilioPost(t, '/api/voice/twilio', { CallSid: c });
    await twilioPost(t, '/api/voice/twilio', { CallSid: c, SpeechResult: 'drei eins fünf', Confidence: '0.9' });
    const same = await twilioPost(t, '/api/voice/twilio', { CallSid: c, SpeechResult: 'Das gleiche wie gestern.', Confidence: '0.9' });
    expect(same.body).toContain('Fisch mit Reis und Salat, ohne Salat.');
    expect(same.body).toContain('Ist das richtig?');
  });

  it('the text simulator runs the same engine and stores the same records', async () => {
    const start = await staff('POST', '/api/voice/simulate', {});
    expect(start.json().say[0]).toContain('Willkommen');
    const callId = start.json().callId;
    const code = await staff('POST', '/api/voice/simulate', { callId, utterance: 'Nummer 427' });
    expect(code.json().stage).toBe('ASK_ORDER');
    const dish = await staff('POST', '/api/voice/simulate', { callId, utterance: 'Nummer drei' });
    expect(dish.json().say[0]).toContain('Vegetarische Pasta');
    const yes = await staff('POST', '/api/voice/simulate', { callId, utterance: 'Ja' });
    expect(yes.json().effects).toContain('save_order');
    const call = (await staff('GET', `/api/calls/${callId}`)).json().call;
    expect(call.provider).toBe('simulator');
    expect(call.orderId).toBeTruthy();
  });

  it('GDPR: export returns everything, deletion removes calls and anonymises orders', async () => {
    const admin = api(t, (await loginAs(t, 'ADMIN', 'dsgvo@test.de')).cookie);
    const customer = (await admin('GET', '/api/customers?q=427')).json().customers[0];
    const exported = await admin('GET', `/api/customers/${customer.id}/export`);
    expect(exported.json().orders.length).toBeGreaterThan(0);
    expect(exported.json().calls.length).toBeGreaterThan(0);
    const del = await admin('DELETE', `/api/customers/${customer.id}`);
    expect(del.json().deletedCalls).toBeGreaterThan(0);
    const orders = (await admin('GET', '/api/orders/today')).json().orders.filter((o: { customerCode: string }) => o.customerCode === '427');
    expect(orders.every((o: { customerName: string; customerId: string | null }) => o.customerName === 'Gelöschter Kunde' && o.customerId === null)).toBe(true);
    expect((await admin('GET', `/api/customers/${customer.id}`)).statusCode).toBe(404);
  });
});
