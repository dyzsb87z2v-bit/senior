import { asc, eq, sql } from 'drizzle-orm';
import type { Db } from '../db/client.ts';
import { users, type UserRow } from '../db/schema.ts';
import { hashPassword, passwordPolicyError, verifyPassword } from '../auth/password.ts';
import type { Role } from '../auth/roles.ts';
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.ts';
import { deleteUserSessions } from '../auth/session.ts';

export type PublicUser = { id: string; email: string; name: string; role: Role; active: boolean; createdAt: string };

export function toPublicUser(u: UserRow): PublicUser {
  return { id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt.toISOString() };
}

export async function findUserByEmail(db: Db, email: string): Promise<UserRow | null> {
  return (await db.select().from(users).where(eq(sql`lower(${users.email})`, email.trim().toLowerCase())).limit(1))[0] || null;
}

export async function listUsers(db: Db): Promise<PublicUser[]> {
  return (await db.select().from(users).orderBy(asc(users.email))).map(toPublicUser);
}

export async function createUser(db: Db, input: { email: string; password: string; name?: string; role: Role }): Promise<PublicUser> {
  const policy = passwordPolicyError(input.password);
  if (policy) throw badRequest(policy);
  if (await findUserByEmail(db, input.email)) throw conflict('Diese E-Mail-Adresse ist bereits registriert');
  const [row] = await db.insert(users).values({ email: input.email.trim().toLowerCase(), passwordHash: await hashPassword(input.password), name: input.name || '', role: input.role }).returning();
  return toPublicUser(row);
}

export async function updateUser(db: Db, id: string, patch: { role?: Role; active?: boolean; name?: string; password?: string }): Promise<PublicUser> {
  const existing = (await db.select().from(users).where(eq(users.id, id)).limit(1))[0];
  if (!existing) throw notFound('Benutzer nicht gefunden');
  const values: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (patch.role) values.role = patch.role;
  if (patch.active !== undefined) values.active = patch.active;
  if (patch.name !== undefined) values.name = patch.name;
  if (patch.password) {
    const policy = passwordPolicyError(patch.password);
    if (policy) throw badRequest(policy);
    values.passwordHash = await hashPassword(patch.password);
  }
  const [row] = await db.update(users).set(values).where(eq(users.id, id)).returning();
  if (patch.active === false || patch.password) await deleteUserSessions(db, id);
  return toPublicUser(row);
}

export async function authenticate(db: Db, email: string, password: string): Promise<UserRow> {
  const user = await findUserByEmail(db, email);
  // Always verify against something so a missing user costs the same time as a wrong password.
  const ok = await verifyPassword(password, user?.passwordHash || 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
  if (!user || !ok || !user.active) throw unauthorized('E-Mail-Adresse oder Passwort ist falsch');
  return user;
}

export async function countUsers(db: Db): Promise<number> {
  const rows = await db.select({ n: sql<number>`count(*)::int` }).from(users);
  return rows[0]?.n ?? 0;
}
