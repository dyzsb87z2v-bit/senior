/**
 * German spoken numbers → digits.
 *
 * Twilio's German recogniser returns "427", "4 2 7", "vier zwei sieben",
 * "vierhundertsiebenundzwanzig" or "Nummer vierhundert siebenundzwanzig"
 * depending on how the caller spoke. All of them must normalise to "427";
 * anything ambiguous must come back as several candidates so the dialog can
 * ask again instead of guessing.
 */
import { fold } from './text.ts';

const UNITS: Record<string, number> = {
  null: 0, nul: 0, zero: 0,
  eins: 1, ein: 1, eine: 1, einen: 1, einer: 1, einem: 1,
  zwei: 2, zwo: 2, drei: 3, vier: 4, fuenf: 5, funf: 5, sechs: 6, sieben: 7, acht: 8, neun: 9,
  zehn: 10, elf: 11, zwoelf: 12, zwolf: 12, dreizehn: 13, vierzehn: 14, fuenfzehn: 15, funfzehn: 15,
  sechzehn: 16, siebzehn: 17, achtzehn: 18, neunzehn: 19,
};
const TENS: Record<string, number> = {
  zwanzig: 20, dreissig: 30, dreisig: 30, vierzig: 40, fuenfzig: 50, funfzig: 50,
  sechzig: 60, siebzig: 70, achtzig: 80, neunzig: 90,
};

/** Parses one compound number word ("siebenundzwanzig", "vierhundertzwoelf"). Returns null if it is not a number. */
export function parseNumberWord(raw: string): number | null {
  const w = fold(raw).replace(/\s/g, '');
  if (!w) return null;
  if (/^\d+$/.test(w)) return Number(w);
  if (w in UNITS) return UNITS[w];
  if (w in TENS) return TENS[w];

  // hundreds: "vierhundert", "hundert", "vierhundertsiebenundzwanzig"
  const h = w.match(/^(.*?)hundert(.*)$/);
  if (h) {
    const [, pre, post] = h;
    const hundreds = pre === '' || pre === 'ein' ? 1 : (pre in UNITS && UNITS[pre] >= 1 && UNITS[pre] <= 9 ? UNITS[pre] : null);
    if (hundreds === null) return null;
    if (post === '') return hundreds * 100;
    const rest = parseNumberWord(post);
    if (rest === null || rest >= 100) return null;
    return hundreds * 100 + rest;
  }
  // "tausend" is not a customer code, but do not misread it as noise
  const t = w.match(/^(.*?)tausend(.*)$/);
  if (t) {
    const [, pre, post] = t;
    const th = pre === '' || pre === 'ein' ? 1 : parseNumberWord(pre);
    if (th === null || th >= 1000) return null;
    if (post === '') return th * 1000;
    const rest = parseNumberWord(post);
    if (rest === null || rest >= 1000) return null;
    return th * 1000 + rest;
  }
  // "siebenundzwanzig" = 7 + 20
  const u = w.match(/^(.+?)und(.+)$/);
  if (u) {
    const [, unit, ten] = u;
    if (unit in UNITS && UNITS[unit] < 10 && ten in TENS) return UNITS[unit] + TENS[ten];
  }
  return null;
}

/** Hundreds-only values ("vierhundert"), which combine with a following two-digit group. */
function isRoundHundreds(n: number): boolean {
  return n >= 100 && n % 100 === 0;
}

/** Combines a run of adjacent number tokens into the digit string the caller meant. */
export function combineNumberRun(values: number[]): string | null {
  if (!values.length) return null;
  let out = '';
  let i = 0;
  while (i < values.length) {
    const v = values[i];
    const next = values[i + 1];
    // "vierhundert" + "siebenundzwanzig" → 427 (sum), "vier" + "hundert" is handled by the word parser
    if (isRoundHundreds(v) && next !== undefined && next < 100 && !(i + 2 < values.length && values.slice(i + 1).every((x) => x < 10))) {
      out += String(v + next);
      i += 2;
      continue;
    }
    out += String(v);
    i += 1;
  }
  return out;
}

export interface CodeCandidate {
  code: string;
  confidence: number;
  /** Whether the run followed a keyword such as "Nummer". */
  keyed: boolean;
}

const KEYWORDS = ['kundennummer', 'nummer', 'kundencode', 'code', 'kennnummer'];

/**
 * Finds customer-code candidates in an utterance.
 *
 * Adjacent numeric tokens form one run; a run preceded by "Nummer" wins over
 * others; several unrelated runs are all returned so the caller can decide
 * that the utterance was ambiguous.
 */
export function extractCodeCandidates(utterance: string): CodeCandidate[] {
  const words = fold(utterance).split(' ').filter(Boolean);
  const runs: { values: number[]; keyed: boolean; allDigits: boolean }[] = [];
  let current: { values: number[]; keyed: boolean; allDigits: boolean } | null = null;
  let lastWasKeyword = false;

  for (const raw of words) {
    // "4 2 7" may also arrive as "427" or "4,2,7" — fold removed the commas.
    const n = parseNumberWord(raw);
    if (n !== null) {
      if (!current) current = { values: [], keyed: lastWasKeyword, allDigits: true };
      current.values.push(n);
      if (!/^\d+$/.test(raw)) current.allDigits = false;
      lastWasKeyword = false;
      continue;
    }
    if (current) { runs.push(current); current = null; }
    lastWasKeyword = KEYWORDS.includes(raw) || (lastWasKeyword && ['ist', 'lautet', 'die', 'meine'].includes(raw));
    if (KEYWORDS.includes(raw)) lastWasKeyword = true;
  }
  if (current) runs.push(current);

  const candidates: CodeCandidate[] = [];
  for (const run of runs) {
    const code = combineNumberRun(run.values);
    if (!code || code.length > 6) continue;
    let confidence = run.allDigits ? 0.95 : 0.9;
    if (run.keyed) confidence = Math.min(1, confidence + 0.05);
    candidates.push({ code, confidence, keyed: run.keyed });
  }

  // A keyed run makes the others noise ("Zimmer 12, Kundennummer 427").
  const keyed = candidates.filter((c) => c.keyed);
  if (keyed.length === 1) return keyed;
  // Identical digit strings said twice ("427, also vier zwei sieben") are one candidate.
  const seen = new Map<string, CodeCandidate>();
  for (const c of candidates) {
    const prev = seen.get(c.code);
    if (!prev || prev.confidence < c.confidence) seen.set(c.code, c);
  }
  const unique = [...seen.values()];
  if (unique.length > 1) return unique.map((c) => ({ ...c, confidence: c.confidence * 0.6 }));
  return unique;
}

const DIGIT_WORDS = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];

/** "427" → "vier zwei sieben", the way a code is read back to a caller. */
export function speakDigits(code: string): string {
  return String(code).split('').map((d) => DIGIT_WORDS[Number(d)] ?? d).join(' ');
}

const ORDINALS: Record<string, number> = {
  erste: 1, ersten: 1, erstes: 1, zweite: 2, zweiten: 2, zweites: 2, dritte: 3, dritten: 3, drittes: 3,
  vierte: 4, vierten: 4, viertes: 4, fuenfte: 5, fuenften: 5, fuenftes: 5, sechste: 6, sechsten: 6, sechstes: 6,
};

/**
 * A menu position spoken as a number or ordinal: "Nummer eins", "das zweite
 * Essen", "die Drei", "Menü 2". Returns null when nothing of the kind is said.
 */
export function extractMenuPosition(utterance: string, maxPosition: number): number | null {
  const words = fold(utterance).split(' ').filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    if (w in ORDINALS && ORDINALS[w] <= maxPosition) return ORDINALS[w];
  }
  // "Nummer zwei", "Menü 2", "Gericht drei", "die Zwei"
  const KEY = new Set(['nummer', 'menue', 'menu', 'gericht', 'essen', 'die', 'das', 'nehme', 'nehm', 'bitte', 'moechte', 'gerne', 'mal']);
  for (let i = 0; i < words.length; i++) {
    const n = parseNumberWord(words[i]);
    if (n === null || n < 1 || n > maxPosition) continue;
    const prev = words[i - 1];
    const next = words[i + 1];
    // "zwei mal", "zwei portionen", "für zwei personen" are quantities, not positions
    if (next && ['mal', 'portionen', 'portion', 'personen', 'stueck', 'x'].includes(next)) continue;
    if (prev && ['fuer', 'x'].includes(prev)) continue;
    if (!prev || KEY.has(prev) || i === words.length - 1) return n;
  }
  return null;
}

/** "zwei mal", "zweimal", "2x", "zwei Portionen", "für zwei Personen" → 2. */
export function extractQuantity(utterance: string): number | null {
  const f = fold(utterance);
  const m = f.match(/\b(\w+?)(?:\s?mal|\s?x|\s+portionen|\s+portion|\s+stueck)\b/) || f.match(/\bfuer\s+(\w+)\s+personen\b/);
  if (m) {
    const n = parseNumberWord(m[1]);
    if (n !== null && n >= 1) return n;
    if (['einmal', 'ein'].includes(m[1])) return 1;
  }
  if (/\bzweimal\b/.test(f)) return 2;
  if (/\bdreimal\b/.test(f)) return 3;
  return null;
}
