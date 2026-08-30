/**
 * Academic lifecycle service — aligned with ScholarGate-SSO:
 * - academic_years activate (single active)
 * - bulk assign active year
 * - grade progression SEM → X → XI → XII → Alumni
 * - mark keluar (mutasi) / restore to siswa
 * - migrate XII → alumni / purge alumni by year
 */
import { and, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import {
  academicHistories,
  academicYears,
  classes,
  roles,
  students,
  teachers,
  userRoles,
  users,
} from "../db/schema/index.js";

export type GradeLevel = "SEM" | "X" | "XI" | "XII" | "ALUMNI" | "UNKNOWN";

const PROGRESSION: Record<string, GradeLevel | "LULUS"> = {
  SEM: "X",
  X: "XI",
  XI: "XII",
  XII: "LULUS",
};

export function normalizeGradeLevel(level: string | null | undefined): GradeLevel {
  if (!level) return "UNKNOWN";
  const u = level.trim().toUpperCase();
  if (u === "SEM" || u === "X" || u === "XI" || u === "XII") return u;
  if (u === "ALUMNI" || u === "LULUS") return "ALUMNI";
  return "UNKNOWN";
}

export function nextGradeLevel(current: GradeLevel): GradeLevel | "LULUS" | null {
  if (current === "UNKNOWN" || current === "ALUMNI") return null;
  return PROGRESSION[current] ?? null;
}

export async function getActiveAcademicYear() {
  const [row] = await db
    .select()
    .from(academicYears)
    .where(eq(academicYears.isActive, true))
    .limit(1);
  return row ?? null;
}

export async function listAcademicYears() {
  return db.select().from(academicYears).orderBy(sql`${academicYears.name} desc`);
}

export async function createAcademicYear(name: string) {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Nama tahun pelajaran wajib diisi");
  const [row] = await db.insert(academicYears).values({ name: trimmed }).returning();
  return row;
}

/** Activate one year; deactivate others. Returns pending XII alumni count. */
export async function activateAcademicYear(yearId: string) {
  const [year] = await db.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
  if (!year) throw new Error("Tahun pelajaran tidak ditemukan");

  await db.transaction(async (tx) => {
    await tx.update(academicYears).set({ isActive: false, updatedAt: new Date() });
    await tx
      .update(academicYears)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(academicYears.id, yearId));
  });

  const pending = await countPendingAlumni(yearId);
  return { year: { ...year, isActive: true }, pendingAlumni: pending };
}

export async function deleteAcademicYear(yearId: string) {
  const [year] = await db.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
  if (!year) throw new Error("Tahun pelajaran tidak ditemukan");
  if (year.isActive) throw new Error("Tidak bisa menghapus tahun pelajaran yang sedang aktif");
  await db.delete(academicYears).where(eq(academicYears.id, yearId));
  return true;
}

/** Bulk set academic_year_id for active member tracks (siswa, guru, tendik) */
export async function bulkAssignActiveYear() {
  const active = await getActiveAcademicYear();
  if (!active) throw new Error("Tidak ada tahun pelajaran aktif");

  const studentResult = await db
    .update(students)
    .set({ academicYearId: active.id, updatedAt: new Date() })
    .where(
      and(
        eq(students.memberStatus, "siswa"),
        or(sql`${students.academicYearId} is null`, ne(students.academicYearId, active.id)),
      ),
    )
    .returning({ id: students.id });

  const teacherResult = await db
    .update(teachers)
    .set({ academicYearId: active.id, updatedAt: new Date() })
    .where(or(sql`${teachers.academicYearId} is null`, ne(teachers.academicYearId, active.id)))
    .returning({ id: teachers.id });

  return {
    year: active,
    studentsUpdated: studentResult.length,
    teachersUpdated: teacherResult.length,
  };
}

/**
 * XII siswa with academic_year_id set AND != active year → pending alumni
 * (ScholarGate countPendingAlumni)
 */
export async function countPendingAlumni(activeYearId?: string) {
  const active = activeYearId
    ? { id: activeYearId }
    : await getActiveAcademicYear();
  if (!active) return 0;

  const rows = await db
    .select({ id: students.id })
    .from(students)
    .innerJoin(classes, eq(students.classId, classes.id))
    .where(
      and(
        eq(students.memberStatus, "siswa"),
        eq(classes.gradeLevel, "XII"),
        isNotNull(students.academicYearId),
        ne(students.academicYearId, active.id),
      ),
    );
  return rows.length;
}

export async function listPendingAlumni() {
  const active = await getActiveAcademicYear();
  if (!active) return [];

  return db
    .select({
      id: students.id,
      name: students.name,
      nis: students.nis,
      nisn: students.nisn,
      className: classes.name,
      gradeLevel: classes.gradeLevel,
      academicYearId: students.academicYearId,
    })
    .from(students)
    .innerJoin(classes, eq(students.classId, classes.id))
    .where(
      and(
        eq(students.memberStatus, "siswa"),
        eq(classes.gradeLevel, "XII"),
        isNotNull(students.academicYearId),
        ne(students.academicYearId, active.id),
      ),
    )
    .orderBy(students.name);
}

async function replaceUserMemberRole(userId: string | null, fromCodes: string[], toCode: string | null) {
  if (!userId) return;
  const allRoles = await db.select().from(roles);
  const byCode = new Map(allRoles.map((r) => [r.code, r]));

  const links = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
  for (const link of links) {
    const role = allRoles.find((r) => r.id === link.roleId);
    if (role && fromCodes.includes(role.code)) {
      await db.delete(userRoles).where(eq(userRoles.id, link.id));
    }
  }

  if (toCode) {
    const target = byCode.get(toCode);
    if (!target) return;
    const remaining = await db.select().from(userRoles).where(eq(userRoles.userId, userId));
    if (!remaining.some((l) => l.roleId === target.id)) {
      await db.insert(userRoles).values({ userId, roleId: target.id });
    }
  }
}

/**
 * Mark student as keluar (mutasi). Only from memberStatus=siswa.
 * Blocks login via role keluar; clears active class.
 */
export async function markStudentKeluar(studentId: string, note?: string) {
  const [s] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!s) throw new Error("Siswa tidak ditemukan");
  if (s.memberStatus !== "siswa") {
    throw new Error("Hanya siswa aktif yang dapat dipindahkan ke status keluar/mutasi");
  }

  const active = await getActiveAcademicYear();
  if (active) {
    await db.insert(academicHistories).values({
      studentId: s.id,
      academicYearId: active.id,
      classId: s.classId,
      className: s.kelasLabel,
      role: "keluar",
      note: note ?? "Mutasi/keluar",
    }).onConflictDoNothing();
  }

  const [updated] = await db
    .update(students)
    .set({
      memberStatus: "keluar",
      isActive: false,
      classId: null,
      kelasLabel: null,
      statusNote: note ?? "Mutasi/keluar",
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(students.id, studentId))
    .returning();

  await replaceUserMemberRole(s.userId, ["siswa", "alumni"], "keluar");
  if (s.userId) {
    await db
      .update(users)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(users.id, s.userId));
  }

  return updated;
}

/** Restore keluar → siswa aktif (admin). Optional classId. */
export async function restoreStudentFromKeluar(
  studentId: string,
  opts?: { classId?: string; note?: string },
) {
  const [s] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!s) throw new Error("Data tidak ditemukan");
  if (s.memberStatus !== "keluar") {
    throw new Error("Hanya status keluar yang bisa dikembalikan menjadi siswa");
  }

  const active = await getActiveAcademicYear();
  let kelasLabel: string | null = null;
  if (opts?.classId) {
    const [klass] = await db.select().from(classes).where(eq(classes.id, opts.classId)).limit(1);
    if (!klass) throw new Error("Kelas tidak ditemukan");
    kelasLabel = klass.name;
  }

  const [updated] = await db
    .update(students)
    .set({
      memberStatus: "siswa",
      isActive: true,
      classId: opts?.classId ?? null,
      kelasLabel,
      academicYearId: active?.id ?? s.academicYearId,
      statusNote: opts?.note ?? "Dikembalikan ke siswa aktif",
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(students.id, studentId))
    .returning();

  await replaceUserMemberRole(s.userId, ["keluar", "alumni"], "siswa");
  if (s.userId) {
    await db
      .update(users)
      .set({ isActive: true, updatedAt: new Date() })
      .where(eq(users.id, s.userId));
  }

  return updated;
}

/** Bulk migrate pending XII → alumni (ScholarGate migrateToAlumni) */
export async function migratePendingToAlumni() {
  const active = await getActiveAcademicYear();
  if (!active) throw new Error("Tidak ada tahun pelajaran aktif");

  const pending = await listPendingAlumni();
  let count = 0;

  for (const p of pending) {
    await promoteStudentToAlumni(p.id, `Lulus — dipindah otomatis saat tahun ${active.name}`);
    count += 1;
  }
  return { count, year: active };
}

export async function promoteStudentToAlumni(studentId: string, note?: string) {
  const [s] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!s) throw new Error("Siswa tidak ditemukan");
  if (s.memberStatus !== "siswa") {
    throw new Error("Hanya siswa aktif yang bisa dijadikan alumni");
  }

  const active = await getActiveAcademicYear();
  if (active) {
    await db
      .insert(academicHistories)
      .values({
        studentId: s.id,
        academicYearId: s.academicYearId ?? active.id,
        classId: s.classId,
        className: s.kelasLabel,
        role: "alumni",
        note: note ?? "Kelulusan",
      })
      .onConflictDoNothing();
  }

  // Keep academicYearId as graduation year snapshot
  const [updated] = await db
    .update(students)
    .set({
      memberStatus: "alumni",
      isActive: false,
      classId: null,
      kelasLabel: "ALUMNI",
      statusNote: note ?? "Alumni",
      statusChangedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(students.id, studentId))
    .returning();

  await replaceUserMemberRole(s.userId, ["siswa", "keluar"], "alumni");
  return updated;
}

/** Permanent delete alumni by graduation academic_year_id */
export async function purgeAlumniByYear(yearId: string) {
  const [year] = await db.select().from(academicYears).where(eq(academicYears.id, yearId)).limit(1);
  if (!year) throw new Error("Tahun pelajaran tidak ditemukan");

  const rows = await db
    .select({ id: students.id, userId: students.userId })
    .from(students)
    .where(and(eq(students.memberStatus, "alumni"), eq(students.academicYearId, yearId)));

  if (rows.length === 0) return { count: 0, year };

  const ids = rows.map((r) => r.id);
  await db.delete(students).where(inArray(students.id, ids));
  return { count: rows.length, year };
}

export async function purgeAllKeluar() {
  const rows = await db
    .select({ id: students.id })
    .from(students)
    .where(eq(students.memberStatus, "keluar"));
  if (rows.length === 0) return { count: 0 };
  await db.delete(students).where(inArray(students.id, rows.map((r) => r.id)));
  return { count: rows.length };
}

/**
 * Admin promote class levels for a year rollover:
 * - SEM → X (if target class mapping by grade)
 * - X → XI, XI → XII by matching jurusan + next grade class if exists
 * - XII left for alumni migration
 *
 * Simple strategy: update gradeLevel on student's class is NOT done;
 * reassign student.classId to a class with next gradeLevel same jurusan when available.
 */
export async function advanceActiveStudentsToNextGrade() {
  const active = await getActiveAcademicYear();
  if (!active) throw new Error("Tidak ada tahun pelajaran aktif");

  const allClasses = await db.select().from(classes);
  const byKey = new Map(
    allClasses.map((c) => [`${(c.gradeLevel ?? "").toUpperCase()}|${c.jurusan ?? ""}`, c]),
  );

  const activeStudents = await db
    .select({
      student: students,
      class: classes,
    })
    .from(students)
    .leftJoin(classes, eq(students.classId, classes.id))
    .where(eq(students.memberStatus, "siswa"));

  let advanced = 0;
  let needAlumni = 0;
  let skipped = 0;

  for (const row of activeStudents) {
    const s = row.student;
    const curr = normalizeGradeLevel(row.class?.gradeLevel ?? null);
    const next = nextGradeLevel(curr);

    // snapshot history
    if (s.academicYearId) {
      await db
        .insert(academicHistories)
        .values({
          studentId: s.id,
          academicYearId: s.academicYearId,
          classId: s.classId,
          className: s.kelasLabel ?? row.class?.name,
          role: "siswa",
          note: "Snapshot sebelum naik kelas",
        })
        .onConflictDoNothing();
    }

    if (next === "LULUS") {
      needAlumni += 1;
      skipped += 1;
      continue;
    }
    if (!next || next === null) {
      skipped += 1;
      continue;
    }

    const jurusan = row.class?.jurusan ?? "";
    const target =
      byKey.get(`${next}|${jurusan}`) ??
      allClasses.find((c) => (c.gradeLevel ?? "").toUpperCase() === next);

    if (!target) {
      skipped += 1;
      continue;
    }

    await db
      .update(students)
      .set({
        classId: target.id,
        kelasLabel: target.name,
        academicYearId: active.id,
        updatedAt: new Date(),
      })
      .where(eq(students.id, s.id));
    advanced += 1;
  }

  return { advanced, needAlumni, skipped, year: active };
}

export async function getAcademicLifecycleSummary() {
  const active = await getActiveAcademicYear();
  const pendingAlumni = active ? await countPendingAlumni(active.id) : 0;
  const [siswa] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(students)
    .where(eq(students.memberStatus, "siswa"));
  const [alumni] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(students)
    .where(eq(students.memberStatus, "alumni"));
  const [keluar] = await db
    .select({ value: sql<number>`count(*)::int` })
    .from(students)
    .where(eq(students.memberStatus, "keluar"));

  return {
    activeYear: active,
    counts: {
      siswa: siswa.value,
      alumni: alumni.value,
      keluar: keluar.value,
      pendingAlumni,
    },
  };
}
