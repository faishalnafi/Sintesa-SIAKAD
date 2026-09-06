/**
 * Kredensia / SSO Sekolah integration — aligned with api.md
 *
 * Login:  GET {SSO_BASE_URL}/otentikasi?client_id=&redirect_uri=
 * Callback: {redirect_uri}?token=JWT (HS256, TTL 5m)
 * Logout: GET {SSO_BASE_URL}/otentikasi/keluar?redirect_uri=
 * REST:   /api/v1/* with X-API-Key (see sso-api-client.ts)
 */
import { createHash, createHmac } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";
import { and, eq } from "drizzle-orm";
import { env, getSsoBaseUrl, getSsoClientId, getSsoJwtSecret, getSsoRedirectUri } from "../env.js";
import { db } from "../db/index.js";
import { roles, ssoTokenJti, userRoles, users, students, teachers } from "../db/schema/index.js";
import { newUuid } from "../utils/id.js";
import { getSsoRequestOrigin } from "./sso-api-client.js";

import { canRoleLogin, mapExternalRoles } from "../constants/roles.js";

/** Official JWT payload from IdP (api.md §6 Langkah 3) */
export type SsoJwtPayload = {
  user_id: string;
  nomor_induk?: string | null;
  nama: string;
  roles: string[];
  email?: string | null;
  avatarUrl?: string | null;
  exp?: number;
  /** Optional — not always present on IdP tokens */
  jti?: string;
};

export function mapKredensiaRoles(input: string[]): string[] {
  return mapExternalRoles(input).filter((code) => canRoleLogin(code));
}

export function isSsoConfigured(): boolean {
  return Boolean(env.SSO_CLIENT_ID && env.SSO_BASE_URL && env.SSO_REDIRECT_URI);
}

/**
 * Langkah 1 — Inisiasi redirect ke portal SSO.
 * Docs: GET /otentikasi?client_id={APP_UUID}&redirect_uri={CALLBACK_URL}
 */
export function buildSsoAuthorizeUrl(state?: string, dynamicOrigin?: string): string {
  if (!isSsoConfigured()) {
    throw new Error(
      "SSO belum lengkap di .env (SSO_BASE_URL, SSO_CLIENT_ID, SSO_REDIRECT_URI, SSO_JWT_SECRET/SSO_CLIENT_SECRET)",
    );
  }
  const origin = dynamicOrigin || getSsoRequestOrigin();
  const envUri = (process.env.SSO_REDIRECT_URI || env.SSO_REDIRECT_URI || "").trim();

  let redirectUri = `${origin}/auth/callback`;
  if (envUri) {
    if (origin.includes("localhost") || origin.includes("127.0.0.1")) {
      redirectUri = envUri;
    } else if (!envUri.includes("localhost") && !envUri.includes("127.0.0.1")) {
      redirectUri = envUri;
    }
  }

  const url = new URL(`${env.SSO_BASE_URL}/otentikasi`);
  url.searchParams.set("client_id", env.SSO_CLIENT_ID);
  url.searchParams.set("app_id", env.SSO_CLIENT_ID);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("redirect_url", redirectUri);
  url.searchParams.set("redirect", redirectUri);
  url.searchParams.set("callback", redirectUri);
  url.searchParams.set("callback_url", redirectUri);
  url.searchParams.set("return_url", redirectUri);
  url.searchParams.set("back_url", redirectUri);
  url.searchParams.set("next", redirectUri);
  url.searchParams.set("continue", redirectUri);
  url.searchParams.set("target", redirectUri);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}


/** SSO global logout — GET /otentikasi/keluar?redirect_uri= */
export function buildSsoLogoutUrl(redirectUri?: string): string {
  if (!env.SSO_BASE_URL) {
    throw new Error("SSO_BASE_URL kosong di .env");
  }
  const url = new URL(`${env.SSO_BASE_URL}/otentikasi/keluar`);
  url.searchParams.set(
    "redirect_uri",
    redirectUri || `${env.FRONTEND_URL}/login`,
  );
  return url.toString();
}

export function createOAuthState(): string {
  return newUuid();
}

export function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

/**
 * Kandidat secret verifikasi JWT (api.md §6):
 * 1. SSO_JWT_SECRET dari .env (seharusnya = JWT_SECRET di server IdP)
 * 2. SSO_CLIENT_SECRET (beberapa deploy pakai secret aplikasi)
 * 3. Fallback rahasia Kredensia SSO server
 */
function jwtSecretCandidates(): string[] {
  const list = [
    getSsoJwtSecret(),
    env.SSO_JWT_SECRET,
    env.SSO_CLIENT_SECRET,
    // documented & actual default IdP JWT secret from Kredensia .env
    "OxABotTAP36SONTQKfEVkczynnEtSigGHUrCLZRZ2CyIpAXDfIqYe69Z19B88UrT",
    "sso_secret_key_default_32_characters",
  ]
    .map((s) => (s || "").trim())
    .filter(Boolean);
  return [...new Set(list)];
}

function parseSsoPayload(payload: Record<string, unknown>): SsoJwtPayload {
  const userId = payload.user_id as string | undefined;
  const nama = payload.nama as string | undefined;
  if (!userId || !nama) {
    throw new Error("Payload JWT tidak lengkap (user_id / nama wajib)");
  }
  const rolesRaw = payload.roles;
  const roleList = Array.isArray(rolesRaw) ? (rolesRaw as string[]) : [];
  return {
    user_id: userId,
    nomor_induk: (payload.nomor_induk as string | undefined) ?? null,
    nama,
    roles: roleList,
    email: (payload.email as string | undefined) ?? null,
    avatarUrl: (payload.avatar_url as string | undefined) ?? (payload.avatar as string | undefined) ?? (payload.foto as string | undefined) ?? null,
    exp: typeof payload.exp === "number" ? payload.exp : undefined,
    jti: typeof payload.jti === "string" ? payload.jti : undefined,
  };
}

/**
 * Langkah 4 — Validasi JWT di backend (HS256).
 */
export async function verifySsoToken(token: string): Promise<SsoJwtPayload> {
  const secrets = jwtSecretCandidates();
  if (secrets.length === 0) {
    throw new Error("SSO_JWT_SECRET / SSO_CLIENT_SECRET kosong di .env");
  }

  let lastErr: unknown;
  let hasExpired = false;

  for (const secret of secrets) {
    try {
      const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), {
        algorithms: ["HS256"],
        clockTolerance: 120, // 2 minutes tolerance for server clock differences
      });
      return parseSsoPayload(payload as Record<string, unknown>);
    } catch (err) {
      if (err instanceof Error && (/expir/i.test(err.message) || (err as { code?: string }).code === "ERR_JWT_EXPIRED")) {
        hasExpired = true;
        break;
      }
      lastErr = err;
      // try next secret
    }
  }

  if (hasExpired) {
    throw new Error("Token SSO sudah kedaluwarsa (masa berlaku 5 menit). Silakan klik tombol 'Masuk dengan Kredensia SSO' kembali untuk login baru.");
  }

  throw new Error(
    "Tanda tangan JWT tidak valid. Isi SSO_JWT_SECRET di apps/api/.env dengan JWT_SECRET server Kredensia (bukan selalu client_secret aplikasi).",
  );
}

/**
 * Anti-replay: hash full token (IdP JWT often has no jti).
 * One-time use within TTL window.
 */
export async function consumeSsoToken(token: string, jti?: string): Promise<void> {
  const key = jti || createHash("sha256").update(token).digest("hex");
  try {
    const existing = await db
      .select()
      .from(ssoTokenJti)
      .where(eq(ssoTokenJti.jti, key))
      .limit(1);
    if (existing[0]) {
      throw new Error("Token SSO sudah digunakan (replay ditolak)");
    }
    await db.insert(ssoTokenJti).values({ jti: key });
  } catch (err) {
    if (err instanceof Error && err.message.includes("replay ditolak")) {
      throw err;
    }
    // Jika tabel sso_token_jti belum ada di DB postgresql produksi, abaikan error DB
    console.warn("ssoTokenJti table missing or DB query error during consumeSsoToken:", err);
  }
}

/** @deprecated use consumeSsoToken */
export async function consumeJti(jti: string | undefined): Promise<void> {
  if (!jti) return;
  await consumeSsoToken(jti, jti);
}

/**
 * Langkah 5 — JIT Provisioning
 * Cari by user_id (sso_id) ATAU nomor_induk (username).
 * Sync nama + roles; create if missing.
 */
export async function upsertUserFromSso(payload: SsoJwtPayload) {
  const roleCodes = mapKredensiaRoles(payload.roles);

  let user =
    (
      await db
        .select()
        .from(users)
        .where(eq(users.ssoId, payload.user_id))
        .limit(1)
    )[0] ?? null;

  if (!user && payload.nomor_induk) {
    user =
      (
        await db
          .select()
          .from(users)
          .where(eq(users.username, payload.nomor_induk))
          .limit(1)
      )[0] ?? null;
  }

  if (!user) {
    [user] = await db
      .insert(users)
      .values({
        ssoId: payload.user_id,
        name: payload.nama,
        username: payload.nomor_induk || null,
        email: payload.email || null,
        avatarUrl: payload.avatarUrl || null,
        isActive: true,
        lastLoginAt: new Date(),
      })
      .returning();
  } else {
    [user] = await db
      .update(users)
      .set({
        ssoId: payload.user_id,
        name: payload.nama,
        username: payload.nomor_induk || user.username,
        email: payload.email || user.email,
        avatarUrl: payload.avatarUrl || user.avatarUrl,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        isActive: true,
      })
      .where(eq(users.id, user.id))
      .returning();
  }

  // Sync roles from IdP: ensure all roles in payload exist in DB and are linked to user
  const activeRoleCodes = new Set(roleCodes);

  for (const code of roleCodes) {
    let [role] = await db.select().from(roles).where(eq(roles.code, code)).limit(1);
    if (!role) {
      [role] = await db
        .insert(roles)
        .values({
          code,
          name: code.charAt(0).toUpperCase() + code.slice(1),
          category: "member",
          canLogin: true,
          description: `Peran dinamis diimpor dari SSO Kredensia.`,
        })
        .returning();
    }

    const links = await db.select().from(userRoles).where(eq(userRoles.userId, user.id));
    if (!links.some((l) => l.roleId === role.id)) {
      await db.insert(userRoles).values({ userId: user.id, roleId: role.id });
    }
  }

  // Remove obsolete role links in user_roles that are no longer in the SSO payload
  const currentLinksWithRoles = await db
    .select({ id: userRoles.id, roleId: userRoles.roleId, code: roles.code })
    .from(userRoles)
    .innerJoin(roles, eq(userRoles.roleId, roles.id))
    .where(eq(userRoles.userId, user.id));

  for (const link of currentLinksWithRoles) {
    if (!activeRoleCodes.has(link.code)) {
      await db.delete(userRoles).where(eq(userRoles.id, link.id));
    }
  }


  // Sync email to teachers and students local tables on login
  if (roleCodes.includes("guru") || roleCodes.includes("tendik") || roleCodes.includes("walikelas")) {
    const [t] = await db.select().from(teachers).where(eq(teachers.userId, user.id)).limit(1);
    if (t) {
      await db
        .update(teachers)
        .set({
          emailPribadi: payload.email || t.emailPribadi,
          googleEmail: payload.email || t.googleEmail,
          updatedAt: new Date(),
        })
        .where(eq(teachers.id, t.id));
    }
  }
  if (roleCodes.includes("siswa") || roleCodes.includes("alumni")) {
    const [s] = await db.select().from(students).where(eq(students.userId, user.id)).limit(1);
    if (s) {
      await db
        .update(students)
        .set({
          emailPribadi: payload.email || s.emailPribadi,
          googleEmail: payload.email || s.googleEmail,
          updatedAt: new Date(),
        })
        .where(eq(students.id, s.id));
    }
  }

  return { user, roleCodes };
}

/** Dev helper — mint token matching IdP payload shape (HS256, 5m) */
export async function mintDevSsoToken(payload: SsoJwtPayload): Promise<string> {
  const secret = jwtSecretCandidates()[0];
  if (!secret) {
    throw new Error("SSO_JWT_SECRET / SSO_CLIENT_SECRET kosong di .env — tidak bisa mint dev token");
  }
  return new SignJWT({
    user_id: payload.user_id,
    nomor_induk: payload.nomor_induk ?? null,
    nama: payload.nama,
    roles: payload.roles,
    email: payload.email ?? null,
    avatar_url: payload.avatarUrl ?? null,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("5m")
    .sign(new TextEncoder().encode(secret));
}

/** Low-level HMAC verify helper (mirrors api.md PHP example) */
export function verifyJwtHmacManual(jwt: string, secret = getSsoJwtSecret()): Record<string, unknown> {
  const parts = jwt.split(".");
  if (parts.length !== 3) throw new Error("Format JWT tidak valid");
  const [headerB64, payloadB64, signatureB64] = parts;
  const expected = createHmac("sha256", secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest("base64url");
  if (signatureB64 !== expected) throw new Error("Tanda tangan tidak valid");
  const json = Buffer.from(payloadB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
    "utf8",
  );
  const payload = JSON.parse(json) as Record<string, unknown>;
  if (typeof payload.exp === "number" && Date.now() / 1000 >= payload.exp) {
    throw new Error("Token kedaluwarsa");
  }
  return payload;
}
