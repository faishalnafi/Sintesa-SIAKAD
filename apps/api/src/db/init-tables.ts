import { db } from "./index.js";
import { sql } from "drizzle-orm";

/**
 * Ensures required authentication & system tables exist in PostgreSQL database on startup.
 * Prevents missing table errors (e.g. sso_token_jti, auth_events) on production servers.
 */
export async function ensureSystemTablesExist(): Promise<void> {
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "sso_token_jti" (
        "jti" text PRIMARY KEY,
        "used_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "auth_events" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "user_id" uuid,
        "event_type" varchar(50) NOT NULL,
        "ip" varchar(64),
        "user_agent" text,
        "meta" jsonb,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    console.log("System DB tables verified (sso_token_jti, auth_events).");
  } catch (err) {
    console.warn("Notice: ensureSystemTablesExist warning:", err);
  }
}
