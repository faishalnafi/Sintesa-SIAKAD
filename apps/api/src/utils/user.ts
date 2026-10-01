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
    if (s?.jk) {
      jenisKelamin = s.jk;
    } else {
      // 1. Coba cari dari NIP/NIS yang cocok dengan username
      if (user.username) {
        const [tByNip] = await db.select({ jk: teachers.jenisKelamin }).from(teachers).where(eq(teachers.nip, user.username)).limit(1);
        if (tByNip?.jk) jenisKelamin = tByNip.jk;
        if (!jenisKelamin) {
          const [sByNis] = await db.select({ jk: students.jenisKelamin }).from(students).where(eq(students.nis, user.username)).limit(1);
          if (sByNis?.jk) jenisKelamin = sByNis.jk;
        }
      }
      // 2. Coba cari dari kemiripan nama di teachers atau students jika ada
      if (!jenisKelamin && user.name) {
        const cleanName = user.name.replace(/['`]/g, "").trim().toLowerCase();
        const teachersList = await db.select({ name: teachers.name, jk: teachers.jenisKelamin }).from(teachers);
        const matchedT = teachersList.find((item) => {
          if (!item.name || !item.jk) return false;
          const itemClean = item.name.replace(/['`]/g, "").trim().toLowerCase();
          return cleanName.includes(itemClean) || itemClean.includes(cleanName);
        });
        if (matchedT?.jk) jenisKelamin = matchedT.jk;
      }
    }
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

