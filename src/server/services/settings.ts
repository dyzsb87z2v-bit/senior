import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { settings, type SettingsRow } from '../db/schema.ts';

export interface LunchSettings {
  restaurantName: string;
  storeTranscripts: boolean;
  callRetentionDays: number;
  orderRetentionDays: number;
  handoffNumber: string;
  orderDeadline: string;
  allowSameDayAfterDeadline: boolean;
  maxFailures: number;
  /** 0–1 */
  confidenceThreshold: number;
  useCallerId: boolean;
}

export function toSettings(row: SettingsRow | undefined): LunchSettings {
  return {
    restaurantName: row?.restaurantName ?? 'Mittagessen-Service',
    storeTranscripts: row?.storeTranscripts ?? true,
    callRetentionDays: row?.callRetentionDays ?? 30,
    orderRetentionDays: row?.orderRetentionDays ?? 365,
    handoffNumber: row?.handoffNumber ?? '',
    orderDeadline: row?.orderDeadline ?? '10:30',
    allowSameDayAfterDeadline: row?.allowSameDayAfterDeadline ?? true,
    maxFailures: row?.maxFailures ?? 3,
    confidenceThreshold: (row?.confidenceThreshold ?? 70) / 100,
    useCallerId: row?.useCallerId ?? true,
  };
}

export async function getSettings(db: Db): Promise<LunchSettings> {
  const rows = await db.select().from(settings).where(eq(settings.id, 1)).limit(1);
  return toSettings(rows[0]);
}

export async function saveSettings(db: Db, patch: Partial<LunchSettings>): Promise<LunchSettings> {
  const values: Partial<typeof settings.$inferInsert> = { updatedAt: new Date() };
  if (patch.restaurantName !== undefined) values.restaurantName = patch.restaurantName;
  if (patch.storeTranscripts !== undefined) values.storeTranscripts = patch.storeTranscripts;
  if (patch.callRetentionDays !== undefined) values.callRetentionDays = patch.callRetentionDays;
  if (patch.orderRetentionDays !== undefined) values.orderRetentionDays = patch.orderRetentionDays;
  if (patch.handoffNumber !== undefined) values.handoffNumber = patch.handoffNumber;
  if (patch.orderDeadline !== undefined) values.orderDeadline = patch.orderDeadline;
  if (patch.allowSameDayAfterDeadline !== undefined) values.allowSameDayAfterDeadline = patch.allowSameDayAfterDeadline;
  if (patch.maxFailures !== undefined) values.maxFailures = patch.maxFailures;
  if (patch.confidenceThreshold !== undefined) values.confidenceThreshold = Math.round(patch.confidenceThreshold * 100);
  if (patch.useCallerId !== undefined) values.useCallerId = patch.useCallerId;
  await db.insert(settings).values({ id: 1, ...values }).onConflictDoUpdate({ target: settings.id, set: values });
  return getSettings(db);
}
