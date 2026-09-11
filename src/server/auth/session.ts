import { createHash, randomBytes } from 'node:crypto';
import { and, eq, gt, lt } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { sessions, users, type UserRow } from '../db/schema.ts';

export const SESSION_COOKIE = 'lunch_session';

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Creates a session and returns the cookie value (random, 256-bit). Only its hash is stored. */
export async function createSession(db: Db, userId: string, ttlHours: number, userAgent: string): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + ttlHours * 3600 * 1000);
  await db.insert(sessions).values({ id: hashToken(token), userId, expiresAt, userAgent: userAgent.slice(0, 200) });
  return { token, expiresAt };
}

export async function findSessionUser(db: Db, token: string): Promise<UserRow | null> {
  const rows = await db.select({ user: users, session: sessions }).from(sessions).innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  const row = rows[0];
  if (!row || !row.user.active) return null;
  // Touch at most once a minute; cheap and keeps "last seen" honest.
  if (Date.now() - row.session.lastSeenAt.getTime() > 60_000) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.id, row.session.id));
  }
  return row.user;
}

export async function deleteSession(db: Db, token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.id, hashToken(token)));
}

export async function deleteUserSessions(db: Db, userId: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function purgeExpiredSessions(db: Db): Promise<void> {
  await db.delete(sessions).where(lt(sessions.expiresAt, new Date()));
}
