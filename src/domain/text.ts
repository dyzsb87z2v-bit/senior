/**
 * Text normalisation and fuzzy matching for German speech transcripts.
 *
 * Speech-to-text output is lower-cased, umlauts are folded (ä → ae) so that
 * "Gemüse" and "Gemuese" (or a transcript that dropped the umlaut) compare
 * equal, and punctuation is removed. Both the utterance and the menu are put
 * through the same fold, so the comparison is symmetric.
 */

const FOLD: Record<string, string> = { 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' };

export function fold(text: string): string {
  return (text || '')
    .toLowerCase()
    .replace(/[äöüß]/g, (c) => FOLD[c])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokens(text: string): string[] {
  const f = fold(text);
  return f ? f.split(' ') : [];
}

/** Words that carry no meaning for matching. */
export const STOP_WORDS = new Set([
  'ich', 'haette', 'hatte', 'gerne', 'gern', 'bitte', 'moechte', 'mochte', 'nehme', 'nehm', 'will', 'fuer', 'mich',
  'das', 'die', 'der', 'den', 'dem', 'des', 'ein', 'eine', 'einen', 'einem', 'einer', 'mit', 'und', 'oder', 'aber',
  'heute', 'mal', 'dann', 'also', 'hm', 'aeh', 'ja', 'so', 'auch', 'noch', 'zum', 'zur', 'vom', 'von', 'am', 'im',
  'essen', 'gericht', 'menue', 'menu', 'mittagessen', 'bestellen', 'bestellung', 'haben', 'habe', 'wir', 'sie',
  'es', 'ist', 'nummer', 'nur', 'einfach', 'wieder', 'gut', 'okay', 'ok', 'danke', 'nein', 'nicht', 'hallo',
  'guten', 'tag', 'morgen', 'mir', 'uns', 'wuerde', 'wurde', 'ganz', 'lieber', 'am', 'liebsten', 'doch', 'schon',
]);

export function contentTokens(text: string): string[] {
  return tokens(text).filter((t) => !STOP_WORDS.has(t) && t.length > 1);
}

/** Sørensen–Dice similarity on character bigrams — forgiving for STT slips ("schnitsel"). */
export function dice(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) || 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let inter = 0;
  for (const [g, n] of ga) inter += Math.min(n, gb.get(g) || 0);
  return (2 * inter) / (a.length - 1 + b.length - 1);
}

/** Crude German singular/plural stem so "Kartoffel" ≈ "Kartoffeln", "Zwiebel" ≈ "Zwiebeln". */
export function stem(word: string): string {
  let w = fold(word);
  if (w.length > 5 && w.endsWith('en')) w = w.slice(0, -2);
  else if (w.length > 4 && (w.endsWith('n') || w.endsWith('e') || w.endsWith('s'))) w = w.slice(0, -1);
  return w;
}

/** Best similarity between a word and any token of a phrase. */
export function bestTokenMatch(word: string, phrase: string): number {
  const w = stem(word);
  let best = 0;
  for (const t of tokens(phrase)) {
    const s = stem(t);
    const score = s === w ? 1 : dice(s, w);
    if (score > best) best = score;
  }
  return best;
}

/** Whether `phrase` (multi-word allowed) occurs in `text` after folding, as whole words. */
export function containsPhrase(text: string, phrase: string): boolean {
  const t = ' ' + fold(text) + ' ';
  const p = ' ' + fold(phrase) + ' ';
  return p.trim().length > 0 && t.includes(p);
}

export function containsAny(text: string, phrases: string[]): string | null {
  for (const p of phrases) if (containsPhrase(text, p)) return p;
  return null;
}

export function capitalise(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** Levenshtein distance, for short words where bigram overlap under-rates a one-letter slip. */
export function levenshtein(a: string, b: string): number {
  const m = a.length; const n = b.length;
  if (!m) return n; if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** 1 − normalised edit distance on folded words: "schnitsel" vs "schnitzel" → 0.89. */
export function similar(a: string, b: string): number {
  const x = fold(a); const y = fold(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}
