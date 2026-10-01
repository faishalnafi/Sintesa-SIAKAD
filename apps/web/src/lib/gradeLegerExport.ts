import * as XLSX from "xlsx";

export type ExportGradeStudent = {
  id: string;
  name: string;
  nis: string | null;
  nisn: string | null;
  gender: string | null;
  sakit?: number | null;
  izin?: number | null;
  alpa?: number | null;
  catatanKehadiran?: string | null;
  poinGds?: number | null;
  catatanGds?: string | null;
};

export type ExportGradeSubject = {
  id: string;
  code: string;
  name: string;
  type: string;
  teacherNames: string | null;
};

export type ExportGradeComponent = {
  id: string;
  code: string;
  name: string;
  type: string;
  status: string;
  sortOrder: number;
};

export type ExportGradeRecord = {
  id: string;
  studentId: string;
  classId: string;
  subjectId: string;
  uh1: string | null;
  t1: string | null;
  sts: string | null;
  uh2: string | null;
  t2: string | null;
  status: string;
};

export type ExportGradeLegerParams = {
  classInfo: {
    id: string;
    name: string;
    homeroomTeacherName: string | null;
  };
  roster: ExportGradeStudent[];
  subjects: ExportGradeSubject[];
  components: ExportGradeComponent[];
  grades: ExportGradeRecord[];
  selectedSubjectId?: string;
  statusFilter: string;
  printedBy: string;
};

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Nilai";
}

function parseScore(val: string | null | undefined): number | null {
  if (val == null || String(val).trim() === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export function hasAnyNumericScore(g: ExportGradeRecord | undefined): boolean {
  if (!g) return false;
  return (
    parseScore(g.uh1) !== null ||
    parseScore(g.t1) !== null ||
    parseScore(g.sts) !== null ||
    parseScore(g.uh2) !== null ||
    parseScore(g.t2) !== null
  );
}

function computeStudentSubjectAvg(
  g: ExportGradeRecord | undefined,
  activeCodes: Array<"uh1" | "t1" | "sts" | "uh2" | "t2">
): number | null {
  if (!g) return null;
  const nums: number[] = [];
  for (const code of activeCodes) {
    const v = parseScore(g[code]);
    if (v !== null) nums.push(v);
  }
  if (nums.length === 0) return null;
  const sum = nums.reduce((a, b) => a + b, 0);
  return Math.round((sum / nums.length) * 100) / 100;
}

function formatStatusIndo(g: ExportGradeRecord | undefined): string {
  if (!g) return "Belum Diisi";
  const s = (g.status || "").toLowerCase();
  if (s === "approved") return "Disetujui (Approved)";
  if (s === "submitted") return "Terkirim (Submitted)";
  if (s === "draft") {
    return hasAnyNumericScore(g) ? "Draft (Terisi)" : "Belum Diisi";
  }
  return g.status;
}

/**
 * Menghasilkan file Excel (.xlsx) Buku Leger Nilai Kelas & Rekap Nilai per Mata Pelajaran
 */
export function downloadGradeLegerExcel(params: ExportGradeLegerParams): {
  fileName: string;
  studentCount: number;
  subjectCount: number;
} {
  const {
    classInfo,
    roster,
    subjects,
    components,
    grades,
    selectedSubjectId,
    statusFilter,
    printedBy,
  } = params;

  const wb = XLSX.utils.book_new();
  const nowStr = new Date().toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const signDate = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  // Komponen yang ditampilkan (semua yang tidak inactive)
  const visibleComponents =
    components.length > 0
      ? components.filter((c) => c.status !== "inactive")
      : [
          { id: "1", code: "uh1", name: "UH1", type: "UJIAN", status: "active", sortOrder: 1 },
          { id: "2", code: "t1", name: "T1", type: "TUGAS", status: "active", sortOrder: 2 },
          { id: "3", code: "sts", name: "STS", type: "UJIAN", status: "active", sortOrder: 3 },
          { id: "4", code: "uh2", name: "UH2", type: "UJIAN", status: "disabled", sortOrder: 4 },
          { id: "5", code: "t2", name: "T2", type: "TUGAS", status: "disabled", sortOrder: 5 },
        ];

  const compCodes = visibleComponents.map(
    (c) => c.code.toLowerCase() as "uh1" | "t1" | "sts" | "uh2" | "t2"
  );

  // Map: `${studentId}|${subjectId}` -> ExportGradeRecord
  const gradeMap = new Map<string, ExportGradeRecord>();
  for (const g of grades) {
    gradeMap.set(`${g.studentId}|${g.subjectId}`, g);
  }

  const statusLabelFilter =
    statusFilter === "approved"
      ? "Hanya Nilai Disetujui (Approved)"
      : statusFilter === "submitted"
      ? "Hanya Nilai Terkirim (Submitted)"
      : statusFilter === "draft"
      ? "Hanya Nilai Draft"
      : "Semua Status Nilai (Draft, Submitted, Approved)";

  // Helper membangun 1 sheet Rekap Detail per Mata Pelajaran
  const buildSubjectSheet = (subj: ExportGradeSubject, sheetNameOverride?: string) => {
    const aoa: (string | number)[][] = [
      ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
      ["DAFTAR REKAPITULASI NILAI AKADEMIK MATA PELAJARAN (PEMBERKASAN FISIK)"],
      [],
      ["Kelas / Rombel", `Kelas ${classInfo.name}`, "", "Tanggal Cetak", nowStr],
      [
        "Mata Pelajaran",
        `${subj.name} (${subj.code || subj.name})`,
        "",
        "Guru Pengampu",
        subj.teacherNames || "—",
      ],
      [
        "Wali Kelas",
        classInfo.homeroomTeacherName || "—",
        "",
        "Filter Status",
        statusLabelFilter,
      ],
      [],
      [
        "No",
        "NISN / NIS",
        "Nama Lengkap Siswa",
        "L/P",
        ...visibleComponents.map((c) => c.name.toUpperCase()),
        "Rata-rata",
        "Status Nilai",
        "Ket.",
      ],
    ];

    roster.forEach((stu, idx) => {
      const g = gradeMap.get(`${stu.id}|${subj.id}`);
      const avg = computeStudentSubjectAvg(g, compCodes);
      const compValues = compCodes.map((code) => {
        const v = parseScore(g?.[code]);
        return v !== null ? v : "—";
      });

      aoa.push([
        idx + 1,
        stu.nisn || stu.nis || "—",
        stu.name,
        stu.gender || "—",
        ...compValues,
        avg !== null ? avg : "—",
        formatStatusIndo(g),
        "",
      ]);
    });

    aoa.push([]);
    aoa.push([]);
    aoa.push(["", "Mengetahui,", "", "", "", "", `Mojokerto, ${signDate}`]);
    aoa.push([
      "",
      "Wali Kelas",
      "",
      "",
      "",
      "",
      "Guru Mata Pelajaran",
    ]);
    aoa.push([]);
    aoa.push([]);
    aoa.push([]);
    aoa.push([
      "",
      `( ${classInfo.homeroomTeacherName || "................................................."} )`,
      "",
      "",
      "",
      "",
      `( ${subj.teacherNames || "................................................."} )`,
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [
      { wch: 5 },  // No
      { wch: 16 }, // NISN
      { wch: 34 }, // Nama Siswa
      { wch: 6 },  // L/P
      ...visibleComponents.map(() => ({ wch: 10 })),
      { wch: 12 }, // Rata-rata
      { wch: 22 }, // Status
      { wch: 12 }, // Ket
    ];

    const lastColIdx = 6 + visibleComponents.length;
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: lastColIdx } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: lastColIdx } },
    ];

    XLSX.utils.book_append_sheet(
      wb,
      ws,
      sanitizeSheetName(sheetNameOverride || `${subj.code || subj.name}`)
    );
  };

  // KASUS A: Ekspor Spesifik 1 Mata Pelajaran
  const targetSubject = selectedSubjectId
    ? subjects.find((s) => s.id === selectedSubjectId)
    : undefined;

  if (targetSubject) {
    buildSubjectSheet(targetSubject, `Nilai ${targetSubject.code || targetSubject.name}`);
    const fileName = `Rekap_Nilai_${classInfo.name.replace(/\s+/g, "-")}_${(
      targetSubject.code || targetSubject.name
    ).replace(/[^a-zA-Z0-9]/g, "_")}.xlsx`;
    XLSX.writeFile(wb, fileName);
    return { fileName, studentCount: roster.length, subjectCount: 1 };
  }

  // KASUS B: Buku Leger Kelas Lengkap (Sheet 1: Leger Induk Semua Mapel + Sheet Matriks Persetujuan + Sheet Rincian Per Mapel)
  const legerHeaders = [
    "No",
    "NISN / NIS",
    "Nama Lengkap Siswa",
    "L/P",
    ...subjects.map((s) => `${s.code || s.name}`),
    "Jumlah Nilai",
    "Rata-rata Umum",
    "Sakit",
    "Izin",
    "Alpa",
    "Poin GDS",
    "Peringkat",
  ];

  // Hitung nilai rata-rata per mapel dan total/rata-rata umum untuk peringkat
  const studentRowsComputed = roster.map((stu) => {
    const subjScores = subjects.map((subj) => {
      const g = gradeMap.get(`${stu.id}|${subj.id}`);
      return computeStudentSubjectAvg(g, compCodes);
    });
    const validScores = subjScores.filter((v): v is number => v !== null);
    const totalScore =
      validScores.length > 0
        ? Math.round(validScores.reduce((a, b) => a + b, 0) * 100) / 100
        : null;
    const generalAvg =
      validScores.length > 0
        ? Math.round((validScores.reduce((a, b) => a + b, 0) / validScores.length) * 100) / 100
        : null;

    return {
      student: stu,
      subjScores,
      totalScore,
      generalAvg,
      rank: null as number | null,
    };
  });

  // Hitung peringkat berdasarkan Rata-rata Umum tertinggi
  const sortedForRank = [...studentRowsComputed]
    .filter((r) => r.generalAvg !== null)
    .sort((a, b) => (b.generalAvg ?? 0) - (a.generalAvg ?? 0));

  sortedForRank.forEach((item, i) => {
    item.rank = i + 1;
  });

  const legerAoa: (string | number)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
    ["BUKU LEGER NILAI AKADEMIK KELAS (REKAPITULASI SELURUH MATA PELAJARAN)"],
    [],
    ["Kelas / Rombel", `Kelas ${classInfo.name}`, "", "Tanggal Cetak", nowStr],
    ["Wali Kelas", classInfo.homeroomTeacherName || "—", "", "Dicetak Oleh", printedBy],
    [
      "Jumlah Siswa",
      `${roster.length} Siswa`,
      "",
      "Cakupan Status",
      statusLabelFilter,
    ],
    [],
    legerHeaders,
  ];

  studentRowsComputed.forEach((row, idx) => {
    legerAoa.push([
      idx + 1,
      row.student.nisn || row.student.nis || "—",
      row.student.name,
      row.student.gender || "—",
      ...row.subjScores.map((sc) => (sc !== null ? sc : "—")),
      row.totalScore !== null ? row.totalScore : "—",
      row.generalAvg !== null ? row.generalAvg : "—",
      row.student.sakit ?? 0,
      row.student.izin ?? 0,
      row.student.alpa ?? 0,
      row.student.poinGds ?? 0,
      row.rank !== null ? row.rank : "—",
    ]);
  });

  // Tambahkan Keterangan Kode Mata Pelajaran & Blok Tanda Tangan di bawah Leger
  legerAoa.push([]);
  legerAoa.push(["KETERANGAN KODE MATA PELAJARAN:"]);
  subjects.forEach((s) => {
    legerAoa.push([
      "",
      s.code || s.name,
      `${s.name}${s.teacherNames ? ` (Guru: ${s.teacherNames})` : ""}`,
    ]);
  });

  legerAoa.push([]);
  legerAoa.push(["", "Mengetahui,", "", "", "", `Mojokerto, ${signDate}`]);
  legerAoa.push([
    "",
    "Kepala Sekolah / Waka Kurikulum",
    "",
    "",
    "",
    "Wali Kelas",
  ]);
  legerAoa.push([]);
  legerAoa.push([]);
  legerAoa.push([]);
  legerAoa.push([
    "",
    "( ................................................. )",
    "",
    "",
    "",
    `( ${classInfo.homeroomTeacherName || "................................................."} )`,
  ]);

  const wsLeger = XLSX.utils.aoa_to_sheet(legerAoa);
  wsLeger["!cols"] = [
    { wch: 5 },  // No
    { wch: 16 }, // NISN
    { wch: 34 }, // Nama
    { wch: 6 },  // L/P
    ...subjects.map(() => ({ wch: 11 })),
    { wch: 14 }, // Jumlah Nilai
    { wch: 15 }, // Rata-rata Umum
    { wch: 8 },  // Sakit
    { wch: 8 },  // Izin
    { wch: 8 },  // Alpa
    { wch: 10 }, // Poin GDS
    { wch: 11 }, // Peringkat
  ];

  const lastLegerCol = 10 + subjects.length;
  wsLeger["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: lastLegerCol } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: lastLegerCol } },
  ];

  XLSX.utils.book_append_sheet(wb, wsLeger, sanitizeSheetName(`Leger Kelas ${classInfo.name}`));

  // Sheet 2: Rekap Matrix Persetujuan Nilai per Mata Pelajaran
  const matrixAoa: (string | number)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
    ["MATRIKS PROGRES PENGUMPULAN & PERSETUJUAN NILAI MATA PELAJARAN"],
    [],
    ["Kelas / Rombel", `Kelas ${classInfo.name}`, "", "Wali Kelas", classInfo.homeroomTeacherName || "—"],
    ["Jumlah Siswa", `${roster.length} Siswa`, "", "Tanggal Cetak", nowStr],
    [],
    [
      "No",
      "Kode Mapel",
      "Nama Mata Pelajaran",
      "Guru Pengampu",
      "Total Siswa",
      "Sudah Dinilai",
      "Draft",
      "Terkirim (Submitted)",
      "Disetujui (Approved)",
      "Status Pengumpulan",
    ],
  ];

  subjects.forEach((subj, idx) => {
    let filled = 0;
    let draftCnt = 0;
    let submittedCnt = 0;
    let approvedCnt = 0;

    for (const stu of roster) {
      const g = gradeMap.get(`${stu.id}|${subj.id}`);
      if (!g) continue;
      const scored = hasAnyNumericScore(g);
      if (scored || g.status === "submitted" || g.status === "approved") {
        filled++;
      }
      if (g.status === "approved") approvedCnt++;
      else if (g.status === "submitted") submittedCnt++;
      else if (scored) draftCnt++;
    }

    let summaryStatus = "Belum Mengisi";
    if (roster.length > 0 && approvedCnt >= roster.length) {
      summaryStatus = "Lengkap & Disetujui Wali Kelas";
    } else if (approvedCnt > 0) {
      summaryStatus = `Disetujui Sebagian (${approvedCnt}/${roster.length})`;
    } else if (submittedCnt > 0) {
      summaryStatus = `Menunggu Persetujuan Wali Kelas (${submittedCnt}/${roster.length})`;
    } else if (draftCnt > 0) {
      summaryStatus = `Masih Draft (${draftCnt}/${roster.length})`;
    }

    matrixAoa.push([
      idx + 1,
      subj.code || subj.name,
      subj.name,
      subj.teacherNames || "—",
      roster.length,
      filled,
      draftCnt,
      submittedCnt,
      approvedCnt,
      summaryStatus,
    ]);
  });

  const wsMatrix = XLSX.utils.aoa_to_sheet(matrixAoa);
  wsMatrix["!cols"] = [
    { wch: 5 },
    { wch: 14 },
    { wch: 30 },
    { wch: 28 },
    { wch: 13 },
    { wch: 14 },
    { wch: 10 },
    { wch: 20 },
    { wch: 20 },
    { wch: 32 },
  ];
  wsMatrix["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 9 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 9 } },
  ];
  XLSX.utils.book_append_sheet(wb, wsMatrix, sanitizeSheetName("Matriks Persetujuan"));

  // Tambahkan Sheet Rincian untuk setiap Mata Pelajaran
  for (const subj of subjects) {
    buildSubjectSheet(subj, `Mapel - ${subj.code || subj.name}`);
  }

  const fileName = `Buku_Leger_Nilai_Kelas_${classInfo.name.replace(/\s+/g, "-")}.xlsx`;
  XLSX.writeFile(wb, fileName);

  return {
    fileName,
    studentCount: roster.length,
    subjectCount: subjects.length,
  };
}

/**
 * Menghasilkan file Excel (.xlsx) Rekap Presensi Kehadiran, Poin Ketertiban (GDS) & Data Siswa per Kelas
 */
export function downloadStudentAttendanceGdsExcel(params: {
  classInfo: { id: string; name: string; homeroomTeacherName: string | null };
  roster: ExportGradeStudent[];
  printedBy: string;
}): { fileName: string; studentCount: number } {
  const { classInfo, roster, printedBy } = params;
  const wb = XLSX.utils.book_new();
  const nowStr = new Date().toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const signDate = new Date().toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

  const aoa: (string | number)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
    ["REKAPITULASI PRESENSI KEHADIRAN, POIN KETERTIBAN (GDS) & DATA SISWA ROMBEL"],
    [],
    ["Kelas / Rombel", `Kelas ${classInfo.name}`, "", "Tanggal Cetak", nowStr],
    ["Wali Kelas", classInfo.homeroomTeacherName || "—", "", "Dicetak Oleh", printedBy],
    ["Jumlah Siswa", `${roster.length} Siswa`, "", "Sumber Integrasi", "SIMAK & Aplikasi PASTI"],
    [],
    [
      "No",
      "NIS",
      "NISN",
      "Nama Lengkap Siswa",
      "L/P",
      "Sakit (S)",
      "Izin (I)",
      "Alpa (A)",
      "Total Ketidakhadiran",
      "Catatan Kehadiran",
      "Poin GDS",
      "Catatan Kedisiplinan (GDS)",
    ],
  ];

  roster.forEach((stu, idx) => {
    const s = Number(stu.sakit ?? 0);
    const i = Number(stu.izin ?? 0);
    const a = Number(stu.alpa ?? 0);
    const totalAbsen = s + i + a;
    const gds = Number(stu.poinGds ?? 0);

    aoa.push([
      idx + 1,
      stu.nis || "—",
      stu.nisn || "—",
      stu.name,
      stu.gender || "—",
      s,
      i,
      a,
      totalAbsen,
      stu.catatanKehadiran || "—",
      gds,
      stu.catatanGds || "—",
    ]);
  });

  aoa.push([]);
  aoa.push(["", "Mengetahui,", "", "", "", "", "", `Mojokerto, ${signDate}`]);
  aoa.push([
    "",
    "Waka Kesiswaan / Koordinator GDS",
    "",
    "",
    "",
    "",
    "",
    "Wali Kelas",
  ]);
  aoa.push([]);
  aoa.push([]);
  aoa.push([]);
  aoa.push([
    "",
    "( ................................................. )",
    "",
    "",
    "",
    "",
    "",
    `( ${classInfo.homeroomTeacherName || "................................................."} )`,
  ]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 5 },
    { wch: 14 },
    { wch: 16 },
    { wch: 34 },
    { wch: 6 },
    { wch: 10 },
    { wch: 10 },
    { wch: 10 },
    { wch: 20 },
    { wch: 28 },
    { wch: 12 },
    { wch: 28 },
  ];
  ws["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 11 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 11 } },
  ];

  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(`Presensi & GDS ${classInfo.name}`));
  const fileName = `Rekap_Presensi_GDS_Siswa_Kelas_${classInfo.name.replace(/\s+/g, "-")}.xlsx`;
  XLSX.writeFile(wb, fileName);

  return { fileName, studentCount: roster.length };
}

/**
 * Menghasilkan file Excel (.xlsx) SK Pembagian Tugas Guru Mapel, Wali Kelas & Jam Pelajaran
 */
export function downloadTeacherAssignmentExcel(params: {
  subjectAssignments: Array<{
    id: string;
    teacherName: string;
    teacherNip: string | null;
    teacherEmail: string | null;
    subjectName: string;
    subjectCode: string | null;
    subjectType: string;
  }>;
  homerooms: Array<{
    id: string;
    teacherName: string;
    teacherNip: string | null;
    className: string;
    gradeLevel: string | null;
    academicYear: string;
  }>;
  hours: Array<{
    id: string;
    label: string;
    startTime: string;
    endTime: string;
  }>;
  printedBy: string;
}): { fileName: string; totalTeachers: number; totalHomerooms: number } {
  const { subjectAssignments, homerooms, hours, printedBy } = params;
  const wb = XLSX.utils.book_new();
  const nowStr = new Date().toLocaleDateString("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  // Sheet 1: Penugasan Guru Mata Pelajaran
  const aoaSubj: (string | number)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
    ["DAFTAR PEMBAGIAN TUGAS GURU MATA PELAJARAN AKTIF"],
    [],
    ["Tanggal Cetak", nowStr, "", "Dicetak Oleh", printedBy],
    [],
    ["No", "Nama Lengkap Guru", "NIP / Username", "Email", "Kode Mapel", "Mata Pelajaran", "Kelompok Mapel"],
  ];

  subjectAssignments.forEach((item, idx) => {
    aoaSubj.push([
      idx + 1,
      item.teacherName,
      item.teacherNip || "—",
      item.teacherEmail || "—",
      item.subjectCode || "—",
      item.subjectName,
      (item.subjectType || "umum").toUpperCase(),
    ]);
  });

  const wsSubj = XLSX.utils.aoa_to_sheet(aoaSubj);
  wsSubj["!cols"] = [
    { wch: 5 },
    { wch: 32 },
    { wch: 20 },
    { wch: 28 },
    { wch: 14 },
    { wch: 30 },
    { wch: 16 },
  ];
  wsSubj["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
  ];
  XLSX.utils.book_append_sheet(wb, wsSubj, "1. Tugas Guru Mapel");

  // Sheet 2: Penugasan Wali Kelas
  const aoaHr: (string | number)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
    ["DAFTAR PENUGASAN WALI KELAS AKTIF"],
    [],
    ["Tanggal Cetak", nowStr, "", "Dicetak Oleh", printedBy],
    [],
    ["No", "Kelas / Rombel", "Tingkat", "Nama Wali Kelas", "NIP / Username", "Tahun Pelajaran"],
  ];

  homerooms.forEach((item, idx) => {
    aoaHr.push([
      idx + 1,
      `Kelas ${item.className}`,
      item.gradeLevel || "—",
      item.teacherName,
      item.teacherNip || "—",
      item.academicYear || "—",
    ]);
  });

  const wsHr = XLSX.utils.aoa_to_sheet(aoaHr);
  wsHr["!cols"] = [
    { wch: 5 },
    { wch: 18 },
    { wch: 10 },
    { wch: 34 },
    { wch: 22 },
    { wch: 18 },
  ];
  wsHr["!merges"] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: 5 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: 5 } },
  ];
  XLSX.utils.book_append_sheet(wb, wsHr, "2. Daftar Wali Kelas");

  // Sheet 3: Struktur Jam Pelajaran
  const aoaHours: (string | number)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
    ["STRUKTUR PEMBAGIAN JAM PELAJARAN HARIAN"],
    [],
    ["No", "Jam Pelajaran", "Waktu Mulai", "Waktu Selesai"],
  ];

  hours.forEach((h, idx) => {
    aoaHours.push([idx + 1, `Jam ke-${h.label}`, h.startTime, h.endTime]);
  });

  const wsHours = XLSX.utils.aoa_to_sheet(aoaHours);
  wsHours["!cols"] = [{ wch: 5 }, { wch: 20 }, { wch: 16 }, { wch: 16 }];
  XLSX.utils.book_append_sheet(wb, wsHours, "3. Jam Pelajaran");

  const fileName = `SK_Penugasan_Guru_dan_Wali_Kelas_SIMAK.xlsx`;
  XLSX.writeFile(wb, fileName);

  return {
    fileName,
    totalTeachers: subjectAssignments.length,
    totalHomerooms: homerooms.length,
  };
}
