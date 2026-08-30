import "dotenv/config";
import { db } from "./src/db/index.js";
import { sql } from "drizzle-orm";

async function main() {
  console.log("Renaming column psaj to sts in grades table...");
  try {
    await db.execute(sql`ALTER TABLE grades RENAME COLUMN psaj TO sts;`);
    console.log("SUCCESS: Column renamed successfully!");
  } catch (err: any) {
    console.log("INFO (Rename Column):", err.message);
  }

  console.log("Creating teaching_hours table if not exists...");
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "teaching_hours" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "label" varchar(50) NOT NULL,
        "start_time" varchar(10) NOT NULL,
        "end_time" varchar(10) NOT NULL,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    console.log("SUCCESS: teaching_hours table created or verified!");
  } catch (err: any) {
    console.error("ERROR (teaching_hours):", err.message);
  }

  console.log("Creating teacher_journals table if not exists...");
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS "teacher_journals" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
        "teacher_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
        "date" varchar(10) NOT NULL,
        "class_id" uuid REFERENCES "classes"("id") ON DELETE CASCADE,
        "class_name" varchar(100),
        "teaching_hour_id" uuid REFERENCES "teaching_hours"("id") ON DELETE SET NULL,
        "teaching_hour_label" varchar(100),
        "subject_id" uuid REFERENCES "subjects"("id") ON DELETE CASCADE,
        "subject_name" varchar(150),
        "materi" text NOT NULL,
        "presence_info" text NOT NULL,
        "status" varchar(20) DEFAULT 'draft' NOT NULL,
        "group_id" uuid,
        "created_at" timestamp with time zone DEFAULT now() NOT NULL,
        "updated_at" timestamp with time zone DEFAULT now() NOT NULL
      );
    `);
    console.log("SUCCESS: teacher_journals table created or verified!");
  } catch (err: any) {
    console.error("ERROR (teacher_journals):", err.message);
  }

  console.log("Adding group_id and deleted_at columns to teacher_journals and grades if not exists...");
  try {
    await db.execute(sql`ALTER TABLE teacher_journals ADD COLUMN IF NOT EXISTS group_id uuid;`);
    await db.execute(sql`ALTER TABLE teacher_journals ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;`);
    await db.execute(sql`ALTER TABLE grades ADD COLUMN IF NOT EXISTS deleted_at timestamp with time zone;`);
    console.log("SUCCESS: group_id & deleted_at columns verified!");
  } catch (err: any) {
    console.error("ERROR (alter table):", err.message);
  }

  process.exit(0);
}

main();
