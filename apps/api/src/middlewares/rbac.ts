import { createMiddleware } from "hono/factory";
import type { AuthVariables } from "./auth.js";

export function requireRoles(...allowed: string[]) {
  return createMiddleware<{ Variables: AuthVariables }>(async (c, next) => {
    const user = c.get("user");
    if (!user) {
      return c.json({ success: false, message: "Unauthorized" }, 401);
    }
    const ok = user.roles.some((r) => allowed.includes(r));
    if (!ok) {
      return c.json({ success: false, message: "Forbidden" }, 403);
    }
    await next();
  });
}
