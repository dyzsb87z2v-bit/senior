/**
 * Everything the assistant says, in one place.
 *
 * Short sentences, no jargon, spoken slowly by the TTS layer. Every prompt
 * ends with a question or an instruction so the caller always knows what to
 * do next. Menu positions are read as words, customer codes digit by digit.
 */
import { speakDigits } from './numbers.ts';
import type { MenuItem, Modification, OrderDraft } from './types.ts';

const POSITION_WORDS = ['', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun'];
export const positionWord = (n: number) => POSITION_WORDS[n] || String(n);

export const P = {
  greeting: (restaurant: string) =>
    `Guten Tag. Willkommen beim ${restaurant}. Bitte nennen Sie jetzt Ihre persönliche Kundennummer.`,
  askCodeAgain: () =>
    'Entschuldigung. Können Sie Ihre Kundennummer bitte noch einmal langsam nennen?',
  askCodeDigits: () =>
    'Sie können die Nummer auch über die Tasten Ihres Telefons eingeben.',
  codeUnknown: () =>
    'Diese Kundennummer kenne ich leider nicht. Bitte nennen Sie Ihre Kundennummer noch einmal, Ziffer für Ziffer.',
  codeInactive: () =>
    'Diese Kundennummer ist zurzeit nicht aktiv. Ich verbinde Sie mit dem Restaurant.',
  codeRecognised: (code: string) =>
    `Danke. Ich habe Sie als Kundennummer ${speakDigits(code)} erkannt.`,
  confirmCode: (code: string) =>
    `Ich habe die Kundennummer ${speakDigits(code)} verstanden. Ist das richtig? Bitte sagen Sie Ja oder Nein.`,
  askOrder: () => 'Was möchten Sie heute zum Mittagessen bestellen?',
  askOrderShort: () => 'Was möchten Sie bestellen?',
  menuToday: (items: MenuItem[]) => {
    const avail = items.filter((i) => i.available);
    if (!avail.length) return 'Für heute ist leider kein Gericht verfügbar.';
    const list = avail.map((i) => `Nummer ${positionWord(i.position)}: ${i.nameDe}`).join('. ');
    return `Heute haben wir: ${list}.`;
  },
  choices: (items: MenuItem[]) => {
    const names = items.filter((i) => i.available).map((i) => i.nameDe);
    if (names.length <= 1) return names.join('');
    return `${names.slice(0, -1).join(', ')} oder ${names[names.length - 1]}`;
  },
  askOrderAgain: () =>
    'Entschuldigung, ich habe Sie nicht ganz verstanden. Können Sie das bitte noch einmal sagen?',
  ambiguousDish: (items: MenuItem[]) =>
    `Entschuldigung, ich habe das Gericht nicht ganz verstanden. Möchten Sie ${P.choices(items)}?`,
  notOnMenu: (food: string, items: MenuItem[]) =>
    `${food} haben wir heute leider nicht. Heute können Sie zwischen ${P.choices(items)} wählen. Was möchten Sie?`,
  unavailable: (name: string, items: MenuItem[]) =>
    `${name} ist heute leider nicht verfügbar. Heute können Sie zwischen ${P.choices(items)} wählen. Was möchten Sie?`,
  yesterdayUnavailable: (items: MenuItem[]) =>
    `Das Essen von gestern ist heute leider nicht verfügbar. ${P.menuToday(items)} Was möchten Sie?`,
  noPreviousOrder: (items: MenuItem[]) =>
    `Ich habe leider keine frühere Bestellung von Ihnen gefunden. ${P.menuToday(items)} Was möchten Sie?`,
  quantityTooHigh: () =>
    'So viele Portionen kann ich am Telefon leider nicht aufnehmen. Bitte nennen Sie eine Anzahl bis fünf, oder ich verbinde Sie mit dem Restaurant.',
  confirmOrder: (draft: OrderDraft, code: string) => {
    const parts: string[] = [];
    parts.push(`Ich wiederhole Ihre Bestellung für Kundennummer ${speakDigits(code)}:`);
    const qty = draft.quantity > 1 ? `${positionWord(draft.quantity)} Mal ` : '';
    parts.push(`${qty}${draft.itemName}${draft.modifications.length ? ', ' + draft.modifications.map((m) => m.textDe).join(', ') : ''}.`);
    if (draft.allergyNote) parts.push('Ihren Hinweis zu Unverträglichkeiten habe ich notiert. Das Restaurant prüft ihn persönlich.');
    if (draft.specialRequest) parts.push(`Sonderwunsch: ${draft.specialRequest}.`);
    parts.push('Ist das richtig? Bitte sagen Sie Ja oder Nein.');
    return parts.join(' ');
  },
  confirmAgain: () => 'Ist die Bestellung so richtig? Bitte sagen Sie Ja oder Nein.',
  askChange: () => 'Kein Problem. Was möchten Sie ändern?',
  changeNotUnderstood: (items: MenuItem[]) =>
    `Entschuldigung, das habe ich nicht verstanden. Sie können ein anderes Gericht nennen, zum Beispiel ${P.choices(items)}, oder eine Änderung, zum Beispiel ohne Zwiebeln.`,
  saved: () => 'Danke. Ihre Bestellung wurde erfolgreich aufgenommen. Guten Appetit und auf Wiederhören.',
  savedWithReview: () => 'Danke. Ihre Bestellung wurde aufgenommen. Das Restaurant prüft Ihren Hinweis und meldet sich bei Bedarf. Auf Wiederhören.',
  afterDeadlineNote: (deadline: string) =>
    `Ein Hinweis: Der Bestellschluss für heute war um ${deadline.replace(':', ' Uhr ')}. Das Restaurant prüft, ob Ihre Bestellung heute noch möglich ist.`,
  afterDeadlineRefuse: (deadline: string) =>
    `Der Bestellschluss für heute war leider um ${deadline.replace(':', ' Uhr ')}. Ich verbinde Sie mit dem Restaurant.`,
  waiting: (hint: string) => `Ich warte gerne. ${hint}`,
  waitingHintCode: () => 'Sagen Sie einfach Ihre Kundennummer, wenn Sie bereit sind.',
  waitingHintOrder: () => 'Sagen Sie einfach Ihre Bestellung, wenn Sie bereit sind.',
  waitingHintConfirm: () => 'Sagen Sie einfach Ja oder Nein, wenn Sie bereit sind.',
  handoff: () => 'Kein Problem. Ich verbinde Sie jetzt mit dem Restaurant.',
  handoffUnavailable: () =>
    'Leider ist im Restaurant gerade niemand erreichbar. Ich habe Ihren Anruf notiert. Das Restaurant meldet sich bei Ihnen. Auf Wiederhören.',
  noMenuToday: () => 'Für heute liegt leider noch kein Speiseplan vor.',
  goodbye: () => 'Vielen Dank für Ihren Anruf. Auf Wiederhören.',
  goodbyeNoOrder: () => 'In Ordnung, dann nehme ich keine Bestellung auf. Auf Wiederhören.',
  systemError: () => 'Entschuldigung, es gibt gerade ein technisches Problem. Ich verbinde Sie mit dem Restaurant.',
  yesOrNo: () => 'Bitte sagen Sie Ja oder Nein.',
  modificationNote: (m: Modification) => (m.allowed ? '' : `Die Änderung „${m.textDe}“ prüft die Küche.`),
};
