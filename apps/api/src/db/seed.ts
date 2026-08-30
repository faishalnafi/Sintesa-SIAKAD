import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq, or } from "drizzle-orm";
import { ROLE_DEFINITIONS } from "../constants/roles.js";
import { db } from "./index.js";
import {
  academicYears,
  classes,
  classSubjects,
  enrollments,
  grades,
  roles,
  students,
  subjects,
  teachers,
  userRoles,
  users,
} from "./schema/index.js";

async function upsertRole(def: (typeof ROLE_DEFINITIONS)[number]) {
  const existing = await db.select().from(roles).where(eq(roles.code, def.code)).limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(roles)
      .set({
        name: def.name,
        category: def.category,
        canLogin: def.canLogin,
        description: def.description,
        updatedAt: new Date(),
      })
      .where(eq(roles.id, existing[0].id))
      .returning();
    return row;
  }
  const [row] = await db
    .insert(roles)
    .values({
      code: def.code,
      name: def.name,
      category: def.category,
      canLogin: def.canLogin,
      description: def.description,
    })
    .returning();
  return row;
}

async function upsertUser(data: {
  email: string;
  username: string;
  name: string;
  password: string;
  roleCodes: string[];
  phone?: string;
}) {
  const existing = await db
    .select()
    .from(users)
    .where(or(eq(users.email, data.email), eq(users.username, data.username)))
    .limit(1);
  let user = existing[0];
  if (!user) {
    const passwordHash = await bcrypt.hash(data.password, 12);
    [user] = await db
      .insert(users)
      .values({
        email: data.email,
        username: data.username,
        name: data.name,
        passwordHash,
        phone: data.phone ?? null,
        isActive: true,
      })
      .returning();
  } else {
    const passwordHash = await bcrypt.hash(data.password, 12);
    [user] = await db
      .update(users)
      .set({
        email: data.email,
        username: data.username,
        passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
  }

  for (const code of data.roleCodes) {
    const [role] = await db.select().from(roles).where(eq(roles.code, code)).limit(1);
    if (!role) continue;
    const links = await db.select().from(userRoles).where(eq(userRoles.userId, user.id));
    if (!links.some((l) => l.roleId === role.id)) {
      await db.insert(userRoles).values({ userId: user.id, roleId: role.id });
    }
  }
  return user;
}

async function main() {
  console.log("Seeding initial setup (Superadmin user only)...");

  for (const def of ROLE_DEFINITIONS) {
    await upsertRole(def);
  }

  let [year] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.name, "2025/2026"))
    .limit(1);
  if (!year) {
    [year] = await db
      .insert(academicYears)
      .values({ name: "2025/2026", isActive: true })
      .returning();
  } else if (!year.isActive) {
    await db.update(academicYears).set({ isActive: false });
    [year] = await db
      .update(academicYears)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(academicYears.id, year.id))
      .returning();
  }

  const superadminEmail = "superadmin@faishalnafi.local";
  const adminUser = await upsertUser({
    email: superadminEmail,
    username: "superadmin",
    name: "Super Admin",
    password: "@Password123",
    roleCodes: ["superadmin", "admin"],
  });

  console.log("Seed complete.");
  console.log("Superadmin Account Created:");
  console.log(`  Email:    ${superadminEmail}`);
  console.log("  Password: @Password123");
  console.log(`  User ID:  ${adminUser.id}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
