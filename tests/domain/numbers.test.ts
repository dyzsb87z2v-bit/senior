import { describe, expect, it } from 'vitest';
import { combineNumberRun, extractCodeCandidates, extractMenuPosition, extractQuantity, parseNumberWord, speakDigits } from '../../src/domain/numbers.ts';

describe('parseNumberWord', () => {
  it('reads units, teens and tens', () => {
    expect(parseNumberWord('sieben')).toBe(7);
    expect(parseNumberWord('zwölf')).toBe(12);
    expect(parseNumberWord('vierzig')).toBe(40);
    expect(parseNumberWord('dreißig')).toBe(30);
  });
  it('reads compound words', () => {
    expect(parseNumberWord('siebenundzwanzig')).toBe(27);
    expect(parseNumberWord('vierhundertsiebenundzwanzig')).toBe(427);
    expect(parseNumberWord('hundertzwölf')).toBe(112);
    expect(parseNumberWord('einhundert')).toBe(100);
    expect(parseNumberWord('zweitausenddrei')).toBe(2003);
  });
  it('rejects non-numbers', () => {
    expect(parseNumberWord('Schnitzel')).toBeNull();
    expect(parseNumberWord('hunderttausendundeins')).toBeNull();
  });
});

describe('extractCodeCandidates (Test 1: customer code)', () => {
  const cases: [string, string][] = [
    ['Vier zwei sieben.', '427'],
    ['427', '427'],
    ['4 2 7', '427'],
    ['Nummer 427', '427'],
    ['Nummer vierhundertsiebenundzwanzig', '427'],
    ['Meine Nummer ist 427', '427'],
    ['Meine Kundennummer ist vier zwei sieben', '427'],
    ['vierhundert siebenundzwanzig', '427'],
    ['vier siebenundzwanzig', '427'],
    ['zweiundvierzig sieben', '427'],
    ['Ja, also, die 315 bitte', '315'],
    ['Zimmer 12, Kundennummer 427', '427'],
  ];
  for (const [said, code] of cases) {
    it(`"${said}" → ${code}`, () => {
      const c = extractCodeCandidates(said);
      expect(c).toHaveLength(1);
      expect(c[0].code).toBe(code);
      expect(c[0].confidence).toBeGreaterThanOrEqual(0.9);
    });
  }
  it('returns nothing when no number was said', () => {
    expect(extractCodeCandidates('Guten Tag, ich möchte bestellen')).toHaveLength(0);
  });
  it('flags two unrelated numbers as ambiguous (lower confidence, two candidates)', () => {
    const c = extractCodeCandidates('vier zwei sieben oder war es drei eins fünf');
    expect(c).toHaveLength(2);
    expect(c.every((x) => x.confidence < 0.7)).toBe(true);
  });
  it('treats a repeated code as one candidate', () => {
    const c = extractCodeCandidates('427, also vier zwei sieben');
    expect(c).toHaveLength(1);
    expect(c[0].code).toBe('427');
  });
});

describe('combineNumberRun', () => {
  it('adds round hundreds to a following group', () => {
    expect(combineNumberRun([400, 27])).toBe('427');
  });
  it('concatenates plain digits', () => {
    expect(combineNumberRun([4, 2, 7])).toBe('427');
    expect(combineNumberRun([42, 7])).toBe('427');
  });
});

describe('speakDigits', () => {
  it('reads a code digit by digit', () => {
    expect(speakDigits('427')).toBe('vier zwei sieben');
  });
});

describe('extractMenuPosition', () => {
  it('understands numbers and ordinals', () => {
    expect(extractMenuPosition('Ich nehme Nummer eins.', 3)).toBe(1);
    expect(extractMenuPosition('Ich möchte das erste Essen, aber ohne Zwiebeln.', 3)).toBe(1);
    expect(extractMenuPosition('Nein, ich meinte das zweite Essen.', 3)).toBe(2);
    expect(extractMenuPosition('Die Drei bitte', 3)).toBe(3);
    expect(extractMenuPosition('Menü 2', 3)).toBe(2);
  });
  it('does not take quantities or out-of-range numbers as positions', () => {
    expect(extractMenuPosition('zwei mal das Schnitzel', 3)).toBeNull();
    expect(extractMenuPosition('für zwei Personen', 3)).toBeNull();
    expect(extractMenuPosition('Nummer sieben', 3)).toBeNull();
  });
});

describe('extractQuantity', () => {
  it('reads portions', () => {
    expect(extractQuantity('zwei mal Schnitzel')).toBe(2);
    expect(extractQuantity('zweimal das Schnitzel')).toBe(2);
    expect(extractQuantity('drei Portionen Fisch')).toBe(3);
    expect(extractQuantity('Ich nehme Nummer zwei')).toBeNull();
  });
});
