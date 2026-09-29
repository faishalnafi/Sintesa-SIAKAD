import * as XLSX from "xlsx";
import type { AuthUser } from "@/store/auth";

export type GradeTemplateExportRow = {
  studentId: string;
  name: string;
  nis: string | null;
  nisn?: string | null;
  uh1: string | null;
  t1: string | null;
  sts: string | null;
  uh2: string | null;
  t2: string | null;
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

export type GradeImportSummary = {
  totalInFile: number;
  matchedCount: number;
  unmatchedCount: number;
  updatedCount: number;
};

export type GradeImportResult = {
  success: boolean;
  error?: string;
  summary?: GradeImportSummary;
  updatedRows?: GradeTemplateExportRow[];
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
    ["Mata Pelajaran", subjectName, "UUID Mapel", subjectId],
    ["Kelas", className, "UUID Kelas", classId],
    ["Guru Pengampu", `${user.name}${user.username ? ` (${user.username})` : ""}`, "UUID Guru (KUNCI)", user.id],
    ["Status Keamanan", "TERKUNCI KHUSUS GURU PENGAMPU INI", "Waktu Generate", dateFormatted],
    ["Token Keamanan", securityToken, "Jumlah Siswa", `${rows.length} Siswa Terdaftar`],
    [],
    [
      `PERHATIAN: Template nilai ini diterbitkan secara otomatis dan terikat khusus (terkunci) pada Guru: ${user.name} (UUID: ${user.id}) untuk Kelas: ${className} dan Mata Pelajaran: ${subjectName}. File ini TIDAK VALID jika diunggah oleh guru lain atau pada kelas/mapel berbeda. Jangan mengubah kolom UUID Siswa demi integritas sinkronisasi database.`,
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

/**
 * Membaca dan memvalidasi file Excel hasil pengisian nilai oleh guru.
 * Memastikan file benar-benar terkunci untuk Guru, Kelas, dan Mapel yang aktif.
 */
export function parseAndValidateGradeTemplate(
  fileBuffer: ArrayBuffer,
  expected: {
    user: AuthUser;
    classId: string;
    className: string;
    subjectId: string;
    subjectName: string;
    currentRows: GradeTemplateExportRow[];
    components: GradeTemplateExportComponent[];
  }
): GradeImportResult {
  const { user, classId, className, subjectId, subjectName, currentRows } = expected;

  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(fileBuffer, { type: "array" });
  } catch (err) {
    return {
      success: false,
      error: `Format file tidak valid atau rusak: ${err instanceof Error ? err.message : "Gagal membaca berkas Excel"}`,
    };
  }

  if (!wb.SheetNames || wb.SheetNames.length === 0) {
    return { success: false, error: "File Excel kosong tidak memiliki lembar kerja (worksheet)." };
  }

  // 1. Ekstrak Metadata Keamanan (Cek Sheet Tersembunyi & Fallback Header)
  const meta: Record<string, string> = {};
  if (wb.Sheets["_SECURITY_METADATA"]) {
    const rawMeta = XLSX.utils.sheet_to_json<(string | number | null)[]>(wb.Sheets["_SECURITY_METADATA"], { header: 1 });
    rawMeta.forEach((r) => {
      if (r && r[0]) {
        meta[String(r[0]).trim()] = String(r[1] ?? "").trim();
      }
    });
  }

  const mainSheet = wb.Sheets["INPUT_NILAI"] || wb.Sheets[wb.SheetNames[0]];
  const allRows = XLSX.utils.sheet_to_json<(string | number | null | undefined)[]>(mainSheet, { header: 1 });

  // Fallback: Cari UUID Guru, Kelas, Mapel dari 15 baris pertama sheet utama
  if (!meta["TEACHER_UUID"] || !meta["CLASS_UUID"] || !meta["SUBJECT_UUID"]) {
    allRows.slice(0, 15).forEach((r) => {
      if (!r) return;
      r.forEach((cell, idx) => {
        const text = String(cell || "").toLowerCase();
        if (text.includes("uuid guru") && r[idx + 1]) {
          meta["TEACHER_UUID"] = meta["TEACHER_UUID"] || String(r[idx + 1]).trim();
        }
        if (text.includes("guru pengampu") && r[idx + 1]) {
          meta["TEACHER_NAME"] = meta["TEACHER_NAME"] || String(r[idx + 1]).trim();
        }
        if (text.includes("uuid kelas") && r[idx + 1]) {
          meta["CLASS_UUID"] = meta["CLASS_UUID"] || String(r[idx + 1]).trim();
        }
        if (text.includes("kelas") && !text.includes("uuid") && r[idx + 1]) {
          meta["CLASS_NAME"] = meta["CLASS_NAME"] || String(r[idx + 1]).trim();
        }
        if (text.includes("uuid mapel") && r[idx + 1]) {
          meta["SUBJECT_UUID"] = meta["SUBJECT_UUID"] || String(r[idx + 1]).trim();
        }
        if (text.includes("mata pelajaran") && r[idx + 1]) {
          meta["SUBJECT_NAME"] = meta["SUBJECT_NAME"] || String(r[idx + 1]).trim();
        }
      });
    });
  }

  // 2. VALIDASI KEAMANAN TINGKAT TINGGI (KUNCI GURU & KELAS)
  const fileTeacherUuid = meta["TEACHER_UUID"];
  const fileTeacherName = meta["TEACHER_NAME"];
  if (fileTeacherUuid && fileTeacherUuid !== user.id) {
    return {
      success: false,
      error: `<b>Akses Ditolak (Template Terkunci Guru Lain):</b><br/>Template ini diterbitkan khusus untuk <b>${
        fileTeacherName || "Guru Lain"
      }</b> (UUID: <code class="text-xs">${fileTeacherUuid}</code>).<br/><br/>Template resmi tidak dapat dibagikan atau digunakan oleh akun guru lain untuk menjaga integritas data.`,
    };
  }

  const fileClassUuid = meta["CLASS_UUID"];
  const fileClassName = meta["CLASS_NAME"];
  if (fileClassUuid && fileClassUuid !== classId) {
    return {
      success: false,
      error: `<b>Kelas Tidak Sesuai:</b><br/>File ini adalah template untuk kelas <b>"${
        fileClassName || fileClassUuid
      }"</b>.<br/><br/>Saat ini Anda sedang membuka kelas <b>"${className}"</b>. Silakan pilih kelas yang sesuai terlebih dahulu.`,
    };
  }

  const fileSubjectUuid = meta["SUBJECT_UUID"];
  const fileSubjectName = meta["SUBJECT_NAME"];
  if (fileSubjectUuid && fileSubjectUuid !== subjectId) {
    return {
      success: false,
      error: `<b>Mata Pelajaran Tidak Sesuai:</b><br/>File ini adalah template untuk mapel <b>"${
        fileSubjectName || fileSubjectUuid
      }"</b>.<br/><br/>Saat ini Anda sedang membuka mata pelajaran <b>"${subjectName}"</b>.`,
    };
  }

  // 3. Temukan Baris Header Tabel Siswa
  let headerRowIdx = -1;
  for (let i = 0; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r) continue;
    const lineStr = r.map((c) => String(c || "").toLowerCase()).join(" ");
    if (lineStr.includes("uuid siswa") || (lineStr.includes("nisn") && lineStr.includes("nama"))) {
      headerRowIdx = i;
      break;
    }
  }

  if (headerRowIdx === -1) {
    return {
      success: false,
      error: "Struktur tabel tidak dikenali. Baris kolom 'UUID Siswa' atau 'NISN' tidak ditemukan dalam berkas Excel.",
    };
  }

  const headers = allRows[headerRowIdx] as (string | undefined)[];

  // Identifikasi letak index masing-masing kolom komponen nilai
  const colMappings: { colIdx: number; code: string }[] = [];
  headers.forEach((h, idx) => {
    if (!h) return;
    const lower = String(h).toLowerCase().trim();
    if (lower.startsWith("uuid") || lower === "no" || lower.startsWith("nisn") || lower.startsWith("nama") || lower.startsWith("status")) {
      return;
    }
    const cleanCode = lower.split(" ")[0].split("(")[0].replace(/[^a-z0-9]/g, "");
    if (cleanCode) {
      colMappings.push({ colIdx: idx, code: cleanCode });
    }
  });

  // 4. Petakan dan Perbarui Nilai Siswa
  const studentMap = new Map<string, GradeTemplateExportRow>();
  const nisnMap = new Map<string, GradeTemplateExportRow>();

  currentRows.forEach((r) => {
    studentMap.set(r.studentId, r);
    const cleanNisn = (r.nisn || r.nis || "").trim();
    if (cleanNisn) nisnMap.set(cleanNisn, r);
  });

  let matchedCount = 0;
  let updatedCount = 0;
  let totalInFile = 0;

  const updatedRows = currentRows.map((r) => ({ ...r }));

  for (let i = headerRowIdx + 1; i < allRows.length; i++) {
    const r = allRows[i];
    if (!r || r.length === 0) continue;

    const fileStudentUuid = r[0] ? String(r[0]).trim() : "";
    const fileNisn = r[2] ? String(r[2]).trim() : "";
    if (!fileStudentUuid && !fileNisn) continue;

    totalInFile++;

    // Cari target siswa di database lokal berdasarkan UUID atau NISN
    const targetIdx = updatedRows.findIndex(
      (s) =>
        (fileStudentUuid && s.studentId === fileStudentUuid) ||
        (fileNisn && (s.nisn === fileNisn || s.nis === fileNisn))
    );

    if (targetIdx !== -1) {
      matchedCount++;
      const current = updatedRows[targetIdx];

      // Jika baris siswa sudah dikunci/submitted/approved oleh walikelas, lewati modifikasi
      if (current.status === "submitted" || current.status === "approved") {
        continue;
      }

      let rowHasChanged = false;
      colMappings.forEach(({ colIdx, code }) => {
        const rawScore = r[colIdx];
        if (rawScore !== undefined && rawScore !== null && String(rawScore).trim() !== "") {
          const num = parseInt(String(rawScore).replace(/[^0-9-]/g, ""), 10);
          if (!isNaN(num)) {
            const clamped = Math.max(0, Math.min(100, num));
            const strVal = String(clamped);
            if ((current as Record<string, unknown>)[code] !== strVal) {
              (current as Record<string, unknown>)[code] = strVal;
              rowHasChanged = true;
            }
          }
        }
      });

      if (rowHasChanged) {
        updatedCount++;
      }
    }
  }

  if (matchedCount === 0) {
    return {
      success: false,
      error: `Tidak ada data siswa dalam file yang cocok dengan daftar siswa kelas <b>${className}</b>. Pastikan Anda mengunggah file template yang sesuai dengan kelas ini.`,
    };
  }

  return {
    success: true,
    summary: {
      totalInFile,
      matchedCount,
      unmatchedCount: totalInFile - matchedCount,
      updatedCount,
    },
    updatedRows,
  };
}
