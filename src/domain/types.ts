/**
 * Types shared by the voice pipeline, the backend functions and the tests.
 *
 * Everything here is provider-agnostic: nothing knows about Twilio, Fable or
 * Base44. The functions under `base44/functions/lunch*` translate between
 * these types and the outside world.
 */

export type LunchRole = 'admin' | 'staff' | 'kitchen';

export type OrderStatus = 'NEW' | 'CONFIRMED' | 'PREPARING' | 'READY' | 'DELIVERED' | 'CANCELLED';

export interface Customer {
  id: string;
  customerCode: string;
  firstName?: string;
  lastName: string;
  salutation?: string;
  phoneNumber?: string;
  roomNumber?: string;
  active: boolean;
  notes?: string;
}

export interface MenuItem {
  id: string;
  date: string;
  position: number;
  nameDe: string;
  descriptionDe?: string;
  category?: 'main' | 'vegetarian' | 'soup' | 'dessert' | 'special';
  available: boolean;
  components?: string[];
  allergens?: string[];
  ingredients?: string[];
  allowedModifications?: string[];
  aliases?: string[];
}

export type ModificationType = 'without' | 'replace' | 'extra' | 'note';

export interface Modification {
  type: ModificationType;
  /** The thing removed / replaced / added, e.g. "Zwiebeln" */
  target: string;
  /** For `replace`: what it is replaced with, e.g. "Reis" */
  replacement?: string;
  /** Spoken form, e.g. "ohne Zwiebeln" */
  textDe: string;
  /** Whether the kitchen listed this change as allowed for the dish */
  allowed?: boolean;
}

/** An order as the dialog engine builds it, before it is saved. */
export interface OrderDraft {
  menuItemId: string;
  itemPosition: number;
  itemName: string;
  components: string[];
  quantity: number;
  modifications: Modification[];
  specialRequest: string | null;
  allergyNote: string | null;
  needsReview: boolean;
  reviewReason: string | null;
  /** How sure the engine is about the dish (0–1) */
  menuMatchConfidence: number;
}

/** A previous order, used for "das gleiche wie gestern". */
export interface PreviousOrder {
  orderDate: string;
  itemName: string;
  itemPosition?: number;
  menuItemId?: string;
  modifications: Modification[];
  quantity: number;
}

export type Intent =
  | 'order'
  | 'same_as_yesterday'
  | 'yes'
  | 'no'
  | 'handoff'
  | 'repeat_menu'
  | 'cancel'
  | 'unclear';

export interface ItemCandidate {
  menuItemId: string;
  position: number;
  confidence: number;
}

/** What an understanding provider returns for one utterance. */
export interface Understanding {
  intent: Intent;
  /** Sorted by confidence, best first. Only items of today's menu. */
  items: ItemCandidate[];
  /** What the caller asked for when nothing on the menu matched ("Pizza"). */
  mentionedFood: string | null;
  quantity: number | null;
  modifications: Modification[];
  allergyNote: string | null;
  specialRequest: string | null;
  /** Overall confidence in this interpretation (0–1). */
  confidence: number;
  source: 'rules' | 'fable' | 'composite';
}

export interface UnderstandInput {
  utterance: string;
  /** Speech recognition confidence (0–1) if the telephony provider gives one. */
  sttConfidence?: number;
  stage: 'order' | 'change' | 'confirm';
  menu: MenuItem[];
  draft: OrderDraft | null;
  hasPreviousOrder: boolean;
}

/**
 * What a model provider may return before validation: dishes by position or
 * id, loosely typed. `validateUnderstanding` turns it into an `Understanding`.
 */
export interface RawUnderstanding {
  intent?: Intent | string;
  items?: { menuItemId?: string; position?: number; confidence?: number }[];
  mentionedFood?: string | null;
  quantity?: number | null;
  modifications?: { type?: ModificationType | string; target?: string; replacement?: string; textDe?: string; allowed?: boolean }[];
  allergyNote?: string | null;
  specialRequest?: string | null;
  confidence?: number;
  source?: Understanding['source'];
}

export interface OrderUnderstandingProvider {
  readonly name: string;
  understand(input: UnderstandInput): Promise<RawUnderstanding>;
}

export type Stage =
  | 'ASK_CODE'
  | 'CONFIRM_CODE'
  | 'ASK_ORDER'
  | 'CONFIRM_ORDER'
  | 'ASK_CHANGE'
  | 'DONE'
  | 'HANDOFF'
  | 'ENDED';

export interface TranscriptLine {
  role: 'assistant' | 'customer' | 'system';
  text: string;
  confidence?: number;
  at: string;
}

/** The state persisted between turns (one row of LunchCall). */
export interface CallState {
  stage: Stage;
  turns: number;
  failures: number;
  silences: number;
  unknownCodeAttempts: number;
  customer: Customer | null;
  /** Code spoken but not yet accepted (waiting for CONFIRM_CODE). */
  pendingCode: string | null;
  callerNumber: string | null;
  callerMatchedCustomerId: string | null;
  draft: OrderDraft | null;
  orderDate: string;
  afterDeadline: boolean;
  transcript: TranscriptLine[];
  /** Confidence trail, for the call record. */
  customerConfidence: number;
  orderConfidence: number;
  menuMatchConfidence: number;
}

export interface TurnInput {
  /** `null` on the first webhook of a call (nothing was said yet). */
  utterance: string | null;
  sttConfidence?: number;
  /** Keypad digits, if the caller typed instead of speaking. */
  digits?: string | null;
  callerNumber?: string | null;
  now?: Date;
}

export type Effect =
  | { type: 'save_order'; draft: OrderDraft; customer: Customer; orderDate: string }
  | { type: 'alert'; alertType: AlertType; severity: 'info' | 'warning' | 'critical'; message: string; customerCode?: string; customerId?: string }
  | { type: 'handoff'; reason: string }
  | { type: 'call_completed'; outcome: 'ordered' | 'no_order' | 'handoff' | 'abandoned' };

export type AlertType =
  | 'unknown_customer'
  | 'ambiguous_order'
  | 'allergy_request'
  | 'unavailable_item'
  | 'repeated_failures'
  | 'human_handoff'
  | 'caller_mismatch'
  | 'system_error';

export type GatherMode = 'code' | 'speech' | 'confirm';

export interface TurnResult {
  state: CallState;
  /** Sentences to speak, in order. */
  say: string[];
  /** What the telephony layer should do after speaking. */
  action: 'gather' | 'hangup' | 'dial';
  gatherMode: GatherMode;
  effects: Effect[];
}

export interface EngineSettings {
  restaurantName: string;
  confidenceThreshold: number;
  maxFailures: number;
  useCallerId: boolean;
  orderDeadline: string | null;
  allowSameDayAfterDeadline: boolean;
  handoffAvailable: boolean;
}

export interface DialogContext {
  settings: EngineSettings;
  /** Today's published menu, including unavailable dishes (they are read as unavailable). */
  menu: MenuItem[];
  today: string;
  findCustomerByCode(code: string): Promise<Customer | null>;
  findCustomerByPhone(phone: string): Promise<Customer | null>;
  previousOrder(customerId: string): Promise<PreviousOrder | null>;
  understand(input: UnderstandInput): Promise<Understanding>;
  /** Called once per turn with the phase, for structured logs. Never receives the utterance. */
  log?(event: string, data: Record<string, unknown>): void;
}
