import type { Db } from '../db/client.ts';
import { auditLogs } from '../db/schema.ts';
import type { Logger } from './logger.ts';

export interface AuditEntry {
  actorEmail?: string;
  actorRole?: string;
  action: string;
  entity: string;
  entityId?: string;
  summary?: string;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  callId?: string;
  orderId?: string;
}

/** Best-effort: a failed audit write never fails the operation, but it is logged loudly. */
export async function audit(db: Db, log: Logger, e: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorEmail: e.actorEmail || '', actorRole: e.actorRole || '', action: e.action, entity: e.entity, entityId: e.entityId || '',
      summary: e.summary || '', before: e.before ?? null, after: e.after ?? null, callId: e.callId || null, orderId: e.orderId || null,
    });
  } catch (err) {
    log.error({ err, action: e.action, entity: e.entity }, 'audit.failed');
  }
}
