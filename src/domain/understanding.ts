/**
 * Order understanding providers.
 *
 * `RuleBasedUnderstanding` decides everything that can be decided without a
 * model — menu numbers, dish names, yes/no, "wie gestern", "ohne Zwiebeln".
 * `CompositeUnderstanding` runs the rules first and asks the model provider
 * (Fable) only when the rules are not confident. `validateUnderstanding`
 * re-checks whatever any provider returns against the menu, so a model can
 * never introduce a dish that is not on it.
 */
import { containsAny, fold } from './text.ts';
import { extractQuantity } from './numbers.ts';
import { extractAllergyNote, extractModifications, isAllowedModification, matchItem, mentionedFood } from './menuMatch.ts';
import type { Intent, ItemCandidate, MenuItem, Modification, OrderUnderstandingProvider, RawUnderstanding, Understanding, UnderstandInput } from './types.ts';

export const YES_PHRASES = ['ja', 'jawohl', 'genau', 'richtig', 'stimmt', 'korrekt', 'passt', 'in ordnung', 'okay', 'ok', 'jo', 'jap', 'sicher', 'natuerlich', 'gerne', 'einverstanden', 'das stimmt', 'ja genau', 'alles richtig'];
export const NO_PHRASES = ['nein', 'nee', 'noe', 'falsch', 'nicht ganz', 'stimmt nicht', 'nicht richtig', 'nicht korrekt', 'das ist falsch', 'nicht so'];
export const HANDOFF_PHRASES = ['mitarbeiter', 'mitarbeiterin', 'menschen sprechen', 'einem menschen', 'mit jemandem', 'jemanden sprechen', 'jemand sprechen', 'verbinden sie mich', 'verbinden', 'restaurant sprechen', 'kueche sprechen', 'echte person', 'echten menschen', 'persoenlich sprechen', 'mit einer person', 'weiterleiten', 'durchstellen', 'chef sprechen'];
export const SAME_AS_YESTERDAY_PHRASES = ['wie gestern', 'das gleiche', 'dasselbe', 'das selbe', 'wie immer', 'wie letztes mal', 'wie beim letzten mal', 'nochmal das gleiche', 'wieder das gleiche', 'das uebliche', 'wie sonst'];
export const REPEAT_MENU_PHRASES = ['was gibt es', 'was gibts', 'was haben sie', 'was gibt', 'speiseplan', 'auswahl', 'welche gerichte', 'was zur auswahl', 'noch einmal sagen', 'wiederholen', 'nochmal sagen', 'was koennen sie', 'was steht'];
export const CANCEL_PHRASES = ['abbrechen', 'doch nicht', 'keine bestellung', 'nichts bestellen', 'auf wiederhoeren', 'auflegen', 'gar nichts', 'heute nichts', 'nichts heute'];

function empty(source: Understanding['source']): Understanding {
  return { intent: 'unclear', items: [], mentionedFood: null, quantity: null, modifications: [], allergyNote: null, specialRequest: null, confidence: 0, source };
}

/** A yes that is only a yes — "ja, aber ohne Zwiebeln" is a change, not a yes. */
export function isPureYes(utterance: string): boolean {
  const f = fold(utterance);
  if (!f) return false;
  if (NO_PHRASES.some((p) => (' ' + f + ' ').includes(' ' + p + ' '))) return false;
  if (/\b(aber|ohne|statt|anstatt|lieber|extra|nicht)\b/.test(f)) return false;
  const words = f.split(' ');
  const yesWords = new Set(['ja', 'jawohl', 'genau', 'richtig', 'stimmt', 'korrekt', 'passt', 'okay', 'ok', 'jo', 'jap', 'sicher', 'natuerlich', 'gerne', 'einverstanden', 'alles', 'das', 'ist', 'so', 'gut', 'danke', 'in', 'ordnung', 'super', 'prima', 'schoen', 'bitte', 'ja']);
  return words.some((w) => YES_PHRASES.includes(w)) && words.every((w) => yesWords.has(w));
}

export function isNo(utterance: string): boolean {
  const f = ' ' + fold(utterance) + ' ';
  return NO_PHRASES.some((p) => f.includes(' ' + p + ' '));
}

export function wantsHandoff(utterance: string): boolean {
  return !!containsAny(utterance, HANDOFF_PHRASES);
}

export class RuleBasedUnderstanding implements OrderUnderstandingProvider {
  readonly name = 'rules';

  async understand(input: UnderstandInput): Promise<Understanding> {
    return understandWithRules(input);
  }
}

export function understandWithRules(input: UnderstandInput): Understanding {
  const { utterance, menu } = input;
  const u = empty('rules');
  const f = fold(utterance);
  if (!f) return u;

  if (wantsHandoff(utterance)) return { ...u, intent: 'handoff', confidence: 0.95 };

  if (input.stage === 'confirm') {
    if (isPureYes(utterance)) return { ...u, intent: 'yes', confidence: 0.95 };
  }

  if (containsAny(utterance, CANCEL_PHRASES) && !containsAny(utterance, ['ohne'])) return { ...u, intent: 'cancel', confidence: 0.85 };
  if (containsAny(utterance, REPEAT_MENU_PHRASES)) return { ...u, intent: 'repeat_menu', confidence: 0.9 };

  const allergyNote = extractAllergyNote(utterance);
  const quantity = extractQuantity(utterance);

  if (containsAny(utterance, SAME_AS_YESTERDAY_PHRASES)) {
    return { ...u, intent: 'same_as_yesterday', confidence: 0.92, allergyNote, quantity, modifications: extractModifications(utterance, null) };
  }

  const match = matchItem(utterance, menu);
  const items: ItemCandidate[] = [];
  if (match.best) items.push({ menuItemId: match.best.item.id, position: match.best.item.position, confidence: match.best.score });
  if (match.ambiguousWith) items.push({ menuItemId: match.ambiguousWith.item.id, position: match.ambiguousWith.item.position, confidence: match.ambiguousWith.score });

  const bestItem = match.best && match.best.score >= 0.6 && !match.ambiguous ? match.best.item : (input.draft ? menu.find((m) => m.id === input.draft?.menuItemId) || null : null);
  const modifications = extractModifications(utterance, bestItem);
  const food = items.length ? null : mentionedFood(utterance, menu);

  let intent: Intent = 'unclear';
  let confidence = 0;
  const negative = isNo(utterance);

  if (items.length && items[0].confidence >= 0.6) {
    intent = 'order';
    confidence = match.ambiguous ? Math.min(items[0].confidence, 0.5) : items[0].confidence;
  } else if (modifications.length && (input.stage === 'change' || input.stage === 'confirm' || input.draft)) {
    // Only a change to the current dish: "ohne Zwiebeln", "Reis statt Kartoffeln".
    intent = 'order';
    confidence = 0.85;
  } else if (allergyNote && input.draft) {
    intent = 'order';
    confidence = 0.8;
  } else if (negative && (input.stage === 'confirm')) {
    intent = 'no';
    confidence = 0.9;
  } else if (food) {
    intent = 'order';
    confidence = 0.3;
  } else if (items.length) {
    intent = 'order';
    confidence = items[0].confidence;
  }

  // "Nein, ich meinte das zweite Essen": a no that carries a new choice is a change.
  if (negative && input.stage === 'confirm' && items.length && items[0].confidence >= 0.6) {
    intent = 'order';
    confidence = items[0].confidence;
  }

  return { intent, items, mentionedFood: food, quantity, modifications, allergyNote, specialRequest: null, confidence, source: 'rules' };
}

/**
 * Re-checks a provider's answer against the menu. Unknown items are dropped,
 * numbers are clipped, and the confidence never rises above what the menu
 * can support.
 */
export function validateUnderstanding(raw: RawUnderstanding, menu: MenuItem[], source: Understanding['source']): Understanding {
  const intents: Intent[] = ['order', 'same_as_yesterday', 'yes', 'no', 'handoff', 'repeat_menu', 'cancel', 'unclear'];
  const intent = intents.includes(raw.intent as Intent) ? (raw.intent as Intent) : 'unclear';
  const clip = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);
  const items: ItemCandidate[] = [];
  for (const it of raw.items || []) {
    const found = menu.find((m) => (it.menuItemId && m.id === it.menuItemId) || (typeof it.position === 'number' && m.position === it.position));
    if (!found) continue;
    if (items.some((x) => x.menuItemId === found.id)) continue;
    items.push({ menuItemId: found.id, position: found.position, confidence: clip(it.confidence) });
  }
  items.sort((a, b) => b.confidence - a.confidence);
  const modifications: Modification[] = [];
  for (const m of raw.modifications || []) {
    if (!m || typeof m !== 'object') continue;
    const type: Modification['type'] = (['without', 'replace', 'extra', 'note'] as const).includes(m.type as never) ? (m.type as Modification['type']) : 'note';
    const allowedFlag = typeof m.allowed === 'boolean' ? m.allowed : undefined;
    const target = String(m.target || '').trim().slice(0, 80);
    if (!target) continue;
    const replacement = m.replacement ? String(m.replacement).trim().slice(0, 80) : undefined;
    const textDe = m.textDe ? String(m.textDe).slice(0, 120) : type === 'without' ? `ohne ${target}` : type === 'replace' ? `${replacement} statt ${target}` : type === 'extra' ? `extra ${target}` : target;
    modifications.push({ type, target, replacement, textDe, allowed: allowedFlag });
  }
  const quantity = typeof raw.quantity === 'number' && Number.isInteger(raw.quantity) && raw.quantity >= 1 ? Math.min(raw.quantity, 99) : null;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  return {
    intent,
    items,
    mentionedFood: str(raw.mentionedFood, 60),
    quantity,
    modifications,
    allergyNote: str(raw.allergyNote, 300),
    specialRequest: str(raw.specialRequest, 300),
    confidence: clip(raw.confidence),
    source,
  };
}

/**
 * Rules first, model second. The model is asked only when the rules are not
 * confident; its answer is validated and then merged with the rule result so
 * that deterministic findings (an allergy sentence, a quantity) survive.
 */
export class CompositeUnderstanding implements OrderUnderstandingProvider {
  readonly name = 'composite';
  private readonly model: OrderUnderstandingProvider | null;
  private readonly ruleThreshold: number;

  constructor(model: OrderUnderstandingProvider | null, ruleThreshold = 0.85) {
    this.model = model;
    this.ruleThreshold = ruleThreshold;
  }

  async understand(input: UnderstandInput): Promise<Understanding> {
    const rules = understandWithRules(input);
    const decisive = rules.intent !== 'unclear' && rules.confidence >= this.ruleThreshold;
    if (decisive || !this.model) return { ...rules, source: this.model ? 'composite' : 'rules' };

    let modelResult: Understanding | null = null;
    try {
      modelResult = validateUnderstanding(await this.model.understand(input), input.menu, 'fable');
    } catch {
      modelResult = null;
    }
    if (!modelResult) return { ...rules, source: 'composite' };

    // Allow the model's dish only when the rules had no strong, conflicting candidate.
    const ruleTop = rules.items[0];
    const modelTop = modelResult.items[0];
    let items = modelResult.items;
    if (ruleTop && modelTop && ruleTop.menuItemId !== modelTop.menuItemId && ruleTop.confidence >= 0.6) {
      // The two disagree: that is ambiguity, not a decision.
      items = [ruleTop, modelTop].map((c) => ({ ...c, confidence: Math.min(c.confidence, 0.5) }));
    }
    const menuItem = items[0] ? input.menu.find((m) => m.id === items[0].menuItemId) || null : null;
    const mods = rules.modifications.length ? rules.modifications : modelResult.modifications.map((m) => ({ ...m }));
    const withAllowed = mods.map((m) => ({ ...m, allowed: m.allowed ?? (menuItem ? isAllowedModification(m, menuItem) : false) }));

    return {
      intent: modelResult.intent === 'unclear' && rules.intent !== 'unclear' ? rules.intent : modelResult.intent,
      items,
      mentionedFood: modelResult.mentionedFood || rules.mentionedFood,
      quantity: rules.quantity ?? modelResult.quantity,
      modifications: withAllowed,
      allergyNote: rules.allergyNote || modelResult.allergyNote,
      specialRequest: modelResult.specialRequest,
      confidence: items.length ? Math.min(modelResult.confidence, items[0].confidence) : modelResult.confidence,
      source: 'composite',
    };
  }
}
