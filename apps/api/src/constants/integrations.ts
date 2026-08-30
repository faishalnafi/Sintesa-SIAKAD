/**
 * Integrasi aplikasi eksternal SINTESA (bukan domain Kredensia).
 *
 * | App              | Kode        | Data ke SINTESA              | Status   |
 * |------------------|-------------|------------------------------|----------|
 * | Kredensia SSO    | kredensia   | identitas / login            | live     |
 * | GDS              | gds         | poin kedisiplinan            | coming_soon |
 * | Kehadiran Siswa  | kehadiran   | sakit / izin / alpa          | coming_soon |
 *
 * Satu app = satu adapter. Tidak digabung ke SSO.
 */

export type IntegrationStatus = "live" | "coming_soon" | "disabled" | "misconfigured";

export type IntegrationCode = "kredensia" | "gds" | "kehadiran";

export type IntegrationDef = {
  code: IntegrationCode;
  name: string;
  shortName: string;
  description: string;
  /** Field akademik SINTESA yang diisi app ini */
  ownsFields: string[];
  /** Env keys required when going live */
  envKeys: string[];
  status: IntegrationStatus;
  icon: string;
  docsPath: string;
};

export const INTEGRATIONS: IntegrationDef[] = [
  {
    code: "kredensia",
    name: "Kredensia SSO",
    shortName: "SSO",
    description:
      "Identity Provider — login, user master, peran. Bukan sumber nilai/GDS/absensi.",
    ownsFields: ["users.sso_id", "users.email", "user_roles (mapping)"],
    envKeys: [
      "SSO_BASE_URL",
      "SSO_CLIENT_ID",
      "SSO_REDIRECT_URI",
      "SSO_JWT_SECRET",
      "SSO_CLIENT_SECRET",
    ],
    status: "live",
    icon: "key",
    docsPath: "apps/api/docs/KREDENSIA_SSO.md",
  },
  {
    code: "gds",
    name: "GDS — Poin Kedisiplinan",
    shortName: "GDS",
    description:
      "Aplikasi terpisah untuk poin pelanggaran/prestasi. SINTESA hanya menyimpan agregat poin untuk matrix raport & dashboard siswa.",
    ownsFields: ["students.poin_gds"],
    envKeys: ["GDS_BASE_URL", "GDS_API_KEY"],
    status: "coming_soon",
    icon: "stars",
    docsPath: "apps/api/docs/INTEGRATIONS_GDS_KEHADIRAN.md",
  },
  {
    code: "kehadiran",
    name: "Kehadiran Siswa",
    shortName: "Kehadiran",
    description:
      "Aplikasi terpisah absensi (BK/kehadiran). SINTESA hanya menyimpan rekap sakit/izin/alpa untuk matrix raport.",
    ownsFields: ["students.sakit", "students.izin", "students.alpa"],
    envKeys: ["KEHADIRAN_BASE_URL", "KEHADIRAN_API_KEY"],
    status: "coming_soon",
    icon: "event_available",
    docsPath: "apps/api/docs/INTEGRATIONS_GDS_KEHADIRAN.md",
  },
];

export function getIntegration(code: string): IntegrationDef | undefined {
  return INTEGRATIONS.find((i) => i.code === code);
}
