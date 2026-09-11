const TZ = 'Europe/Berlin';

export function todayBerlin(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function addDays(iso, days) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) + days * 86400000).toISOString().slice(0, 10);
}

export function formatDateDe(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

export function weekdayDe(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Intl.DateTimeFormat('de-DE', { weekday: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, d)));
}

export function timeDe(isoDateTime) {
  if (!isoDateTime) return '';
  try { return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(isoDateTime)); } catch { return ''; }
}

export function dateTimeDe(isoDateTime) {
  if (!isoDateTime) return '';
  try { return new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(isoDateTime)); } catch { return ''; }
}
