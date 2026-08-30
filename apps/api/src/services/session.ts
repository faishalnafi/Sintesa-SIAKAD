import { SignJWT, jwtVerify } from "jose";
import { env } from "../env.js";

export type SessionPayload = {
  sub: string;
  email: string | null;
  name: string;
  roles: string[];
};

const secret = () => new TextEncoder().encode(env.JWT_SECRET);

function parseExpiresIn(value: string): string {
  // jose expects numeric seconds or string like "8h"
  return value;
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    roles: payload.roles,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(parseExpiresIn(env.JWT_EXPIRES_IN))
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (!payload.sub) return null;
    return {
      sub: payload.sub,
      email: (payload.email as string | null) ?? null,
      name: (payload.name as string) ?? "",
      roles: (payload.roles as string[]) ?? [],
    };
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: env.COOKIE_SAMESITE as "lax" | "strict" | "none",
    path: "/",
    maxAge: 60 * 60 * 12,
  };
}
