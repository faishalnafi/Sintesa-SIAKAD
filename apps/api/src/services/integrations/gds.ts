/**
 * Adapter GDS (Poin Kedisiplinan) — coming soon.
 *
 * Domain: app GDS (eksternal) → SINTESA mirror agregat poin.
 * Tidak menyimpan detail pelanggaran di SINTESA (kecuali nanti dibutuhkan).
 * Match siswa: NIS / NISN / sso_member_id (dari Kredensia mirror).
 */
import { eq } from "drizzle-orm";
import { env } from "../../env.js";
import { db } from "../../db/index.js";
import { externalSyncLogs, students } from "../../db/schema/index.js";

export type GdsStudentPoint = {
  /** Prefer nisn atau nis */
  nisn?: string;
  nis?: string;
  poin: number;
  catatan?: string;
  updated_at?: string;
};

export function isGdsConfigured(): boolean {
  return Boolean(env.GDS_BASE_URL && env.GDS_API_KEY);
}

export function gdsStatus() {
  return {
    code: "gds" as const,
    name: "GDS — Poin Kedisiplinan",
    status: isGdsConfigured() ? ("ready" as const) : ("coming_soon" as const),
    configured: isGdsConfigured(),
    baseUrl: env.GDS_BASE_URL || null,
    owns: ["students.poin_gds"],
    message: isGdsConfigured()
      ? "Env terisi — adapter siap dihubungkan ke API GDS."
      : "Coming soon. Isi GDS_BASE_URL + GDS_API_KEY di .env saat app GDS live.",
  };
}

/**
 * Pull poin dari GDS API (placeholder).
 * Kontrak target GET {GDS_BASE_URL}/api/v1/points?page=
 */
export async function fetchGdsPoints(): Promise<GdsStudentPoint[]> {
  if (!isGdsConfigured()) {
    throw new Error("GDS belum dikonfigurasi / masih coming soon");
  }
  const cleanBase = env.GDS_BASE_URL.replace(/\/$/, "").replace(/\/api(\/v1)?$/i, "");
  const url = `${cleanBase}/api/v1/points`;
  const apiKey = (env.GDS_API_KEY || env.KEHADIRAN_API_KEY || "sm_default_api_key_change_me").trim();

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
      throw new Error(`GDS API HTTP ${res.status} (${url})`);
    }
    const json = (await res.json()) as { data?: GdsStudentPoint[] };
    return json.data ?? [];
  } catch (err) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = prevTls;
    throw err;
  }
}

export async function applyGdsPoints(points: GdsStudentPoint[]) {
  let updated = 0;
  for (const row of points) {
    const patch: Record<string, any> = {
      poinGds: Math.max(0, Math.round(row.poin)),
      updatedAt: new Date(),
    };
    if (row.catatan !== undefined) {
      patch.catatanGds = row.catatan || null;
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
  return { updated, total: points.length };
}

export async function syncGds() {
  if (!isGdsConfigured()) {
    const [log] = await db
      .insert(externalSyncLogs)
      .values({
        source: "gds",
        status: "coming_soon",
        payloadSummary: {
          message: "GDS integration coming soon — skip remote pull",
          at: new Date().toISOString(),
        },
      })
      .returning();
    return {
      ok: false,
      status: "coming_soon" as const,
      message:
        "Integrasi GDS masih coming soon. App terpisah; SINTESA hanya akan menyimpan poin_gds setelah API GDS live.",
      log,
    };
  }

  try {
    const points = await fetchGdsPoints();
    const result = await applyGdsPoints(points);
    const [log] = await db
      .insert(externalSyncLogs)
      .values({
        source: "gds",
        status: "success",
        payloadSummary: { ...result, at: new Date().toISOString() },
      })
      .returning();
    return {
      ok: true,
      status: "success" as const,
      message: `GDS sync: ${result.updated}/${result.total} siswa di-update`,
      log,
      result,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "GDS sync error";
    const [log] = await db
      .insert(externalSyncLogs)
      .values({
        source: "gds",
        status: "error",
        payloadSummary: { message, at: new Date().toISOString() },
      })
      .returning();
    return { ok: false, status: "error" as const, message, log };
  }
}
