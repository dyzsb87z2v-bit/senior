/**
 * Wires the provider-agnostic dialog engine to this server: the menu, the
 * customers, the previous order, the understanding providers, and what to do
 * with the effects a turn produces (save the order, raise alerts, tell the
 * dashboard).
 */
import type { Db } from '../db/client.ts';
import type { Config } from '../config.ts';
import type { Logger } from '../lib/logger.ts';
import type { LiveEvents } from '../lib/events.ts';
import { CompositeUnderstanding } from '../../domain/understanding.ts';
import { FableUnderstanding } from '../ai/fableProvider.ts';
import type { CallState, DialogContext, Effect, MenuItem } from '../../domain/types.ts';
import { loadPublishedMenu } from '../services/menu.ts';
import { getSettings, type LunchSettings } from '../services/settings.ts';
import { findActiveByPhone, findByCode, toCustomer } from '../services/customers.ts';
import { previousOrderOf, saveVoiceOrder } from '../services/orders.ts';
import { createAlert, linkOrder, markHandoff } from '../services/calls.ts';
import { audit } from '../lib/audit.ts';

export interface VoiceDeps { db: Db; config: Config; log: Logger; events: LiveEvents }

export function handoffNumber(config: Config, settings: LunchSettings): string {
  return settings.handoffNumber || config.LUNCH_HANDOFF_NUMBER || '';
}

export async function buildDialogContext(deps: VoiceDeps, today: string, callSid: string): Promise<{ ctx: DialogContext; settings: LunchSettings; menu: MenuItem[]; fableActive: boolean }> {
  const { db, config, log } = deps;
  const [settings, menu] = await Promise.all([getSettings(db), loadPublishedMenu(db, today)]);
  const fable = config.ANTHROPIC_API_KEY
    ? new FableUnderstanding({ apiKey: config.ANTHROPIC_API_KEY, model: config.LUNCH_AI_MODEL, timeoutMs: config.LUNCH_AI_TIMEOUT_MS, log: (event, data) => log.info({ callSid, ...data }, event) })
    : null;
  const understanding = new CompositeUnderstanding(fable);
  const ctx: DialogContext = {
    settings: {
      restaurantName: settings.restaurantName,
      confidenceThreshold: settings.confidenceThreshold,
      maxFailures: settings.maxFailures,
      useCallerId: settings.useCallerId,
      orderDeadline: settings.orderDeadline || null,
      allowSameDayAfterDeadline: settings.allowSameDayAfterDeadline,
      handoffAvailable: !!handoffNumber(config, settings),
    },
    menu,
    today,
    findCustomerByCode: async (code) => toCustomer(await findByCode(db, code)),
    findCustomerByPhone: async (phone) => toCustomer(await findActiveByPhone(db, phone)),
    previousOrder: (customerId) => previousOrderOf(db, customerId, today),
    understand: (i) => understanding.understand(i),
    log: (event, data) => log.info({ callSid, ...data }, event),
  };
  return { ctx, settings, menu, fableActive: !!fable };
}

/** Words that help the speech recogniser: dish names, sides, the answers we expect. */
export function hintsFor(menu: MenuItem[]): string[] {
  const words = new Set<string>(['ja', 'nein', 'richtig', 'falsch', 'Nummer eins', 'Nummer zwei', 'Nummer drei', 'ohne Zwiebeln', 'wie gestern', 'Mitarbeiter']);
  for (const m of menu) {
    words.add(m.nameDe);
    for (const c of m.components || []) words.add(c);
    for (const a of m.aliases || []) words.add(a);
  }
  return [...words].slice(0, 40);
}

export async function applyEffects(deps: VoiceDeps, effects: Effect[], callId: string, state: CallState): Promise<void> {
  const { db, log, events } = deps;
  for (const e of effects) {
    if (e.type === 'save_order') {
      const order = await saveVoiceOrder(db, e.draft, e.customer, e.orderDate, callId);
      await linkOrder(db, callId, order.id);
      await audit(db, log, { actorEmail: 'voice', actorRole: 'system', action: 'order.create', entity: 'orders', entityId: order.id, summary: `Telefonische Bestellung von Kunde ${e.customer.customerCode}: ${e.draft.itemName}`, callId, orderId: order.id });
      events.publish({ type: 'order', action: 'create', id: order.id, data: order });
      log.info({ callId, orderId: order.id, customerId: e.customer.id, needsReview: e.draft.needsReview }, 'order.saved');
    } else if (e.type === 'alert') {
      const alert = await createAlert(db, { type: e.alertType, severity: e.severity, message: e.message, callId, customerId: e.customerId, customerCode: e.customerCode });
      events.publish({ type: 'alert', action: 'create', id: alert.id, data: alert });
    } else if (e.type === 'handoff') {
      await markHandoff(db, callId, e.reason);
      log.info({ callId, reason: e.reason }, 'call.handoff');
    } else if (e.type === 'call_completed') {
      log.info({ callId, outcome: e.outcome, turns: state.turns }, 'call.completed');
    }
  }
  events.publish({ type: 'call', action: 'update', id: callId });
}
