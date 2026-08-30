CREATE TABLE "academic_years" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(20) NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "academic_years_name_unique" UNIQUE("name")
);
--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "jurusan" varchar(100);--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "urutan" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "classes" ADD COLUMN "academic_year_id" uuid;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "category" varchar(20) DEFAULT 'member' NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "can_login" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "member_status" varchar(20) DEFAULT 'siswa' NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "kelas_label" varchar(50);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "academic_year_id" uuid;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "sso_member_id" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "nik" varchar(16);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "nomor_kk" varchar(16);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "tempat_lahir" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "tanggal_lahir" date;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "agama" varchar(50);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "jenis_kelamin" char(1);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "email_pribadi" varchar(255);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "no_telepon" varchar(20);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "alamat" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "kode_pos" varchar(10);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "google_id" varchar(255);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "google_email" varchar(255);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "google_name" varchar(255);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "google_avatar" text;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "is_claimed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ayah_nama" varchar(255);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ayah_tahun_lahir" varchar(4);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ayah_jenjang_pendidikan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ayah_pekerjaan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ayah_penghasilan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ayah_nik" varchar(16);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ayah_no_hp" varchar(20);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ibu_nama" varchar(255);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ibu_tahun_lahir" varchar(4);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ibu_jenjang_pendidikan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ibu_pekerjaan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ibu_penghasilan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ibu_nik" varchar(16);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "ibu_no_hp" varchar(20);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "wali_nama" varchar(255);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "wali_tahun_lahir" varchar(4);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "wali_jenjang_pendidikan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "wali_pekerjaan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "wali_penghasilan" varchar(100);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "wali_nik" varchar(16);--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "wali_no_hp" varchar(20);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "staff_type" varchar(20) DEFAULT 'guru' NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "academic_year_id" uuid;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "sso_member_id" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "nik" varchar(16);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "nomor_kk" varchar(16);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "tempat_lahir" varchar(100);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "tanggal_lahir" date;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "agama" varchar(50);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "jenis_kelamin" char(1);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "email_pribadi" varchar(255);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "no_telepon" varchar(20);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "alamat" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "kode_pos" varchar(10);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "google_id" varchar(255);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "google_email" varchar(255);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "google_name" varchar(255);--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "google_avatar" text;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "is_claimed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "teachers" ADD COLUMN "claimed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "classes" ADD CONSTRAINT "classes_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teachers" ADD CONSTRAINT "teachers_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "students_sso_member_id_uidx" ON "students" USING btree ("sso_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "students_nik_uidx" ON "students" USING btree ("nik");--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_sso_member_id_uidx" ON "teachers" USING btree ("sso_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "teachers_nik_uidx" ON "teachers" USING btree ("nik");