/**
 * ID policy — all entity primary keys and FKs are UUID.
 * - PK: uuid().defaultRandom() → PostgreSQL gen_random_uuid() (unique by design)
 * - Never use serial/autoincrement integer for entity IDs
 * - Business keys (nis, nisn, nip, email, role code) stay human-readable text/unique
 */
import {
  boolean,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
  date,
  char,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

import {
  scholargateIdentityColumns,
  scholargateParentColumns,
} from "./profile-fields.js";

/** Surrogate primary key: UUID v4 via DB default (gen_random_uuid). */
const id = () => uuid("id").defaultRandom().primaryKey();

/**
 * Roles — ScholarGate member roles + system admin + SINTESA overlays.
 * See apps/api/src/constants/roles.ts
 */
export const roles = pgTable("roles", {
  id: id(),
  code: varchar("code", { length: 50 }).notNull().unique(),
  name: varchar("name", { length: 100 }).notNull(),
  category: varchar("category", { length: 20 }).default("member").notNull(),
  canLogin: boolean("can_login").default(true).notNull(),
  description: text("description"),
  ...timestamps,
});

/** Tahun pelajaran — mirror ScholarGate academic_years */
export const academicYears = pgTable("academic_years", {
  id: id(),
  name: varchar("name", { length: 20 }).notNull().unique(),
  isActive: boolean("is_active").default(false).notNull(),
  ...timestamps,
});

export const users = pgTable("users", {
  id: id(),
  /** External Kredensia user id (usually UUID from IDP, stored as text for flexibility). */
  ssoId: text("sso_id").unique(),
  email: varchar("email", { length: 255 }).unique(),
  username: varchar("username", { length: 100 }).unique(),
  passwordHash: text("password_hash"),
  name: varchar("name", { length: 255 }).notNull(),
  avatarUrl: text("avatar_url"),
  phone: varchar("phone", { length: 30 }),
  isActive: boolean("is_active").default(true).notNull(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  ...timestamps,
});

export const userRoles = pgTable(
  "user_roles",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("user_roles_user_role_idx").on(t.userId, t.roleId)],
);

export const authEvents = pgTable("auth_events", {
  id: id(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  eventType: varchar("event_type", { length: 50 }).notNull(),
  ip: varchar("ip", { length: 64 }),
  userAgent: text("user_agent"),
  meta: jsonb("meta").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * JWT jti anti-replay store.
 * Stored as text so external IDP jti formats remain compatible;
 * tokens we mint use UUID via newUuid().
 */
export const ssoTokenJti = pgTable("sso_token_jti", {
  jti: text("jti").primaryKey(),
  usedAt: timestamp("used_at", { withTimezone: true }).defaultNow().notNull(),
});

/**
 * Guru + Tendik profile (ScholarGate role guru|tendik).
 * staffType: guru | tendik
 */
export const teachers = pgTable(
  "teachers",
  {
    id: id(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "set null" })
      .unique(),
    /** ScholarGate role for staff: guru | tendik */
    staffType: varchar("staff_type", { length: 20 }).default("guru").notNull(),
    nip: varchar("nip", { length: 50 }).unique(),
    name: varchar("name", { length: 255 }).notNull(),
    academicYearId: uuid("academic_year_id").references(() => academicYears.id, {
      onDelete: "set null",
    }),
    isActive: boolean("is_active").default(true).notNull(),
    ...scholargateIdentityColumns,
    ...timestamps,
  },
  (t) => [
    uniqueIndex("teachers_sso_member_id_uidx").on(t.ssoMemberId),
    uniqueIndex("teachers_nik_uidx").on(t.nik),
  ],
);

export const classes = pgTable("classes", {
  id: id(),
  name: varchar("name", { length: 100 }).notNull(),
  gradeLevel: varchar("grade_level", { length: 10 }),
  /** jurusan — ScholarGate kelas.jurusan */
  jurusan: varchar("jurusan", { length: 100 }),
  urutan: integer("urutan").default(0).notNull(),
  academicYear: varchar("academic_year", { length: 20 }).notNull(),
  academicYearId: uuid("academic_year_id").references(() => academicYears.id, {
    onDelete: "set null",
  }),
  /** is_homeroom link — ScholarGate academic_histories.is_homeroom */
  homeroomTeacherId: uuid("homeroom_teacher_id").references(() => teachers.id, {
    onDelete: "set null",
  }),
  /** Soft disable — nonaktif tidak dipakai operasional (penugasan/pilih kelas) */
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

/**
 * Siswa / alumni / keluar profile.
 * memberStatus: siswa | alumni | keluar  (ScholarGate members.role)
 */
export const students = pgTable(
  "students",
  {
    id: id(),
    userId: uuid("user_id")
      .references(() => users.id, { onDelete: "set null" })
      .unique(),
    /** ScholarGate member role for learner track */
    memberStatus: varchar("member_status", { length: 20 }).default("siswa").notNull(),
    nis: varchar("nis", { length: 50 }).unique(),
    nisn: varchar("nisn", { length: 50 }).unique(),
    name: varchar("name", { length: 255 }).notNull(),
    /** @deprecated use jenisKelamin — kept for backward compat */
    gender: char("gender", { length: 1 }),
    /** @deprecated use tanggalLahir */
    birthDate: date("birth_date"),
    classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
    /** Snapshot class name from SSO (e.g. X-IPA-1 or ALUMNI) */
    kelasLabel: varchar("kelas_label", { length: 50 }),
    academicYearId: uuid("academic_year_id").references(() => academicYears.id, {
      onDelete: "set null",
    }),
    poinGds: integer("poin_gds").default(0).notNull(),
    sakit: integer("sakit").default(0).notNull(),
    izin: integer("izin").default(0).notNull(),
    alpa: integer("alpa").default(0).notNull(),
    /** Catatan dari Aplikasi PASTI saat mengirim Poin GDS */
    catatanGds: text("catatan_gds"),
    /** Catatan dari Aplikasi PASTI saat mengirim Rekap Kehadiran */
    catatanKehadiran: text("catatan_kehadiran"),
    isActive: boolean("is_active").default(true).notNull(),
    /** Alasan mutasi/keluar atau catatan kelulusan */
    statusNote: text("status_note"),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }),
    ...scholargateIdentityColumns,
    ...scholargateParentColumns,
    ...timestamps,
  },
  (t) => [
    uniqueIndex("students_sso_member_id_uidx").on(t.ssoMemberId),
    uniqueIndex("students_nik_uidx").on(t.nik),
  ],
);

/**
 * Riwayat akademik per member per tahun pelajaran
 * Mirror ScholarGate academic_histories (naik kelas / lulus / mutasi context)
 */
export const academicHistories = pgTable(
  "academic_histories",
  {
    id: id(),
    studentId: uuid("student_id").references(() => students.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id").references(() => teachers.id, { onDelete: "cascade" }),
    academicYearId: uuid("academic_year_id")
      .notNull()
      .references(() => academicYears.id, { onDelete: "cascade" }),
    classId: uuid("class_id").references(() => classes.id, { onDelete: "set null" }),
    className: varchar("class_name", { length: 50 }),
    /** Snapshot role/status: siswa | guru | tendik | alumni | keluar */
    role: varchar("role", { length: 20 }),
    isHomeroom: boolean("is_homeroom").default(false).notNull(),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("academic_histories_student_year_uidx").on(t.studentId, t.academicYearId)],
);

export const subjects = pgTable("subjects", {
  id: id(),
  name: varchar("name", { length: 150 }).notNull(),
  code: varchar("code", { length: 50 }).unique(),
  type: varchar("type", { length: 30 }).default("umum").notNull(),
  /** Soft disable — nonaktif tidak dipakai input nilai / penugasan baru */
  isActive: boolean("is_active").default(true).notNull(),
  ...timestamps,
});

export const classSubjects = pgTable(
  "class_subjects",
  {
    id: id(),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    teacherId: uuid("teacher_id")
      .notNull()
      .references(() => teachers.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("class_subjects_unique_idx").on(t.classId, t.subjectId, t.teacherId)],
);

/**
 * Pivot penugasan Guru ke Mapel (1 guru bisa merangkap beberapa mapel)
 */
export const teacherSubjects = pgTable(
  "teacher_subjects",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("teacher_subjects_unique_idx").on(t.userId, t.subjectId)],
);

/**
 * Pivot penugasan Guru ke Kelas sebagai Wali Kelas (bisa multi wali kelas)
 */
export const homeroomAssignments = pgTable(
  "homeroom_assignments",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    ...timestamps,
  },
  (t) => [uniqueIndex("homeroom_assignments_unique_idx").on(t.userId, t.classId)],
);

export const enrollments = pgTable(
  "enrollments",
  {
    id: id(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    academicYear: varchar("academic_year", { length: 20 }).notNull(),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("enrollments_unique_idx").on(t.studentId, t.classId, t.academicYear),
  ],
);

export const grades = pgTable(
  "grades",
  {
    id: id(),
    studentId: uuid("student_id")
      .notNull()
      .references(() => students.id, { onDelete: "cascade" }),
    subjectId: uuid("subject_id")
      .notNull()
      .references(() => subjects.id, { onDelete: "cascade" }),
    classId: uuid("class_id")
      .notNull()
      .references(() => classes.id, { onDelete: "cascade" }),
    academicYear: varchar("academic_year", { length: 20 }).notNull(),
    semester: smallint("semester").notNull().default(1),
    uh1: numeric("uh1", { precision: 5, scale: 2 }),
    t1: numeric("t1", { precision: 5, scale: 2 }),
    sts: numeric("sts", { precision: 5, scale: 2 }),
    uh2: numeric("uh2", { precision: 5, scale: 2 }),
    t2: numeric("t2", { precision: 5, scale: 2 }),
    status: varchar("status", { length: 20 }).default("draft").notNull(),
    submittedBy: uuid("submitted_by").references(() => users.id, { onDelete: "set null" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    approvedBy: uuid("approved_by").references(() => users.id, { onDelete: "set null" }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    note: text("note"),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("grades_unique_idx").on(
      t.studentId,
      t.subjectId,
      t.classId,
      t.academicYear,
      t.semester,
    ),
  ],
);

export const gradeAuditLogs = pgTable("grade_audit_logs", {
  id: id(),
  gradeId: uuid("grade_id")
    .notNull()
    .references(() => grades.id, { onDelete: "cascade" }),
  actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
  action: varchar("action", { length: 50 }).notNull(),
  before: jsonb("before").$type<Record<string, unknown>>(),
  after: jsonb("after").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const importJobs = pgTable("import_jobs", {
  id: id(),
  type: varchar("type", { length: 30 }).notNull(),
  filename: varchar("filename", { length: 255 }),
  status: varchar("status", { length: 30 }).default("pending").notNull(),
  totalRows: integer("total_rows").default(0).notNull(),
  successRows: integer("success_rows").default(0).notNull(),
  errorRows: integer("error_rows").default(0).notNull(),
  errors: jsonb("errors").$type<unknown[]>(),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const externalSyncLogs = pgTable("external_sync_logs", {
  id: id(),
  source: varchar("source", { length: 30 }).notNull(),
  status: varchar("status", { length: 30 }).notNull(),
  payloadSummary: jsonb("payload_summary").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const usersRelations = relations(users, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const rolesRelations = relations(roles, ({ many }) => ({
  userRoles: many(userRoles),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, { fields: [userRoles.userId], references: [users.id] }),
  role: one(roles, { fields: [userRoles.roleId], references: [roles.id] }),
}));

export type User = typeof users.$inferSelect;
export type Role = typeof roles.$inferSelect;
export type AcademicYear = typeof academicYears.$inferSelect;
export type Student = typeof students.$inferSelect;
export type Teacher = typeof teachers.$inferSelect;
export type Grade = typeof grades.$inferSelect;

export const teachingHours = pgTable("teaching_hours", {
  id: id(),
  label: varchar("label", { length: 50 }).notNull(), // e.g., "Jam ke-1"
  startTime: varchar("start_time", { length: 10 }).notNull(), // e.g., "07:00"
  endTime: varchar("end_time", { length: 10 }).notNull(), // e.g., "07:45"
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const teacherJournals = pgTable("teacher_journals", {
  id: id(),
  teacherUserId: uuid("teacher_user_id").references(() => users.id, { onDelete: "cascade" }).notNull(),
  date: varchar("date", { length: 10 }).notNull(), // YYYY-MM-DD
  classId: uuid("class_id").references(() => classes.id, { onDelete: "cascade" }),
  className: varchar("class_name", { length: 100 }), // cached label
  teachingHourId: uuid("teaching_hour_id").references(() => teachingHours.id, { onDelete: "set null" }),
  teachingHourLabel: varchar("teaching_hour_label", { length: 100 }), // cached e.g., "Jam ke-1 (07:00 - 07:45)"
  subjectId: uuid("subject_id").references(() => subjects.id, { onDelete: "cascade" }),
  subjectName: varchar("subject_name", { length: 150 }), // cached label
  groupId: uuid("group_id"),
  materi: text("materi").notNull(),
  presenceInfo: text("presence_info").notNull(),
  status: varchar("status", { length: 20 }).default("draft").notNull(), // draft | sent
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type TeachingHour = typeof teachingHours.$inferSelect;
export type TeacherJournal = typeof teacherJournals.$inferSelect;

export const apiKeys = pgTable("api_keys", {
  id: id(),
  namaAplikasi: varchar("nama_aplikasi", { length: 255 }).notNull(),
  domainPrefix: varchar("domain_prefix", { length: 255 }).default("*").notNull(),
  customPrefix: varchar("custom_prefix", { length: 50 }).default("data").notNull(),
  apiKey: varchar("api_key", { length: 255 }).notNull().unique(),
  isActive: boolean("is_active").default(true).notNull(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type ApiKey = typeof apiKeys.$inferSelect;

export const appVersions = pgTable("app_versions", {
  id: id(),
  version: varchar("version", { length: 50 }).notNull(),
  versionCode: integer("version_code").notNull(),
  dbVersion: varchar("db_version", { length: 50 }).notNull(),
  title: varchar("title", { length: 255 }).notNull(),
  changelog: jsonb("changelog").$type<string[]>().notNull(),
  forceUpdate: boolean("force_update").default(false).notNull(),
  installedAt: timestamp("installed_at", { withTimezone: true }).defaultNow().notNull(),
  installedBy: uuid("installed_by").references(() => users.id, { onDelete: "set null" }),
  ...timestamps,
});

export const systemSettings = pgTable("system_settings", {
  key: varchar("key", { length: 100 }).primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type AppVersion = typeof appVersions.$inferSelect;
export const assessmentComponents = pgTable("assessment_components", {
  id: id(),
  code: varchar("code", { length: 50 }).notNull().unique(), // e.g. "uh1", "t1", "sts", "uh2", "t2"
  name: varchar("name", { length: 150 }).notNull(), // e.g. "Ulangan Harian 1"
  type: varchar("type", { length: 20 }).default("UJIAN").notNull(), // UJIAN | TUGAS
  status: varchar("status", { length: 20 }).default("active").notNull(), // active | disabled | inactive
  sortOrder: integer("sort_order").default(0).notNull(),
  ...timestamps,
});

export type AssessmentComponent = typeof assessmentComponents.$inferSelect;




