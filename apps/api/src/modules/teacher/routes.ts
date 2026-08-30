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
} from "../../db/schema/index.js";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { requireRoles } from "../../middlewares/rbac.js";
import { computeAverage, isValidScore } from "../../utils/grades.js";
import { env } from "../../env.js";
import { ssoListKelas } from "../../services/sso-api-client.js";
import { broadcastRealtimeEvent } from "../../services/realtime.js";

process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

export const teacherRoutes = new Hono<{ Variables: AuthVariables }>();

teacherRoutes.use("*", requireAuth, requireRoles("guru", "walikelas", "admin", "superadmin"));

teacherRoutes.get("/debug-sso", async (c) => {
  const testUrl = `${env.SSO_API_BASE_URL}/kelas`;
  try {
    const res = await fetch(testUrl, {
      headers: {
        "X-API-Key": env.SSO_API_KEY || "",
        Origin: env.FRONTEND_URL || "https://siakad.sman3mjk.sch.id",
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
          Origin: env.FRONTEND_URL || "https://siakad.sman3mjk.sch.id",
          Referer: env.FRONTEND_URL ? `${env.FRONTEND_URL}/` : "https://siakad.sman3mjk.sch.id/",
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

    const values = {
      uh1: item.uh1 === undefined ? existing?.uh1 ?? null : item.uh1 === null ? null : String(item.uh1),
      t1: item.t1 === undefined ? existing?.t1 ?? null : item.t1 === null ? null : String(item.t1),
      sts:
        item.sts === undefined ? existing?.sts ?? null : item.sts === null ? null : String(item.sts),
      uh2: item.uh2 === undefined ? existing?.uh2 ?? null : item.uh2 === null ? null : String(item.uh2),
      t2: item.t2 === undefined ? existing?.t2 ?? null : item.t2 === null ? null : String(item.t2),
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



