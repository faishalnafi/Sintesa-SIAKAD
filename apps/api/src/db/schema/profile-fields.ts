/**
 * Shared identity / contact columns mirrored from ScholarGate-SSO members table.
 * Source: database/migration.php + API.md
 */
import { boolean, date, text, timestamp, varchar, char } from "drizzle-orm/pg-core";

/**
 * Common personal identity (siswa, guru, tendik, alumni, keluar).
 * Unique indexes for sso_member_id / nik are declared per-table
 * (shared .unique() would collide on constraint names across tables).
 */
export const scholargateIdentityColumns = {
  /** UUID member di ScholarGate-SSO (members.id) */
  ssoMemberId: text("sso_member_id"),
  nik: varchar("nik", { length: 16 }),
  nomorKk: varchar("nomor_kk", { length: 16 }),
  tempatLahir: varchar("tempat_lahir", { length: 100 }),
  tanggalLahir: date("tanggal_lahir"),
  agama: varchar("agama", { length: 50 }),
  jenisKelamin: char("jenis_kelamin", { length: 1 }),
  emailPribadi: varchar("email_pribadi", { length: 255 }),
  noTelepon: varchar("no_telepon", { length: 20 }),
  alamat: text("alamat"),
  kodePos: varchar("kode_pos", { length: 10 }),
  googleId: varchar("google_id", { length: 255 }),
  googleEmail: varchar("google_email", { length: 255 }),
  googleName: varchar("google_name", { length: 255 }),
  googleAvatar: text("google_avatar"),
  isClaimed: boolean("is_claimed").default(false).notNull(),
  claimedAt: timestamp("claimed_at", { withTimezone: true }),
};

/** Parent/guardian block — primarily for siswa (ScholarGate API) */
export const scholargateParentColumns = {
  ayahNama: varchar("ayah_nama", { length: 255 }),
  ayahTahunLahir: varchar("ayah_tahun_lahir", { length: 4 }),
  ayahJenjangPendidikan: varchar("ayah_jenjang_pendidikan", { length: 100 }),
  ayahPekerjaan: varchar("ayah_pekerjaan", { length: 100 }),
  ayahPenghasilan: varchar("ayah_penghasilan", { length: 100 }),
  ayahNik: varchar("ayah_nik", { length: 16 }),
  ayahNoHp: varchar("ayah_no_hp", { length: 20 }),

  ibuNama: varchar("ibu_nama", { length: 255 }),
  ibuTahunLahir: varchar("ibu_tahun_lahir", { length: 4 }),
  ibuJenjangPendidikan: varchar("ibu_jenjang_pendidikan", { length: 100 }),
  ibuPekerjaan: varchar("ibu_pekerjaan", { length: 100 }),
  ibuPenghasilan: varchar("ibu_penghasilan", { length: 100 }),
  ibuNik: varchar("ibu_nik", { length: 16 }),
  ibuNoHp: varchar("ibu_no_hp", { length: 20 }),

  waliNama: varchar("wali_nama", { length: 255 }),
  waliTahunLahir: varchar("wali_tahun_lahir", { length: 4 }),
  waliJenjangPendidikan: varchar("wali_jenjang_pendidikan", { length: 100 }),
  waliPekerjaan: varchar("wali_pekerjaan", { length: 100 }),
  waliPenghasilan: varchar("wali_penghasilan", { length: 100 }),
  waliNik: varchar("wali_nik", { length: 16 }),
  waliNoHp: varchar("wali_no_hp", { length: 20 }),
};
