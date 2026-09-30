import { Hono } from "hono";
import { and, desc, eq, inArray, or, sql, isNull, isNotNull, count, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  academicYears,
  classes,
  classSubjects,
  gradeAuditLogs,
  grades,
  homeroomAssignments,
  students,
  subjects,
  teachers,
  teacherSubjects,
  teachingHours,
  teacherJournals,
  users,
  assessmentComponents,
  userRoles,
  roles,
} from "../../db/schema/index.js";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { requireRoles } from "../../middlewares/rbac.js";
import { computeAverage, isValidScore } from "../../utils/grades.js";
import { env } from "../../env.js";
import { ssoListKelas } from "../../services/sso-api-client.js";
import { broadcastRealtimeEvent } from "../../services/realtime.js";
import { askGemini } from "../../services/gemini.js";
import { uploadFile, deleteFile, deleteFolderPrefix } from "../../services/storage/storage.service.js";
import type { StorageProviderType } from "../../services/storage/types.js";
export const teacherRoutes = new Hono<{ Variables: AuthVariables }>();

teacherRoutes.use("*", requireAuth, requireRoles("guru", "walikelas", "admin", "superadmin"));

teacherRoutes.get("/debug-sso", async (c) => {
  const testUrl = `${env.SSO_API_BASE_URL}/kelas`;
  try {
    const res = await fetch(testUrl, {
      headers: {
        "X-API-Key": env.SSO_API_KEY || "",
        Origin: env.FRONTEND_URL || "https://simak.sman3mjk.sch.id",
      },
    });
    const status = res.status;
    const text = await res.text();
    return c.json({
      success: true,
      url: testUrl,
      status,
      body: text.substring(0, 1000),
    });
  } catch (e: any) {
    return c.json({
      success: false,
      url: testUrl,
      error: e.message,
      stack: e.stack,
    }, 500);
  }
});

teacherRoutes.get("/debug-roster", async (c) => {
  const rawClassId = c.req.query("classId");
  if (!rawClassId) return c.json({ success: false, message: "classId required" }, 400);

  try {
    const isIdUuid = isUuid(rawClassId);
    const conds = [];
    if (isIdUuid) conds.push(eq(classes.id, rawClassId));
    conds.push(eq(classes.name, rawClassId));
    
    const [foundClass] = await db.select().from(classes).where(or(...conds)).limit(1);
    const className = foundClass?.name;

    const initialConds = [];
    if (isIdUuid) initialConds.push(eq(students.classId, rawClassId));
    if (className) {
      initialConds.push(eq(students.kelasLabel, className));
    }

    const roster = await db
      .select({ id: students.id, name: students.name, classId: students.classId, kelasLabel: students.kelasLabel, isActive: students.isActive })
      .from(students)
      .where(or(...initialConds))
      .limit(50);

    const [totalStudents] = await db.select({ count: sql`count(*)` }).from(students);
    const [totalClasses] = await db.select({ count: sql`count(*)` }).from(classes);

    return c.json({
      success: true,
      query: { rawClassId, resolvedClassName: className },
      counts: {
        totalStudentsInDb: Number(totalStudents.count),
        totalClassesInDb: Number(totalClasses.count),
        matchedStudentsCount: roster.length,
      },
      sampleRoster: roster,
    });
  } catch (e: any) {
    return c.json({
      success: false,
      error: e.message,
      stack: e.stack,
    }, 500);
  }
});

async function resolveTeacherId(userId: string) {
  const [t] = await db.select().from(teachers).where(eq(teachers.userId, userId)).limit(1);
  return t?.id ?? null;
}

function isUuid(str: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(str);
}

async function ensureTargetClassExists(classIdOrSsoId: string): Promise<string> {
  if (!classIdOrSsoId) return classIdOrSsoId;

  try {
    const isIdUuid = isUuid(classIdOrSsoId);
    const conds = [];
    if (isIdUuid) conds.push(eq(classes.id, classIdOrSsoId));
    conds.push(eq(classes.name, classIdOrSsoId));
    conds.push(sql`LOWER(${classes.name}) = LOWER(${classIdOrSsoId})`);

    let [c] = await db
      .select()
      .from(classes)
      .where(or(...conds))
      .limit(1);

    if (c) return c.id;
  } catch (e) {
    console.error("[ensureTargetClassExists] query error:", e);
  }

  try {
    const ssoRes = await ssoListKelas();
    if (ssoRes.data && Array.isArray(ssoRes.data)) {
      const found = ssoRes.data.find(
        (k) => k.id === classIdOrSsoId || k.nama_kelas.toLowerCase() === classIdOrSsoId.toLowerCase(),
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

teacherRoutes.get("/classes", async (c) => {
  const list: Array<{ id: string; name: string }> = [];
  const seenIds = new Set<string>();

  // 1. Ambil data kelas langsung dari SSO Kredensia
  if (env.SSO_API_KEY && env.SSO_API_BASE_URL) {
    try {
      const ssoRes = await ssoListKelas();
      if (ssoRes.data && Array.isArray(ssoRes.data)) {
        for (const k of ssoRes.data) {
          list.push({ id: k.id, name: k.nama_kelas });
          seenIds.add(k.id);
        }
      }
    } catch (e) {
      console.error("Gagal mengambil data kelas dari SSO:", e);
    }
  }

  // 2. Gabungkan dengan kelas lokal
  const local = await db
    .select({
      id: classes.id,
      name: classes.name,
    })
    .from(classes)
    .where(eq(classes.isActive, true))
    .orderBy(classes.name);

  for (const k of local) {
    if (!seenIds.has(k.id)) {
      list.push(k);
      seenIds.add(k.id);
    }
  }

  return c.json({ success: true, data: list });
});

teacherRoutes.get("/subjects", async (c) => {
  const user = c.get("user");
  const isStaff = user.roles.includes("guru") || user.roles.includes("walikelas");
  const isAdmin = user.roles.includes("admin") || user.roles.includes("superadmin");

  if (isStaff && !isAdmin) {
    // Ambil mapel yang dikunci untuk guru ini di tabel teacher_subjects
    const assigned = await db
      .select({
        id: subjects.id,
        name: subjects.name,
        code: subjects.code,
        type: subjects.type,
      })
      .from(teacherSubjects)
      .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
      .where(and(eq(teacherSubjects.userId, user.id), eq(subjects.isActive, true)))
      .orderBy(subjects.name);

    if (assigned.length > 0) {
      return c.json({ success: true, data: assigned, isLocked: assigned.length === 1 });
    }
  }

  // Jika tidak dikunci, kembalikan semua mapel aktif
  const all = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      code: subjects.code,
      type: subjects.type,
    })
    .from(subjects)
    .where(eq(subjects.isActive, true))
    .orderBy(subjects.name);

  return c.json({ success: true, data: all, isLocked: false });
});

teacherRoutes.get("/assessment-components", async (c) => {
  try {
    let list = await db
      .select()
      .from(assessmentComponents)
      .orderBy(asc(assessmentComponents.sortOrder), asc(assessmentComponents.createdAt));

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

teacherRoutes.get("/grades", async (c) => {
  let rawClassId = c.req.query("classId");
  const subjectId = c.req.query("subjectId");
  if (!rawClassId || !subjectId) {
    return c.json({ success: false, message: "classId and subjectId required" }, 400);
  }

  const resolvedClassId = await ensureTargetClassExists(rawClassId);
  const isResolvedUuid = isUuid(resolvedClassId);
  const isRawUuid = isUuid(rawClassId);

  const targetClassConds = [];
  if (isResolvedUuid) targetClassConds.push(eq(classes.id, resolvedClassId));
  if (isRawUuid) targetClassConds.push(eq(classes.id, rawClassId));
  targetClassConds.push(eq(classes.name, resolvedClassId));
  targetClassConds.push(eq(classes.name, rawClassId));
  targetClassConds.push(sql`LOWER(${classes.name}) = LOWER(${resolvedClassId})`);
  targetClassConds.push(sql`LOWER(${classes.name}) = LOWER(${rawClassId})`);

  const [targetClass] = await db
    .select()
    .from(classes)
    .where(or(...targetClassConds))
    .limit(1);

  const className = targetClass?.name ?? rawClassId;

  const initialConds = [];
  if (isResolvedUuid) initialConds.push(eq(students.classId, resolvedClassId));
  if (isRawUuid) initialConds.push(eq(students.classId, rawClassId));
  if (className) {
    initialConds.push(eq(students.kelasLabel, className));
    initialConds.push(sql`LOWER(${students.kelasLabel}) = LOWER(${className})`);
  }
  if (rawClassId) {
    initialConds.push(eq(students.kelasLabel, rawClassId));
    initialConds.push(sql`LOWER(${students.kelasLabel}) = LOWER(${rawClassId})`);
  }

  let roster = await db
    .select({
      studentId: students.id,
      name: students.name,
      nis: students.nis,
      nisn: students.nisn,
    })
    .from(students)
    .where(or(...initialConds))
    .orderBy(students.name);

  // Fallback 1: Jika roster belum ada di database lokal, ambil dari SSO Kredensia dan sinkronkan
  if (roster.length === 0) {
    try {
      let ssoClassId = rawClassId;
      try {
        const ssoClasses = await ssoListKelas();
        if (ssoClasses.data && Array.isArray(ssoClasses.data)) {
          const matched = ssoClasses.data.find(
            (k) =>
              k.id === rawClassId ||
              k.id === resolvedClassId ||
              k.nama_kelas.toLowerCase() === className.toLowerCase() ||
              k.nama_kelas.toLowerCase() === rawClassId.toLowerCase(),
          );
          if (matched) {
            ssoClassId = matched.id;
          }
        }
      } catch (_) {}

      const url = `${env.SSO_API_BASE_URL}/kelas/${ssoClassId}`;
      const ssoRes = await fetch(url, {
        headers: {
          "X-API-Key": env.SSO_API_KEY,
          Origin: env.FRONTEND_URL || "https://simak.sman3mjk.sch.id",
          Referer: env.FRONTEND_URL ? `${env.FRONTEND_URL}/` : "https://simak.sman3mjk.sch.id/",
        },
      });
      const json = (await ssoRes.json()) as any;

      if (json.success && json.data && Array.isArray(json.data.siswa) && json.data.siswa.length > 0) {
        for (const s of json.data.siswa) {
          try {
            const ssoMemberId = s.id || null;
            const nis = s.nip_nis || s.nis || null;
            const name = s.nama_lengkap;

            const conds = [];
            if (ssoMemberId) conds.push(eq(students.ssoMemberId, ssoMemberId));
            if (nis) conds.push(eq(students.nis, nis));
            if (name) conds.push(eq(students.name, name));

            let existing = null;
            if (conds.length > 0) {
              const found = await db
                .select()
                .from(students)
                .where(or(...conds))
                .limit(1);
              existing = found[0];
            }

            if (existing) {
              await db
                .update(students)
                .set({
                  classId: isResolvedUuid ? resolvedClassId : (existing.classId || null),
                  kelasLabel: className,
                  ssoMemberId: ssoMemberId || existing.ssoMemberId,
                  isActive: true,
                  updatedAt: new Date(),
                })
                .where(eq(students.id, existing.id));
            } else {
              await db
                .insert(students)
                .values({
                  name,
                  nis,
                  ssoMemberId,
                  classId: isResolvedUuid ? resolvedClassId : null,
                  kelasLabel: className,
                  isActive: true,
                  memberStatus: "siswa",
                })
                .onConflictDoUpdate({
                  target: students.ssoMemberId,
                  set: {
                    classId: isResolvedUuid ? resolvedClassId : null,
                    kelasLabel: className,
                    isActive: true,
                    updatedAt: new Date(),
                  },
                });
            }
          } catch (studentErr) {
            console.error("[/teacher/grades] Error upserting student from SSO:", s.nama_lengkap, studentErr);
          }
        }

        // Re-query roster setelah update/upsert
        const requeryConds = [];
        if (isResolvedUuid) requeryConds.push(eq(students.classId, resolvedClassId));
        if (isRawUuid) requeryConds.push(eq(students.classId, rawClassId));
        if (isUuid(ssoClassId)) requeryConds.push(eq(students.classId, ssoClassId));
        requeryConds.push(eq(students.kelasLabel, className));
        requeryConds.push(sql`LOWER(${students.kelasLabel}) = LOWER(${className})`);

        roster = await db
          .select({
            studentId: students.id,
            name: students.name,
            nis: students.nis,
            nisn: students.nisn,
          })
          .from(students)
          .where(or(...requeryConds))
          .orderBy(students.name);
      }
    } catch (e) {
      console.error("[/teacher/grades] Failed to sync students for class:", resolvedClassId, e);
    }
  }

  // Jika tidak ada siswa di kelas ini, kembalikan array kosong (jangan tampilkan siswa kelas lain)
  // Gunakan fitur Sync Kelas Roster di halaman Integrasi Admin untuk mengisi data.

  const gradeConds = [];
  if (isResolvedUuid) gradeConds.push(eq(grades.classId, resolvedClassId));
  if (isRawUuid) gradeConds.push(eq(grades.classId, rawClassId));
  if (gradeConds.length === 0) gradeConds.push(sql`1=0`);

  const gradeRows = await db
    .select()
    .from(grades)
    .where(
      and(
        or(...gradeConds),
        isUuid(subjectId) ? eq(grades.subjectId, subjectId) : sql`1=1`,
        isNull(grades.deletedAt),
      ),
    );

  const byStudent = new Map(gradeRows.map((g) => [g.studentId, g]));

  const data = roster.map((s) => {
    const g = byStudent.get(s.studentId);
    return {
      studentId: s.studentId,
      name: s.name,
      nis: s.nis,
      nisn: s.nisn,
      gradeId: g?.id ?? null,
      uh1: g?.uh1 ?? null,
      t1: g?.t1 ?? null,
      sts: g?.sts ?? null,
      uh2: g?.uh2 ?? null,
      t2: g?.t2 ?? null,
      status: g?.status ?? "draft",
    };
  });

  return c.json({ success: true, data });
});

const draftSchema = z.object({
  classId: z.string().min(1, "classId required"),
  subjectId: z.string().uuid("subjectId required"),
  academicYear: z.string().default("2025/2026"),
  semester: z.number().int().min(1).max(2).default(1),
  items: z.array(
    z.object({
      studentId: z.string().uuid(),
      uh1: z.union([z.string(), z.number(), z.null()]).optional(),
      t1: z.union([z.string(), z.number(), z.null()]).optional(),
      sts: z.union([z.string(), z.number(), z.null()]).optional(),
      uh2: z.union([z.string(), z.number(), z.null()]).optional(),
      t2: z.union([z.string(), z.number(), z.null()]).optional(),
    }),
  ),
});

teacherRoutes.patch("/grades/draft", async (c) => {
  const body = draftSchema.parse(await c.req.json());
  const user = c.get("user");
  const isAdmin = user.roles.includes("admin") || user.roles.includes("superadmin");

  if (!isAdmin) {
    const mySubjects = await db
      .select({ subjectId: teacherSubjects.subjectId, subjectName: subjects.name })
      .from(teacherSubjects)
      .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
      .where(eq(teacherSubjects.userId, user.id));

    if (mySubjects.length > 0 && !mySubjects.some((ms) => ms.subjectId === body.subjectId)) {
      const otherTeachers = await db
        .select({ name: users.name })
        .from(teacherSubjects)
        .innerJoin(users, eq(teacherSubjects.userId, users.id))
        .where(eq(teacherSubjects.subjectId, body.subjectId));
      const otherNames = otherTeachers.map((t) => t.name).join(", ") || "Guru Mapel Lain";
      return c.json(
        {
          success: false,
          message: `Mata pelajaran ini diampu oleh ${otherNames}. Anda hanya dapat mengubah nilai pada mata pelajaran yang Anda ampu (${mySubjects.map((m) => m.subjectName).join(", ")}).`,
        },
        403
      );
    }
  }

  const targetClassId = await ensureTargetClassExists(body.classId);
  const saved = [];

  for (const item of body.items) {
    for (const key of ["uh1", "t1", "sts", "uh2", "t2"] as const) {
      if (!isValidScore(item[key])) {
        return c.json({ success: false, message: `Nilai ${key} harus 0–100` }, 400);
      }
    }

    const [existing] = await db
      .select()
      .from(grades)
      .where(
        and(
          eq(grades.studentId, item.studentId),
          eq(grades.subjectId, body.subjectId),
          or(eq(grades.classId, targetClassId), eq(grades.classId, body.classId)),
          eq(grades.academicYear, body.academicYear),
          eq(grades.semester, body.semester),
          isNull(grades.deletedAt),
        ),
      )
      .limit(1);

    if (existing && (existing.status === "submitted" || existing.status === "approved")) {
      continue;
    }

    const sanitizeScore = (val: unknown, fallback: string | null) => {
      if (val === undefined) return fallback;
      if (val === null || val === "" || String(val).trim() === "") return null;
      return String(val).trim();
    };

    const values = {
      uh1: sanitizeScore(item.uh1, existing?.uh1 ?? null),
      t1: sanitizeScore(item.t1, existing?.t1 ?? null),
      sts: sanitizeScore(item.sts, existing?.sts ?? null),
      uh2: sanitizeScore(item.uh2, existing?.uh2 ?? null),
      t2: sanitizeScore(item.t2, existing?.t2 ?? null),
      status: "draft" as const,
      updatedAt: new Date(),
    };

    let row;
    if (existing) {
      [row] = await db.update(grades).set(values).where(eq(grades.id, existing.id)).returning();
      await db.insert(gradeAuditLogs).values({
        gradeId: row.id,
        actorId: user.id,
        action: "draft_update",
        before: existing as unknown as Record<string, unknown>,
        after: row as unknown as Record<string, unknown>,
      });
    } else {
      [row] = await db
        .insert(grades)
        .values({
          studentId: item.studentId,
          subjectId: body.subjectId,
          classId: targetClassId,
          academicYear: body.academicYear,
          semester: body.semester,
          ...values,
        })
        .onConflictDoUpdate({
          target: [
            grades.studentId,
            grades.subjectId,
            grades.classId,
            grades.academicYear,
            grades.semester,
          ],
          set: {
            ...values,
            deletedAt: null,
          },
        })
        .returning();
      await db.insert(gradeAuditLogs).values({
        gradeId: row.id,
        actorId: user.id,
        action: "draft_create",
        after: row as unknown as Record<string, unknown>,
      });
    }
    saved.push(row);
  }

  broadcastRealtimeEvent({
    type: "grade_submitted",
    classId: targetClassId,
    subjectId: body.subjectId,
    actorId: user.id,
  });

  return c.json({ success: true, data: { saved: saved.length } });
});

const submitSchema = z.object({
  classId: z.string().min(1, "classId required"),
  subjectId: z.string().uuid("subjectId required"),
  academicYear: z.string().default("2025/2026"),
  semester: z.number().int().min(1).max(2).default(1),
});teacherRoutes.post("/grades/submit", async (c) => {
  const body = submitSchema.parse(await c.req.json());
  const user = c.get("user");
  const targetClassId = await ensureTargetClassExists(body.classId);

  // 1. Ambil komponen penilaian yang aktif (misal UH1, T1, STS)
  const activeComps = await db
    .select()
    .from(assessmentComponents)
    .where(eq(assessmentComponents.status, "active"));

  const activeCodes = activeComps.map((ac) => ac.code.toLowerCase());

  // 2. Ambil baris nilai draft khusus untuk mapel dan kelas ini
  const rows = await db
    .select()
    .from(grades)
    .where(
      and(
        or(eq(grades.classId, targetClassId), eq(grades.classId, body.classId)),
        eq(grades.subjectId, body.subjectId),
        eq(grades.academicYear, body.academicYear),
        eq(grades.semester, body.semester),
        eq(grades.status, "draft"),
        isNull(grades.deletedAt),
      ),
    );

  // 3. Filter & Validasi baris per siswa:
  // - Siswa yang KOSONG TOTAL di semua kolom aktif -> Skip (biarkan draft).
  // - Siswa yang TERISI PARSIAL -> Balas Error validasi.
  // - Siswa yang TERISI LENGKAP -> Masukkan ke daftar submit.
  const toSubmitIds: string[] = [];

  if (activeCodes.length > 0) {
    for (const g of rows) {
      let filledCount = 0;
      for (const code of activeCodes) {
        const val = (g as any)[code];
        if (val !== null && val !== undefined && String(val).trim() !== "") {
          filledCount++;
        }
      }

      // Kosong total -> Skip (jangan ubah status, biarkan draft)
      if (filledCount === 0) {
        continue;
      }

      // Diisi parsial -> Tolak pengiriman
      if (filledCount < activeCodes.length) {
        const [st] = await db.select().from(students).where(eq(students.id, g.studentId)).limit(1);
        const studentName = st?.name ?? "Siswa";
        const activeNames = activeComps.map((ac) => ac.code.toUpperCase()).join(", ");

        return c.json(
          {
            success: false,
            message: `Gagal mengirim nilai. Nilai siswa '${studentName}' baru terisi sebagian. Jika seorang siswa mulai dinilai, seluruh kolom aktif (${activeNames}) wajib diisi lengkap sebelum dikirim ke Wali Kelas!`,
          },
          400,
        );
      }

      // Terisi lengkap -> Tambahkan ke list submit
      toSubmitIds.push(g.id);
    }
  } else {
    toSubmitIds.push(...rows.map((r) => r.id));
  }

  if (toSubmitIds.length === 0) {
    return c.json(
      {
        success: false,
        message: "Tidak ada data nilai yang siap dikirim. Pastikan Anda sudah menginput nilai siswa secara lengkap pada kolom aktif.",
      },
      400,
    );
  }

  // 4. Update status hanya untuk baris nilai yang lengkap (toSubmitIds)
  let submittedCount = 0;
  for (const gradeId of toSubmitIds) {
    const [g] = await db.select().from(grades).where(eq(grades.id, gradeId)).limit(1);
    if (!g) continue;

    const [updated] = await db
      .update(grades)
      .set({
        status: "submitted",
        submittedBy: user.id,
        submittedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(grades.id, gradeId))
      .returning();

    await db.insert(gradeAuditLogs).values({
      gradeId: g.id,
      actorId: user.id,
      action: "submit",
      before: g as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });
    submittedCount++;
  }

  broadcastRealtimeEvent({
    type: "grade_submitted",
    classId: targetClassId,
    subjectId: body.subjectId,
    actorId: user.id,
  });

  return c.json({ success: true, data: { submitted: submittedCount } });
});

teacherRoutes.get("/teaching-hours", async (c) => {
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

teacherRoutes.get("/journals", async (c) => {
  const user = c.get("user");
  try {
    const nowWib = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
    const todayIso = `${nowWib.getFullYear()}-${String(nowWib.getMonth() + 1).padStart(2, "0")}-${String(nowWib.getDate()).padStart(2, "0")}`;

    // 1. Perbaiki otomatis draft jurnal yang sempat tercatat di tahun 2024/2025 akibat halusinasi tanggal AI sebelumnya
    await db
      .update(teacherJournals)
      .set({ date: todayIso, updatedAt: new Date() })
      .where(
        and(
          eq(teacherJournals.teacherUserId, user.id),
          eq(teacherJournals.status, "draft"),
          isNull(teacherJournals.deletedAt),
          sql`(${teacherJournals.date} LIKE '2024-%' OR ${teacherJournals.date} LIKE '2025-%')`
        )
      );

    // 2. Bersihkan otomatis jika ada baris duplikat pada (teacher_user_id, date, teaching_hour_id)
    //    maupun (date, class_id, teaching_hour_id), pertahankan yang berstatus 'sent' atau paling baru
    await db.execute(sql`
      DELETE FROM teacher_journals
      WHERE id IN (
        SELECT id FROM (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY teacher_user_id, date, teaching_hour_id
                   ORDER BY CASE WHEN status = 'sent' THEN 0 ELSE 1 END ASC,
                            created_at DESC,
                            id DESC
                 ) AS rn
          FROM teacher_journals
          WHERE deleted_at IS NULL
            AND teacher_user_id = ${user.id}
        ) t
        WHERE t.rn > 1
      )
    `);

    const list = await db
      .select()
      .from(teacherJournals)
      .where(and(eq(teacherJournals.teacherUserId, user.id), isNull(teacherJournals.deletedAt)))
      .orderBy(desc(teacherJournals.date), desc(teacherJournals.createdAt));
    return c.json({ success: true, data: list });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

const journalSchema = z.object({
  groupId: z.string().uuid().optional().nullable(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format tanggal harus YYYY-MM-DD"),
  classId: z.string().uuid("Kelas wajib dipilih"),
  className: z.string().min(1, "Nama kelas wajib diisi"),
  startHourId: z.string().uuid("Jam mengajar awal wajib dipilih"),
  endHourId: z.string().uuid("Jam mengajar akhir wajib dipilih"),
  subjectId: z.string().uuid("Mapel wajib dipilih"),
  subjectName: z.string().min(1, "Nama mapel wajib diisi"),
  materi: z.string().default(""),
  presenceInfo: z.string().default(""),
  status: z.enum(["draft", "sent"]).default("draft"),
});

teacherRoutes.post("/journals", async (c) => {
  const user = c.get("user");
  try {
    const body = journalSchema.parse(await c.req.json());

    // 1. Ambil semua Jam Mengajar untuk mengurutkan rentang
    const hours = await db
      .select()
      .from(teachingHours)
      .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);

    let startIdx = hours.findIndex((h) => h.id === body.startHourId);
    let endIdx = hours.findIndex((h) => h.id === body.endHourId);
    if (startIdx === -1 || endIdx === -1) {
      return c.json({ success: false, message: "Jam mengajar awal atau akhir tidak valid" }, 400);
    }
    if (startIdx > endIdx) {
      const temp = startIdx;
      startIdx = endIdx;
      endIdx = temp;
    }
    const targetHours = hours.slice(startIdx, endIdx + 1);
    const targetHourIds = targetHours.map((h) => h.id);

    // Tentukan groupId
    let activeGroupId = body.groupId;

    // Cek bentrokan kebenaran absolut:
    // A. Pada kelas yang sama [date, (classId OR className), teachingHourId]
    // B. Pada guru yang sama [date, teacherUserId = user.id, teachingHourId]
    const classCondition = body.classId
      ? or(
          eq(teacherJournals.classId, body.classId),
          sql`LOWER(TRIM(${teacherJournals.className})) = LOWER(TRIM(${body.className}))`
        )
      : sql`LOWER(TRIM(${teacherJournals.className})) = LOWER(TRIM(${body.className}))`;

    const existing3DJournals = await db
      .select({
        id: teacherJournals.id,
        teacherUserId: teacherJournals.teacherUserId,
        teacherName: users.name,
        date: teacherJournals.date,
        classId: teacherJournals.classId,
        className: teacherJournals.className,
        teachingHourId: teacherJournals.teachingHourId,
        teachingHourLabel: teacherJournals.teachingHourLabel,
        subjectName: teacherJournals.subjectName,
        materi: teacherJournals.materi,
        presenceInfo: teacherJournals.presenceInfo,
        status: teacherJournals.status,
        groupId: teacherJournals.groupId,
      })
      .from(teacherJournals)
      .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
      .where(
        and(
          eq(teacherJournals.date, body.date),
          or(classCondition, eq(teacherJournals.teacherUserId, user.id)),
          inArray(teacherJournals.teachingHourId, targetHourIds),
          isNull(teacherJournals.deletedAt)
        )
      );

    // Cari bentrokan:
    // 1. Diisi oleh guru lain di kelas tersebut (teacherUserId !== user.id) -> BENTROK (baik draft maupun sent)
    // 2. Diisi oleh guru sendiri & status sent -> BENTROK (jika bukan mengedit grup yang sama)
    const conflict = existing3DJournals.find((j) => {
      if (j.teacherUserId !== user.id) return true;
      if (j.status === "sent" && (!activeGroupId || j.groupId !== activeGroupId)) return true;
      return false;
    });

    if (conflict) {
      const guruName = conflict.teacherUserId === user.id ? "Anda sendiri (Sudah Terkirim)" : (conflict.teacherName || "Guru Lain");
      const hourLabel = conflict.teachingHourLabel || "Jam Terpilih";
      const mapelName = conflict.subjectName || "Mata Pelajaran";
      const klsName = conflict.className || body.className || "Kelas";
      const prevMateri = conflict.materi ? `, Materi: "${conflict.materi}"` : "";

      return c.json(
        {
          success: false,
          conflict: true,
          message: `Jam mengajar (${hourLabel}) di kelas ${klsName} pada tanggal ${body.date} SUDAH TERISI oleh ${guruName} (Mata Pelajaran: ${mapelName}${prevMateri}). Data milik guru lain / yang sudah terkirim tidak dapat diubah.`,
        },
        409
      );
    }

    if (activeGroupId) {
      // Jika mengupdate draft grup yang sudah ada:
      const existing = await db
        .select()
        .from(teacherJournals)
        .where(eq(teacherJournals.groupId, activeGroupId));
      if (existing.some((j) => j.status === "sent")) {
        return c.json({ success: false, message: "Jurnal sudah dikirim dan tidak bisa diubah" }, 400);
      }
      // Hapus data lama dalam grup ini
      await db
        .delete(teacherJournals)
        .where(eq(teacherJournals.groupId, activeGroupId));
    } else {
      activeGroupId = crypto.randomUUID();
    }

    // Bersihkan seluruh draft milik guru ini yang beririsan pada tanggal & jam terpilih (termasuk grup draft lama yang tertimpa)
    const overlappingDrafts = existing3DJournals.filter(
      (j) => j.teacherUserId === user.id && j.status === "draft"
    );
    let replacedInfo = "";
    if (overlappingDrafts.length > 0) {
      const prevSample = overlappingDrafts[0];
      const prevHours = [...new Set(overlappingDrafts.map((d) => d.teachingHourLabel).filter(Boolean))].join(", ");
      replacedInfo = ` (Menggantikan data draft sebelumnya pada jam ${prevHours}: Mapel ${prevSample.subjectName || "-"}, Materi "${prevSample.materi || "-"}", Presensi "${prevSample.presenceInfo || "-"}" → Diganti menjadi: Mapel ${body.subjectName}, Materi "${body.materi || "-"}", Presensi "${body.presenceInfo || "-"}")`;
    }
    const overlappingGroupIds = [...new Set(overlappingDrafts.map((j) => j.groupId).filter(Boolean))] as string[];
    if (overlappingGroupIds.length > 0) {
      await db
        .delete(teacherJournals)
        .where(
          and(
            eq(teacherJournals.teacherUserId, user.id),
            eq(teacherJournals.status, "draft"),
            inArray(teacherJournals.groupId, overlappingGroupIds)
          )
        );
    }
    await db
      .delete(teacherJournals)
      .where(
        and(
          eq(teacherJournals.teacherUserId, user.id),
          eq(teacherJournals.date, body.date),
          eq(teacherJournals.status, "draft"),
          inArray(teacherJournals.teachingHourId, targetHourIds)
        )
      );

    // Insert semua jam mengajar dalam rentang
    const inserts = targetHours.map((h) => ({
      teacherUserId: user.id,
      date: body.date,
      classId: body.classId,
      className: body.className,
      teachingHourId: h.id,
      teachingHourLabel: h.label,
      subjectId: body.subjectId,
      subjectName: body.subjectName,
      groupId: activeGroupId,
      materi: body.materi,
      presenceInfo: body.presenceInfo,
      status: body.status,
    }));


    await db.insert(teacherJournals).values(inserts);

    broadcastRealtimeEvent({
      type: "journal_saved",
      classId: body.classId,
      actorId: user.id,
    });

    const baseMsg = body.status === "sent" ? "Jurnal berhasil dikirim" : "Jurnal disimpan sebagai draft";
    return c.json({ success: true, data: { groupId: activeGroupId }, message: `${baseMsg}${replacedInfo}` });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

teacherRoutes.delete("/journals/:id", async (c) => {
  const user = c.get("user");
  const id = c.req.param("id");
  try {
    const [target] = await db
      .select()
      .from(teacherJournals)
      .where(and(eq(teacherJournals.id, id), eq(teacherJournals.teacherUserId, user.id)))
      .limit(1);

    if (!target) {
      return c.json({ success: false, message: "Jurnal tidak ditemukan" }, 404);
    }
    if (target.status !== "draft") {
      return c.json({ success: false, message: "Jurnal sudah terkirim (tidak bisa dihapus)" }, 400);
    }

    let deletedRows;
    if (target.groupId) {
      deletedRows = await db
        .delete(teacherJournals)
        .where(
          and(
            eq(teacherJournals.groupId, target.groupId),
            eq(teacherJournals.teacherUserId, user.id),
            eq(teacherJournals.status, "draft")
          )
        )
        .returning();
    } else {
      deletedRows = await db
        .delete(teacherJournals)
        .where(
          and(
            eq(teacherJournals.id, id),
            eq(teacherJournals.teacherUserId, user.id),
            eq(teacherJournals.status, "draft")
          )
        )
        .returning();
    }

    broadcastRealtimeEvent({ type: "journal_deleted", actorId: user.id });

    return c.json({ success: true, data: deletedRows, message: "Draft jurnal berhasil dihapus" });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 400);
  }
});

teacherRoutes.post("/journals/bulk-send", async (c) => {
  const user = c.get("user");
  try {
    const body = await c.req.json().catch(() => ({}));
    const { date, ids } = body as { date?: string; ids?: string[] };

    const conditions = [
      eq(teacherJournals.teacherUserId, user.id),
      eq(teacherJournals.status, "draft"),
    ];

    if (Array.isArray(ids) && ids.length > 0) {
      conditions.push(inArray(teacherJournals.id, ids));
    } else if (date) {
      conditions.push(eq(teacherJournals.date, date));
    } else {
      return c.json({ success: false, message: "Parameter date atau ids wajib diisi" }, 400);
    }

    // Check draft entries to be sent
    const drafts = await db
      .select()
      .from(teacherJournals)
      .where(and(...conditions));

    if (drafts.length === 0) {
      return c.json({ success: false, message: "Tidak ada draft jurnal yang perlu dikirim" }, 400);
    }

    // Check if any draft has empty materi
    const emptyMateri = drafts.find((d) => !d.materi || !d.materi.trim());
    if (emptyMateri) {
      return c.json(
        {
          success: false,
          message: `Materi pada jam ${emptyMateri.teachingHourLabel || ""} masih kosong. Harap lengkapi materi sebelum mengirim.`,
        },
        400
      );
    }

    const updated = await db
      .update(teacherJournals)
      .set({ status: "sent", updatedAt: new Date() })
      .where(and(...conditions))
      .returning();

    broadcastRealtimeEvent({ type: "journal_saved", actorId: user.id });

    return c.json({
      success: true,
      message: `Berhasil mengirim ${updated.length} jurnal sekaligus`,
      data: updated,
    });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "error" }, 500);
  }
});

/**
 * Helper untuk menyusun konteks lengkap profil guru, mapel, dan kelas
 */
async function getTeacherAiContext(userId: string, userName: string) {
  // 1. Ambil data guru
  const [teacher] = await db.select().from(teachers).where(eq(teachers.userId, userId)).limit(1);

  // 2. Ambil mapel yang diampu guru ini
  const assignedSubjects = await db
    .select({
      id: subjects.id,
      name: subjects.name,
      code: subjects.code,
      type: subjects.type,
    })
    .from(teacherSubjects)
    .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
    .where(and(eq(teacherSubjects.userId, userId), eq(subjects.isActive, true)))
    .orderBy(subjects.name);

  // 2B. Ambil seluruh pemetaan guru mapel di sekolah (untuk cek kepemilikan mapel guru lain)
  const allSubjectTeachers = await db
    .select({
      userId: teacherSubjects.userId,
      teacherName: users.name,
      subjectId: subjects.id,
      subjectName: subjects.name,
      subjectCode: subjects.code,
    })
    .from(teacherSubjects)
    .innerJoin(subjects, eq(teacherSubjects.subjectId, subjects.id))
    .innerJoin(users, eq(teacherSubjects.userId, users.id))
    .where(and(eq(subjects.isActive, true), eq(users.isActive, true)));

  // 2C. Ambil seluruh pemetaan wali kelas di sekolah (untuk Matrix Persetujuan)
  const allHomeroomTeachers = await db
    .select({
      userId: homeroomAssignments.userId,
      teacherName: users.name,
      classId: classes.id,
      className: classes.name,
    })
    .from(homeroomAssignments)
    .innerJoin(classes, eq(homeroomAssignments.classId, classes.id))
    .innerJoin(users, eq(homeroomAssignments.userId, users.id))
    .where(and(eq(classes.isActive, true), eq(users.isActive, true)));

  // 3. Ambil kelas aktif + mapel yang diajar guru di kelas tersebut (via classSubjects)
  const taughtClasses = teacher
    ? await db
        .selectDistinct({
          classId: classSubjects.classId,
          className: classes.name,
          subjectId: classSubjects.subjectId,
          subjectName: subjects.name,
        })
        .from(classSubjects)
        .innerJoin(classes, eq(classSubjects.classId, classes.id))
        .innerJoin(subjects, eq(classSubjects.subjectId, subjects.id))
        .where(and(eq(classSubjects.teacherId, teacher.id), eq(classes.isActive, true)))
        .orderBy(classes.name, subjects.name)
    : [];

  // 4. Ambil daftar kelas aktif (umum, untuk referensi)
  const activeClasses = await db
    .select({ id: classes.id, name: classes.name, gradeLevel: classes.gradeLevel })
    .from(classes)
    .where(eq(classes.isActive, true))
    .orderBy(classes.name);

  // 5. Ambil daftar siswa (utamakan kelas yang diajar jika ada relasi spesifik, atau seluruh siswa aktif di sekolah)
  const taughtClassIds = [...new Set(taughtClasses.map((tc) => tc.classId))];
  const studentRoster = await db
    .select({
      id: students.id,
      name: students.name,
      nis: students.nis,
      nisn: students.nisn,
      classId: students.classId,
      className: classes.name,
    })
    .from(students)
    .innerJoin(classes, eq(students.classId, classes.id))
    .where(
      and(
        eq(students.isActive, true),
        taughtClassIds.length > 0 ? inArray(students.classId, taughtClassIds) : sql`1=1`
      )
    )
    .orderBy(classes.name, students.name);

  // 6. Ambil daftar admin aktif dari DB (role code: admin | superadmin)
  const adminUsers = await db
    .selectDistinct({
      id: users.id,
      name: users.name,
      email: users.email,
      roleCode: roles.code,
      roleName: roles.name,
    })
    .from(users)
    .innerJoin(userRoles, eq(userRoles.userId, users.id))
    .innerJoin(roles, eq(roles.id, userRoles.roleId))
    .where(
      and(
        eq(users.isActive, true),
        or(eq(roles.code, "admin"), eq(roles.code, "superadmin"))
      )
    )
    .orderBy(roles.code, users.name);

  // 7. Ambil daftar jam mengajar (teachingHours) — untuk resolusi jam oleh AI
  const allTeachingHours = await db
    .select({ id: teachingHours.id, label: teachingHours.label, startTime: teachingHours.startTime, endTime: teachingHours.endTime })
    .from(teachingHours)
    .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);

  // 8. Ambil jurnal terbaru (30 hari terakhir, milik sendiri maupun guru lain) — untuk cek konflik guru lain & data sebelumnya
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = thirtyDaysAgo.toISOString().slice(0, 10);
  const recentJournals = await db
    .select({
      id: teacherJournals.id,
      teacherUserId: teacherJournals.teacherUserId,
      teacherName: users.name,
      date: teacherJournals.date,
      className: teacherJournals.className,
      teachingHourLabel: teacherJournals.teachingHourLabel,
      subjectName: teacherJournals.subjectName,
      materi: teacherJournals.materi,
      presenceInfo: teacherJournals.presenceInfo,
      status: teacherJournals.status,
      groupId: teacherJournals.groupId,
    })
    .from(teacherJournals)
    .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
    .where(
      and(
        isNull(teacherJournals.deletedAt),
        sql`${teacherJournals.date} >= ${thirtyDaysAgoStr}`
      )
    )
    .orderBy(desc(teacherJournals.date), desc(teacherJournals.createdAt))
    .limit(100);

  // 8B. Ambil isi Tempat Sampah / Recycle Bin (Soft Delete: deletedAt IS NOT NULL) — Jurnal & Nilai
  const trashedJournals = await db
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
    .orderBy(desc(teacherJournals.deletedAt))
    .limit(50);

  const trashedGrades = await db
    .select({
      id: grades.id,
      studentName: students.name,
      nis: students.nis,
      className: classes.name,
      subjectName: subjects.name,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
      deletedAt: grades.deletedAt,
    })
    .from(grades)
    .innerJoin(students, eq(grades.studentId, students.id))
    .innerJoin(classes, eq(grades.classId, classes.id))
    .innerJoin(subjects, eq(grades.subjectId, subjects.id))
    .where(isNotNull(grades.deletedAt))
    .orderBy(desc(grades.deletedAt))
    .limit(50);

  // 8C. Ambil data seluruh menu Manajemen Akademik (Tahun Pelajaran, Semua Mapel, Komponen Penilaian, Statistik Sekolah)
  const [
    allSubjects,
    allAcademicYears,
    assessmentComponentsList,
    [siswaCount],
    [alumniCount],
    [keluarCount],
    [guruCount],
    [tendikCount],
  ] = await Promise.all([
    db.select({ id: subjects.id, code: subjects.code, name: subjects.name, type: subjects.type, isActive: subjects.isActive }).from(subjects).orderBy(subjects.name),
    db.select().from(academicYears).orderBy(desc(academicYears.name)),
    db.select().from(assessmentComponents).orderBy(asc(assessmentComponents.sortOrder)),
    db.select({ value: count() }).from(students).where(eq(students.memberStatus, "siswa")),
    db.select({ value: count() }).from(students).where(eq(students.memberStatus, "alumni")),
    db.select({ value: count() }).from(students).where(eq(students.memberStatus, "keluar")),
    db.select({ value: count() }).from(teachers).where(eq(teachers.staffType, "guru")),
    db.select({ value: count() }).from(teachers).where(eq(teachers.staffType, "tendik")),
  ]);

  const schoolStats = {
    totalSiswaAktif: siswaCount?.value ?? 0,
    totalAlumni: alumniCount?.value ?? 0,
    totalSiswaKeluar: keluarCount?.value ?? 0,
    totalGuru: guruCount?.value ?? 0,
    totalTendik: tendikCount?.value ?? 0,
    totalRombel: activeClasses.length,
    totalMapel: allSubjects.filter((s) => s.isActive).length,
  };

  // 9. Tentukan sapaan berdasarkan jenis kelamin
  let honorific = "Bapak/Ibu";
  let genderLabel = "Tidak Diketahui";
  const jk = teacher?.jenisKelamin?.toUpperCase();
  if (jk === "L" || jk === "LAKI-LAKI" || jk === "M") {
    honorific = "Pak";
    genderLabel = "Laki-laki";
  } else if (jk === "P" || jk === "PEREMPUAN" || jk === "F") {
    honorific = "Bu";
    genderLabel = "Perempuan";
  }

  const subjectNames =
    assignedSubjects.length > 0
      ? assignedSubjects.map((s) => s.name).join(", ")
      : "Belum ada mapel khusus yang dikunci di sistem (Mengajar umum/admin)";

  const classNames = activeClasses.map((c) => c.name).join(", ");

  return {
    teacher,
    assignedSubjects,
    allSubjectTeachers,
    allHomeroomTeachers,
    taughtClasses,
    activeClasses,
    studentRoster,
    honorific,
    genderLabel,
    subjectNames,
    classNames,
    adminUsers,
    allTeachingHours,
    recentJournals,
    trashedJournals,
    trashedGrades,
    allSubjects,
    allAcademicYears,
    assessmentComponentsList,
    schoolStats,
  };
}

/**
 * GET /api/teacher/ai/context
 * Mengambil konteks profil guru untuk inisialisasi AI di frontend
 */
teacherRoutes.get("/ai/context", async (c) => {
  const user = c.get("user");
  const ctx = await getTeacherAiContext(user.id, user.name);

  return c.json({
    success: true,
    data: {
      name: user.name,
      nip: ctx.teacher?.nip || null,
      honorific: ctx.honorific,
      gender: ctx.genderLabel,
      subjects: ctx.assignedSubjects,
      subjectNames: ctx.subjectNames,
    },
  });
});

/**
 * GET /api/teacher/ai/sessions
 * Mengambil seluruh riwayat roomchat beserta metadata file lampiran milik guru
 */
teacherRoutes.get("/ai/sessions", async (c) => {
  const user = c.get("user");
  try {
    const res = await db.execute(sql`
      SELECT id, user_id, title, messages, updated_at
      FROM ai_chat_sessions
      WHERE user_id = ${user.id}
      ORDER BY updated_at DESC
    `);
    const rows = ((res as any).rows || res || []) as Array<any>;

    // Pastikan jika ada sesi lama yang sempat ter-sync dari localStorage lintas-akun,
    // dicek apakah sapaan AI di dalamnya menyebut nama guru lain (bukan user yang sedang login).
    const currentFirstName = (user.name || "").trim().split(/\s+/)[0]?.toLowerCase() || "";
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users);

    const validRows: Array<any> = [];
    for (const r of rows) {
      const msgs = Array.isArray(r.messages) ? r.messages : [];
      const assistantTexts = msgs
        .filter((m: any) => m?.sender === "assistant" && typeof m?.text === "string")
        .map((m: any) => m.text as string)
        .join("\n");

      let leakedOwnerId: string | null = null;
      if (assistantTexts && currentFirstName) {
        const greetMatch = assistantTexts.match(/\b(?:Pak|Bu|Bapak\/Ibu|Bapak|Ibu)\s+([A-Z][a-zA-Z']+)/);
        if (greetMatch && greetMatch[1]) {
          const greetedName = greetMatch[1].toLowerCase();
          if (
            greetedName !== currentFirstName &&
            !(user.name || "").toLowerCase().includes(greetedName)
          ) {
            const matchedOwner = allUsers.find(
              (u) =>
                u.id !== user.id &&
                (u.name || "").toLowerCase().split(/\s+/)[0] === greetedName
            );
            if (matchedOwner) {
              leakedOwnerId = matchedOwner.id;
            }
          }
        }
      }

      if (leakedOwnerId) {
        // Kembalikan kepemilikan roomchat ke user aslinya di database
        await db.execute(sql`
          UPDATE ai_chat_sessions
          SET user_id = ${leakedOwnerId}
          WHERE id = ${r.id} AND user_id = ${user.id}
        `);
        await db.execute(sql`
          UPDATE ai_chat_files
          SET user_id = ${leakedOwnerId}
          WHERE session_id = ${r.id} AND user_id = ${user.id}
        `);
        continue;
      }

      validRows.push(r);
    }

    const formatted = validRows.map((r: any) => ({
      id: r.id,
      userId: user.id,
      title: r.title,
      updatedAt: r.updated_at ? new Date(r.updated_at).toLocaleString("id-ID") : "Baru saja",
      messages: Array.isArray(r.messages) ? r.messages : [],
    }));
    return c.json({ success: true, data: formatted });
  } catch (err: any) {
    console.error("[Teacher AI Sessions GET] Error:", err);
    return c.json({ success: true, data: [] });
  }
});

/**
 * POST /api/teacher/ai/sessions
 * Menyimpan/memperbarui sesi roomchat ke database agar riwayat pesan & file permanen
 * dan terikat ketat dengan user_id masing-masing pengguna.
 */
teacherRoutes.post("/ai/sessions", async (c) => {
  const user = c.get("user");
  try {
    const body = await c.req.json();
    const { id, userId, title, messages = [] } = body;
    if (!id) {
      return c.json({ success: false, message: "Session ID wajib diisi" }, 400);
    }
    if (userId && userId !== user.id) {
      return c.json({ success: false, message: "Sesi ini milik pengguna lain" }, 403);
    }

    // Simpan metadata lampiran dengan URL permanen tanpa membebani DB dengan raw base64 besar
    const cleanMessages = Array.isArray(messages)
      ? messages.map((m: any) => ({
          ...m,
          attachments: Array.isArray(m.attachments)
            ? m.attachments.map((att: any) => ({
                id: att.id,
                name: att.name,
                storedName: att.storedName,
                storageKey: att.storageKey,
                storageProvider: att.storageProvider,
                storageUrl: att.storageUrl || att.previewUrl,
                cloudUrl: att.cloudUrl,
                previewUrl: att.storageUrl || att.previewUrl,
                size: att.size,
                type: att.type,
                category: att.category,
                textPreview: att.textPreview,
              }))
            : undefined,
        }))
      : [];

    const messagesJson = JSON.stringify(cleanMessages);
    const safeTitle = (title || "Percakapan Baru").slice(0, 250);

    await db.execute(sql`
      INSERT INTO ai_chat_sessions (id, user_id, title, messages, updated_at, created_at)
      VALUES (${id}, ${user.id}, ${safeTitle}, ${messagesJson}::jsonb, NOW(), NOW())
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        messages = EXCLUDED.messages,
        updated_at = NOW()
      WHERE ai_chat_sessions.user_id = ${user.id}
    `);

    return c.json({ success: true });
  } catch (err: any) {
    console.error("[Teacher AI Sessions POST] Error:", err);
    return c.json({ success: false, message: err.message || "Gagal menyimpan sesi" }, 500);
  }
});

/**
 * POST /api/teacher/ai/upload
 * Mengunggah file lampiran roomchat secara langsung:
 * - Rename memakai UUID (`{uuid}.{ext}`)
 * - Simpan di folder khusus `ai-chat/{sessionId}/{uuid}.{ext}`
 * - Langsung masuk ke Cloud Object Storage (jika aktif) atau Folder Lokal khusus
 * - Catat di tabel `ai_chat_files` untuk manajemen siklus hidup (auto-delete saat roomchat dihapus)
 */
teacherRoutes.post("/ai/upload", async (c) => {
  const user = c.get("user");
  try {
    const body = await c.req.json();
    const { sessionId = "default", files = [] } = body;
    const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "") || "default";

    if (!Array.isArray(files) || files.length === 0) {
      return c.json({ success: false, message: "Tidak ada file untuk diunggah" }, 400);
    }

    const uploadedResults: Array<{
      clientId?: string;
      originalName: string;
      storedName: string;
      storageKey: string;
      storageUrl: string;
      cloudUrl?: string;
      provider: StorageProviderType;
      mimeType: string;
      size: number;
    }> = [];

    for (const f of files) {
      if (!f.base64) continue;
      const cleanB64 = f.base64.includes(",") ? f.base64.split(",")[1] : f.base64;
      const buf = Buffer.from(cleanB64, "base64");
      const origName = f.name || `file-${Date.now()}`;
      const mime = f.type || "application/octet-stream";

      const uploaded = await uploadFile({
        buffer: buf,
        filename: origName,
        mimeType: mime,
        folder: `ai-chat/${safeSessionId}`,
      });

      await db.execute(sql`
        INSERT INTO ai_chat_files (
          session_id, user_id, original_name, stored_name, storage_key, storage_provider, storage_url, mime_type, size_bytes
        ) VALUES (
          ${safeSessionId},
          ${user.id},
          ${origName},
          ${uploaded.storedName},
          ${uploaded.key},
          ${uploaded.provider},
          ${uploaded.url},
          ${mime},
          ${uploaded.size}
        )
      `);

      uploadedResults.push({
        clientId: f.id,
        originalName: origName,
        storedName: uploaded.storedName,
        storageKey: uploaded.key,
        storageUrl: uploaded.url,
        cloudUrl: uploaded.cloudUrl,
        provider: uploaded.provider,
        mimeType: mime,
        size: uploaded.size,
      });
    }

    return c.json({
      success: true,
      data: uploadedResults,
    });
  } catch (err: any) {
    console.error("[Teacher AI Upload] Error:", err);
    return c.json(
      { success: false, message: err.message || "Gagal mengunggah file ke penyimpanan" },
      500
    );
  }
});

/**
 * DELETE /api/teacher/ai/files
 * Menghapus satu file lampiran (misal saat pengguna membatalkan/menghapus chip file sebelum dikirim)
 */
teacherRoutes.delete("/ai/files", async (c) => {
  const user = c.get("user");
  try {
    const body = await c.req.json().catch(() => ({}));
    const { storageKey, provider } = body;
    if (!storageKey) {
      return c.json({ success: false, message: "storageKey wajib diisi" }, 400);
    }

    await deleteFile(storageKey, provider);
    await db.execute(sql`
      DELETE FROM ai_chat_files
      WHERE storage_key = ${storageKey} AND user_id = ${user.id}
    `);

    return c.json({ success: true, message: "File lampiran berhasil dihapus dari penyimpanan" });
  } catch (err: any) {
    console.error("[Teacher AI Delete File] Error:", err);
    return c.json({ success: false, message: err.message || "Gagal menghapus file" }, 500);
  }
});

/**
 * DELETE /api/teacher/ai/sessions/:sessionId
 * WAJIB: Saat roomchat dihapus, seluruh file unggahan di dalam roomchat tersebut
 * otomatis dihapus dari Cloud Object Storage maupun Folder Lokal khusus (`ai-chat/{sessionId}`)!
 */
teacherRoutes.delete("/ai/sessions/:sessionId", async (c) => {
  const user = c.get("user");
  const rawSessionId = c.req.param("sessionId");
  const safeSessionId = String(rawSessionId).replace(/[^a-zA-Z0-9_-]/g, "");

  try {
    const body = await c.req.json().catch(() => ({}));
    const extraKeys: Array<{ key: string; provider?: StorageProviderType }> = Array.isArray(body?.files)
      ? body.files
      : [];

    // 1. Ambil seluruh file yang tercatat di tabel ai_chat_files untuk roomchat ini
    const dbFilesRes = await db.execute(sql`
      SELECT storage_key, storage_provider
      FROM ai_chat_files
      WHERE session_id = ${safeSessionId} AND user_id = ${user.id}
    `);
    const dbFiles = ((dbFilesRes as any).rows || dbFilesRes || []) as Array<{
      storage_key: string;
      storage_provider: StorageProviderType;
    }>;

    // 2. Ambil juga dari JSON messages di ai_chat_sessions jika ada
    const sessionRes = await db.execute(sql`
      SELECT messages
      FROM ai_chat_sessions
      WHERE id = ${safeSessionId} AND user_id = ${user.id}
      LIMIT 1
    `);
    const sessionRows = ((sessionRes as any).rows || sessionRes || []) as Array<{ messages: any }>;
    const msgAttachments: Array<{ key: string; provider?: StorageProviderType }> = [];
    if (sessionRows[0]?.messages && Array.isArray(sessionRows[0].messages)) {
      for (const m of sessionRows[0].messages) {
        if (Array.isArray(m.attachments)) {
          for (const att of m.attachments) {
            if (att.storageKey) {
              msgAttachments.push({
                key: att.storageKey,
                provider: att.storageProvider,
              });
            }
          }
        }
      }
    }

    // 3. Gabungkan semua key unik yang harus dihapus
    const keyMap = new Map<string, StorageProviderType | undefined>();
    for (const f of dbFiles) {
      if (f.storage_key) keyMap.set(f.storage_key, f.storage_provider);
    }
    for (const f of msgAttachments) {
      if (f.key && !keyMap.has(f.key)) keyMap.set(f.key, f.provider);
    }
    for (const f of extraKeys) {
      if (f.key && !keyMap.has(f.key)) keyMap.set(f.key, f.provider);
    }

    let deletedFilesCount = 0;
    for (const [key, prov] of keyMap.entries()) {
      const ok = await deleteFile(key, prov);
      if (ok) deletedFilesCount++;
    }

    // 4. Hapus seluruh isi folder khusus `ai-chat/{sessionId}` baik di Local Disk maupun Cloud Object Storage
    const prefixDeletedCount = await deleteFolderPrefix(`ai-chat/${safeSessionId}`);

    // 5. Hapus record dari tabel ai_chat_files & ai_chat_sessions
    await db.execute(sql`
      DELETE FROM ai_chat_files
      WHERE session_id = ${safeSessionId} AND user_id = ${user.id}
    `);
    await db.execute(sql`
      DELETE FROM ai_chat_sessions
      WHERE id = ${safeSessionId} AND user_id = ${user.id}
    `);

    return c.json({
      success: true,
      message: "Roomchat beserta seluruh file unggahannya berhasil dihapus permanen.",
      data: {
        sessionId: safeSessionId,
        deletedFilesCount: Math.max(deletedFilesCount, prefixDeletedCount),
      },
    });
  } catch (err: any) {
    console.error("[Teacher AI Delete Session] Error:", err);
    return c.json(
      { success: false, message: err.message || "Gagal menghapus roomchat dan file lampiran" },
      500
    );
  }
});

/**
 * POST /api/teacher/ai/chat
 * Endpoint chat interaktif dengan Google Gemini API
 */
teacherRoutes.post("/ai/chat", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { sessionId = "default", messages = [], userPrompt, systemPromptExtra, files = [] } = body;
  const safeSessionId = String(sessionId).replace(/[^a-zA-Z0-9_-]/g, "") || "default";

  const ctx = await getTeacherAiContext(user.id, user.name);

  // Buat daftar admin berformat teks dari DB
  const adminList = ctx.adminUsers.length > 0
    ? ctx.adminUsers.map((a) => `- **${a.name}** (${a.roleName}${a.email ? `, email: ${a.email}` : ""})`).join("\n")
    : "- Data admin tidak tersedia, silakan hubungi pengelola sekolah.";

  // Buat tabel daftar kelas yang diajar guru beserta mapelnya
  const taughtClassesText =
    ctx.taughtClasses.length > 0
      ? [...new Map(ctx.taughtClasses.map((tc) => [`${tc.className}|${tc.subjectName}`, tc])).values()]
          .map((tc) => `- Kelas **${tc.className}** → Mapel **${tc.subjectName}** (classId: \`${tc.classId}\`, subjectId: \`${tc.subjectId}\`)`)
          .join("\n")
      : ctx.assignedSubjects.length > 0
      ? ctx.assignedSubjects
          .map((s) => `- Guru mengampu Mata Pelajaran **${s.name}** (${s.code}) untuk semua kelas aktif: ${ctx.classNames}`)
          .join("\n")
      : "- Belum ada penugasan kelas tercatat di sistem.";

  // Buat tabel daftar siswa yang relevan dengan konteks obrolan (Smart Filtering agar prompt tidak membengkak 85KB yang membuat AI lupa instruksi tanggal)
  const combinedChatText = [
    userPrompt || "",
    ...(Array.isArray(messages) ? messages.slice(-6).map((m: any) => m.text || m.content || "") : []),
  ]
    .join(" ")
    .toLowerCase();

  // Cari kata-kata potensial nama siswa / NIS / kelas dari percakapan
  const chatTokens = combinedChatText
    .replace(/[^a-z0-9\-\s']/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !["simpan", "jurnal", "hari", "ini", "kelas", "mapel", "jam", "pertama", "kedua", "ketiga", "sampai", "materi", "presensi", "hadir", "semua", "ubah", "nilai", "menjadi", "tolong", "pak", "bu", "siswa", "untuk", "yang", "dan", "dari"].includes(w));

  const matchedStudents = ctx.studentRoster.filter((s) => {
    const sName = s.name.toLowerCase();
    const sClass = (s.className || "").toLowerCase();
    const sClassClean = sClass.replace(/[-\s]/g, "");
    if (combinedChatText.includes(sClass) || (sClassClean && combinedChatText.includes(sClassClean))) {
      return true;
    }
    if (s.nis && combinedChatText.includes(s.nis.toLowerCase())) return true;
    if (s.nisn && combinedChatText.includes(s.nisn.toLowerCase())) return true;
    return chatTokens.some((tok) => sName.includes(tok));
  });

  const rosterToShow = matchedStudents.length > 0 ? matchedStudents.slice(0, 80) : ctx.studentRoster.slice(0, 30);

  const studentRosterText =
    rosterToShow.length > 0
      ? rosterToShow
          .map(
            (s) =>
              `| ${s.name} | ${s.nis ?? "-"} | ${s.nisn ?? "-"} | ${s.className} | \`${s.id}\` |`
          )
          .join("\n")
      : "| (Tidak ada data siswa) | - | - | - | - |";

  // Buat tabel jam mengajar (teachingHours) untuk referensi AI (rapikan label angka & sembunyikan jam dummy yang sama persis)
  const teachingHoursText =
    ctx.allTeachingHours.length > 0
      ? ctx.allTeachingHours
          .map((h, idx) => {
            const cleanLbl = /^\d+$/.test(h.label.trim()) ? `Jam ke-${h.label.trim()}` : h.label;
            const timeValid = h.startTime && h.endTime && h.startTime !== h.endTime;
            return `| ${cleanLbl} (Urutan ${idx + 1}) | ${timeValid ? h.startTime : "-"} | ${timeValid ? h.endTime : "-"} | \`${h.id}\` |`;
          })
          .join("\n")
      : "| (Belum ada data jam mengajar) | - | - | - |";

  // Buat ringkasan jurnal terbaru (30 hari) dipisah antara Milik Sendiri vs Milik Guru Lain
  const myJournalGroups = new Map<string, {
    date: string;
    className: string;
    subjectName: string;
    hours: string[];
    materi: string;
    presenceInfo: string;
    status: string;
  }>();
  const otherJournalGroups = new Map<string, {
    date: string;
    className: string;
    teacherName: string;
    subjectName: string;
    hours: string[];
    materi: string;
    status: string;
  }>();

  for (const j of ctx.recentJournals) {
    const key = j.groupId || j.id;
    if (j.teacherUserId === user.id) {
      const existing = myJournalGroups.get(key);
      if (existing) {
        if (j.teachingHourLabel && !existing.hours.includes(j.teachingHourLabel)) {
          existing.hours.push(j.teachingHourLabel);
        }
      } else {
        myJournalGroups.set(key, {
          date: j.date,
          className: j.className ?? "-",
          subjectName: j.subjectName ?? "-",
          hours: j.teachingHourLabel ? [j.teachingHourLabel] : [],
          materi: j.materi || "-",
          presenceInfo: j.presenceInfo || "-",
          status: j.status,
        });
      }
    } else {
      const existing = otherJournalGroups.get(key);
      if (existing) {
        if (j.teachingHourLabel && !existing.hours.includes(j.teachingHourLabel)) {
          existing.hours.push(j.teachingHourLabel);
        }
      } else {
        otherJournalGroups.set(key, {
          date: j.date,
          className: j.className ?? "-",
          teacherName: j.teacherName ?? "Guru Lain",
          subjectName: j.subjectName ?? "-",
          hours: j.teachingHourLabel ? [j.teachingHourLabel] : [],
          materi: j.materi || "-",
          status: j.status,
        });
      }
    }
  }

  const recentJournalsText =
    myJournalGroups.size > 0
      ? [...myJournalGroups.values()]
          .map((j) => `| ${j.date} | ${j.className} | ${j.subjectName} | ${j.hours.join(", ") || "-"} | ${j.materi} | ${j.presenceInfo} | ${j.status} |`)
          .join("\n")
      : "| (Belum ada jurnal milik Anda dalam 30 hari terakhir) | - | - | - | - | - | - |";

  const otherTeachersJournalsText =
    otherJournalGroups.size > 0
      ? [...otherJournalGroups.values()]
          .slice(0, 30)
          .map((j) => `| ${j.date} | ${j.className} | ${j.hours.join(", ") || "-"} | ${j.teacherName} | ${j.subjectName} | ${j.materi} | ${j.status} |`)
          .join("\n")
      : "| (Belum ada slot jurnal yang diisi guru lain) | - | - | - | - | - | - |";

  // Ambil data nilai & status Matrix Persetujuan saat ini untuk siswa yang relevan (rosterToShow)
  const rosterStudentIds = rosterToShow.map((s) => s.id);
  const liveGrades = rosterStudentIds.length > 0
    ? await db
        .select({
          id: grades.id,
          studentId: grades.studentId,
          studentName: students.name,
          classId: grades.classId,
          className: classes.name,
          subjectId: grades.subjectId,
          subjectName: subjects.name,
          uh1: grades.uh1,
          t1: grades.t1,
          sts: grades.sts,
          uh2: grades.uh2,
          t2: grades.t2,
          status: grades.status,
          note: grades.note,
        })
        .from(grades)
        .innerJoin(students, eq(grades.studentId, students.id))
        .innerJoin(classes, eq(grades.classId, classes.id))
        .innerJoin(subjects, eq(grades.subjectId, subjects.id))
        .where(and(inArray(grades.studentId, rosterStudentIds), isNull(grades.deletedAt)))
        .limit(100)
    : [];

  const liveGradesText =
    liveGrades.length > 0
      ? liveGrades
          .map((g) => {
            const subjTeachers = ctx.allSubjectTeachers
              .filter((st) => st.subjectId === g.subjectId)
              .map((st) => (st.userId === user.id ? `${st.teacherName} (Anda)` : `${st.teacherName} (Guru Lain)`))
              .join(", ") || "Umum";
            return `| ${g.studentName} | ${g.className} | ${g.subjectName} | ${subjTeachers} | ${g.uh1 ?? "-"} | ${g.t1 ?? "-"} | ${g.sts ?? "-"} | ${g.uh2 ?? "-"} | ${g.t2 ?? "-"} | ${g.status} |`;
          })
          .join("\n")
      : "| (Belum ada data nilai yang terinput untuk daftar siswa di atas) | - | - | - | - | - | - | - | - | - |";

  const homeroomInfoText =
    ctx.allHomeroomTeachers.length > 0
      ? ctx.allHomeroomTeachers
          .map((ht) => `- Kelas **${ht.className}** → Wali Kelas: **${ht.teacherName}** ${ht.userId === user.id ? "(Kelas Perwalian Anda)" : "(Wali Kelas Lain)"}`)
          .join("\n")
      : "- Belum ada penugasan wali kelas khusus di sistem.";

  // Ringkasan data live Tempat Sampah (Soft Delete) untuk Jurnal & Nilai
  const trashedJournalGroups = new Map<string, {
    date: string;
    className: string;
    teacherName: string;
    subjectName: string;
    hours: string[];
    materi: string;
  }>();
  for (const tj of ctx.trashedJournals) {
    const key = tj.groupId || tj.id;
    const ex = trashedJournalGroups.get(key);
    if (ex) {
      if (tj.teachingHourLabel && !ex.hours.includes(tj.teachingHourLabel)) {
        ex.hours.push(tj.teachingHourLabel);
      }
    } else {
      trashedJournalGroups.set(key, {
        date: tj.date,
        className: tj.className || "-",
        teacherName: tj.teacherName || "-",
        subjectName: tj.subjectName || "-",
        hours: tj.teachingHourLabel ? [tj.teachingHourLabel] : [],
        materi: tj.materi || "-",
      });
    }
  }

  const trashedJournalsText =
    trashedJournalGroups.size > 0
      ? [...trashedJournalGroups.values()]
          .map((tj) => `| ${tj.date} | ${tj.className} | Jam ke-${tj.hours.join(", ") || "-"} | ${tj.teacherName} | ${tj.subjectName} | ${tj.materi} | Soft Delete (Di Tempat Sampah) |`)
          .join("\n")
      : "| (Tempat Sampah Jurnal kosong — tidak ada jurnal yang di-soft-delete) | - | - | - | - | - | - |";

  const trashedGradesText =
    ctx.trashedGrades.length > 0
      ? ctx.trashedGrades
          .map((tg) => `| ${tg.studentName} (${tg.nis || "-"}) | ${tg.className} | ${tg.subjectName} | UH1:${tg.uh1 ?? "-"}, T1:${tg.t1 ?? "-"}, STS:${tg.sts ?? "-"}, UH2:${tg.uh2 ?? "-"}, T2:${tg.t2 ?? "-"} | Soft Delete (Di Tempat Sampah) |`)
          .join("\n")
      : "| (Tempat Sampah Nilai kosong — tidak ada nilai yang di-soft-delete) | - | - | - | - |";

  const allSubjectsCatalogText =
    ctx.allSubjects.length > 0
      ? ctx.allSubjects
          .map((s) => {
            const owners = ctx.allSubjectTeachers.filter((st) => st.subjectId === s.id).map((st) => st.teacherName).join(", ") || "Belum ditugaskan";
            return `- **${s.name}** (Kode: \`${s.code}\`, Tipe: ${s.type || "umum"}, Status: ${s.isActive ? "Aktif" : "Nonaktif"}) — Guru Pengampu: **${owners}**`;
          })
          .join("\n")
      : "- Belum ada data mata pelajaran.";

  const academicYearsCatalogText =
    ctx.allAcademicYears.length > 0
      ? ctx.allAcademicYears
          .map((ay) => `- **${ay.name}** (${ay.isActive ? "🟢 TAHUN PELAJARAN AKTIF SAAT INI" : "Arsip/Nonaktif"})`)
          .join("\n")
      : "- 2025/2026 (Aktif)";

  const assessmentCompText =
    ctx.assessmentComponentsList.length > 0
      ? ctx.assessmentComponentsList
          .map((ac) => `${ac.name} (\`${ac.code}\` - ${ac.type}, status: ${ac.status})`)
          .join(", ")
      : "UH1, T1, STS, UH2, T2";

  // Hitung tanggal & waktu server saat ini dalam zona waktu WIB (Asia/Jakarta)
  const nowWib = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Jakarta" }));
  const todayIso = `${nowWib.getFullYear()}-${String(nowWib.getMonth() + 1).padStart(2, "0")}-${String(nowWib.getDate()).padStart(2, "0")}`;
  const todayReadable = nowWib.toLocaleDateString("id-ID", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const isAdminUser = user.roles.includes("admin") || user.roles.includes("superadmin");
  const isSuperadmin = user.roles.includes("superadmin");
  const roleAuthorityLabel = isSuperadmin
    ? "SUPERADMIN (Otoritas Penuh Seluruh Sistem SIMAK)"
    : isAdminUser
      ? "ADMIN (Otoritas Manajemen Akademik)"
      : `GURU / WALI KELAS (${user.roles.join(", ")})`;

  const roleSpecificRulesText = isAdminUser
    ? `## 👑 OTORITAS KHUSUS ROLE ANDA SAAT INI: ${roleAuthorityLabel}
1. **HAK AKSES PENUH LINTAS GURU & KELAS (SESUAI OTORITAS SISTEM):**
   - Karena ${ctx.honorific} ${user.name} login sebagai **${isSuperadmin ? "Superadmin" : "Admin"}**, Anda **DIIZINKAN SEPENUHNYA** mengakses dan mengelola seluruh fitur SIMAK, termasuk membuat, mengubah, menimpa (ke draft), membuka kunci (\`sent\`/\`submitted\`/\`approved\` ➔ \`draft\`), menghapus ke Tempat Sampah (*Soft Delete*), memulihkan dari Tempat Sampah (*Restore*), maupun menghapus permanen dari Tempat Sampah (*Permanent Delete*) untuk data guru mana pun dan di kelas mana pun!
2. **WAJIB AUTO-SAVE DRAFT & LAPORKAN RINCIAN (BEFORE → AFTER) SAAT MENGUBAH DATA:**
   - Setiap kali diminta mengisi atau mengubah nilai (\`SAVE_GRADE_DRAFT\`), jurnal (\`SAVE_JOURNAL_DRAFT\`), atau matrix (\`SAVE_MATRIX_DRAFT\`), langsung simpan sebagai **draft** dan laporkan **Data Sebelumnya (termasuk Nama Guru Pengisi Sebelumnya & Isi Lama)** ➔ **Diganti Menjadi Apa**.
3. **🛡️ WAJIB VERIFIKASI 2 LANGKAH (TWO-STEP CONFIRMATION) UNTUK SEMUA AKSI PENGHAPUSAN (HAPUS DATA AKTIF MAUPUN HAPUS TEMPAT SAMPAH):**
   - **Kasus 1 — Menghapus Data Aktif (Jurnal Mengajar \`DELETE_JOURNAL\` atau Nilai Siswa \`DELETE_GRADE\`):**
     - **Langkah 1 (Saat pengguna baru pertama kali meminta hapus):** Tampilkan rincian data yang akan dihapus, lalu **tanyakan kembali apakah yakin ingin menghapusnya**, dan jelaskan bahwa **jika Ya, data akan masuk ke Tempat Sampah (Soft Delete)** (\`/admin/trash\`) sehingga masih bisa dipulihkan kembali.
     - **Langkah 2 (Setelah pengguna menjawab konfirmasi seperti "Ya", "Yakin", "Lanjutkan", "Hapus"):** Sertakan blok \`DELETE_JOURNAL\` atau \`DELETE_GRADE\` untuk memindahkan data ke **Soft Delete (Tempat Sampah)**.
   - **Kasus 2 — Menghapus Data di Tempat Sampah / Soft Delete (\`PERMANENT_DELETE_TRASH\`):**
     - **Langkah 1 (Saat pengguna baru pertama kali meminta hapus data soft delete / kosongkan Tempat Sampah):** Tampilkan daftar data di Tempat Sampah saat ini, lalu **tanyakan konfirmasi kembali dengan peringatan keras** bahwa **data di Tempat Sampah (Soft Delete) yang dihapus lagi akan hilang secara PERMANEN dari database dan TIDAK BISA DIKEMBALIKAN LAGI!**
     - **Langkah 2 (Setelah pengguna menjawab konfirmasi seperti "Ya, yakin hapus permanen"):** Sertakan blok \`PERMANENT_DELETE_TRASH\` untuk menghapusnya secara permanen.
   - **Kasus 3 — Memulihkan Data dari Tempat Sampah (\`RESTORE_TRASH\`) & Anti-Data Tumpuk:**
      - Sebelum memulihkan jurnal dari Tempat Sampah, sistem dan AI **WAJIB** memastikan slot kelas, tanggal, dan jam mengajar tersebut belum terisi oleh jurnal baru.
      - 🚫 **DILARANG KERAS MENUMPUK 2 JURNAL DI KELAS & JAM YANG SAMA!** Menumpuk data akan membuat tampilan antara Guru dan Admin Monitoring Jurnal tidak sinkron.
      - Jika slot tersebut saat ini sudah terisi jurnal baru:
        - AI **WAJIB** memberi tahu adanya bentrokan slot secara transparan (sebutkan isi data baru yang sedang aktif vs data lama di Tempat Sampah).
        - Tanyakan apakah pengguna ingin mempertahankan data baru atau menimpa data baru tersebut dengan data lama (balas "Ya, timpa dengan data lama").
      - Sertakan blok \`RESTORE_TRASH\` untuk mengeksekusi pemulihan data jika slot aman/kosong atau jika pengguna mengonfirmasi untuk menimpa.`
    : `## ⚠️ ATURAN WAJIB DI SEMUA MENU (MATRIX PERSETUJUAN, INPUT NILAI, JURNAL GURU):
1. **JIKA SUDAH DIISI OLEH GURU LAIN (BUKAN MILIK SENDIRI):**
   - **JANGAN DIRUBAH / JANGAN DIHAPUS / JANGAN DITIMPA!**
   - Informasikan secara jelas kepada ${ctx.honorific} ${user.name.split(" ")[0]} bahwa data tersebut sudah diisi/diampu oleh **Guru Lain** (sebutkan nama gurunya, mapelnya, dan isi data yang sudah tercatat).
2. **JIKA MILIK DIRI SENDIRI & SEBELUMNYA SUDAH ADA ISINYA (STATUS DRAFT):**
   - **WAJIB AUTO-SAVE DRAFT!** Tetap sertakan blok \`\`\`action ...\`\`\` agar sistem langsung memperbarui draft di database secara otomatis tanpa perlu menunda.
   - **WAJIB BERIKAN INFORMASI PERBANDINGAN (BEFORE → AFTER):** Jelaskan secara transparan bahwa slot/data tersebut sebelumnya sudah ada isinya, sebutkan **Data Sebelumnya terisi apa**, dan **Diganti Menjadi apa** sesuai permintaan terbaru!
3. **JIKA MILIK DIRI SENDIRI TETAPI SUDAH TERKUNCI (\`sent\` / \`submitted\` / \`approved\`):**
   - **JANGAN DIRUBAH / JANGAN DIHAPUS!** Informasikan isi data sebelumnya dan jelaskan bahwa statusnya sudah terkunci (arahkan ke Wali Kelas untuk buka kunci ke Draft di Matrix Persetujuan atau hubungi Admin).
4. **VERIFIKASI 2 LANGKAH SAAT MENGHAPUS DRAFT MILIK SENDIRI:**
   - Jika ${ctx.honorific} ${user.name.split(" ")[0]} meminta menghapus draft jurnal miliknya sendiri, tanyakan konfirmasi 2 langkah terlebih dahulu sebelum menghapus.`;

  const systemInstruction = `Anda adalah **NEBULA AI**, Asisten AI Resmi SIMAK (Sistem Informasi Manajemen Akademik) SMA Negeri 3 Mojokerto (SMAGA) yang memiliki pengetahuan menyeluruh atas **SELURUH FITUR & MENU SIMAK**.
- **NAMA RESMI ANDA ADALAH: NEBULA AI** (bukan Gemini!). Jika ditanya siapa Anda atau apa nama AI ini, selalu perkenalkan diri sebagai **NEBULA AI**, Asisten Cerdas Resmi SIMAK SMA Negeri 3 Mojokerto.

## 🗓️ INFORMASI WAKTU SERVER SAAT INI (WAJIB DIGUNAKAN)
- **Hari & Tanggal Hari Ini:** ${todayReadable}
- **Format Tanggal ISO Hari Ini (YYYY-MM-DD):** \`${todayIso}\`
- ⚠️ **PENTING:** Setiap kali pengguna menyebut "hari ini", "sekarang", atau tidak menyebutkan tanggal spesifik saat mencatat/menghapus jurnal mengajar, Anda **WAJIB** menggunakan tanggal **\`${todayIso}\`** (${todayReadable}). **DILARANG KERAS** menebak atau mengarang tahun 2024/2025 atau tanggal lain!

## Identitas Pengguna yang Sedang Login
- Nama Lengkap: ${user.name}
- User ID: ${user.id}
- Role & Otoritas Sistem: **${roleAuthorityLabel}**
- Sapaan: ${ctx.honorific} ${user.name} (jenis kelamin: ${ctx.genderLabel}) — WAJIB konsisten menggunakan "${ctx.honorific}"
- NIP: ${ctx.teacher?.nip || "Tidak tercatat"}
- Mata Pelajaran Resmi yang Diampu: ${ctx.subjectNames}

## 🧭 PETA LENGKAP SELURUH MENU & FITUR SIMAK SMAGA (PENGETAHUAN SISTEM)
1. **NEBULA AI** (\`/guru/ai\`) — Asisten cerdas multimodal (teks, Excel, gambar, PDF) untuk otomatisasi pengisian nilai, jurnal mengajar, matrix persetujuan, monitoring jurnal, dan manajemen Tempat Sampah (Soft Delete).
2. **Dashboard Utama** (\`/admin\`) — Ringkasan statistik real-time sekolah:
   - Siswa Aktif: **${ctx.schoolStats.totalSiswaAktif}** | Alumni: **${ctx.schoolStats.totalAlumni}** | Siswa Keluar: **${ctx.schoolStats.totalSiswaKeluar}**
   - Total Guru: **${ctx.schoolStats.totalGuru}** | Tendik: **${ctx.schoolStats.totalTendik}** | Rombel Aktif: **${ctx.schoolStats.totalRombel}** | Mapel Aktif: **${ctx.schoolStats.totalMapel}**
3. **Siswa & Pengguna** (\`/admin/students\`, \`/admin/alumni\`, \`/admin/keluar\`) — Manajemen biodata siswa aktif, alumni, siswa keluar/mutasi, akun pengguna & role, sinkronisasi SSO Kredensia, poin GDS (Gerakan Disiplin Sekolah), serta rekap kehadiran (Sakit/Izin/Alpa).
4. **Tahun Pelajaran** (\`/admin/academic-years\`) — Pengelolaan siklus tahun akademik, aktivasi tahun berjalan, kenaikan kelas (promotion), dan kelulusan alumni:
${academicYearsCatalogText}
5. **Data Rombel** (\`/admin/classes\`) — Manajemen kelas/rombel (${ctx.classNames}), tingkat kelas (X, XI, XII), jurusan, dan penugasan Wali Kelas.
6. **Mapel & Penugasan** (\`/admin/subjects\`) — Manajemen mata pelajaran, penugasan Guru Mapel (\`teacher_subjects\`), penugasan Wali Kelas (\`homeroom_assignments\`), dan konfigurasi Komponen Penilaian (${assessmentCompText}):
${allSubjectsCatalogText}
7. **Monitoring Jurnal** (\`/admin/monitoring-jurnal\`) — Pemantauan keterisian jurnal mengajar harian seluruh kelas dari Jam ke-1 s.d. Jam ke-11, fitur **Koreksi Ulang** (mengembalikan status \`sent\` ke \`draft\`), edit materi/presensi oleh Admin, dan hapus jurnal ke Tempat Sampah (*Soft Delete*).
8. **Matrix Persetujuan** (\`/walikelas\`) — Menu Wali Kelas & Superadmin untuk memantau progres nilai seluruh mata pelajaran di kelas perwalian, menyetujui nilai (\`submitted\` ➔ \`approved\`), atau menolak/membuka kunci nilai (\`submitted\`/\`approved\` ➔ \`draft\`) untuk koreksi ulang.
9. **Input Nilai** (\`/guru\`) — Menu Guru Mapel & Superadmin untuk mengisi komponen nilai (\`UH1, T1, STS, UH2, T2\`), simpan otomatis sebagai **Draft**, impor/ekspor template Excel nilai, dan kirim nilai final (\`draft\` ➔ \`submitted\`).
10. **Jurnal Guru** (\`/guru/jurnal\`) — Menu Guru & Superadmin untuk mencatat jurnal mengajar harian (Tanggal, Kelas, Mapel, Rentang Jam Mengajar, Materi, Presensi Siswa), simpan sebagai **Draft**, atau kirim resmi (\`sent\`).
11. **Update & Backup** (\`/admin/app-update\`, \`/admin/backup-restore\`) — Menu khusus Superadmin untuk publikasi versi pembaruan aplikasi SIMAK, ekspor *Full Backup* database (JSON), dan *Restore* database.
12. **Integrasi** (\`/admin/integrations\`) — Menu khusus Superadmin untuk konfigurasi integrasi Kredensia SSO, sinkronisasi otomatis Poin GDS & Kehadiran siswa, Google OAuth, serta manajemen API Key NEBULA AI.
13. **Tempat Sampah / Recycle Bin** (\`/admin/trash\`) — Menu khusus Superadmin untuk mengelola data Jurnal Mengajar dan Nilai Siswa yang berstatus **Soft Delete**:
    - Data yang dihapus dari menu aktif tidak langsung hilang, melainkan masuk ke **Tempat Sampah (Soft Delete)** dan dapat **Dipulihkan (Restore)** kembali.
    - Jika data di dalam **Tempat Sampah** dihapus lagi (**Hapus Permanen / Kosongkan Tempat Sampah**), maka data akan terhapus dari database secara permanen dan **TIDAK BISA DIKEMBALIKAN LAGI**.

## Penugasan Kelas & Mata Pelajaran Anda
${taughtClassesText}

## 🏫 Daftar Wali Kelas (Menu Matrix Persetujuan)
${homeroomInfoText}

## 📋 Daftar Siswa Aktif Sekolah
| Nama Lengkap | NIS | NISN | Kelas | ID (UUID) |
|---|---|---|---|---|
${studentRosterText}

## 📊 Data Live Saat Ini: Input Nilai & Matrix Persetujuan
| Siswa | Kelas | Mapel | Pengampu Mapel | UH1 | T1 | STS | UH2 | T2 | Status |
|---|---|---|---|---|---|---|---|---|---|
${liveGradesText}

## ⏰ Daftar Jam Mengajar (Teaching Hours)
| Label | Jam Mulai | Jam Selesai | ID (UUID) |
|---|---|---|---|
${teachingHoursText}

## 📓 Riwayat Jurnal Mengajar Aktif Milik Anda Sendiri (30 Hari Terakhir)
| Tanggal | Kelas | Mapel | Jam Mengajar | Materi Sebelumnya | Presensi Sebelumnya | Status |
|---|---|---|---|---|---|---|
${recentJournalsText}

## 📋 Slot Jurnal Mengajar Aktif yang Diisi oleh Guru Lain
| Tanggal | Kelas | Jam Mengajar | Diisi Oleh Guru | Mapel | Materi | Status |
|---|---|---|---|---|---|---|
${otherTeachersJournalsText}

## 🗑️ Isi Tempat Sampah (Soft Delete) Saat Ini — Jurnal Mengajar (\`/admin/trash\`)
| Tanggal | Kelas | Jam Mengajar | Guru | Mapel | Materi | Status |
|---|---|---|---|---|---|---|
${trashedJournalsText}

## 🗑️ Isi Tempat Sampah (Soft Delete) Saat Ini — Nilai Siswa (\`/admin/trash\`)
| Siswa | Kelas | Mapel | Rincian Nilai | Status |
|---|---|---|---|---|
${trashedGradesText}

${roleSpecificRulesText}

## 🔍 FORMAT ACTION BLOCK UNTUK EKSEKUSI DATABASE (WAJIB SERTAKAN BLOK INI)

### A. Menu Input Nilai (\`SAVE_GRADE_DRAFT\`)
- Jika identitas siswa tunggal & data lengkap, buat ACTION BLOCK:
  \`\`\`action
  SAVE_GRADE_DRAFT
  student_id: <UUID siswa dari tabel Daftar Siswa di atas>
  siswa: <Nama Lengkap Siswa>
  kelas: <Nama Kelas, contoh: X-1>
  mapel: <Nama Mapel, contoh: RPL>
  field: <uh1 | t1 | sts | uh2 | t2>
  nilai: <angka 0-100>
  tahun: 2025/2026
  semester: 1
  \`\`\`

### B. Menu Jurnal Guru — Simpan / Ubah Draft (\`SAVE_JOURNAL_DRAFT\`)
- Jika kelas, mapel, jam, materi, dan presensi sudah disebutkan, **WAJIB** buat ACTION BLOCK:
  \`\`\`action
  SAVE_JOURNAL_DRAFT
  tanggal: <YYYY-MM-DD, gunakan ${todayIso} untuk hari ini>
  kelas: <Nama Kelas, contoh: X-1>
  mapel: <Nama Mapel, contoh: RPL>
  jam_awal_id: <UUID atau angka urutan jam awal>
  jam_akhir_id: <UUID atau angka urutan jam akhir>
  materi: <Deskripsi materi yang diajarkan>
  presensi: <Informasi kehadiran siswa>
  \`\`\`

### C. Menu Jurnal Guru & Monitoring Jurnal — Hapus Jurnal ke Soft Delete (\`DELETE_JOURNAL\`)
- Sertakan blok ini saat pengguna meminta menghapus jurnal aktif (sistem otomatis menerapkan **Verifikasi 2 Langkah** sebelum memindahkan ke Tempat Sampah / Soft Delete):
  \`\`\`action
  DELETE_JOURNAL
  tanggal: <YYYY-MM-DD, gunakan ${todayIso} untuk hari ini>
  kelas: <Nama Kelas seperti X-1, atau "SEMUA" jika menghapus semua kelas>
  jam_awal_id: <Angka urutan jam / UUID, atau "SEMUA" jika semua jam>
  jam_akhir_id: <Angka urutan jam / UUID, atau "SEMUA" jika semua jam>
  \`\`\`

### D. Menu Matrix Persetujuan — Buka Kunci / Kembalikan ke Draft (\`SAVE_MATRIX_DRAFT\`)
- Ketika pengguna meminta mengubah status nilai siswa/kelas di **Matrix Persetujuan** kembali ke **Draft**:
  \`\`\`action
  SAVE_MATRIX_DRAFT
  kelas: <Nama Kelas, contoh: X-1>
  siswa: <Nama Siswa atau "SEMUA" jika satu kelas>
  mapel: <Nama Mapel atau "SEMUA">
  catatan: <Catatan revisi/koreksi ulang>
  \`\`\`

### E. Menu Input Nilai / Admin — Hapus Nilai Siswa ke Soft Delete (\`DELETE_GRADE\`)
- Ketika pengguna meminta menghapus data nilai siswa (otomatis melalui **Verifikasi 2 Langkah** ke Tempat Sampah / Soft Delete):
  \`\`\`action
  DELETE_GRADE
  kelas: <Nama Kelas, contoh: X-1>
  siswa: <Nama Siswa atau "SEMUA">
  mapel: <Nama Mapel atau "SEMUA">
  \`\`\`

### F. Menu Tempat Sampah (\`/admin/trash\`) — Pulihkan Data Soft Delete (\`RESTORE_TRASH\`)
- Ketika Superadmin meminta memulihkan (*restore*) data dari Tempat Sampah kembali ke aktif:
  \`\`\`action
  RESTORE_TRASH
  tipe: <JURNAL | NILAI | SEMUA>
  tanggal: <YYYY-MM-DD atau "SEMUA">
  kelas: <Nama Kelas atau "SEMUA">
  \`\`\`

### G. Menu Tempat Sampah (\`/admin/trash\`) — Hapus Permanen Data Soft Delete (\`PERMANENT_DELETE_TRASH\`)
- Ketika Superadmin meminta menghapus data yang ada di Tempat Sampah / Soft Delete secara permanen (otomatis melalui **Verifikasi 2 Langkah** dengan peringatan tidak bisa dikembalikan lagi):
  \`\`\`action
  PERMANENT_DELETE_TRASH
  tipe: <JURNAL | NILAI | SEMUA>
  tanggal: <YYYY-MM-DD atau "SEMUA">
  kelas: <Nama Kelas atau "SEMUA">
  \`\`\`

## 🚫 LARANGAN KERAS — ANTI HALLUSINASI DATABASE
- **JANGAN PERNAH** mengklaim data tersimpan/terhapus/dipulihkan tanpa menyertakan blok \`\`\`action ...\`\`\`.
- **PENTING — FILE EXCEL / GAMBAR YANG DIUNGGAH GURU:** Apabila ${ctx.honorific} ${user.name} mengunggah file Excel nilai atau gambar tabel nilai, **WAJIB proses/simpan nilainya** menggunakan \`SAVE_GRADE_DRAFT\`.

## 👤 Daftar Admin Aktif SIMAK
${adminList}
${systemPromptExtra ? `\n## Instruksi Tambahan\n${systemPromptExtra}` : ""}`;


  // Format riwayat pesan untuk Gemini (dengan sanitasi error & alternasi user-model yang ketat)
  const rawList: Array<{ role: "user" | "model"; text: string }> = [];
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg.text && !msg.content) continue;
      const text = (msg.text || msg.content || "").trim();
      if (!text) continue;
      // Abaikan hanya pesan error koneksi frontend agar tidak menghapus pesan konfirmasi verifikasi 2 langkah
      if (text.startsWith("⚠️ Gagal") || text.startsWith("⚠️ Terjadi kesalahan")) continue;

      if (msg.sender === "user" || msg.role === "user") {
        rawList.push({ role: "user", text });
      } else if (msg.sender === "assistant" || msg.role === "model") {
        rawList.push({ role: "model", text });
      }
    }
  }

  // Jika ada userPrompt yang belum masuk di ujung messages
  if (userPrompt) {
    const promptText = userPrompt.trim();
    if (promptText && (!rawList.length || rawList[rawList.length - 1].text !== promptText)) {
      rawList.push({ role: "user", text: promptText });
    }
  }

  // Normalisasi urutan: Gemini mewajibkan giliran bergantian (user -> model -> user -> model -> user)
  const chatMessages: Array<{ role: "user" | "model"; text: string }> = [];
  for (const item of rawList) {
    if (chatMessages.length === 0) {
      if (item.role === "user") {
        chatMessages.push(item);
      }
    } else {
      const prev = chatMessages[chatMessages.length - 1];
      if (prev.role === item.role) {
        // Gabungkan pesan berurutan dengan role sama
        prev.text = `${prev.text}\n\n${item.text}`;
      } else {
        chatMessages.push(item);
      }
    }
  }

  // Pastikan pesan terakhir adalah user
  if (chatMessages.length === 0 || chatMessages[chatMessages.length - 1].role !== "user") {
    if (userPrompt && userPrompt.trim()) {
      chatMessages.push({ role: "user", text: userPrompt.trim() });
    } else if (Array.isArray(files) && files.length > 0) {
      chatMessages.push({
        role: "user",
        text: "Mohon analisis dan jelaskan isi dari berkas yang saya lampirkan ini.",
      });
    }
  }

  if (chatMessages.length === 0) {
    return c.json({ success: false, message: "Pesan tidak boleh kosong" }, 400);
  }

  try {
    // Store uploaded files into Object Storage (if active) or Dedicated Local Folder (`ai-chat/{sessionId}`)
    // with UUID renaming (`{uuid}.{ext}`) if not already uploaded via `/ai/upload`
    const storedFiles: Array<{
      clientId?: string;
      originalName: string;
      storedName: string;
      storageKey: string;
      storageUrl: string;
      cloudUrl?: string;
      provider: string;
    }> = [];

    if (Array.isArray(files) && files.length > 0) {
      for (const f of files) {
        if (f.storageKey && f.storageUrl) {
          // Already uploaded immediately when attached in the roomchat
          storedFiles.push({
            clientId: f.id,
            originalName: f.name,
            storedName: f.storedName || f.storageKey.split("/").pop() || f.name,
            storageKey: f.storageKey,
            storageUrl: f.storageUrl,
            cloudUrl: f.cloudUrl,
            provider: f.storageProvider || "local",
          });
        } else if (f.base64) {
          try {
            const cleanB64 = f.base64.includes(",") ? f.base64.split(",")[1] : f.base64;
            const buf = Buffer.from(cleanB64, "base64");
            const origName = f.name || `file-${Date.now()}`;
            const mime = f.type || "application/octet-stream";

            const uploaded = await uploadFile({
              buffer: buf,
              filename: origName,
              mimeType: mime,
              folder: `ai-chat/${safeSessionId}`,
            });

            await db.execute(sql`
              INSERT INTO ai_chat_files (
                session_id, user_id, original_name, stored_name, storage_key, storage_provider, storage_url, mime_type, size_bytes
              ) VALUES (
                ${safeSessionId},
                ${user.id},
                ${origName},
                ${uploaded.storedName},
                ${uploaded.key},
                ${uploaded.provider},
                ${uploaded.url},
                ${mime},
                ${uploaded.size}
              )
            `);

            storedFiles.push({
              clientId: f.id,
              originalName: origName,
              storedName: uploaded.storedName,
              storageKey: uploaded.key,
              storageUrl: uploaded.url,
              cloudUrl: uploaded.cloudUrl,
              provider: uploaded.provider,
            });
          } catch (uploadErr: any) {
            console.warn("[Teacher AI Chat] File storage warning:", uploadErr.message);
          }
        }
      }
    }

    const geminiMessages = chatMessages.map((m, idx) =>
      idx === chatMessages.length - 1
        ? {
            ...m,
            text: `${m.text}\n\n[Catatan Sistem: Tanggal hari ini di server adalah ${todayIso} (${todayReadable}). Jika pengguna meminta jurnal/data hari ini, WAJIB gunakan tanggal ${todayIso}, jangan gunakan tahun 2024/2025.]`,
          }
        : m
    );

    const rawReply = await askGemini({
      systemInstruction,
      messages: geminiMessages,
      files,
    });

    // =========================================================
    // ACTION PARSER: Ekstrak blok action dari reply AI
    // Format yang diharapkan dari AI:
    //   ```action
    //   SAVE_GRADE_DRAFT
    //   siswa: Angelica Putri Savira
    //   kelas: X-1
    //   mapel: RPL
    //   field: sts
    //   nilai: 100
    //   tahun: 2025/2026
    //   semester: 1
    //   ```
    // =========================================================
    // =========================================================
    // HELPER 1 (MENU INPUT NILAI & MATRIX): Simpan draft nilai
    // =========================================================
    async function executeSaveGradeDraft(params: {
      studentIdOrName?: string;
      nis?: string;
      nisn?: string;
      className: string;
      subjectName: string;
      field: string;
      score: number;
      academicYear?: string;
      semester?: number;
    }): Promise<{ success: boolean; message: string; data?: any }> {
      const { studentIdOrName, nis, className, subjectName, field, score } = params;

      const validFields = ["uh1", "t1", "sts", "uh2", "t2"] as const;
      type GradeField = (typeof validFields)[number];
      let fieldKey = (field || "").toLowerCase().replace(/\s/g, "");
      if (fieldKey.includes("sts")) fieldKey = "sts";
      else if (fieldKey.includes("uh1")) fieldKey = "uh1";
      else if (fieldKey.includes("t1")) fieldKey = "t1";
      else if (fieldKey.includes("uh2")) fieldKey = "uh2";
      else if (fieldKey.includes("t2")) fieldKey = "t2";

      if (!validFields.includes(fieldKey as GradeField) || isNaN(score) || score < 0 || score > 100) {
        return { success: false, message: `Komponen penilaian (${field}) atau nilai (${score}) tidak valid.` };
      }

      // 1. Resolve Class
      const cleanClass = className.replace(/[-\s]/g, "").toLowerCase();
      const classConds = [
        sql`lower(${classes.name}) = lower(${className})`,
        sql`replace(replace(lower(${classes.name}), '-', ''), ' ', '') = ${cleanClass}`,
      ];
      if (isUuid(className)) {
        classConds.push(eq(classes.id, className));
      }

      const [resolvedClass] = await db
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(or(...classConds))
        .limit(1);

      if (!resolvedClass) {
        return { success: false, message: `Kelas "${className}" tidak ditemukan di database.` };
      }

      // 2. Resolve Subject
      const subjectConds = [
        sql`lower(${subjects.name}) = lower(${subjectName})`,
        sql`lower(${subjects.code}) = lower(${subjectName})`,
        sql`lower(${subjects.name}) like lower(${'%' + subjectName + '%'})`,
      ];
      if (isUuid(subjectName)) {
        subjectConds.push(eq(subjects.id, subjectName));
      }

      const [resolvedSubject] = await db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(or(...subjectConds))
        .limit(1);

      if (!resolvedSubject) {
        return { success: false, message: `Mata pelajaran "${subjectName}" tidak ditemukan di database.` };
      }

      // 3. Resolve Student
      let resolvedStudent: { id: string; name: string } | undefined;
      if (studentIdOrName && isUuid(studentIdOrName)) {
        const [found] = await db
          .select({ id: students.id, name: students.name })
          .from(students)
          .where(eq(students.id, studentIdOrName))
          .limit(1);
        resolvedStudent = found;
      }

      if (!resolvedStudent && (nis || studentIdOrName)) {
        const nisSearch = nis || studentIdOrName!;
        const [found] = await db
          .select({ id: students.id, name: students.name })
          .from(students)
          .where(and(or(eq(students.nis, nisSearch), eq(students.nisn, nisSearch)), eq(students.classId, resolvedClass.id)))
          .limit(1);
        resolvedStudent = found;
      }

      if (!resolvedStudent && studentIdOrName) {
        const [found] = await db
          .select({ id: students.id, name: students.name })
          .from(students)
          .where(
            and(
              sql`lower(${students.name}) like lower(${'%' + studentIdOrName.trim() + '%'})`,
              eq(students.classId, resolvedClass.id)
            )
          )
          .limit(1);
        resolvedStudent = found;
      }

      if (!resolvedStudent && studentIdOrName) {
        const [found] = await db
          .select({ id: students.id, name: students.name })
          .from(students)
          .where(sql`lower(${students.name}) like lower(${'%' + studentIdOrName.trim() + '%'})`)
          .limit(1);
        resolvedStudent = found;
      }

      if (!resolvedStudent) {
        return { success: false, message: `Siswa "${studentIdOrName || nis}" tidak ditemukan di kelas "${resolvedClass.name}".` };
      }

      // 4. Ambil data nilai yang sudah ada di database (jika ada)
      const ay = params.academicYear || "2025/2026";
      const sem = params.semester || 1;

      const [existing] = await db
        .select()
        .from(grades)
        .where(
          and(
            eq(grades.studentId, resolvedStudent.id),
            eq(grades.subjectId, resolvedSubject.id),
            eq(grades.classId, resolvedClass.id),
            isNull(grades.deletedAt)
          )
        )
        .limit(1);

      const formatRekap = (g?: typeof grades.$inferSelect | null) =>
        g
          ? `UH1: ${g.uh1 ?? "-"}, T1: ${g.t1 ?? "-"}, STS: ${g.sts ?? "-"}, UH2: ${g.uh2 ?? "-"}, T2: ${g.t2 ?? "-"}`
          : "Belum ada nilai";

      const subjectOwners = ctx.allSubjectTeachers.filter((st) => st.subjectId === resolvedSubject.id);
      const isOwnedByMe = ctx.assignedSubjects.some((s) => s.id === resolvedSubject.id);
      const otherOwners = subjectOwners.filter((st) => st.userId !== user.id);
      const ownerNames = otherOwners.map((o) => o.teacherName).join(", ") || "Guru Mapel";

      // 5. CEK KEPEMILIKAN MAPEL & PENGISI SEBELUMNYA (HANYA BLOKIR JIKA BUKAN SUPERADMIN/ADMIN!)
      if (!isAdminUser) {
        if ((ctx.assignedSubjects.length > 0 && !isOwnedByMe) || (otherOwners.length > 0 && !isOwnedByMe)) {
          const currentVal = existing ? ((existing as any)[fieldKey] ?? "Belum diisi") : "Belum diisi";
          return {
            success: false,
            message: `⛔ **Nilai Tidak Dapat Diubah (Mata Pelajaran Diampu oleh Guru Lain)**\n- **Menu:** Input Nilai & Matrix Persetujuan\n- **Siswa:** **${resolvedStudent.name}** (Kelas **${resolvedClass.name}**)\n- **Mata Pelajaran:** **${resolvedSubject.name}**\n- **Guru Pengampu Mapel Ini:** **${ownerNames}** *(Mapel Anda: ${ctx.subjectNames})*\n- **Data Sebelumnya di Database:** ${fieldKey.toUpperCase()} = **${currentVal}** *(${formatRekap(existing)}, Status: ${existing?.status ?? "kosong"})*\n\n> ⚠️ Sesuai aturan SIMAK, data nilai mata pelajaran yang diampu/diisi oleh guru lain tidak dapat langsung diubah.`,
          };
        }

        if (existing) {
          const [lastAudit] = await db
            .select({
              actorId: gradeAuditLogs.actorId,
              actorName: users.name,
            })
            .from(gradeAuditLogs)
            .leftJoin(users, eq(gradeAuditLogs.actorId, users.id))
            .where(eq(gradeAuditLogs.gradeId, existing.id))
            .orderBy(desc(gradeAuditLogs.createdAt))
            .limit(1);

          const isLastActorAdmin = lastAudit?.actorId ? ctx.adminUsers.some((a) => a.id === lastAudit.actorId) : false;
          if (
            lastAudit?.actorId &&
            lastAudit.actorId !== user.id &&
            !isLastActorAdmin &&
            !isOwnedByMe
          ) {
            const currentVal = (existing as any)[fieldKey] ?? "Belum diisi";
            return {
              success: false,
              message: `⛔ **Nilai Tidak Dapat Diubah (Sudah Diisi oleh Guru Lain)**\n- **Menu:** Input Nilai & Matrix Persetujuan\n- **Siswa:** **${resolvedStudent.name}** (Kelas **${resolvedClass.name}**)\n- **Mata Pelajaran:** **${resolvedSubject.name}**\n- **Diisi Sebelumnya Oleh:** **${lastAudit.actorName || "Guru Lain"}**\n- **Data Sebelumnya:** ${fieldKey.toUpperCase()} = **${currentVal}** *(${formatRekap(existing)}, Status: ${existing.status})*\n\n> ⚠️ Data nilai yang sudah diisi oleh guru lain tidak dapat langsung diubah.`,
            };
          }
        }
      }

      // 6. CEK STATUS LOCKED (SUBMITTED / APPROVED) — Superadmin/Admin diizinkan mengubah ke draft
      if (!isAdminUser && existing && (existing.status === "submitted" || existing.status === "approved")) {
        const prevVal = (existing as any)[fieldKey] ?? "Kosong";
        return {
          success: false,
          message: `⛔ **Nilai Sudah Terkunci (${existing.status.toUpperCase()})**\n- **Menu:** Input Nilai & Matrix Persetujuan\n- **Siswa:** **${resolvedStudent.name}** (Kelas **${resolvedClass.name}**)\n- **Mata Pelajaran:** **${resolvedSubject.name}**\n- **Data Sebelumnya:** ${fieldKey.toUpperCase()} = **${prevVal}** *(${formatRekap(existing)})*\n- **Status Saat Ini:** **${existing.status}** (Terkunci)\n\n> ⚠️ Nilai yang sudah berstatus **${existing.status}** tidak dapat langsung diubah. Wali Kelas dapat membuka kunci ke Draft melalui menu **Matrix Persetujuan** (\`/walikelas\`) atau hubungi Admin.`,
        };
      }

      // 7. AUTO-SAVE DRAFT & LAPORKAN DATA SEBELUMNYA VS DATA BARU
      const prevFieldVal = existing ? (existing as any)[fieldKey] : null;
      const hadPreviousValue = prevFieldVal !== null && prevFieldVal !== undefined && String(prevFieldVal).trim() !== "";
      const oldRekapText = formatRekap(existing);
      const fieldValue = String(score);
      let savedRow: typeof grades.$inferSelect | undefined;

      if (existing) {
        const [updated] = await db
          .update(grades)
          .set({ [fieldKey]: fieldValue, status: "draft", updatedAt: new Date() })
          .where(eq(grades.id, existing.id))
          .returning();
        await db.insert(gradeAuditLogs).values({
          gradeId: updated.id,
          actorId: user.id,
          action: "ai_draft_update",
          before: existing as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
        });
        savedRow = updated;
      } else {
        const insertValues: Record<string, unknown> = {
          studentId: resolvedStudent.id,
          subjectId: resolvedSubject.id,
          classId: resolvedClass.id,
          academicYear: ay,
          semester: sem,
          status: "draft",
          updatedAt: new Date(),
        };
        insertValues[fieldKey] = fieldValue;
        const [created] = await db.insert(grades).values(insertValues as any).returning();
        await db.insert(gradeAuditLogs).values({
          gradeId: created.id,
          actorId: user.id,
          action: "ai_draft_create",
          after: created as unknown as Record<string, unknown>,
        });
        savedRow = created;
      }

      const newRekapText = formatRekap(savedRow);

      broadcastRealtimeEvent({
        type: "grade_submitted",
        classId: resolvedClass.id,
        subjectId: resolvedSubject.id,
        actorId: user.id,
      });

      if (hadPreviousValue) {
        const ownerNote = isAdminUser && !isOwnedByMe && otherOwners.length > 0 ? ` *(Pengampu Mapel: ${ownerNames})*` : "";
        return {
          success: true,
          message: `✅ **Draft Nilai Berhasil Diperbarui (Auto-Save Draft)**\n- **Menu Terkait:** Input Nilai (\`/guru\`) & Matrix Persetujuan (\`/walikelas\`)\n- **Siswa:** **${resolvedStudent.name}** (Kelas **${resolvedClass.name}**)\n- **Mata Pelajaran:** **${resolvedSubject.name}**${ownerNote}\n- **Komponen Penilaian:** **${fieldKey.toUpperCase()}**\n- 🔄 **Data Sebelumnya:** Nilai ${fieldKey.toUpperCase()} = **${prevFieldVal}** *(Rekap lama: ${oldRekapText}, Status lama: ${existing?.status || "draft"})*\n- ✨ **Diganti Menjadi:** Nilai ${fieldKey.toUpperCase()} = **${fieldValue}** *(Rekap baru: ${newRekapText})*\n- **Status:** **Draft** (Tersimpan otomatis di database)`,
          data: savedRow,
        };
      }

      return {
        success: true,
        message: `✅ **Draft Nilai Baru Berhasil Disimpan (Auto-Save Draft)**\n- **Menu Terkait:** Input Nilai (\`/guru\`) & Matrix Persetujuan (\`/walikelas\`)\n- **Siswa:** **${resolvedStudent.name}** (Kelas **${resolvedClass.name}**)\n- **Mata Pelajaran:** **${resolvedSubject.name}**\n- **Komponen Penilaian:** **${fieldKey.toUpperCase()}**\n- **Data Sebelumnya:** *(Belum terisi / Kosong — Rekap lama: ${oldRekapText})*\n- ✨ **Diisi Menjadi:** Nilai ${fieldKey.toUpperCase()} = **${fieldValue}** *(Rekap baru: ${newRekapText})*\n- **Status:** **Draft** (Tersimpan otomatis di database)`,
        data: savedRow,
      };
    }

    // =========================================================
    // HELPER 2 (MENU JURNAL GURU): Simpan draft jurnal mengajar
    // =========================================================
    async function executeSaveJournalDraft(params: {
      tanggal: string;
      className: string;
      subjectName: string;
      startHourIdOrLabel: string;
      endHourIdOrLabel: string;
      materi: string;
      presenceInfo: string;
    }): Promise<{ success: boolean; message: string; data?: any }> {
      const { className, subjectName, startHourIdOrLabel, endHourIdOrLabel, materi, presenceInfo } = params;
      let tanggal = (params.tanggal || "").trim();

      const lastUserText = (userPrompt || (chatMessages[chatMessages.length - 1]?.text) || "").toLowerCase();
      const userAskedToday = lastUserText.includes("hari ini") || lastUserText.includes("sekarang");

      // 1. Normalisasi & Validasi tanggal (paksa ke todayIso jika user minta "hari ini" atau AI halusinasi tahun lama)
      const isoMatch = tanggal.match(/(\d{4}-\d{2}-\d{2})/);
      const dmyMatch = tanggal.match(/(\d{2})-(\d{2})-(\d{4})/);
      if (userAskedToday || tanggal.toLowerCase().includes("hari ini")) {
        tanggal = todayIso;
      } else if (isoMatch) {
        tanggal = isoMatch[1];
        const currentYearPrefix = String(nowWib.getFullYear());
        if (!tanggal.startsWith(currentYearPrefix) && !lastUserText.includes(tanggal.slice(0, 4))) {
          tanggal = todayIso;
        }
      } else if (dmyMatch) {
        tanggal = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
      } else {
        tanggal = todayIso;
      }

      // 2. Resolve kelas
      const cleanClass = className.replace(/[-\s]/g, "").toLowerCase();
      const classConds = [
        sql`lower(${classes.name}) = lower(${className})`,
        sql`replace(replace(lower(${classes.name}), '-', ''), ' ', '') = ${cleanClass}`,
      ];
      if (isUuid(className)) classConds.push(eq(classes.id, className));

      const [resolvedClass] = await db
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(or(...classConds))
        .limit(1);

      if (!resolvedClass) {
        return { success: false, message: `Kelas "${className}" tidak ditemukan di database.` };
      }

      // 3. Resolve mapel
      const subjectConds = [
        sql`lower(${subjects.name}) = lower(${subjectName})`,
        sql`lower(${subjects.code}) = lower(${subjectName})`,
        sql`lower(${subjects.name}) like lower(${'%' + subjectName + '%'})`,
      ];
      if (isUuid(subjectName)) subjectConds.push(eq(subjects.id, subjectName));

      const [resolvedSubject] = await db
        .select({ id: subjects.id, name: subjects.name })
        .from(subjects)
        .where(or(...subjectConds))
        .limit(1);

      if (!resolvedSubject) {
        return { success: false, message: `Mata pelajaran "${subjectName}" tidak ditemukan di database.` };
      }

      // 4. Ambil semua jam mengajar untuk resolusi
      const hours = await db
        .select()
        .from(teachingHours)
        .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);

      if (hours.length === 0) {
        return { success: false, message: "Data jam mengajar belum tersedia di sistem." };
      }

      function resolveHour(input: string): (typeof hours)[0] | undefined {
        const clean = input.trim().toLowerCase();
        if (isUuid(input)) return hours.find((h) => h.id === input);
        const numMatch = clean.match(/^(\d+)$/);
        if (numMatch) {
          const idx = parseInt(numMatch[1], 10) - 1;
          return hours[idx];
        }
        const found = hours.find(
          (h) =>
            h.label.toLowerCase().includes(clean) ||
            clean.includes(h.label.toLowerCase()) ||
            h.startTime === clean ||
            ["pertama", "kedua", "ketiga", "keempat", "kelima", "keenam", "ketujuh", "kedelapan", "kesembilan", "kesepuluh"].some(
              (w, i) => clean.includes(w) && hours[i]?.id === h.id
            )
        );
        return found;
      }

      const startHour = resolveHour(startHourIdOrLabel);
      const endHour = resolveHour(endHourIdOrLabel);

      if (!startHour) {
        return { success: false, message: `Jam mengajar awal "${startHourIdOrLabel}" tidak ditemukan. Gunakan UUID atau label seperti "Jam ke-1" atau angka "1".` };
      }
      if (!endHour) {
        return { success: false, message: `Jam mengajar akhir "${endHourIdOrLabel}" tidak ditemukan. Gunakan UUID atau label seperti "Jam ke-3" atau angka "3".` };
      }

      let startIdx = hours.findIndex((h) => h.id === startHour.id);
      let endIdx = hours.findIndex((h) => h.id === endHour.id);
      if (startIdx > endIdx) {
        const tmp = startIdx;
        startIdx = endIdx;
        endIdx = tmp;
      }
      const targetHours = hours.slice(startIdx, endIdx + 1);
      const targetHourIds = targetHours.map((h) => h.id);

      // 5. Cek bentrok dengan guru lain di kelas tersebut (sent/draft) atau guru sendiri di kelas manapun (sent/draft)
      const classCondJournal = or(
        eq(teacherJournals.classId, resolvedClass.id),
        sql`LOWER(TRIM(${teacherJournals.className})) = LOWER(TRIM(${resolvedClass.name}))`
      );
      const existing3D = await db
        .select({
          id: teacherJournals.id,
          teacherUserId: teacherJournals.teacherUserId,
          teacherName: users.name,
          className: teacherJournals.className,
          subjectName: teacherJournals.subjectName,
          teachingHourLabel: teacherJournals.teachingHourLabel,
          materi: teacherJournals.materi,
          presenceInfo: teacherJournals.presenceInfo,
          status: teacherJournals.status,
          groupId: teacherJournals.groupId,
        })
        .from(teacherJournals)
        .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
        .where(
          and(
            eq(teacherJournals.date, tanggal),
            or(classCondJournal, eq(teacherJournals.teacherUserId, user.id)),
            inArray(teacherJournals.teachingHourId, targetHourIds),
            isNull(teacherJournals.deletedAt)
          )
        );

      // 5A. JIKA SUDAH DIISI OLEH GURU LAIN -> BLOKIR HANYA JIKA BUKAN SUPERADMIN/ADMIN!
      const conflictsOther = existing3D.filter((j) => j.teacherUserId !== user.id);
      if (!isAdminUser && conflictsOther.length > 0) {
        const sampleOther = conflictsOther[0];
        const otherHours = [...new Set(conflictsOther.map((j) => j.teachingHourLabel).filter(Boolean))].join(", ") || `${startHour.label}–${endHour.label}`;
        return {
          success: false,
          message: `⛔ **Jurnal Mengajar Tidak Dapat Diubah (Sudah Diisi oleh Guru Lain)**\n- **Menu:** Jurnal Guru (\`/guru/jurnal\`)\n- **Tanggal:** \`${tanggal}\`\n- **Kelas:** **${resolvedClass.name}**\n- **Jam Mengajar:** **${otherHours}**\n- **Sudah Diisi Oleh:** **${sampleOther.teacherName || "Guru Lain"}**\n- **Mata Pelajaran Terisi:** **${sampleOther.subjectName || "-"}**\n- **Materi Terisi:** *"${sampleOther.materi || "-"}"*\n- **Presensi Terisi:** *"${sampleOther.presenceInfo || "-"}"*\n- **Status:** **${sampleOther.status === "sent" ? "Terkirim (Sent)" : "Draft"}**\n\n> ⚠️ Sesuai aturan SIMAK, jadwal kelas & jam mengajar yang sudah diisi oleh guru lain tidak dapat langsung diubah atau ditimpa.`,
        };
      }

      // 5B. JIKA DIISI OLEH DIRI SENDIRI TETAPI SUDAH TERKIRIM (SENT) -> BLOKIR HANYA JIKA BUKAN SUPERADMIN/ADMIN!
      const conflictsSentSelf = existing3D.filter((j) => j.teacherUserId === user.id && j.status === "sent");
      if (!isAdminUser && conflictsSentSelf.length > 0) {
        const sampleSent = conflictsSentSelf[0];
        const sentHours = [...new Set(conflictsSentSelf.map((j) => j.teachingHourLabel).filter(Boolean))].join(", ") || `${startHour.label}–${endHour.label}`;
        return {
          success: false,
          message: `⛔ **Jurnal Anda Sudah Terkirim & Terkunci (SENT)**\n- **Menu:** Jurnal Guru (\`/guru/jurnal\`)\n- **Tanggal:** \`${tanggal}\`\n- **Data Sebelumnya:** Kelas **${sampleSent.className || resolvedClass.name}** | Mapel **${sampleSent.subjectName || "-"}** | Jam **${sentHours}**\n- **Materi Sebelumnya:** *"${sampleSent.materi || "-"}"*\n- **Presensi Sebelumnya:** *"${sampleSent.presenceInfo || "-"}"*\n- **Status:** **Terkirim (sent)**\n\n> ⚠️ Jurnal yang sudah dikirim resmi tidak dapat diubah kembali oleh Guru. Silakan hubungi Admin jika memerlukan pembatalan.`,
        };
      }

      // 6. JIKA SEBELUMNYA SUDAH ADA DATA (MILIK SENDIRI ATAU DITIMPA OLEH SUPERADMIN/ADMIN) -> SIMPAN INFO LAMA, TIMPA BERSIH, DAN LAPORKAN BEFORE -> AFTER!
      const replaceableConflicts = isAdminUser
        ? existing3D
        : existing3D.filter((j) => j.teacherUserId === user.id && j.status === "draft");

      let previousDraftInfo: {
        teacherName: string;
        isOtherTeacher: boolean;
        className: string;
        subjectName: string;
        hoursText: string;
        materi: string;
        presenceInfo: string;
        status: string;
      } | null = null;

      if (replaceableConflicts.length > 0) {
        const conflictGroupIds = [...new Set(replaceableConflicts.map((j) => j.groupId).filter(Boolean))] as string[];
        const allOldGroupRows = conflictGroupIds.length > 0
          ? await db
              .select()
              .from(teacherJournals)
              .where(
                and(
                  isNull(teacherJournals.deletedAt),
                  inArray(teacherJournals.groupId, conflictGroupIds)
                )
              )
          : replaceableConflicts;

        const sampleOld = replaceableConflicts[0];
        const oldHoursList = [...new Set(allOldGroupRows.map((r) => r.teachingHourLabel).filter(Boolean))];
        previousDraftInfo = {
          teacherName: sampleOld.teacherName || user.name,
          isOtherTeacher: sampleOld.teacherUserId !== user.id,
          className: sampleOld.className || resolvedClass.name,
          subjectName: sampleOld.subjectName || resolvedSubject.name,
          hoursText: oldHoursList.length > 0 ? `Jam ke-${oldHoursList.join(", ")}` : `${startHour.label}–${endHour.label}`,
          materi: sampleOld.materi || "-",
          presenceInfo: sampleOld.presenceInfo || "-",
          status: sampleOld.status || "draft",
        };

        if (conflictGroupIds.length > 0) {
          await db
            .delete(teacherJournals)
            .where(inArray(teacherJournals.groupId, conflictGroupIds));
        }
        const conflictIds = replaceableConflicts.map((j) => j.id);
        if (conflictIds.length > 0) {
          await db.delete(teacherJournals).where(inArray(teacherJournals.id, conflictIds));
        }
      }

      await db
        .delete(teacherJournals)
        .where(
          and(
            eq(teacherJournals.teacherUserId, user.id),
            eq(teacherJournals.date, tanggal),
            eq(teacherJournals.status, "draft"),
            inArray(teacherJournals.teachingHourId, targetHourIds)
          )
        );

      const newGroupId = crypto.randomUUID();
      const inserts = targetHours.map((h) => ({
        teacherUserId: user.id,
        date: tanggal,
        classId: resolvedClass.id,
        className: resolvedClass.name,
        teachingHourId: h.id,
        teachingHourLabel: h.label,
        subjectId: resolvedSubject.id,
        subjectName: resolvedSubject.name,
        groupId: newGroupId,
        materi: materi || "",
        presenceInfo: presenceInfo || "",
        status: "draft" as const,
      }));

      await db.insert(teacherJournals).values(inserts);
      broadcastRealtimeEvent({ type: "journal_saved", classId: resolvedClass.id, actorId: user.id });

      if (previousDraftInfo) {
        const ownerLabel = previousDraftInfo.isOtherTeacher
          ? `Diisi Sebelumnya Oleh Guru **${previousDraftInfo.teacherName}** (Status: ${previousDraftInfo.status})`
          : `Milik Anda (Status: ${previousDraftInfo.status})`;
        return {
          success: true,
          message: `✅ **Draft Jurnal Guru Berhasil Diperbarui (Auto-Save Draft)**\n- **Menu:** Jurnal Guru (\`/guru/jurnal\`)\n- **Tanggal:** \`${tanggal}\`\n- 🔄 **Data Sebelumnya (${ownerLabel}):**\n  - Kelas: **${previousDraftInfo.className}** | Mapel: **${previousDraftInfo.subjectName}** | Jam: **${previousDraftInfo.hoursText}**\n  - Materi Sebelumnya: *"${previousDraftInfo.materi}"*\n  - Presensi Sebelumnya: *"${previousDraftInfo.presenceInfo}"*\n- ✨ **Diganti Menjadi (Draft Baru Tersimpan):**\n  - Kelas: **${resolvedClass.name}** | Mapel: **${resolvedSubject.name}** | Jam: **Jam ke-${startHour.label} s.d. ${endHour.label}** (${targetHours.length} jam pelajaran)\n  - Materi Baru: **"${materi}"**\n  - Presensi Baru: **"${presenceInfo}"**\n- **Status:** **Draft** (Tersimpan otomatis di database)`,
          data: { groupId: newGroupId, count: inserts.length, replaced: previousDraftInfo },
        };
      }

      return {
        success: true,
        message: `✅ **Jurnal Guru Baru Berhasil Disimpan sebagai Draft (Auto-Save Draft)**\n- **Menu:** Jurnal Guru (\`/guru/jurnal\`)\n- **Tanggal:** \`${tanggal}\`\n- **Data Sebelumnya:** *(Belum ada jurnal pada tanggal & jam ini)*\n- ✨ **Data Baru Tersimpan:**\n  - **Kelas:** **${resolvedClass.name}**\n  - **Mapel:** **${resolvedSubject.name}**\n  - **Jam:** **Jam ke-${startHour.label} s.d. ${endHour.label}** (${targetHours.length} jam pelajaran)\n  - **Materi:** **"${materi}"**\n  - **Presensi:** **"${presenceInfo}"**\n- **Status:** **Draft** (Tersimpan otomatis di database)`,
        data: { groupId: newGroupId, count: inserts.length },
      };
    }

    // =========================================================
    // HELPER VERIFIKASI 2 LANGKAH (TWO-STEP CONFIRMATION CHECKER)
    // =========================================================
    const lastUserText = (userPrompt || (chatMessages[chatMessages.length - 1]?.text) || "").trim();
    const lastUserLower = lastUserText.toLowerCase();
    const prevModelMsg =
      [...chatMessages.slice(0, -1)].reverse().find((m) => m.role === "model")?.text || "";
    const prevUserMsg =
      [...chatMessages.slice(0, -1)].reverse().find((m) => m.role === "user")?.text || "";

    const wasAskedVerificationInPrevTurn =
      /verifikasi\s*(?:2\s*langkah|langkah\s*1)|konfirmasi\s+penghapusan|apakah\s+(?:anda|bapak|ibu)[\s\S]{0,80}yakin[\s\S]{0,80}menghapus|masuk\s+ke\s+tempat\s+sampah|tidak\s+bisa\s+dikembalikan\s+lagi|balas\s+\*\*?"?ya/i.test(
        prevModelMsg
      );

    const userRepliedConfirmation =
      /\b(ya|iya|yap|yup|yakin|lanjut|lanjutkan|oke|ok|setuju|betul|benar|konfirmasi|eksekusi|gas|silakan|tetap\s+hapus|hapus\s+sekarang|hapus\s+permanen|jadi\s+hapus|saya\s+yakin)\b/i.test(
        lastUserLower
      );

    const isTwoStepConfirmed = wasAskedVerificationInPrevTurn && userRepliedConfirmation;

    // =========================================================
    // HELPER 2B (MENU JURNAL GURU & MONITORING JURNAL): Hapus Jurnal (Soft Delete dgn Verifikasi 2 Langkah)
    // =========================================================
    async function executeDeleteJournal(params: {
      tanggal?: string;
      className?: string;
      startHourIdOrLabel?: string;
      endHourIdOrLabel?: string;
    }): Promise<{ success: boolean; step?: string; message: string; data?: any }> {
      let tanggal = (params.tanggal || "").trim();
      const combinedContext = `${prevUserMsg} ${prevModelMsg} ${lastUserLower}`.toLowerCase();
      const userAskedToday = lastUserLower.includes("hari ini") || lastUserLower.includes("sekarang");

      const isoMatch = tanggal.match(/(\d{4}-\d{2}-\d{2})/) || prevModelMsg.match(/(\d{4}-\d{2}-\d{2})/);
      const dmyMatch =
        tanggal.match(/(\d{2})-(\d{2})-(\d{4})/) ||
        lastUserLower.match(/(\d{2})-(\d{2})-(\d{4})/) ||
        combinedContext.match(/(\d{2})-(\d{2})-(\d{4})/);

      if (userAskedToday || tanggal.toLowerCase().includes("hari ini")) {
        tanggal = todayIso;
      } else if (isoMatch) {
        tanggal = isoMatch[1];
      } else if (dmyMatch) {
        tanggal = `${dmyMatch[3]}-${dmyMatch[2]}-${dmyMatch[1]}`;
      } else {
        tanggal = todayIso;
      }

      const conds = [eq(teacherJournals.date, tanggal), isNull(teacherJournals.deletedAt)];

      // Filter kelas jika bukan "SEMUA"
      const rawClass = (params.className || "SEMUA").trim();
      if (rawClass && !["semua", "all", "-", "*"].includes(rawClass.toLowerCase())) {
        const cleanClass = rawClass.replace(/[-\s]/g, "").toLowerCase();
        const [resolvedClass] = await db
          .select({ id: classes.id, name: classes.name })
          .from(classes)
          .where(
            or(
              sql`lower(${classes.name}) = lower(${rawClass})`,
              sql`replace(replace(lower(${classes.name}), '-', ''), ' ', '') = ${cleanClass}`,
              isUuid(rawClass) ? eq(classes.id, rawClass) : sql`1=0`
            )
          )
          .limit(1);

        if (resolvedClass) {
          conds.push(
            or(
              eq(teacherJournals.classId, resolvedClass.id),
              sql`LOWER(TRIM(${teacherJournals.className})) = LOWER(TRIM(${resolvedClass.name}))`
            )!
          );
        }
      }

      // Filter jam jika bukan "SEMUA"
      const rawStart = (params.startHourIdOrLabel || "SEMUA").trim();
      const rawEnd = (params.endHourIdOrLabel || rawStart).trim();
      if (rawStart && !["semua", "all", "-", "*"].includes(rawStart.toLowerCase())) {
        const hours = await db
          .select()
          .from(teachingHours)
          .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);

        const resolveH = (inp: string) => {
          const cl = inp.trim().toLowerCase();
          if (isUuid(inp)) return hours.find((h) => h.id === inp);
          const nm = cl.match(/(\d+)/);
          if (nm) return hours[parseInt(nm[1], 10) - 1];
          return hours.find((h) => h.label.toLowerCase().includes(cl));
        };
        const sh = resolveH(rawStart);
        const eh = resolveH(rawEnd) || sh;
        if (sh && eh) {
          let si = hours.findIndex((h) => h.id === sh.id);
          let ei = hours.findIndex((h) => h.id === eh.id);
          if (si > ei) [si, ei] = [ei, si];
          const targetIds = hours.slice(si, ei + 1).map((h) => h.id);
          if (targetIds.length > 0) {
            conds.push(inArray(teacherJournals.teachingHourId, targetIds));
          }
        }
      }

      const matchedRows = await db
        .select({
          id: teacherJournals.id,
          teacherUserId: teacherJournals.teacherUserId,
          teacherName: users.name,
          className: teacherJournals.className,
          subjectName: teacherJournals.subjectName,
          teachingHourLabel: teacherJournals.teachingHourLabel,
          materi: teacherJournals.materi,
          presenceInfo: teacherJournals.presenceInfo,
          status: teacherJournals.status,
          groupId: teacherJournals.groupId,
        })
        .from(teacherJournals)
        .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
        .where(and(...conds));

      if (matchedRows.length === 0) {
        return {
          success: false,
          message: `ℹ️ Tidak ditemukan jurnal mengajar aktif pada tanggal **\`${tanggal}\`**${rawClass.toLowerCase() !== "semua" ? ` untuk kelas **${rawClass}**` : ""} yang perlu dihapus (mungkin sudah berada di Tempat Sampah / Soft Delete).`,
        };
      }

      // Cek otoritas: Jika BUKAN Superadmin/Admin, larang hapus jurnal guru lain atau jurnal berstatus sent!
      if (!isAdminUser) {
        const otherRows = matchedRows.filter((r) => r.teacherUserId !== user.id);
        if (otherRows.length > 0) {
          const s = otherRows[0];
          return {
            success: false,
            message: `⛔ **Jurnal Tidak Dapat Dihapus (Milik Guru Lain)**\n- **Tanggal:** \`${tanggal}\`\n- **Kelas:** **${s.className || "-"}**\n- **Diisi Oleh:** **${s.teacherName || "Guru Lain"}**\n- **Mapel & Materi:** **${s.subjectName || "-"}** — *"${s.materi || "-"}"*\n\n> ⚠️ Hanya Guru pemilik draft atau Superadmin/Admin yang memiliki otoritas menghapus jurnal tersebut.`,
          };
        }

        const sentRows = matchedRows.filter((r) => r.status === "sent");
        if (sentRows.length > 0) {
          const s = sentRows[0];
          return {
            success: false,
            message: `⛔ **Jurnal Sudah Terkirim (SENT) & Tidak Dapat Dihapus oleh Guru**\n- **Tanggal:** \`${tanggal}\`\n- **Kelas:** **${s.className || "-"}** | **Mapel:** **${s.subjectName || "-"}**\n- **Materi:** *"${s.materi || "-"}"*\n\n> ⚠️ Jurnal yang sudah dikirim resmi terkunci. Hubungi Superadmin/Admin jika perlu dihapus.`,
          };
        }
      }

      // Kelompokkan rincian jurnal yang akan dihapus
      const summaryGroups = new Map<string, {
        className: string;
        teacherName: string;
        subjectName: string;
        hours: string[];
        materi: string;
        presenceInfo: string;
        status: string;
      }>();

      for (const r of matchedRows) {
        const gKey = r.groupId || r.id;
        const ex = summaryGroups.get(gKey);
        if (ex) {
          if (r.teachingHourLabel && !ex.hours.includes(r.teachingHourLabel)) {
            ex.hours.push(r.teachingHourLabel);
          }
        } else {
          summaryGroups.set(gKey, {
            className: r.className || "-",
            teacherName: r.teacherName || user.name,
            subjectName: r.subjectName || "-",
            hours: r.teachingHourLabel ? [r.teachingHourLabel] : [],
            materi: r.materi || "-",
            presenceInfo: r.presenceInfo || "-",
            status: r.status || "draft",
          });
        }
      }

      const targetListText = [...summaryGroups.values()]
        .map(
          (g, idx) =>
            `  ${idx + 1}. **Kelas ${g.className}** (Jam ke-${g.hours.join(", ")}) — Mapel **${g.subjectName}** oleh **${g.teacherName}** | Materi: *"${g.materi}"* | Presensi: *"${g.presenceInfo}"* *(Status: ${g.status})*`
        )
        .join("\n");

      // =========================================================
      // VERIFIKASI LANGKAH 1 DARI 2: Tanyakan konfirmasi dulu!
      // =========================================================
      if (!isTwoStepConfirmed) {
        return {
          success: true,
          step: "verification_step_1",
          message: `🛡️ **Verifikasi 2 Langkah (Langkah 1 dari 2) — Konfirmasi Penghapusan Jurnal Mengajar**\n- **Menu Terkait:** Jurnal Guru (\`/guru/jurnal\`), Monitoring Jurnal (\`/admin/monitoring-jurnal\`), & Tempat Sampah (\`/admin/trash\`)\n- **Tanggal Target:** \`${tanggal}\`\n- **Cakupan Kelas:** **${rawClass.toUpperCase()}**\n- **Rincian Jurnal Aktif yang Ditemukan (${summaryGroups.size} entri / ${matchedRows.length} jam pelajaran):**\n${targetListText}\n\n❓ **Apakah ${ctx.honorific} ${user.name} yakin ingin menghapus data jurnal mengajar di atas?**\n- ♻️ **Mekanisme Soft Delete:** Jika **Ya**, seluruh jurnal di atas **tidak langsung hilang permanen**, melainkan dipindahkan ke menu **Tempat Sampah (Soft Delete)** (\`/admin/trash\`) dan masih dapat dipulihkan (*restore*) kapan saja.\n- 👉 Silakan balas **"Ya, yakin hapus"** untuk melanjutkan eksekusi penghapusan.`,
          data: { pendingDeleteCount: matchedRows.length, groupsCount: summaryGroups.size, tanggal, className: rawClass },
        };
      }

      // =========================================================
      // VERIFIKASI LANGKAH 2 DARI 2: Eksekusi Soft Delete ke Tempat Sampah!
      // =========================================================
      const idsToDelete = matchedRows.map((r) => r.id);
      await db
        .update(teacherJournals)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(teacherJournals.id, idsToDelete));

      broadcastRealtimeEvent({ type: "journal_deleted", actorId: user.id });

      return {
        success: true,
        step: "verification_step_2_completed",
        message: `✅ **Penghapusan Terkonfirmasi (Langkah 2 dari 2) — Jurnal Dipindahkan ke Tempat Sampah (Soft Delete)**\n- **Menu Terkait:** Jurnal Guru (\`/guru/jurnal\`), Monitoring Jurnal (\`/admin/monitoring-jurnal\`), & Tempat Sampah (\`/admin/trash\`)\n- **Tanggal:** \`${tanggal}\`\n- **Total Dihapus (Soft Delete):** **${matchedRows.length} jam pelajaran** (${summaryGroups.size} entri jurnal)\n- 🔄 **Data Sebelumnya yang Dihapus:**\n${targetListText}\n- ♻️ **Status Saat Ini:** **Soft Delete (Di Tempat Sampah)** — Data telah dinonaktifkan dari jadwal aktif dan disimpan di menu **Tempat Sampah** (\`/admin/trash\`). Anda dapat memulihkannya (*Restore*) atau menghapusnya secara permanen dari Tempat Sampah.`,
        data: { deletedCount: matchedRows.length, groupsCount: summaryGroups.size },
      };
    }

    // =========================================================
    // HELPER 2C (MENU INPUT NILAI & TEMPAT SAMPAH): Hapus Nilai ke Soft Delete (Verifikasi 2 Langkah)
    // =========================================================
    async function executeDeleteGrade(params: {
      className?: string;
      studentIdOrName?: string;
      subjectName?: string;
    }): Promise<{ success: boolean; step?: string; message: string; data?: any }> {
      if (!isAdminUser) {
        return {
          success: false,
          message: `⛔ **Akses Ditolak:** Penghapusan seluruh baris nilai siswa ke Tempat Sampah hanya dapat dilakukan oleh **Superadmin / Admin**. Guru Mapel dapat mengubah nilai komponen menjadi Draft melalui perintah ubah nilai.`,
        };
      }

      const conds = [isNull(grades.deletedAt)];
      const rawClass = (params.className || "SEMUA").trim();
      if (rawClass && !["semua", "all", "-", "*"].includes(rawClass.toLowerCase())) {
        const cleanClass = rawClass.replace(/[-\s]/g, "").toLowerCase();
        const [resolvedClass] = await db
          .select({ id: classes.id, name: classes.name })
          .from(classes)
          .where(
            or(
              sql`lower(${classes.name}) = lower(${rawClass})`,
              sql`replace(replace(lower(${classes.name}), '-', ''), ' ', '') = ${cleanClass}`
            )
          )
          .limit(1);
        if (resolvedClass) conds.push(eq(grades.classId, resolvedClass.id));
      }

      const rawStudent = (params.studentIdOrName || "SEMUA").trim();
      if (rawStudent && !["semua", "all", "-", "*"].includes(rawStudent.toLowerCase())) {
        const [st] = await db
          .select({ id: students.id })
          .from(students)
          .where(sql`lower(${students.name}) like lower(${'%' + rawStudent + '%'})`)
          .limit(1);
        if (st) conds.push(eq(grades.studentId, st.id));
      }

      const rawSubject = (params.subjectName || "SEMUA").trim();
      if (rawSubject && !["semua", "all", "-", "*"].includes(rawSubject.toLowerCase())) {
        const [subj] = await db
          .select({ id: subjects.id })
          .from(subjects)
          .where(
            or(
              sql`lower(${subjects.name}) like lower(${'%' + rawSubject + '%'})`,
              sql`lower(${subjects.code}) = lower(${rawSubject})`
            )
          )
          .limit(1);
        if (subj) conds.push(eq(grades.subjectId, subj.id));
      }

      const matchedGrades = await db
        .select({
          id: grades.id,
          studentName: students.name,
          className: classes.name,
          subjectName: subjects.name,
          uh1: grades.uh1,
          t1: grades.t1,
          sts: grades.sts,
          uh2: grades.uh2,
          t2: grades.t2,
          status: grades.status,
        })
        .from(grades)
        .innerJoin(students, eq(grades.studentId, students.id))
        .innerJoin(classes, eq(grades.classId, classes.id))
        .innerJoin(subjects, eq(grades.subjectId, subjects.id))
        .where(and(...conds))
        .limit(50);

      if (matchedGrades.length === 0) {
        return {
          success: false,
          message: `ℹ️ Tidak ditemukan data nilai aktif yang cocok untuk dihapus.`,
        };
      }

      const gradeListText = matchedGrades
        .slice(0, 15)
        .map(
          (g, i) =>
            `  ${i + 1}. **${g.studentName}** (${g.className}) — Mapel **${g.subjectName}** | UH1:${g.uh1 ?? "-"}, T1:${g.t1 ?? "-"}, STS:${g.sts ?? "-"}, UH2:${g.uh2 ?? "-"}, T2:${g.t2 ?? "-"} *(Status: ${g.status})*`
        )
        .join("\n");

      if (!isTwoStepConfirmed) {
        return {
          success: true,
          step: "verification_step_1",
          message: `🛡️ **Verifikasi 2 Langkah (Langkah 1 dari 2) — Konfirmasi Penghapusan Data Nilai**\n- **Menu Terkait:** Input Nilai (\`/guru\`), Matrix Persetujuan (\`/walikelas\`), & Tempat Sampah (\`/admin/trash\`)\n- **Data Nilai yang Akan Dihapus (${matchedGrades.length} entri):**\n${gradeListText}\n\n❓ **Apakah ${ctx.honorific} ${user.name} yakin ingin menghapus ${matchedGrades.length} data nilai di atas?**\n- ♻️ **Mekanisme Soft Delete:** Jika **Ya**, data nilai akan dipindahkan ke **Tempat Sampah (Soft Delete)** (\`/admin/trash\`) dan masih dapat dipulihkan kembali.\n- 👉 Silakan balas **"Ya, yakin hapus"** untuk melanjutkan.`,
          data: { pendingDeleteCount: matchedGrades.length },
        };
      }

      const ids = matchedGrades.map((g) => g.id);
      await db
        .update(grades)
        .set({ deletedAt: new Date(), updatedAt: new Date() })
        .where(inArray(grades.id, ids));

      broadcastRealtimeEvent({ type: "grade_deleted", actorId: user.id });

      return {
        success: true,
        step: "verification_step_2_completed",
        message: `✅ **Penghapusan Nilai Terkonfirmasi (Langkah 2 dari 2) — Dipindahkan ke Tempat Sampah (Soft Delete)**\n- **Total Dihapus (Soft Delete):** **${matchedGrades.length} entri nilai**\n- 🔄 **Data Sebelumnya yang Dihapus:**\n${gradeListText}\n- ♻️ **Status Saat Ini:** **Soft Delete (Di Tempat Sampah \`/admin/trash\`)** — Masih dapat dipulihkan sewaktu-waktu.`,
        data: { deletedCount: matchedGrades.length },
      };
    }

    // =========================================================
    // HELPER 2D (MENU TEMPAT SAMPAH / RECYCLE BIN): Restore & Hapus Permanen (Verifikasi 2 Langkah & Anti-Data Tumpuk)
    // =========================================================
    async function executeRestoreTrash(params: {
      tipe?: string;
      tanggal?: string;
      className?: string;
      overwrite?: boolean;
    }): Promise<{ success: boolean; step?: string; message: string; data?: any }> {
      if (!isAdminUser) {
        return {
          success: false,
          message: `⛔ **Akses Ditolak:** Menu **Tempat Sampah (\`/admin/trash\`)** khusus untuk otoritas **Superadmin / Admin**.`,
        };
      }

      const tipe = (params.tipe || "SEMUA").toUpperCase();
      let restoredJournalsCount = 0;
      let restoredGradesCount = 0;
      const details: string[] = [];

      const userWantsOverwrite =
        Boolean(params.overwrite) ||
        /\b(timpa|ganti|overwrite|replace|tindih|paksa\s+timpa|iya\s+timpa|ya\s+timpa|timpa\s+dengan\s+data\s+lama)\b/i.test(
          lastUserLower
        );

      if (tipe === "JURNAL" || tipe === "SEMUA" || tipe === "ALL") {
        const trashedConditions = [isNotNull(teacherJournals.deletedAt)];
        if (params.tanggal && params.tanggal !== "SEMUA") {
          trashedConditions.push(eq(teacherJournals.date, params.tanggal));
        }
        if (params.className && params.className !== "SEMUA") {
          trashedConditions.push(sql`LOWER(${teacherJournals.className}) = LOWER(${params.className})`);
        }

        const trashedJ = await db
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
            teacherUserId: teacherJournals.teacherUserId,
            groupId: teacherJournals.groupId,
            teacherName: users.name,
          })
          .from(teacherJournals)
          .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
          .where(and(...trashedConditions));

        if (trashedJ.length > 0) {
          // Cek apakah ada bentrokan dengan data jurnal aktif (deletedAt IS NULL) di kelas, tanggal, dan jam yang sama!
          const activeJournals = await db
            .select({
              id: teacherJournals.id,
              date: teacherJournals.date,
              classId: teacherJournals.classId,
              className: teacherJournals.className,
              teachingHourId: teacherJournals.teachingHourId,
              teachingHourLabel: teacherJournals.teachingHourLabel,
              subjectName: teacherJournals.subjectName,
              materi: teacherJournals.materi,
              status: teacherJournals.status,
              teacherName: users.name,
            })
            .from(teacherJournals)
            .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
            .where(isNull(teacherJournals.deletedAt));

          // Cari irisan slot yang bentrok (lintas semua guru di kelas tersebut)
          const conflictingActiveList: typeof activeJournals = [];
          const conflictReports: string[] = [];

          for (const tj of trashedJ) {
            const conflict = activeJournals.find(
              (aj) =>
                aj.date === tj.date &&
                ((aj.classId && tj.classId && aj.classId === tj.classId) ||
                  (aj.className && tj.className && aj.className.toLowerCase() === tj.className.toLowerCase())) &&
                ((aj.teachingHourId && tj.teachingHourId && aj.teachingHourId === tj.teachingHourId) ||
                  (aj.teachingHourLabel && tj.teachingHourLabel && aj.teachingHourLabel === tj.teachingHourLabel))
            );

            if (conflict && !conflictingActiveList.some((c) => c.id === conflict.id)) {
              conflictingActiveList.push(conflict);
              conflictReports.push(
                `- ⚠️ **Slot Bentrok:** Kelas **${conflict.className}** | Tanggal **${conflict.date}** | **${conflict.teachingHourLabel || "Jam Mengajar"}**\n` +
                `  - 🆕 **Data Baru yang Aktif Saat Ini:** Mapel **${conflict.subjectName || "-"}** oleh Guru **${conflict.teacherName || "-"}** — Materi: *"${conflict.materi || "-"}"* (Status: \`${conflict.status}\`)\n` +
                `  - 📦 **Data Lama di Tempat Sampah:** Mapel **${tj.subjectName || "-"}** oleh Guru **${tj.teacherName || "-"}** — Materi: *"${tj.materi || "-"}"*`
              );
            }
          }

          // JIKA ADA BENTROKAN DAN PENGGUNA BELUM MEMINTA TIMPA (OVERWRITE):
          if (conflictingActiveList.length > 0 && !userWantsOverwrite) {
            return {
              success: false,
              step: "conflict_detected",
              message:
                `⚠️ **PERINGATAN: Bentrokan Data Terdeteksi (Data Tumpuk di Slot yang Sama)!**\n` +
                `Data dari Tempat Sampah tidak dapat langsung dipulihkan begitu saja, karena slot kelas & jam mengajar tersebut **saat ini sudah terisi oleh jurnal baru**:\n\n` +
                `${conflictReports.join("\n\n")}\n\n` +
                `❌ **Risiko:** Jika data lama dipulihkan secara paksa, jadwal akan menumpuk dan menyebabkan tampilan antara **Guru** dan **Monitoring Jurnal Admin** menjadi cacat/tidak sinkron!\n\n` +
                `👉 **Pilihan Solusi:**\n` +
                `1. **Pertahankan Data Baru:** Batalkan pemulihan, biarkan data baru tetap aktif dan data lama tetap berada di Tempat Sampah.\n` +
                `2. **Timpa dengan Data Lama:** Balas **"Ya, timpa dengan data lama"** agar data baru dipindahkan ke Tempat Sampah (*soft-delete*) dan data lama diaktifkan kembali.`,
              data: {
                conflicts: conflictReports,
                trashedCount: trashedJ.length,
              },
            };
          }

          // JIKA USER MEMINTA TIMPA (OVERWRITE):
          if (conflictingActiveList.length > 0 && userWantsOverwrite) {
            const conflictIds = conflictingActiveList.map((c) => c.id);
            await db
              .update(teacherJournals)
              .set({ deletedAt: new Date(), updatedAt: new Date() })
              .where(inArray(teacherJournals.id, conflictIds));
            details.push(
              `- 🔄 **Data Baru yang Menempati Slot Dipindahkan ke Tempat Sampah (${conflictingActiveList.length} entri):** Mencegah data tumpuk/bentrok.`
            );
          }

          // Eksekusi pemulihan data lama dari tempat sampah
          const ids = trashedJ.map((j) => j.id);
          await db
            .update(teacherJournals)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(inArray(teacherJournals.id, ids));
          restoredJournalsCount = trashedJ.length;
          details.push(
            `- ✅ **Jurnal Mengajar Lama Dipulihkan:** **${restoredJournalsCount} jam pelajaran** kembali aktif di menu Jurnal Guru & Monitoring Jurnal.`
          );
          broadcastRealtimeEvent({ type: "journal_saved", actorId: user.id });
        }
      }

      if (tipe === "NILAI" || tipe === "GRADE" || tipe === "SEMUA" || tipe === "ALL") {
        const trashedG = await db
          .select({
            id: grades.id,
            studentId: grades.studentId,
            classId: grades.classId,
            subjectId: grades.subjectId,
            academicYear: grades.academicYear,
            semester: grades.semester,
          })
          .from(grades)
          .where(isNotNull(grades.deletedAt));

        if (trashedG.length > 0) {
          const ids = trashedG.map((g) => g.id);
          await db
            .update(grades)
            .set({ deletedAt: null, updatedAt: new Date() })
            .where(inArray(grades.id, ids));
          restoredGradesCount = trashedG.length;
          details.push(`- **Data Nilai Siswa Dipulihkan:** **${restoredGradesCount} entri nilai** kembali aktif di menu Input Nilai & Matrix Persetujuan.`);
          broadcastRealtimeEvent({ type: "grade_data_restored", actorId: user.id });
        }
      }

      if (restoredJournalsCount === 0 && restoredGradesCount === 0) {
        return {
          success: false,
          message: `ℹ️ **Tempat Sampah Kosong:** Saat ini tidak ada data Jurnal maupun Nilai di **Tempat Sampah (\`/admin/trash\`)** yang perlu dipulihkan.`,
        };
      }

      return {
        success: true,
        message: `♻️ **Data Berhasil Dipulihkan (Restore) dari Tempat Sampah (\`/admin/trash\`)**\n${details.join("\n")}\n- ✨ **Status Saat Ini:** **Aktif Kembali (Sinkron & Tanpa Bentrokan)**`,
        data: { restoredJournalsCount, restoredGradesCount },
      };
    }

    async function executePermanentDeleteTrash(params: {
      tipe?: string;
      tanggal?: string;
      className?: string;
    }): Promise<{ success: boolean; step?: string; message: string; data?: any }> {
      if (!isAdminUser) {
        return {
          success: false,
          message: `⛔ **Akses Ditolak:** Penghapusan permanen data di **Tempat Sampah (\`/admin/trash\`)** hanya dapat dilakukan oleh **Superadmin**.`,
        };
      }

      const tipe = (params.tipe || "SEMUA").toUpperCase();
      const wantJournal = tipe === "JURNAL" || tipe === "SEMUA" || tipe === "ALL";
      const wantGrade = tipe === "NILAI" || tipe === "GRADE" || tipe === "SEMUA" || tipe === "ALL";

      const trashedJ = wantJournal
        ? await db
            .select({
              id: teacherJournals.id,
              date: teacherJournals.date,
              className: teacherJournals.className,
              subjectName: teacherJournals.subjectName,
              teachingHourLabel: teacherJournals.teachingHourLabel,
              teacherName: users.name,
              materi: teacherJournals.materi,
              groupId: teacherJournals.groupId,
            })
            .from(teacherJournals)
            .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
            .where(isNotNull(teacherJournals.deletedAt))
        : [];

      const trashedG = wantGrade
        ? await db
            .select({
              id: grades.id,
              studentName: students.name,
              className: classes.name,
              subjectName: subjects.name,
            })
            .from(grades)
            .innerJoin(students, eq(grades.studentId, students.id))
            .innerJoin(classes, eq(grades.classId, classes.id))
            .innerJoin(subjects, eq(grades.subjectId, subjects.id))
            .where(isNotNull(grades.deletedAt))
        : [];

      if (trashedJ.length === 0 && trashedG.length === 0) {
        return {
          success: false,
          message: `ℹ️ **Tempat Sampah (\`/admin/trash\`) Sudah Kosong:** Tidak ada data berstatus *Soft Delete* yang perlu dihapus permanen.`,
        };
      }

      const previewLines: string[] = [];
      if (trashedJ.length > 0) {
        const jGroups = new Map<string, string>();
        for (const j of trashedJ) {
          const k = j.groupId || j.id;
          if (!jGroups.has(k)) {
            jGroups.set(
              k,
              `  - [Jurnal] **${j.date}** | Kelas **${j.className || "-"}** | Mapel **${j.subjectName || "-"}** oleh **${j.teacherName || "-"}** — Materi: *"${j.materi || "-"}"*`
            );
          }
        }
        previewLines.push(...[...jGroups.values()].slice(0, 15));
      }
      if (trashedG.length > 0) {
        previewLines.push(
          ...trashedG.slice(0, 15).map((g) => `  - [Nilai] **${g.studentName}** (${g.className}) — Mapel **${g.subjectName}**`)
        );
      }

      // =========================================================
      // VERIFIKASI LANGKAH 1 DARI 2: Peringatan Keras Hapus Permanen!
      // =========================================================
      if (!isTwoStepConfirmed) {
        return {
          success: true,
          step: "verification_step_1",
          message: `🚨 **Verifikasi 2 Langkah (Langkah 1 dari 2) — Peringatan Hapus PERMANEN dari Tempat Sampah (\`/admin/trash\`)**\n- **Menu Terkait:** Tempat Sampah / Recycle Bin (\`/admin/trash\`)\n- **Data Soft Delete yang Akan Dihapus Permanen (${trashedJ.length} baris jam jurnal, ${trashedG.length} entri nilai):**\n${previewLines.join("\n")}\n\n⚠️ **PERINGATAN KERAS (IRREVERSIBLE):**\n- Data di atas saat ini berstatus **Soft Delete** di Tempat Sampah.\n- Apabila Anda menghapusnya dari Tempat Sampah, maka data akan **DIHAPUS PERMANEN dari database dan TIDAK BISA DIKEMBALIKAN LAGI!**\n- 👉 Apakah ${ctx.honorific} ${user.name} benar-benar yakin? Silakan balas **"Ya, yakin hapus permanen"** untuk mengeksekusi penghapusan permanen.`,
          data: { pendingPermanentJournals: trashedJ.length, pendingPermanentGrades: trashedG.length },
        };
      }

      // =========================================================
      // VERIFIKASI LANGKAH 2 DARI 2: Eksekusi Hapus Permanen!
      // =========================================================
      if (trashedJ.length > 0) {
        await db.delete(teacherJournals).where(isNotNull(teacherJournals.deletedAt));
        broadcastRealtimeEvent({ type: "journal_deleted", actorId: user.id });
      }
      if (trashedG.length > 0) {
        await db.delete(grades).where(isNotNull(grades.deletedAt));
        broadcastRealtimeEvent({ type: "grade_data_restored", actorId: user.id });
      }

      return {
        success: true,
        step: "verification_step_2_completed",
        message: `🔥 **Penghapusan Permanen Selesai (Langkah 2 dari 2) — Tempat Sampah Dikosongkan**\n- **Menu:** Tempat Sampah / Recycle Bin (\`/admin/trash\`)\n- **Total Dihapus Permanen:** **${trashedJ.length} baris jam jurnal** & **${trashedG.length} entri nilai**\n- 🔄 **Data yang Telah Dihapus Permanen:**\n${previewLines.join("\n")}\n- ⛔ **Status Saat Ini:** **Terhapus Permanen dari Database (Tidak dapat dikembalikan lagi)**`,
        data: { deletedPermanentJournals: trashedJ.length, deletedPermanentGrades: trashedG.length },
      };
    }

    // =========================================================
    // HELPER 3 (MENU MATRIX PERSETUJUAN): Kelola / Kembalikan ke Draft
    // =========================================================
    async function executeSaveMatrixDraft(params: {
      className: string;
      studentIdOrName?: string;
      subjectName?: string;
      note?: string;
    }): Promise<{ success: boolean; message: string; data?: any }> {
      const { className, studentIdOrName, subjectName, note } = params;

      const cleanClass = (className || "").replace(/[-\s]/g, "").toLowerCase();
      const classConds = [
        sql`lower(${classes.name}) = lower(${className})`,
        sql`replace(replace(lower(${classes.name}), '-', ''), ' ', '') = ${cleanClass}`,
      ];
      if (isUuid(className)) classConds.push(eq(classes.id, className));

      const [resolvedClass] = await db
        .select({ id: classes.id, name: classes.name })
        .from(classes)
        .where(or(...classConds))
        .limit(1);

      if (!resolvedClass) {
        return { success: false, message: `Kelas "${className}" tidak ditemukan di database.` };
      }

      // Cek kepemilikan Wali Kelas untuk Matrix Persetujuan
      const classWalas = ctx.allHomeroomTeachers.filter((ht) => ht.classId === resolvedClass.id);
      const isMyHomeroom = classWalas.some((ht) => ht.userId === user.id);

      if (!isAdminUser && !isMyHomeroom) {
        const otherWalasNames = classWalas.map((ht) => ht.teacherName).join(", ") || "Wali Kelas Lain";
        const myHomeroomNames = ctx.allHomeroomTeachers
          .filter((ht) => ht.userId === user.id)
          .map((ht) => ht.className)
          .join(", ") || "Tidak ada";
        return {
          success: false,
          message: `⛔ **Matrix Persetujuan Tidak Dapat Diubah (Kelas Perwalian Guru Lain)**\n- **Menu:** Matrix Persetujuan (\`/walikelas\`)\n- **Kelas:** **${resolvedClass.name}**\n- **Wali Kelas Pengampu:** **${otherWalasNames}** *(Kelas Perwalian Anda: ${myHomeroomNames})*\n\n> ⚠️ Sesuai aturan SIMAK, Anda tidak dapat mengubah status Matrix Persetujuan kelas yang diampu oleh Wali Kelas lain.`,
        };
      }

      // Filter siswa jika disebutkan spesifik
      let targetStudentId: string | undefined;
      let targetStudentName = "Seluruh Siswa";
      if (studentIdOrName && studentIdOrName.toUpperCase() !== "SEMUA" && studentIdOrName.toUpperCase() !== "ALL") {
        const [st] = await db
          .select({ id: students.id, name: students.name })
          .from(students)
          .where(
            and(
              eq(students.classId, resolvedClass.id),
              or(
                isUuid(studentIdOrName) ? eq(students.id, studentIdOrName) : sql`1=0`,
                sql`lower(${students.name}) like lower(${'%' + studentIdOrName.trim() + '%'})`
              )
            )
          )
          .limit(1);
        if (!st) {
          return { success: false, message: `Siswa "${studentIdOrName}" tidak ditemukan di kelas ${resolvedClass.name}.` };
        }
        targetStudentId = st.id;
        targetStudentName = st.name;
      }

      // Filter mapel jika disebutkan spesifik
      let targetSubjectId: string | undefined;
      let targetSubjectName = "Semua Mata Pelajaran";
      if (subjectName && subjectName.toUpperCase() !== "SEMUA" && subjectName.toUpperCase() !== "ALL") {
        const [subj] = await db
          .select({ id: subjects.id, name: subjects.name })
          .from(subjects)
          .where(
            or(
              sql`lower(${subjects.name}) = lower(${subjectName})`,
              sql`lower(${subjects.code}) = lower(${subjectName})`,
              sql`lower(${subjects.name}) like lower(${'%' + subjectName + '%'})`
            )
          )
          .limit(1);
        if (subj) {
          targetSubjectId = subj.id;
          targetSubjectName = subj.name;
        }
      }

      const conds = [eq(grades.classId, resolvedClass.id), isNull(grades.deletedAt)];
      if (targetStudentId) conds.push(eq(grades.studentId, targetStudentId));
      if (targetSubjectId) conds.push(eq(grades.subjectId, targetSubjectId));

      const existingRows = await db.select().from(grades).where(and(...conds));
      if (existingRows.length === 0) {
        return {
          success: false,
          message: `⚠️ Belum ada data nilai pada **Matrix Persetujuan** untuk **${targetStudentName}** di kelas **${resolvedClass.name}** (${targetSubjectName}).`,
        };
      }

      const prevStatuses = [...new Set(existingRows.map((r) => r.status))].join(", ");
      const prevNotes = [...new Set(existingRows.map((r) => r.note).filter(Boolean))].join("; ") || "-";
      const newNote = note || "Koreksi ulang / dikembalikan ke Draft melalui Asisten AI";

      for (const g of existingRows) {
        const [updated] = await db
          .update(grades)
          .set({
            status: "draft",
            note: newNote,
            submittedBy: null,
            submittedAt: null,
            approvedBy: null,
            approvedAt: null,
            updatedAt: new Date(),
          })
          .where(eq(grades.id, g.id))
          .returning();

        await db.insert(gradeAuditLogs).values({
          gradeId: g.id,
          actorId: user.id,
          action: "ai_matrix_draft",
          before: g as unknown as Record<string, unknown>,
          after: updated as unknown as Record<string, unknown>,
        });
      }

      broadcastRealtimeEvent({
        type: "grade_rejected",
        classId: resolvedClass.id,
        actorId: user.id,
      });

      return {
        success: true,
        message: `✅ **Matrix Persetujuan Berhasil Disimpan ke Draft (Auto-Save Draft)**\n- **Menu:** Matrix Persetujuan (\`/walikelas\`) & Input Nilai (\`/guru\`)\n- **Kelas:** **${resolvedClass.name}**\n- **Cakupan Siswa:** **${targetStudentName}** (${existingRows.length} data mapel)\n- **Mata Pelajaran:** **${targetSubjectName}**\n- 🔄 **Data Sebelumnya:** Status = **${prevStatuses}** | Catatan Sebelumnya = *"${prevNotes}"*\n- ✨ **Diganti Menjadi:** Status = **Draft (Koreksi Ulang)** | Catatan Baru = **"${newNote}"**`,
        data: { updatedCount: existingRows.length },
      };
    }

    const aiActions: Array<{
      type: string;
      payload: Record<string, unknown>;
      result: { success: boolean; step?: string; message: string; data?: unknown };
    }> = [];

    // =========================================================
    // LAYER 1: Ekstrak blok action ```action ... ``` jika ada
    // =========================================================
    const actionBlockRegex = /```action\s*([\s\S]*?)```/gi;
    let actionMatch: RegExpExecArray | null;
    const executedActionKeys = new Set<string>();

    while ((actionMatch = actionBlockRegex.exec(rawReply)) !== null) {
      const blockText = actionMatch[1].trim();
      const lines = blockText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const actionType = lines[0]?.toUpperCase();

      const parseParams = () => {
        const p: Record<string, string> = {};
        for (const line of lines.slice(1)) {
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;
          const key = line.slice(0, colonIdx).trim().toLowerCase().replace(/-/g, "_");
          const val = line.slice(colonIdx + 1).trim();
          p[key] = val;
        }
        return p;
      };

      if (actionType === "SAVE_GRADE_DRAFT") {
        const params = parseParams();
        const studentIdOrName = params["student_id"] || params["studentid"] || params["id"] || params["siswa"] || params["student"];
        const className       = params["kelas"] || params["class"];
        const subjectName     = params["mapel"] || params["subject"];
        const fieldRaw        = params["field"] || "";
        const nilaiRaw        = parseFloat(params["nilai"] || params["value"] || "");
        const ay              = params["tahun"] || params["tahun_ajaran"] || "2025/2026";
        const sem             = parseInt(params["semester"] || "1", 10);

        const dedupKey = `GRADE|${studentIdOrName}|${className}|${subjectName}|${fieldRaw}`.toLowerCase();
        if (studentIdOrName && className && subjectName && fieldRaw && !isNaN(nilaiRaw) && !executedActionKeys.has(dedupKey)) {
          executedActionKeys.add(dedupKey);
          const res = await executeSaveGradeDraft({
            studentIdOrName,
            className,
            subjectName,
            field: fieldRaw,
            score: nilaiRaw,
            academicYear: ay,
            semester: sem,
          });
          aiActions.push({ type: actionType, payload: params, result: res });
        }
      }

      if (actionType === "SAVE_JOURNAL_DRAFT") {
        const params = parseParams();
        const tanggal       = params["tanggal"] || params["date"] || todayIso;
        const className     = params["kelas"] || params["class"] || "";
        const subjectName   = params["mapel"] || params["subject"] || "";
        const startHourId   = params["jam_awal_id"] || params["jam_awal"] || params["start_hour_id"] || params["start"] || "";
        const endHourId     = params["jam_akhir_id"] || params["jam_akhir"] || params["end_hour_id"] || params["end"] || startHourId;
        const materi        = params["materi"] || params["material"] || "";
        const presenceInfo  = params["presensi"] || params["presence"] || params["presence_info"] || "";

        const dedupKey = `JOURNAL|${tanggal}|${className}|${startHourId}|${endHourId}`.toLowerCase();
        if (className && subjectName && startHourId && !executedActionKeys.has(dedupKey)) {
          executedActionKeys.add(dedupKey);
          const res = await executeSaveJournalDraft({
            tanggal,
            className,
            subjectName,
            startHourIdOrLabel: startHourId,
            endHourIdOrLabel: endHourId || startHourId,
            materi,
            presenceInfo,
          });
          aiActions.push({ type: actionType, payload: params, result: res });
        }
      }

      if (actionType === "DELETE_JOURNAL") {
        const params = parseParams();
        const tanggal     = params["tanggal"] || params["date"] || todayIso;
        const className   = params["kelas"] || params["class"] || "SEMUA";
        const startHourId = params["jam_awal_id"] || params["jam_awal"] || params["start_hour_id"] || "SEMUA";
        const endHourId   = params["jam_akhir_id"] || params["jam_akhir"] || params["end_hour_id"] || startHourId;

        const dedupKey = `DEL_JOURNAL|${tanggal}|${className}|${startHourId}|${endHourId}`.toLowerCase();
        if (!executedActionKeys.has(dedupKey)) {
          executedActionKeys.add(dedupKey);
          const res = await executeDeleteJournal({
            tanggal,
            className,
            startHourIdOrLabel: startHourId,
            endHourIdOrLabel: endHourId,
          });
          aiActions.push({ type: actionType, payload: params, result: res });
        }
      }

      if (actionType === "DELETE_GRADE") {
        const params = parseParams();
        const className       = params["kelas"] || params["class"] || "SEMUA";
        const studentIdOrName = params["siswa"] || params["student"] || "SEMUA";
        const subjectName     = params["mapel"] || params["subject"] || "SEMUA";

        const dedupKey = `DEL_GRADE|${className}|${studentIdOrName}|${subjectName}`.toLowerCase();
        if (!executedActionKeys.has(dedupKey)) {
          executedActionKeys.add(dedupKey);
          const res = await executeDeleteGrade({ className, studentIdOrName, subjectName });
          aiActions.push({ type: actionType, payload: params, result: res });
        }
      }

      if (actionType === "RESTORE_TRASH") {
        const params = parseParams();
        const tipe      = params["tipe"] || params["type"] || "SEMUA";
        const tanggal   = params["tanggal"] || params["date"] || "SEMUA";
        const className = params["kelas"] || params["class"] || "SEMUA";

        const dedupKey = `RESTORE_TRASH|${tipe}|${tanggal}|${className}`.toLowerCase();
        if (!executedActionKeys.has(dedupKey)) {
          executedActionKeys.add(dedupKey);
          const res = await executeRestoreTrash({ tipe, tanggal, className });
          aiActions.push({ type: actionType, payload: params, result: res });
        }
      }

      if (actionType === "PERMANENT_DELETE_TRASH") {
        const params = parseParams();
        const tipe      = params["tipe"] || params["type"] || "SEMUA";
        const tanggal   = params["tanggal"] || params["date"] || "SEMUA";
        const className = params["kelas"] || params["class"] || "SEMUA";

        const dedupKey = `PERM_DEL_TRASH|${tipe}|${tanggal}|${className}`.toLowerCase();
        if (!executedActionKeys.has(dedupKey)) {
          executedActionKeys.add(dedupKey);
          const res = await executePermanentDeleteTrash({ tipe, tanggal, className });
          aiActions.push({ type: actionType, payload: params, result: res });
        }
      }

      if (actionType === "SAVE_MATRIX_DRAFT") {
        const params = parseParams();
        const className       = params["kelas"] || params["class"] || "";
        const studentIdOrName = params["siswa"] || params["student"] || params["student_id"] || "SEMUA";
        const subjectName     = params["mapel"] || params["subject"] || "SEMUA";
        const note            = params["catatan"] || params["note"] || "";

        const dedupKey = `MATRIX|${className}|${studentIdOrName}|${subjectName}`.toLowerCase();
        if (className && !executedActionKeys.has(dedupKey)) {
          executedActionKeys.add(dedupKey);
          const res = await executeSaveMatrixDraft({
            className,
            studentIdOrName,
            subjectName,
            note,
          });
          aiActions.push({ type: actionType, payload: params, result: res });
        }
      }
    }

    // =========================================================
    // LAYER 1B: Fallback cerdas untuk Verifikasi 2 Langkah (Langkah 1 & Langkah 2)
    // =========================================================
    const promptToCheck = lastUserLower;

    // Jika ini adalah balasan konfirmasi Langkah 2 ("Ya", "Yakin", dll.) dan Gemini tidak membuat blok action:
    if (aiActions.length === 0 && isTwoStepConfirmed) {
      if (/hapus\s+permanen|tempat\s+sampah[\s\S]*tidak\s+bisa\s+dikembalikan/i.test(prevModelMsg)) {
        const res = await executePermanentDeleteTrash({ tipe: "SEMUA" });
        aiActions.push({
          type: "PERMANENT_DELETE_TRASH",
          payload: { from: "step2_confirmation_fallback" },
          result: res,
        });
      } else if (/konfirmasi\s+penghapusan\s+data\s+nilai/i.test(prevModelMsg)) {
        const res = await executeDeleteGrade({ className: "SEMUA" });
        aiActions.push({
          type: "DELETE_GRADE",
          payload: { from: "step2_confirmation_fallback" },
          result: res,
        });
      } else {
        // Default ke penghapusan jurnal yang sedang dikonfirmasi di pesan sebelumnya
        const prevClassMatch = prevModelMsg.match(/Cakupan Kelas:\*\*\s*\*\*([^*]+)\*\*/i);
        const targetClassDel = prevClassMatch?.[1]?.trim() || "SEMUA";
        const res = await executeDeleteJournal({
          tanggal: todayIso,
          className: targetClassDel,
          startHourIdOrLabel: "SEMUA",
          endHourIdOrLabel: "SEMUA",
        });
        aiActions.push({
          type: "DELETE_JOURNAL",
          payload: { from: "step2_confirmation_fallback", className: targetClassDel },
          result: res,
        });
      }
    }

    // Jika user meminta hapus data di Tempat Sampah / Soft Delete (Langkah 1):
    if (
      aiActions.length === 0 &&
      (promptToCheck.includes("hapus") || promptToCheck.includes("kosongkan") || promptToCheck.includes("bersihkan")) &&
      (promptToCheck.includes("tempat sampah") || promptToCheck.includes("soft delete") || promptToCheck.includes("recycle") || promptToCheck.includes("permanen"))
    ) {
      const res = await executePermanentDeleteTrash({ tipe: "SEMUA" });
      aiActions.push({
        type: "PERMANENT_DELETE_TRASH",
        payload: { from: "trash_delete_fallback" },
        result: res,
      });
    }

    // Jika user meminta restore / pulihkan dari Tempat Sampah:
    if (
      aiActions.length === 0 &&
      (promptToCheck.includes("pulihkan") || promptToCheck.includes("restore") || promptToCheck.includes("kembalikan")) &&
      (promptToCheck.includes("tempat sampah") || promptToCheck.includes("soft delete") || promptToCheck.includes("jurnal") || promptToCheck.includes("nilai"))
    ) {
      const res = await executeRestoreTrash({ tipe: "SEMUA" });
      aiActions.push({
        type: "RESTORE_TRASH",
        payload: { from: "trash_restore_fallback" },
        result: res,
      });
    }

    // Jika user meminta HAPUS JURNAL aktif (Langkah 1):
    if (
      aiActions.length === 0 &&
      (promptToCheck.includes("hapus") || promptToCheck.includes("delete") || promptToCheck.includes("kosongkan")) &&
      promptToCheck.includes("jurnal")
    ) {
      const isDeleteAll =
        promptToCheck.includes("semua") ||
        promptToCheck.includes("seluruh") ||
        promptToCheck.includes("tanpa terkecuali");
      const classMatchDel = promptToCheck.match(/kelas\s+([xXiI0-9\-]+)/i);
      const targetClassDel = isDeleteAll && !classMatchDel ? "SEMUA" : classMatchDel?.[1]?.trim() || "SEMUA";

      const res = await executeDeleteJournal({
        tanggal: todayIso,
        className: targetClassDel,
        startHourIdOrLabel: "SEMUA",
        endHourIdOrLabel: "SEMUA",
      });
      aiActions.push({
        type: "DELETE_JOURNAL",
        payload: { from: "delete_journal_fallback", tanggal: todayIso, className: targetClassDel },
        result: res,
      });
    }

    // =========================================================
    // LAYER 2: Fallback jika AI menjawab dengan rincian poin-poin
    // =========================================================
    if (aiActions.length === 0) {
      const studentMatch = rawReply.match(/(?:Nama\s*Siswa|siswa)\s*:\s*([^\n\r*]+)/i);
      const classMatch = rawReply.match(/(?:Kelas|kelas)\s*:\s*([^\n\r*]+)/i);
      const subjectMatch = rawReply.match(/(?:Mata\s*Pelajaran|mapel)\s*:\s*([^\n\r*(]+)/i);
      const fieldMatch = rawReply.match(/(?:Jenis\s*Penilaian|penilaian|field)\s*:\s*([^\n\r*(]+)/i);
      const scoreMatch = rawReply.match(/(?:Nilai\s*Baru|Nilai|skor)\s*:\s*(\d+(?:\.\d+)?)/i);

      if (studentMatch && classMatch && subjectMatch && fieldMatch && scoreMatch) {
        const studentRaw = studentMatch[1].trim();
        const classRaw = classMatch[1].trim();
        const subjectRaw = subjectMatch[1].trim();
        const fieldRaw = fieldMatch[1].trim();
        const scoreRaw = parseFloat(scoreMatch[1]);

        if (!isNaN(scoreRaw)) {
          const res = await executeSaveGradeDraft({
            studentIdOrName: studentRaw,
            className: classRaw,
            subjectName: subjectRaw,
            field: fieldRaw,
            score: scoreRaw,
          });
          aiActions.push({
            type: "SAVE_GRADE_DRAFT",
            payload: { from: "reply_summary", studentRaw, classRaw, scoreRaw },
            result: res,
          });
        }
      }
    }

    // =========================================================
    // LAYER 2B: Fallback jika AI menjawab rincian jurnal dengan poin-poin
    // =========================================================
    if (aiActions.length === 0 && !promptToCheck.includes("hapus")) {
      const jClassMatch = rawReply.match(/(?:Kelas|kelas)\s*:\s*([^\n\r*]+)/i);
      const jSubjectMatch = rawReply.match(/(?:Mata\s*Pelajaran|mapel)\s*:\s*([^\n\r*(]+)/i);
      const jHourMatch = rawReply.match(/(?:Jam\s*Mengajar|Jam)\s*:\s*([^\n\r*]+)/i);
      const jMateriMatch = rawReply.match(/(?:Materi(?:\s*Pembelajaran)?)\s*:\s*([^\n\r*]+)/i);
      const jPresensiMatch = rawReply.match(/(?:Presensi|Kehadiran)\s*:\s*([^\n\r*]+)/i);

      if (jClassMatch && jSubjectMatch && jHourMatch && jMateriMatch) {
        const hourRaw = jHourMatch[1].replace(/\(.*?\)/g, "").trim();
        const hourParts = hourRaw.split(/\s*(?:sampai|hingga|s\.?d\.?|s\/d|–|-)\s*/i).filter(Boolean);
        const startH = hourParts[0] || "1";
        const endH = hourParts[1] || startH;

        const res = await executeSaveJournalDraft({
          tanggal: todayIso,
          className: jClassMatch[1].trim(),
          subjectName: jSubjectMatch[1].trim(),
          startHourIdOrLabel: startH,
          endHourIdOrLabel: endH,
          materi: jMateriMatch[1].trim(),
          presenceInfo: jPresensiMatch ? jPresensiMatch[1].trim() : "Nihil (hadir semua)",
        });
        aiActions.push({
          type: "SAVE_JOURNAL_DRAFT",
          payload: { from: "reply_journal_summary", className: jClassMatch[1].trim() },
          result: res,
        });
      }
    }

    // =========================================================
    // LAYER 3: Fallback jika userPrompt langsung memerintahkan ubah nilai
    // =========================================================
    if (aiActions.length === 0 && !promptToCheck.includes("hapus") && (promptToCheck.includes("ubah") || promptToCheck.includes("nilai") || promptToCheck.includes("ganti"))) {
      const promptScoreMatch = promptToCheck.match(/(?:menjadi|jadi|ke|=)\s*(\d{1,3})/i) || promptToCheck.match(/(\d{1,3})/);
      const promptFieldMatch = promptToCheck.match(/\b(uh1|t1|sts|uh2|t2)\b/i);
      const promptClassMatch = promptToCheck.match(/\b(x(?:i{1,2})?[- ]?\d{1,2})\b/i);
      const promptSubjectMatch = promptToCheck.match(/\b(rpl|tkj|dkv)\b/i);
      const promptStudentMatch = promptToCheck.match(/nilai\s+([A-Za-z' ]+?)(?:,|\s+ubah|\s+mapel|\s+di|\s+menjadi|\s+kelas|$)/i);

      if (promptScoreMatch && promptFieldMatch && promptClassMatch && promptSubjectMatch && promptStudentMatch) {
        const res = await executeSaveGradeDraft({
          studentIdOrName: promptStudentMatch[1].trim(),
          className: promptClassMatch[1].trim(),
          subjectName: promptSubjectMatch[1].trim(),
          field: promptFieldMatch[1].trim(),
          score: parseFloat(promptScoreMatch[1]),
        });
        aiActions.push({
          type: "SAVE_GRADE_DRAFT",
          payload: { from: "prompt_fallback", student: promptStudentMatch[1] },
          result: res,
        });
      }
    }

    // =========================================================
    // LAYER 3B: Fallback jika userPrompt memerintahkan simpan jurnal
    // =========================================================
    const historyCombined = chatMessages.map((m) => m.text).join("\n").toLowerCase();
    if (aiActions.length === 0 && !promptToCheck.includes("hapus") && !isTwoStepConfirmed && (
      promptToCheck.includes("jurnal") ||
      promptToCheck.includes("simpan jurnal") ||
      promptToCheck.includes("catat jurnal") ||
      promptToCheck.includes("input jurnal") ||
      promptToCheck.includes("tambah jurnal") ||
      (promptToCheck.includes("hari ini") && historyCombined.includes("jurnal"))
    )) {
      const sourceText = promptToCheck.includes("kelas") ? promptToCheck : historyCombined;
      const journalClassMatch = sourceText.match(/kelas\s+([xXiI0-9\-\s]+?)(?:\s*,|\s+mapel|\s+jam|\s+materi|\n|$)/i);
      const journalSubjectMatch = sourceText.match(/\b(rpl|tkj|dkv|matematika|bahasa|pkk|dasar|pemrog\w*)\b/i) ||
        sourceText.match(/mapel\s+(\w[\w\s]*?)(?:\s*,|\s+jam|\s+materi|\n|$)/i);
      const journalStartHourMatch = sourceText.match(/jam\s+(pertama|kedua|ketiga|keempat|kelima|keenam|[\d]+)\s*(?:sampai|hingga|ke|s\/d|–|-)?/i);
      const journalEndHourMatch = sourceText.match(/(?:sampai|hingga|ke|s\/d|–|-)\s*(?:jam\s+)?(pertama|kedua|ketiga|keempat|kelima|keenam|[\d]+)/i);
      const journalMateriMatch = sourceText.match(/materi[:\s]+([^,\n]+?)(?:\s*,|\s+presensi|\s+kehadiran|\n|$)/i);
      const journalPresensiMatch = sourceText.match(/(?:presensi|kehadiran|hadir)[:\s]+([^,"\n]+?)(?:\s*,|"|\n|$)/i) ||
        sourceText.match(/\b(nihil|hadir semua|hadir seluruhnya)\b/i);

      const journalClass = journalClassMatch?.[1]?.trim();
      const journalSubject = journalSubjectMatch?.[1]?.trim() || journalSubjectMatch?.[2]?.trim();
      const journalStartHour = journalStartHourMatch?.[1]?.trim();
      const journalEndHour = journalEndHourMatch?.[1]?.trim() || journalStartHour;
      const journalMateri = journalMateriMatch?.[1]?.trim() || "Materi tidak disebutkan";
      const journalPresensi = journalPresensiMatch?.[1]?.trim() || "Tidak disebutkan";

      if (journalClass && journalSubject && journalStartHour) {
        const res = await executeSaveJournalDraft({
          tanggal: todayIso,
          className: journalClass,
          subjectName: journalSubject,
          startHourIdOrLabel: journalStartHour,
          endHourIdOrLabel: journalEndHour || journalStartHour,
          materi: journalMateri,
          presenceInfo: journalPresensi,
        });
        aiActions.push({
          type: "SAVE_JOURNAL_DRAFT",
          payload: { from: "prompt_fallback", journalClass, journalSubject, journalStartHour },
          result: res,
        });
      }
    }

    // Bersihkan blok action dari teks reply yang ditampilkan ke pengguna
    // Serta koreksi tanggal halusinasi 2023/2024/2025 di teks narasi AI menjadi tanggal server hari ini
    let cleanReply = rawReply
      .replace(actionBlockRegex, "")
      .replace(/\bGoogle\s+Gemini\b/gi, "NEBULA AI")
      .replace(/\bGemini\s+(?:AI|Flash|Pro|2\.0)\b/gi, "NEBULA AI")
      .replace(/\bGemini\b/gi, "NEBULA AI")
      .replace(/\b202[345]-\d{2}-\d{2}\b/g, todayIso)
      .replace(/\b\d{1,2}\s+(?:Januari|Februari|Maret|April|Mei|Juni|Juli|Agustus|September|Oktober|November|Desember)\s+202[345]\b/gi, todayReadable)
      .replace(/\s*\(pukul\s+(\d{2}:\d{2})\s*-\s*\1\)/gi, "")
      .trim();

    // SANGAT PENTING: Lampirkan konfirmasi aksi database atau Verifikasi 2 Langkah langsung ke teks balasan chat.
    let finalReply = cleanReply;
    if (aiActions.length > 0) {
      const actionSummaries = aiActions
        .map((a) => a.result.message)
        .filter(Boolean)
        .join("\n\n");
      const anyBlocked = aiActions.some((a) => !a.result.success);
      const anyStep1Verification = aiActions.some((a) => a.result.step === "verification_step_1");
      const anyStep2Completed = aiActions.some((a) => a.result.step === "verification_step_2_completed");
      const allSucceeded = aiActions.every((a) => a.result.success);
      const hasFalseRefusal = /tidak memiliki otoritas|dilarang mengubah atau menghapus|tidak dapat menghapus/i.test(cleanReply);

      if (anyBlocked && aiActions.every((a) => !a.result.success)) {
        finalReply = `Mohon perhatian ${ctx.honorific} ${user.name.split(" ")[0]}, permintaan tidak dapat langsung dilakukan karena ketentuan sistem berikut:\n\n${actionSummaries}`;
      } else if (anyStep1Verification) {
        // Pada Langkah 1 Verifikasi 2 Langkah, tampilkan langsung pesan konfirmasi sistem yang presisi agar tidak membingungkan
        finalReply = actionSummaries;
      } else if (anyStep2Completed || (allSucceeded && (hasFalseRefusal || !cleanReply))) {
        finalReply = `Baik ${ctx.honorific} ${user.name}, sesuai otoritas **${isSuperadmin ? "Superadmin" : isAdminUser ? "Admin" : "Guru"}**, permintaan Anda telah selesai dieksekusi:\n\n${actionSummaries}`;
      } else if (actionSummaries) {
        finalReply = `${finalReply}\n\n---\n${actionSummaries}`.trim();
      }
    }

    return c.json({
      success: true,
      data: {
        reply: finalReply,
        aiActions,
        honorific: ctx.honorific,
        gender: ctx.genderLabel,
        teacherName: user.name,
        storedFiles,
      },
    });
  } catch (err: any) {
    console.error("[Teacher AI Chat] Error:", err);
    return c.json(
      {
        success: false,
        message: err.message || "Gagal mendapatkan respon dari AI",
      },
      500
    );
  }
});



