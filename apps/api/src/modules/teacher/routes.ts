import { Hono } from "hono";
import { and, desc, eq, inArray, or, sql, isNull, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  classes,
  classSubjects,
  gradeAuditLogs,
  grades,
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
import { uploadFile } from "../../services/storage/storage.service.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

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

    // Cek bentrokan kebenaran absolut 3-dimensi: [date, (classId OR className), teachingHourId]
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
        status: teacherJournals.status,
        groupId: teacherJournals.groupId,
      })
      .from(teacherJournals)
      .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
      .where(
        and(
          eq(teacherJournals.date, body.date),
          classCondition,
          inArray(teacherJournals.teachingHourId, targetHourIds),
          isNull(teacherJournals.deletedAt)
        )
      );

    // Cari bentrokan:
    // 1. Diisi oleh guru lain (teacherUserId !== user.id) -> BENTROK (baik draft maupun sent)
    // 2. Diisi oleh guru sendiri & status sent -> BENTROK (jika bukan mengedit grup yang sama)
    const conflict = existing3DJournals.find((j) => {
      if (j.teacherUserId !== user.id) return true;
      if (j.status === "sent" && (!activeGroupId || j.groupId !== activeGroupId)) return true;
      return false;
    });

    if (conflict) {
      const guruName = conflict.teacherName || "Guru Lain";
      const hourLabel = conflict.teachingHourLabel || "Jam Terpilih";
      const mapelName = conflict.subjectName || "Mata Pelajaran";
      const klsName = conflict.className || body.className || "Kelas";

      return c.json(
        {
          success: false,
          conflict: true,
          message: `Jam mengajar (${hourLabel}) di kelas ${klsName} pada tanggal ${body.date} SUDAH TERISI oleh ${guruName} (Mata Pelajaran: ${mapelName}). Spesifik 1 kelas & 1 jam mengajar pada tanggal tersebut hanya dapat diisi oleh 1 guru.`,
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
      // Buat groupId baru
      activeGroupId = crypto.randomUUID();
      // Bersihkan bentrokan draft jam terpilih jika ada
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
    }

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

    const message = body.status === "sent" ? "Jurnal berhasil dikirim" : "Jurnal disimpan sebagai draft";
    return c.json({ success: true, data: { groupId: activeGroupId }, message });
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

  // 2. Ambil mapel yang diampu
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

  // 7. Tentukan sapaan berdasarkan jenis kelamin
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
    taughtClasses,
    activeClasses,
    studentRoster,
    honorific,
    genderLabel,
    subjectNames,
    classNames,
    adminUsers,
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
 * POST /api/teacher/ai/chat
 * Endpoint chat interaktif dengan Google Gemini API
 */
teacherRoutes.post("/ai/chat", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();
  const { messages = [], userPrompt, systemPromptExtra, files = [] } = body;

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

  // Buat tabel daftar siswa dari kelas yang diajar (untuk resolusi identifier)
  const studentRosterText =
    ctx.studentRoster.length > 0
      ? ctx.studentRoster
          .map(
            (s) =>
              `| ${s.name} | ${s.nis ?? "-"} | ${s.nisn ?? "-"} | ${s.className} | \`${s.id}\` |`
          )
          .join("\n")
      : "| (Tidak ada data siswa) | - | - | - | - |";

  const systemInstruction = `Anda adalah Asisten AI Resmi SIMAK (Sistem Informasi Manajemen Akademik) SMA Negeri 3 Mojokerto (SMAGA).

## Identitas Pengguna yang Sedang Login
- Nama Lengkap: ${user.name}
- User ID: ${user.id}
- Sapaan: ${ctx.honorific} ${user.name} (jenis kelamin: ${ctx.genderLabel}) — WAJIB konsisten menggunakan "${ctx.honorific}"
- NIP: ${ctx.teacher?.nip || "Tidak tercatat"}
- Mata Pelajaran Resmi yang Diampu: ${ctx.subjectNames}

## Penugasan Kelas & Mata Pelajaran
${taughtClassesText}

## 📋 Daftar Siswa Aktif Sekolah
Tabel ini berisi siswa aktif beserta Kelas, NIS, NISN, dan UUID. Gunakan data ini untuk mencocokkan input guru (bisa berupa nama lengkap, nama panggilan/sebagian, NIS, NISN, atau UUID).

| Nama Lengkap | NIS | NISN | Kelas | ID (UUID) |
|---|---|---|---|---|
${studentRosterText}

## Tugas Utama Anda
1. Panggil pengguna dengan "${ctx.honorific} ${user.name.split(" ")[0]}" secara ramah dan profesional.
2. Bantu guru dalam: pembuatan RPP/Modul Ajar Kurikulum Merdeka, bank soal, kisi-kisi, administrasi jurnal mengajar, pengolahan nilai, dan pertanyaan seputar akademik sekolah.
3. Jawab pertanyaan seputar mapel yang diampu dengan akurat mengacu data di atas.
4. Format jawaban menggunakan Markdown rapi (bullet, **tebal**, tabel, dsb.).

## 🔍 ATURAN PENCOCOKAN SISWA & KONFIRMASI (SANGAT PENTING)
Ketika guru meminta mengubah atau menyimpan nilai siswa:

1. **JIKA DITEMUKAN LEBIH DARI 1 SISWA (NAMA KEMBAR / AMBIGU):**
   - ⚠️ **DILARANG MENEBAK DAN DILARANG MEMBUAT ACTION BLOCK!**
   - Anda **WAJIB** meminta konfirmasi kepada guru dengan menyajikan daftar semua siswa yang cocok beserta Kelas dan NIS/NISN-nya:
     *Contoh respons jika guru hanya mengetik "Angelica":*
     "Ditemukan 2 siswa yang cocok dengan nama tersebut:
      1. **ANGELICA PUTRI SAVIRA** (Kelas **X-1**, NIS: 0102112563)
      2. **AIZYAH ANGELICA PUTERI** (Kelas **XI-9**, NIS: 0107617534)
      
      Mohon konfirmasi, siswa mana dan di kelas mana yang dimaksud, ${ctx.honorific} ${user.name.split(" ")[0]}?"

2. **JIKA SISWA TIDAK DITEMUKAN:**
   - Beritahu bahwa siswa tidak ditemukan di sistem. Minta guru memeriksa kembali penulisan nama, kelas, atau NIS/NISN.

3. **JIKA DATA BELUM LENGKAP:**
   - Jika guru belum menyebutkan: mapel, jenis penilaian (UH1, T1, STS, UH2, T2), atau nilai angka (0-100), tanyakan bagian yang kurang terlebih dahulu sebelum membuat action block.

4. **JIKA IDENTITAS PASTI & DATA LENGKAP (TEPAT 1 SISWA):**
   - Buat format ACTION BLOCK tepat di baris pertama respon Anda:
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
   - Di bawah action block, tulis penjelasan ramah bahwa nilai disimpan sebagai **draft** di database (bukan dikirim resmi, guru dapat meninjau di halaman Input Nilai).

## 🚫 LARANGAN KERAS — ANTI HALLUSINASI DATABASE
- **JANGAN PERNAH** mengklaim bahwa data sudah tersimpan, diperbarui permanen, atau dikunci di sistem TANPA menyertakan format ACTION BLOCK di atas.
- **JANGAN PERNAH** mengarang alasan teknis seperti "lakukan hard refresh (Ctrl+F5)", "flush memori", atau "kode eksekusi: SIMAK-XXX".
- Jika dalam riwayat obrolan sebelumnya Anda pernah mengklaim data tersimpan padahal pengguna bilang belum berubah, AKUI dengan jujur bahwa sebelumnya belum tersimpan dan gunakan ACTION BLOCK sekarang untuk menyimpannya ke database.

## ⚠️ ATURAN BISNIS APLIKASI YANG WAJIB DITEGAKKAN
### 🔒 ISOLASI DATA ANTAR PENGGUNA (PRIORITAS TERTINGGI)
- **Setiap guru HANYA boleh mengelola data MILIKNYA SENDIRI.**
- Guru yang sedang login adalah **${user.name} (ID: ${user.id})**.
- **DILARANG KERAS** membantu, memfasilitasi, atau memberikan instruksi untuk mengubah, membatalkan, menghapus, atau memanipulasi data milik guru lain — meskipun keduanya memiliki role yang sama (sesama guru).
- Contoh yang HARUS DITOLAK:
  - "Tolong ubah jurnal mengajar Pak/Bu [nama guru lain]..."
  - "Batalkan nilai yang diinput oleh guru lain..."
  - "Edit data [nama guru lain] di sistem..."
- Jika ada permintaan seperti ini → **Tolak tegas**, jelaskan bahwa data guru lain adalah privasi yang dilindungi sistem dan hanya Admin yang berwenang mengelola data lintas pengguna.

### Jurnal Mengajar (Teacher Journals)
- **Status jurnal**: \`draft\` → bisa diedit/dihapus oleh guru PEMILIKNYA sendiri | \`sent\` → sudah dikirim resmi, terkunci.
- **Setelah jurnal berstatus \`sent\`**: guru TIDAK dapat membatalkan, mengedit, atau menghapus jurnalnya sendiri.
- **Hanya Admin/Superadmin** yang berwenang membatalkan (cancel) atau mengubah jurnal yang sudah dikirim.
- Jika guru meminta pembatalan jurnal yang sudah dikirim → tolak dan arahkan ke Admin.

### Nilai Siswa (Grades)
- **Status nilai**: \`draft\` → dapat diubah oleh guru yang menginputnya | \`submitted\` → sudah diajukan, terkunci.
- Nilai yang sudah disubmit hanya bisa diubah/dibatalkan oleh **Admin/Superadmin**.
- Guru tidak dapat mengubah nilai yang diinput oleh guru lain.

### Hak Akses Berdasarkan Role
- Role **guru**: hanya bisa mengelola data miliknya sendiri (jurnal, nilai kelas yang diajarnya).
- Role **walikelas**: tambahan akses lihat/rekap data kelas yang diasuhnya, tetapi tidak bisa ubah data guru lain.
- Role **admin/superadmin**: satu-satunya role yang berwenang atas data lintas pengguna.
- **Anda TIDAK boleh** menyarankan cara mengakali/bypass aturan aplikasi dalam bentuk apapun.

## 👤 Daftar Admin Aktif SIMAK (yang berwenang menangani permintaan lintas pengguna / pembatalan data)
${adminList}

Jika guru perlu bantuan yang hanya bisa dilakukan admin, arahkan untuk **menghubungi salah satu admin di atas** secara langsung atau melalui komunikasi resmi sekolah.
${systemPromptExtra ? `\n## Instruksi Tambahan\n${systemPromptExtra}` : ""}`;


  // Format riwayat pesan untuk Gemini (dengan sanitasi error & alternasi user-model yang ketat)
  const rawList: Array<{ role: "user" | "model"; text: string }> = [];
  if (Array.isArray(messages)) {
    for (const msg of messages) {
      if (!msg.text && !msg.content) continue;
      const text = (msg.text || msg.content || "").trim();
      if (!text) continue;
      // Abaikan pesan error frontend sebelumnya agar tidak merusak konteks prompt
      if (text.startsWith("⚠️")) continue;

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
    // Store uploaded files into Object Storage (if active) or Local Storage
    const storedFiles: Array<{ name: string; url: string; provider: string }> = [];
    if (Array.isArray(files) && files.length > 0) {
      for (const f of files) {
        if (f.base64) {
          try {
            const cleanB64 = f.base64.includes(",") ? f.base64.split(",")[1] : f.base64;
            const buf = Buffer.from(cleanB64, "base64");
            const uploaded = await uploadFile({
              buffer: buf,
              filename: f.name || `file-${Date.now()}`,
              mimeType: f.type || "application/octet-stream",
              folder: "ai-chat",
            });
            storedFiles.push({
              name: f.name,
              url: uploaded.url,
              provider: uploaded.provider,
            });
          } catch (uploadErr: any) {
            console.warn("[Teacher AI Chat] File storage warning:", uploadErr.message);
          }
        }
      }
    }

    const rawReply = await askGemini({
      systemInstruction,
      messages: chatMessages,
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
    // HELPER: Eksekusi simpan draft nilai secara aman ke database
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
      const { studentIdOrName, nis, nisn, className, subjectName, field, score } = params;

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

      // 1. Resolve Class (dukung format: "X-1", "x1", "X 1", UUID)
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

      // 2. Resolve Subject (dukung "RPL", "Rekayasa Perangkat Lunak", UUID)
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

      // 3. Resolve Student (Prioritas: UUID -> NIS/NISN -> Nama di kelas ini -> Nama di sekolah)
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

      // 4. Cek status grade yang sudah ada
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

      if (existing && (existing.status === "submitted" || existing.status === "approved")) {
        return {
          success: false,
          message: `Nilai siswa "${resolvedStudent.name}" sudah berstatus "${existing.status}" dan terkunci. Hanya Admin yang dapat mengubahnya.`,
        };
      }

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

      broadcastRealtimeEvent({ type: "journal_saved", actorId: user.id });

      return {
        success: true,
        message: `✅ Nilai **${fieldKey.toUpperCase()}** siswa **${resolvedStudent.name}** (Kelas **${resolvedClass.name}**, Mapel **${resolvedSubject.name}**) berhasil disimpan sebagai **draft** di database (Nilai: **${score}**).`,
        data: savedRow,
      };
    }

    const aiActions: Array<{
      type: string;
      payload: Record<string, unknown>;
      result: { success: boolean; message: string; data?: unknown };
    }> = [];

    // =========================================================
    // LAYER 1: Ekstrak blok action ```action ... ``` jika ada
    // =========================================================
    const actionBlockRegex = /```action\s*([\s\S]*?)```/gi;
    let actionMatch: RegExpExecArray | null;

    while ((actionMatch = actionBlockRegex.exec(rawReply)) !== null) {
      const blockText = actionMatch[1].trim();
      const lines = blockText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const actionType = lines[0]?.toUpperCase();

      if (actionType === "SAVE_GRADE_DRAFT") {
        const params: Record<string, string> = {};
        for (const line of lines.slice(1)) {
          const colonIdx = line.indexOf(":");
          if (colonIdx === -1) continue;
          const key = line.slice(0, colonIdx).trim().toLowerCase();
          const val = line.slice(colonIdx + 1).trim();
          params[key] = val;
        }

        const studentIdOrName = params["student_id"] || params["studentid"] || params["id"] || params["siswa"] || params["student"];
        const className       = params["kelas"] || params["class"];
        const subjectName     = params["mapel"] || params["subject"];
        const fieldRaw        = params["field"] || "";
        const nilaiRaw        = parseFloat(params["nilai"] || params["value"] || "");
        const ay              = params["tahun"] || params["tahun_ajaran"] || "2025/2026";
        const sem             = parseInt(params["semester"] || "1", 10);

        if (studentIdOrName && className && subjectName && fieldRaw && !isNaN(nilaiRaw)) {
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
    // LAYER 3: Fallback jika userPrompt langsung memerintahkan ubah nilai
    // =========================================================
    const promptToCheck = (userPrompt || (chatMessages[chatMessages.length - 1]?.text) || "").toLowerCase();
    if (aiActions.length === 0 && (promptToCheck.includes("ubah") || promptToCheck.includes("nilai") || promptToCheck.includes("ganti"))) {
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

    // Bersihkan blok action dari teks reply yang ditampilkan ke pengguna
    const cleanReply = rawReply.replace(actionBlockRegex, "").trim();

    // SANGAT PENTING: Lampirkan konfirmasi aksi database langsung ke teks balasan chat
    let finalReply = cleanReply;
    if (aiActions.length > 0) {
      const actionSummaries = aiActions
        .map((a) => a.result.message)
        .filter(Boolean)
        .join("\n\n");
      if (actionSummaries) {
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



