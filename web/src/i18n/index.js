import de from './de';

/**
 * The lunch service speaks German. Additional languages register here; the
 * active one is chosen by the `lunch_lang` entry in localStorage, defaulting
 * to German, so a second dictionary can be added without touching screens.
 */
const DICTIONARIES = { de };
export const DEFAULT_LUNCH_LANG = 'de';

function current() {
  try { return localStorage.getItem('lunch_lang') || DEFAULT_LUNCH_LANG; } catch { return DEFAULT_LUNCH_LANG; }
}

function resolve(dict, key) {
  return key.split('.').reduce((acc, k) => (acc && acc[k] !== undefined ? acc[k] : undefined), dict);
}

/** t('nav.today') → 'HEUTE'. Missing keys return the key itself so a gap is visible, never silent. */
export function t(key) {
  const lang = current();
  const v = resolve(DICTIONARIES[lang] || de, key) ?? resolve(de, key);
  return v === undefined ? key : v;
}
