/**
 * Matching an utterance against today's menu — deterministically.
 *
 * Today's menu is the only source of truth. Nothing here ever produces a dish
 * that is not on it. When two dishes are equally plausible the result says so
 * (`ambiguous`) and the dialog asks; it never picks one.
 */
import { bestTokenMatch, containsPhrase, contentTokens, fold, similar, stem, tokens, capitalise } from './text.ts';
import { extractMenuPosition } from './numbers.ts';
import type { MenuItem, Modification } from './types.ts';

const CONNECTORS = new Set(['mit', 'und', 'oder', 'an', 'auf', 'in', 'dazu', 'sowie']);
const CATEGORY_WORDS: Record<string, string[]> = {
  vegetarian: ['vegetarisch', 'vegetarische', 'vegetarisches', 'vegetarischen', 'vegi', 'veggie', 'ohne fleisch', 'fleischlos'],
  soup: ['suppe'],
  dessert: ['nachtisch', 'dessert', 'nachspeise'],
};

/** Words of a dish name that identify it (before "mit"), and the sides (after "mit" plus `components`). */
export function itemKeywords(item: MenuItem): { head: string[]; sides: string[] } {
  const words = tokens(item.nameDe);
  const cut = words.indexOf('mit');
  const headWords = (cut >= 0 ? words.slice(0, cut) : words).filter((w) => !CONNECTORS.has(w) && w.length > 2);
  const sideWords = (cut >= 0 ? words.slice(cut + 1) : []).filter((w) => !CONNECTORS.has(w) && w.length > 2);
  const comps = (item.components || []).flatMap((c) => tokens(c)).filter((w) => !CONNECTORS.has(w));
  const aliases = (item.aliases || []).flatMap((a) => tokens(a)).filter((w) => !CONNECTORS.has(w));
  return {
    head: [...new Set([...headWords, ...aliases])],
    sides: [...new Set([...sideWords, ...comps])],
  };
}

export interface ItemScore {
  item: MenuItem;
  score: number;
  reason: string;
}

/** Scores every dish of the menu for the utterance. */
export function scoreItems(utterance: string, menu: MenuItem[]): ItemScore[] {
  const words = contentTokens(utterance);
  const folded = fold(utterance);
  const maxPos = Math.max(0, ...menu.map((i) => i.position));
  const position = extractMenuPosition(utterance, maxPos);

  return menu.map((item) => {
    let score = 0;
    let reason = '';
    if (position !== null && item.position === position) { score = 0.96; reason = 'position'; }

    // Whole name spoken ("das Schnitzel mit Kartoffeln und Gemüse").
    if (containsPhrase(utterance, item.nameDe)) { score = Math.max(score, 0.97); reason = reason || 'full-name'; }

    const { head, sides } = itemKeywords(item);
    // Head word(s): "Schnitzel", "Fisch", "Pasta" — exact or a close STT slip.
    for (const h of head) {
      for (const w of words) {
        const s = stem(w) === stem(h) ? 1 : Math.max(bestTokenMatch(w, h), similar(w, h));
        if (s >= 0.999) { score = Math.max(score, 0.92); reason = reason || 'head'; }
        else if (s >= 0.72) { score = Math.max(score, 0.78); reason = reason || 'head-fuzzy'; }
      }
    }
    // Aliases as phrases ("vegetarisches Essen").
    for (const a of item.aliases || []) {
      if (containsPhrase(utterance, a)) { score = Math.max(score, 0.92); reason = reason || 'alias'; }
    }
    // Category words: "das vegetarische Essen" → the one vegetarian dish.
    if (item.category && CATEGORY_WORDS[item.category]) {
      const sameCategory = menu.filter((m) => m.category === item.category).length;
      for (const cw of CATEGORY_WORDS[item.category]) {
        if (containsPhrase(utterance, cw) || folded.includes(cw)) {
          score = Math.max(score, sameCategory === 1 ? 0.9 : 0.55);
          reason = reason || 'category';
        }
      }
    }
    // Sides only ("Ich möchte Reis") are weak evidence: another dish may take rice as a swap.
    let sideHits = 0;
    for (const sd of sides) for (const w of words) if (bestTokenMatch(w, sd) >= 0.85) sideHits++;
    if (sideHits && score < 0.6) { score = Math.max(score, 0.45 + 0.1 * Math.min(sideHits, 2)); reason = reason || 'sides'; }

    return { item, score, reason };
  }).sort((a, b) => b.score - a.score);
}

export interface MatchResult {
  best: ItemScore | null;
  /** Second candidate, when it is close enough that a person should decide. */
  ambiguousWith: ItemScore | null;
  ambiguous: boolean;
}

export function matchItem(utterance: string, menu: MenuItem[]): MatchResult {
  const scores = scoreItems(utterance, menu);
  const best = scores[0] && scores[0].score > 0 ? scores[0] : null;
  const second = scores[1] && scores[1].score > 0 ? scores[1] : null;
  const ambiguous = !!(best && second && second.score >= 0.45 && best.score - second.score < 0.15);
  return { best, ambiguousWith: ambiguous ? second : null, ambiguous };
}

/** Words that stop the object of "ohne …" / "statt …". */
const STOPPERS = new Set(['und', 'aber', 'bitte', 'dann', 'dazu', 'sowie', 'mit', 'oder', 'ist', 'das', 'ich', 'nur', 'auch', 'danke', 'gerne']);

function objectAfter(words: string[], start: number, max = 2): string[] {
  const out: string[] = [];
  for (let i = start; i < words.length && out.length < max; i++) {
    const w = words[i];
    if (STOPPERS.has(w)) break;
    if (['ohne', 'statt', 'anstatt', 'anstelle', 'extra', 'zusaetzlich', 'mehr'].includes(w)) break;
    if (['die', 'den', 'der', 'das', 'dem'].includes(w) && out.length === 0) continue;
    out.push(w);
    // A single noun is the normal case; take a second word only for "grüne Bohnen"-style pairs
    if (out.length === 1 && (w.length > 5 || i === words.length - 1)) break;
  }
  return out;
}

/** Restores the spoken word from the folded one using the menu's own spelling where possible. */
function displayWord(folded: string, item: MenuItem | null): string {
  const pool = [...(item?.components || []), ...(item?.ingredients || []), ...(item?.allowedModifications || []).flatMap((m) => m.split(/\s+/))];
  for (const p of pool) if (fold(p) === folded || stem(p) === stem(folded)) return p.replace(/^(ohne|statt|mit)\s+/i, '');
  return capitalise(folded.replace('ae', 'ä').replace('oe', 'ö').replace('ue', 'ü'));
}

/** "ohne Zwiebeln", "Reis statt Kartoffeln", "statt Kartoffeln Reis", "extra Soße" → structured. */
export function extractModifications(utterance: string, item: MenuItem | null): Modification[] {
  const words = tokens(utterance);
  const mods: Modification[] = [];
  const push = (m: Modification) => { if (!mods.some((x) => x.type === m.type && x.target === m.target)) mods.push(m); };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'ohne') {
      const obj = objectAfter(words, i + 1);
      if (obj.length) {
        const target = displayWord(obj.join(' '), item);
        push({ type: 'without', target, textDe: `ohne ${target}` });
      }
    } else if (w === 'statt' || w === 'anstatt' || (w === 'anstelle' && words[i + 1] === 'von')) {
      const start = w === 'anstelle' ? i + 2 : i + 1;
      const after = objectAfter(words, start);
      if (!after.length) continue;
      // "Reis statt Kartoffeln": replacement before, target after. "statt Kartoffeln Reis": target after, replacement follows.
      const before = i > 0 && !STOPPERS.has(words[i - 1]) && !['mit', 'lieber'].includes(words[i - 1]) ? words[i - 1] : null;
      const beforeIsFood = before && before.length > 2 && !['und', 'bitte', 'aber', 'das', 'ich'].includes(before);
      if (beforeIsFood) {
        const target = displayWord(after.join(' '), item);
        const replacement = displayWord(before as string, item);
        push({ type: 'replace', target, replacement, textDe: `${replacement} statt ${target}` });
      } else {
        let k = start + after.length;
        while (k < words.length && ['bitte', 'lieber', 'dann', 'gerne', 'gern'].includes(words[k])) k++;
        const rest = objectAfter(words, k);
        if (rest.length) {
          const target = displayWord(after.join(' '), item);
          const replacement = displayWord(rest.join(' '), item);
          push({ type: 'replace', target, replacement, textDe: `${replacement} statt ${target}` });
        }
      }
    } else if (['extra', 'zusaetzlich', 'mehr'].includes(w)) {
      const obj = objectAfter(words, i + 1);
      if (obj.length) {
        const target = displayWord(obj.join(' '), item);
        push({ type: 'extra', target, textDe: `extra ${target}` });
      }
    }
  }

  // "Schnitzel mit Reis" when rice is not part of the dish but is a listed swap → a replace.
  if (item && !mods.some((m) => m.type === 'replace')) {
    const sidesOfItem = new Set((item.components || []).map((c) => stem(c)));
    for (const allowed of parseAllowedModifications(item)) {
      if (allowed.type !== 'replace' || !allowed.replacement) continue;
      const saidReplacement = words.some((w) => stem(w) === stem(allowed.replacement as string));
      const saidTarget = words.some((w) => stem(w) === stem(allowed.target));
      if (saidReplacement && !saidTarget && !sidesOfItem.has(stem(allowed.replacement)) && (containsPhrase(utterance, 'mit ' + allowed.replacement) || containsPhrase(utterance, 'lieber ' + allowed.replacement))) {
        push({ ...allowed });
      }
    }
  }

  return mods.map((m) => ({ ...m, allowed: isAllowedModification(m, item) }));
}

/** The kitchen's "erlaubte Änderungen" list, parsed with the same rules the caller's words get. */
export function parseAllowedModifications(item: MenuItem | null): Modification[] {
  if (!item) return [];
  const out: Modification[] = [];
  for (const raw of item.allowedModifications || []) {
    const parsed = extractModificationsRaw(raw);
    if (parsed.length) out.push(...parsed);
    else out.push({ type: 'note', target: raw, textDe: raw });
  }
  return out;
}

function extractModificationsRaw(text: string): Modification[] {
  const words = tokens(text);
  const mods: Modification[] = [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w === 'ohne' && words[i + 1]) mods.push({ type: 'without', target: capitalise(words.slice(i + 1).join(' ')), textDe: text });
    else if (w === 'statt' && i > 0 && words[i + 1]) mods.push({ type: 'replace', target: capitalise(words.slice(i + 1).join(' ')), replacement: capitalise(words.slice(0, i).join(' ')), textDe: text });
    else if (['extra', 'zusaetzlich'].includes(w) && words[i + 1]) mods.push({ type: 'extra', target: capitalise(words.slice(i + 1).join(' ')), textDe: text });
  }
  return mods;
}

export function isAllowedModification(m: Modification, item: MenuItem | null): boolean {
  if (!item) return false;
  for (const a of parseAllowedModifications(item)) {
    if (a.type !== m.type) continue;
    if (stem(a.target) !== stem(m.target)) continue;
    if (m.type === 'replace' && stem(a.replacement || '') !== stem(m.replacement || '')) continue;
    return true;
  }
  return false;
}

const ALLERGY_MARKERS = ['allergie', 'allergisch', 'unvertraeglich', 'unvertraeglichkeit', 'vertrage', 'vertrag', 'laktose', 'gluten', 'zoeliakie', 'nuesse', 'nussallergie', 'darf kein', 'darf keine', 'darf nicht', 'kann kein', 'kann keine'];

/** "Ich darf keine Nüsse essen." → the sentence, so the kitchen sees it verbatim. Never interpreted medically. */
export function extractAllergyNote(utterance: string): string | null {
  const f = fold(utterance);
  if (!ALLERGY_MARKERS.some((m) => f.includes(m))) return null;
  const sentences = utterance.split(/[.!?;]+/).map((s) => s.trim()).filter(Boolean);
  const hit = sentences.find((s) => ALLERGY_MARKERS.some((m) => fold(s).includes(m)));
  return hit || utterance.trim();
}

const FOOD_HINTS = ['pizza', 'doener', 'burger', 'pommes', 'currywurst', 'bratwurst', 'gulasch', 'lasagne', 'spaghetti', 'nudeln', 'suppe', 'salat', 'braten', 'huhn', 'haehnchen', 'kuchen', 'eis', 'steak', 'wurst', 'eintopf', 'kloesse', 'knoedel', 'rouladen', 'fisch', 'schnitzel', 'pasta', 'reis', 'kartoffeln', 'gemuese'];

/** What the caller asked for when it is not on the menu ("Pizza"), or null. */
export function mentionedFood(utterance: string, menu: MenuItem[]): string | null {
  const words = contentTokens(utterance);
  const menuWords = new Set(menu.flatMap((i) => [...itemKeywords(i).head, ...itemKeywords(i).sides]).map(stem));
  for (const w of words) {
    if (menuWords.has(stem(w))) continue;
    if (FOOD_HINTS.includes(w) || FOOD_HINTS.includes(stem(w))) return capitalise(w.replace('ae', 'ä').replace('oe', 'ö').replace('ue', 'ü'));
  }
  return null;
}
