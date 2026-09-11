/**
 * The dialog engine: one telephone call as a state machine.
 *
 *   ASK_CODE → (CONFIRM_CODE) → ASK_ORDER → CONFIRM_ORDER → DONE
 *                                   ↑            │ "nein"
 *                                   └─ ASK_CHANGE ┘
 *
 * `runTurn` is pure apart from the lookups it is handed in `DialogContext`:
 * it takes the persisted state and what the caller just said, and returns the
 * new state, the sentences to speak, what to do next (listen, hang up, dial)
 * and the side effects the caller of the engine must perform (save an order,
 * raise an alert). The telephony layer and the database live outside.
 *
 * Two rules run through everything: never guess (ask instead), and never trap
 * the caller (hand off after repeated trouble).
 */
import { extractCodeCandidates } from './numbers.ts';
import { isNo, isPureYes, wantsHandoff } from './understanding.ts';
import { isAllowedModification } from './menuMatch.ts';
import { P } from './prompts.ts';
import { isPastDeadline, timeInBerlin } from './dates.ts';
import type {
  CallState, Customer, DialogContext, Effect, MenuItem, Modification, OrderDraft, PreviousOrder,
  TurnInput, TurnResult, Understanding,
} from './types.ts';

export const MAX_QUANTITY = 5;

export function initialState(today: string, callerNumber: string | null = null): CallState {
  return {
    stage: 'ASK_CODE',
    turns: 0,
    failures: 0,
    silences: 0,
    unknownCodeAttempts: 0,
    customer: null,
    pendingCode: null,
    callerNumber,
    callerMatchedCustomerId: null,
    draft: null,
    orderDate: today,
    afterDeadline: false,
    transcript: [],
    customerConfidence: 0,
    orderConfidence: 0,
    menuMatchConfidence: 0,
  };
}

function now(input: TurnInput): string {
  return (input.now || new Date()).toISOString();
}

function say(state: CallState, texts: string[], input: TurnInput) {
  for (const t of texts) if (t) state.transcript.push({ role: 'assistant', text: t, at: now(input) });
}

function heard(state: CallState, input: TurnInput) {
  const text = input.utterance || (input.digits ? `[Tasten: ${input.digits}]` : '');
  if (text) state.transcript.push({ role: 'customer', text, confidence: input.sttConfidence, at: now(input) });
}

function result(state: CallState, texts: string[], action: TurnResult['action'], gatherMode: TurnResult['gatherMode'], effects: Effect[], input: TurnInput): TurnResult {
  say(state, texts, input);
  return { state, say: texts.filter(Boolean), action, gatherMode, effects };
}

function handoff(state: CallState, reason: string, input: TurnInput, ctx: DialogContext, extra: Effect[] = [], preface: string[] = []): TurnResult {
  state.stage = 'HANDOFF';
  const effects: Effect[] = [
    ...extra,
    { type: 'alert', alertType: 'human_handoff', severity: 'critical', message: reason, customerCode: state.customer?.customerCode || state.pendingCode || undefined, customerId: state.customer?.id },
    { type: 'handoff', reason },
    { type: 'call_completed', outcome: 'handoff' },
  ];
  if (ctx.settings.handoffAvailable) return result(state, [...preface, P.handoff()], 'dial', 'speech', effects, input);
  return result(state, [...preface, P.handoffUnavailable()], 'hangup', 'speech', effects, input);
}

function availableMenu(ctx: DialogContext): MenuItem[] {
  return ctx.menu.filter((m) => m.available);
}

function draftFromItem(item: MenuItem, u: Partial<Understanding>, prev: OrderDraft | null): OrderDraft {
  const mods = (u.modifications || []).map((m) => ({ ...m, allowed: m.allowed ?? isAllowedModification(m, item) }));
  const draft: OrderDraft = {
    menuItemId: item.id,
    itemPosition: item.position,
    itemName: item.nameDe,
    components: item.components || [],
    quantity: u.quantity ?? prev?.quantity ?? 1,
    modifications: mods,
    specialRequest: u.specialRequest ?? prev?.specialRequest ?? null,
    allergyNote: u.allergyNote ?? prev?.allergyNote ?? null,
    needsReview: false,
    reviewReason: null,
    menuMatchConfidence: u.items?.[0]?.confidence ?? 1,
  };
  return withReviewFlags(draft);
}

/** A draft that needs a person: an unlisted modification, an allergy, an order after the deadline. */
function withReviewFlags(draft: OrderDraft, afterDeadline = false): OrderDraft {
  const reasons: string[] = [];
  const unlisted = draft.modifications.filter((m) => !m.allowed);
  if (unlisted.length) reasons.push('Änderung nicht in der Liste der erlaubten Änderungen: ' + unlisted.map((m) => m.textDe).join(', '));
  if (draft.allergyNote) reasons.push('Allergie-/Unverträglichkeitshinweis: ' + draft.allergyNote);
  if (draft.specialRequest) reasons.push('Sonderwunsch: ' + draft.specialRequest);
  if (afterDeadline) reasons.push('Bestellung nach Bestellschluss');
  return { ...draft, needsReview: reasons.length > 0, reviewReason: reasons.length ? reasons.join(' | ') : null };
}

function mergeModifications(existing: Modification[], added: Modification[]): Modification[] {
  const out = [...existing];
  for (const m of added) {
    const i = out.findIndex((x) => x.type === m.type && x.target.toLowerCase() === m.target.toLowerCase());
    if (i >= 0) out[i] = m; else out.push(m);
  }
  return out;
}

/** Whether a previous order is on today's menu; returns the dish or null. */
function findPreviousOnMenu(prev: PreviousOrder, menu: MenuItem[]): MenuItem | null {
  const byId = prev.menuItemId ? menu.find((m) => m.id === prev.menuItemId) : null;
  if (byId) return byId;
  const name = prev.itemName.toLowerCase();
  return menu.find((m) => m.nameDe.toLowerCase() === name) || null;
}

/** The main entry point: one webhook, one turn. */
export async function runTurn(previous: CallState, input: TurnInput, ctx: DialogContext): Promise<TurnResult> {
  const state: CallState = JSON.parse(JSON.stringify(previous));
  const log = ctx.log || (() => {});
  const effects: Effect[] = [];
  state.turns += 1;
  if (input.callerNumber && !state.callerNumber) state.callerNumber = input.callerNumber;

  // ── Call start ────────────────────────────────────────────────────────
  if (input.utterance === null && !input.digits && state.turns === 1) {
    const time = timeInBerlin(input.now || new Date());
    state.afterDeadline = isPastDeadline(time, ctx.settings.orderDeadline);
    if (!ctx.menu.length || !availableMenu(ctx).length) {
      return handoff(state, 'Kein veröffentlichter Speiseplan für heute', input, ctx, [], [P.greeting(ctx.settings.restaurantName), P.noMenuToday()]);
    }
    if (state.afterDeadline && !ctx.settings.allowSameDayAfterDeadline) {
      return handoff(state, 'Anruf nach Bestellschluss (' + ctx.settings.orderDeadline + ')', input, ctx, [], [P.greeting(ctx.settings.restaurantName), P.afterDeadlineRefuse(ctx.settings.orderDeadline || '')]);
    }
    // Caller id is a secondary signal only: remembered, never acted on alone.
    if (ctx.settings.useCallerId && state.callerNumber) {
      const byPhone = await ctx.findCustomerByPhone(state.callerNumber).catch(() => null);
      state.callerMatchedCustomerId = byPhone?.id || null;
    }
    log('call.start', { afterDeadline: state.afterDeadline, callerKnown: !!state.callerMatchedCustomerId });
    return result(state, [P.greeting(ctx.settings.restaurantName)], 'gather', 'code', effects, input);
  }

  heard(state, input);
  const utterance = (input.utterance || '').trim();
  const digits = (input.digits || '').replace(/\D/g, '');

  // ── Silence ───────────────────────────────────────────────────────────
  if (!utterance && !digits) {
    state.silences += 1;
    log('turn.silence', { stage: state.stage, silences: state.silences });
    if (state.silences >= 3) {
      if (state.stage === 'ASK_CODE') {
        effects.push({ type: 'call_completed', outcome: 'abandoned' });
        state.stage = 'ENDED';
        return result(state, [P.goodbye()], 'hangup', 'speech', effects, input);
      }
      return handoff(state, 'Längeres Schweigen während der Bestellung', input, ctx);
    }
    const hint = state.stage === 'ASK_CODE' || state.stage === 'CONFIRM_CODE' ? P.waitingHintCode()
      : state.stage === 'CONFIRM_ORDER' ? P.waitingHintConfirm() : P.waitingHintOrder();
    const mode = state.stage === 'ASK_CODE' ? 'code' : state.stage === 'CONFIRM_ORDER' || state.stage === 'CONFIRM_CODE' ? 'confirm' : 'speech';
    return result(state, [P.waiting(hint)], 'gather', mode, effects, input);
  }
  state.silences = 0;

  // ── Anyone may ask for a person at any time ───────────────────────────
  if (utterance && wantsHandoff(utterance)) {
    return handoff(state, 'Kunde möchte mit einem Mitarbeiter sprechen', input, ctx);
  }

  switch (state.stage) {
    case 'ASK_CODE': return askCode(state, input, ctx, utterance, digits, effects);
    case 'CONFIRM_CODE': return confirmCode(state, input, ctx, utterance, digits, effects);
    case 'ASK_ORDER': return askOrder(state, input, ctx, utterance, effects, 'order');
    case 'ASK_CHANGE': return askOrder(state, input, ctx, utterance, effects, 'change');
    case 'CONFIRM_ORDER': return confirmOrder(state, input, ctx, utterance, digits, effects);
    default:
      state.stage = 'ENDED';
      return result(state, [P.goodbye()], 'hangup', 'speech', effects, input);
  }
}

// ── Customer identification ─────────────────────────────────────────────

async function acceptCode(state: CallState, code: string, confidence: number, input: TurnInput, ctx: DialogContext, effects: Effect[]): Promise<TurnResult> {
  const customer = await ctx.findCustomerByCode(code);
  if (!customer) {
    state.unknownCodeAttempts += 1;
    state.failures += 1;
    ctx.log?.('code.unknown', { attempts: state.unknownCodeAttempts });
    if (state.unknownCodeAttempts >= 2) {
      return handoff(state, `Unbekannte Kundennummer ${code}`, input, ctx, [
        { type: 'alert', alertType: 'unknown_customer', severity: 'warning', message: `Anrufer nannte die unbekannte Kundennummer ${code}.`, customerCode: code },
      ]);
    }
    return result(state, [P.codeUnknown()], 'gather', 'code', effects, input);
  }
  if (!customer.active) {
    return handoff(state, `Kundennummer ${code} ist deaktiviert`, input, ctx, [
      { type: 'alert', alertType: 'unknown_customer', severity: 'warning', message: `Anruf mit deaktivierter Kundennummer ${code}.`, customerCode: code, customerId: customer.id },
    ]);
  }
  // Caller id disagrees with the spoken code: never place the order silently.
  if (state.callerMatchedCustomerId && state.callerMatchedCustomerId !== customer.id && state.pendingCode !== code) {
    state.pendingCode = code;
    state.stage = 'CONFIRM_CODE';
    effects.push({ type: 'alert', alertType: 'caller_mismatch', severity: 'info', message: `Anrufernummer gehört zu einem anderen Kunden als die genannte Kundennummer ${code}.`, customerCode: code, customerId: customer.id });
    return result(state, [P.confirmCode(code)], 'gather', 'confirm', effects, input);
  }
  state.customer = customer;
  state.customerConfidence = confidence;
  state.pendingCode = null;
  state.stage = 'ASK_ORDER';
  state.failures = 0;
  ctx.log?.('code.accepted', { customerId: customer.id, confidence });
  const texts = [P.codeRecognised(code)];
  if (state.afterDeadline && ctx.settings.orderDeadline) texts.push(P.afterDeadlineNote(ctx.settings.orderDeadline));
  texts.push(P.askOrder());
  return result(state, texts, 'gather', 'speech', effects, input);
}

async function askCode(state: CallState, input: TurnInput, ctx: DialogContext, utterance: string, digits: string, effects: Effect[]): Promise<TurnResult> {
  if (digits) return acceptCode(state, digits, 1, input, ctx, effects);

  const candidates = extractCodeCandidates(utterance);
  const stt = typeof input.sttConfidence === 'number' ? input.sttConfidence : 0.8;
  if (candidates.length === 1) {
    const c = candidates[0];
    const confidence = c.confidence * (0.6 + 0.4 * stt);
    if (confidence >= ctx.settings.confidenceThreshold) return acceptCode(state, c.code, confidence, input, ctx, effects);
    if (confidence >= 0.4) {
      state.pendingCode = c.code;
      state.customerConfidence = confidence;
      state.stage = 'CONFIRM_CODE';
      return result(state, [P.confirmCode(c.code)], 'gather', 'confirm', effects, input);
    }
  }
  state.failures += 1;
  ctx.log?.('code.unclear', { candidates: candidates.length, failures: state.failures });
  if (state.failures >= ctx.settings.maxFailures) {
    return handoff(state, 'Kundennummer wiederholt nicht verstanden', input, ctx, [
      { type: 'alert', alertType: 'repeated_failures', severity: 'warning', message: 'Die Kundennummer wurde mehrfach nicht verstanden.' },
    ]);
  }
  const texts = [P.askCodeAgain()];
  if (state.failures >= 2) texts.push(P.askCodeDigits());
  return result(state, texts, 'gather', 'code', effects, input);
}

async function confirmCode(state: CallState, input: TurnInput, ctx: DialogContext, utterance: string, digits: string, effects: Effect[]): Promise<TurnResult> {
  const yes = digits === '1' || isPureYes(utterance);
  const no = digits === '2' || isNo(utterance);
  if (yes && state.pendingCode) {
    const code = state.pendingCode;
    state.callerMatchedCustomerId = null; // the caller confirmed; the mismatch is already recorded as an alert
    return acceptCode(state, code, Math.max(state.customerConfidence, ctx.settings.confidenceThreshold), input, ctx, effects);
  }
  if (no) {
    state.pendingCode = null;
    state.stage = 'ASK_CODE';
    return result(state, [P.askCodeAgain()], 'gather', 'code', effects, input);
  }
  // Perhaps they said a new number straight away.
  const candidates = extractCodeCandidates(utterance);
  if (candidates.length === 1) {
    state.stage = 'ASK_CODE';
    return askCode(state, input, ctx, utterance, digits, effects);
  }
  state.failures += 1;
  if (state.failures >= ctx.settings.maxFailures) return handoff(state, 'Bestätigung der Kundennummer wiederholt nicht verstanden', input, ctx);
  return result(state, [P.confirmCode(state.pendingCode || '')], 'gather', 'confirm', effects, input);
}

// ── The order ───────────────────────────────────────────────────────────

async function askOrder(state: CallState, input: TurnInput, ctx: DialogContext, utterance: string, effects: Effect[], stage: 'order' | 'change'): Promise<TurnResult> {
  const menu = availableMenu(ctx);
  const customer = state.customer as Customer;
  const previous = state.draft || null;

  // In ASK_ORDER a plain "nein" means the recognised code was wrong.
  if (stage === 'order' && !previous && isNo(utterance) && utterance.split(' ').length <= 3) {
    state.customer = null;
    state.stage = 'ASK_CODE';
    return result(state, [P.askCodeAgain()], 'gather', 'code', effects, input);
  }

  const u = await ctx.understand({
    utterance, sttConfidence: input.sttConfidence, stage, menu: ctx.menu, draft: previous, hasPreviousOrder: true,
  });
  ctx.log?.('order.understood', { stage, intent: u.intent, candidates: u.items.length, confidence: u.confidence, source: u.source });

  const notUnderstood = (texts: string[], alertMessage?: string): TurnResult => {
    state.failures += 1;
    if (state.failures >= ctx.settings.maxFailures) {
      return handoff(state, 'Bestellung wiederholt nicht verstanden', input, ctx, [
        { type: 'alert', alertType: 'repeated_failures', severity: 'warning', message: alertMessage || 'Die Bestellung wurde mehrfach nicht verstanden.', customerCode: customer.customerCode, customerId: customer.id },
      ]);
    }
    return result(state, texts, 'gather', 'speech', effects, input);
  };

  switch (u.intent) {
    case 'handoff':
      return handoff(state, 'Kunde möchte mit einem Mitarbeiter sprechen', input, ctx);
    case 'cancel':
      state.stage = 'ENDED';
      effects.push({ type: 'call_completed', outcome: 'no_order' });
      return result(state, [P.goodbyeNoOrder()], 'hangup', 'speech', effects, input);
    case 'repeat_menu':
      return result(state, [P.menuToday(menu), P.askOrderShort()], 'gather', 'speech', effects, input);
    case 'same_as_yesterday': {
      const prev = await ctx.previousOrder(customer.id);
      if (!prev) return notUnderstood([P.noPreviousOrder(menu)]);
      const item = findPreviousOnMenu(prev, menu);
      if (!item) {
        effects.push({ type: 'alert', alertType: 'unavailable_item', severity: 'info', message: `Kunde ${customer.customerCode} wollte "${prev.itemName}" wie gestern; heute nicht im Speiseplan.`, customerCode: customer.customerCode, customerId: customer.id });
        return result(state, [P.yesterdayUnavailable(menu)], 'gather', 'speech', effects, input);
      }
      const draft = draftFromItem(item, { ...u, modifications: mergeModifications(prev.modifications || [], u.modifications), quantity: u.quantity ?? prev.quantity }, null);
      return toConfirm(state, withReviewFlags(draft, state.afterDeadline), 0.9, input, effects);
    }
    case 'yes':
    case 'no':
    case 'unclear':
      if (stage === 'change') return notUnderstood([P.changeNotUnderstood(menu)]);
      if (u.mentionedFood) return offMenu(u.mentionedFood);
      return notUnderstood([P.askOrderAgain()]);
    case 'order':
      break;
  }

  function offMenu(food: string): TurnResult {
    effects.push({ type: 'alert', alertType: 'unavailable_item', severity: 'info', message: `Kunde ${customer.customerCode} fragte nach "${food}", das heute nicht angeboten wird.`, customerCode: customer.customerCode, customerId: customer.id });
    return notUnderstood([P.notOnMenu(food, menu)]);
  }

  // intent === 'order'
  const top = u.items[0];
  const second = u.items[1];
  const threshold = ctx.settings.confidenceThreshold;

  // A dish the caller named is on the menu but marked unavailable today.
  if (top) {
    const full = ctx.menu.find((m) => m.id === top.menuItemId);
    if (full && !full.available && top.confidence >= threshold) {
      effects.push({ type: 'alert', alertType: 'unavailable_item', severity: 'info', message: `Kunde ${customer.customerCode} wollte "${full.nameDe}", heute nicht verfügbar.`, customerCode: customer.customerCode, customerId: customer.id });
      return result(state, [P.unavailable(full.nameDe, menu)], 'gather', 'speech', effects, input);
    }
  }

  const ambiguous = !!(top && second && second.confidence >= 0.45 && top.confidence - second.confidence < 0.15);
  let item: MenuItem | null = null;
  if (top && top.confidence >= threshold && !ambiguous) {
    item = menu.find((m) => m.id === top.menuItemId) || null;
  }

  if (!item && previous && (u.modifications.length || u.allergyNote || u.quantity || u.specialRequest) && !(top && top.confidence >= 0.45)) {
    // Only a change to the dish already chosen.
    item = menu.find((m) => m.id === previous.menuItemId) || null;
  }

  if (!item) {
    if (ambiguous || (top && top.confidence >= 0.4)) {
      const candidates = u.items.filter((c) => c.confidence >= 0.4).map((c) => menu.find((m) => m.id === c.menuItemId)).filter((m): m is MenuItem => !!m);
      const list = candidates.length >= 2 ? candidates : menu;
      if (state.failures + 1 >= ctx.settings.maxFailures) {
        effects.push({ type: 'alert', alertType: 'ambiguous_order', severity: 'warning', message: `Bestellung von Kunde ${customer.customerCode} blieb mehrdeutig.`, customerCode: customer.customerCode, customerId: customer.id });
      }
      return notUnderstood([P.ambiguousDish(list)]);
    }
    if (u.mentionedFood) return offMenu(u.mentionedFood);
    return notUnderstood([stage === 'change' ? P.changeNotUnderstood(menu) : P.askOrderAgain()]);
  }

  const quantity = u.quantity ?? previous?.quantity ?? 1;
  if (quantity > MAX_QUANTITY) return notUnderstood([P.quantityTooHigh()]);

  const keepMods = previous && previous.menuItemId === item.id ? previous.modifications : [];
  const mods = mergeModifications(keepMods, u.modifications.map((m) => ({ ...m, allowed: isAllowedModification(m, item as MenuItem) })));
  const base = previous && previous.menuItemId === item.id ? previous : null;
  const draft = draftFromItem(item, { ...u, modifications: mods, quantity, allergyNote: u.allergyNote ?? base?.allergyNote ?? null, specialRequest: u.specialRequest ?? base?.specialRequest ?? null }, base);

  if (u.allergyNote && !(previous && previous.allergyNote === u.allergyNote)) {
    effects.push({ type: 'alert', alertType: 'allergy_request', severity: 'critical', message: `Kunde ${customer.customerCode}: "${u.allergyNote}" — bitte persönlich prüfen.`, customerCode: customer.customerCode, customerId: customer.id });
  }
  state.failures = 0;
  return toConfirm(state, withReviewFlags(draft, state.afterDeadline), top ? top.confidence : 0.85, input, effects);
}

function toConfirm(state: CallState, draft: OrderDraft, confidence: number, input: TurnInput, effects: Effect[]): TurnResult {
  state.draft = draft;
  state.menuMatchConfidence = draft.menuMatchConfidence;
  state.orderConfidence = confidence;
  state.stage = 'CONFIRM_ORDER';
  return result(state, [P.confirmOrder(draft, (state.customer as Customer).customerCode)], 'gather', 'confirm', effects, input);
}

async function confirmOrder(state: CallState, input: TurnInput, ctx: DialogContext, utterance: string, digits: string, effects: Effect[]): Promise<TurnResult> {
  const draft = state.draft as OrderDraft;
  const customer = state.customer as Customer;
  const yes = digits === '1' || isPureYes(utterance);
  if (yes) {
    state.stage = 'DONE';
    effects.push({ type: 'save_order', draft, customer, orderDate: state.orderDate });
    effects.push({ type: 'call_completed', outcome: 'ordered' });
    ctx.log?.('order.confirmed', { customerId: customer.id, needsReview: draft.needsReview });
    return result(state, [draft.needsReview ? P.savedWithReview() : P.saved()], 'hangup', 'speech', effects, input);
  }
  const plainNo = digits === '2' || (isNo(utterance) && utterance.split(' ').length <= 3);
  if (plainNo) {
    state.stage = 'ASK_CHANGE';
    return result(state, [P.askChange()], 'gather', 'speech', effects, input);
  }
  if (utterance) {
    // "Nein, ich meinte das zweite Essen" / "ja, aber ohne Zwiebeln": a change, straight away.
    const u = await ctx.understand({ utterance, sttConfidence: input.sttConfidence, stage: 'confirm', menu: ctx.menu, draft, hasPreviousOrder: true });
    if (u.intent === 'yes') return confirmOrder(state, input, ctx, 'ja', '', effects);
    if (u.intent === 'handoff') return handoff(state, 'Kunde möchte mit einem Mitarbeiter sprechen', input, ctx);
    if (u.intent === 'cancel') {
      state.stage = 'ENDED';
      effects.push({ type: 'call_completed', outcome: 'no_order' });
      return result(state, [P.goodbyeNoOrder()], 'hangup', 'speech', effects, input);
    }
    if (u.intent === 'order' || u.intent === 'same_as_yesterday' || u.modifications.length) {
      state.stage = 'ASK_CHANGE';
      return askOrder(state, input, ctx, utterance, effects, 'change');
    }
  }
  state.failures += 1;
  if (state.failures >= ctx.settings.maxFailures) return handoff(state, 'Bestätigung wiederholt nicht verstanden', input, ctx);
  return result(state, [P.confirmAgain()], 'gather', 'confirm', effects, input);
}
