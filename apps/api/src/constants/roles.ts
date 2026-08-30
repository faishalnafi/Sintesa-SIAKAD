/**
 * Role catalog — mapping dari Kredensia (IdP) → kode SINTESA.
 *
 * Kredensia: sumber nama peran (JWT roles[] / API members.roles[].nama_role)
 * SINTESA: kode stabil untuk RBAC fitur akademik (nilai, matrix, dll.)
 *
 * Jangan duplikasi master user IdP di sini — hanya mapping + capability login.
 * Lihat docs/DOMAIN_BOUNDARY.md
 */

export type RoleCategory = "system" | "member" | "app";

export type RoleDefinition = {
  /** Canonical SINTESA role code (lowercase, stable) */
  code: string;
  /** Display name (ID) */
  name: string;
  /** system = portal admin, member = ScholarGate member roles, app = SINTESA-only */
  category: RoleCategory;
  /** May authenticate into SINTESA */
  canLogin: boolean;
  /** ScholarGate / SSO aliases that map into this code */
  aliases: string[];
  description: string;
  /**
   * Detail fields typically present for this role
   * (from ScholarGate API.md member structure).
   */
  detailFields: string[];
};

/** Shared identity fields present on all ScholarGate members */
export const SCHOLARGATE_COMMON_FIELDS = [
  "id",
  "nama",
  "role",
  "jenis_kelamin",
  "nik",
  "nomor_kk",
  "tempat_lahir",
  "tanggal_lahir",
  "agama",
  "google_email",
  "google_name",
  "google_avatar",
  "email_pribadi",
  "no_telepon",
  "alamat",
  "kode_pos",
  "academic_year_id",
  "academic_year_name",
  "is_claimed",
  "claimed_at",
  "created_at",
  "updated_at",
] as const;

/** Parent/guardian block — mainly for role siswa */
export const SCHOLARGATE_PARENT_FIELDS = [
  "ayah_nama",
  "ayah_tahun_lahir",
  "ayah_jenjang_pendidikan",
  "ayah_pekerjaan",
  "ayah_penghasilan",
  "ayah_nik",
  "ayah_no_hp",
  "ibu_nama",
  "ibu_tahun_lahir",
  "ibu_jenjang_pendidikan",
  "ibu_pekerjaan",
  "ibu_penghasilan",
  "ibu_nik",
  "ibu_no_hp",
  "wali_nama",
  "wali_tahun_lahir",
  "wali_jenjang_pendidikan",
  "wali_pekerjaan",
  "wali_penghasilan",
  "wali_nik",
  "wali_no_hp",
] as const;

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: "superadmin",
    name: "Super Admin",
    category: "system",
    canLogin: true,
    aliases: ["superadmin", "super_admin", "super admin"],
    description: "Administrator sistem (ScholarGate admins.role = super_admin).",
    detailFields: ["username", "nama", "permissions"],
  },
  {
    code: "admin",
    name: "Admin",
    category: "system",
    canLogin: true,
    aliases: ["admin", "tata usaha", "tu"],
    description: "Admin operasional / Tata Usaha (ScholarGate admins.role = admin).",
    detailFields: ["username", "nama", "permissions"],
  },
  {
    code: "siswa",
    name: "Siswa",
    category: "member",
    canLogin: true,
    aliases: ["siswa", "student"],
    description: "Peserta didik aktif. Detail: NISN/NIS + data orang tua/wali.",
    detailFields: [
      ...SCHOLARGATE_COMMON_FIELDS,
      "nisn",
      "nis",
      "kelas",
      ...SCHOLARGATE_PARENT_FIELDS,
    ],
  },
  {
    code: "guru",
    name: "Guru",
    category: "member",
    canLogin: true,
    aliases: ["guru", "teacher"],
    description:
      "Tenaga pendidik. NIP wajib. Gelar disimpan di nama (contoh: Dr. Ahmad, S.Pd., M.Pd.).",
    detailFields: [...SCHOLARGATE_COMMON_FIELDS, "nip"],
  },
  {
    code: "tendik",
    name: "Tendik",
    category: "member",
    canLogin: true,
    aliases: ["tendik", "tenaga kependidikan", "staff"],
    description: "Tenaga kependidikan non-guru. NIP/identitas pegawai.",
    detailFields: [...SCHOLARGATE_COMMON_FIELDS, "nip"],
  },
  {
    code: "alumni",
    name: "Alumni",
    category: "member",
    canLogin: true,
    aliases: ["alumni"],
    description: "Mantan siswa. Field kelas biasanya 'ALUMNI'.",
    detailFields: [...SCHOLARGATE_COMMON_FIELDS, "nisn", "nis", "kelas"],
  },
  {
    code: "keluar",
    name: "Keluar / Mutasi",
    category: "member",
    canLogin: false,
    aliases: ["keluar", "mutasi"],
    description:
      "Siswa mutasi/keluar (non-aktif). Data tetap ada via API, tidak boleh login/claim sampai dikembalikan ke siswa.",
    detailFields: [...SCHOLARGATE_COMMON_FIELDS, "nisn", "nis", "kelas"],
  },
  {
    code: "walikelas",
    name: "Wali Kelas",
    category: "app",
    canLogin: true,
    aliases: ["walikelas", "wali kelas", "homeroom"],
    description:
      "Overlay SINTESA dari ScholarGate academic_histories.is_homeroom. Biasanya multi-role bersama guru.",
    detailFields: ["nip", "nama", "kelas_perwalian", "is_homeroom"],
  },
  {
    code: "ortu",
    name: "Orang Tua / Wali",
    category: "app",
    canLogin: true,
    aliases: ["ortu", "orang tua", "parent", "wali murid"],
    description:
      "Akses orang tua di SINTESA. Data sumber: blok ayah/ibu/wali pada member siswa ScholarGate.",
    detailFields: [...SCHOLARGATE_PARENT_FIELDS, "linked_student_ids"],
  },
];

export const ROLE_CODES = ROLE_DEFINITIONS.map((r) => r.code);

/** Build alias → canonical code map */
export function buildRoleAliasMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const def of ROLE_DEFINITIONS) {
    map[def.code.toLowerCase()] = def.code;
    for (const alias of def.aliases) {
      map[alias.toLowerCase()] = def.code;
    }
  }
  return map;
}

export function mapExternalRoles(input: string[]): string[] {
  const aliasMap = buildRoleAliasMap();
  const mapped = new Set<string>();
  for (const r of input) {
    const trimmed = r.trim();
    if (!trimmed) continue;
    const code = aliasMap[trimmed.toLowerCase()];
    if (code) {
      mapped.add(code);
    } else {
      mapped.add(trimmed.toLowerCase());
    }
  }
  return [...mapped];
}

export function canRoleLogin(code: string): boolean {
  const def = ROLE_DEFINITIONS.find((r) => r.code === code);
  if (def) return def.canLogin;
  return true;
}

export function getRoleDefinition(code: string): RoleDefinition | undefined {
  return ROLE_DEFINITIONS.find((r) => r.code === code);
}
