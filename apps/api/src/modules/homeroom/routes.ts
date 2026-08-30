import { Hono } from "hono";
import { and, eq, inArray, or, sql, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db/index.js";
import {
  classes,
  gradeAuditLogs,
  grades,
  students,
  subjects,
  teachers,
  homeroomAssignments,
} from "../../db/schema/index.js";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { requireRoles } from "../../middlewares/rbac.js";
import { isGdsConfigured, fetchGdsPoints } from "../../services/integrations/gds.js";
import { isKehadiranConfigured, fetchKehadiranRekap, unlockStudentScoreInPasti } from "../../services/integrations/kehadiran.js";
import { broadcastRealtimeEvent } from "../../services/realtime.js";

export const homeroomRoutes = new Hono<{ Variables: AuthVariables }>();

homeroomRoutes.use("*", requireAuth, requireRoles("walikelas", "admin", "superadmin"));

async function resolveHomeroomClass(userId: string, roles: string[]) {
  if (roles.includes("admin") || roles.includes("superadmin")) {
    const all = await db.select().from(classes).orderBy(classes.name);
    return all;
  }
  // Ambil kelas yang ditugaskan ke Guru ini dari tabel homeroom_assignments
  const assigned = await db
    .select({
      id: classes.id,
      name: classes.name,
      gradeLevel: classes.gradeLevel,
      jurusan: classes.jurusan,
      urutan: classes.urutan,
      academicYear: classes.academicYear,
      academicYearId: classes.academicYearId,
      homeroomTeacherId: classes.homeroomTeacherId,
      isActive: classes.isActive,
      createdAt: classes.createdAt,
      updatedAt: classes.updatedAt,
    })
    .from(homeroomAssignments)
    .innerJoin(classes, eq(homeroomAssignments.classId, classes.id))
    .where(and(eq(homeroomAssignments.userId, userId), eq(classes.isActive, true)))
    .orderBy(classes.name);

  return assigned;
}

homeroomRoutes.get("/classes", async (c) => {
  const user = c.get("user");
  const rows = await resolveHomeroomClass(user.id, user.roles);
  return c.json({ success: true, data: rows });
});

homeroomRoutes.get("/matrix", async (c) => {
  const user = c.get("user");
  const classId = c.req.query("classId");
  const owned = await resolveHomeroomClass(user.id, user.roles);

  if (!owned.length) {
    return c.json({ success: true, data: { class: null, students: [], summary: null } });
  }

  const klass = classId ? owned.find((k) => k.id === classId) ?? owned[0] : owned[0];

  const roster = await db
    .select()
    .from(students)
    .where(eq(students.classId, klass.id))
    .orderBy(students.name);

  const gradeRows = await db
    .select({
      studentId: grades.studentId,
      subjectId: grades.subjectId,
      status: grades.status,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
      subjectName: subjects.name,
    })
    .from(grades)
    .innerJoin(subjects, eq(grades.subjectId, subjects.id))
    .where(and(eq(grades.classId, klass.id), isNull(grades.deletedAt)));

  const byStudent = new Map<string, typeof gradeRows>();
  for (const g of gradeRows) {
    const list = byStudent.get(g.studentId) ?? [];
    list.push(g);
    byStudent.set(g.studentId, list);
  }

  // Fetch real-time GDS points
  const gdsMap = new Map<string, { poin: number; catatan?: string | null }>();
  if (isGdsConfigured()) {
    try {
      const gdsPoints = await fetchGdsPoints();
      for (const p of gdsPoints) {
        const data = { poin: p.poin || 0, catatan: p.catatan || null };
        if (p.nisn) gdsMap.set(p.nisn, data);
        if (p.nis) gdsMap.set(p.nis, data);
      }
    } catch (e) {
      console.error("Matrix real-time GDS fetch failed:", e);
    }
  }

  // Fetch real-time attendance
  const attendanceMap = new Map<string, { sakit: number; izin: number; alpa: number; catatan?: string | null }>();
  if (isKehadiranConfigured()) {
    try {
      const attendance = await fetchKehadiranRekap();
      for (const a of attendance) {
        const data = { sakit: a.sakit || 0, izin: a.izin || 0, alpa: a.alpa || 0, catatan: a.catatan || null };
        if (a.nisn) attendanceMap.set(a.nisn, data);
        if (a.nis) attendanceMap.set(a.nis, data);
      }
    } catch (e) {
      console.error("Matrix real-time Kehadiran fetch failed:", e);
    }
  }

  const studentsView = roster.map((s) => {
    const gs = byStudent.get(s.id) ?? [];

    const computeCompAvg = (key: "uh1" | "t1" | "sts" | "uh2" | "t2") => {
      const vals = gs
        .map((g) => (g[key] !== null && g[key] !== undefined && g[key] !== "" ? Number(g[key]) : null))
        .filter((n): n is number => n !== null && !isNaN(n));
      return vals.length > 0 ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(1) : null;
    };

    const allApproved = gs.length > 0 && gs.every((g) => g.status === "approved");
    const allSubmittedOrApproved =
      gs.length > 0 &&
      gs.every((g) => g.status === "submitted" || g.status === "approved") &&
      gs.every(
        (g) => g.uh1 !== null || g.t1 !== null || g.sts !== null || g.uh2 !== null || g.t2 !== null
      );
    const missing = gs.length === 0;

    let status = "pending";
    if (allApproved) status = "approved";
    else if (missing) status = "incomplete";
    else if (allSubmittedOrApproved) status = "ready";
    else status = "draft";

    const gdsData = gdsMap.get(s.nisn ?? "");
    const poinGds = gdsData?.poin ?? s.poinGds;
    const catatanGds = gdsData?.catatan ?? s.catatanGds ?? null;

    const att = attendanceMap.get(s.nisn ?? "");
    const sakit = att?.sakit ?? s.sakit;
    const izin = att?.izin ?? s.izin;
    const alpa = att?.alpa ?? s.alpa;
    const catatanKehadiran = att?.catatan ?? s.catatanKehadiran ?? null;

    return {
      studentId: s.id,
      name: s.name,
      nisn: s.nisn,
      uh1: computeCompAvg("uh1"),
      t1: computeCompAvg("t1"),
      sts: computeCompAvg("sts"),
      uh2: computeCompAvg("uh2"),
      t2: computeCompAvg("t2"),
      poinGds,
      sakit,
      izin,
      alpa,
      catatanGds,
      catatanKehadiran,
      gradeCount: gs.length,
      status,
      grades: gs,
    };
  });

  const approved = studentsView.filter((s) => s.status === "approved").length;
  const ready = studentsView.filter((s) => s.status === "ready").length;
  const incomplete = studentsView.filter((s) => s.status === "incomplete" || s.status === "draft").length;

  return c.json({
    success: true,
    data: {
      class: klass,
      students: studentsView,
      summary: {
        total: studentsView.length,
        approved,
        ready,
        incomplete,
        progress: studentsView.length
          ? Math.round((approved / studentsView.length) * 100)
          : 0,
      },
    },
  });
});

const approveSchema = z.object({
  classId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).optional(),
  note: z.string().optional(),
});

homeroomRoutes.post("/approve", async (c) => {
  const body = approveSchema.parse(await c.req.json());
  const user = c.get("user");
  const owned = await resolveHomeroomClass(user.id, user.roles);
  if (!owned.find((k) => k.id === body.classId)) {
    return c.json({ success: false, message: "Bukan kelas perwalian Anda" }, 403);
  }

  const classStudents = await db
    .select({ id: students.id, name: students.name })
    .from(students)
    .where(eq(students.classId, body.classId))
    .orderBy(students.name);

  const targetStudents = body.studentIds?.length
    ? classStudents.filter((s) => body.studentIds!.includes(s.id))
    : classStudents;

  if (targetStudents.length === 0) {
    return c.json({ success: false, message: "Tidak ada siswa terpilih di kelas ini" }, 400);
  }

  const approvedList: Array<{ id: string; name: string }> = [];
  const skippedList: Array<{ id: string; name: string; reason: string }> = [];

  for (const st of targetStudents) {
    const studentGrades = await db
      .select()
      .from(grades)
      .where(and(eq(grades.studentId, st.id), eq(grades.classId, body.classId), isNull(grades.deletedAt)));

    if (studentGrades.length === 0) {
      skippedList.push({ id: st.id, name: st.name, reason: "Belum ada catatan mapel terdaftar" });
      continue;
    }

    const allApproved = studentGrades.every((g) => g.status === "approved");
    if (allApproved) {
      skippedList.push({ id: st.id, name: st.name, reason: "Sudah disetujui sebelumnya" });
      continue;
    }

    const hasDraft = studentGrades.some((g) => g.status === "draft");
    if (hasDraft) {
      const draftCount = studentGrades.filter((g) => g.status === "draft").length;
      skippedList.push({
        id: st.id,
        name: st.name,
        reason: `${draftCount} mapel masih berstatus Draft (belum disubmit guru)`,
      });
      continue;
    }

    const hasFilledValues = studentGrades.some(
      (g) => g.uh1 !== null || g.t1 !== null || g.sts !== null || g.uh2 !== null || g.t2 !== null
    );
    if (!hasFilledValues) {
      skippedList.push({ id: st.id, name: st.name, reason: "Nilai komponen masih kosong" });
      continue;
    }

    const toApprove = studentGrades.filter((g) => g.status === "submitted");
    for (const g of toApprove) {
      const [updated] = await db
        .update(grades)
        .set({
          status: "approved",
          approvedBy: user.id,
          approvedAt: new Date(),
          note: body.note ?? g.note,
          updatedAt: new Date(),
        })
        .where(eq(grades.id, g.id))
        .returning();

      await db.insert(gradeAuditLogs).values({
        gradeId: g.id,
        actorId: user.id,
        action: "approve",
        before: g as unknown as Record<string, unknown>,
        after: updated as unknown as Record<string, unknown>,
      });
    }

    approvedList.push({ id: st.id, name: st.name });
  }

  if (approvedList.length > 0) {
    broadcastRealtimeEvent({
      type: "grade_approved",
      classId: body.classId,
      studentIds: approvedList.map((s) => s.id),
      actorId: user.id,
    });
  }

  const isSingle = targetStudents.length === 1;
  if (isSingle) {
    if (approvedList.length > 0) {
      return c.json({
        success: true,
        data: { approvedCount: 1, skippedCount: 0, approvedList, skippedList },
        message: `Raport siswa "${approvedList[0].name}" berhasil disetujui!`,
      });
    } else {
      return c.json(
        {
          success: false,
          data: { approvedCount: 0, skippedCount: 1, approvedList, skippedList },
          message: `Gagal menyetujui raport "${skippedList[0]?.name}": ${skippedList[0]?.reason}`,
        },
        400
      );
    }
  }

  return c.json({
    success: true,
    data: {
      approvedCount: approvedList.length,
      skippedCount: skippedList.length,
      approvedList,
      skippedList,
    },
    message: `Persetujuan Masal Selesai! ${approvedList.length} siswa berhasil disetujui, ${skippedList.length} siswa dilewati.`,
  });
});

homeroomRoutes.post("/reject", async (c) => {
  const body = approveSchema.extend({ note: z.string().optional().default("Koreksi ulang oleh walikelas/admin") }).parse(await c.req.json());
  const user = c.get("user");
  const owned = await resolveHomeroomClass(user.id, user.roles);
  if (!owned.find((k) => k.id === body.classId)) {
    return c.json({ success: false, message: "Bukan kelas perwalian Anda" }, 403);
  }

  const rows = await db
    .select()
    .from(grades)
    .where(
      and(
        eq(grades.classId, body.classId),
        or(eq(grades.status, "submitted"), eq(grades.status, "approved")),
        body.studentIds?.length ? inArray(grades.studentId, body.studentIds) : sql`true`,
        isNull(grades.deletedAt),
      ),
    );

  // Ambil list siswa untuk di-unlock juga di aplikasi PASTI
  const studentList = await db
    .select({
      id: students.id,
      nisn: students.nisn,
    })
    .from(students)
    .where(
      and(
        eq(students.classId, body.classId),
        body.studentIds?.length ? inArray(students.id, body.studentIds) : sql`true`,
      ),
    );

  // Kirim sinyal unlock ke PASTI di background agar walas tidak menunggu lama
  for (const s of studentList) {
    if (s.nisn) {
      unlockStudentScoreInPasti(s.nisn, "kedisiplinan", body.note).catch((err) => 
        console.error(`Gagal unlock kedisiplinan siswa ${s.nisn}:`, err)
      );
      unlockStudentScoreInPasti(s.nisn, "presensi", body.note).catch((err) => 
        console.error(`Gagal unlock presensi siswa ${s.nisn}:`, err)
      );
    }
  }

  for (const g of rows) {
    const [updated] = await db
      .update(grades)
      .set({
        status: "draft",
        note: body.note,
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
      action: "reject",
      before: g as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });
  }

  broadcastRealtimeEvent({
    type: "grade_rejected",
    classId: body.classId,
    actorId: user.id,
  });

  return c.json({ success: true, data: { rejected: rows.length }, message: "Nilai berhasil diset untuk koreksi ulang!" });
});

const deleteSubjectGradeSchema = z.object({
  classId: z.string().uuid(),
  subjectId: z.string().uuid(),
  studentId: z.string().uuid().optional(),
});

homeroomRoutes.post("/delete-subject-grade", async (c) => {
  const body = deleteSubjectGradeSchema.parse(await c.req.json());
  const user = c.get("user");
  const owned = await resolveHomeroomClass(user.id, user.roles);
  if (!owned.find((k) => k.id === body.classId)) {
    return c.json({ success: false, message: "Bukan kelas perwalian Anda" }, 403);
  }

  const conditions = [
    eq(grades.classId, body.classId),
    eq(grades.subjectId, body.subjectId),
    isNull(grades.deletedAt),
  ];

  if (body.studentId) {
    conditions.push(eq(grades.studentId, body.studentId));
  }

  const rows = await db.select().from(grades).where(and(...conditions));

  if (rows.length === 0) {
    return c.json({ success: false, message: "Catatan nilai mapel tidak ditemukan atau sudah dihapus" }, 400);
  }

  for (const g of rows) {
    const [updated] = await db
      .update(grades)
      .set({
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(grades.id, g.id))
      .returning();

    await db.insert(gradeAuditLogs).values({
      gradeId: g.id,
      actorId: user.id,
      action: "delete",
      before: g as unknown as Record<string, unknown>,
      after: updated as unknown as Record<string, unknown>,
    });
  }

  broadcastRealtimeEvent({
    type: "grade_deleted",
    classId: body.classId,
    subjectId: body.subjectId,
    studentId: body.studentId,
    actorId: user.id,
  });

  const scopeLabel = body.studentId ? "untuk siswa ini" : "untuk seluruh siswa di kelas";
  return c.json({
    success: true,
    data: { deletedCount: rows.length },
    message: `Berhasil menghapus catatan nilai mata pelajaran ${scopeLabel}!`,
  });
});

