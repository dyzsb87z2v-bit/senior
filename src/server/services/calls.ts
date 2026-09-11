import { and, desc, eq, gte, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { alerts, calls, type AlertRow, type CallRow } from '../db/schema.ts';
import type { AlertType, CallState, TurnResult } from '../../domain/types.ts';

export async function findCallBySid(db: Db, callSid: string): Promise<CallRow | null> {
  return (await db.select().from(calls).where(eq(calls.callSid, callSid)).limit(1))[0] || null;
}

export async function getCall(db: Db, id: string): Promise<CallRow | null> {
  return (await db.select().from(calls).where(eq(calls.id, id)).limit(1))[0] || null;
}

export async function listCalls(db: Db, limit = 200, since?: string): Promise<CallRow[]> {
  return db.select().from(calls).where(since ? gte(calls.startedAt, new Date(since)) : undefined).orderBy(desc(calls.startedAt)).limit(limit);
}

/** The engine's state as stored on the row, with the transcript re-attached. */
export function stateFromRow(row: CallRow): CallState | null {
  const s = row.state as Partial<CallState>;
  if (!s || !s.stage) return null;
  return { ...(s as CallState), transcript: Array.isArray(row.transcript) ? (row.transcript as CallState['transcript']) : [] };
}

/** Writes one turn: the new state, the transcript (if kept), the outcome. Returns the call id. */
export async function persistTurn(db: Db, existing: CallRow | null, callSid: string, provider: string, turn: TurnResult, storeTranscripts: boolean, now: Date): Promise<CallRow> {
  const { state } = turn;
  const { transcript, ...persistedState } = state;
  const ended = turn.action !== 'gather';
  const callStatus = state.stage === 'HANDOFF' ? 'handoff' : state.stage === 'DONE' ? 'completed' : state.stage === 'ENDED' ? (!state.customer ? 'abandoned' : 'completed') : 'in_progress';
  const values = {
    callSid, provider,
    callerNumber: state.callerNumber || '',
    customerId: state.customer?.id || null,
    customerCode: state.customer?.customerCode || state.pendingCode || '',
    stage: state.stage,
    state: persistedState,
    turns: state.turns,
    failures: state.failures,
    transcript: storeTranscripts ? transcript : [],
    detectedOrder: state.draft ? {
      itemName: state.draft.itemName, itemPosition: state.draft.itemPosition, quantity: state.draft.quantity,
      modifications: state.draft.modifications.map((m) => m.textDe), allergyNote: state.draft.allergyNote, specialRequest: state.draft.specialRequest,
      confidence: { customer: state.customerConfidence, order: state.orderConfidence, menuMatch: state.menuMatchConfidence },
    } : {},
    confirmation: (state.stage === 'DONE' ? 'confirmed' : state.draft ? 'pending' : 'none') as 'confirmed' | 'pending' | 'none',
    callStatus: callStatus as CallRow['callStatus'],
    endedAt: ended ? now : null,
    updatedAt: now,
  };
  if (existing) {
    const [row] = await db.update(calls).set(values).where(eq(calls.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(calls).values({ ...values, startedAt: now }).returning();
  return row;
}

export async function closeCall(db: Db, callSid: string, twilioStatus: string, durationSeconds: number | null): Promise<CallRow | null> {
  const call = await findCallBySid(db, callSid);
  if (!call) return null;
  const patch: Partial<typeof calls.$inferInsert> = { endedAt: new Date(), updatedAt: new Date() };
  if (durationSeconds !== null) patch.durationSeconds = durationSeconds;
  if (['completed', 'busy', 'no-answer', 'canceled', 'failed'].includes(twilioStatus) && call.callStatus === 'in_progress') {
    patch.callStatus = twilioStatus === 'completed' ? 'abandoned' : 'failed';
  }
  const [row] = await db.update(calls).set(patch).where(eq(calls.id, call.id)).returning();
  return row;
}

export async function linkOrder(db: Db, callId: string, orderId: string, handoffReason?: string): Promise<void> {
  await db.update(calls).set({ orderId, confirmation: 'confirmed', updatedAt: new Date(), ...(handoffReason ? { handoffReason } : {}) }).where(eq(calls.id, callId));
}

export async function markHandoff(db: Db, callId: string, reason: string): Promise<void> {
  await db.update(calls).set({ handoffReason: reason, callStatus: 'handoff', updatedAt: new Date() }).where(eq(calls.id, callId));
}

export async function createAlert(db: Db, a: { type: AlertType; severity: 'info' | 'warning' | 'critical'; message: string; callId?: string | null; orderId?: string | null; customerId?: string | null; customerCode?: string }): Promise<AlertRow> {
  const [row] = await db.insert(alerts).values({ type: a.type, severity: a.severity, message: a.message, callId: a.callId || null, orderId: a.orderId || null, customerId: a.customerId || null, customerCode: a.customerCode || '' }).returning();
  return row;
}

export async function listAlerts(db: Db, onlyOpen = true, limit = 200): Promise<AlertRow[]> {
  return db.select().from(alerts).where(onlyOpen ? eq(alerts.resolved, false) : undefined).orderBy(desc(alerts.createdAt)).limit(limit);
}

export async function resolveAlert(db: Db, id: string, by: string): Promise<AlertRow | null> {
  const [row] = await db.update(alerts).set({ resolved: true, resolvedBy: by, resolvedAt: new Date() }).where(eq(alerts.id, id)).returning();
  return row || null;
}

/** Data retention: old calls, old orders, old resolved alerts. Returns counts. */
export async function applyRetention(db: Db, callCutoffIso: string, orderCutoffDate: string): Promise<{ calls: number; orders: number; alerts: number }> {
  const { orders } = await import('../db/schema.ts');
  const c = (await db.delete(calls).where(lt(calls.createdAt, new Date(callCutoffIso))).returning({ id: calls.id })).length;
  const o = (await db.delete(orders).where(lt(orders.orderDate, orderCutoffDate)).returning({ id: orders.id })).length;
  const a = (await db.delete(alerts).where(and(eq(alerts.resolved, true), lt(alerts.createdAt, new Date(callCutoffIso)))).returning({ id: alerts.id })).length;
  return { calls: c, orders: o, alerts: a };
}
