import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { roles, userRoles, users, teachers, students } from "../db/schema/index.js";

export async function getUserWithRoles(userIdOrIdentifier: string) {
  let [user] = await db.select().from(users).where(eq(users.id, userIdOrIdentifier)).limit(1);
  if (!user) {
    [user] = await db.select().from(users).where(eq(users.ssoId, userIdOrIdentifier)).limit(1);
  }
  if (!user) {
    [user] = await db.select().from(users).where(eq(users.email, userIdOrIdentifier)).limit(1);
  }
  if (!user) {
    [user] = await db.select().from(users).where(eq(users.username, userIdOrIdentifier)).limit(1);
  }
  if (!user) return null;
  const userId = user.id;

  const rows = await db
    .select({ code: roles.code, name: roles.name })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  let jenisKelamin: string | null = null;
  const [t] = await db.select({ jk: teachers.jenisKelamin }).from(teachers).where(eq(teachers.userId, userId)).limit(1);
  if (t?.jk) {
    jenisKelamin = t.jk;
  } else {
    const [s] = await db.select({ jk: students.jenisKelamin }).from(students).where(eq(students.userId, userId)).limit(1);
    if (s?.jk) jenisKelamin = s.jk;
  }

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl,
    jenisKelamin,
    isActive: user.isActive,
    roles: rows.map((r) => r.code),
    roleNames: rows.map((r) => r.name),
  };
}

export function publicUser(user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    name: user.name,
    avatarUrl: user.avatarUrl,
    jenisKelamin: user.jenisKelamin,
    roles: user.roles,
  };
}

