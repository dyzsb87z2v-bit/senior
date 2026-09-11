import { describe, expect, it } from 'vitest';
import { CompositeUnderstanding, isNo, isPureYes, understandWithRules, validateUnderstanding } from '../../src/domain/understanding.ts';
import type { Understanding, UnderstandInput } from '../../src/domain/types.ts';
import { MENU } from './fixtures.ts';

const input = (utterance: string, stage: UnderstandInput['stage'] = 'order', draft: UnderstandInput['draft'] = null): UnderstandInput =>
  ({ utterance, stage, menu: MENU, draft, hasPreviousOrder: true });

describe('confirmation words', () => {
  it('accepts the listed confirmations', () => {
    for (const s of ['Ja', 'Ja, genau', 'Richtig', 'Das stimmt', 'Ja das ist richtig', 'Okay']) expect(isPureYes(s), s).toBe(true);
  });
  it('rejects the listed rejections', () => {
    for (const s of ['Nein', 'Nicht ganz', 'Falsch', 'Nein, das stimmt nicht']) {
      expect(isPureYes(s), s).toBe(false);
      expect(isNo(s), s).toBe(true);
    }
  });
  it('does not treat "ja, aber ohne Zwiebeln" as a plain yes', () => {
    expect(isPureYes('Ja, aber ohne Zwiebeln')).toBe(false);
  });
});

describe('understandWithRules', () => {
  it('recognises intents', () => {
    expect(understandWithRules(input('Das gleiche wie gestern.')).intent).toBe('same_as_yesterday');
    expect(understandWithRules(input('Wie gestern bitte.')).intent).toBe('same_as_yesterday');
    expect(understandWithRules(input('Ich nehme wieder das gleiche.')).intent).toBe('same_as_yesterday');
    expect(understandWithRules(input('Ich möchte mit einem Mitarbeiter sprechen')).intent).toBe('handoff');
    expect(understandWithRules(input('Was gibt es heute?')).intent).toBe('repeat_menu');
    expect(understandWithRules(input('Ich möchte doch nichts bestellen')).intent).toBe('cancel');
    expect(understandWithRules(input('Ja', 'confirm')).intent).toBe('yes');
    expect(understandWithRules(input('Nein', 'confirm')).intent).toBe('no');
  });
  it('extracts an order with a modification', () => {
    const u = understandWithRules(input('Ich möchte das erste Essen, aber ohne Zwiebeln.'));
    expect(u.intent).toBe('order');
    expect(u.items[0].position).toBe(1);
    expect(u.modifications[0]).toEqual(expect.objectContaining({ type: 'without', target: 'Zwiebeln' }));
  });
  it('is unsure about a side dish alone', () => {
    const u = understandWithRules(input('Ich möchte Reis.'));
    expect(u.confidence).toBeLessThan(0.7);
  });
  it('turns "Nein, ich meinte das zweite Essen" in the confirm stage into a new choice (Test 5)', () => {
    const u = understandWithRules(input('Nein, ich meinte das zweite Essen.', 'confirm', { menuItemId: 'm1', itemPosition: 1, itemName: 'x', components: [], quantity: 1, modifications: [], specialRequest: null, allergyNote: null, needsReview: false, reviewReason: null, menuMatchConfidence: 1 }));
    expect(u.intent).toBe('order');
    expect(u.items[0].position).toBe(2);
  });
});

describe('validateUnderstanding (AI output is never trusted)', () => {
  it('drops dishes that are not on the menu and clips numbers', () => {
    const u = validateUnderstanding({ intent: 'order', items: [{ position: 9, confidence: 1 }, { position: 2, confidence: 7 }], quantity: 400, confidence: -1 } as never, MENU, 'fable');
    expect(u.items).toEqual([{ menuItemId: 'm2', position: 2, confidence: 1 }]);
    expect(u.quantity).toBe(99);
    expect(u.confidence).toBe(0);
  });
  it('rejects unknown intents', () => {
    expect(validateUnderstanding({ intent: 'pizza' as never }, MENU, 'fable').intent).toBe('unclear');
  });
});

describe('CompositeUnderstanding', () => {
  const model = (answer: Record<string, unknown>) => ({
    name: 'fake', understand: async () => answer as unknown as Understanding,
  });
  it('does not call the model when the rules are confident', async () => {
    let called = false;
    const c = new CompositeUnderstanding({ name: 'fake', understand: async () => { called = true; return {} as Understanding; } });
    const u = await c.understand(input('Nummer eins bitte'));
    expect(u.items[0].position).toBe(1);
    expect(called).toBe(false);
  });
  it('asks the model for natural sentences and validates the answer', async () => {
    const c = new CompositeUnderstanding(model({ intent: 'order', items: [{ position: 3, confidence: 0.9 }], confidence: 0.9, modifications: [] }));
    const u = await c.understand(input('Ich hätte gern heute etwas ohne Fleisch, bitte'));
    expect(u.items[0].menuItemId).toBe('m3');
    expect(u.source).toBe('composite');
  });
  it('treats a disagreement between rules and model as ambiguity, not a decision', async () => {
    const c = new CompositeUnderstanding(model({ intent: 'order', items: [{ position: 2, confidence: 0.95 }], confidence: 0.95, modifications: [] }));
    // rules: sides only → weak candidate; model: fish. Weak rule candidate does not block the model.
    const u1 = await c.understand(input('Ich möchte Reis.'));
    expect(u1.items[0].menuItemId).toBe('m2');
    // rules: a fuzzy Schnitzel (0.78, below the rule threshold) so the model is consulted; the model says fish. Neither wins.
    const u2 = await c.understand(input('Schnitsel bitte'));
    expect(u2.items.every((i) => i.confidence <= 0.5)).toBe(true);
  });
  it('falls back to the rules when the model fails', async () => {
    const c = new CompositeUnderstanding({ name: 'fake', understand: async () => { throw new Error('timeout'); } });
    const u = await c.understand(input('Ich möchte Reis.'));
    expect(u.intent).toBe('order');
    expect(u.confidence).toBeLessThan(0.7);
  });
});
