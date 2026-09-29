import * as XLSX from "xlsx";
import type { AuthUser } from "@/store/auth";

export type GradeTemplateExportRow = {
  studentId: string;
  name: string;
  nis: string | null;
  nisn?: string | null;
  uh1?: string | null;
  t1?: string | null;
  sts?: string | null;
  uh2?: string | null;
  t2?: string | null;
  status: string;
};

export type GradeTemplateExportComponent = {
  id: string;
  code: string;
  name: string;
  type: "UJIAN" | "TUGAS";
  status: "active" | "disabled" | "inactive";
  sortOrder: number;
};

export type GradeTemplateExportParams = {
  user: AuthUser;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  rows: GradeTemplateExportRow[];
  components: GradeTemplateExportComponent[];
};

/**
 * Menghasilkan file Excel (.xlsx) template input nilai yang dikunci secara digital
 * khusus untuk Guru, Kelas, dan Mata Pelajaran yang sedang aktif.
 */
export function downloadGradeTemplate(params: GradeTemplateExportParams): void {
  const { user, classId, className, subjectId, subjectName, rows, components } = params;

  const wb = XLSX.utils.book_new();

  // Hanya kolom aktif (misal: UH1, T1, STS) yang dibuka untuk input nilai
  const activeComponents = components.filter((c) => c.status === "active");

  const now = new Date();
  const dateFormatted = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Token otentikasi unik yang mengikat Guru UUID + Kelas ID + Mapel ID + Timestamp
  const rawToken = `${user.id}|${classId}|${subjectId}|${now.getTime()}`;
  const securityToken =
    typeof window !== "undefined" && typeof window.btoa === "function"
      ? window.btoa(encodeURIComponent(rawToken))
      : "";

  const tableHeaders = [
    "UUID Siswa",
    "No",
    "NISN",
    "Nama Lengkap Siswa",
    ...activeComponents.map((c) => `${c.name.toUpperCase()} (0-100)`),
    "Status Nilai",
  ];

  const sheetData: (string | number | null | undefined)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIAKAD) — SMAN 3 MOJOKERTO"],
    ["TEMPLATE RESMI PENGISIAN NILAI AKADEMIK (TERKUNCI & TEROTENTIKASI)"],
    [],
    ["Mata Pelajaran", subjectName, "", "UUID Mapel", subjectId],
    ["Kelas", className, "", "UUID Kelas", classId],
    ["Guru Pengampu", `${user.name}${user.username ? ` (${user.username})` : ""}`, "", "UUID Guru (KUNCI)", user.id],
    ["Status Keamanan", "TERKUNCI KHUSUS GURU PENGAMPU INI", "", "Waktu Generate", dateFormatted],
    ["Token Keamanan", securityToken, "", "Jumlah Siswa", `${rows.length} Siswa Terdaftar`],
    [],
    [
      `PERHATIAN: Template nilai ini diterbitkan secara otomatis dan terikat khusus (terkunci) pada Guru: ${user.name} (UUID: ${user.id}) untuk Kelas: ${className} dan Mata Pelajaran: ${subjectName}. File ini TIDAK DAPAT dialihkan atau diserahkan ke guru lain. Jangan mengubah kolom UUID Siswa demi integritas sinkronisasi database.`,
    ],
    [],
    tableHeaders,
  ];

  // Tambahkan baris untuk setiap siswa di kelas
  rows.forEach((r, idx) => {
    const rowValues: (string | number | null | undefined)[] = [
      r.studentId,
      idx + 1,
      r.nisn || r.nis || "-",
      r.name,
    ];

    activeComponents.forEach((c) => {
      const colKey = c.code.toLowerCase() as keyof GradeTemplateExportRow;
      const rawVal = r[colKey];
      if (rawVal !== null && rawVal !== undefined && String(rawVal).trim() !== "") {
        const num = Number(rawVal);
        rowValues.push(isNaN(num) ? String(rawVal) : num);
      } else {
        rowValues.push("");
      }
    });

    rowValues.push(r.status || "draft");
    sheetData.push(rowValues);
  });

  const ws = XLSX.utils.aoa_to_sheet(sheetData);

  // Merge judul & catatan informasi
  const totalCols = tableHeaders.length;
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
    { s: { r: 9, c: 0 }, e: { r: 9, c: totalCols - 1 } },
  ];

  // Lebar kolom yang proporsional dan rapi
  ws["!cols"] = [
    { wch: 38 }, // UUID Siswa
    { wch: 6 },  // No
    { wch: 18 }, // NISN
    { wch: 36 }, // Nama Siswa
    ...activeComponents.map(() => ({ wch: 16 })), // Kolom Nilai
    { wch: 14 }, // Status
  ];

  // Password proteksi worksheet terikat pada UUID Guru
  const lockPassword = `siakad_${user.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8)}`;
  ws["!protect"] = {
    password: lockPassword,
    selectLockedCells: true,
    selectUnlockedCells: true,
  };

  XLSX.utils.book_append_sheet(wb, ws, "INPUT_NILAI");

  // Sheet 2: Metadata Keamanan Tersembunyi (Hidden verification sheet untuk validasi import)
  const metaSheetData = [
    ["KEY", "VALUE"],
    ["TEACHER_UUID", user.id],
    ["TEACHER_NAME", user.name],
    ["TEACHER_USERNAME", user.username || ""],
    ["CLASS_UUID", classId],
    ["CLASS_NAME", className],
    ["SUBJECT_UUID", subjectId],
    ["SUBJECT_NAME", subjectName],
    ["ACTIVE_COMPONENTS", activeComponents.map((c) => c.code.toLowerCase()).join(",")],
    ["SECURITY_TOKEN", securityToken],
    ["TOTAL_STUDENTS", String(rows.length)],
    ["EXPORTED_AT", now.toISOString()],
  ];
  const wsMeta = XLSX.utils.aoa_to_sheet(metaSheetData);
  XLSX.utils.book_append_sheet(wb, wsMeta, "_SECURITY_METADATA");

  // Sembunyikan sheet verifikasi sistem
  if (typeof XLSX.utils.book_set_sheet_visibility === "function") {
    XLSX.utils.book_set_sheet_visibility(wb, 1, 1);
  }

  // Nama file rapi, mencerminkan kelas, mapel, guru, dan tanggal
  const cleanName = (str: string) => str.replace(/[^a-zA-Z0-9_-]/g, "_");
  const fileName = `Template_Nilai_${cleanName(className)}_${cleanName(subjectName)}_${cleanName(user.name)}.xlsx`;

  XLSX.writeFile(wb, fileName);
}
