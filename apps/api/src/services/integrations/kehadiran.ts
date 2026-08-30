/**
 * Adapter Kehadiran Siswa — coming soon.
 *
 * Domain: app Kehadiran (eksternal, terpisah dari GDS & Kredensia)
 * → SINTESA mirror rekap absensi: sakit, izin, alpa.
 *
 * Detail presensi harian tetap di app Kehadiran; SINTESA hanya agregat per siswa
 * untuk matrix walikelas & dashboard siswa.
 */
import { eq } from "drizzle-orm";
import { env } from "../../env.js";
import { db } from "../../db/index.js";
import { externalSyncLogs, students } from "../../db/schema/index.js";
import { isGdsConfigured } from "./gds.js";

export type KehadiranRekap = {
  nisn?: string;
  nis?: string;
  sakit: number;
  izin: number;
  alpa: number;
  catatan?: string;
  /** opsional semester/tahun ajar konteks */
  academic_year?: string;
  updated_at?: string;
};

export function isKehadiranConfigured(): boolean {
  return Boolean(env.KEHADIRAN_BASE_URL && env.KEHADIRAN_API_KEY);
}

export function kehadiranStatus() {
  return {
    code: "kehadiran" as const,
    name: "Kehadiran Siswa",
    status: isKehadiranConfigured() ? ("ready" as const) : ("coming_soon" as const),
    configured: isKehadiranConfigured(),
    baseUrl: env.KEHADIRAN_BASE_URL || null,
    owns: ["students.sakit", "students.izin", "students.alpa"],
    message: isKehadiranConfigured()
      ? "Env terisi — adapter siap dihubungkan ke API Kehadiran."
      : "Coming soon. Isi KEHADIRAN_BASE_URL + KEHADIRAN_API_KEY di .env saat app Kehadiran live.",
  };
}

/**
 * Pull rekap absensi (placeholder).
 * Kontrak target GET {KEHADIRAN_BASE_URL}/api/v1/rekap?tahun=
 */
export async function fetchKehadiranRekap(): Promise<KehadiranRekap[]> {
  if (!isKehadiranConfigured()) {
    throw new Error("Kehadiran belum dikonfigurasi / masih coming soon");
  }
  const cleanBase = env.KEHADIRAN_BASE_URL.replace(/\/$/, "").replace(/\/api(\/v1)?$/i, "");
  const url = `${cleanBase}/api/v1/rekap`;
  const apiKey = (env.KEHADIRAN_API_KEY || env.GDS_API_KEY || "sm_default_api_key_change_me").trim();

  // Bypass TLS SSL verification for local/self-signed certs
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "X-API-Key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
    });
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;

    if (!res.ok) {
      throw new Error(`Kehadiran API HTTP ${res.status} (${url})`);
    }
    const json = (await res.json()) as { data?: KehadiranRekap[] };
    return json.data ?? [];
  } catch (err) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    throw err;
  }
}

export async function applyKehadiranRekap(rows: KehadiranRekap[]) {
  let updated = 0;
  for (const row of rows) {
    const patch: Record<string, any> = {
      sakit: Math.max(0, Math.round(row.sakit || 0)),
      izin: Math.max(0, Math.round(row.izin || 0)),
      alpa: Math.max(0, Math.round(row.alpa || 0)),
      updatedAt: new Date(),
    };
    if (row.catatan !== undefined) {
      patch.catatanKehadiran = row.catatan || null;
    }
    
    if (row.nisn) {
      const r = await db
        .update(students)
        .set(patch)
        .where(eq(students.nisn, row.nisn))
        .returning({ id: students.id });
      if (r[0]) {
        updated += 1;
        continue;
      }
    }
    if (row.nis) {
      const r = await db
        .update(students)
        .set(patch)
        .where(eq(students.nis, row.nis))
        .returning({ id: students.id });
      if (r[0]) updated += 1;
    }
  }
  return { updated, total: rows.length };
}

export async function syncKehadiran() {
  if (!isKehadiranConfigured()) {
    const [log] = await db
      .insert(externalSyncLogs)
      .values({
        source: "kehadiran",
        status: "coming_soon",
        payloadSummary: {
          message: "Kehadiran Siswa integration coming soon — skip remote pull",
          at: new Date().toISOString(),
        },
      })
      .returning();
    return {
      ok: false,
      status: "coming_soon" as const,
      message:
        "Integrasi Kehadiran Siswa masih coming soon. App terpisah dari GDS & Kredensia; SINTESA hanya akan menyimpan rekap sakit/izin/alpa.",
      log,
    };
  }

  try {
    const rows = await fetchKehadiranRekap();
    const result = await applyKehadiranRekap(rows);
    const [log] = await db
      .insert(externalSyncLogs)
      .values({
        source: "kehadiran",
        status: "success",
        payloadSummary: { ...result, at: new Date().toISOString() },
      })
      .returning();
    return {
      ok: true,
      status: "success" as const,
      message: `Kehadiran sync: ${result.updated}/${result.total} siswa di-update`,
      log,
      result,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Kehadiran sync error";
    const [log] = await db
      .insert(externalSyncLogs)
      .values({
        source: "kehadiran",
        status: "error",
        payloadSummary: { message, at: new Date().toISOString() },
      })
      .returning();
    return { ok: false, status: "error" as const, message, log };
  }
}

export async function unlockStudentScoreInPasti(
  nisn: string,
  jenis: "kedisiplinan" | "presensi",
  keterangan = "Koreksi ulang oleh walikelas"
): Promise<boolean> {
  if (!isKehadiranConfigured() && !isGdsConfigured()) {
    return false;
  }
  const baseUrl = env.KEHADIRAN_BASE_URL || env.GDS_BASE_URL;
  if (!baseUrl) return false;
  
  const cleanBase = baseUrl.replace(/\/$/, "").replace(/\/api(\/v1)?$/i, "");
  const url = `${cleanBase}/api/v1/scores/unlock`;
  const apiKey = (env.KEHADIRAN_API_KEY || env.GDS_API_KEY || "sm_default_api_key_change_me").trim();

  // Bypass TLS SSL verification for local/self-signed certs
  const prevTls = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-API-Key": apiKey,
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        nisn,
        jenis,
        keterangan,
      }),
    });
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    const body = (await res.json().catch(() => ({}))) as any;
    return res.ok && body.success === true;
  } catch (err) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    console.error(`Gagal unlock score di PASTI (${jenis} untuk ${nisn}):`, err);
    return false;
  }
}

