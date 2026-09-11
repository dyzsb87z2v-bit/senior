/** Calendar helpers. The restaurant is in Germany, so "today" is Berlin time. */

export const TIME_ZONE = 'Europe/Berlin';

/** YYYY-MM-DD for the given instant in Berlin time. */
export function todayInBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** HH:MM in Berlin time. */
export function timeInBerlin(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('de-DE', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false }).format(now);
}

export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

export function isValidIsoDate(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

/** "2026-09-11" → "11.09.2026" */
export function formatDateDe(isoDate: string): string {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

/** Whether HH:MM `now` is past the HH:MM `deadline`. */
export function isPastDeadline(nowHHMM: string, deadline: string | null | undefined): boolean {
  if (!deadline || !/^\d{1,2}:\d{2}$/.test(deadline)) return false;
  const [h1, m1] = nowHHMM.split(':').map(Number);
  const [h2, m2] = deadline.split(':').map(Number);
  return h1 * 60 + m1 > h2 * 60 + m2;
}
