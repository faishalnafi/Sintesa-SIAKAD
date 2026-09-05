import { Hono } from "hono";
import { count, desc, eq, ne, and, or, sql, inArray, asc, isNull, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { INTEGRATIONS } from "../../constants/integrations.js";
import { ROLE_DEFINITIONS } from "../../constants/roles.js";
import { db } from "../../db/index.js";
import {
  academicYears,
  academicHistories,
  enrollments,
  gradeAuditLogs,
  ssoTokenJti,
  authEvents,
  classes,
  classSubjects,
  externalSyncLogs,
  grades,
  importJobs,
  roles,
  students,
  subjects,
  teachers,
  teacherSubjects,
  homeroomAssignments,
  users,
  userRoles,
  teachingHours,
  teacherJournals,
  apiKeys,
  assessmentComponents,
  systemSettings,
} from "../../db/schema/index.js";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { requireRoles } from "../../middlewares/rbac.js";
import * as lifecycle from "../../services/academic-lifecycle.js";
import { gdsStatus, syncGds } from "../../services/integrations/gds.js";
import { kehadiranStatus, syncKehadiran } from "../../services/integrations/kehadiran.js";
import {
  getSsoRequestOrigin,
  ssoGetKelasMembers,
  ssoGetMember,
  ssoListKelas,
  ssoListMembers,
  ssoListPeran,
  ssoStatistik,
  ssoTestConnection,
} from "../../services/sso-api-client.js";
import { syncMembersFromIdp, upsertLocalFromSsoMember } from "../../services/sso-member-sync.js";
import { isSsoConfigured } from "../../services/sso-kredensia.js";
import { cleanUrlProtocol, env, ssoApiBaseUrl, ssoClientId, getGoogleClientId, getGoogleClientSecret, isGoogleConfigured } from "../../env.js";
import { broadcastRealtimeEvent } from "../../services/realtime.js";

export const adminRoutes = new Hono<{ Variables: AuthVariables }>();

adminRoutes.use("*", requireAuth, (c, next) => {
  if (c.req.path.endsWith("/sso/kelas") || c.req.path.endsWith("/sso/tahun-pelajaran")) {
    return next();
  }
  return requireRoles("admin", "superadmin")(c, next);
});

adminRoutes.get("/roles", async (c) => {
  const rows = await db.select().from(roles).orderBy(roles.code);
  return c.json({
    success: true,
    data: {
      catalog: ROLE_DEFINITIONS,
      seeded: rows,
    },
  });
});

// academic year + lifecycle routes appended at bottom

adminRoutes.get("/dashboard", async (c) => {
  const [studentCount] = await db
    .select({ value: count() })
    .from(students)
    .where(eq(students.memberStatus, "siswa"));
  const [alumniCount] = await db
    .select({ value: count() })
    .from(students)
    .where(eq(students.memberStatus, "alumni"));
  const [keluarCount] = await db
    .select({ value: count() })
    .from(students)
    .where(eq(students.memberStatus, "keluar"));
  const [guruCount] = await db
    .select({ value: count() })
    .from(teachers)
    .where(eq(teachers.staffType, "guru"));
  const [tendikCount] = await db
    .select({ value: count() })
    .from(teachers)
    .where(eq(teachers.staffType, "tendik"));
  const [classCount] = await db.select({ value: count() }).from(classes);

  let totalStudents = studentCount.value;
  let totalTeachers = guruCount.value;
  let totalTendik = tendikCount.value;
  let totalClasses = classCount.value;

  if (isSsoConfigured()) {
    try {
      // Fetch active students count from Kredensia SSO
      const studentsRes = await ssoListMembers({ role: "Siswa", per_page: 1 });
      if (studentsRes.meta && typeof studentsRes.meta.total === "number") {
        totalStudents = studentsRes.meta.total;
      }

      // Fetch active teachers count from Kredensia SSO
      const teachersRes = await ssoListMembers({ role: "Guru", per_page: 1 });
      if (teachersRes.meta && typeof teachersRes.meta.total === "number") {
        totalTeachers = teachersRes.meta.total;
      }

      // Fetch active tendik count from Kredensia SSO
      const tendikRes = await ssoListMembers({ role: "Tendik", per_page: 1 });
      if (tendikRes.meta && typeof tendikRes.meta.total === "number") {
        totalTendik = tendikRes.meta.total;
      }

      // Fetch active classes/rombel count from Kredensia SSO
      if (env.SSO_API_KEY && env.SSO_API_BASE_URL) {
        const url = `${env.SSO_API_BASE_URL.replace(/\/$/, "")}/kelas?aktif=true`;
        const origin = env.FRONTEND_URL && !env.FRONTEND_URL.includes("localhost") ? env.FRONTEND_URL.replace(/\/$/, "") : "https://siakad.sman3mjk.sch.id";
        const res = await fetch(url, {
          headers: {
            "X-API-Key": env.SSO_API_KEY,
            Origin: origin,
            Referer: `${origin}/`,
          },
        });
        const json = (await res.json()) as { success: boolean; data?: unknown[] };
        if (json.success && Array.isArray(json.data)) {
          totalClasses = json.data.length;
        }
      }
    } catch (e) {
      console.error("Dashboard real-time SSO counts fetch failed, falling back to local database:", e);
    }
  }

  const recentImports = await db
    .select()
    .from(importJobs)
    .orderBy(desc(importJobs.createdAt))
    .limit(5);
  const recentSync = await db
    .select()
    .from(externalSyncLogs)
    .orderBy(desc(externalSyncLogs.createdAt))
    .limit(5);

  return c.json({
    success: true,
    data: {
      stats: {
        totalStudents,
        totalAlumni: alumniCount.value,
        totalKeluar: keluarCount.value,
        totalTeachers,
        totalTendik,
        totalClasses,
        syncHealth: 99.8,
      },
      roles: ROLE_DEFINITIONS.map((r) => ({
        code: r.code,
        name: r.name,
        category: r.category,
        canLogin: r.canLogin,
      })),
      recentImports,
      recentSync,
    },
  });
});

adminRoutes.get("/students", async (c) => {
  const status = c.req.query("status"); // siswa | alumni | keluar
  const base = db
    .select({
      id: students.id,
      ssoMemberId: students.ssoMemberId,
      name: students.name,
      memberStatus: students.memberStatus,
      nis: students.nis,
      nisn: students.nisn,
      nik: students.nik,
      nomorKk: students.nomorKk,
      jenisKelamin: students.jenisKelamin,
      tempatLahir: students.tempatLahir,
      tanggalLahir: students.tanggalLahir,
      agama: students.agama,
      classId: students.classId,
      className: classes.name,
      kelasLabel: students.kelasLabel,
      academicYearId: students.academicYearId,
      noTelepon: students.noTelepon,
      emailPribadi: students.emailPribadi,
      googleEmail: students.googleEmail,
      alamat: students.alamat,
      kodePos: students.kodePos,
      ayahNama: students.ayahNama,
      ayahNoHp: students.ayahNoHp,
      ibuNama: students.ibuNama,
      ibuNoHp: students.ibuNoHp,
      waliNama: students.waliNama,
      waliNoHp: students.waliNoHp,
      poinGds: students.poinGds,
      sakit: students.sakit,
      izin: students.izin,
      alpa: students.alpa,
      isClaimed: students.isClaimed,
      isActive: students.isActive,
    })
    .from(students)
    .leftJoin(classes, eq(students.classId, classes.id))
    .orderBy(students.name);

  const rows =
    status && ["siswa", "alumni", "keluar"].includes(status)
      ? await base.where(eq(students.memberStatus, status))
      : await base;

  return c.json({ success: true, data: rows });
});



const classBodySchema = z.object({
  name: z.string().min(1).max(100),
  gradeLevel: z.string().max(10).optional().nullable(),
  jurusan: z.string().max(100).optional().nullable(),
  urutan: z.coerce.number().int().min(0).default(0),
  academicYear: z.string().max(20).optional().nullable(),
  academicYearId: z.string().uuid().optional().nullable(),
  homeroomTeacherId: z.string().uuid().optional().nullable(),
  isActive: z.boolean().optional(),
});

async function resolveAcademicYearFields(
  academicYearId: string | null | undefined,
  fallback: string | null | undefined,
): Promise<{ academicYear: string; academicYearId: string | null }> {
  if (academicYearId) {
    const years = await lifecycle.listAcademicYears();
    const y = years.find((x) => x.id === academicYearId);
    if (y?.name) return { academicYear: y.name, academicYearId: y.id };
  }
  if (fallback && fallback.trim()) {
    return { academicYear: fallback.trim(), academicYearId: academicYearId || null };
  }
  const active = await lifecycle.getActiveAcademicYear();
  if (active?.name) return { academicYear: active.name, academicYearId: active.id };
  return { academicYear: "—", academicYearId: null };
}

adminRoutes.get("/classes", async (c) => {
  const yearId = c.req.query("academicYearId");
  const grade = c.req.query("gradeLevel");
  const activeOnly = c.req.query("active"); // "true" | "false" | omit = all

  const base = db
    .select({
      id: classes.id,
      name: classes.name,
      gradeLevel: classes.gradeLevel,
      jurusan: classes.jurusan,
      urutan: classes.urutan,
      academicYear: classes.academicYear,
      academicYearId: classes.academicYearId,
      homeroomTeacherId: classes.homeroomTeacherId,
      homeroomTeacherName: teachers.name,
      isActive: classes.isActive,
      createdAt: classes.createdAt,
      updatedAt: classes.updatedAt,
    })
    .from(classes)
    .leftJoin(teachers, eq(classes.homeroomTeacherId, teachers.id))
    .orderBy(classes.urutan, classes.name);

  let rows = await base;
  if (yearId) {
    rows = rows.filter((r) => r.academicYearId === yearId);
  }
  if (grade) {
    rows = rows.filter((r) => r.gradeLevel === grade);
  }
  if (activeOnly === "true") {
    rows = rows.filter((r) => r.isActive);
  } else if (activeOnly === "false") {
    rows = rows.filter((r) => !r.isActive);
  }

  const counts = await db
    .select({
      classId: students.classId,
      value: count(),
    })
    .from(students)
    .where(eq(students.memberStatus, "siswa"))
    .groupBy(students.classId);

  const countMap = new Map(counts.map((c) => [c.classId, c.value]));
  const data = rows.map((r) => ({
    ...r,
    studentCount: countMap.get(r.id) ?? 0,
  }));

  // Always fetch live classes from Kredensia SSO API & merge with local classes
  if (env.SSO_API_KEY && env.SSO_API_BASE_URL) {
    try {
      const ssoRes = await ssoListKelas();
      if (ssoRes.data && Array.isArray(ssoRes.data)) {
        const seenIds = new Set(data.map((r) => r.id));
        const seenNames = new Set(data.map((r) => r.name.toLowerCase()));
        for (const k of ssoRes.data) {
          if (!seenIds.has(k.id) && !seenNames.has(k.nama_kelas.toLowerCase())) {
            const gradeLevel = String(k.tingkat ?? "X");
            if (grade && gradeLevel !== grade) continue;
            data.push({
              id: k.id,
              name: k.nama_kelas,
              gradeLevel,
              jurusan: k.jurusan ?? null,
              urutan: 0,
              academicYear: "2024/2025",
              academicYearId: null,
              homeroomTeacherId: null,
              homeroomTeacherName: null,
              isActive: true,
              createdAt: new Date(),
              updatedAt: new Date(),
              studentCount: 0,
            });
            seenIds.add(k.id);
            seenNames.add(k.nama_kelas.toLowerCase());
          }
        }
      }
    } catch (e) {
      console.error("[/classes] SSO live fetch error:", e);
    }
  }

  const years = await lifecycle.listAcademicYears();
  const teacherRows = await db
    .select({
      id: teachers.id,
      name: teachers.name,
      staffType: teachers.staffType,
      nip: teachers.nip,
    })
    .from(teachers)
    .where(eq(teachers.isActive, true))
    .orderBy(teachers.name);

  return c.json({
    success: true,
    data: {
      classes: data,
      years,
      teachers: teacherRows,
    },
  });
});

adminRoutes.post("/classes", async (c) => {
  try {
    const body = classBodySchema.parse(await c.req.json());
    const year = await resolveAcademicYearFields(body.academicYearId, body.academicYear);
    const [row] = await db
      .insert(classes)
      .values({
        name: body.name.trim(),
        gradeLevel: body.gradeLevel || null,
        jurusan: body.jurusan || null,
        urutan: body.urutan ?? 0,
        academicYear: year.academicYear,
        academicYearId: year.academicYearId,
        homeroomTeacherId: body.homeroomTeacherId || null,
        isActive: body.isActive ?? true,
      })
      .returning();
    return c.json({ success: true, data: row, message: `Rombel ${row.name} ditambahkan` }, 201);
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.put("/classes/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = classBodySchema.parse(await c.req.json());
    const year = await resolveAcademicYearFields(body.academicYearId, body.academicYear);
    const [row] = await db
      .update(classes)
      .set({
        name: body.name.trim(),
        gradeLevel: body.gradeLevel || null,
        jurusan: body.jurusan || null,
        urutan: body.urutan ?? 0,
        academicYear: year.academicYear,
        academicYearId: year.academicYearId,
        homeroomTeacherId: body.homeroomTeacherId || null,
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(classes.id, id))
      .returning();
    if (!row) {
      return c.json({ success: false, message: "Rombel tidak ditemukan" }, 404);
    }
    broadcastRealtimeEvent({ type: "class_updated" });
    return c.json({ success: true, data: row, message: `Rombel ${row.name} diperbarui` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/classes/:id/activate", async (c) => {
  try {
    const [row] = await db
      .update(classes)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(classes.id, c.req.param("id")))
      .returning();
    if (!row) return c.json({ success: false, message: "Rombel tidak ditemukan" }, 404);
    broadcastRealtimeEvent({ type: "class_updated" });
    return c.json({ success: true, data: row, message: `Rombel ${row.name} diaktifkan` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/classes/:id/deactivate", async (c) => {
  try {
    const [row] = await db
      .update(classes)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(classes.id, c.req.param("id")))
      .returning();
    if (!row) return c.json({ success: false, message: "Rombel tidak ditemukan" }, 404);
    broadcastRealtimeEvent({ type: "class_updated" });
    return c.json({ success: true, data: row, message: `Rombel ${row.name} dinonaktifkan` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.delete("/classes/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [studentCount] = await db
      .select({ value: count() })
      .from(students)
      .where(eq(students.classId, id));
    if (studentCount.value > 0) {
      return c.json(
        {
          success: false,
          message: `Tidak bisa dihapus: masih ada ${studentCount.value} siswa di rombel ini. Nonaktifkan saja, atau pindahkan siswa dulu.`,
        },
        400,
      );
    }
    const [row] = await db.delete(classes).where(eq(classes.id, id)).returning();
    if (!row) {
      return c.json({ success: false, message: "Rombel tidak ditemukan" }, 404);
    }
    broadcastRealtimeEvent({ type: "class_updated" });
    return c.json({ success: true, data: row, message: `Rombel ${row.name} dihapus` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

const subjectBodySchema = z.object({
  name: z.string().min(1).max(150),
  code: z.string().max(50).optional().nullable(),
  type: z.enum(["umum", "pilihan", "mulok", "lainnya"]).default("umum"),
  isActive: z.boolean().optional(),
});

adminRoutes.get("/subjects", async (c) => {
  const typeFilter = c.req.query("type");
  const activeOnly = c.req.query("active");
  let rows = await db.select().from(subjects).orderBy(subjects.name);
  if (typeFilter) {
    rows = rows.filter((r) => r.type === typeFilter);
  }
  if (activeOnly === "true") {
    rows = rows.filter((r) => r.isActive);
  } else if (activeOnly === "false") {
    rows = rows.filter((r) => !r.isActive);
  }

  const classCounts = await db
    .select({
      subjectId: classSubjects.subjectId,
      value: count(),
    })
    .from(classSubjects)
    .groupBy(classSubjects.subjectId);

  const gradeCounts = await db
    .select({
      subjectId: grades.subjectId,
      value: count(),
    })
    .from(grades)
    .groupBy(grades.subjectId);

  const classMap = new Map(classCounts.map((c) => [c.subjectId, c.value]));
  const gradeMap = new Map(gradeCounts.map((c) => [c.subjectId, c.value]));

  const data = rows.map((r) => ({
    ...r,
    assignmentCount: classMap.get(r.id) ?? 0,
    gradeCount: gradeMap.get(r.id) ?? 0,
  }));

  return c.json({ success: true, data: { subjects: data } });
});

adminRoutes.post("/subjects", async (c) => {
  try {
    const body = subjectBodySchema.parse(await c.req.json());
    const code = body.code?.trim() || null;
    if (code) {
      const [dup] = await db.select().from(subjects).where(eq(subjects.code, code)).limit(1);
      if (dup) {
        return c.json({ success: false, message: `Kode mapel "${code}" sudah dipakai` }, 400);
      }
    }
    const [row] = await db
      .insert(subjects)
      .values({
        name: body.name.trim(),
        code,
        type: body.type,
        isActive: body.isActive ?? true,
      })
      .returning();
    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, data: row, message: `Mapel ${row.name} ditambahkan` }, 201);
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.put("/subjects/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const body = subjectBodySchema.parse(await c.req.json());
    const code = body.code?.trim() || null;
    if (code) {
      const [dup] = await db.select().from(subjects).where(eq(subjects.code, code)).limit(1);
      if (dup && dup.id !== id) {
        return c.json({ success: false, message: `Kode mapel "${code}" sudah dipakai` }, 400);
      }
    }
    const [row] = await db
      .update(subjects)
      .set({
        name: body.name.trim(),
        code,
        type: body.type,
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
        updatedAt: new Date(),
      })
      .where(eq(subjects.id, id))
      .returning();
    if (!row) {
      return c.json({ success: false, message: "Mapel tidak ditemukan" }, 404);
    }
    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, data: row, message: `Mapel ${row.name} diperbarui` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/subjects/:id/activate", async (c) => {
  try {
    const [row] = await db
      .update(subjects)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(subjects.id, c.req.param("id")))
      .returning();
    if (!row) return c.json({ success: false, message: "Mapel tidak ditemukan" }, 404);
    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, data: row, message: `Mapel ${row.name} diaktifkan` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/subjects/:id/deactivate", async (c) => {
  try {
    const [row] = await db
      .update(subjects)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(subjects.id, c.req.param("id")))
      .returning();
    if (!row) return c.json({ success: false, message: "Mapel tidak ditemukan" }, 404);
    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, data: row, message: `Mapel ${row.name} dinonaktifkan` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.delete("/subjects/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [gradeCount] = await db
      .select({ value: count() })
      .from(grades)
      .where(eq(grades.subjectId, id));
    if (gradeCount.value > 0) {
      return c.json(
        {
          success: false,
          message: `Tidak bisa dihapus: masih ada ${gradeCount.value} data nilai untuk mapel ini. Nonaktifkan saja jika tidak dipakai.`,
        },
        400,
      );
    }
    // class_subjects cascade on subject delete — clear assignment first is fine via cascade
    const [row] = await db.delete(subjects).where(eq(subjects.id, id)).returning();
    if (!row) {
      return c.json({ success: false, message: "Mapel tidak ditemukan" }, 404);
    }
    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, data: row, message: `Mapel ${row.name} dihapus` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

// ---------------------------------------------------------------------------
// Penugasan Guru ke Mapel (Tugas Guru)
// ---------------------------------------------------------------------------

adminRoutes.get("/teachers", async (c) => {
  const roleQuery = c.req.query("role")?.toLowerCase();
  const isHomeroomFilter = roleQuery === "walikelas" || roleQuery === "wali";

  const teacherList: Array<{ id: string; name: string; nip: string | null; email: string | null }> = [];
  const seenIds = new Set<string>();

  // 1. Fetch from local teachers table (authoritative list of active teachers in school)
  try {
    const teacherRows = await db
      .select({
        id: teachers.id,
        userId: teachers.userId,
        name: teachers.name,
        nip: teachers.nip,
        staffType: teachers.staffType,
      })
      .from(teachers)
      .where(eq(teachers.isActive, true))
      .orderBy(teachers.name);

    for (const t of teacherRows) {
      if (isHomeroomFilter && t.staffType && t.staffType !== "walikelas" && t.staffType !== "guru") {
        continue;
      }
      const targetId = t.userId || t.id;
      if (!seenIds.has(targetId)) {
        teacherList.push({
          id: targetId,
          name: t.name,
          nip: t.nip || null,
          email: null,
        });
        seenIds.add(targetId);
      }
    }
  } catch (e) {
    console.error("[/teachers] Local teachers table query error:", e);
  }

  // 2. Query local users with role guru / walikelas
  try {
    const roleCondition = isHomeroomFilter
      ? or(eq(roles.code, "walikelas"), eq(teachers.staffType, "walikelas"))
      : or(eq(roles.code, "guru"), eq(roles.code, "walikelas"), eq(teachers.staffType, "guru"));

    const localUsers = await db
      .selectDistinct({
        id: users.id,
        name: users.name,
        nip: users.username,
        email: users.email,
      })
      .from(users)
      .innerJoin(userRoles, eq(userRoles.userId, users.id))
      .innerJoin(roles, eq(roles.id, userRoles.roleId))
      .leftJoin(teachers, eq(teachers.userId, users.id))
      .where(roleCondition)
      .orderBy(users.name);

    for (const u of localUsers) {
      if (!seenIds.has(u.id)) {
        teacherList.push({
          id: u.id,
          name: u.name,
          nip: u.nip || null,
          email: u.email || null,
        });
        seenIds.add(u.id);
      }
    }
  } catch (e) {
    console.error("[/teachers] Local DB query error:", e);
  }

  // 3. Fetch live from Kredensia SSO API (STRICT: ONLY members explicitly having Guru/Wali Kelas roles)
  if (env.SSO_API_KEY && env.SSO_API_BASE_URL) {
    try {
      const ssoRes = await ssoListMembers({ per_page: 100 });
      if (ssoRes.data && Array.isArray(ssoRes.data)) {
        for (const m of ssoRes.data) {
          const roleNames = (m.roles ?? []).map((r) => String(r.nama_role).toLowerCase());

          let matchesRole = false;
          if (isHomeroomFilter) {
            matchesRole = roleNames.some((r) => r.includes("wali") || r.includes("homeroom"));
          } else {
            matchesRole = roleNames.some(
              (r) => r.includes("guru") || r.includes("teacher") || r.includes("pendidik") || r.includes("wali")
            );
          }

          if (matchesRole && m.id && m.nama_lengkap) {
            if (!seenIds.has(m.id)) {
              teacherList.push({
                id: m.id,
                name: m.nama_lengkap,
                nip: m.nip_nis || null,
                email: m.email || null,
              });
              seenIds.add(m.id);
            }
          }
        }
      }
    } catch (e) {
      console.error("[/teachers] Live SSO fetch error:", e);
    }
  }

  return c.json({ success: true, data: teacherList });
});

async function ensureTargetUserExists(userIdOrSsoId: string): Promise<string> {
  let [u] = await db.select().from(users).where(eq(users.id, userIdOrSsoId)).limit(1);
  if (u) return u.id;

  [u] = await db.select().from(users).where(eq(users.ssoId, userIdOrSsoId)).limit(1);
  if (u) return u.id;

  try {
    const ssoRes = await ssoGetMember(userIdOrSsoId);
    if (ssoRes?.data) {
      const res = await upsertLocalFromSsoMember(ssoRes.data);
      return res.userId;
    }
  } catch (e) {
    console.error("[ensureTargetUserExists] SSO fetch error:", e);
  }

  return userIdOrSsoId;
}

adminRoutes.get("/teacher-assignments", async (c) => {
  const list = await db
    .select({
      id: teacherSubjects.id,
      userId: teacherSubjects.userId,
      userName: users.name,
      userNip: users.username,
      subjectId: teacherSubjects.subjectId,
      subjectName: subjects.name,
      subjectCode: subjects.code,
    })
    .from(teacherSubjects)
    .innerJoin(users, eq(teacherSubjects.userId, users.id))
    .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
    .orderBy(users.name, subjects.name);
  return c.json({ success: true, data: list });
});

adminRoutes.post("/teacher-assignments", async (c) => {
  try {
    const body = z
      .object({
        userId: z.string().uuid("Guru wajib dipilih"),
        subjectId: z.string().uuid("Mapel wajib dipilih"),
      })
      .parse(await c.req.json());

    const targetUserId = await ensureTargetUserExists(body.userId);

    // Check duplicate
    const [dup] = await db
      .select()
      .from(teacherSubjects)
      .where(
        and(
          eq(teacherSubjects.userId, targetUserId),
          eq(teacherSubjects.subjectId, body.subjectId)
        )
      )
      .limit(1);

    if (dup) {
      return c.json({ success: false, message: "Guru sudah ditugaskan ke mapel ini." }, 400);
    }

    const [row] = await db
      .insert(teacherSubjects)
      .values({
        userId: targetUserId,
        subjectId: body.subjectId,
      })
      .returning();

    broadcastRealtimeEvent({ type: "teacher_assigned" });
    return c.json({ success: true, data: row, message: "Penugasan guru berhasil ditambahkan" }, 201);
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.delete("/teacher-assignments/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [row] = await db.delete(teacherSubjects).where(eq(teacherSubjects.id, id)).returning();
    if (!row) {
      return c.json({ success: false, message: "Penugasan tidak ditemukan" }, 404);
    }
    broadcastRealtimeEvent({ type: "teacher_assigned" });
    return c.json({ success: true, data: row, message: "Penugasan guru dihapus" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

// ---------------------------------------------------------------------------
// Penugasan Wali Kelas (Tugas Wali Kelas)
// ---------------------------------------------------------------------------

adminRoutes.get("/homeroom-assignments", async (c) => {
  const list = await db
    .select({
      id: homeroomAssignments.id,
      userId: homeroomAssignments.userId,
      userName: users.name,
      userNip: users.username,
      classId: homeroomAssignments.classId,
      className: classes.name,
    })
    .from(homeroomAssignments)
    .innerJoin(users, eq(homeroomAssignments.userId, users.id))
    .innerJoin(classes, eq(homeroomAssignments.classId, classes.id))
    .orderBy(users.name, classes.name);
  return c.json({ success: true, data: list });
});

async function ensureTargetClassExists(classIdOrSsoId: string): Promise<string> {
  let [c] = await db.select().from(classes).where(eq(classes.id, classIdOrSsoId)).limit(1);
  if (c) return c.id;

  try {
    const ssoRes = await ssoListKelas();
    if (ssoRes.data && Array.isArray(ssoRes.data)) {
      const found = ssoRes.data.find(
        (k) => k.id === classIdOrSsoId || k.nama_kelas.toLowerCase() === classIdOrSsoId.toLowerCase()
      );
      if (found) {
        const [inserted] = await db
          .insert(classes)
          .values({
            id: found.id,
            name: found.nama_kelas,
            gradeLevel: String(found.tingkat ?? "X"),
            jurusan: found.jurusan ?? null,
            academicYear: "2024/2025",
            isActive: true,
          })
          .onConflictDoUpdate({
            target: classes.id,
            set: { name: found.nama_kelas, updatedAt: new Date() },
          })
          .returning();
        return inserted.id;
      }
    }
  } catch (e) {
    console.error("[ensureTargetClassExists] error:", e);
  }

  return classIdOrSsoId;
}

adminRoutes.post("/homeroom-assignments", async (c) => {
  try {
    const body = z
      .object({
        userId: z.string().uuid("Guru wajib dipilih"),
        classId: z.string().uuid("Kelas wajib dipilih"),
      })
      .parse(await c.req.json());

    const targetUserId = await ensureTargetUserExists(body.userId);
    const targetClassId = await ensureTargetClassExists(body.classId);

    // Check duplicate
    const [dup] = await db
      .select()
      .from(homeroomAssignments)
      .where(
        and(
          eq(homeroomAssignments.userId, targetUserId),
          eq(homeroomAssignments.classId, targetClassId)
        )
      )
      .limit(1);

    if (dup) {
      return c.json({ success: false, message: "Guru sudah ditugaskan sebagai wali kelas di kelas ini." }, 400);
    }

    const [row] = await db
      .insert(homeroomAssignments)
      .values({
        userId: targetUserId,
        classId: targetClassId,
      })
      .returning();

    broadcastRealtimeEvent({ type: "teacher_assigned" });
    return c.json({ success: true, data: row, message: "Penugasan wali kelas berhasil ditambahkan" }, 201);
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.delete("/homeroom-assignments/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [row] = await db.delete(homeroomAssignments).where(eq(homeroomAssignments.id, id)).returning();
    if (!row) {
      return c.json({ success: false, message: "Penugasan tidak ditemukan" }, 404);
    }
    broadcastRealtimeEvent({ type: "teacher_assigned" });
    return c.json({ success: true, data: row, message: "Penugasan wali kelas dihapus" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.get("/teaching-hours", async (c) => {
  try {
    const list = await db
      .select()
      .from(teachingHours)
      .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);
    return c.json({ success: true, data: list });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

adminRoutes.post("/teaching-hours", async (c) => {
  try {
    const body = z
      .object({
        label: z.string().min(1, "Label wajib diisi"), // e.g. "Jam ke-1"
        startTime: z.string().min(1, "Waktu mulai wajib diisi"), // e.g. "07:00"
        endTime: z.string().min(1, "Waktu selesai wajib diisi"), // e.g. "07:45"
      })
      .parse(await c.req.json());

    const [row] = await db
      .insert(teachingHours)
      .values({
        label: body.label,
        startTime: body.startTime,
        endTime: body.endTime,
      })
      .returning();

    return c.json({ success: true, data: row, message: "Jam mengajar berhasil ditambahkan" }, 201);
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.delete("/teaching-hours/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [row] = await db
      .delete(teachingHours)
      .where(eq(teachingHours.id, id))
      .returning();
    if (!row) {
      return c.json({ success: false, message: "Jam mengajar tidak ditemukan" }, 404);
    }
    return c.json({ success: true, data: row, message: "Jam mengajar berhasil dihapus" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.get("/journals/monitoring", async (c) => {
  const dateStr = c.req.query("date");
  const classId = c.req.query("classId");
  if (!dateStr || !classId) {
    return c.json({ success: false, message: "date dan classId wajib diisi" }, 400);
  }

  try {
    // 1. Ambil semua Jam Mengajar (pembagian jam pelajaran)
    const hours = await db
      .select()
      .from(teachingHours)
      .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);

    // 2. Ambil jurnal untuk tanggal & kelas tersebut, join dengan users untuk dapat nama guru
    const journals = await db
      .select({
        id: teacherJournals.id,
        date: teacherJournals.date,
        classId: teacherJournals.classId,
        className: teacherJournals.className,
        teachingHourId: teacherJournals.teachingHourId,
        teachingHourLabel: teacherJournals.teachingHourLabel,
        subjectId: teacherJournals.subjectId,
        subjectName: teacherJournals.subjectName,
        materi: teacherJournals.materi,
        presenceInfo: teacherJournals.presenceInfo,
        status: teacherJournals.status,
        teacherName: users.name,
      })
      .from(teacherJournals)
      .innerJoin(users, eq(teacherJournals.teacherUserId, users.id))
      .where(
        and(
          eq(teacherJournals.date, dateStr),
          eq(teacherJournals.classId, classId),
          isNull(teacherJournals.deletedAt)
        )
      );

    // Map jurnal berdasarkan jam mengajar id
    const journalMap = new Map(journals.map((j) => [j.teachingHourId, j]));

    // 3. Gabungkan: jam mengajar yang tidak terisi jurnalnya tetap dikembalikan sebagai row kosong (strip)
    const data = hours.map((h) => {
      const j = journalMap.get(h.id);
      return {
        teachingHourId: h.id,
        label: h.label,
        startTime: h.startTime,
        endTime: h.endTime,
        journalId: j?.id ?? null,
        teacherName: j?.teacherName ?? null,
        subjectName: j?.subjectName ?? null,
        materi: j?.materi ?? null,
        presenceInfo: j?.presenceInfo ?? null,
        status: j?.status ?? null,
      };
    });

    return c.json({ success: true, data });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

adminRoutes.post("/journals/koreksi-ulang", async (c) => {
  try {
    const body = z.object({ journalId: z.string().uuid("journalId wajib diisi") }).parse(await c.req.json());
    
    const [row] = await db
      .update(teacherJournals)
      .set({
        status: "draft",
        updatedAt: new Date(),
      })
      .where(eq(teacherJournals.id, body.journalId))
      .returning();

    if (!row) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan" }, 404);
    }

    return c.json({ success: true, data: row, message: "Status jurnal berhasil dikembalikan menjadi Draft!" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.patch("/journals/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = z
      .object({
        materi: z.string().min(1, "Materi wajib diisi"),
        presenceInfo: z.string().default(""),
      })
      .parse(await c.req.json());

    const [row] = await db
      .update(teacherJournals)
      .set({
        materi: body.materi,
        presenceInfo: body.presenceInfo,
        updatedAt: new Date(),
      })
      .where(eq(teacherJournals.id, id))
      .returning();

    if (!row) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan" }, 404);
    }

    return c.json({ success: true, data: row, message: "Jurnal berhasil diperbarui oleh admin" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});



const importSchema = z.object({
  type: z.enum(["students", "teachers"]),
  filename: z.string().default("upload.csv"),
  rows: z.array(z.record(z.string())),
});

adminRoutes.post("/import", async (c) => {
  const body = importSchema.parse(await c.req.json());
  const user = c.get("user");
  let successRows = 0;
  const errors: Array<{ row: number; message: string }> = [];

  if (body.type === "students") {
    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      try {
        const name = row.name || row.nama;
        if (!name) throw new Error("name required");
        await db.insert(students).values({
          name,
          nis: row.nis || null,
          nisn: row.nisn || null,
          gender: row.gender || null,
        });
        successRows += 1;
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : "error" });
      }
    }
  } else {
    for (let i = 0; i < body.rows.length; i++) {
      const row = body.rows[i];
      try {
        const name = row.name || row.nama;
        if (!name) throw new Error("name required");
        await db.insert(teachers).values({
          name,
          nip: row.nip || null,
        });
        successRows += 1;
      } catch (e) {
        errors.push({ row: i + 1, message: e instanceof Error ? e.message : "error" });
      }
    }
  }

  const [job] = await db
    .insert(importJobs)
    .values({
      type: body.type,
      filename: body.filename,
      status: errors.length ? "partial" : "success",
      totalRows: body.rows.length,
      successRows,
      errorRows: errors.length,
      errors,
      createdBy: user.id,
    })
    .returning();

  broadcastRealtimeEvent({ type: "student_updated", source: body.type });
  return c.json({ success: true, data: job });
});

/** Katalog integrasi: Kredensia + GDS + Kehadiran (tanpa tumpang tindih) */
adminRoutes.get("/integrations", async (c) => {
  const recentSync = await db
    .select()
    .from(externalSyncLogs)
    .orderBy(desc(externalSyncLogs.createdAt))
    .limit(10);

  const catalog = INTEGRATIONS.map((def) => {
    if (def.code === "gds") return { ...def, runtime: gdsStatus() };
    if (def.code === "kehadiran") return { ...def, runtime: kehadiranStatus() };
    if (def.code === "kredensia") {
      return {
        ...def,
        runtime: {
          code: "kredensia",
          status: isSsoConfigured() ? "live" : "misconfigured",
          configured: isSsoConfigured(),
          message: isSsoConfigured()
            ? "SSO IdP terhubung (login/identitas)."
            : "Isi SSO_* di .env",
        },
      };
    }
    return def;
  });

  return c.json({
    success: true,
    data: {
      catalog,
      recentSync,
      note: "GDS & Kehadiran = app terpisah (coming soon). Kredensia = identitas saja.",
    },
  });
});

/** DELETE: Bersihkan semua log sinkronisasi */
adminRoutes.delete("/sync-logs", async (c) => {
  await db.execute(sql`TRUNCATE TABLE external_sync_logs RESTART IDENTITY CASCADE`);
  return c.json({ success: true, message: "Semua log sinkronisasi berhasil dihapus." });
});

adminRoutes.post("/integrations/gds/sync", async (c) => {
  const result = await syncGds();
  if (result.ok) broadcastRealtimeEvent({ type: "sync_completed", source: "gds" });
  return c.json(
    { success: result.ok, data: result, message: result.message },
    result.status === "coming_soon" ? 202 : result.ok ? 200 : 502,
  );
});

adminRoutes.post("/integrations/kehadiran/sync", async (c) => {
  const result = await syncKehadiran();
  if (result.ok) broadcastRealtimeEvent({ type: "sync_completed", source: "kehadiran" });
  return c.json(
    { success: result.ok, data: result, message: result.message },
    result.status === "coming_soon" ? 202 : result.ok ? 200 : 502,
  );
});

/** GET: Baca konfigurasi SSO (expose via /integrations/sso-config agar konsisten) */
adminRoutes.get("/integrations/sso-config", (c) => {
  const rawKey = env.SSO_API_KEY || "";
  const ssoApiKeyMasked = rawKey
    ? rawKey.length > 8
      ? rawKey.slice(0, 4) + "****" + rawKey.slice(-4)
      : "****"
    : null;
  return c.json({
    success: true,
    data: {
      loginConfigured: isSsoConfigured(),
      apiKeyConfigured: Boolean(env.SSO_API_KEY),
      ssoApiKey: ssoApiKeyMasked,
      baseUrl: env.SSO_BASE_URL || null,
      clientId: env.SSO_CLIENT_ID || null,
      redirectUri: env.SSO_REDIRECT_URI || null,
      apiBaseUrl: env.SSO_API_BASE_URL || null,
    },
  });
});

/** PUT: Simpan konfigurasi SSO ke .env dan restart akan load nilai baru */
adminRoutes.put("/integrations/sso-config", async (c) => {
  const body = z
    .object({
      baseUrl: z.string().url("URL SSO harus URL valid"),
      clientId: z.string().min(1, "Client ID wajib diisi"),
      clientSecret: z.string().optional(),
      apiKey: z.string().optional(),
      apiBaseUrl: z.string().optional(),
    })
    .parse(await c.req.json());

  const envPath = new URL("../../../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const fs = await import("fs/promises");

  let content = "";
  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch {
    content = "";
  }

  const setEnvLine = (text: string, key: string, value: string): string => {
    const regex = new RegExp(`^(${key}=).*$`, "m");
    if (regex.test(text)) return text.replace(regex, `$1${value}`);
    return text + `\n${key}=${value}`;
  };

  const cleanBaseUrl = cleanUrlProtocol(body.baseUrl);
  content = setEnvLine(content, "SSO_BASE_URL", cleanBaseUrl);
  process.env.SSO_BASE_URL = cleanBaseUrl;

  content = setEnvLine(content, "SSO_CLIENT_ID", body.clientId);
  process.env.SSO_CLIENT_ID = body.clientId;
  process.env.SSO_APP_ID = body.clientId;

  const appOrigin = getSsoRequestOrigin();
  const redirectUri = `${appOrigin}/auth/callback`;
  content = setEnvLine(content, "SSO_REDIRECT_URI", redirectUri);
  process.env.SSO_REDIRECT_URI = redirectUri;

  const isMasked = (s?: string) => !s || s.includes("•") || s.includes("****");

  if (body.clientSecret && body.clientSecret.trim() && !isMasked(body.clientSecret)) {
    content = setEnvLine(content, "SSO_CLIENT_SECRET", body.clientSecret.trim());
    process.env.SSO_CLIENT_SECRET = body.clientSecret.trim();
  }
  if (body.apiKey && body.apiKey.trim() && !isMasked(body.apiKey)) {
    content = setEnvLine(content, "SSO_API_KEY", body.apiKey.trim());
    process.env.SSO_API_KEY = body.apiKey.trim();
  }
  let apiBase = (body.apiBaseUrl && body.apiBaseUrl.trim()) ? cleanUrlProtocol(body.apiBaseUrl) : "";
  if (!apiBase || (cleanBaseUrl.includes("localhost") && !apiBase.includes("localhost"))) {
    apiBase = `${cleanBaseUrl}/api/v1`;
  }
  content = setEnvLine(content, "SSO_API_BASE_URL", apiBase);
  process.env.SSO_API_BASE_URL = apiBase;

  await fs.writeFile(envPath, content, "utf-8");

  return c.json({
    success: true,
    message:
      "Konfigurasi SSO berhasil disimpan ke .env. Restart server agar perubahan aktif.",
    data: {
      baseUrl: body.baseUrl,
      clientId: body.clientId,
      secretUpdated: Boolean(body.clientSecret?.trim()),
      apiKeyUpdated: Boolean(body.apiKey?.trim()),
      apiBaseUrlUpdated: Boolean(body.apiBaseUrl?.trim()),
    },
  });
});

/** GET: Baca konfigurasi Google OAuth */
adminRoutes.get("/integrations/google-config", (c) => {
  return c.json({
    success: true,
    data: {
      configured: isGoogleConfigured(),
      clientId: getGoogleClientId() || null,
      hasSecret: Boolean(getGoogleClientSecret()),
    },
  });
});

/** PUT: Simpan konfigurasi Google OAuth ke .env */
adminRoutes.put("/integrations/google-config", async (c) => {
  const body = z
    .object({
      clientId: z.string().min(1, "Google Client ID wajib diisi"),
      clientSecret: z.string().optional(),
    })
    .parse(await c.req.json());

  const envPath = new URL("../../../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const fs = await import("fs/promises");

  let content = "";
  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch {
    content = "";
  }

  const setEnvLine = (text: string, key: string, value: string): string => {
    const regex = new RegExp(`^(${key}=).*$`, "m");
    if (regex.test(text)) return text.replace(regex, `$1${value}`);
    return text + `\n${key}=${value}`;
  };

  const isMasked = (s?: string) => !s || s.includes("•") || s.includes("****");

  content = setEnvLine(content, "GOOGLE_CLIENT_ID", body.clientId.trim());
  process.env.GOOGLE_CLIENT_ID = body.clientId.trim();

  if (body.clientSecret && body.clientSecret.trim() && !isMasked(body.clientSecret)) {
    content = setEnvLine(content, "GOOGLE_CLIENT_SECRET", body.clientSecret.trim());
    process.env.GOOGLE_CLIENT_SECRET = body.clientSecret.trim();
  }

  await fs.writeFile(envPath, content, "utf-8");

  return c.json({
    success: true,
    message: "Konfigurasi Google OAuth berhasil disimpan.",
    data: {
      clientId: body.clientId,
      secretUpdated: Boolean(body.clientSecret?.trim()),
    },
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ─── SSO PROVIDERS MANAGEMENT (Enterprise & Open Source Tables) ───────────────
// ─────────────────────────────────────────────────────────────────────────────

type SsoProviderStored = {
  id: string;
  category: "enterprise" | "opensource";
  name: string;
  shortName: string;
  description: string;
  protocol: string;
  icon: string;
  baseUrl?: string | null;
  clientId?: string | null;
  clientSecret?: string | null;
  apiKey?: string | null;
  apiBaseUrl?: string | null;
  tenantId?: string | null;
  discoveryUrl?: string | null;
  bindDn?: string | null;
  scopes?: string | null;
  isActive?: boolean;
  isCustom?: boolean;
  lastTestedAt?: string | null;
  lastSyncAt?: string | null;
};

async function getStoredSsoProviders(): Promise<Record<string, SsoProviderStored>> {
  try {
    const [row] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, "sso_providers_config"))
      .limit(1);
    if (!row?.value) return {};
    return JSON.parse(row.value);
  } catch {
    return {};
  }
}

async function saveStoredSsoProviders(data: Record<string, SsoProviderStored>) {
  await db
    .insert(systemSettings)
    .values({
      key: "sso_providers_config",
      value: JSON.stringify(data),
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: systemSettings.key,
      set: {
        value: JSON.stringify(data),
        updatedAt: new Date(),
      },
    });
}

/** GET: Daftar semua provider SSO (Enterprise & Open Source) */
adminRoutes.get("/integrations/sso-providers", async (c) => {
  const origin = getSsoRequestOrigin();
  const stored = await getStoredSsoProviders();

  // 1. Enterprise Standard Providers
  const enterpriseDefaults: SsoProviderStored[] = [
    {
      id: "google",
      category: "enterprise",
      name: "Google Workspace (OAuth 2.0)",
      shortName: "Google",
      description: "Otentikasi Akun Google Siswa, Guru, & Staf (@sekolah.sch.id atau publik)",
      protocol: "OAuth 2.0 / OIDC",
      icon: "google",
      clientId: getGoogleClientId() || null,
      isActive: isGoogleConfigured(),
    },
    {
      id: "microsoft",
      category: "enterprise",
      name: "Microsoft 365 & Azure AD (Entra ID)",
      shortName: "Microsoft",
      description: "Single Sign-On akun Microsoft Education / Office 365 organisasi",
      protocol: "OIDC / OAuth 2.0",
      icon: "microsoft",
      isActive: false,
    },
    {
      id: "apple",
      category: "enterprise",
      name: "Apple Sign-In (Apple ID)",
      shortName: "Apple",
      description: "Masuk aman menggunakan ID Apple untuk perangkat iOS / macOS / Web",
      protocol: "OAuth 2.0 / OIDC",
      icon: "apple",
      isActive: false,
    },
    {
      id: "saml_okta",
      category: "enterprise",
      name: "Okta / Auth0 / SAML 2.0 Enterprise",
      shortName: "SAML 2.0 / Okta",
      description: "Federasi identitas standar SAML 2.0 Enterprise IdP (Okta, Auth0, PingIdentity)",
      protocol: "SAML 2.0 / OIDC",
      icon: "security",
      isActive: false,
    },
    {
      id: "github",
      category: "enterprise",
      name: "GitHub / GitLab Enterprise",
      shortName: "GitHub",
      description: "Otentikasi pengembang & staf IT via akun GitHub atau GitLab",
      protocol: "OAuth 2.0",
      icon: "code",
      isActive: false,
    },
  ];

  // 2. Open Source & Self-Hosted Providers
  const openSourceDefaults: SsoProviderStored[] = [
    {
      id: "kredensia",
      category: "opensource",
      name: "Kredensia SSO (SINTESA SSO Sekolah)",
      shortName: "Kredensia",
      description: "Portal SSO Sekolah & Manajemen Identitas Terpusat dengan Sinkronisasi Rombel/Tahun Pelajaran",
      protocol: "OAuth 2.0 + REST API",
      icon: "lock_person",
      baseUrl: env.SSO_BASE_URL || null,
      clientId: env.SSO_CLIENT_ID || null,
      apiBaseUrl: env.SSO_API_BASE_URL || null,
      isActive: isSsoConfigured(),
    },
    {
      id: "keycloak",
      category: "opensource",
      name: "Keycloak Identity & Access Management (Red Hat)",
      shortName: "Keycloak",
      description: "Open Source IAM Server standar industri untuk manajemen akses dan realm otentikasi",
      protocol: "OpenID Connect (OIDC) / SAML 2.0",
      icon: "vpn_key",
      isActive: false,
    },
    {
      id: "authentik",
      category: "opensource",
      name: "Authentik Self-Hosted IdP",
      shortName: "Authentik",
      description: "Penyedia identitas modern open-source yang fleksibel untuk integrasi aplikasi internal",
      protocol: "OIDC / OAuth 2.0",
      icon: "shield",
      isActive: false,
    },
    {
      id: "authelia",
      category: "opensource",
      name: "Authelia Single Sign-On & 2FA",
      shortName: "Authelia",
      description: "Portal otentikasi ringan dan proxy forward auth open-source",
      protocol: "OIDC (OpenID Connect)",
      icon: "verified_user",
      isActive: false,
    },
    {
      id: "casdoor",
      category: "opensource",
      name: "Casdoor UI-First IAM Platform",
      shortName: "Casdoor",
      description: "Platform IAM open-source berbasis web dengan dukungan multi-tenant dan UI modern",
      protocol: "OAuth 2.0 / OIDC / SAML",
      icon: "door_front",
      isActive: false,
    },
    {
      id: "ldap",
      category: "opensource",
      name: "OpenLDAP / FreeIPA / Samba Active Directory",
      shortName: "LDAP / FreeIPA",
      description: "Direktori identitas pengguna berbasis protokol LDAP untuk jaringan lokal sekolah",
      protocol: "LDAP / LDAPS Protocol",
      icon: "folder_shared",
      isActive: false,
    },
    {
      id: "generic_oidc",
      category: "opensource",
      name: "Custom Generic OIDC (OpenID Connect)",
      shortName: "Generic OIDC",
      description: "Integrasikan server OpenID Connect kustom apapun melalui Discovery Endpoint",
      protocol: "OpenID Connect (OIDC)",
      icon: "extension",
      isActive: false,
    },
  ];

  // Callback URL mapping
  const getRedirectUri = (id: string) => {
    if (id === "kredensia") return `${origin}/auth/callback`;
    if (id === "google") return `${origin}/auth/google/callback`;
    return `${origin}/auth/${id}/callback`;
  };

  const mapItem = (def: SsoProviderStored) => {
    const s = stored[def.id] || {};
    const merged = { ...def, ...s };
    
    // Live env overrides for live active services
    if (def.id === "google") {
      merged.clientId = getGoogleClientId() || merged.clientId || null;
      merged.isActive = s.isActive ?? isGoogleConfigured();
    }
    if (def.id === "kredensia") {
      merged.baseUrl = env.SSO_BASE_URL || merged.baseUrl || null;
      merged.clientId = env.SSO_CLIENT_ID || merged.clientId || null;
      merged.apiBaseUrl = env.SSO_API_BASE_URL || merged.apiBaseUrl || null;
      merged.isActive = s.isActive ?? isSsoConfigured();
    }

    const isConfigured = def.id === "kredensia"
      ? isSsoConfigured()
      : def.id === "google"
      ? isGoogleConfigured()
      : Boolean(merged.clientId || merged.baseUrl || merged.bindDn);

    return {
      ...merged,
      redirectUri: getRedirectUri(def.id),
      isConfigured,
      hasSecret: Boolean(merged.clientSecret || (def.id === "google" && getGoogleClientSecret())),
      hasApiKey: Boolean(merged.apiKey || (def.id === "kredensia" && env.SSO_API_KEY)),
      clientSecret: undefined, // never leak secret in GET list
      apiKey: undefined, // never leak api key in GET list
    };
  };

  const enterpriseList = enterpriseDefaults.map(mapItem);
  const openSourceList = openSourceDefaults.map(mapItem);

  // Append any custom added providers from stored
  for (const [key, val] of Object.entries(stored)) {
    if (!enterpriseDefaults.some(d => d.id === key) && !openSourceDefaults.some(d => d.id === key)) {
      const item = {
        ...val,
        redirectUri: getRedirectUri(val.id),
        isConfigured: Boolean(val.clientId || val.baseUrl),
        hasSecret: Boolean(val.clientSecret),
        hasApiKey: Boolean(val.apiKey),
        clientSecret: undefined,
        apiKey: undefined,
      };
      if (val.category === "enterprise") {
        enterpriseList.push(item);
      } else {
        openSourceList.push(item);
      }
    }
  }

  return c.json({
    success: true,
    data: {
      enterprise: enterpriseList,
      opensource: openSourceList,
    },
  });
});

/** PUT: Simpan / Update konfigurasi provider SSO */
adminRoutes.put("/integrations/sso-providers/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const stored = await getStoredSsoProviders();

  // If google, sync to .env as well
  if (id === "google" && body.clientId) {
    const envPath = new URL("../../../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
    const fs = await import("fs/promises");
    let content = "";
    try {
      content = await fs.readFile(envPath, "utf-8");
    } catch {}
    const setEnvLine = (text: string, key: string, value: string): string => {
      const regex = new RegExp(`^(${key}=).*$`, "m");
      if (regex.test(text)) return text.replace(regex, `$1${value}`);
      return text + `\n${key}=${value}`;
    };
    content = setEnvLine(content, "GOOGLE_CLIENT_ID", String(body.clientId).trim());
    process.env.GOOGLE_CLIENT_ID = String(body.clientId).trim();
    if (body.clientSecret && String(body.clientSecret).trim() && !String(body.clientSecret).includes("•")) {
      content = setEnvLine(content, "GOOGLE_CLIENT_SECRET", String(body.clientSecret).trim());
      process.env.GOOGLE_CLIENT_SECRET = String(body.clientSecret).trim();
    }
    await fs.writeFile(envPath, content, "utf-8");
  }

  // If kredensia, sync to .env as well
  if (id === "kredensia" && body.baseUrl && body.clientId) {
    const envPath = new URL("../../../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
    const fs = await import("fs/promises");
    let content = "";
    try {
      content = await fs.readFile(envPath, "utf-8");
    } catch {}
    const setEnvLine = (text: string, key: string, value: string): string => {
      const regex = new RegExp(`^(${key}=).*$`, "m");
      if (regex.test(text)) return text.replace(regex, `$1${value}`);
      return text + `\n${key}=${value}`;
    };
    const cleanBaseUrl = cleanUrlProtocol(String(body.baseUrl).trim());
    content = setEnvLine(content, "SSO_BASE_URL", cleanBaseUrl);
    process.env.SSO_BASE_URL = cleanBaseUrl;
    content = setEnvLine(content, "SSO_CLIENT_ID", String(body.clientId).trim());
    process.env.SSO_CLIENT_ID = String(body.clientId).trim();
    process.env.SSO_APP_ID = String(body.clientId).trim();

    if (body.clientSecret && String(body.clientSecret).trim() && !String(body.clientSecret).includes("•")) {
      content = setEnvLine(content, "SSO_CLIENT_SECRET", String(body.clientSecret).trim());
      process.env.SSO_CLIENT_SECRET = String(body.clientSecret).trim();
    }
    if (body.apiKey && String(body.apiKey).trim() && !String(body.apiKey).includes("•")) {
      content = setEnvLine(content, "SSO_API_KEY", String(body.apiKey).trim());
      process.env.SSO_API_KEY = String(body.apiKey).trim();
    }
    let apiBase = body.apiBaseUrl ? cleanUrlProtocol(String(body.apiBaseUrl).trim()) : `${cleanBaseUrl}/api/v1`;
    content = setEnvLine(content, "SSO_API_BASE_URL", apiBase);
    process.env.SSO_API_BASE_URL = apiBase;
    await fs.writeFile(envPath, content, "utf-8");
  }

  const existing = stored[id] || { id, category: body.category || "opensource" };
  const updated: SsoProviderStored = {
    ...existing,
    ...body,
    id,
    isActive: body.isActive !== undefined ? Boolean(body.isActive) : true,
    lastTestedAt: new Date().toISOString(),
  };

  // Keep existing secrets if incoming is masked or empty
  if (!body.clientSecret || String(body.clientSecret).includes("•")) {
    updated.clientSecret = existing.clientSecret;
  }
  if (!body.apiKey || String(body.apiKey).includes("•")) {
    updated.apiKey = existing.apiKey;
  }

  stored[id] = updated;
  await saveStoredSsoProviders(stored);

  return c.json({
    success: true,
    message: `Konfigurasi SSO ${updated.shortName || id} berhasil disimpan!`,
    data: {
      id,
      isConfigured: true,
      isActive: updated.isActive,
    },
  });
});

/** POST: Toggle aktif / nonaktif SSO Provider */
adminRoutes.post("/integrations/sso-providers/:id/toggle", async (c) => {
  const id = c.req.param("id");
  const stored = await getStoredSsoProviders();
  const existing = stored[id] || { id, category: "enterprise", isActive: false };
  const newActive = !existing.isActive;
  stored[id] = { ...existing, id, isActive: newActive };
  await saveStoredSsoProviders(stored);

  return c.json({
    success: true,
    message: `Status provider ${existing.name || id} diubah menjadi ${newActive ? "AKTIF" : "NONAKTIF"}`,
    data: { id, isActive: newActive },
  });
});

/** DELETE: Reset / Hapus SSO Provider */
adminRoutes.delete("/integrations/sso-providers/:id", async (c) => {
  const id = c.req.param("id");
  const stored = await getStoredSsoProviders();
  if (stored[id]) {
    delete stored[id];
    await saveStoredSsoProviders(stored);
  }
  return c.json({
    success: true,
    message: `Konfigurasi provider ${id} berhasil direset.`,
  });
});

/** POST: Tambah SSO Provider Baru (Custom) */
adminRoutes.post("/integrations/sso-providers", async (c) => {
  const body = await c.req.json().catch(() => ({}));
  if (!body.name || !body.category) {
    return c.json({ success: false, message: "Nama provider dan kategori wajib diisi" }, 400);
  }

  const id = (body.id || `custom_${Date.now()}`).toLowerCase().replace(/[^a-z0-9_]/g, "");
  const stored = await getStoredSsoProviders();

  const newProvider: SsoProviderStored = {
    id,
    category: body.category === "enterprise" ? "enterprise" : "opensource",
    name: body.name,
    shortName: body.shortName || body.name,
    description: body.description || `Integrasi SSO ${body.name}`,
    protocol: body.protocol || "OAuth 2.0 / OIDC",
    icon: body.icon || "hub",
    baseUrl: body.baseUrl || null,
    clientId: body.clientId || null,
    clientSecret: body.clientSecret || null,
    apiKey: body.apiKey || null,
    apiBaseUrl: body.apiBaseUrl || null,
    tenantId: body.tenantId || null,
    discoveryUrl: body.discoveryUrl || null,
    bindDn: body.bindDn || null,
    scopes: body.scopes || "openid email profile",
    isActive: true,
    isCustom: true,
    lastTestedAt: new Date().toISOString(),
  };

  stored[id] = newProvider;
  await saveStoredSsoProviders(stored);

  return c.json({
    success: true,
    message: `Integrasi SSO baru "${newProvider.name}" berhasil ditambahkan!`,
    data: newProvider,
  });
});


/** PUT: Simpan konfigurasi GDS ke .env */
adminRoutes.put("/integrations/gds-config", async (c) => {
  const body = z
    .object({
      baseUrl: z.string().url("URL GDS harus URL valid"),
      apiKey: z.string().optional(),
    })
    .parse(await c.req.json());

  const envPath = new URL("../../../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const fs = await import("fs/promises");

  let content = "";
  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch {
    content = "";
  }

  const setEnvLine = (text: string, key: string, value: string): string => {
    const regex = new RegExp(`^(${key}=).*$`, "m");
    if (regex.test(text)) return text.replace(regex, `$1${value}`);
    return text + `\n${key}=${value}`;
  };

  content = setEnvLine(content, "GDS_BASE_URL", body.baseUrl);
  process.env.GDS_BASE_URL = body.baseUrl;
  content = setEnvLine(content, "KEHADIRAN_BASE_URL", body.baseUrl);
  process.env.KEHADIRAN_BASE_URL = body.baseUrl;

  if (body.apiKey && body.apiKey.trim()) {
    const key = body.apiKey.trim();
    content = setEnvLine(content, "GDS_API_KEY", key);
    process.env.GDS_API_KEY = key;
    content = setEnvLine(content, "KEHADIRAN_API_KEY", key);
    process.env.KEHADIRAN_API_KEY = key;
  }

  await fs.writeFile(envPath, content, "utf-8");

  return c.json({
    success: true,
    message: "Konfigurasi GDS & Kehadiran berhasil disimpan secara bersatu ke .env.",
  });
});

/** PUT: Simpan konfigurasi Kehadiran ke .env */
adminRoutes.put("/integrations/kehadiran-config", async (c) => {
  const body = z
    .object({
      baseUrl: z.string().url("URL Kehadiran harus URL valid"),
      apiKey: z.string().optional(),
    })
    .parse(await c.req.json());

  const envPath = new URL("../../../.env", import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1");
  const fs = await import("fs/promises");

  let content = "";
  try {
    content = await fs.readFile(envPath, "utf-8");
  } catch {
    content = "";
  }

  const setEnvLine = (text: string, key: string, value: string): string => {
    const regex = new RegExp(`^(${key}=).*$`, "m");
    if (regex.test(text)) return text.replace(regex, `$1${value}`);
    return text + `\n${key}=${value}`;
  };

  content = setEnvLine(content, "KEHADIRAN_BASE_URL", body.baseUrl);
  process.env.KEHADIRAN_BASE_URL = body.baseUrl;
  content = setEnvLine(content, "GDS_BASE_URL", body.baseUrl);
  process.env.GDS_BASE_URL = body.baseUrl;

  if (body.apiKey && body.apiKey.trim()) {
    const key = body.apiKey.trim();
    content = setEnvLine(content, "KEHADIRAN_API_KEY", key);
    process.env.KEHADIRAN_API_KEY = key;
    content = setEnvLine(content, "GDS_API_KEY", key);
    process.env.GDS_API_KEY = key;
  }

  await fs.writeFile(envPath, content, "utf-8");

  return c.json({
    success: true,
    message: "Konfigurasi Kehadiran berhasil disimpan ke .env.",
  });
});

/** API Keys Management for third parties */
adminRoutes.get("/api-keys", async (c) => {
  const keys = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
  return c.json({ success: true, data: keys });
});

adminRoutes.post("/api-keys", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const namaAplikasi = body.namaAplikasi || "Client App";
    const domainPrefix = body.domainPrefix || "*";
    const customPrefix = (body.customPrefix || "data").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "data";
    
    // Generate key
    const randomHex = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    const keyString = `${customPrefix}_${randomHex}`;
    
    const [inserted] = await db.insert(apiKeys).values({
      namaAplikasi,
      domainPrefix,
      customPrefix,
      apiKey: keyString,
      isActive: true,
    }).returning();
    
    return c.json({ success: true, data: inserted, message: "Kunci API berhasil dibuat!" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Gagal membuat kunci API" }, 500);
  }
});

adminRoutes.post("/api-keys/:id/toggle", async (c) => {
  try {
    const id = c.req.param("id");
    const [key] = await db.select().from(apiKeys).where(eq(apiKeys.id, id)).limit(1);
    if (!key) {
      return c.json({ success: false, message: "Kunci API tidak ditemukan" }, 404);
    }
    
    const [updated] = await db.update(apiKeys)
      .set({ isActive: !key.isActive, updatedAt: new Date() })
      .where(eq(apiKeys.id, id))
      .returning();
      
    return c.json({ success: true, data: updated, message: "Status kunci API berhasil diubah!" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Gagal mengubah status" }, 500);
  }
});

adminRoutes.delete("/api-keys/:id", async (c) => {
  try {
    const id = c.req.param("id");
    const [deleted] = await db.delete(apiKeys).where(eq(apiKeys.id, id)).returning();
    if (!deleted) {
      return c.json({ success: false, message: "Kunci API tidak ditemukan" }, 404);
    }
    return c.json({ success: true, message: "Kunci API berhasil dihapus!" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Gagal menghapus" }, 500);
  }
});

/** Legacy aliases — gds | kehadiran | bk (bk → kehadiran) */
adminRoutes.post("/sync/:source", async (c) => {
  const source = c.req.param("source");
  if (source === "gds") {
    const result = await syncGds();
    if (result.ok) broadcastRealtimeEvent({ type: "sync_completed", source: "gds" });
    return c.json(
      { success: result.ok, data: result.log ?? result, message: result.message },
      result.status === "coming_soon" ? 202 : result.ok ? 200 : 502,
    );
  }
  if (source === "kehadiran" || source === "bk") {
    const result = await syncKehadiran();
    if (result.ok) broadcastRealtimeEvent({ type: "sync_completed", source: "kehadiran" });
    return c.json(
      { success: result.ok, data: result.log ?? result, message: result.message },
      result.status === "coming_soon" ? 202 : result.ok ? 200 : 502,
    );
  }
  return c.json(
    {
      success: false,
      message: "Sumber tidak dikenal. Gunakan gds | kehadiran (bk = alias kehadiran).",
    },
    400,
  );
});

adminRoutes.get("/users", async (c) => {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      username: users.username,
      isActive: users.isActive,
      lastLoginAt: users.lastLoginAt,
    })
    .from(users)
    .orderBy(users.name);
  return c.json({ success: true, data: rows });
});

// ---------------------------------------------------------------------------
// Tahun pelajaran + alumni + mutasi (ScholarGate lifecycle)
// ---------------------------------------------------------------------------

adminRoutes.get("/lifecycle/summary", async (c) => {
  const data = await lifecycle.getAcademicLifecycleSummary();
  return c.json({ success: true, data });
});

adminRoutes.get("/academic-years", async (c) => {
  const rows = await lifecycle.listAcademicYears();
  const active = await lifecycle.getActiveAcademicYear();
  const pendingAlumni = active ? await lifecycle.countPendingAlumni(active.id) : 0;
  return c.json({ success: true, data: { years: rows, active, pendingAlumni } });
});

adminRoutes.post("/academic-years", async (c) => {
  const body = z.object({ name: z.string().min(1) }).parse(await c.req.json());
  try {
    const year = await lifecycle.createAcademicYear(body.name);
    return c.json({ success: true, data: year }, 201);
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/academic-years/:id/activate", async (c) => {
  try {
    const data = await lifecycle.activateAcademicYear(c.req.param("id"));
    return c.json({
      success: true,
      data,
      message:
        data.pendingAlumni > 0
          ? `Tahun diaktifkan. Ada ${data.pendingAlumni} siswa XII siap dipindah ke Alumni.`
          : "Tahun pelajaran berhasil diaktifkan.",
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.delete("/academic-years/:id", async (c) => {
  try {
    await lifecycle.deleteAcademicYear(c.req.param("id"));
    return c.json({ success: true, message: "Tahun pelajaran dihapus" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/academic-years/bulk-assign-active", async (c) => {
  try {
    const data = await lifecycle.bulkAssignActiveYear();
    return c.json({
      success: true,
      data,
      message: `Bulk update: ${data.studentsUpdated} siswa + ${data.teachersUpdated} guru/tendik → ${data.year.name}`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/academic-years/advance-grades", async (c) => {
  try {
    const data = await lifecycle.advanceActiveStudentsToNextGrade();
    return c.json({
      success: true,
      data,
      message: `Naik kelas: ${data.advanced} siswa. XII menunggu alumni: ${data.needAlumni}. Dilewati: ${data.skipped}.`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

// Alumni
adminRoutes.get("/alumni", async (c) => {
  const rows = await db
    .select()
    .from(students)
    .where(eq(students.memberStatus, "alumni"))
    .orderBy(students.name);
  const pending = await lifecycle.listPendingAlumni();
  const years = await lifecycle.listAcademicYears();
  return c.json({ success: true, data: { alumni: rows, pending, years } });
});

adminRoutes.get("/alumni/pending", async (c) => {
  const pending = await lifecycle.listPendingAlumni();
  return c.json({ success: true, data: pending });
});

adminRoutes.post("/alumni/migrate", async (c) => {
  try {
    const data = await lifecycle.migratePendingToAlumni();
    return c.json({
      success: true,
      data,
      message: `Berhasil memindahkan ${data.count} siswa kelas XII ke status Alumni.`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/alumni/:studentId/promote", async (c) => {
  try {
    const body = z.object({ note: z.string().optional() }).parse((await c.req.json().catch(() => ({}))) ?? {});
    const row = await lifecycle.promoteStudentToAlumni(c.req.param("studentId"), body.note);
    return c.json({ success: true, data: row, message: "Siswa dijadikan alumni" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/alumni/purge", async (c) => {
  try {
    const body = z.object({ yearId: z.string().uuid() }).parse(await c.req.json());
    const data = await lifecycle.purgeAlumniByYear(body.yearId);
    return c.json({
      success: true,
      data,
      message: `Dihapus permanen ${data.count} alumni (tahun lulus: ${data.year.name}).`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

// Keluar / mutasi
adminRoutes.get("/keluar", async (c) => {
  const keluarList = await db
    .select()
    .from(students)
    .where(eq(students.memberStatus, "keluar"))
    .orderBy(students.name);
  const siswaList = await db
    .select({
      id: students.id,
      name: students.name,
      nis: students.nis,
      nisn: students.nisn,
      className: classes.name,
    })
    .from(students)
    .leftJoin(classes, eq(students.classId, classes.id))
    .where(eq(students.memberStatus, "siswa"))
    .orderBy(students.name);
  return c.json({ success: true, data: { keluar: keluarList, siswaOptions: siswaList } });
});

adminRoutes.post("/keluar", async (c) => {
  try {
    const body = z
      .object({ studentId: z.string().uuid(), note: z.string().optional() })
      .parse(await c.req.json());
    const row = await lifecycle.markStudentKeluar(body.studentId, body.note);
    return c.json({
      success: true,
      data: row,
      message: `Siswa dipindah ke status Keluar: ${row.name}`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/keluar/:studentId/restore", async (c) => {
  try {
    const body = z
      .object({ classId: z.string().uuid().optional(), note: z.string().optional() })
      .parse((await c.req.json().catch(() => ({}))) ?? {});
    const row = await lifecycle.restoreStudentFromKeluar(c.req.param("studentId"), body);
    return c.json({
      success: true,
      data: row,
      message: `Status dikembalikan ke siswa: ${row.name}`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.post("/keluar/purge", async (c) => {
  try {
    const data = await lifecycle.purgeAllKeluar();
    return c.json({
      success: true,
      data,
      message: `Dihapus permanen ${data.count} data siswa keluar.`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

// ---------------------------------------------------------------------------
// Kredensia IdP integration (api.md — X-API-Key REST + sync)
// ---------------------------------------------------------------------------

adminRoutes.get("/sso/config", (c) => {
  return c.json({
    success: true,
    data: {
      loginConfigured: isSsoConfigured(),
      apiKeyConfigured: Boolean(env.SSO_API_KEY),
      baseUrl: env.SSO_BASE_URL,
      clientId: ssoClientId || null,
      redirectUri: env.SSO_REDIRECT_URI,
      apiBaseUrl: ssoApiBaseUrl,
    },
  });
});

adminRoutes.get("/sso/test", async (c) => {
  try {
    const result = await ssoTestConnection();
    return c.json({ success: true, data: result.data, meta: result.meta });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 502);
  }
});

adminRoutes.get("/sso/members", async (c) => {
  const roleParam = c.req.query("role");
  const searchParam = c.req.query("search")?.trim().toLowerCase();
  const page = Number(c.req.query("page") || 1);
  const perPage = Number(c.req.query("per_page") || 50);

  let ssoResult: { data: any[]; meta?: any } | null = null;

  if (env.SSO_API_KEY && env.SSO_API_BASE_URL) {
    try {
      const res = await ssoListMembers({
        search: searchParam || undefined,
        email: c.req.query("email") || undefined,
        role: roleParam || undefined,
        page,
        per_page: perPage,
      });
      if (res.data && res.data.length > 0) {
        ssoResult = { data: res.data, meta: res.meta };
      }
    } catch (e) {
      console.warn("[/sso/members] Live SSO fetch warning:", e);
    }
  }

  // If live SSO returned rich multi-item results, use it unless role filter is Guru/Siswa where local DB has full dataset
  if (
    ssoResult &&
    ssoResult.data.length > 0 &&
    !(roleParam?.toLowerCase() === "guru" && ssoResult.data.length === 1)
  ) {
    return c.json({ success: true, data: ssoResult.data, meta: ssoResult.meta });
  }

  // Primary / Fallback from Local DB
  try {
    const roleLower = roleParam?.toLowerCase() || "";
    let roleCond = undefined;
    if (roleLower === "siswa") {
      roleCond = eq(roles.code, "siswa");
    } else if (roleLower === "guru") {
      roleCond = or(eq(roles.code, "guru"), eq(roles.code, "walikelas"));
    } else if (roleLower === "wali kelas" || roleLower === "walikelas") {
      roleCond = eq(roles.code, "walikelas");
    } else if (roleLower === "tendik") {
      roleCond = eq(roles.code, "tendik");
    }

    const conditions = [];
    if (roleCond) conditions.push(roleCond);
    if (searchParam) {
      conditions.push(
        or(
          sql`lower(${users.name}) LIKE ${`%${searchParam}%`}`,
          sql`lower(${users.username}) LIKE ${`%${searchParam}%`}`,
          sql`lower(${users.email}) LIKE ${`%${searchParam}%`}`
        )
      );
    }

    const baseQuery = db
      .selectDistinct({
        id: users.id,
        nama_lengkap: users.name,
        email: users.email,
        username: users.username,
        nip_nis: users.username,
        isActive: users.isActive,
        createdAt: users.createdAt,
      })
      .from(users)
      .leftJoin(userRoles, eq(userRoles.userId, users.id))
      .leftJoin(roles, eq(roles.id, userRoles.roleId));

    const finalQuery = conditions.length > 0 ? baseQuery.where(and(...conditions)) : baseQuery;
    const localUsers = await finalQuery.orderBy(users.name);

    const userIds = localUsers.map((u) => u.id);
    const userRoleMap = new Map<string, Array<{ id: string; nama_role: string }>>();
    if (userIds.length > 0) {
      const allRoles = await db
        .select({
          userId: userRoles.userId,
          roleId: roles.id,
          roleName: roles.name,
          roleCode: roles.code,
        })
        .from(userRoles)
        .innerJoin(roles, eq(roles.id, userRoles.roleId))
        .where(inArray(userRoles.userId, userIds));

      for (const r of allRoles) {
        const list = userRoleMap.get(r.userId) ?? [];
        list.push({ id: r.roleId, nama_role: r.roleName });
        userRoleMap.set(r.userId, list);
      }
    }

    const studentMap = new Map<string, string>();
    if (userIds.length > 0) {
      const studentRows = await db
        .select({
          userId: students.userId,
          ssoMemberId: students.ssoMemberId,
          kelasLabel: students.kelasLabel,
          className: classes.name,
        })
        .from(students)
        .leftJoin(classes, eq(students.classId, classes.id));

      for (const s of studentRows) {
        const kName = s.className || s.kelasLabel;
        if (s.userId && kName) studentMap.set(s.userId, kName);
        if (s.ssoMemberId && kName) studentMap.set(s.ssoMemberId, kName);
      }
    }

    const total = localUsers.length;
    const offset = (page - 1) * perPage;
    const paginated = localUsers.slice(offset, offset + perPage);

    const formattedData = paginated.map((u) => ({
      id: u.id,
      nama_lengkap: u.nama_lengkap,
      email: u.email,
      nik: null,
      nip_nis: u.nip_nis,
      jk: null,
      no_telp: null,
      tgl_lahir: null,
      is_active: u.isActive,
      claimed_at: null,
      created_at: u.createdAt ? new Date(u.createdAt).toISOString() : null,
      roles: userRoleMap.get(u.id) ?? [{ id: "guru", nama_role: "Guru" }],
      kelas: studentMap.has(u.id) ? { nama_kelas: studentMap.get(u.id)! } : null,
    }));

    return c.json({
      success: true,
      data: formattedData,
      meta: {
        total,
        page,
        per_page: perPage,
        last_page: Math.ceil(total / perPage) || 1,
      },
    });
  } catch (err: any) {
    console.error("[/sso/members] Local DB fallback error:", err);
    return c.json({ success: false, message: err.message }, 500);
  }
});

adminRoutes.get("/sso/peran", async (c) => {
  try {
    const result = await ssoListPeran();
    return c.json({ success: true, data: result.data });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 502);
  }
});

adminRoutes.get("/sso/tahun-pelajaran", async (c) => {
  try {
    let years = await db.select().from(academicYears).orderBy(desc(academicYears.createdAt));

    if (years.length === 0) {
      const [created] = await db
        .insert(academicYears)
        .values({
          name: "2024/2025 Ganjil",
          isActive: true,
        })
        .returning();
      if (created) years = [created];
    }

    const classCounts = await db
      .select({
        academicYearId: classes.academicYearId,
        count: count(),
      })
      .from(classes)
      .groupBy(classes.academicYearId);

    const classCountMap = new Map(classCounts.map((c) => [c.academicYearId, c.count]));
    const [totalClassCount] = await db.select({ value: count() }).from(classes);

    const result = years.map((y) => {
      const match = y.name.match(/(\d{4})\/(\d{4})/);
      const tahun_mulai = match ? parseInt(match[1], 10) : 2024;
      const tahun_selesai = match ? parseInt(match[2], 10) : 2025;
      const semester = y.name.toLowerCase().includes("genap") ? "genap" : "ganjil";
      let kelas_count = classCountMap.get(y.id) ?? 0;
      if (kelas_count === 0 && y.isActive) {
        kelas_count = totalClassCount?.value ?? 0;
      }

      return {
        id: y.id,
        tahun_mulai,
        tahun_selesai,
        semester,
        is_aktif: y.isActive,
        kelas_count,
        label: y.name,
        created_at: y.createdAt ? y.createdAt.toISOString() : new Date().toISOString(),
      };
    });

    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Gagal memuat data tahun pelajaran" }, 500);
  }
});

adminRoutes.get("/sso/kelas", async (c) => {
  try {
    const aktifOnly = c.req.query("aktif") === "true";

    const activeYear = await lifecycle.getActiveAcademicYear();
    const allYears = await db.select().from(academicYears);
    const yearsMap = new Map(allYears.map((y) => [y.id, y]));

    // Fetch all homeroom assignments joined with users and classes
    const allHomerooms = await db
      .select({
        classId: homeroomAssignments.classId,
        userId: homeroomAssignments.userId,
        userName: users.name,
        userNip: users.username,
        className: classes.name,
      })
      .from(homeroomAssignments)
      .innerJoin(users, eq(homeroomAssignments.userId, users.id))
      .leftJoin(classes, eq(homeroomAssignments.classId, classes.id));

    const homeroomMap = new Map<string, { id: string; nama_lengkap: string; nip_nis: string }>();
    const homeroomNameMap = new Map<string, { id: string; nama_lengkap: string; nip_nis: string }>();

    for (const h of allHomerooms) {
      const info = {
        id: h.userId,
        nama_lengkap: h.userName,
        nip_nis: h.userNip ?? "—",
      };
      if (h.classId) {
        homeroomMap.set(h.classId, info);
      }
      if (h.className) {
        homeroomNameMap.set(h.className.toLowerCase().trim(), info);
      }
    }

    const formatTpRef = (y?: typeof academicYears.$inferSelect | null) => {
      const target = y || activeYear;
      const name = target?.name || "2024/2025 Ganjil";
      const match = name.match(/(\d{4})\/(\d{4})/);
      const tahun_mulai = match ? parseInt(match[1], 10) : 2024;
      const tahun_selesai = match ? parseInt(match[2], 10) : 2025;
      const semester = name.toLowerCase().includes("genap") ? "genap" : "ganjil";
      return {
        id: target?.id || "default-tp-id",
        tahun_mulai,
        tahun_selesai,
        semester,
        is_aktif: target?.isActive ?? true,
      };
    };

    let dbClasses = await db
      .select({
        id: classes.id,
        nama_kelas: classes.name,
        tingkat: classes.gradeLevel,
        jurusan: classes.jurusan,
        academicYearId: classes.academicYearId,
        academicYearName: classes.academicYear,
        homeroomTeacherId: classes.homeroomTeacherId,
        isActive: classes.isActive,
        createdAt: classes.createdAt,
        waliId: teachers.id,
        waliNama: teachers.name,
        waliNip: teachers.nip,
      })
      .from(classes)
      .leftJoin(teachers, eq(classes.homeroomTeacherId, teachers.id));

    if (aktifOnly) {
      dbClasses = dbClasses.filter((c) => c.isActive);
    }

    const studentCounts = await db
      .select({
        classId: students.classId,
        count: count(),
      })
      .from(students)
      .where(eq(students.memberStatus, "siswa"))
      .groupBy(students.classId);

    const countMap = new Map(studentCounts.map((s) => [s.classId, s.count]));

    const resultMap = new Map<string, any>();
    const resultNameMap = new Map<string, string>();

    for (const cls of dbClasses) {
      const yearObj = cls.academicYearId ? yearsMap.get(cls.academicYearId) : null;
      const tpRef = formatTpRef(yearObj);

      const waliObj =
        homeroomMap.get(cls.id) ||
        (cls.nama_kelas ? homeroomNameMap.get(cls.nama_kelas.toLowerCase().trim()) : null) ||
        (cls.homeroomTeacherId
          ? {
              id: cls.waliId!,
              nama_lengkap: cls.waliNama || "Wali Kelas",
              nip_nis: cls.waliNip || "—",
            }
          : null);

      resultMap.set(cls.id, {
        id: cls.id,
        nama_kelas: cls.nama_kelas,
        tingkat: cls.tingkat || "X",
        jurusan: cls.jurusan || null,
        tahun_pelajaran_id: tpRef.id,
        wali_kelas_id: waliObj ? waliObj.id : null,
        tahun_pelajaran: tpRef,
        wali_kelas: waliObj || null,
        jumlah_siswa: countMap.get(cls.id) ?? 0,
        created_at: cls.createdAt ? cls.createdAt.toISOString() : new Date().toISOString(),
      });
      if (cls.nama_kelas) {
        resultNameMap.set(cls.nama_kelas.toLowerCase().trim(), cls.id);
      }
    }

    if (env.SSO_API_KEY && env.SSO_API_BASE_URL) {
      try {
        const ssoRes = await ssoListKelas();
        if (ssoRes.data && Array.isArray(ssoRes.data)) {
          const defaultTp = formatTpRef(activeYear);
          for (const k of ssoRes.data) {
            const normName = k.nama_kelas ? k.nama_kelas.toLowerCase().trim() : "";
            const existingKey = resultMap.has(k.id) ? k.id : (normName ? resultNameMap.get(normName) : undefined);

            const waliObj =
              homeroomMap.get(k.id) ||
              (normName ? homeroomNameMap.get(normName) : null) ||
              null;

            if (existingKey) {
              const existing = resultMap.get(existingKey);
              if (!existing.wali_kelas && waliObj) {
                existing.wali_kelas_id = waliObj.id;
                existing.wali_kelas = waliObj;
              }
            } else {
              let tStr = k.tingkat != null ? String(k.tingkat) : "";
              if (!tStr && k.nama_kelas) {
                const m = k.nama_kelas.match(/^(XII|XI|X|VIII|VII|IX|12|11|10|9|8|7)/i);
                if (m) tStr = m[1].toUpperCase();
              }

              resultMap.set(k.id, {
                id: k.id,
                nama_kelas: k.nama_kelas,
                tingkat: tStr || "X",
                jurusan: k.jurusan || null,
                tahun_pelajaran_id: defaultTp.id,
                wali_kelas_id: waliObj ? waliObj.id : null,
                tahun_pelajaran: defaultTp,
                wali_kelas: waliObj || null,
                jumlah_siswa: countMap.get(k.id) ?? 0,
                created_at: new Date().toISOString(),
              });
              if (normName) {
                resultNameMap.set(normName, k.id);
              }
            }
          }
        }
      } catch (err) {
        console.warn("[/sso/kelas] Live SSO fetch warning:", err);
      }
    }

    const result = Array.from(resultMap.values());
    return c.json({ success: true, data: result });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Gagal memuat data kelas" }, 500);
  }
});

adminRoutes.get("/sso/users-export", requireRoles("superadmin"), async (c) => {
  try {
    let ssoUsers: Array<Record<string, unknown>> = [];

    if (env.SSO_API_KEY && env.SSO_API_BASE_URL) {
      try {
        const ssoRes = await ssoListMembers({ per_page: 100 });
        if (ssoRes.data && Array.isArray(ssoRes.data)) {
          ssoUsers = ssoRes.data.map((m) => ({
            ssoId: m.id,
            name: m.nama_lengkap,
            email: m.email,
            username: m.nip_nis,
            phone: m.no_telp,
            birthDate: m.tgl_lahir,
            gender: m.jk,
            isActive: m.is_active,
            roles: m.roles?.map((r) => r.nama_role) ?? [],
            class: m.kelas ? `${m.kelas.nama_kelas}` : null,
            source: "sso_kredensia",
          }));
        }
      } catch (err) {
        console.warn("[users-export] SSO API fetch failed, fallback to DB users:", err);
      }
    }

    if (ssoUsers.length === 0) {
      const dbUsers = await db
        .select({
          id: users.id,
          ssoId: users.ssoId,
          name: users.name,
          email: users.email,
          username: users.username,
          phone: users.phone,
          avatarUrl: users.avatarUrl,
          isActive: users.isActive,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(
          and(
            isNotNull(users.ssoId),
            ne(users.email, "superadmin@faishalnafi.local")
          )
        )
        .orderBy(users.name);

      ssoUsers = dbUsers.map((u) => ({
        id: u.id,
        ssoId: u.ssoId,
        name: u.name,
        email: u.email,
        username: u.username,
        phone: u.phone,
        avatarUrl: u.avatarUrl,
        isActive: u.isActive,
        createdAt: u.createdAt,
        source: "sintesa_db_synced",
      }));
    }

    const filteredUsers = ssoUsers.filter(
      (u) =>
        u.email !== "superadmin@faishalnafi.local" &&
        u.username !== "superadmin"
    );

    // Ambil data pendukung master: kelas, tahun pelajaran, mapel, dan penugasan
    const classList = await db.select().from(classes).orderBy(classes.name);
    const yearList = await db.select().from(academicYears).orderBy(academicYears.name);
    const subjectList = await db.select().from(subjects).orderBy(subjects.name);
    const homeroomList = await db
      .select({
        id: homeroomAssignments.id,
        userId: homeroomAssignments.userId,
        teacherName: users.name,
        classId: homeroomAssignments.classId,
        className: classes.name,
      })
      .from(homeroomAssignments)
      .innerJoin(users, eq(homeroomAssignments.userId, users.id))
      .innerJoin(classes, eq(homeroomAssignments.classId, classes.id));

    const teacherSubjectList = await db
      .select({
        id: teacherSubjects.id,
        userId: teacherSubjects.userId,
        teacherName: users.name,
        subjectId: teacherSubjects.subjectId,
        subjectName: subjects.name,
      })
      .from(teacherSubjects)
      .innerJoin(users, eq(teacherSubjects.userId, users.id))
      .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id));

    return c.json({
      success: true,
      exportedAt: new Date().toISOString(),
      summary: {
        usersCount: filteredUsers.length,
        classesCount: classList.length,
        academicYearsCount: yearList.length,
        subjectsCount: subjectList.length,
      },
      data: {
        users: filteredUsers,
        classes: classList,
        academicYears: yearList,
        subjects: subjectList,
        homeroomAssignments: homeroomList,
        teacherSubjects: teacherSubjectList,
      },
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

adminRoutes.post("/sso/sync-members", async (c) => {
  try {
    const body = z
      .object({ role: z.string().optional() })
      .parse((await c.req.json().catch(() => ({}))) ?? {});
    const data = await syncMembersFromIdp(body.role);

    // Otomatis sinkronkan Roster Kelas (kelas & pembagian siswa) dalam 1 proses
    let rosterTotal = 0;
    try {
      const rosterRes = await runRosterSyncInternal();
      rosterTotal = rosterRes.totalUpdated;
    } catch (rErr) {
      console.warn("[sync-members] Auto roster sync warning:", rErr);
    }

    broadcastRealtimeEvent({ type: "student_updated", source: "sso" });
    return c.json({
      success: true,
      data,
      message: `Sync SSO berhasil: ${data.success}/${data.total} akun & ${rosterTotal} siswa ter-assign ke kelas!`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 502);
  }
});

// Helper internal untuk sinkronisasi Roster Kelas (pembagian kelas siswa)
async function runRosterSyncInternal() {
  if (!env.SSO_API_KEY || !env.SSO_API_BASE_URL) return { totalUpdated: 0, summary: [] };
  let totalUpdated = 0;
  const summary: Array<{ kelas: string; total: number; updated: number; errors: number }> = [];

  const kelasRes = await ssoListKelas();
  const kelasList = kelasRes.data ?? [];

  for (const k of kelasList) {
    await db
      .insert(classes)
      .values({
        id: k.id,
        name: k.nama_kelas,
        gradeLevel: String(k.tingkat ?? "X"),
        jurusan: k.jurusan ?? null,
        academicYear: "2024/2025",
        isActive: true,
      })
      .onConflictDoUpdate({
        target: classes.id,
        set: { name: k.nama_kelas, updatedAt: new Date() },
      })
      .catch(() => {});
  }

  for (const k of kelasList) {
    let updated = 0;
    let errors = 0;

    try {
      const members = await ssoGetKelasMembers(k.id);
      for (const m of members) {
        try {
          const nis = m.nip_nis || m.nis || null;
          const conds = [];
          if (m.id) conds.push(eq(students.ssoMemberId, m.id));
          if (nis) conds.push(eq(students.nis, nis));
          if (conds.length === 0) continue;

          const [found] = await db
            .select({ id: students.id })
            .from(students)
            .where(or(...conds))
            .limit(1);

          if (found) {
            await db
              .update(students)
              .set({
                classId: k.id,
                kelasLabel: k.nama_kelas,
                isActive: true,
                updatedAt: new Date(),
              })
              .where(eq(students.id, found.id));
            updated++;
            totalUpdated++;
          }
        } catch (e) {
          errors++;
        }
      }
    } catch (e) {
      errors++;
      console.error(`[runRosterSyncInternal] Failed to fetch kelas ${k.nama_kelas}:`, e);
    }

    summary.push({ kelas: k.nama_kelas, total: 0, updated, errors });
  }

  return { totalUpdated, summary };
}

// ---------------------------------------------------------------------------
// Sync class rosters: set kelasLabel + classId on every student per kelas
// ---------------------------------------------------------------------------
adminRoutes.post("/sso/sync-kelas-roster", async (c) => {
  if (!env.SSO_API_KEY || !env.SSO_API_BASE_URL) {
    return c.json({ success: false, message: "SSO belum dikonfigurasi" }, 503);
  }

  try {
    const result = await runRosterSyncInternal();
    return c.json({
      success: true,
      message: `Roster sync selesai: ${result.totalUpdated} siswa ter-assign ke kelas`,
      totalUpdated: result.totalUpdated,
      detail: result.summary,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

// ============================================================
// MONITORING JURNAL GURU
// ============================================================

/**
 * GET /admin/journals/monitoring?classId=...&date=...
 * Menampilkan semua jam pelajaran untuk kelas dan tanggal yang dipilih.
 * Setiap jam yang belum diisi jurnal akan muncul dengan strip (—).
 */
adminRoutes.get("/journals/monitoring", async (c) => {
  const classId = c.req.query("classId");
  const date = c.req.query("date");

  if (!classId || !date) {
    return c.json({ success: false, message: "classId dan date wajib diisi" }, 400);
  }

  try {
    // Ambil semua jam pelajaran yang terdaftar
    const hours = await db
      .select()
      .from(teachingHours)
      .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);

    // Ambil jurnal yang sudah diisi untuk kelas & tanggal ini
    const journals = await db
      .select({
        journalId: teacherJournals.id,
        teachingHourId: teacherJournals.teachingHourId,
        teacherName: users.name,
        subjectName: teacherJournals.subjectName,
        materi: teacherJournals.materi,
        presenceInfo: teacherJournals.presenceInfo,
        status: teacherJournals.status,
      })
      .from(teacherJournals)
      .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
      .where(
        and(
          eq(teacherJournals.classId, classId),
          eq(teacherJournals.date, date),
          isNull(teacherJournals.deletedAt)
        )
      );

    // Map setiap jam pelajaran dengan data jurnal (jika ada)
    const journalMap = new Map(
      journals.map((j) => [j.teachingHourId, j])
    );

    const rows = hours.map((h) => {
      const j = h.id ? journalMap.get(h.id) : undefined;
      return {
        teachingHourId: h.id,
        label: h.label,
        startTime: h.startTime,
        endTime: h.endTime,
        journalId: j?.journalId ?? null,
        teacherName: j?.teacherName ?? null,
        subjectName: j?.subjectName ?? null,
        materi: j?.materi ?? null,
        presenceInfo: j?.presenceInfo ?? null,
        status: j?.status ?? null,
      };
    });

    return c.json({ success: true, data: rows });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * POST /admin/journals/koreksi-ulang
 * Kembalikan jurnal dari status 'sent' ke 'draft' agar guru bisa mengedit ulang.
 */
adminRoutes.post("/journals/koreksi-ulang", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const { journalId } = body as { journalId?: string };
    if (!journalId) {
      return c.json({ success: false, message: "journalId wajib diisi" }, 400);
    }

    // Cari jurnal dan groupId-nya
    const [journal] = await db
      .select()
      .from(teacherJournals)
      .where(eq(teacherJournals.id, journalId))
      .limit(1);

    if (!journal) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan" }, 404);
    }

    if (journal.groupId) {
      // Kembalikan seluruh grup ke draft
      await db
        .update(teacherJournals)
        .set({ status: "draft", updatedAt: new Date() })
        .where(eq(teacherJournals.groupId, journal.groupId));
    } else {
      await db
        .update(teacherJournals)
        .set({ status: "draft", updatedAt: new Date() })
        .where(eq(teacherJournals.id, journalId));
    }

    return c.json({ success: true, message: "Jurnal berhasil dikembalikan ke Draft" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * PATCH /admin/journals/:id
 * Edit isi jurnal (materi / presenceInfo) langsung dari admin.
 */
adminRoutes.patch("/journals/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = await c.req.json().catch(() => ({}));
    const { materi, presenceInfo } = body as { materi?: string; presenceInfo?: string };

    const [journal] = await db
      .select()
      .from(teacherJournals)
      .where(eq(teacherJournals.id, id))
      .limit(1);

    if (!journal) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan" }, 404);
    }

    const [updated] = await db
      .update(teacherJournals)
      .set({
        ...(materi !== undefined ? { materi } : {}),
        ...(presenceInfo !== undefined ? { presenceInfo } : {}),
        updatedAt: new Date(),
      })
      .where(eq(teacherJournals.id, id))
      .returning();

    return c.json({ success: true, data: updated, message: "Jurnal berhasil diperbarui" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * DELETE /admin/journals/:id
 * Soft delete jurnal mengajar oleh superadmin.
 */
adminRoutes.delete("/journals/:id", requireRoles("superadmin"), async (c) => {
  const id = c.req.param("id");
  try {
    const [journal] = await db
      .select()
      .from(teacherJournals)
      .where(eq(teacherJournals.id, id))
      .limit(1);

    if (!journal) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan" }, 404);
    }

    if (journal.groupId) {
      await db
        .update(teacherJournals)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(teacherJournals.groupId, journal.groupId));
    } else {
      await db
        .update(teacherJournals)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(eq(teacherJournals.id, id));
    }

    broadcastRealtimeEvent({ type: "journal_deleted" });
    return c.json({ success: true, message: "Jurnal berhasil dihapus (soft delete)" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * DELETE /admin/grades/student/:studentId
 * Soft delete seluruh data nilai siswa di kelas ini oleh superadmin.
 */
adminRoutes.delete("/grades/student/:studentId", requireRoles("superadmin"), async (c) => {
  const studentId = c.req.param("studentId");
  const classId = c.req.query("classId");
  try {
    const conditions = [eq(grades.studentId, studentId)];
    if (classId) conditions.push(eq(grades.classId, classId));

    const updated = await db
      .update(grades)
      .set({ deletedAt: new Date(), updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    return c.json({
      success: true,
      message: `Berhasil menghapus (${updated.length} entri) nilai siswa (soft delete).`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

// ============================================================
// TEMPAT SAMPAH / RECYCLE BIN (KHUSUS SUPERADMIN)
// ============================================================

/**
 * GET /admin/trash/journals
 * Mengambil daftar jurnal yang di-soft-delete (deletedAt IS NOT NULL).
 */
adminRoutes.get("/trash/journals", requireRoles("superadmin"), async (c) => {
  try {
    const list = await db
      .select({
        id: teacherJournals.id,
        date: teacherJournals.date,
        className: teacherJournals.className,
        subjectName: teacherJournals.subjectName,
        teachingHourLabel: teacherJournals.teachingHourLabel,
        teacherName: users.name,
        materi: teacherJournals.materi,
        presenceInfo: teacherJournals.presenceInfo,
        deletedAt: teacherJournals.deletedAt,
        groupId: teacherJournals.groupId,
      })
      .from(teacherJournals)
      .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
      .where(isNotNull(teacherJournals.deletedAt))
      .orderBy(desc(teacherJournals.deletedAt));

    return c.json({ success: true, data: list });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * POST /admin/trash/journals/:id/restore
 * Memulihkan jurnal yang di-soft-delete dengan cek bentrokan data baru.
 */
adminRoutes.post("/trash/journals/:id/restore", requireRoles("superadmin"), async (c) => {
  const id = c.req.param("id");
  const overwrite = c.req.query("overwrite") === "true";

  try {
    const [journal] = await db
      .select()
      .from(teacherJournals)
      .where(eq(teacherJournals.id, id))
      .limit(1);

    if (!journal) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan di tempat sampah" }, 404);
    }

    // 1. Cek bentrokan dengan data jurnal aktif (deletedAt IS NULL) pada tanggal & jam mengajar yang sama
    const activeConditions = [
      eq(teacherJournals.teacherUserId, journal.teacherUserId),
      eq(teacherJournals.date, journal.date),
      isNull(teacherJournals.deletedAt),
    ];
    if (journal.teachingHourId) {
      activeConditions.push(eq(teacherJournals.teachingHourId, journal.teachingHourId));
    }

    const activeConflicts = await db
      .select()
      .from(teacherJournals)
      .where(and(...activeConditions));

    if (activeConflicts.length > 0 && !overwrite) {
      return c.json(
        {
          success: false,
          conflict: true,
          message: "Sudah terdapat data jurnal baru yang diisi oleh guru pada tanggal & jam mengajar ini.",
        },
        409
      );
    }

    // 2. Jika overwrite = true, soft delete data baru yang bentrok
    if (activeConflicts.length > 0 && overwrite) {
      const conflictIds = activeConflicts.map((ac) => ac.id);
      await db
        .update(teacherJournals)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(teacherJournals.id, conflictIds));
    }

    // 3. Pulihkan data lama dari tempat sampah
    if (journal.groupId) {
      await db
        .update(teacherJournals)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(teacherJournals.groupId, journal.groupId));
    } else {
      await db
        .update(teacherJournals)
        .set({ deletedAt: null, updatedAt: new Date() })
        .where(eq(teacherJournals.id, id));
    }

    broadcastRealtimeEvent({ type: "journal_saved" });
    return c.json({
      success: true,
      message: overwrite
        ? "Data jurnal lama berhasil dipulihkan dari Tempat Sampah dan menimpa data baru."
        : "Jurnal mengajar berhasil dipulihkan dari Tempat Sampah.",
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * DELETE /admin/trash/journals/:id/permanent
 * Menghapus permanen jurnal dari database.
 */
adminRoutes.delete("/trash/journals/:id/permanent", requireRoles("superadmin"), async (c) => {
  const id = c.req.param("id");
  try {
    const [journal] = await db
      .select()
      .from(teacherJournals)
      .where(eq(teacherJournals.id, id))
      .limit(1);

    if (!journal) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan" }, 404);
    }

    if (journal.groupId) {
      await db.delete(teacherJournals).where(eq(teacherJournals.groupId, journal.groupId));
    } else {
      await db.delete(teacherJournals).where(eq(teacherJournals.id, id));
    }

    broadcastRealtimeEvent({ type: "journal_deleted" });
    return c.json({ success: true, message: "Jurnal berhasil dihapus secara PERMANEN." });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * DELETE /admin/trash/journals/empty
 * Menghapus SELURUH jurnal di Tempat Sampah secara permanen.
 */
adminRoutes.delete("/trash/journals/empty", requireRoles("superadmin"), async (c) => {
  try {
    const result = await db.delete(teacherJournals).where(isNotNull(teacherJournals.deletedAt)).returning();
    broadcastRealtimeEvent({ type: "journal_deleted" });
    return c.json({
      success: true,
      message: `Berhasil menghapus permanen ${result.length} entri jurnal dari Tempat Sampah.`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * GET /admin/trash/grades
 * Mengambil daftar nilai yang di-soft-delete (deletedAt IS NOT NULL).
 */
adminRoutes.get("/trash/grades", requireRoles("superadmin"), async (c) => {
  try {
    const list = await db
      .select({
        id: grades.id,
        studentName: students.name,
        nisn: students.nisn,
        nis: students.nis,
        className: classes.name,
        subjectName: subjects.name,
        academicYear: grades.academicYear,
        semester: grades.semester,
        deletedAt: grades.deletedAt,
      })
      .from(grades)
      .innerJoin(students, eq(grades.studentId, students.id))
      .innerJoin(classes, eq(grades.classId, classes.id))
      .innerJoin(subjects, eq(grades.subjectId, subjects.id))
      .where(isNotNull(grades.deletedAt))
      .orderBy(desc(grades.deletedAt));

    return c.json({ success: true, data: list });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * POST /admin/trash/grades/:id/restore
 * Memulihkan nilai yang di-soft-delete dengan cek bentrokan data baru.
 */
adminRoutes.post("/trash/grades/:id/restore", requireRoles("superadmin"), async (c) => {
  const id = c.req.param("id");
  const overwrite = c.req.query("overwrite") === "true";

  try {
    const [grade] = await db
      .select()
      .from(grades)
      .where(eq(grades.id, id))
      .limit(1);

    if (!grade) {
      return c.json({ success: false, message: "Data nilai tidak ditemukan di tempat sampah" }, 404);
    }

    // 1. Cek bentrokan dengan data nilai aktif (deletedAt IS NULL) untuk siswa & mapel yang sama
    const activeConflicts = await db
      .select()
      .from(grades)
      .where(
        and(
          eq(grades.studentId, grade.studentId),
          eq(grades.subjectId, grade.subjectId),
          eq(grades.classId, grade.classId),
          eq(grades.academicYear, grade.academicYear),
          eq(grades.semester, grade.semester),
          isNull(grades.deletedAt)
        )
      );

    if (activeConflicts.length > 0 && !overwrite) {
      return c.json(
        {
          success: false,
          conflict: true,
          message: "Sudah terdapat data nilai baru yang diisi untuk mata pelajaran dan siswa ini.",
        },
        409
      );
    }

    // 2. Jika overwrite = true, soft-delete data nilai baru
    if (activeConflicts.length > 0 && overwrite) {
      const conflictIds = activeConflicts.map((ac) => ac.id);
      await db
        .update(grades)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(grades.id, conflictIds));
    }

    // 3. Pulihkan data nilai lama dari tempat sampah
    await db
      .update(grades)
      .set({ deletedAt: null, updatedAt: new Date() })
      .where(eq(grades.id, id));

    broadcastRealtimeEvent({ type: "grade_data_restored" });
    return c.json({
      success: true,
      message: overwrite
        ? "Data nilai lama berhasil dipulihkan dari Tempat Sampah dan menimpa data baru."
        : "Data nilai berhasil dipulihkan dari Tempat Sampah.",
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * DELETE /admin/trash/grades/:id/permanent
 * Menghapus permanen nilai dari database.
 */
adminRoutes.delete("/trash/grades/:id/permanent", requireRoles("superadmin"), async (c) => {
  const id = c.req.param("id");
  try {
    await db.delete(grades).where(eq(grades.id, id));
    broadcastRealtimeEvent({ type: "grade_data_restored" });
    return c.json({ success: true, message: "Data nilai berhasil dihapus secara PERMANEN." });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * DELETE /admin/trash/grades/empty
 * Menghapus SELURUH nilai di Tempat Sampah secara permanen.
 */
adminRoutes.delete("/trash/grades/empty", requireRoles("superadmin"), async (c) => {
  try {
    const result = await db.delete(grades).where(isNotNull(grades.deletedAt)).returning();
    broadcastRealtimeEvent({ type: "grade_data_restored" });
    return c.json({
      success: true,
      message: `Berhasil menghapus permanen ${result.length} entri nilai dari Tempat Sampah.`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

// ============================================================
// BACKUP & RESTORE DATABASE (KHUSUS SUPERADMIN)
// ============================================================

/**
 * GET /admin/backup
 * Ekspor seluruh data tabel database dalam format JSON lengkap.
 * Hanya dapat diakses oleh superadmin.
 */
adminRoutes.get("/backup", requireRoles("superadmin"), async (c) => {
  try {
    const [
      rolesData,
      academicYearsData,
      usersData,
      userRolesData,
      authEventsData,
      ssoTokenJtiData,
      teachersData,
      classesData,
      studentsData,
      academicHistoriesData,
      subjectsData,
      classSubjectsData,
      teacherSubjectsData,
      homeroomAssignmentsData,
      enrollmentsData,
      gradesData,
      gradeAuditLogsData,
      importJobsData,
      externalSyncLogsData,
      teachingHoursData,
      teacherJournalsData,
    ] = await Promise.all([
      db.select().from(roles),
      db.select().from(academicYears),
      db.select().from(users),
      db.select().from(userRoles),
      db.select().from(authEvents),
      db.select().from(ssoTokenJti),
      db.select().from(teachers),
      db.select().from(classes),
      db.select().from(students),
      db.select().from(academicHistories),
      db.select().from(subjects),
      db.select().from(classSubjects),
      db.select().from(teacherSubjects),
      db.select().from(homeroomAssignments),
      db.select().from(enrollments),
      db.select().from(grades),
      db.select().from(gradeAuditLogs),
      db.select().from(importJobs),
      db.select().from(externalSyncLogs),
      db.select().from(teachingHours),
      db.select().from(teacherJournals),
    ]);

    const backupPayload = {
      appName: "SINTESA",
      version: "1.0",
      timestamp: new Date().toISOString(),
      data: {
        roles: rolesData,
        academicYears: academicYearsData,
        users: usersData,
        userRoles: userRolesData,
        authEvents: authEventsData,
        ssoTokenJti: ssoTokenJtiData,
        teachers: teachersData,
        classes: classesData,
        students: studentsData,
        academicHistories: academicHistoriesData,
        subjects: subjectsData,
        classSubjects: classSubjectsData,
        teacherSubjects: teacherSubjectsData,
        homeroomAssignments: homeroomAssignmentsData,
        enrollments: enrollmentsData,
        grades: gradesData,
        gradeAuditLogs: gradeAuditLogsData,
        importJobs: importJobsData,
        externalSyncLogs: externalSyncLogsData,
        teachingHours: teachingHoursData,
        teacherJournals: teacherJournalsData,
      },
    };

    const dateStr = new Date().toISOString().slice(0, 10);
    const filename = `sintesa-backup-${dateStr}.json`;

    return new Response(JSON.stringify(backupPayload, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Backup error" }, 500);
  }
});

/**
 * POST /admin/restore
 * Restore data dari berkas JSON backup ke database.
 * Hanya dapat diakses oleh superadmin.
 */
adminRoutes.post("/restore", requireRoles("superadmin"), async (c) => {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body || !body.data || typeof body.data !== "object") {
      return c.json({ success: false, message: "File backup JSON tidak valid atau struktur data tidak ditemukan." }, 400);
    }

    const { data } = body;
    let totalRestored = 0;

    await db.transaction(async (tx) => {
      // 1. Roles
      if (Array.isArray(data.roles) && data.roles.length > 0) {
        for (const row of data.roles) {
          await tx.insert(roles).values(row).onConflictDoUpdate({ target: roles.id, set: row });
          totalRestored++;
        }
      }
      // 2. Academic Years
      if (Array.isArray(data.academicYears) && data.academicYears.length > 0) {
        for (const row of data.academicYears) {
          await tx.insert(academicYears).values(row).onConflictDoUpdate({ target: academicYears.id, set: row });
          totalRestored++;
        }
      }
      // 3. Users
      if (Array.isArray(data.users) && data.users.length > 0) {
        for (const row of data.users) {
          await tx.insert(users).values(row).onConflictDoUpdate({ target: users.id, set: row });
          totalRestored++;
        }
      }
      // 4. User Roles
      if (Array.isArray(data.userRoles) && data.userRoles.length > 0) {
        for (const row of data.userRoles) {
          await tx.insert(userRoles).values(row).onConflictDoUpdate({ target: userRoles.id, set: row });
          totalRestored++;
        }
      }
      // 5. Teachers
      if (Array.isArray(data.teachers) && data.teachers.length > 0) {
        for (const row of data.teachers) {
          await tx.insert(teachers).values(row).onConflictDoUpdate({ target: teachers.id, set: row });
          totalRestored++;
        }
      }
      // 6. Classes
      if (Array.isArray(data.classes) && data.classes.length > 0) {
        for (const row of data.classes) {
          await tx.insert(classes).values(row).onConflictDoUpdate({ target: classes.id, set: row });
          totalRestored++;
        }
      }
      // 7. Students
      if (Array.isArray(data.students) && data.students.length > 0) {
        for (const row of data.students) {
          await tx.insert(students).values(row).onConflictDoUpdate({ target: students.id, set: row });
          totalRestored++;
        }
      }
      // 8. Subjects
      if (Array.isArray(data.subjects) && data.subjects.length > 0) {
        for (const row of data.subjects) {
          await tx.insert(subjects).values(row).onConflictDoUpdate({ target: subjects.id, set: row });
          totalRestored++;
        }
      }
      // 9. Class Subjects
      if (Array.isArray(data.classSubjects) && data.classSubjects.length > 0) {
        for (const row of data.classSubjects) {
          await tx.insert(classSubjects).values(row).onConflictDoUpdate({ target: classSubjects.id, set: row });
          totalRestored++;
        }
      }
      // 10. Teacher Subjects
      if (Array.isArray(data.teacherSubjects) && data.teacherSubjects.length > 0) {
        for (const row of data.teacherSubjects) {
          await tx.insert(teacherSubjects).values(row).onConflictDoUpdate({ target: teacherSubjects.id, set: row });
          totalRestored++;
        }
      }
      // 11. Homeroom Assignments
      if (Array.isArray(data.homeroomAssignments) && data.homeroomAssignments.length > 0) {
        for (const row of data.homeroomAssignments) {
          await tx.insert(homeroomAssignments).values(row).onConflictDoUpdate({ target: homeroomAssignments.id, set: row });
          totalRestored++;
        }
      }
      // 12. Enrollments
      if (Array.isArray(data.enrollments) && data.enrollments.length > 0) {
        for (const row of data.enrollments) {
          await tx.insert(enrollments).values(row).onConflictDoUpdate({ target: enrollments.id, set: row });
          totalRestored++;
        }
      }
      // 13. Teaching Hours
      if (Array.isArray(data.teachingHours) && data.teachingHours.length > 0) {
        for (const row of data.teachingHours) {
          await tx.insert(teachingHours).values(row).onConflictDoUpdate({ target: teachingHours.id, set: row });
          totalRestored++;
        }
      }
      // 14. Teacher Journals
      if (Array.isArray(data.teacherJournals) && data.teacherJournals.length > 0) {
        for (const row of data.teacherJournals) {
          await tx.insert(teacherJournals).values(row).onConflictDoUpdate({ target: teacherJournals.id, set: row });
          totalRestored++;
        }
      }
      // 15. Grades
      if (Array.isArray(data.grades) && data.grades.length > 0) {
        for (const row of data.grades) {
          await tx.insert(grades).values(row).onConflictDoUpdate({ target: grades.id, set: row });
          totalRestored++;
        }
      }
      // 16. Grade Audit Logs
      if (Array.isArray(data.gradeAuditLogs) && data.gradeAuditLogs.length > 0) {
        for (const row of data.gradeAuditLogs) {
          await tx.insert(gradeAuditLogs).values(row).onConflictDoUpdate({ target: gradeAuditLogs.id, set: row });
          totalRestored++;
        }
      }
    });

    return c.json({
      success: true,
      message: `Database berhasil di-restore! Total ${totalRestored} entri data diperbarui.`,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Restore error" }, 500);
  }
});

// ---------------------------------------------------------------------------
// Konfigurasi Kolom Penilaian Dinamis (Assessment Components)
// ---------------------------------------------------------------------------

adminRoutes.get("/assessment-components", async (c) => {
  try {
    let list = await db
      .select()
      .from(assessmentComponents)
      .orderBy(asc(assessmentComponents.sortOrder), asc(assessmentComponents.createdAt));

    // Auto-seed default jika kosong
    if (list.length === 0) {
      await db
        .insert(assessmentComponents)
        .values([
          { code: "uh1", name: "UH1", type: "UJIAN", status: "active", sortOrder: 1 },
          { code: "t1", name: "T1", type: "TUGAS", status: "active", sortOrder: 2 },
          { code: "sts", name: "STS", type: "UJIAN", status: "active", sortOrder: 3 },
          { code: "uh2", name: "UH2", type: "UJIAN", status: "disabled", sortOrder: 4 },
          { code: "t2", name: "T2", type: "TUGAS", status: "disabled", sortOrder: 5 },
        ])
        .onConflictDoNothing();

      list = await db
        .select()
        .from(assessmentComponents)
        .orderBy(asc(assessmentComponents.sortOrder), asc(assessmentComponents.createdAt));
    }

    return c.json({ success: true, data: list });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

const assessmentComponentSchema = z.object({
  code: z.string().min(1, "Kode wajib diisi"),
  name: z.string().min(1, "Nama wajib diisi"),
  type: z.enum(["UJIAN", "TUGAS"]).default("UJIAN"),
  status: z.enum(["active", "disabled", "inactive"]).default("active"),
  sortOrder: z.number().int().default(0),
});

adminRoutes.post("/assessment-components", async (c) => {
  try {
    const body = assessmentComponentSchema.parse(await c.req.json());
    const [created] = await db
      .insert(assessmentComponents)
      .values({
        code: body.code.toLowerCase().trim(),
        name: body.name.trim(),
        type: body.type,
        status: body.status,
        sortOrder: body.sortOrder,
      })
      .returning();

    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, data: created, message: "Komponen penilaian berhasil ditambahkan" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.put("/assessment-components/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const body = assessmentComponentSchema.partial().parse(await c.req.json());
    const [updated] = await db
      .update(assessmentComponents)
      .set({
        ...(body.code ? { code: body.code.toLowerCase().trim() } : {}),
        ...(body.name ? { name: body.name.trim() } : {}),
        ...(body.type ? { type: body.type } : {}),
        ...(body.status ? { status: body.status } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        updatedAt: new Date(),
      })
      .where(eq(assessmentComponents.id, id))
      .returning();

    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, data: updated, message: "Komponen penilaian berhasil diperbarui" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

adminRoutes.delete("/assessment-components/:id", async (c) => {
  const id = c.req.param("id");
  try {
    const [deleted] = await db
      .delete(assessmentComponents)
      .where(eq(assessmentComponents.id, id))
      .returning();

    if (!deleted) {
      return c.json({ success: false, message: "Komponen penilaian tidak ditemukan" }, 404);
    }

    broadcastRealtimeEvent({ type: "subject_updated" });
    return c.json({ success: true, message: "Komponen penilaian berhasil dihapus" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

