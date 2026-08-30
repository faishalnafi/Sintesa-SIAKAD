import { randomUUID } from "node:crypto";
import { z } from "zod";

/** Canonical UUID v4 generator for all application-created identifiers. */
export function newUuid(): string {
  return randomUUID();
}

export const uuidSchema = z.string().uuid();

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

/**
 * Policy:
 * - Every entity primary key (`*.id`) is PostgreSQL `uuid` with `DEFAULT gen_random_uuid()`.
 * - Foreign keys that reference entities are also `uuid`.
 * - External IDs (Kredensia `sso_id`, NIS/NIP) are natural/business keys — not surrogate PKs.
 * - Runtime tokens (OAuth state, JWT jti) should also use UUID for uniqueness.
 */
