import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { env } from "../env.js";
import { verifySession, type SessionPayload } from "../services/session.js";
import { getUserWithRoles } from "../utils/user.js";

export type AuthVariables = {
  session: SessionPayload;
  user: NonNullable<Awaited<ReturnType<typeof getUserWithRoles>>>;
};

export const requireAuth = createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
  const token = getCookie(c, env.COOKIE_NAME) || c.req.query("token");
  if (!token) {
    return c.json({ success: false, message: "Unauthorized" }, 401);
  }

  const session = await verifySession(token);
  if (!session) {
    return c.json({ success: false, message: "Invalid or expired session" }, 401);
  }

  const user = await getUserWithRoles(session.sub);
  if (!user || !user.isActive) {
    return c.json({ success: false, message: "User inactive or not found" }, 401);
  }

  c.set("session", session);
  c.set("user", user);
  await next();
});
