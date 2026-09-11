import { describe, expect, it } from 'vitest';
import { extractAllergyNote, extractModifications, isAllowedModification, matchItem, mentionedFood } from '../../src/domain/menuMatch.ts';
import { MENU } from './fixtures.ts';

const item = (id: string) => MENU.find((m) => m.id === id)!;

describe('matchItem', () => {
  it('matches natural phrasings to the right dish', () => {
    const cases: [string, string][] = [
      ['Ich nehme Nummer eins.', 'm1'],
      ['Ich hätte gerne das Schnitzel.', 'm1'],
      ['Für mich bitte Schnitzel mit Reis.', 'm1'],
      ['Ich möchte heute das vegetarische Essen.', 'm3'],
      ['Ich nehme das erste Essen, aber ohne Zwiebeln.', 'm1'],
      ['Den Fisch bitte', 'm2'],
      ['Die Nudeln', 'm3'],
      ['Ich hätte gerne Schnitzel mit Kartoffeln und Gemüse. Aber bitte ohne Zwiebeln.', 'm1'],
      ['Schnitsel bitte', 'm1'],
    ];
    for (const [said, id] of cases) {
      const r = matchItem(said, MENU);
      expect(r.best?.item.id, said).toBe(id);
      expect(r.ambiguous, said).toBe(false);
      expect(r.best!.score).toBeGreaterThanOrEqual(0.7);
    }
  });
  it('treats a side dish alone as too weak to decide (rule: prefer clarification over guessing)', () => {
    const r = matchItem('Ich möchte Reis.', MENU);
    expect(r.best === null || r.best.score < 0.7).toBe(true);
  });
  it('does not match food that is not on the menu', () => {
    const r = matchItem('Ich möchte Pizza.', MENU);
    expect(r.best === null || r.best.score < 0.5).toBe(true);
    expect(mentionedFood('Ich möchte Pizza.', MENU)).toBe('Pizza');
  });
  it('matches an unavailable dish so the dialog can say it is unavailable', () => {
    const r = matchItem('Gulasch bitte', MENU);
    expect(r.best?.item.id).toBe('m4');
  });
});

describe('extractModifications', () => {
  it('reads "ohne Zwiebeln"', () => {
    const mods = extractModifications('Schnitzel bitte, aber ohne Zwiebeln', item('m1'));
    expect(mods).toEqual([expect.objectContaining({ type: 'without', target: 'Zwiebeln', textDe: 'ohne Zwiebeln', allowed: true })]);
  });
  it('reads "Reis statt Kartoffeln" (Test 2)', () => {
    const mods = extractModifications('Ich hätte gerne Schnitzel mit Reis statt Kartoffeln.', item('m1'));
    expect(mods).toEqual([expect.objectContaining({ type: 'replace', target: 'Kartoffeln', replacement: 'Reis', allowed: true })]);
  });
  it('reads "statt Kartoffeln Reis"', () => {
    const mods = extractModifications('statt Kartoffeln bitte Reis', item('m1'));
    expect(mods[0]).toEqual(expect.objectContaining({ type: 'replace', target: 'Kartoffeln', replacement: 'Reis' }));
  });
  it('infers the listed swap from "Schnitzel mit Reis"', () => {
    const mods = extractModifications('Für mich bitte Schnitzel mit Reis.', item('m1'));
    expect(mods[0]).toEqual(expect.objectContaining({ type: 'replace', target: 'Kartoffeln', replacement: 'Reis', allowed: true }));
  });
  it('marks unlisted changes as not allowed (kitchen review), but still records them', () => {
    const mods = extractModifications('Fisch ohne Reis', item('m2'));
    expect(mods[0]).toEqual(expect.objectContaining({ type: 'without', target: 'Reis', allowed: false }));
    expect(isAllowedModification({ type: 'without', target: 'Salat', textDe: 'ohne Salat' }, item('m2'))).toBe(true);
  });
  it('reads several changes', () => {
    const mods = extractModifications('ohne Zwiebeln und extra Soße', item('m1'));
    expect(mods.map((m) => m.type)).toEqual(['without', 'extra']);
  });
});

describe('extractAllergyNote', () => {
  it('records the sentence verbatim', () => {
    expect(extractAllergyNote('Ich darf keine Nüsse essen.')).toBe('Ich darf keine Nüsse essen');
    expect(extractAllergyNote('Schnitzel bitte. Ich habe eine Laktoseunverträglichkeit.')).toBe('Ich habe eine Laktoseunverträglichkeit');
    expect(extractAllergyNote('Schnitzel bitte')).toBeNull();
  });
});
