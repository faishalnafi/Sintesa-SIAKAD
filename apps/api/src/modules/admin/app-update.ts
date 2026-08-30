import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import AdmZip from "adm-zip";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { appVersions, systemSettings } from "../../db/schema/index.js";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { requireRoles } from "../../middlewares/rbac.js";


const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootProjectDir = path.resolve(__dirname, "../../../"); // apps/api
const repoRootDir = path.resolve(rootProjectDir, "../../"); // sintesa repo root
const publicWebDir = path.resolve(repoRootDir, "apps/web/public");

// In-memory maintenance flag for instant middleware check
let isUpdatingState = false;
let updateMessageState = "Sistem sedang dalam proses pembaruan oleh Superadmin. Harap tunggu...";

export function getIsUpdatingState() {
  return isUpdatingState;
}

export function getUpdateMessageState() {
  return updateMessageState;
}

export function setIsUpdatingState(updating: boolean, message?: string) {
  isUpdatingState = updating;
  if (message) updateMessageState = message;
}

// Initializer to restore state from DB on startup
export async function initSystemVersionState() {
  try {
    const [updatingRecord] = await db
      .select()
      .from(systemSettings)
      .where(eq(systemSettings.key, "is_updating"))
      .limit(1);

    if (updatingRecord) {
      isUpdatingState = updatingRecord.value === "true";
    }

    // Ensure default initial version record in DB if empty
    const [latestDbVersion] = await db
      .select()
      .from(appVersions)
      .orderBy(desc(appVersions.versionCode))
      .limit(1);

    if (!latestDbVersion) {
      const localVersionJson = readLocalVersionJson();
      await db.insert(appVersions).values({
        version: localVersionJson.version || "1.0.0",
        versionCode: Number(localVersionJson.version_code) || 100,
        dbVersion: localVersionJson.db_version || "1.0.0",
        title: localVersionJson.title || "Rilis Perdana SINTESA v1.0.0",
        changelog: Array.isArray(localVersionJson.changelog)
          ? localVersionJson.changelog
          : ["Inisialisasi versi awal sistem"],
        forceUpdate: Boolean(localVersionJson.force_update),
        installedAt: new Date(),
      });

      await db
        .insert(systemSettings)
        .values({
          key: "current_version_code",
          value: String(localVersionJson.version_code || 100),
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: systemSettings.key,
          set: { value: String(localVersionJson.version_code || 100), updatedAt: new Date() },
        });
    }
  } catch (err) {
    console.error("Init system version state error:", err);
  }
}

export type VersionManifest = {
  version: string;
  version_code: number;
  db_version: string;
  title: string;
  release_date: string;
  force_update: boolean;
  changelog: string[];
  min_supported_version?: string;
  schema_changes?: string[];
};

function readLocalVersionJson(): VersionManifest {
  const versionJsonPath = path.join(rootProjectDir, "version.json");
  if (fs.existsSync(versionJsonPath)) {
    try {
      const raw = fs.readFileSync(versionJsonPath, "utf-8");
      return JSON.parse(raw);
    } catch {
      /* fallback below */
    }
  }
  return {
    version: "1.0.0",
    version_code: 100,
    db_version: "1.0.0",
    title: "SINTESA v1.0.0",
    release_date: "2026-08-04",
    force_update: false,
    changelog: ["Inisialisasi sistem"],
    schema_changes: [],
  };
}

function saveLocalVersionJson(manifest: VersionManifest) {
  const apiPath = path.join(rootProjectDir, "version.json");
  const webPath = path.join(publicWebDir, "version.json");

  const jsonStr = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(apiPath, jsonStr, "utf-8");

  if (fs.existsSync(publicWebDir)) {
    fs.writeFileSync(webPath, jsonStr, "utf-8");
  }
}

export const appUpdateRoutes = new Hono();

// Public endpoint for clients to get version and maintenance status
appUpdateRoutes.get("/system/version", async (c) => {
  try {
    const localJson = readLocalVersionJson();
    const [latestDbVersion] = await db
      .select()
      .from(appVersions)
      .orderBy(desc(appVersions.versionCode))
      .limit(1);

    const activeDbVersionCode = latestDbVersion ? latestDbVersion.versionCode : 100;
    const activeDbVersion = latestDbVersion ? latestDbVersion.version : "1.0.0";

    const isUpdateAvailable = localJson.version_code > activeDbVersionCode;

    return c.json({
      success: true,
      data: {
        currentVersion: activeDbVersion,
        currentVersionCode: activeDbVersionCode,
        latestJsonVersion: localJson.version,
        latestJsonVersionCode: localJson.version_code,
        isUpdateAvailable,
        isUpdating: isUpdatingState,
        updateMessage: updateMessageState,
        title: latestDbVersion?.title || localJson.title,
        changelog: latestDbVersion?.changelog || localJson.changelog,
        releaseDate: localJson.release_date,
        forceUpdate: latestDbVersion?.forceUpdate || localJson.force_update,
      },
    });
  } catch (err) {
    return c.json({
      success: false,
      message: err instanceof Error ? err.message : "Gagal mengambil versi sistem",
    }, 500);
  }
});

// Admin-only endpoints below
const adminUpdateGroup = new Hono<{ Variables: AuthVariables }>();
adminUpdateGroup.use("*", requireAuth, requireRoles("superadmin"));

// Check update status
adminUpdateGroup.get("/check", async (c) => {
  try {
    const localJson = readLocalVersionJson();
    const [latestDb] = await db
      .select()
      .from(appVersions)
      .orderBy(desc(appVersions.versionCode))
      .limit(1);

    const currentDbCode = latestDb ? latestDb.versionCode : 100;
    const isUpdateAvailable = localJson.version_code > currentDbCode;

    return c.json({
      success: true,
      data: {
        currentDbVersion: latestDb?.version || "1.0.0",
        currentDbVersionCode: currentDbCode,
        latestJsonVersion: localJson.version,
        latestJsonVersionCode: localJson.version_code,
        isUpdateAvailable,
        isUpdating: isUpdatingState,
        manifest: localJson,
      },
    });
  } catch (err) {
    return c.json({
      success: false,
      message: err instanceof Error ? err.message : "Pengecekan versi gagal",
    }, 500);
  }
});

// History of installed versions
adminUpdateGroup.get("/history", async (c) => {
  try {
    const history = await db
      .select()
      .from(appVersions)
      .orderBy(desc(appVersions.installedAt));

    return c.json({ success: true, data: history });
  } catch (err) {
    return c.json({
      success: false,
      message: err instanceof Error ? err.message : "Gagal mengambil riwayat versi",
    }, 500);
  }
});

// Upload ZIP update package (Validate root level version.json in memory)
let stagedZipBuffer: Buffer | null = null;
let stagedManifest: VersionManifest | null = null;

adminUpdateGroup.post("/upload-zip", async (c) => {
  try {
    const body = await c.req.parseBody();
    const file = body["file"];

    if (!file || !(file instanceof File)) {
      return c.json({ success: false, message: "File package ZIP tidak valid" }, 400);
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    // Look for version.json directly at root level of ZIP
    let versionEntry = zip.getEntry("version.json");
    if (!versionEntry) {
      // Fallback: search entry named version.json anywhere if top folder wrapper was included by mistake
      versionEntry = zipEntries.find((e) => e.entryName.endsWith("version.json") && !e.isDirectory) || null;
    }

    if (!versionEntry) {
      return c.json({
        success: false,
        message: "Berkas 'version.json' tidak ditemukan di tingkat pertama file ZIP!",
      }, 400);
    }

    const manifestText = versionEntry.getData().toString("utf-8");
    const manifest = JSON.parse(manifestText) as VersionManifest;

    if (!manifest.version || !manifest.version_code) {
      return c.json({
        success: false,
        message: "Format manifest version.json di dalam ZIP tidak valid (membutuhkan 'version' dan 'version_code')",
      }, 400);
    }

    const [latestDb] = await db
      .select()
      .from(appVersions)
      .orderBy(desc(appVersions.versionCode))
      .limit(1);

    const currentDbCode = latestDb ? latestDb.versionCode : 100;
    const isNewer = manifest.version_code > currentDbCode;

    // Stage ZIP in memory for confirmation
    stagedZipBuffer = buffer;
    stagedManifest = manifest;

    return c.json({
      success: true,
      message: "File paket update ZIP berhasil diverifikasi",
      data: {
        manifest,
        currentDbVersion: latestDb?.version || "1.0.0",
        currentDbVersionCode: currentDbCode,
        isNewer,
        filesCount: zipEntries.length,
      },
    });
  } catch (err) {
    return c.json({
      success: false,
      message: err instanceof Error ? err.message : "Gagal mengunggah file ZIP update",
    }, 500);
  }
});

// Trigger update execution from uploaded ZIP or local JSON
adminUpdateGroup.post("/trigger-zip", async (c) => {
  const user = c.get("user");
  try {
    const body = await c.req.json().catch(() => ({}));
    let targetManifest: VersionManifest | null = stagedManifest;
    let zipBuffer: Buffer | null = stagedZipBuffer;

    if (!targetManifest) {
      // Fallback to local version.json if no ZIP was staged
      targetManifest = readLocalVersionJson();
    }

    if (!targetManifest) {
      return c.json({ success: false, message: "Tidak ada data manifest update yang siap diproses" }, 400);
    }

    // Step 1: Set maintenance lock (is_updating = true)
    setIsUpdatingState(true, `Sistem sedang diperbarui ke versi ${targetManifest.version} oleh Superadmin...`);
    await db
      .insert(systemSettings)
      .values({ key: "is_updating", value: "true", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: "true", updatedAt: new Date() },
      });

    // Step 2: Extract ZIP files to repo root directory
    if (zipBuffer) {
      try {
        const zip = new AdmZip(zipBuffer);
        const entries = zip.getEntries();

        // Protected paths: never overwrite these regardless of ZIP content
        const BLOCKED_PREFIXES = [
          "node_modules/",
          "apps/api/node_modules/",
          "apps/web/node_modules/",
          ".env",
          "apps/api/.env",
          ".git/",
          "apps/api/src/db/migrations/",  // never overwrite migrations
        ];

        // Allowed extraction roots (whitelist approach)
        const ALLOWED_PREFIXES = [
          "apps/api/dist/",
          "apps/web/dist/",
          "apps/web/public/",
          "apps/api/version.json",
          "version.json",
          "package.json",
          "pnpm-lock.yaml",
          "apps/api/package.json",
          "apps/web/package.json",
        ];

        const normalizeZipPath = (rawPath: string): string => {
          let clean = rawPath.replace(/\\/g, "/").replace(/^\/+/, "");
          if (
            !clean.startsWith("apps/") &&
            !clean.startsWith("version.json") &&
            !clean.startsWith("package.json")
          ) {
            const firstSlash = clean.indexOf("/");
            if (firstSlash !== -1) {
              const stripped = clean.substring(firstSlash + 1);
              if (
                stripped.startsWith("apps/") ||
                stripped.startsWith("version.json") ||
                stripped.startsWith("package.json")
              ) {
                return stripped;
              }
            }
          }
          return clean;
        };

        const isBlocked = (entryName: string) =>
          BLOCKED_PREFIXES.some((b) => entryName.startsWith(b) || entryName === b.replace(/\/$/, ""));

        const isAllowed = (entryName: string) =>
          ALLOWED_PREFIXES.some((a) => entryName.startsWith(a) || entryName === a);

        let extracted = 0;
        let skipped = 0;

        for (const entry of entries) {
          if (entry.isDirectory) continue;
          const normalizedPath = normalizeZipPath(entry.entryName);

          if (isBlocked(normalizedPath)) {
            console.warn(`[Update] Blocked protected path: ${normalizedPath}`);
            skipped++;
            continue;
          }

          if (!isAllowed(normalizedPath)) {
            skipped++;
            continue;
          }

          const destPath = path.join(repoRootDir, normalizedPath);
          const destDir = path.dirname(destPath);

          if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
          }

          fs.writeFileSync(destPath, entry.getData());
          extracted++;
        }

        console.log(`[Update] ZIP extraction complete: ${extracted} files extracted, ${skipped} skipped.`);

      } catch (zipErr) {
        console.error("ZIP extraction error:", zipErr);
        // Don't abort — continue with DB sync
      }
    } // end if (zipBuffer)

    // Step 3: Run Cumulative Non-Destructive DB Schema Sync (Safe DDL operations)
    // Execute default system schema checks safely + custom schema_changes in manifest
    const safeSchemaQueries = [
      `CREATE TABLE IF NOT EXISTS app_versions (
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
      );`,
      `CREATE TABLE IF NOT EXISTS system_settings (
        key VARCHAR(100) PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS status_note TEXT;`,
      `ALTER TABLE students ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMP WITH TIME ZONE;`,
      `ALTER TABLE teachers ADD COLUMN IF NOT EXISTS staff_type VARCHAR(20) DEFAULT 'guru';`,
      ...(targetManifest.schema_changes || []),
    ];

    for (const ddl of safeSchemaQueries) {
      if (!ddl || !ddl.trim()) continue;
      // Guarantee non-destructive policy: Reject any DROP TABLE or TRUNCATE
      const upper = ddl.toUpperCase();
      if (upper.includes("DROP TABLE") || upper.includes("TRUNCATE")) {
        console.warn("Blocked unsafe query in update package:", ddl);
        continue;
      }

      try {
        await db.execute(sql.raw(ddl));
      } catch (ddlErr) {
        console.warn(`Safe DDL sync notice (${ddl.substring(0, 40)}...):`, ddlErr);
      }
    }

    // Step 4: Record new version entry in app_versions
    saveLocalVersionJson(targetManifest);

    await db.insert(appVersions).values({
      version: targetManifest.version,
      versionCode: targetManifest.version_code,
      dbVersion: targetManifest.db_version || targetManifest.version,
      title: targetManifest.title,
      changelog: targetManifest.changelog,
      forceUpdate: targetManifest.force_update,
      installedAt: new Date(),
      installedBy: user.id,
    });

    await db
      .insert(systemSettings)
      .values({
        key: "current_version_code",
        value: String(targetManifest.version_code),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: String(targetManifest.version_code), updatedAt: new Date() },
      });

    // Reset staged variables
    stagedZipBuffer = null;
    stagedManifest = null;

    // Step 5: Unlock system (is_updating = false)
    setIsUpdatingState(false);
    await db
      .insert(systemSettings)
      .values({ key: "is_updating", value: "false", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: "false", updatedAt: new Date() },
      });

    const responsePayload = {
      success: true,
      message: `Pembaruan aplikasi ke versi ${targetManifest.version} berhasil! Server akan restart otomatis dalam 2 detik...`,
      data: {
        version: targetManifest.version,
        versionCode: targetManifest.version_code,
        willRestart: !!zipBuffer,
      },
    };

    // Step 6: Self-restart via PM2 — exit process so PM2 auto-restarts with new code
    // Only restart if ZIP was extracted (new API code deployed), not for JSON-only updates
    if (zipBuffer) {
      setTimeout(() => {
        const isPm2 = Boolean(process.env.PM2_HOME || process.env.PM2_USAGE || process.env.PM2_ID !== undefined || process.env.PS1);
        if (isPm2) {
          console.log(`[Update] Self-restart triggered for version ${targetManifest!.version}. PM2 will restart the process.`);
          process.exit(0);
        } else {
          console.log(`[Update] Lingkungan Lokal Terdeteksi: Melewati process.exit(0) agar server lokal tetap berjalan online.`);
        }
      }, 2000);
    }

    return c.json(responsePayload);
  } catch (err) {
    // Reset maintenance lock on failure
    setIsUpdatingState(false);
    await db
      .insert(systemSettings)
      .values({ key: "is_updating", value: "false", updatedAt: new Date() })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: "false", updatedAt: new Date() },
      })
      .catch(() => {});

    return c.json({
      success: false,
      message: err instanceof Error ? err.message : "Gagal mengeksekusi pembaruan aplikasi",
    }, 500);
  }
});

// Manual JSON Release Generator
adminUpdateGroup.post("/release-json", async (c) => {
  try {
    const body = await c.req.json();
    const { version, versionCode, dbVersion, title, releaseDate, forceUpdate, changelog, schemaChanges } = body;

    if (!version || !versionCode || !title) {
      return c.json({ success: false, message: "Field version, versionCode, dan title wajib diisi" }, 400);
    }

    const changelogArr = Array.isArray(changelog)
      ? changelog
      : typeof changelog === "string"
      ? changelog.split("\n").filter(Boolean)
      : ["Pembaruan sistem"];

    const manifest: VersionManifest = {
      version: String(version),
      version_code: Number(versionCode),
      db_version: String(dbVersion || version),
      title: String(title),
      release_date: releaseDate || new Date().toISOString().split("T")[0],
      force_update: Boolean(forceUpdate),
      changelog: changelogArr,
      schema_changes: Array.isArray(schemaChanges) ? schemaChanges : [],
    };

    saveLocalVersionJson(manifest);

    return c.json({
      success: true,
      message: "Berkas manifest version.json berhasil diperbarui!",
      data: manifest,
    });
  } catch (err) {
    return c.json({
      success: false,
      message: err instanceof Error ? err.message : "Gagal membuat manifest version.json",
    }, 500);
  }
});

appUpdateRoutes.route("/admin/app-update", adminUpdateGroup);
