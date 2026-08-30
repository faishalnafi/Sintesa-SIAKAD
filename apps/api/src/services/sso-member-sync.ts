/**
 * Sync members from Kredensia IdP into SINTESA users (+ optional student/teacher shells).
 * Uses api.md GET /api/v1/members
 */
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { externalSyncLogs, roles, students, teachers, userRoles, users, classes } from "../db/schema/index.js";
import { mapExternalRoles, canRoleLogin } from "../constants/roles.js";
import { ssoFetchAllMembers, type SsoMember } from "./sso-api-client.js";

async function ensureRoles(codes: string[], userId: string) {
  const activeRoleCodes = new Set(codes.filter((c) => canRoleLogin(c) || c === "keluar"));

  for (const code of activeRoleCodes) {
    let [role] = await db.select().from(roles).where(eq(roles.code, code)).limit(1);
    if (!role) {
      [role] = await db
        .insert(roles)
        .values({
          code,
          name: code.charAt(0).toUpperCase() + code.slice(1),
          category: "member",
          canLogin: true,
          description: `Peran dinamis diimpor dari SSO Kredensia.`,
        })
        .returning();
    }
    const links = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    if (!links.some((l) => l.roleId === role.id)) {
      await db.insert(userRoles).values({ userId, roleId: role.id });
    }
  }

  // Remove obsolete role links in user_roles that are no longer in the active roles set
  const currentLinksWithRoles = await db
    .select({ id: userRoles.id, roleId: userRoles.roleId, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, userId));

  for (const link of currentLinksWithRoles) {
    if (!activeRoleCodes.has(link.code)) {
      await db.delete(userRoles).where(eq(userRoles.id, link.id));
    }
  }
}

function roleNames(member: SsoMember): string[] {
  return (member.roles ?? []).map((r) => r.nama_role);
}

export async function upsertLocalFromSsoMember(member: SsoMember) {
  const roleCodes = mapExternalRoles(roleNames(member));
  const nomor = member.nip_nis || null;

  let [user] = await db.select().from(users).where(eq(users.ssoId, member.id)).limit(1);
  if (!user && member.email) {
    [user] = await db.select().from(users).where(eq(users.email, member.email)).limit(1);
  }
  if (!user && nomor) {
    [user] = await db.select().from(users).where(eq(users.username, nomor)).limit(1);
  }

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        ssoId: member.id,
        email: member.email,
        username: nomor,
        name: member.nama_lengkap,
        phone: member.no_telp,
        isActive: member.is_active !== false && !roleCodes.includes("keluar"),
      })
      .returning();
  } else {
    [user] = await db
      .update(users)
      .set({
        ssoId: member.id,
        email: member.email ?? user.email,
        username: nomor ?? user.username,
        name: member.nama_lengkap,
        phone: member.no_telp ?? user.phone,
        isActive: member.is_active !== false && !roleCodes.includes("keluar"),
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
  }

  await ensureRoles(roleCodes.length ? roleCodes : ["siswa"], user.id);

  // Lightweight profile shells
  if (roleCodes.includes("siswa") || roleCodes.includes("alumni") || roleCodes.includes("keluar")) {
    const status = roleCodes.includes("alumni")
      ? "alumni"
      : roleCodes.includes("keluar")
        ? "keluar"
        : "siswa";

    let targetClassId: string | null = member.kelas_id || null;
    let targetKelasLabel: string | null = member.kelas?.nama_kelas || null;

    if (targetClassId && targetKelasLabel) {
      try {
        const [cls] = await db.select().from(classes).where(eq(classes.id, targetClassId)).limit(1);
        if (!cls) {
          await db.insert(classes).values({
            id: targetClassId,
            name: targetKelasLabel,
            gradeLevel: String(member.kelas?.tingkat ?? "X"),
            jurusan: member.kelas?.jurusan ?? null,
            academicYear: "2024/2025",
            isActive: true,
          });
        }
      } catch (classErr) {
        console.error("[upsertLocalFromSsoMember] Failed to ensure class exists:", targetKelasLabel, classErr);
      }
    }

    const existing = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
    if (!existing[0]) {
      const byNis = nomor
        ? await db.select().from(students).where(eq(students.nis, nomor)).limit(1)
        : [];
      if (!byNis[0]) {
        await db.insert(students).values({
          userId: user.id,
          ssoMemberId: member.id,
          name: member.nama_lengkap,
          memberStatus: status,
          nis: nomor,
          nik: member.nik,
          jenisKelamin: member.jk,
          tanggalLahir: member.tgl_lahir,
          noTelepon: member.no_telp,
          emailPribadi: member.email,
          googleEmail: member.email,
          isActive: status === "siswa",
          isClaimed: Boolean(member.claimed_at),
          claimedAt: member.claimed_at ? new Date(member.claimed_at) : null,
          classId: targetClassId,
          kelasLabel: targetKelasLabel,
        });
      }
    } else {
      await db
        .update(students)
        .set({
          ssoMemberId: member.id,
          name: member.nama_lengkap,
          memberStatus: status,
          nik: member.nik ?? existing[0].nik,
          jenisKelamin: member.jk ?? existing[0].jenisKelamin,
          tanggalLahir: member.tgl_lahir ?? existing[0].tanggalLahir,
          noTelepon: member.no_telp ?? existing[0].noTelepon,
          emailPribadi: member.email ?? existing[0].emailPribadi,
          googleEmail: member.email ?? existing[0].googleEmail,
          classId: targetClassId ?? existing[0].classId,
          kelasLabel: targetKelasLabel ?? existing[0].kelasLabel,
          isActive: status === "siswa",
          updatedAt: new Date(),
        })
        .where(eq(students.id, existing[0].id));
    }
  }

  if (roleCodes.includes("guru") || roleCodes.includes("tendik") || roleCodes.includes("walikelas")) {
    const staffType = roleCodes.includes("tendik") ? "tendik" : "guru";
    const existing = await db.select().from(teachers).where(eq(teachers.userId, user.id)).limit(1);
    if (!existing[0]) {
      await db.insert(teachers).values({
        userId: user.id,
        ssoMemberId: member.id,
        staffType,
        nip: nomor,
        name: member.nama_lengkap,
        nik: member.nik,
        jenisKelamin: member.jk,
        tanggalLahir: member.tgl_lahir,
        noTelepon: member.no_telp,
        emailPribadi: member.email,
        googleEmail: member.email,
        isClaimed: Boolean(member.claimed_at),
        claimedAt: member.claimed_at ? new Date(member.claimed_at) : null,
      });
    } else {
      await db
        .update(teachers)
        .set({
          ssoMemberId: member.id,
          name: member.nama_lengkap,
          staffType,
          nik: member.nik ?? existing[0].nik,
          jenisKelamin: member.jk ?? existing[0].jenisKelamin,
          tanggalLahir: member.tgl_lahir ?? existing[0].tanggalLahir,
          noTelepon: member.no_telp ?? existing[0].noTelepon,
          emailPribadi: member.email ?? existing[0].emailPribadi,
          googleEmail: member.email ?? existing[0].googleEmail,
          updatedAt: new Date(),
        })
        .where(eq(teachers.id, existing[0].id));
    }
  }

  return { userId: user.id, roleCodes };
}

export async function syncMembersFromIdp(role?: string) {
  const members = await ssoFetchAllMembers(role);
  let success = 0;
  const errors: Array<{ id: string; message: string }> = [];

  for (const m of members) {
    try {
      await upsertLocalFromSsoMember(m);
      success += 1;
    } catch (e) {
      errors.push({
        id: m.id,
        message: e instanceof Error ? e.message : "error",
      });
    }
  }

  const result = {
    total: members.length,
    success,
    failed: errors.length,
    errors: errors.slice(0, 20),
  };

  try {
    await db.insert(externalSyncLogs).values({
      source: "kredensia",
      status: errors.length === 0 ? "success" : errors.length === members.length ? "error" : "partial",
      payloadSummary: {
        total: members.length,
        success,
        failed: errors.length,
        message: `Impor SSO: ${success}/${members.length} anggota ter-sync`,
        fieldsImported: [
          "nama_lengkap",
          "email",
          "nik",
          "nip_nis",
          "jk",
          "no_telp",
          "tgl_lahir",
          "is_active",
          "claimed_at",
          "roles",
        ],
        errors: errors.slice(0, 10),
      },
    });
  } catch (e) {
    console.error("Failed to write externalSyncLog for SSO sync:", e);
  }

  return result;
}
