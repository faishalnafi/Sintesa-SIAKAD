import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { eq, or, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { authEvents, users } from "../../db/schema/index.js";
import { env } from "../../env.js";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { cookieOptions, signSession, verifySession } from "../../services/session.js";
import {
  buildSsoAuthorizeUrl,
  buildSsoLogoutUrl,
  consumeSsoToken,
  createOAuthState,
  hashState,
  isSsoConfigured,
  mintDevSsoToken,
  upsertUserFromSso,
  verifySsoToken,
} from "../../services/sso-kredensia.js";
import { newUuid } from "../../utils/id.js";
import { rateLimit } from "../../utils/rate-limit.js";
import { getUserWithRoles, publicUser } from "../../utils/user.js";
import { ssoClientId, ssoApiBaseUrl, getGoogleClientId, getGoogleClientSecret, isGoogleConfigured } from "../../env.js";

// ── Google OAuth constants ──────────────────────────────────────
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v3/userinfo";

const loginSchema = z.object({
  identifier: z.string().min(1),
  password: z.string().min(1),
});

export const authRoutes = new Hono<{ Variables: AuthVariables }>();

authRoutes.post("/login", async (c) => {
  const ip = c.req.header("x-forwarded-for") ?? "local";
  const rl = rateLimit(`login:${ip}`, env.LOGIN_RATE_LIMIT_MAX, env.LOGIN_RATE_LIMIT_WINDOW_MS);
  if (!rl.allowed) {
    return c.json({ success: false, message: "Terlalu banyak percobaan. Coba lagi nanti." }, 429);
  }

  const body = await c.req.json().catch(() => null);
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ success: false, message: "Input tidak valid" }, 400);
  }

  const { identifier, password } = parsed.data;
  const [user] = await db
    .select()
    .from(users)
    .where(
      or(
        eq(users.email, identifier),
        eq(users.username, identifier),
        sql`lower(${users.email}) = lower(${identifier})`,
      ),
    )
    .limit(1);

  const fail = async () => {
    await db.insert(authEvents).values({
      userId: user?.id,
      eventType: "login_failed",
      ip,
      userAgent: c.req.header("user-agent") ?? null,
      meta: { identifier },
    });
    return c.json({ success: false, message: "Email/username atau kata sandi salah" }, 401);
  };

  if (!user || !user.isActive) {
    return fail();
  }

  if (user.ssoId && (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash)))) {
    await db.insert(authEvents).values({
      userId: user.id,
      eventType: "login_failed_sso_hint",
      ip,
      userAgent: c.req.header("user-agent") ?? null,
      meta: { identifier },
    });
    return c.json(
      {
        success: false,
        message: "Akun Anda terdaftar di SSO Kredensia. Silakan klik tombol 'Masuk dengan Kredensia SSO' di atas untuk login.",
        isSsoUser: true,
      },
      401
    );
  }

  if (!user.passwordHash) {
    return fail();
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return fail();

  const profile = await getUserWithRoles(user.id);
  if (!profile) return fail();

  // ScholarGate: role "keluar" cannot login until restored to siswa
  if (profile.roles.includes("keluar") && profile.roles.every((r) => r === "keluar")) {
    await db.insert(authEvents).values({
      userId: user.id,
      eventType: "login_blocked_keluar",
      ip,
      userAgent: c.req.header("user-agent") ?? null,
    });
    return c.json(
      {
        success: false,
        message:
          "Akun berstatus keluar/mutasi. Hubungi admin untuk mengaktifkan kembali sebagai siswa.",
      },
      403,
    );
  }

  const token = await signSession({
    sub: user.id,
    email: user.email,
    name: user.name,
    roles: profile.roles,
  });

  setCookie(c, env.COOKIE_NAME, token, cookieOptions());

  await db
    .update(users)
    .set({ lastLoginAt: new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id));

  await db.insert(authEvents).values({
    userId: user.id,
    eventType: "login_success",
    ip,
    userAgent: c.req.header("user-agent") ?? null,
  });

  return c.json({ success: true, data: publicUser(profile) });
});

authRoutes.post("/logout", async (c) => {
  const token = getCookie(c, env.COOKIE_NAME);
  setCookie(c, env.COOKIE_NAME, "", {
    ...cookieOptions(),
    maxAge: 0,
  });
  deleteCookie(c, env.COOKIE_NAME, {
    path: "/",
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE as "lax" | "strict" | "none",
  });
  if (token) {
    await db.insert(authEvents).values({
      eventType: "logout",
      ip: c.req.header("x-forwarded-for") ?? "local",
      userAgent: c.req.header("user-agent") ?? null,
    });
  }
  return c.json({ success: true, message: "Logged out" });
});

authRoutes.get("/me", requireAuth, async (c) => {
  return c.json({ success: true, data: publicUser(c.get("user")) });
});

import {
  getSsoRequestOrigin,
  updateDetectedAppDomain,
} from "../../services/sso-api-client.js";

/**
 * Derive the public-facing origin of SINTESA from the incoming request.
 * Priority: X-Forwarded-Proto + Host (most reliable behind a reverse proxy)
 * → FRONTEND_URL from env (if non-localhost)
 * → module-level activeAppDomain fallback
 */
function getOriginFromRequest(c: any): string {
  const host = c.req.header("Host") || "";
  const forwarded = c.req.header("X-Forwarded-Proto") || "";

  // Update the module-level cache for other code paths
  updateDetectedAppDomain(c.req.header("Origin") || null);
  updateDetectedAppDomain(c.req.header("Referer") || null);

  if (host && !host.includes("localhost") && !host.includes("127.0.0.1")) {
    const proto = forwarded ||
      (c.req.header("X-Forwarded-Ssl") === "on" ? "https" : null) ||
      (host.includes("localhost") ? "http" : "https");
    const origin = `${proto}://${host}`;
    updateDetectedAppDomain(origin);
    return origin;
  }

  // Fallback: module-level cache or FRONTEND_URL
  return getSsoRequestOrigin();
}


/**
 * SSO Login — api.md §6 Langkah 1
 * Redirect browser ke IdP: /otentikasi?client_id=&redirect_uri=
 */
authRoutes.get("/sso/login", async (c) => {
  // Derive origin directly from this request — never relies on stale module state
  const currentOrigin = getOriginFromRequest(c);

  if (!isSsoConfigured()) {
    return c.redirect(`${currentOrigin}/login?sso=not_configured`);
  }

  // Optional CSRF state (extra safety; IdP may not echo it back)
  const state = createOAuthState();
  setCookie(c, "sintesa_sso_state", hashState(state), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  setCookie(c, "sintesa_sso_state_raw", state, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  try {
    return c.redirect(buildSsoAuthorizeUrl(state, currentOrigin));
  } catch {
    return c.redirect(`${currentOrigin}/login?sso=not_configured`);
  }
});


/**
 * SSO Callback — api.md §6 Langkah 3–5
 * IdP redirects: {SSO_REDIRECT_URI}?token=JWT
 * Validate HS256 → consume one-time → JIT provision → local session cookie
 */
authRoutes.get("/sso/callback", async (c) => {
  // This request comes from a browser redirect — Host header is always the real public domain
  const origin = getOriginFromRequest(c);
  const token = c.req.query("token");
  const state = c.req.query("state");
  const raw = getCookie(c, "sintesa_sso_state_raw");
  const hashed = getCookie(c, "sintesa_sso_state");

  deleteCookie(c, "sintesa_sso_state", { path: "/" });
  deleteCookie(c, "sintesa_sso_state_raw", { path: "/" });

  if (!token) {
    return c.redirect(`${origin}/login?error=missing_token`);
  }

  // Validate state only if both we issued one and IdP echoed it
  if (raw && hashed && state) {
    const ok = hashState(state) === hashed || hashState(raw) === hashed;
    if (!ok) {
      return c.redirect(`${origin}/login?error=invalid_state`);
    }
  }

  try {
    const payload = await verifySsoToken(token);
    await consumeSsoToken(token, payload.jti);

    // keluar-only roles cannot enter SINTESA
    const mappedPreview = payload.roles.map((r) => r.toLowerCase());
    if (mappedPreview.length === 1 && mappedPreview[0] === "keluar") {
      return c.redirect(`${origin}/login?error=no_role`);
    }

    const { user, roleCodes } = await upsertUserFromSso(payload);

    if (roleCodes.length === 0) {
      return c.redirect(`${origin}/login?error=no_role`);
    }

    const profile = await getUserWithRoles(user.id);
    if (!profile) {
      return c.redirect(`${origin}/login?error=user_missing`);
    }

    const sessionToken = await signSession({
      sub: user.id,
      email: user.email,
      name: user.name,
      roles: profile.roles,
    });

    const isHttps = origin.startsWith("https:");
    setCookie(c, env.COOKIE_NAME, sessionToken, {
      ...cookieOptions(),
      secure: isHttps || env.COOKIE_SECURE,
    });

    try {
      await db.insert(authEvents).values({
        userId: user.id,
        eventType: "sso_login_success",
        ip: c.req.header("x-forwarded-for") ?? "local",
        userAgent: c.req.header("user-agent") ?? null,
        meta: {
          sso_user_id: payload.user_id,
          nomor_induk: payload.nomor_induk,
          idp_roles: payload.roles,
          roles: roleCodes,
        },
      });
    } catch (e) {
      console.warn("authEvents sso_login_success log warning:", e);
    }

    return c.redirect(`${origin}/auth/callback`);
  } catch (err) {
    console.error("SSO callback error", err);
    const message = err instanceof Error ? err.message : "unknown";
    try {
      await db.insert(authEvents).values({
        eventType: "sso_login_failed",
        ip: c.req.header("x-forwarded-for") ?? "local",
        userAgent: c.req.header("user-agent") ?? null,
        meta: { message },
      });
    } catch (e) {
      console.warn("authEvents sso_login_failed log warning:", e);
    }
    const reason = encodeURIComponent(message.slice(0, 180));
    return c.redirect(`${origin}/login?error=sso_failed&reason=${reason}`);
  }
});

/**
 * SSO Logout — api.md §6 SSO Logout
 * 1) Clear local SINTESA session
 * 2) Redirect to IdP GET /otentikasi/keluar?redirect_uri=
 */
authRoutes.get("/sso/logout", async (c) => {
  setCookie(c, env.COOKIE_NAME, "", { ...cookieOptions(), maxAge: 0 });
  deleteCookie(c, env.COOKIE_NAME, {
    path: "/",
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE as "lax" | "strict" | "none",
  });

  await db.insert(authEvents).values({
    eventType: "sso_logout",
    ip: c.req.header("x-forwarded-for") ?? "local",
    userAgent: c.req.header("user-agent") ?? null,
  });

  const origin = getSsoRequestOrigin();
  const redirectAfter = c.req.query("redirect_uri") || `${origin}/login`;

  // Direct local logout — do NOT trigger SSO logout on Kredensia
  return c.redirect(redirectAfter);
});


// ── Google OAuth ────────────────────────────────────────────────

/**
 * Google Login — Langkah 1
 * Redirect browser ke Google OAuth consent screen.
 */
authRoutes.get("/google/login", async (c) => {
  const origin = getOriginFromRequest(c);

  // Proteksi BFCache: Jika pengguna sudah memiliki sesi login aktif di SIAKAD, langsung arahkan ke Dashboard
  const existingToken = getCookie(c, env.COOKIE_NAME);
  if (existingToken) {
    const validSession = await verifySession(existingToken);
    if (validSession) {
      return c.redirect(`${origin}/auth/callback`);
    }
  }

  if (!isGoogleConfigured()) {
    return c.redirect(`${origin}/login?sso=not_configured`);
  }

  const state = createOAuthState();
  setCookie(c, "sintesa_google_state", hashState(state), {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const isLocal = origin.includes("localhost") || origin.includes("127.0.0.1");
  const redirectUri = isLocal
    ? `${origin}/auth/google/callback`
    : "https://siakad.sman3mjk.sch.id/auth/google/callback";

  setCookie(c, "sintesa_google_redirect_uri", redirectUri, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
  });

  return c.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

/**
 * Google Callback — Langkah 2
 * Google meredirect browser ke sini dengan ?code=...
 * Exchange code → access_token → user info → upsert user → session cookie → /auth/callback
 */
authRoutes.get("/google/callback", async (c) => {
  const origin = getOriginFromRequest(c);
  const code = c.req.query("code");
  const state = c.req.query("state");
  const errorParam = c.req.query("error");
  const storedStateHash = getCookie(c, "sintesa_google_state");
  const storedRedirectUri = getCookie(c, "sintesa_google_redirect_uri");

  deleteCookie(c, "sintesa_google_state", { path: "/" });
  deleteCookie(c, "sintesa_google_redirect_uri", { path: "/" });

  if (errorParam) {
    return c.redirect(`${origin}/login?error=google_denied`);
  }

  if (!code) {
    return c.redirect(`${origin}/login?error=google_no_code`);
  }

  // Validate CSRF state jika tersedia
  if (state && storedStateHash && hashState(state) !== storedStateHash) {
    return c.redirect(`${origin}/login?error=invalid_state`);
  }

  try {
    const isLocalCb = origin.includes("localhost") || origin.includes("127.0.0.1");
    const primaryRedirectUri = storedRedirectUri || (isLocalCb
      ? `${origin}/auth/google/callback`
      : "https://siakad.sman3mjk.sch.id/auth/google/callback");

    const candidateUris = [
      primaryRedirectUri,
      `${origin}/auth/google/callback`,
      "http://localhost:3001/auth/google/callback",
      "http://localhost:3001/api/auth/google/callback",
      "http://localhost:5173/auth/google/callback",
      "https://siakad.sman3mjk.sch.id/auth/google/callback",
    ].filter(Boolean);
    const uniqueUris = [...new Set(candidateUris)];

    // ── Exchange authorization code for access token ──────────
    let tokenData: Record<string, string> | null = null;
    let lastExchangeError = "unknown";

    for (const testUri of uniqueUris) {
      const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: getGoogleClientId(),
          client_secret: getGoogleClientSecret(),
          redirect_uri: testUri,
          grant_type: "authorization_code",
        }).toString(),
      });

      const resJson = (await tokenRes.json().catch(() => ({}))) as Record<string, string>;
      if (tokenRes.ok && resJson.access_token) {
        tokenData = resJson;
        break;
      }
      lastExchangeError = resJson.error_description || resJson.error || "unknown";
    }

    if (!tokenData || !tokenData.access_token) {
      throw new Error(`Google token exchange failed: ${lastExchangeError}`);
    }

    // ── Fetch user profile from Google ────────────────────────
    const userInfoRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const googleUser = await userInfoRes.json() as {
      sub: string;
      email: string;
      email_verified: boolean;
      name: string;
      picture?: string;
    };

    if (!googleUser.email || !googleUser.email_verified) {
      return c.redirect(`${origin}/login?error=google_unverified`);
    }

    const googleSsoId = `google:${googleUser.sub}`;

    // ── Upsert user — cari via googleId dulu, lalu email ──────
    let [existingUser] = await db
      .select()
      .from(users)
      .where(or(eq(users.ssoId, googleSsoId), eq(users.email, googleUser.email)))
      .limit(1);

    if (!existingUser) {
      // User baru via Google — buat akun, tapi tanpa role (perlu admin assign)
      [existingUser] = await db
        .insert(users)
        .values({
          ssoId: googleSsoId,
          email: googleUser.email,
          name: googleUser.name,
          avatarUrl: googleUser.picture ?? null,
          isActive: true,
        })
        .returning();
    } else {
      // User sudah ada — update gambar profil & lastLoginAt (jangan overwrite ssoId Kredensia)
      await db
        .update(users)
        .set({
          avatarUrl: existingUser.avatarUrl || googleUser.picture || null,
          lastLoginAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(users.id, existingUser.id));
    }

    if (!existingUser.isActive) {
      return c.redirect(`${origin}/login?error=account_inactive`);
    }

    const profile = await getUserWithRoles(existingUser.id);
    if (!profile || profile.roles.length === 0) {
      // Akun ada tapi belum diberi peran oleh admin
      return c.redirect(`${origin}/login?error=no_role`);
    }
    if (profile.roles.every((r) => r === "keluar")) {
      return c.redirect(`${origin}/login?error=no_role`);
    }

    const sessionToken = await signSession({
      sub: existingUser.id,
      email: existingUser.email,
      name: existingUser.name,
      roles: profile.roles,
    });

    const isHttps = origin.startsWith("https:");
    setCookie(c, env.COOKIE_NAME, sessionToken, {
      ...cookieOptions(),
      secure: isHttps || env.COOKIE_SECURE,
    });

    await db.insert(authEvents).values({
      userId: existingUser.id,
      eventType: "google_login_success",
      ip: c.req.header("x-forwarded-for") ?? "local",
      userAgent: c.req.header("user-agent") ?? null,
      meta: { google_sub: googleUser.sub, email: googleUser.email },
    });

    return c.redirect(`${origin}/auth/callback`);
  } catch (err) {
    console.error("Google OAuth callback error", err);
    const message = err instanceof Error ? err.message : "unknown";
    await db.insert(authEvents).values({
      eventType: "google_login_failed",
      ip: c.req.header("x-forwarded-for") ?? "local",
      userAgent: c.req.header("user-agent") ?? null,
      meta: { message },
    });
    const reason = encodeURIComponent(message.slice(0, 180));
    return c.redirect(`${origin}/login?error=google_failed&reason=${reason}`);
  }
});


authRoutes.post("/sso/dev-simulate", async (c) => {
  if (env.NODE_ENV === "production") {
    return c.json({ success: false, message: "Not available" }, 404);
  }
  const body = z
    .object({
      user_id: z.string().uuid().optional(),
      nama: z.string().default("SSO Dev User"),
      nomor_induk: z.string().optional(),
      email: z.string().optional(),
      avatar_url: z.string().optional(),
      /** IdP nama_role values e.g. Siswa, Guru, Wali Kelas */
      roles: z.array(z.string()).default(["Guru"]),
    })
    .parse((await c.req.json().catch(() => ({}))) ?? {});

  const token = await mintDevSsoToken({
    user_id: body.user_id ?? newUuid(),
    nama: body.nama,
    nomor_induk: body.nomor_induk,
    roles: body.roles,
    email: body.email || null,
    avatarUrl: body.avatar_url || null,
  });

  return c.json({
    success: true,
    data: {
      callbackUrl: `${env.SSO_REDIRECT_URI || "http://localhost:3001/api/auth/sso/callback"}?token=${encodeURIComponent(token)}`,
      token,
      note: "Buka callbackUrl di browser untuk menyelesaikan login lokal",
    },
  });
});

authRoutes.get("/sso/status", (c) => {
  return c.json({
    success: true,
    data: {
      configured: isSsoConfigured(),
      clientIdSet: Boolean(ssoClientId),
      jwtSecretSet: Boolean(env.SSO_JWT_SECRET),
      apiKeySet: Boolean(env.SSO_API_KEY),
      baseUrl: env.SSO_BASE_URL || null,
      clientId: ssoClientId || null,
      redirectUri: env.SSO_REDIRECT_URI || null,
      apiBaseUrl: ssoApiBaseUrl || null,
      authorizePath: "/otentikasi",
      logoutPath: "/otentikasi/keluar",
      domainBoundary: "Kredensia=identitas · SINTESA=akademik (lihat docs/DOMAIN_BOUNDARY.md)",
      docs: "api.md §6 + apps/api/docs/KREDENSIA_SSO.md",
    },
  });
});
