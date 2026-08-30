import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();
import { z } from "zod";

/**
 * Semua nilai konfigurasi diambil dari process.env (.env).
 * Memiliki dynamic getters sehingga perubahan process.env saat runtime langsung aktif.
 */
const emptyToUndefined = (v: unknown) =>
  v === "" || v === undefined || v === null ? undefined : v;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().default(3001),

  DATABASE_URL: z.string().min(1, "DATABASE_URL wajib di .env"),
  JWT_SECRET: z.string().min(16, "JWT_SECRET wajib di .env (min 16 karakter)"),
  JWT_EXPIRES_IN: z.preprocess(emptyToUndefined, z.string().default("8h")),
  COOKIE_NAME: z.preprocess(emptyToUndefined, z.string().default("sintesa_session")),
  COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => v === "true"),
  COOKIE_SAMESITE: z.preprocess(
    emptyToUndefined,
    z.enum(["lax", "strict", "none"]).default("lax"),
  ),
  FRONTEND_URL: z.string().url("FRONTEND_URL wajib URL valid di .env"),
  CORS_ORIGINS: z.preprocess(
    emptyToUndefined,
    z.string().default("http://localhost:5173"),
  ),

  // --- Kredensia IdP (semua dari .env, tanpa default secret) ---
  SSO_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  SSO_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  SSO_APP_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  SSO_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  SSO_REDIRECT_URI: z.preprocess(emptyToUndefined, z.string().url().optional()),
  SSO_JWT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),
  SSO_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),
  SSO_API_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),

  // --- GDS (poin kedisiplinan) ---
  GDS_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  GDS_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

  // --- Kehadiran Siswa ---
  KEHADIRAN_BASE_URL: z.preprocess(emptyToUndefined, z.string().url().optional()),
  KEHADIRAN_API_KEY: z.preprocess(emptyToUndefined, z.string().optional()),

  // --- Google OAuth ---
  GOOGLE_CLIENT_ID: z.preprocess(emptyToUndefined, z.string().optional()),
  GOOGLE_CLIENT_SECRET: z.preprocess(emptyToUndefined, z.string().optional()),

  LOGIN_RATE_LIMIT_MAX: z.coerce.number().default(20),
  LOGIN_RATE_LIMIT_WINDOW_MS: z.coerce.number().default(600_000),
});

const parsed = envSchema.parse(process.env);

export function cleanUrlProtocol(urlStr: string): string {
  if (!urlStr) return "";
  let clean = urlStr.trim();
  while (/^(https?:\/\/){2,}/i.test(clean)) {
    clean = clean.replace(/^(https?:\/\/)+/i, (m) => {
      return m.toLowerCase().includes("https") ? "https://" : "http://";
    });
  }
  return clean.replace(/\/$/, "");
}

export function getSsoClientId(): string {
  return (process.env.SSO_CLIENT_ID || process.env.SSO_APP_ID || parsed.SSO_CLIENT_ID || "").trim();
}

export function getSsoJwtSecret(): string {
  return (process.env.SSO_JWT_SECRET || process.env.SSO_CLIENT_SECRET || parsed.SSO_JWT_SECRET || "").trim();
}

export function getSsoBaseUrl(): string {
  const raw = (process.env.SSO_BASE_URL || parsed.SSO_BASE_URL || "").trim();
  return cleanUrlProtocol(raw);
}

export function getSsoRedirectUri(): string {
  const uri = (process.env.SSO_REDIRECT_URI || parsed.SSO_REDIRECT_URI || "").trim();
  if (uri) return uri;
  const fe = (process.env.FRONTEND_URL || parsed.FRONTEND_URL || "http://localhost:5173").trim();
  return `${fe.replace(/\/$/, "")}/auth/callback`;
}

export function getSsoApiBaseUrl(): string {
  const raw = (process.env.SSO_API_BASE_URL || parsed.SSO_API_BASE_URL || "").trim();
  if (raw) return cleanUrlProtocol(raw);
  const base = getSsoBaseUrl();
  return base ? `${base}/api/v1` : "";
}

/** Static fallback getters / backward compatibility */
export const ssoClientId = getSsoClientId();
export const ssoJwtSecret = getSsoJwtSecret();
export const ssoBaseUrl = getSsoBaseUrl();
export const ssoRedirectUri = getSsoRedirectUri();
export const ssoApiBaseUrl = getSsoApiBaseUrl();

// --- Google OAuth ---
export function getGoogleClientId(): string {
  return (process.env.GOOGLE_CLIENT_ID || parsed.GOOGLE_CLIENT_ID || "").trim();
}

export function getGoogleClientSecret(): string {
  return (process.env.GOOGLE_CLIENT_SECRET || parsed.GOOGLE_CLIENT_SECRET || "").trim();
}

export function isGoogleConfigured(): boolean {
  return Boolean(getGoogleClientId() && getGoogleClientSecret());
}

export const env = {
  ...parsed,
  get SSO_BASE_URL() {
    return getSsoBaseUrl();
  },
  get SSO_CLIENT_ID() {
    return getSsoClientId();
  },
  get SSO_APP_ID() {
    return getSsoClientId();
  },
  get SSO_CLIENT_SECRET() {
    return (process.env.SSO_CLIENT_SECRET || parsed.SSO_CLIENT_SECRET || "").trim();
  },
  get SSO_REDIRECT_URI() {
    return getSsoRedirectUri();
  },
  get SSO_JWT_SECRET() {
    return getSsoJwtSecret();
  },
  get SSO_API_KEY() {
    return (process.env.SSO_API_KEY || parsed.SSO_API_KEY || "").trim();
  },
  get SSO_API_BASE_URL() {
    return getSsoApiBaseUrl();
  },
  get GDS_BASE_URL() {
    return (process.env.GDS_BASE_URL || parsed.GDS_BASE_URL || process.env.KEHADIRAN_BASE_URL || parsed.KEHADIRAN_BASE_URL || "").replace(/\/$/, "");
  },
  get GDS_API_KEY() {
    return (process.env.GDS_API_KEY || parsed.GDS_API_KEY || process.env.KEHADIRAN_API_KEY || parsed.KEHADIRAN_API_KEY || "").trim();
  },
  get KEHADIRAN_BASE_URL() {
    return (process.env.KEHADIRAN_BASE_URL || parsed.KEHADIRAN_BASE_URL || process.env.GDS_BASE_URL || parsed.GDS_BASE_URL || "").replace(/\/$/, "");
  },
  get KEHADIRAN_API_KEY() {
    return (process.env.KEHADIRAN_API_KEY || parsed.KEHADIRAN_API_KEY || process.env.GDS_API_KEY || parsed.GDS_API_KEY || "").trim();
  },
  get GOOGLE_CLIENT_ID() {
    return getGoogleClientId();
  },
  get GOOGLE_CLIENT_SECRET() {
    return getGoogleClientSecret();
  },
};

export type Env = typeof env;
