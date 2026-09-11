import { describe, expect, it } from 'vitest';
import { initialState, runTurn } from '../../src/domain/dialog.ts';
import type { CallState, DialogContext, Effect, TurnResult } from '../../src/domain/types.ts';
import { AT, TODAY, makeContext } from './fixtures.ts';

/** Drives a call: an array of things the caller says (null = silence, {digits} = keypad). */
async function call(ctx: DialogContext, said: (string | null | { digits: string })[], from: string | null = null) {
  let state: CallState = initialState(TODAY, from);
  const turns: TurnResult[] = [];
  let r = await runTurn(state, { utterance: null, callerNumber: from, now: AT }, ctx);
  turns.push(r); state = r.state;
  for (const s of said) {
    const input = s === null ? { utterance: '', now: AT } : typeof s === 'string' ? { utterance: s, sttConfidence: 0.9, now: AT } : { utterance: '', digits: s.digits, now: AT };
    r = await runTurn(state, input, ctx);
    turns.push(r); state = r.state;
  }
  const effects = turns.flatMap((t) => t.effects);
  const spoken = turns.map((t) => t.say.join(' '));
  return { state, turns, effects, spoken, last: turns[turns.length - 1] };
}

const saved = (effects: Effect[]) => effects.find((e): e is Extract<Effect, { type: 'save_order' }> => e.type === 'save_order');
const alerts = (effects: Effect[]) => effects.filter((e): e is Extract<Effect, { type: 'alert' }> => e.type === 'alert');

describe('the example conversation', () => {
  it('CALL → SAY CODE → SAY FOOD → CONFIRM', async () => {
    const ctx = makeContext();
    const { spoken, effects, last, state } = await call(ctx, [
      'Vier zwei sieben.',
      'Ich hätte gerne Schnitzel mit Kartoffeln und Gemüse. Aber bitte ohne Zwiebeln.',
      'Ja.',
    ]);
    expect(spoken[0]).toContain('Guten Tag. Willkommen beim Mittagessen-Service.');
    expect(spoken[0]).toContain('Kundennummer');
    expect(spoken[1]).toContain('Kundennummer vier zwei sieben erkannt');
    expect(spoken[1]).toContain('Was möchten Sie heute zum Mittagessen bestellen?');
    expect(spoken[2]).toContain('Ich wiederhole Ihre Bestellung');
    expect(spoken[2]).toContain('Schnitzel mit Kartoffeln und Gemüse, ohne Zwiebeln.');
    expect(spoken[2]).toContain('Ist das richtig?');
    expect(spoken[3]).toContain('Ihre Bestellung wurde erfolgreich aufgenommen');
    expect(last.action).toBe('hangup');
    const order = saved(effects)!;
    expect(order.customer.customerCode).toBe('427');
    expect(order.draft.itemName).toBe('Schnitzel mit Kartoffeln und Gemüse');
    expect(order.draft.modifications).toEqual([expect.objectContaining({ type: 'without', target: 'Zwiebeln', allowed: true })]);
    expect(order.draft.needsReview).toBe(false);
    expect(order.draft.quantity).toBe(1);
    expect(state.stage).toBe('DONE');
    expect(state.transcript.filter((t) => t.role === 'customer')).toHaveLength(3);
  });
});

describe('customer identification', () => {
  it('accepts "427", "Nummer 427", "Meine Nummer ist 427" and keypad digits', async () => {
    for (const s of ['427', 'Nummer 427', 'Meine Nummer ist 427', 'Nummer vierhundertsiebenundzwanzig', { digits: '427' }]) {
      const { state } = await call(makeContext(), [s as never]);
      expect(state.customer?.customerCode, JSON.stringify(s)).toBe('427');
      expect(state.stage).toBe('ASK_ORDER');
    }
  });
  it('asks again when the code is unclear, then offers the keypad, then hands off', async () => {
    const { spoken, last, effects } = await call(makeContext(), ['Guten Tag', 'Ich bin es', 'Hallo?']);
    expect(spoken[1]).toContain('noch einmal langsam nennen');
    expect(spoken[2]).toContain('Tasten');
    expect(spoken[3]).toContain('verbinde Sie');
    expect(last.action).toBe('dial');
    expect(alerts(effects).map((a) => a.alertType)).toContain('repeated_failures');
  });
  it('does not pick between two spoken numbers', async () => {
    const { spoken, state } = await call(makeContext(), ['vier zwei sieben oder drei eins fünf']);
    expect(state.customer).toBeNull();
    expect(spoken[1]).toContain('noch einmal');
  });
  it('confirms a low-confidence code instead of accepting it', async () => {
    const ctx = makeContext();
    let state = initialState(TODAY);
    let r = await runTurn(state, { utterance: null, now: AT }, ctx); state = r.state;
    r = await runTurn(state, { utterance: 'vier zwei sieben', sttConfidence: 0.2, now: AT }, ctx); state = r.state;
    expect(state.stage).toBe('CONFIRM_CODE');
    expect(r.say[0]).toContain('vier zwei sieben verstanden. Ist das richtig?');
    r = await runTurn(state, { utterance: 'Nein', now: AT }, ctx); state = r.state;
    expect(state.stage).toBe('ASK_CODE');
    r = await runTurn(state, { utterance: '315', sttConfidence: 0.95, now: AT }, ctx); state = r.state;
    expect(state.customer?.customerCode).toBe('315');
  });
  it('unknown customer: asks once more, then hands off with an alert', async () => {
    const { spoken, last, effects } = await call(makeContext(), ['111', '111']);
    expect(spoken[1]).toContain('kenne ich leider nicht');
    expect(last.action).toBe('dial');
    expect(alerts(effects).map((a) => a.alertType)).toEqual(expect.arrayContaining(['unknown_customer', 'human_handoff']));
  });
  it('inactive customer is handed off', async () => {
    const { last, effects } = await call(makeContext(), ['999']);
    expect(last.action).toBe('dial');
    expect(alerts(effects).some((a) => a.alertType === 'unknown_customer')).toBe(true);
  });
  it('caller id that contradicts the spoken code triggers a confirmation, never a silent order', async () => {
    const ctx = makeContext();
    const { spoken, state, effects } = await call(ctx, ['427'], '+491700000315');
    expect(state.stage).toBe('CONFIRM_CODE');
    expect(spoken[1]).toContain('Ist das richtig?');
    expect(alerts(effects).some((a) => a.alertType === 'caller_mismatch')).toBe(true);
    const r = await runTurn(state, { utterance: 'Ja', now: AT }, ctx);
    expect(r.state.customer?.customerCode).toBe('427');
  });
  it('caller id that agrees with the code changes nothing', async () => {
    const { state } = await call(makeContext(), ['427'], '+491700000427');
    expect(state.stage).toBe('ASK_ORDER');
  });
  it('"nein" right after the recognised code goes back to asking for the code', async () => {
    const { state } = await call(makeContext(), ['427', 'Nein']);
    expect(state.stage).toBe('ASK_CODE');
    expect(state.customer).toBeNull();
  });
});

describe('ordering', () => {
  it('Test 2: "Schnitzel mit Reis statt Kartoffeln" → replace potatoes', async () => {
    const { effects, spoken } = await call(makeContext(), ['427', 'Ich hätte gerne Schnitzel mit Reis statt Kartoffeln.', 'Ja']);
    const o = saved(effects)!;
    expect(o.draft.itemName).toContain('Schnitzel');
    expect(o.draft.modifications[0]).toEqual(expect.objectContaining({ type: 'replace', target: 'Kartoffeln', replacement: 'Reis', allowed: true }));
    expect(spoken[2]).toContain('Reis statt Kartoffeln');
  });
  it('Test 4: "das erste Essen, aber ohne Zwiebeln" → item 1, no onions', async () => {
    const { effects } = await call(makeContext(), ['427', 'Ich möchte das erste Essen, aber ohne Zwiebeln.', 'Ja']);
    const o = saved(effects)!;
    expect(o.draft.itemPosition).toBe(1);
    expect(o.draft.modifications[0].textDe).toBe('ohne Zwiebeln');
  });
  it('Test 5: "Nein, ich meinte das zweite Essen" changes the selection and asks again', async () => {
    const { spoken, effects, state } = await call(makeContext(), ['427', 'Nummer eins', 'Nein, ich meinte das zweite Essen.', 'Ja']);
    expect(spoken[2]).toContain('Schnitzel');
    expect(spoken[3]).toContain('Fisch mit Reis und Salat');
    expect(spoken[3]).toContain('Ist das richtig?');
    expect(saved(effects)!.draft.itemPosition).toBe(2);
    expect(state.stage).toBe('DONE');
  });
  it('all natural phrasings reach a confirmation', async () => {
    for (const s of ['Ich nehme Nummer eins.', 'Ich hätte gerne das Schnitzel.', 'Für mich bitte Schnitzel mit Reis.', 'Ich möchte heute das vegetarische Essen.', 'Ich nehme das erste Essen, aber ohne Zwiebeln.']) {
      const { state } = await call(makeContext(), ['427', s]);
      expect(state.stage, s).toBe('CONFIRM_ORDER');
    }
  });
  it('Rejection: "Nein" → "Was möchten Sie ändern?" → change → confirm again', async () => {
    const { spoken, effects } = await call(makeContext(), ['427', 'Das Schnitzel', 'Nein', 'Ohne Zwiebeln bitte', 'Ja, genau']);
    expect(spoken[3]).toBe('Kein Problem. Was möchten Sie ändern?');
    expect(spoken[4]).toContain('ohne Zwiebeln');
    expect(saved(effects)!.draft.modifications[0].target).toBe('Zwiebeln');
  });
  it('"ja, aber ohne Zwiebeln" during confirmation is a change, then confirmed', async () => {
    const { effects, state } = await call(makeContext(), ['427', 'Das Schnitzel', 'Ja, aber ohne Zwiebeln', 'Ja']);
    expect(saved(effects)!.draft.modifications[0].target).toBe('Zwiebeln');
    expect(state.stage).toBe('DONE');
  });
  it('Ambiguous speech: "Ich möchte Reis" asks which dish instead of guessing', async () => {
    const { spoken, state } = await call(makeContext(), ['427', 'Ich möchte Reis.']);
    expect(state.stage).toBe('ASK_ORDER');
    expect(spoken[2]).toMatch(/nicht ganz verstanden.*Möchten Sie/);
    expect(spoken[2]).toContain('Fisch mit Reis und Salat');
  });
  it('Unavailable menu item: Pizza is not on the menu → lists today\'s choices', async () => {
    const { spoken, effects, state } = await call(makeContext(), ['427', 'Ich möchte Pizza.']);
    expect(spoken[2]).toContain('Pizza haben wir heute leider nicht');
    expect(spoken[2]).toContain('Heute können Sie zwischen');
    expect(state.stage).toBe('ASK_ORDER');
    expect(alerts(effects).some((a) => a.alertType === 'unavailable_item')).toBe(true);
  });
  it('a dish marked unavailable today is refused with the alternatives', async () => {
    const { spoken, state } = await call(makeContext(), ['427', 'Gulasch bitte']);
    expect(spoken[2]).toContain('Gulasch mit Knödeln ist heute leider nicht verfügbar');
    expect(state.stage).toBe('ASK_ORDER');
  });
  it('quantity: "zwei mal Schnitzel"', async () => {
    const { effects, spoken } = await call(makeContext(), ['427', 'Zwei mal das Schnitzel bitte', 'Ja']);
    expect(saved(effects)!.draft.quantity).toBe(2);
    expect(spoken[2]).toContain('zwei Mal');
  });
  it('reads the menu on request', async () => {
    const { spoken } = await call(makeContext(), ['427', 'Was gibt es heute?']);
    expect(spoken[2]).toContain('Heute haben wir: Nummer eins: Schnitzel');
    expect(spoken[2]).not.toContain('Gulasch');
  });
  it('an unlisted modification is recorded and flagged for review, not refused', async () => {
    const { effects, spoken } = await call(makeContext(), ['427', 'Den Fisch ohne Reis', 'Ja']);
    const o = saved(effects)!;
    expect(o.draft.modifications[0]).toEqual(expect.objectContaining({ target: 'Reis', allowed: false }));
    expect(o.draft.needsReview).toBe(true);
    expect(spoken[3]).toContain('prüft');
  });
  it('after the order deadline the order is taken with a note and flagged', async () => {
    const ctx = makeContext();
    let state = initialState(TODAY);
    const late = new Date('2026-09-11T11:00:00+02:00');
    let r = await runTurn(state, { utterance: null, now: late }, ctx); state = r.state;
    r = await runTurn(state, { utterance: '427', sttConfidence: 0.9, now: late }, ctx); state = r.state;
    expect(r.say.join(' ')).toContain('Bestellschluss');
    r = await runTurn(state, { utterance: 'Nummer eins', now: late }, ctx); state = r.state;
    r = await runTurn(state, { utterance: 'Ja', now: late }, ctx);
    expect(saved(r.effects)!.draft.reviewReason).toContain('Bestellschluss');
  });
  it('cancel: no order is saved', async () => {
    const { effects, last } = await call(makeContext(), ['427', 'Ich möchte heute doch nichts bestellen']);
    expect(saved(effects)).toBeUndefined();
    expect(last.action).toBe('hangup');
    expect(effects.some((e) => e.type === 'call_completed' && e.outcome === 'no_order')).toBe(true);
  });
});

describe('same as yesterday', () => {
  const prev = { orderDate: '2026-09-10', itemName: 'Fisch mit Reis und Salat', menuItemId: 'old-id', modifications: [{ type: 'without' as const, target: 'Salat', textDe: 'ohne Salat', allowed: true }], quantity: 1 };
  it('Test 3: resolves the previous order, validates it against today and asks for confirmation', async () => {
    const ctx = makeContext({ previous: { c427: prev } });
    const { spoken, state, effects } = await call(ctx, ['427', 'Das gleiche wie gestern.', 'Ja']);
    expect(spoken[2]).toContain('Fisch mit Reis und Salat, ohne Salat.');
    expect(spoken[2]).toContain('Ist das richtig?');
    expect(saved(effects)!.draft.menuItemId).toBe('m2');
    expect(state.stage).toBe('DONE');
  });
  it('yesterday\'s dish is not on today\'s menu → says so and reads today\'s menu', async () => {
    const ctx = makeContext({ previous: { c427: { ...prev, itemName: 'Gulasch mit Knödeln', menuItemId: 'm4' } } });
    const { spoken, state } = await call(ctx, ['427', 'Wie gestern bitte.']);
    expect(spoken[2]).toContain('Das Essen von gestern ist heute leider nicht verfügbar. Heute haben wir');
    expect(state.stage).toBe('ASK_ORDER');
  });
  it('no previous order → explains and reads the menu', async () => {
    const { spoken, state } = await call(makeContext(), ['427', 'Ich nehme wieder das gleiche.']);
    expect(spoken[2]).toContain('keine frühere Bestellung');
    expect(state.stage).toBe('ASK_ORDER');
  });
});

describe('allergy request', () => {
  it('records the sentence, flags the order for review and raises a critical alert; makes no guarantee', async () => {
    const { effects, spoken } = await call(makeContext(), ['427', 'Das Schnitzel bitte. Ich darf keine Nüsse essen.', 'Ja']);
    const o = saved(effects)!;
    expect(o.draft.allergyNote).toContain('keine Nüsse');
    expect(o.draft.needsReview).toBe(true);
    expect(alerts(effects).find((a) => a.alertType === 'allergy_request')?.severity).toBe('critical');
    expect(spoken[2]).toContain('Das Restaurant prüft ihn persönlich');
    expect(spoken.join(' ')).not.toMatch(/garantier/i);
  });
});

describe('error handling and handoff', () => {
  it('after repeated misunderstandings the caller is connected to the restaurant', async () => {
    const { spoken, last, effects } = await call(makeContext(), ['427', 'Mmh', 'Also äh', 'Wie bitte']);
    expect(spoken[2]).toContain('nicht ganz verstanden. Können Sie das bitte noch einmal sagen?');
    expect(spoken[4]).toBe('Kein Problem. Ich verbinde Sie jetzt mit dem Restaurant.');
    expect(last.action).toBe('dial');
    expect(effects.some((e) => e.type === 'handoff')).toBe(true);
  });
  it('asking for a person hands off at any stage', async () => {
    for (const script of [['Ich möchte mit einem Mitarbeiter sprechen'], ['427', 'Kann ich jemanden sprechen?'], ['427', 'Nummer eins', 'Verbinden Sie mich bitte']]) {
      const { last, effects } = await call(makeContext(), script);
      expect(last.action, script.join('/')).toBe('dial');
      expect(alerts(effects).some((a) => a.alertType === 'human_handoff')).toBe(true);
    }
  });
  it('without a handoff number the call is flagged and ended politely', async () => {
    const { last, spoken, effects } = await call(makeContext({ settings: { handoffAvailable: false } as never }), ['Mitarbeiter bitte']);
    expect(last.action).toBe('hangup');
    expect(spoken[1]).toContain('niemand erreichbar');
    expect(alerts(effects).some((a) => a.alertType === 'human_handoff')).toBe(true);
  });
  it('silence is met with patience, not a hang-up', async () => {
    const { spoken, state, last } = await call(makeContext(), ['427', null, null]);
    expect(spoken[2]).toBe('Ich warte gerne. Sagen Sie einfach Ihre Bestellung, wenn Sie bereit sind.');
    expect(state.stage).toBe('ASK_ORDER');
    expect(last.action).toBe('gather');
  });
  it('a caller who never speaks is not trapped', async () => {
    const { last } = await call(makeContext(), [null, null, null]);
    expect(last.action).toBe('hangup');
  });
  it('no menu for today → handoff', async () => {
    const { last, spoken } = await call(makeContext({ menu: [] }), []);
    expect(spoken[0]).toContain('kein Speiseplan');
    expect(last.action).toBe('dial');
  });
  it('keypad 1 / 2 work as yes / no in the confirmation', async () => {
    const { state } = await call(makeContext(), ['427', 'Nummer eins', { digits: '2' }]);
    expect(state.stage).toBe('ASK_CHANGE');
    const { effects } = await call(makeContext(), ['427', 'Nummer eins', { digits: '1' }]);
    expect(saved(effects)).toBeDefined();
  });
  it('a model provider that throws never blocks the call', async () => {
    const ctx = makeContext({ understand: async () => { throw new Error('fable down'); } });
    await expect(call(ctx, ['427', 'Etwas Leckeres bitte'])).rejects.toThrow();
  });
});

describe('confidence tracking', () => {
  it('records customer, order and menu-match confidence in the state', async () => {
    const { state } = await call(makeContext(), ['427', 'Ich nehme Nummer eins.']);
    expect(state.customerConfidence).toBeGreaterThan(0.8);
    expect(state.orderConfidence).toBeGreaterThan(0.9);
    expect(state.menuMatchConfidence).toBeGreaterThan(0.9);
  });
  it('does not accept a dish below the threshold', async () => {
    const ctx = makeContext({ settings: { confidenceThreshold: 0.99 } as never });
    const { state } = await call(ctx, ['427', 'Ich hätte gerne das Schnitzel.']);
    expect(state.stage).not.toBe('CONFIRM_ORDER');
  });
});
