/**
 * The Fable request, built without the SDK so it can be unit-tested and
 * inspected. `fableProvider.ts` sends it with `@anthropic-ai/sdk`.
 *
 * Model: Claude Fable 5.1 (`claude-fable-5-1`). Thinking is always on for
 * this model and must not be configured; depth is controlled with
 * `output_config.effort`, kept low because a caller is waiting on the line.
 * The answer is constrained to a JSON schema (`output_config.format`), and
 * the dialog engine re-validates it against the menu regardless.
 */
import type { MenuItem, OrderDraft, RawUnderstanding, UnderstandInput } from './types.ts';

export const DEFAULT_FABLE_MODEL = 'claude-fable-5-1';

/** Stable across calls, so the prompt cache can serve it. Nothing per-call goes in here. */
export const FABLE_SYSTEM_PROMPT = [
  'Du bist die Verstehens-Komponente eines telefonischen Mittagessen-Bestelldienstes für ältere Menschen in einer deutschen Senioreneinrichtung.',
  'Du bekommst den Speiseplan von heute und einen Satz, den ein Anrufer gesagt hat (Ergebnis einer Spracherkennung, oft mit Fehlern, Wiederholungen oder Füllwörtern).',
  'Deine Aufgabe: den Satz in ein strukturiertes Ergebnis übersetzen. Du sprichst nicht mit dem Anrufer; das macht ein anderes System.',
  '',
  'Regeln:',
  '- Der Speiseplan ist die einzige Quelle für Gerichte. Erfinde nie ein Gericht. Nenne nur Positionen, die im Speiseplan stehen.',
  '- Rate nie. Wenn nicht klar ist, welches Gericht gemeint ist, gib mehrere Kandidaten mit niedriger confidence an oder setze intent auf "unclear". Unsicherheit ist immer besser als eine falsche Bestellung.',
  '- "Nummer eins", "das erste Essen", "die Eins" meinen die Position 1 des Speiseplans.',
  '- Beilagen allein ("Ich möchte Reis") reichen nicht, um ein Gericht zu wählen; gib dann Kandidaten mit confidence unter 0.5 an.',
  '- Änderungen: "ohne X" → without; "X statt Y" oder "statt Y X" → replace (target = Y, replacement = X); "extra X" / "mehr X" → extra. Verwende die Schreibweise des Speiseplans, wenn das Wort dort vorkommt.',
  '- Allergien und Unverträglichkeiten ("Ich darf keine Nüsse essen") gehören wörtlich in allergy_note. Bewerte sie nicht medizinisch.',
  '- "Das gleiche wie gestern", "wie immer" → intent same_as_yesterday.',
  '- Wunsch nach einem Menschen/Mitarbeiter → intent handoff. Bitte um Vorlesen des Speiseplans → repeat_menu. Nichts bestellen wollen → cancel.',
  '- In der Stufe "confirm": ein reines Ja → yes; ein Nein ohne neue Angaben → no; ein Nein mit neuer Angabe ("nein, das zweite") → order mit dem neuen Gericht.',
  '- quantity nur setzen, wenn eine Anzahl von Portionen genannt wird ("zwei Mal"); "zwei" allein ist eine Position, keine Anzahl.',
  '- special_request nur für echte Sonderwünsche, die keine Änderung am Gericht sind (z. B. Lieferhinweis).',
  '- confidence ist deine Gesamtsicherheit (0 bis 1), dass das Ergebnis den Anrufer richtig wiedergibt.',
].join('\n');

/** JSON schema for the structured answer. `additionalProperties: false` everywhere, as the API requires. */
export const FABLE_OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['intent', 'items', 'mentioned_food', 'quantity', 'modifications', 'allergy_note', 'special_request', 'confidence'],
  properties: {
    intent: { type: 'string', enum: ['order', 'same_as_yesterday', 'yes', 'no', 'handoff', 'repeat_menu', 'cancel', 'unclear'] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['position', 'confidence'],
        properties: {
          position: { type: 'integer', description: 'Position des Gerichts im Speiseplan von heute' },
          confidence: { type: 'number', description: '0 bis 1' },
        },
      },
    },
    mentioned_food: { type: ['string', 'null'], description: 'Gewünschtes Essen, das nicht im Speiseplan steht, sonst null' },
    quantity: { type: ['integer', 'null'] },
    modifications: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'target', 'replacement'],
        properties: {
          type: { type: 'string', enum: ['without', 'replace', 'extra', 'note'] },
          target: { type: 'string' },
          replacement: { type: ['string', 'null'] },
        },
      },
    },
    allergy_note: { type: ['string', 'null'] },
    special_request: { type: ['string', 'null'] },
    confidence: { type: 'number' },
  },
} as const;

function menuLines(menu: MenuItem[]): string {
  return menu.map((m) => {
    const parts = [`${m.position}. ${m.nameDe}`];
    if (m.components?.length) parts.push(`Bestandteile: ${m.components.join(', ')}`);
    if (m.allowedModifications?.length) parts.push(`Erlaubte Änderungen: ${m.allowedModifications.join('; ')}`);
    if (m.aliases?.length) parts.push(`Auch genannt: ${m.aliases.join(', ')}`);
    if (!m.available) parts.push('HEUTE NICHT VERFÜGBAR');
    return parts.join(' | ');
  }).join('\n');
}

function draftLines(draft: OrderDraft | null): string {
  if (!draft) return 'Noch kein Gericht gewählt.';
  const mods = draft.modifications.map((m) => m.textDe).join(', ');
  return `Position ${draft.itemPosition}: ${draft.itemName}${mods ? ' (' + mods + ')' : ''}, Anzahl ${draft.quantity}`;
}

const STAGE_TEXT = {
  order: 'Der Anrufer wurde gerade gefragt, was er bestellen möchte.',
  change: 'Der Anrufer hat die vorgelesene Bestellung abgelehnt und wurde gefragt, was er ändern möchte.',
  confirm: 'Dem Anrufer wurde die Bestellung vorgelesen und er wurde gefragt, ob sie richtig ist.',
};

/** The per-call user message. */
export function buildFableUserMessage(input: UnderstandInput): string {
  return [
    'SPEISEPLAN HEUTE:',
    menuLines(input.menu),
    '',
    `SITUATION: ${STAGE_TEXT[input.stage]}`,
    `AKTUELLER ENTWURF: ${draftLines(input.draft)}`,
    `FRÜHERE BESTELLUNG VORHANDEN: ${input.hasPreviousOrder ? 'ja' : 'nein'}`,
    typeof input.sttConfidence === 'number' ? `SPRACHERKENNUNG SICHERHEIT: ${input.sttConfidence.toFixed(2)}` : '',
    '',
    'ÄUSSERUNG DES ANRUFERS:',
    input.utterance,
  ].filter((l) => l !== '').join('\n');
}

export interface FableRequestParams {
  model: string;
  max_tokens: number;
  system: { type: 'text'; text: string; cache_control: { type: 'ephemeral' } }[];
  messages: { role: 'user'; content: string }[];
  output_config: { effort: 'low' | 'medium' | 'high'; format: { type: 'json_schema'; schema: typeof FABLE_OUTPUT_SCHEMA } };
}

export function buildFableRequest(input: UnderstandInput, model = DEFAULT_FABLE_MODEL, effort: 'low' | 'medium' | 'high' = 'low'): FableRequestParams {
  return {
    model,
    max_tokens: 1024,
    system: [{ type: 'text', text: FABLE_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: buildFableUserMessage(input) }],
    output_config: { effort, format: { type: 'json_schema', schema: FABLE_OUTPUT_SCHEMA } },
  };
}

/** Maps the model's JSON (snake_case, positions) onto the provider-neutral shape; the menu check happens in `validateUnderstanding`. */
export function mapFableOutput(json: unknown): RawUnderstanding {
  const o = (json && typeof json === 'object' ? json : {}) as Record<string, unknown>;
  const items = Array.isArray(o.items) ? o.items.map((it) => {
    const x = (it && typeof it === 'object' ? it : {}) as Record<string, unknown>;
    return { position: typeof x.position === 'number' ? x.position : undefined, confidence: typeof x.confidence === 'number' ? x.confidence : 0 };
  }) : [];
  const modifications = Array.isArray(o.modifications) ? o.modifications.map((m) => {
    const x = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>;
    return { type: typeof x.type === 'string' ? x.type : 'note', target: typeof x.target === 'string' ? x.target : '', replacement: typeof x.replacement === 'string' ? x.replacement : undefined };
  }) : [];
  return {
    intent: typeof o.intent === 'string' ? o.intent : 'unclear',
    items,
    mentionedFood: typeof o.mentioned_food === 'string' ? o.mentioned_food : null,
    quantity: typeof o.quantity === 'number' ? o.quantity : null,
    modifications,
    allergyNote: typeof o.allergy_note === 'string' ? o.allergy_note : null,
    specialRequest: typeof o.special_request === 'string' ? o.special_request : null,
    confidence: typeof o.confidence === 'number' ? o.confidence : 0,
  };
}
