/**
 * Kredensia REST client — api.md §1B, §2, §3, §10
 * Auth: X-API-Key or Authorization: Bearer {key}
 * Read-only GET on /api/v1/*
 */
import { env } from "../env.js";

export type SsoMember = {
  id: string;
  nama_lengkap: string;
  email: string | null;
  nik: string | null;
  nip_nis: string | null;
  jk: string | null;
  no_telp: string | null;
  tgl_lahir: string | null;
  is_active: boolean;
  claimed_at: string | null;
  created_at: string | null;
  updated_at: string | null;
  roles?: Array<{ id: string; nama_role: string }>;
  kelas_id?: string | null;
  kelas?: {
    id: string;
    nama_kelas: string;
    tingkat?: string | number;
    jurusan?: string;
  } | null;
};

export type SsoPeran = {
  id: string;
  nama_role: string;
  is_active: boolean;
  created_at: string | null;
  users_count?: number;
};

export type SsoStatistik = {
  total_pengguna: number;
  total_pengguna_aktif: number;
  total_pengguna_terklaim: number;
  total_peran: number;
};

type ApiEnvelope<T> = {
  success: boolean;
  data?: T;
  meta?: Record<string, unknown>;
  pesan?: string;
  message?: string;
};

function assertConfigured() {
  if (!env.SSO_API_KEY) {
    throw new Error("SSO_API_KEY belum dikonfigurasi (Kunci API dari Superadmin IdP)");
  }
}

let activeAppDomain = process.env.FRONTEND_URL || "http://localhost:5173";

export function updateDetectedAppDomain(originOrHost?: string | null) {
  if (!originOrHost) return;
  try {
    let domain = originOrHost.trim();
    if (!domain.startsWith("http://") && !domain.startsWith("https://")) {
      domain = domain.includes("localhost") || domain.includes("127.0.0.1") ? `http://${domain}` : `https://${domain}`;
    }
    const u = new URL(domain);

    // Filter out external SSO IdP domain (e.g. Kredensia) so redirect_uri always points to SINTESA
    const ssoBase = env.SSO_BASE_URL ? new URL(env.SSO_BASE_URL).hostname : "";
    if (ssoBase && u.hostname.toLowerCase() === ssoBase.toLowerCase()) {
      return;
    }

    // Filter out third-party OAuth/identity domains (Google, Apple, Microsoft, GitHub, etc.)
    const thirdPartyDomains = ["google.com", "accounts.google.com", "googleapis.com", "apple.com", "microsoft.com", "github.com", "live.com"];
    if (thirdPartyDomains.some(t => u.hostname.toLowerCase().endsWith(t))) {
      return;
    }

    if (u.hostname) {
      activeAppDomain = `${u.protocol}//${u.host}`;
    }
  } catch {}
}

export function getSsoRequestOrigin(): string {
  const fe = (process.env.FRONTEND_URL || env.FRONTEND_URL || "").trim();
  if (fe) {
    let domain = fe.replace(/\/$/, "");
    if (domain.includes("localhost") || domain.includes("127.0.0.1")) {
      if (activeAppDomain && !activeAppDomain.includes("localhost") && !activeAppDomain.includes("127.0.0.1")) {
        const thirdPartyDomains = ["google.com", "accounts.google.com", "googleapis.com", "apple.com", "microsoft.com", "github.com", "live.com"];
        const isThirdParty = thirdPartyDomains.some(t => activeAppDomain.toLowerCase().includes(t));
        if (!isThirdParty) {
          return activeAppDomain;
        }
      }
      return domain.replace(/^https:\/\//i, "http://");
    }
    return domain;
  }
  return activeAppDomain;
}

async function ssoGet<T>(
  path: string,
  params: Record<string, string | number | undefined> = {},
): Promise<{ data: T; meta?: Record<string, unknown> }> {
  assertConfigured();
  const base = env.SSO_API_BASE_URL.replace(/\/$/, "");
  const url = new URL(path.startsWith("http") ? path : `${base}${path.startsWith("/") ? "" : "/"}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }

  const origin = getSsoRequestOrigin();

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-Key": env.SSO_API_KEY,
      Authorization: `Bearer ${env.SSO_API_KEY}`,
      Origin: origin,
      Referer: `${origin}/`,
    },
  });

  const json = (await res.json().catch(() => ({}))) as ApiEnvelope<T>;
  if (!res.ok || json.success === false) {
    const msg = json.pesan || json.message || `SSO API error HTTP ${res.status}`;
    throw new Error(msg);
  }
  return { data: json.data as T, meta: json.meta };
}

/** GET /api/v1/test */
export async function ssoTestConnection() {
  return ssoGet<{ status: string; server_time: string }>("/test");
}

/** GET /api/v1/members */
export async function ssoListMembers(opts: {
  search?: string;
  email?: string;
  role?: string;
  page?: number;
  per_page?: number;
} = {}) {
  return ssoGet<SsoMember[]>("/members", {
    search: opts.search,
    email: opts.email,
    role: opts.role,
    page: opts.page ?? 1,
    per_page: Math.min(opts.per_page ?? 50, 100),
  });
}

/** GET /api/v1/members/{id} */
export async function ssoGetMember(id: string) {
  return ssoGet<SsoMember>(`/members/${id}`);
}

/** GET /api/v1/data/peran */
export async function ssoListPeran() {
  return ssoGet<SsoPeran[]>("/data/peran");
}

/** GET /api/v1/data/statistik */
export async function ssoStatistik() {
  return ssoGet<SsoStatistik>("/data/statistik");
}

/** Paginate all members for a role (or all) */
export async function ssoFetchAllMembers(role?: string): Promise<SsoMember[]> {
  const all: SsoMember[] = [];
  let page = 1;
  let lastPage = 1;
  do {
    const { data, meta } = await ssoListMembers({ role, page, per_page: 100 });
    all.push(...(data ?? []));
    lastPage = Number(meta?.last_page ?? 1);
    page += 1;
  } while (page <= lastPage);
  return all;
}

export type SsoKelas = {
  id: string;
  nama_kelas: string;
  tingkat?: string | number;
  jurusan?: string;
};

/** GET /api/v1/kelas */
export async function ssoListKelas() {
  return ssoGet<SsoKelas[]>("/kelas");
}

export type SsoKelasMember = {
  id: string;
  nama_lengkap: string;
  nip_nis: string | null;
  nis?: string | null;
  email?: string | null;
  jk?: string | null;
};

/** GET /api/v1/kelas/:id — returns { siswa: SsoKelasMember[] } */
export async function ssoGetKelasMembers(kelasId: string): Promise<SsoKelasMember[]> {
  const { data } = await ssoGet<{ siswa?: SsoKelasMember[] }>(`/kelas/${kelasId}`);
  return (data as any)?.siswa ?? [];
}
