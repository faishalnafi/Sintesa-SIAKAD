import * as XLSX from "xlsx";
import { eq, and, or, desc, sql, isNull, inArray, asc } from "drizzle-orm";
import { db } from "../../db/index.js";
import {
  classes,
  students,
  subjects,
  grades,
  assessmentComponents,
  teachers,
  teachingHours,
  teacherJournals,
  users,
  homeroomAssignments,
} from "../../db/schema/index.js";
import { uploadFile } from "../storage/storage.service.js";
import type { StorageProviderType } from "../storage/types.js";

const HARI_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const BULAN_ID = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

function formatIndoDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  const dt = new Date(y, m - 1, d);
  const hari = HARI_ID[dt.getDay()] ?? "";
  const bulan = BULAN_ID[m - 1] ?? "";
  return `${hari}, ${String(d).padStart(2, "0")} ${bulan} ${y}`;
}

function getDateListBetween(startStr: string, endStr: string, skipSunday = true): string[] {
  const [sy, sm, sd] = startStr.split("-").map(Number);
  const [ey, em, ed] = endStr.split("-").map(Number);
  const cur = new Date(sy, sm - 1, sd);
  const end = new Date(ey, em - 1, ed);
  const result: string[] = [];

  while (cur <= end) {
    if (!skipSunday || cur.getDay() !== 0) {
      const y = cur.getFullYear();
      const m = String(cur.getMonth() + 1).padStart(2, "0");
      const d = String(cur.getDate()).padStart(2, "0");
      result.push(`${y}-${m}-${d}`);
    }
    cur.setDate(cur.getDate() + 1);
  }
  return result;
}

function sanitizeSheetName(name: string): string {
  return name.replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Rekap";
}

function parseScore(val: string | null | undefined): number | null {
  if (val == null || String(val).trim() === "") return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
}

export type ExportReportResult = {
  success: boolean;
  exportType: "rekap_jurnal" | "leger_nilai" | "template_nilai";
  fileName: string;
  url: string;
  cloudUrl?: string;
  provider: StorageProviderType;
  storageKey: string;
  size: number;
  scopeDescription: string;
  totalRows?: number;
  filledCount?: number;
  sentCount?: number;
  draftCount?: number;
  emptyCount?: number;
  studentCount?: number;
  subjectCount?: number;
};

// ============================================================================
// 1. REKAP MONITORING JURNAL MENGAJAR GURU (.XLSX)
// ============================================================================
export async function exportJournalRecapExcel(params: {
  startDate: string;
  endDate: string;
  classQuery?: string | null;
  classId?: string | null;
  teacherQuery?: string | null;
  teacherUserId?: string | null;
  includeEmptySlots?: boolean;
  printedBy: string;
}): Promise<ExportReportResult> {
  const {
    startDate,
    endDate,
    classQuery,
    classId,
    teacherQuery,
    teacherUserId,
    includeEmptySlots = true,
    printedBy,
  } = params;

  // 1. Ambil daftar jam pelajaran
  const hours = await db
    .select({
      id: teachingHours.id,
      label: teachingHours.label,
      startTime: teachingHours.startTime,
      endTime: teachingHours.endTime,
    })
    .from(teachingHours)
    .orderBy(sql`CAST(REGEXP_REPLACE(label, '[^0-9]', '', 'g') AS INTEGER) ASC`, teachingHours.startTime);

  // 2. Ambil seluruh kelas aktif
  const allClasses = await db
    .select({ id: classes.id, name: classes.name })
    .from(classes)
    .where(eq(classes.isActive, true))
    .orderBy(classes.name);

  // 3. Resolusi filter kelas jika ditentukan
  let selectedClass: { id: string; name: string } | null = null;
  if (classId) {
    selectedClass = allClasses.find((c) => c.id === classId) ?? null;
  }
  if (!selectedClass && classQuery && classQuery.toUpperCase() !== "SEMUA") {
    const qClean = classQuery.toLowerCase().replace(/kelas\s*/i, "").trim();
    const qCleanNoSpace = qClean.replace(/\s+/g, "");
    selectedClass =
      allClasses.find(
        (c) =>
          c.name.toLowerCase() === qClean ||
          c.name.toLowerCase().replace(/\s+/g, "") === qCleanNoSpace
      ) ??
      allClasses.find(
        (c) =>
          c.name.toLowerCase().includes(qClean) ||
          (qClean.length >= 3 && qClean.includes(c.name.toLowerCase()))
      ) ??
      null;
  }

  // 4. Resolusi filter guru jika ditentukan
  let selectedTeacher: { id: string; name: string } | null = null;
  if (teacherUserId) {
    const [matchedById] = await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(eq(users.id, teacherUserId))
      .limit(1);
    if (matchedById) {
      selectedTeacher = matchedById;
    }
  }

  if (!selectedTeacher && teacherQuery && teacherQuery.toUpperCase() !== "SEMUA") {
    const tClean = teacherQuery.toLowerCase().replace(/['`]/g, "").trim();
    const allUsers = await db.select({ id: users.id, name: users.name }).from(users);

    // Prioritas 1: Exact match (case and punctuation insensitive)
    const exactMatch = allUsers.find((u) => {
      const uClean = u.name.toLowerCase().replace(/['`]/g, "").trim();
      return uClean === tClean;
    });

    if (exactMatch) {
      selectedTeacher = exactMatch;
    } else {
      // Prioritas 2: Nama user mengandung query (bukan sebaliknya!), minimal 3 huruf
      const queryInUser = allUsers.find((u) => {
        const uClean = u.name.toLowerCase().replace(/['`]/g, "").trim();
        return tClean.length >= 3 && uClean.includes(tClean);
      });

      if (queryInUser) {
        selectedTeacher = queryInUser;
      } else {
        // Prioritas 3: Seluruh token kata kunci (min 2 huruf) ada pada nama user
        const tTokens = tClean.split(/\s+/).filter((tok) => tok.length >= 2);
        if (tTokens.length > 0) {
          const tokenMatch = allUsers.find((u) => {
            const uClean = u.name.toLowerCase().replace(/['`]/g, "").trim();
            return tTokens.every((tok) => uClean.includes(tok));
          });
          if (tokenMatch) {
            selectedTeacher = tokenMatch;
          }
        }
      }
    }
  }

  // 5. Ambil data jurnal sesuai rentang tanggal
  const conditions = [
    isNull(teacherJournals.deletedAt),
    sql`${teacherJournals.date} >= ${startDate}`,
    sql`${teacherJournals.date} <= ${endDate}`,
  ];

  if (selectedClass) {
    conditions.push(
      or(
        eq(teacherJournals.classId, selectedClass.id),
        sql`LOWER(TRIM(${teacherJournals.className})) = LOWER(TRIM(${selectedClass.name}))`
      )!
    );
  }
  if (selectedTeacher) {
    conditions.push(eq(teacherJournals.teacherUserId, selectedTeacher.id));
  }

  const journals = await db
    .select({
      id: teacherJournals.id,
      date: teacherJournals.date,
      classId: teacherJournals.classId,
      className: teacherJournals.className,
      teachingHourId: teacherJournals.teachingHourId,
      teachingHourLabel: teacherJournals.teachingHourLabel,
      subjectId: teacherJournals.subjectId,
      subjectName: teacherJournals.subjectName,
      materi: teacherJournals.materi,
      presenceInfo: teacherJournals.presenceInfo,
      status: teacherJournals.status,
      teacherUserId: teacherJournals.teacherUserId,
      teacherName: users.name,
    })
    .from(teacherJournals)
    .leftJoin(users, eq(teacherJournals.teacherUserId, users.id))
    .where(and(...conditions))
    .orderBy(desc(teacherJournals.date), asc(teacherJournals.teachingHourLabel));

  // 6. Bangun Buku Kerja Excel (Workbook)
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

  const periodText =
    startDate === endDate
      ? `${formatIndoDate(startDate)} (Hari Ini)`
      : `${formatIndoDate(startDate)} s/d ${formatIndoDate(endDate)}`;

  const dateList = getDateListBetween(startDate, endDate, startDate !== endDate);
  const hourMap = new Map(hours.map((h) => [h.id, h]));

  let totalExportedRows = 0;
  let filledCount = 0;
  let sentCount = 0;
  let draftCount = 0;
  let emptyCount = 0;

  const buildSheet = (
    sheetTitle: string,
    subTitleFilter: string,
    rowsData: Array<{
      date: string;
      hourLabel: string;
      timeRange: string;
      className: string;
      teacherName: string;
      subjectName: string;
      materi: string;
      presenceInfo: string;
      statusLabel: string;
    }>
  ) => {
    const sFilled = rowsData.filter((r) => r.statusLabel !== "Belum Isi").length;
    const sSent = rowsData.filter((r) => r.statusLabel === "Terkirim").length;
    const sDraft = rowsData.filter((r) => r.statusLabel === "Draft").length;
    const sEmpty = rowsData.filter((r) => r.statusLabel === "Belum Isi").length;

    filledCount += sFilled;
    sentCount += sSent;
    draftCount += sDraft;
    emptyCount += sEmpty;
    totalExportedRows += rowsData.length;

    const aoa: (string | number)[][] = [
      ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
      ["REKAPITULASI PEMBERKASAN FISIK MONITORING JURNAL MENGAJAR GURU"],
      [],
      ["Filter / Cakupan", subTitleFilter, "", "Tanggal Cetak", nowStr],
      ["Periode Rekap", periodText, "", "Dicetak Oleh", printedBy],
      [
        "Ringkasan KBM",
        `Total Baris: ${rowsData.length} | Terisi: ${sFilled} (Terkirim: ${sSent}, Draft: ${sDraft}) | Kosong: ${sEmpty}`,
      ],
      [],
      [
        "No",
        "Hari, Tanggal",
        "Jam Ke",
        "Waktu KBM",
        "Kelas / Rombel",
        "Nama Guru Pengajar",
        "Mata Pelajaran",
        "Materi / Pokok Bahasan Pembelajaran",
        "Keterangan Presensi Siswa",
        "Status Jurnal",
        "Paraf",
      ],
    ];

    if (rowsData.length === 0) {
      aoa.push([
        1,
        periodText,
        "—",
        "—",
        selectedClass?.name || "Semua Kelas",
        selectedTeacher?.name || "Semua Guru",
        "—",
        "Tidak ada catatan jurnal mengajar pada rentang tanggal & filter ini.",
        "—",
        "Belum Isi",
        "",
      ]);
    } else {
      rowsData.forEach((r, idx) => {
        aoa.push([
          idx + 1,
          formatIndoDate(r.date),
          r.hourLabel,
          r.timeRange,
          r.className || "—",
          r.teacherName || "—",
          r.subjectName || "—",
          r.materi || "—",
          r.presenceInfo || "—",
          r.statusLabel,
          "",
        ]);
      });
    }

    // Blok Tanda Tangan Pemberkasan Fisik
    aoa.push([]);
    aoa.push([]);
    aoa.push(["", "Mengetahui,", "", "", "", "", "", `Mojokerto, ${signDate}`]);
    aoa.push([
      "",
      "Kepala Sekolah / Waka Kurikulum",
      "",
      "",
      "",
      "",
      "",
      selectedTeacher ? "Guru Mata Pelajaran" : "Petugas Monitoring / Wali Kelas",
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
      `( ${selectedTeacher ? selectedTeacher.name : "................................................."} )`,
    ]);

    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Lebar kolom A4 Landscape
    ws["!cols"] = [
      { wch: 5 },  // No
      { wch: 24 }, // Hari, Tanggal
      { wch: 12 }, // Jam Ke
      { wch: 16 }, // Waktu KBM
      { wch: 14 }, // Kelas
      { wch: 26 }, // Guru Pengajar
      { wch: 22 }, // Mata Pelajaran
      { wch: 42 }, // Materi Pembelajaran
      { wch: 28 }, // Ket. Presensi
      { wch: 14 }, // Status
      { wch: 10 }, // Paraf
    ];

    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
      { s: { r: 5, c: 1 }, e: { r: 5, c: 10 } },
    ];

    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetTitle));
  };

  // Helper memformat label jam
  const formatHourLabel = (jHourLabel: string | null | undefined, hFallback: string | null | undefined) => {
    const raw = (jHourLabel || hFallback || "").trim();
    if (!raw) return "—";
    if (raw.toLowerCase().startsWith("jam")) return raw;
    return `Jam ${raw}`;
  };

  // Helper memformat rentang waktu
  const formatTimeRange = (hId: string | null | undefined) => {
    if (!hId) return "—";
    const h = hourMap.get(hId);
    return h ? `${h.startTime} - ${h.endTime}` : "—";
  };

  // Map: `${date}|${classId}|${hourId}` -> Journal Record
  const journalMap = new Map<string, (typeof journals)[0]>();
  for (const j of journals) {
    if (j.classId && j.teachingHourId) {
      journalMap.set(`${j.date}|${j.classId}|${j.teachingHourId}`, j);
    }
  }

  // KASUS 1: Filter Kelas ditentukan
  if (selectedClass) {
    const classJournals = journals.filter(
      (j) =>
        j.classId === selectedClass!.id ||
        (j.className || "").trim().toLowerCase() === selectedClass!.name.trim().toLowerCase()
    );
    const jMap = new Map(classJournals.map((j) => [`${j.date}|${j.teachingHourId}`, j]));
    const rowsData: Parameters<typeof buildSheet>[2] = [];

    if (includeEmptySlots && hours.length > 0 && !selectedTeacher) {
      for (const dt of dateList) {
        for (const h of hours) {
          const j = jMap.get(`${dt}|${h.id}`);
          rowsData.push({
            date: dt,
            hourLabel: `Jam ${h.label}`,
            timeRange: `${h.startTime} - ${h.endTime}`,
            className: selectedClass!.name,
            teacherName: j?.teacherName ?? "—",
            subjectName: j?.subjectName ?? "—",
            materi: j?.materi ?? "—",
            presenceInfo: j?.presenceInfo ?? "—",
            statusLabel: j ? (j.status === "sent" ? "Terkirim" : "Draft") : "Belum Isi",
          });
        }
      }
    } else {
      for (const j of classJournals) {
        const hObj = hourMap.get(j.teachingHourId || "");
        rowsData.push({
          date: j.date,
          hourLabel: formatHourLabel(j.teachingHourLabel, hObj?.label),
          timeRange: formatTimeRange(j.teachingHourId),
          className: j.className || selectedClass!.name,
          teacherName: j.teacherName ?? (selectedTeacher ? selectedTeacher.name : "—"),
          subjectName: j.subjectName ?? "—",
          materi: j.materi ?? "—",
          presenceInfo: j.presenceInfo ?? "—",
          statusLabel: j.status === "sent" ? "Terkirim" : "Draft",
        });
      }
    }

    const filterDesc = selectedTeacher
      ? `Guru Pengajar: ${selectedTeacher.name} · Kelas ${selectedClass.name}`
      : `Kelas ${selectedClass.name} (Semua Guru)`;

    buildSheet(`Kelas ${selectedClass.name}`, filterDesc, rowsData);
  }
  // KASUS 2: Filter Guru ditentukan (tanpa filter kelas)
  else if (selectedTeacher) {
    const teacherRows: Parameters<typeof buildSheet>[2] = [];
    const sortedJournals = [...journals].sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      const hA = hourMap.get(a.teachingHourId || "")?.startTime || a.teachingHourLabel || "";
      const hB = hourMap.get(b.teachingHourId || "")?.startTime || b.teachingHourLabel || "";
      return hA.localeCompare(hB);
    });

    for (const j of sortedJournals) {
      const hObj = hourMap.get(j.teachingHourId || "");
      teacherRows.push({
        date: j.date,
        hourLabel: formatHourLabel(j.teachingHourLabel, hObj?.label),
        timeRange: formatTimeRange(j.teachingHourId),
        className: j.className ?? "—",
        teacherName: j.teacherName ?? selectedTeacher.name,
        subjectName: j.subjectName ?? "—",
        materi: j.materi || "—",
        presenceInfo: j.presenceInfo || "—",
        statusLabel: j.status === "sent" ? "Terkirim" : "Draft",
      });
    }

    buildSheet(
      `Jurnal - ${selectedTeacher.name}`,
      `Guru Pengajar: ${selectedTeacher.name} (Semua Kelas)`,
      teacherRows
    );
  }
  // KASUS 3: Semua Kelas & Semua Guru
  else {
    const masterRows: Parameters<typeof buildSheet>[2] = journals.map((j) => {
      const hObj = hourMap.get(j.teachingHourId || "");
      return {
        date: j.date,
        hourLabel: formatHourLabel(j.teachingHourLabel, hObj?.label),
        timeRange: formatTimeRange(j.teachingHourId),
        className: j.className || "—",
        teacherName: j.teacherName || "—",
        subjectName: j.subjectName || "—",
        materi: j.materi || "—",
        presenceInfo: j.presenceInfo || "—",
        statusLabel: j.status === "sent" ? "Terkirim" : "Draft",
      };
    });

    buildSheet("Rekap Semua Jurnal", "Seluruh Kelas & Guru Pengajar", masterRows);

    if (includeEmptySlots && allClasses.length > 0 && dateList.length <= 7 && hours.length > 0) {
      for (const cls of allClasses.slice(0, 15)) {
        const cJournals = journals.filter((j) => j.classId === cls.id);
        const jMap = new Map(cJournals.map((j) => [`${j.date}|${j.teachingHourId}`, j]));
        const clsRows: Parameters<typeof buildSheet>[2] = [];

        for (const dt of dateList) {
          for (const h of hours) {
            const j = jMap.get(`${dt}|${h.id}`);
            clsRows.push({
              date: dt,
              hourLabel: `Jam ${h.label}`,
              timeRange: `${h.startTime} - ${h.endTime}`,
              className: cls.name,
              teacherName: j?.teacherName ?? "—",
              subjectName: j?.subjectName ?? "—",
              materi: j?.materi ?? "—",
              presenceInfo: j?.presenceInfo ?? "—",
              statusLabel: j ? (j.status === "sent" ? "Terkirim" : "Draft") : "Belum Isi",
            });
          }
        }

        buildSheet(`Kelas ${cls.name}`, `Kelas ${cls.name}`, clsRows);
      }
    }
  }

  // 7. Simpan file ke Buffer & Upload ke Local/Object Storage
  const scopeSlug = selectedClass
    ? `Kelas_${selectedClass.name.replace(/\s+/g, "-")}`
    : selectedTeacher
    ? `Guru_${selectedTeacher.name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20)}`
    : "Semua_Kelas";

  const dateSlug = startDate === endDate ? startDate : `${startDate}_sd_${endDate}`;
  const fileName = `Rekap_Jurnal_Mengajar_${scopeSlug}_${dateSlug}.xlsx`;

  const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const uploadRes = await uploadFile({
    buffer: excelBuffer,
    filename: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    folder: "exports",
  });

  return {
    success: true,
    exportType: "rekap_jurnal",
    fileName,
    url: uploadRes.url,
    cloudUrl: uploadRes.cloudUrl,
    provider: uploadRes.provider,
    storageKey: uploadRes.key,
    size: uploadRes.size,
    scopeDescription: `Kelas: ${selectedClass?.name || "Semua Kelas"}, Guru: ${selectedTeacher?.name || "Semua Guru"}, Periode: ${periodText}`,
    totalRows: totalExportedRows,
    filledCount,
    sentCount,
    draftCount,
    emptyCount,
  };
}

// ============================================================================
// 2. LEGER & REKAP NILAI AKADEMIK KELAS (.XLSX)
// ============================================================================
export async function exportGradeLegerExcel(params: {
  classQuery: string;
  subjectQuery?: string | null;
  statusFilter?: string;
  printedBy: string;
}): Promise<ExportReportResult> {
  const { classQuery, subjectQuery, statusFilter = "all", printedBy } = params;

  // 1. Cari kelas yang dimaksud
  const allClasses = await db.select().from(classes).where(eq(classes.isActive, true));
  const qClean = classQuery.toLowerCase().replace(/kelas\s*/i, "").trim();
  const targetClass =
    allClasses.find(
      (c) =>
        c.name.toLowerCase() === qClean ||
        c.name.toLowerCase().includes(qClean) ||
        qClean.includes(c.name.toLowerCase())
    ) ?? allClasses[0];

  if (!targetClass) {
    throw new Error(`Kelas "${classQuery}" tidak ditemukan di database.`);
  }

  // 2. Ambil data wali kelas
  const [homeroom] = await db
    .select({ teacherName: users.name })
    .from(homeroomAssignments)
    .innerJoin(users, eq(homeroomAssignments.userId, users.id))
    .where(eq(homeroomAssignments.classId, targetClass.id))
    .limit(1);

  // 3. Ambil daftar siswa aktif di kelas
  const roster = await db
    .select({
      id: students.id,
      name: students.name,
      nis: students.nis,
      nisn: students.nisn,
      gender: students.jenisKelamin,
    })
    .from(students)
    .where(and(eq(students.classId, targetClass.id), eq(students.memberStatus, "siswa")))
    .orderBy(students.name);

  // 4. Ambil mata pelajaran aktif
  const subjectsList = await db
    .select({
      id: subjects.id,
      code: subjects.code,
      name: subjects.name,
      type: subjects.type,
    })
    .from(subjects)
    .where(eq(subjects.isActive, true))
    .orderBy(subjects.name);

  // 5. Ambil komponen penilaian aktif
  const componentsList = await db
    .select({
      id: assessmentComponents.id,
      code: assessmentComponents.code,
      name: assessmentComponents.name,
      type: assessmentComponents.type,
      status: assessmentComponents.status,
      sortOrder: assessmentComponents.sortOrder,
    })
    .from(assessmentComponents)
    .where(eq(assessmentComponents.status, "active"))
    .orderBy(asc(assessmentComponents.sortOrder));

  const compCodes = (
    componentsList.length > 0
      ? componentsList.map((c) => c.code.toLowerCase())
      : ["uh1", "t1", "sts", "uh2", "t2"]
  ) as Array<"uh1" | "t1" | "sts" | "uh2" | "t2">;

  // 6. Ambil nilai siswa di kelas tersebut
  const gradesRows = await db
    .select({
      id: grades.id,
      studentId: grades.studentId,
      classId: grades.classId,
      subjectId: grades.subjectId,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
      status: grades.status,
    })
    .from(grades)
    .where(eq(grades.classId, targetClass.id));

  // Map: `${studentId}|${subjectId}` -> Grade
  const gradeMap = new Map<string, (typeof gradesRows)[0]>();
  for (const g of gradesRows) {
    gradeMap.set(`${g.studentId}|${g.subjectId}`, g);
  }

  // 7. Bangun Workbook Leger
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

  const computeStudentSubjectAvg = (
    g: (typeof gradesRows)[0] | undefined
  ): number | null => {
    if (!g) return null;
    const nums: number[] = [];
    for (const code of compCodes) {
      const v = parseScore(g[code]);
      if (v !== null) nums.push(v);
    }
    if (nums.length === 0) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return Math.round((sum / nums.length) * 100) / 100;
  };

  const statusLabelFilter =
    statusFilter === "approved"
      ? "Hanya Nilai Disetujui (Approved)"
      : statusFilter === "submitted"
      ? "Hanya Nilai Terkirim (Submitted)"
      : statusFilter === "draft"
      ? "Hanya Nilai Draft"
      : "Semua Status Nilai (Draft, Submitted, Approved)";

  // --- SHEET 1: LEGER KELAS (Ringkasan Roster x Semua Mapel) ---
  const legerHeaderRow: (string | number)[] = [
    "No",
    "NISN / NIS",
    "Nama Lengkap Siswa",
    "L/P",
  ];
  subjectsList.forEach((s) => {
    legerHeaderRow.push(`${s.name} (${s.code})`);
  });
  legerHeaderRow.push("Rata-rata Leger");
  legerHeaderRow.push("Paraf");

  const legerAoa: (string | number)[][] = [
    ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
    ["BUKU LEGER NILAI AKADEMIK KELAS (PEMBERKASAN FISIK)"],
    [],
    ["Kelas / Rombel", `Kelas ${targetClass.name}`, "", "Tanggal Cetak", nowStr],
    [
      "Wali Kelas",
      homeroom?.teacherName || "—",
      "",
      "Dicetak Oleh",
      printedBy,
    ],
    [
      "Cakupan",
      `Total Siswa: ${roster.length} Orang | Total Mapel: ${subjectsList.length} Mata Pelajaran`,
      "",
      "Filter Status",
      statusLabelFilter,
    ],
    [],
    legerHeaderRow,
  ];

  roster.forEach((stu, idx) => {
    const row: (string | number)[] = [
      idx + 1,
      stu.nisn ? `${stu.nisn} / ${stu.nis || "—"}` : stu.nis || "—",
      stu.name,
      stu.gender?.toUpperCase().startsWith("P") ? "P" : "L",
    ];

    const studentAvgs: number[] = [];
    for (const subj of subjectsList) {
      const g = gradeMap.get(`${stu.id}|${subj.id}`);
      if (statusFilter !== "all" && g && g.status.toLowerCase() !== statusFilter.toLowerCase()) {
        row.push("—");
        continue;
      }
      const avg = computeStudentSubjectAvg(g);
      if (avg !== null) {
        row.push(avg);
        studentAvgs.push(avg);
      } else {
        row.push("—");
      }
    }

    if (studentAvgs.length > 0) {
      const overall =
        Math.round(
          (studentAvgs.reduce((a, b) => a + b, 0) / studentAvgs.length) * 100
        ) / 100;
      row.push(overall);
    } else {
      row.push("—");
    }
    row.push("");
    legerAoa.push(row);
  });

  // Blok Tanda Tangan
  legerAoa.push([]);
  legerAoa.push([]);
  legerAoa.push(["", "Mengetahui,", "", "", "", "", "", `Mojokerto, ${signDate}`]);
  legerAoa.push([
    "",
    "Kepala Sekolah / Waka Kurikulum",
    "",
    "",
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
    "",
    "",
    `( ${homeroom?.teacherName || "................................................."} )`,
  ]);

  const wsLeger = XLSX.utils.aoa_to_sheet(legerAoa);
  const colsLeger: Array<{ wch: number }> = [
    { wch: 5 },
    { wch: 22 },
    { wch: 30 },
    { wch: 6 },
  ];
  subjectsList.forEach(() => colsLeger.push({ wch: 16 }));
  colsLeger.push({ wch: 16 }, { wch: 10 });
  wsLeger["!cols"] = colsLeger;
  XLSX.utils.book_append_sheet(wb, wsLeger, "LEGER KELAS");

  // --- SHEET 2 dst: REKAP DETAIL PER MATA PELAJARAN ---
  const filteredSubjects = subjectQuery && subjectQuery.toUpperCase() !== "SEMUA"
    ? subjectsList.filter((s) => {
        const sc = subjectQuery.toLowerCase();
        return s.name.toLowerCase().includes(sc) || Boolean(s.code && s.code.toLowerCase().includes(sc));
      })
    : subjectsList.slice(0, 15); // Batasi maks 15 sheet detail mapel

  for (const subj of filteredSubjects) {
    const subjAoa: (string | number)[][] = [
      ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
      ["DAFTAR REKAPITULASI NILAI AKADEMIK MATA PELAJARAN (PEMBERKASAN FISIK)"],
      [],
      ["Kelas / Rombel", `Kelas ${targetClass.name}`, "", "Tanggal Cetak", nowStr],
      ["Mata Pelajaran", `${subj.name} (${subj.code})`, "", "Wali Kelas", homeroom?.teacherName || "—"],
      ["Filter Status", statusLabelFilter, "", "Dicetak Oleh", printedBy],
      [],
      [
        "No",
        "NISN / NIS",
        "Nama Lengkap Siswa",
        "L/P",
        ...compCodes.map((c) => c.toUpperCase()),
        "Nilai Rata-rata",
        "Status Nilai",
        "Paraf",
      ],
    ];

    roster.forEach((stu, idx) => {
      const g = gradeMap.get(`${stu.id}|${subj.id}`);
      const row: (string | number)[] = [
        idx + 1,
        stu.nisn ? `${stu.nisn} / ${stu.nis || "—"}` : stu.nis || "—",
        stu.name,
        stu.gender?.toUpperCase().startsWith("P") ? "P" : "L",
      ];

      for (const code of compCodes) {
        const v = parseScore(g?.[code]);
        row.push(v !== null ? v : "—");
      }

      const avg = computeStudentSubjectAvg(g);
      row.push(avg !== null ? avg : "—");
      row.push(g?.status ? (g.status === "approved" ? "Disetujui" : g.status === "submitted" ? "Terkirim" : "Draft") : "Belum Diisi");
      row.push("");
      subjAoa.push(row);
    });

    subjAoa.push([]);
    subjAoa.push([]);
    subjAoa.push(["", "Mengetahui,", "", "", "", "", "", `Mojokerto, ${signDate}`]);
    subjAoa.push(["", "Kepala Sekolah / Waka Kurikulum", "", "", "", "", "", "Guru Mata Pelajaran"]);
    subjAoa.push([]);
    subjAoa.push([]);
    subjAoa.push(["", "( ................................................. )", "", "", "", "", "", "( ................................................. )"]);

    const wsSubj = XLSX.utils.aoa_to_sheet(subjAoa);
    wsSubj["!cols"] = [
      { wch: 5 },
      { wch: 22 },
      { wch: 30 },
      { wch: 6 },
      ...compCodes.map(() => ({ wch: 10 })),
      { wch: 14 },
      { wch: 16 },
      { wch: 10 },
    ];
    XLSX.utils.book_append_sheet(wb, wsSubj, sanitizeSheetName(subj.code || subj.name));
  }

  // 8. Upload ke Local Server atau Cloud Object Storage
  const dateStr = new Date().toISOString().slice(0, 10);
  const cleanClassName = targetClass.name.replace(/\s+/g, "-");
  const fileName = `Leger_Nilai_Kelas_${cleanClassName}_${dateStr}.xlsx`;

  const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const uploadRes = await uploadFile({
    buffer: excelBuffer,
    filename: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    folder: "exports",
  });

  return {
    success: true,
    exportType: "leger_nilai",
    fileName,
    url: uploadRes.url,
    cloudUrl: uploadRes.cloudUrl,
    provider: uploadRes.provider,
    storageKey: uploadRes.key,
    size: uploadRes.size,
    scopeDescription: `Kelas: ${targetClass.name}, Total Siswa: ${roster.length}, Total Mapel: ${subjectsList.length}`,
    studentCount: roster.length,
    subjectCount: subjectsList.length,
  };
}

// ============================================================================
// 3. TEMPLATE RESMI INPUT NILAI GURU (.XLSX)
// ============================================================================
export async function exportGradeTemplateExcel(params: {
  user: { id: string; name: string };
  classQuery: string;
  subjectQuery: string;
}): Promise<ExportReportResult> {
  const { user, classQuery, subjectQuery } = params;

  // 1. Temukan kelas
  const allClasses = await db.select().from(classes).where(eq(classes.isActive, true));
  const qClean = classQuery.toLowerCase().replace(/kelas\s*/i, "").trim();
  const targetClass = allClasses.find(
    (c) =>
      c.name.toLowerCase() === qClean ||
      c.name.toLowerCase().includes(qClean) ||
      qClean.includes(c.name.toLowerCase())
  );
  if (!targetClass) {
    throw new Error(`Kelas "${classQuery}" tidak ditemukan.`);
  }

  // 2. Temukan mapel
  const allSubj = await db.select().from(subjects).where(eq(subjects.isActive, true));
  const sClean = subjectQuery.toLowerCase().trim();
  const targetSubj = allSubj.find(
    (s) =>
      s.name.toLowerCase() === sClean ||
      s.name.toLowerCase().includes(sClean) ||
      Boolean(s.code && s.code.toLowerCase() === sClean)
  );
  if (!targetSubj) {
    throw new Error(`Mata pelajaran "${subjectQuery}" tidak ditemukan.`);
  }

  // 3. Ambil siswa di kelas
  const roster = await db
    .select({
      id: students.id,
      name: students.name,
      nis: students.nis,
      nisn: students.nisn,
    })
    .from(students)
    .where(and(eq(students.classId, targetClass.id), eq(students.memberStatus, "siswa")))
    .orderBy(students.name);

  // 4. Ambil komponen penilaian
  const componentsList = await db
    .select({
      id: assessmentComponents.id,
      code: assessmentComponents.code,
      name: assessmentComponents.name,
      type: assessmentComponents.type,
      status: assessmentComponents.status,
      sortOrder: assessmentComponents.sortOrder,
    })
    .from(assessmentComponents)
    .where(eq(assessmentComponents.status, "active"))
    .orderBy(asc(assessmentComponents.sortOrder));

  const compCodes = (
    componentsList.length > 0
      ? componentsList.map((c) => c.code.toLowerCase())
      : ["uh1", "t1", "sts", "uh2", "t2"]
  ) as Array<"uh1" | "t1" | "sts" | "uh2" | "t2">;

  // 5. Ambil nilai eksisting
  const existingGrades = await db
    .select()
    .from(grades)
    .where(and(eq(grades.classId, targetClass.id), eq(grades.subjectId, targetSubj.id)));

  const gradeMap = new Map<string, (typeof existingGrades)[0]>();
  for (const g of existingGrades) {
    gradeMap.set(g.studentId, g);
  }

  // 6. Bangun template
  const wb = XLSX.utils.book_new();
  const now = new Date();
  const dateFormatted = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const rawToken = `${user.id}|${targetClass.id}|${targetSubj.id}|${now.getTime()}`;
  const securityToken = Buffer.from(rawToken).toString("base64");

  const tableHeaders = [
    "UUID Siswa",
    "No",
    "NISN / NIS",
    "Nama Lengkap Siswa",
    ...compCodes.map((c) => `${c.toUpperCase()} (0-100)`),
    "Catatan",
  ];

  const aoa: (string | number)[][] = [
    ["TEMPLATE INPUT NILAI RESMI — SIMAK SMAN 3 MOJOKERTO"],
    ["PERINGATAN: JANGAN UBAH SUSUNAN KOLOM, NAMA SISWA, ATAU BARIS KUNCI KEAMANAN DI BAWAH INI."],
    [],
    ["Kunci Keamanan Sistem", securityToken],
    ["Mata Pelajaran", `${targetSubj.name} (${targetSubj.code})`, "", "Guru Pengampu", user.name],
    ["Kelas / Rombel", targetClass.name, "", "Tanggal Ekspor", dateFormatted],
    [],
    tableHeaders,
  ];

  roster.forEach((stu, idx) => {
    const g = gradeMap.get(stu.id);
    const row: (string | number)[] = [
      stu.id,
      idx + 1,
      stu.nisn ? `${stu.nisn} / ${stu.nis || "—"}` : stu.nis || "—",
      stu.name,
    ];

    for (const code of compCodes) {
      const v = parseScore(g?.[code]);
      row.push(v !== null ? v : "");
    }
    row.push("");
    aoa.push(row);
  });

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [
    { wch: 0.1 }, // Sembunyikan kolom UUID
    { wch: 5 },
    { wch: 22 },
    { wch: 32 },
    ...compCodes.map(() => ({ wch: 15 })),
    { wch: 24 },
  ];

  XLSX.utils.book_append_sheet(wb, ws, "Input_Nilai");

  const cleanName = (str: string) => str.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20);
  const timeStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const fileName = `Template_Nilai_${cleanName(targetClass.name)}_${cleanName(targetSubj.name)}_${cleanName(user.name)}_${timeStr}.xlsx`;

  const excelBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const uploadRes = await uploadFile({
    buffer: excelBuffer,
    filename: fileName,
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    folder: "exports",
  });

  return {
    success: true,
    exportType: "template_nilai",
    fileName,
    url: uploadRes.url,
    cloudUrl: uploadRes.cloudUrl,
    provider: uploadRes.provider,
    storageKey: uploadRes.key,
    size: uploadRes.size,
    scopeDescription: `Kelas: ${targetClass.name}, Mapel: ${targetSubj.name}, Total Siswa: ${roster.length}`,
    studentCount: roster.length,
  };
}
