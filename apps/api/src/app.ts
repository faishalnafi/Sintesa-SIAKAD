import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { serveStatic } from "@hono/node-server/serve-static";
import { eq, or, and, sql, desc, asc } from "drizzle-orm";
import { env } from "./env.js";
import { db } from "./db/index.js";
import { academicYears, classes, students, users, subjects, grades, assessmentComponents, apiKeys } from "./db/schema/index.js";
import { authRoutes } from "./modules/auth/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { teacherRoutes } from "./modules/teacher/routes.js";
import { homeroomRoutes } from "./modules/homeroom/routes.js";
import { studentRoutes } from "./modules/student/routes.js";
import {
  appUpdateRoutes,
  getIsUpdatingState,
  getUpdateMessageState,
  initSystemVersionState,
} from "./modules/admin/app-update.js";

// Ensure database tables exist automatically on startup
(async () => {
  try {
    await db.execute(sql`
      ALTER TABLE grades DROP COLUMN IF EXISTS average;

      CREATE TABLE IF NOT EXISTS teacher_subjects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS teacher_subjects_unique_idx ON teacher_subjects (user_id, subject_id);

      CREATE TABLE IF NOT EXISTS homeroom_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS homeroom_assignments_unique_idx ON homeroom_assignments (user_id, class_id);

      CREATE TABLE IF NOT EXISTS api_keys (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        nama_aplikasi VARCHAR(255) NOT NULL,
        domain_prefix VARCHAR(255) DEFAULT '*' NOT NULL,
        custom_prefix VARCHAR(50) DEFAULT 'data' NOT NULL,
        api_key VARCHAR(255) NOT NULL UNIQUE,
        is_active BOOLEAN DEFAULT TRUE NOT NULL,
        last_used_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_versions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        version VARCHAR(50) NOT NULL,
        version_code INTEGER NOT NULL,
        db_version VARCHAR(50) NOT NULL,
        title VARCHAR(255) NOT NULL,
        changelog JSONB NOT NULL,
        force_update BOOLEAN DEFAULT FALSE NOT NULL,
        installed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        installed_by UUID REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS sso_token_jti (
        jti TEXT PRIMARY KEY,
        used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS auth_events (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE SET NULL,
        event_type VARCHAR(50) NOT NULL,
        ip VARCHAR(64),
        user_agent TEXT,
        meta JSONB,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      CREATE TABLE IF NOT EXISTS assessment_components (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        code VARCHAR(50) NOT NULL UNIQUE,
        name VARCHAR(150) NOT NULL,
        type VARCHAR(20) DEFAULT 'UJIAN' NOT NULL,
        status VARCHAR(20) DEFAULT 'active' NOT NULL,
        sort_order INTEGER DEFAULT 0 NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );

      INSERT INTO assessment_components (code, name, type, status, sort_order) VALUES
        ('uh1', 'UH1', 'UJIAN', 'active', 1),
        ('t1', 'T1', 'TUGAS', 'active', 2),
        ('sts', 'STS', 'UJIAN', 'active', 3),
        ('uh2', 'UH2', 'UJIAN', 'disabled', 4),
        ('t2', 'T2', 'TUGAS', 'disabled', 5)
      ON CONFLICT (code) DO NOTHING;
    `);

    await initSystemVersionState();
  } catch (e) {
    console.error("Auto-create tables error:", e);
  }
})();

export const app = new Hono();

const origins = env.CORS_ORIGINS.split(",").map((s) => s.trim());

app.use("*", logger());
app.use(
  "*",
  cors({
    origin: (origin) => {
      if (!origin) return origins[0];
      return origins.includes(origin) ? origin : origins[0];
    },
    credentials: true,
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  }),
);

// Maintenance middleware: Intercept requests during active update
app.use("/api/*", async (c, next) => {
  const reqPath = c.req.path;
  if (
    reqPath === "/api/system/version" ||
    reqPath.startsWith("/api/admin/app-update") ||
    reqPath === "/api/auth/me"
  ) {
    await next();
    return;
  }

  if (getIsUpdatingState()) {
    if (["POST", "PUT", "PATCH", "DELETE"].includes(c.req.method)) {
      return c.json(
        {
          success: false,
          isUpdating: true,
          message: getUpdateMessageState(),
        },
        503,
      );
    }
  }
  await next();
});


import { updateDetectedAppDomain } from "./services/sso-api-client.js";

app.use("*", async (c, next) => {
  const referer = c.req.header("Referer");
  const origin = c.req.header("Origin");
  const host = c.req.header("Host");
  const proto = c.req.header("X-Forwarded-Proto") || (host?.includes("localhost") || host?.includes("127.0.0.1") ? "http" : "https");

  if (referer) updateDetectedAppDomain(referer);
  if (origin) updateDetectedAppDomain(origin);
  if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
    updateDetectedAppDomain(`${proto}://${host}`);
  }

  c.header("X-Content-Type-Options", "nosniff");
  c.header("X-Frame-Options", "DENY");
  c.header("Referrer-Policy", "strict-origin-when-cross-origin");
  await next();
});

app.get("/health", (c) => c.json({ ok: true, service: "sintesa-api" }));
async function validateApiKeyMiddleware(c: any, next: any) {
  const authorization = c.req.header("Authorization") || "";
  let keyString = c.req.header("X-API-Key") || "";
  
  if (!keyString && authorization.startsWith("Bearer ")) {
    keyString = authorization.substring(7);
  }
  
  if (!keyString) {
    return c.json({ success: false, message: "Kunci API diperlukan" }, 401);
  }
  
  // Lookup key in Postgres database
  const [keyRecord] = await db
    .select()
    .from(apiKeys)
    .where(and(eq(apiKeys.apiKey, keyString), eq(apiKeys.isActive, true)))
    .limit(1);
    
  // Support fallback keys (e.g. env config)
  const fallbackKeys = [
    env.GDS_API_KEY,
    env.KEHADIRAN_API_KEY,
  ].filter(Boolean);
  
  if (!keyRecord && !fallbackKeys.includes(keyString)) {
    return c.json({ success: false, message: "Kunci API tidak valid atau dinonaktifkan" }, 403);
  }
  
  if (keyRecord) {
    // Validate domain_prefix if not "*"
    const allowedPrefix = keyRecord.domainPrefix || "*";
    if (allowedPrefix !== "*") {
      let clientHost = "";
      const referer = c.req.header("Referer") || "";
      const origin = c.req.header("Origin") || "";
      
      if (referer) {
        try { clientHost = new URL(referer).hostname; } catch {}
      }
      if (!clientHost && origin) {
        try { clientHost = new URL(origin).hostname; } catch {}
      }
      if (!clientHost) {
        clientHost = c.req.header("Host") || "localhost";
        clientHost = clientHost.split(":")[0];
      }
      
      // Match domain prefix
      let matched = false;
      if (allowedPrefix.includes("*")) {
        const pattern = new RegExp("^" + allowedPrefix.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$", "i");
        matched = pattern.test(clientHost);
      } else {
        matched = clientHost.toLowerCase() === allowedPrefix.toLowerCase() || 
                  clientHost.toLowerCase().endsWith("." + allowedPrefix.toLowerCase());
      }
      
      if (!matched) {
        return c.json({ 
          success: false, 
          message: `Kunci API tidak diizinkan untuk domain asal Anda (${clientHost})` 
        }, 403);
      }
    }
    
    // Update lastUsedAt
    db.update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiKeys.id, keyRecord.id))
      .execute()
      .catch(() => {});
  }
  
  await next();
}

app.use("/api/v1/*", validateApiKeyMiddleware);

// Integration endpoint for external consumer apps (siswa-manage, GDS, Kehadiran)
app.get("/api/v1/students", async (c) => {
  const rows = await db
    .select({
      id: students.id,
      nisn: students.nisn,
      name: students.name,
      kelasLabel: students.kelasLabel,
      academicYear: academicYears.name,
    })
    .from(students)
    .leftJoin(classes, eq(students.classId, classes.id))
    .leftJoin(academicYears, eq(students.academicYearId, academicYears.id))
    .where(eq(students.memberStatus, "siswa"));
  return c.json({ success: true, data: rows });
});

// Webhook Push API: Menerima PUSH Poin GDS dari Aplikasi Pihak Ketiga
app.post("/api/v1/webhooks/gds", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const points = (body.points || body.data || []) as Array<{ nisn: string; poin: number; catatan?: string }>;
    if (!Array.isArray(points) || points.length === 0) {
      return c.json({ success: false, message: "Payload 'points' array wajib diisi" }, 400);
    }
    let updated = 0;
    for (const p of points) {
      if (!p.nisn) continue;

      const setData: Record<string, unknown> = {
        poinGds: Number(p.poin) || 0,
        updatedAt: new Date(),
      };
      // Simpan catatan jika dikirim (null = hapus, undefined = biarkan)
      if (p.catatan !== undefined) setData.catatanGds = p.catatan || null;

      const [res] = await db
        .update(students)
        .set(setData)
        .where(eq(students.nisn, p.nisn))
        .returning({ id: students.id });
      if (res) updated++;
    }
    return c.json({ success: true, message: `Berhasil memperbarui ${updated} poin GDS siswa.`, updated });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Webhook error" }, 500);
  }
});

// Webhook Push API: Menerima PUSH Absensi BK/Kehadiran dari Aplikasi Pihak Ketiga
app.post("/api/v1/webhooks/kehadiran", async (c) => {
  try {
    const body = await c.req.json().catch(() => ({}));
    const rekap = (body.rekap || body.data || []) as Array<{ nisn: string; sakit?: number; izin?: number; alpa?: number; catatan?: string }>;
    if (!Array.isArray(rekap) || rekap.length === 0) {
      return c.json({ success: false, message: "Payload 'rekap' array wajib diisi" }, 400);
    }
    let updated = 0;
    for (const r of rekap) {
      if (!r.nisn) continue;

      const setData: Record<string, unknown> = {
        sakit: Number(r.sakit) || 0,
        izin: Number(r.izin) || 0,
        alpa: Number(r.alpa) || 0,
        updatedAt: new Date(),
      };
      // Simpan catatan jika dikirim (null = hapus, undefined = biarkan)
      if (r.catatan !== undefined) setData.catatanKehadiran = r.catatan || null;

      const [res] = await db
        .update(students)
        .set(setData)
        .where(eq(students.nisn, r.nisn))
        .returning({ id: students.id });
      if (res) updated++;
    }
    return c.json({ success: true, message: `Berhasil memperbarui ${updated} rekap absensi siswa.`, updated });
  } catch (e) {
    return c.json({ success: false, message: e instanceof Error ? e.message : "Webhook error" }, 500);
  }
});



app.get("/api/public/profile/:uuid", async (c) => {
  const uuid = c.req.param("uuid");
  const academicYearParam = c.req.query("academicYear");

  // 1. Ambil data siswa + user
  const [studentData] = await db
    .select({
      id: students.id,
      name: students.name,
      nisn: students.nisn,
      kelasLabel: students.kelasLabel,
      poinGds: students.poinGds,
      sakit: students.sakit,
      izin: students.izin,
      alpa: students.alpa,
      username: users.username,
      avatarUrl: users.avatarUrl,
      alamat: students.alamat,
      emailPribadi: students.emailPribadi,
      noTelepon: students.noTelepon,
      classId: students.classId,
      gradeLevel: classes.gradeLevel,
      className: classes.name,
      jurusan: classes.jurusan,
    })
    .from(students)
    .leftJoin(users, eq(students.userId, users.id))
    .leftJoin(classes, eq(students.classId, classes.id))
    .where(
      or(
        eq(students.id, uuid),
        eq(students.userId, uuid),
        eq(students.ssoMemberId, uuid),
        eq(users.ssoId, uuid)
      )
    )
    .limit(1);

  if (!studentData) {
    return c.json({ success: false, message: "Profil tidak ditemukan" }, 404);
  }

  // 2. Ambil tahun pelajaran yang tersedia
  const availableYears = await db
    .select({
      id: academicYears.id,
      name: academicYears.name,
      isActive: academicYears.isActive,
    })
    .from(academicYears)
    .orderBy(desc(academicYears.name));

  const activeYear = availableYears.find((y) => y.isActive)?.name || "2025/2026";
  const selectedYear = academicYearParam || activeYear;

  // 3. Ambil data nilai raport pada tahun pelajaran terpilih
  const gradesRows = await db
    .select({
      id: grades.id,
      subjectId: grades.subjectId,
      subjectName: subjects.name,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
      status: grades.status,
    })
    .from(grades)
    .innerJoin(subjects, eq(grades.subjectId, subjects.id))
    .where(
      and(
        eq(grades.studentId, studentData.id),
        eq(grades.academicYear, selectedYear),
        eq(grades.status, "approved"),
      )
    );

  // Ambil komponen penilaian
  const compList = await db
    .select()
    .from(assessmentComponents)
    .orderBy(asc(assessmentComponents.sortOrder), asc(assessmentComponents.createdAt));

  return c.json({
    success: true,
    data: {
      student: {
        ...studentData,
        email: studentData.emailPribadi || null,
        socialLinks: {
          github: studentData.username || "github_user",
          gitlab: studentData.username || "gitlab_user",
          linkedin: studentData.username || "linkedin_user",
          x: `@${studentData.username || "x_user"}`
        },
        location: studentData.alamat || "Kota Mojokerto, Jawa Timur, Indonesia",
        nickname: studentData.username || "Pelajar di Google Developer",
        jenjang: studentData.gradeLevel ? `Kelas ${studentData.gradeLevel}` : "Kelas X",
        rombel: studentData.className || studentData.kelasLabel || "X-1",
      },
      grades: gradesRows,
      assessmentComponents: compList,
      availableYears: availableYears.map((y) => y.name),
      selectedYear,
    }
  });
});

import { realtimeRoutes } from "./modules/realtime/routes.js";

app.route("/api/auth", authRoutes);
app.route("/api/admin", adminRoutes);
app.route("/api/teacher", teacherRoutes);
app.route("/api/homeroom", homeroomRoutes);
app.route("/api/student", studentRoutes);
app.route("/api/realtime", realtimeRoutes);
app.route("/api", appUpdateRoutes);


// Intercept Google OAuth login without /api
app.get("/auth/google/login", (c) => {
  const urlString = c.req.url || "";
  const query = urlString.includes("?") ? urlString.slice(urlString.indexOf("?")) : "";
  return c.redirect(`/api/auth/google/login${query}`);
});

// Intercept SSO login without /api
app.get("/auth/sso/login", (c) => {
  const urlString = c.req.url || "";
  const query = urlString.includes("?") ? urlString.slice(urlString.indexOf("?")) : "";
  return c.redirect(`/api/auth/sso/login${query}`);
});

// Intercept Google OAuth callback when registered as /auth/google/callback in Google Console
app.get("/auth/google/callback", (c) => {
  const urlString = c.req.url || "";
  const query = urlString.includes("?") ? urlString.slice(urlString.indexOf("?")) : "";
  return c.redirect(`/api/auth/google/callback${query}`);
});

// Intercept SSO callback when accessed as /auth/callback?token=...
app.get("/auth/callback", async (c, next) => {
  const token = c.req.query("token");
  if (token) {
    const urlString = c.req.url || "";
    const query = urlString.includes("?") ? urlString.slice(urlString.indexOf("?")) : "";
    return c.redirect(`/api/auth/sso/callback${query}`);
  }
  await next();
});

// Static file serving for React Frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const webDistPath = path.resolve(__dirname, "../../web/dist");

if (fs.existsSync(webDistPath)) {
  // Prevent browser caching of index.html & HTML pages so updates are detected immediately
  app.use("*", async (c, next) => {
    const p = c.req.path;
    if (p === "/" || p === "/index.html" || !p.includes(".")) {
      c.header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
      c.header("Pragma", "no-cache");
      c.header("Expires", "0");
    }
    await next();
  });

  app.use(
    "/*",
    serveStatic({
      root: path.relative(process.cwd(), webDistPath),
    })
  );

  app.get("*", (c) => {
    if (c.req.path.startsWith("/api")) {
      return c.notFound();
    }
    try {
      const html = fs.readFileSync(path.join(webDistPath, "index.html"), "utf-8");
      c.header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0");
      c.header("Pragma", "no-cache");
      c.header("Expires", "0");
      return c.html(html);
    } catch {
      return c.notFound();
    }
  });
}

app.notFound((c) => c.json({ success: false, message: "Not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  if (err.name === "ZodError") {
    return c.json({ success: false, message: "Validation error", errors: err }, 400);
  }
  return c.json(
    {
      success: false,
      message: env.NODE_ENV === "production" ? "Internal server error" : err.message,
    },
    500,
  );
});
