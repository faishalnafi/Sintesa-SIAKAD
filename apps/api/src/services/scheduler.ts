import { db } from "../db/index.js";
import { aiScheduledJobs, teacherJournals } from "../db/schema/index.js";
import { eq, and, sql, lte, isNull, inArray, desc } from "drizzle-orm";
import { broadcastRealtimeEvent } from "./realtime.js";
import { env } from "../env.js";
import Redis from "ioredis";

export type SchedulerDriverType = "db" | "redis";

let activeDriver: SchedulerDriverType = "db";
let redisClient: Redis | null = null;
let pollerTimer: NodeJS.Timeout | null = null;
let purgeTimer: NodeJS.Timeout | null = null;
let isProcessing = false;

export function getSchedulerInfo() {
  return {
    driver: activeDriver,
    isRedis: activeDriver === "redis",
    configuredDriver: env.SCHEDULER_DRIVER,
    redisHost: env.REDIS_HOST,
    redisPort: env.REDIS_PORT,
  };
}

/**
 * Inisialisasi driver penjadwalan:
 * - Jika SCHEDULER_DRIVER = "redis" atau "auto", coba koneksi ke Redis.
 * - Jika Redis tidak aktif atau gagal, otomatis fallback ke DB in-process worker (PostgreSQL).
 */
export async function initScheduler(): Promise<void> {
  // Pastikan tabel ai_scheduled_jobs tersedia di PostgreSQL
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_scheduled_jobs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID REFERENCES users(id) ON DELETE CASCADE,
        action_type VARCHAR(50) NOT NULL,
        payload JSONB DEFAULT '{}'::jsonb NOT NULL,
        scheduled_at TIMESTAMP WITH TIME ZONE NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' NOT NULL,
        attempts INTEGER DEFAULT 0 NOT NULL,
        max_attempts INTEGER DEFAULT 3 NOT NULL,
        last_error TEXT,
        result JSONB,
        executed_at TIMESTAMP WITH TIME ZONE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
      );
      CREATE INDEX IF NOT EXISTS ai_scheduled_jobs_status_sched_idx ON ai_scheduled_jobs (status, scheduled_at, id);
    `);
  } catch (err: any) {
    console.warn("[Scheduler ensureTable Warning]:", err.message);
  }

  const driverSetting = env.SCHEDULER_DRIVER;

  if (driverSetting === "redis" || driverSetting === "auto") {
    try {
      const client = env.REDIS_URL
        ? new Redis(env.REDIS_URL, {
            lazyConnect: true,
            enableOfflineQueue: false,
            connectTimeout: 2000,
            retryStrategy: () => null,
          })
        : new Redis({
            host: env.REDIS_HOST,
            port: env.REDIS_PORT,
            password: env.REDIS_PASSWORD || undefined,
            lazyConnect: true,
            enableOfflineQueue: false,
            connectTimeout: 2000,
            retryStrategy: () => null,
          });

      await client.connect();
      redisClient = client;
      activeDriver = "redis";
      console.log(`[Scheduler] Terhubung ke Redis (${env.REDIS_HOST}:${env.REDIS_PORT}). Driver aktif: REDIS.`);

      client.on("error", (err) => {
        console.warn("[Scheduler Redis Warning]:", err.message);
      });
    } catch (err: any) {
      if (driverSetting === "redis") {
        console.warn(`[Scheduler] Konfigurasi meminta 'redis', namun koneksi gagal (${err.message}). Fallback ke In-Process DB Worker.`);
      } else {
        console.log(`[Scheduler] Redis offline/tidak terkonfigurasi. Menggunakan In-Process DB Worker bawaan (PostgreSQL ultra-ringan).`);
      }
      activeDriver = "db";
      redisClient = null;
    }
  } else {
    activeDriver = "db";
    console.log(`[Scheduler] Driver disetel ke 'db'. Menggunakan In-Process DB Worker bawaan (PostgreSQL).`);
  }
}

/**
 * Daftarkan pekerjaan baru ke jadwal antrean
 */
export async function scheduleJob(params: {
  userId?: string;
  actionType: string;
  payload: Record<string, unknown>;
  scheduledAt: Date;
}): Promise<{ success: boolean; job?: typeof aiScheduledJobs.$inferSelect; message: string; driver: string }> {
  try {
    const [job] = await db
      .insert(aiScheduledJobs)
      .values({
        userId: params.userId,
        actionType: params.actionType,
        payload: params.payload,
        scheduledAt: params.scheduledAt,
        status: "pending",
        attempts: 0,
        maxAttempts: 3,
      })
      .returning();

    // Jika Redis aktif, publikasikan sinyal jadwal baru
    if (activeDriver === "redis" && redisClient) {
      try {
        await redisClient.publish("simak:scheduler:new_job", JSON.stringify({ id: job.id, scheduledAt: job.scheduledAt }));
      } catch (pubErr: any) {
        console.warn("[Scheduler Redis Publish Warning]:", pubErr.message);
      }
    }

    return {
      success: true,
      job,
      driver: activeDriver === "redis" ? "Redis Queue" : "In-Process DB Worker",
      message: `Tugas berhasil dijadwalkan untuk dieksekusi pada ${params.scheduledAt.toLocaleString("id-ID")}`,
    };
  } catch (err: any) {
    console.error("[Scheduler scheduleJob Error]:", err);
    return {
      success: false,
      driver: activeDriver,
      message: err.message || "Gagal membuat jadwal tugas",
    };
  }
}

/**
 * Batalkan tugas yang masih berstatus pending
 */
export async function cancelJob(jobId: string, userId?: string): Promise<{ success: boolean; message: string }> {
  try {
    const conds = [eq(aiScheduledJobs.id, jobId), eq(aiScheduledJobs.status, "pending")];
    if (userId) {
      conds.push(eq(aiScheduledJobs.userId, userId));
    }

    const [updated] = await db
      .update(aiScheduledJobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(...conds))
      .returning();

    if (!updated) {
      return { success: false, message: "Tugas tidak ditemukan atau sudah tidak berstatus pending." };
    }

    return { success: true, message: "Jadwal tugas berhasil dibatalkan." };
  } catch (err: any) {
    return { success: false, message: err.message || "Gagal membatalkan tugas." };
  }
}

/**
 * Ambil daftar tugas terjadwal (pending)
 */
export async function getPendingJobs(userId?: string) {
  const conds = [eq(aiScheduledJobs.status, "pending")];
  if (userId) conds.push(eq(aiScheduledJobs.userId, userId));

  return db
    .select()
    .from(aiScheduledJobs)
    .where(and(...conds))
    .orderBy(aiScheduledJobs.scheduledAt);
}

/**
 * Eksekusi satu tugas spesifik saat waktunya tiba
 */
async function executeScheduledTask(job: typeof aiScheduledJobs.$inferSelect): Promise<{ success: boolean; message: string; data?: any }> {
  const payload = (job.payload || {}) as Record<string, any>;
  const userId = job.userId || payload.userId;

  if (job.actionType === "SEND_JOURNAL_DRAFT") {
    // 1. Parameter filter
    const targetDate = payload.date ? String(payload.date).trim() : null;
    const targetClass = payload.className ? String(payload.className).trim() : null;
    const targetSubject = payload.subjectName ? String(payload.subjectName).trim() : null;
    const targetIds = Array.isArray(payload.ids) && payload.ids.length > 0 ? (payload.ids as string[]) : null;

    const conditions = [
      eq(teacherJournals.status, "draft"),
      isNull(teacherJournals.deletedAt),
    ];

    if (userId) {
      conditions.push(eq(teacherJournals.teacherUserId, userId));
    }
    if (targetIds) {
      conditions.push(inArray(teacherJournals.id, targetIds));
    } else if (targetDate) {
      conditions.push(eq(teacherJournals.date, targetDate));
    }

    if (targetClass && !["semua", "all", "*"].includes(targetClass.toLowerCase())) {
      conditions.push(
        sql`LOWER(TRIM(REPLACE(REPLACE(${teacherJournals.className}, '-', ''), ' ', ''))) = LOWER(TRIM(REPLACE(REPLACE(${targetClass}, '-', ''), ' ', '')))`
      );
    }

    if (targetSubject && !["semua", "all", "*"].includes(targetSubject.toLowerCase())) {
      conditions.push(
        sql`LOWER(TRIM(${teacherJournals.subjectName})) LIKE LOWER(TRIM(${'%' + targetSubject + '%'}))`
      );
    }

    const drafts = await db.select().from(teacherJournals).where(and(...conditions));

    if (drafts.length === 0) {
      return {
        success: false,
        message: `Tidak ditemukan draft jurnal pada tanggal ${targetDate || "hari ini"} yang perlu dikirim (mungkin sudah dikirim sebelumnya).`,
      };
    }

    // Pastikan materi terisi
    const emptyMateri = drafts.find((d) => !d.materi || !d.materi.trim());
    if (emptyMateri) {
      return {
        success: false,
        message: `Materi pada jam ${emptyMateri.teachingHourLabel || ""} (${emptyMateri.className}) masih kosong. Harap lengkapi materi sebelum mengirim.`,
      };
    }

    const idsToSend = drafts.map((d) => d.id);
    const updated = await db
      .update(teacherJournals)
      .set({ status: "sent", updatedAt: new Date() })
      .where(inArray(teacherJournals.id, idsToSend))
      .returning();

    if (userId) {
      broadcastRealtimeEvent({ type: "journal_saved", actorId: userId });
    }

    return {
      success: true,
      message: `Berhasil mengirim ${updated.length} jurnal mengajar (status berubah dari Draft ke Sent) secara otomatis.`,
      data: { sentCount: updated.length, updatedIds: idsToSend },
    };
  }

  return {
    success: false,
    message: `Action type "${job.actionType}" tidak dikenali oleh sistem.`,
  };
}

/**
 * Loop pemroses antrean (Dipanggil berkala oleh In-Process Worker atau pemicu Redis)
 */
export async function processDueJobs(): Promise<number> {
  if (isProcessing) return 0;
  isProcessing = true;

  try {
    const now = new Date();

    // Cari maksimal 10 tugas yang sudah jatuh tempo
    const dueJobs = await db
      .select()
      .from(aiScheduledJobs)
      .where(and(eq(aiScheduledJobs.status, "pending"), lte(aiScheduledJobs.scheduledAt, now)))
      .orderBy(aiScheduledJobs.scheduledAt)
      .limit(10);

    if (dueJobs.length === 0) {
      return 0;
    }

    for (const job of dueJobs) {
      // Kunci tugas ke processing
      await db
        .update(aiScheduledJobs)
        .set({ status: "processing", updatedAt: new Date() })
        .where(eq(aiScheduledJobs.id, job.id));

      try {
        const result = await executeScheduledTask(job);

        if (result.success) {
          await db
            .update(aiScheduledJobs)
            .set({
              status: "completed",
              executedAt: new Date(),
              result: result as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            })
            .where(eq(aiScheduledJobs.id, job.id));

          console.log(`[Scheduler] Tugas ${job.id} (${job.actionType}) berhasil dieksekusi.`);
        } else {
          const nextAttempts = (job.attempts || 0) + 1;
          const isFailed = nextAttempts >= (job.maxAttempts || 3);

          await db
            .update(aiScheduledJobs)
            .set({
              attempts: nextAttempts,
              status: isFailed ? "failed" : "pending",
              lastError: result.message,
              result: result as unknown as Record<string, unknown>,
              updatedAt: new Date(),
            })
            .where(eq(aiScheduledJobs.id, job.id));

          console.warn(`[Scheduler] Tugas ${job.id} gagal: ${result.message} (attempt ${nextAttempts})`);
        }
      } catch (execErr: any) {
        const nextAttempts = (job.attempts || 0) + 1;
        const isFailed = nextAttempts >= (job.maxAttempts || 3);

        await db
          .update(aiScheduledJobs)
          .set({
            attempts: nextAttempts,
            status: isFailed ? "failed" : "pending",
            lastError: execErr.message || "Unknown error",
            updatedAt: new Date(),
          })
          .where(eq(aiScheduledJobs.id, job.id));

        console.error(`[Scheduler] Error eksekusi tugas ${job.id}:`, execErr);
      }
    }

    return dueJobs.length;
  } catch (err: any) {
    console.error("[Scheduler processDueJobs Error]:", err);
    return 0;
  } finally {
    isProcessing = false;
  }
}

/**
 * Pembersihan otomatis riwayat tugas lama (> 7 hari)
 */
async function purgeOldJobs(): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    await db
      .delete(aiScheduledJobs)
      .where(
        and(
          inArray(aiScheduledJobs.status, ["completed", "cancelled", "failed"]),
          lte(aiScheduledJobs.updatedAt, sevenDaysAgo)
        )
      );
  } catch (err: any) {
    console.warn("[Scheduler Purge Warning]:", err.message);
  }
}

/**
 * Jalankan background worker scheduler
 */
export async function startSchedulerWorker(): Promise<void> {
  await initScheduler();

  // Jalankan pemeriksaan segera pada saat startup
  processDueJobs().catch(() => {});

  // Polling per 15 detik (sangat ringan, < 1ms query, 0% CPU saat idle)
  const POLL_INTERVAL = 15_000;
  pollerTimer = setInterval(() => {
    processDueJobs().catch((err) => {
      console.warn("[Scheduler Interval Error]:", err.message);
    });
  }, POLL_INTERVAL);

  // Pembersihan harian (setiap 24 jam)
  const ONE_DAY = 24 * 60 * 60 * 1000;
  purgeTimer = setInterval(() => {
    purgeOldJobs().catch(() => {});
  }, ONE_DAY);

  console.log(`[Scheduler] Background worker aktif (Polling tiap 15 detik | Driver: ${activeDriver.toUpperCase()}).`);
}

/**
 * Hentikan background worker scheduler secara aman
 */
export async function stopSchedulerWorker(): Promise<void> {
  if (pollerTimer) {
    clearInterval(pollerTimer);
    pollerTimer = null;
  }
  if (purgeTimer) {
    clearInterval(purgeTimer);
    purgeTimer = null;
  }
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch {
      redisClient.disconnect();
    }
    redisClient = null;
  }
  console.log("[Scheduler] Background worker dihentikan.");
}
