import * as XLSX from "xlsx";

export type ExportTeachingHour = {
  id: string;
  label: string;
  startTime: string;
  endTime: string;
};

export type ExportJournalRecord = {
  id: string;
  date: string;
  classId: string;
  className: string;
  teachingHourId: string;
  teachingHourLabel: string;
  subjectId: string;
  subjectName: string;
  materi: string;
  presenceInfo: string;
  status: "draft" | "sent";
  teacherUserId: string;
  teacherName: string | null;
};

export type ExportJournalParams = {
  startDate: string;
  endDate: string;
  presetLabel: string;
  selectedClass?: { id: string; name: string } | null;
  selectedTeacher?: { id: string; name: string } | null;
  allClasses: Array<{ id: string; name: string }>;
  hours: ExportTeachingHour[];
  journals: ExportJournalRecord[];
  includeEmptySlots: boolean;
  printedBy: string;
};

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

/**
 * Menghasilkan file Excel (.xlsx) Rekapitulasi Pemberkasan Fisik Monitoring Jurnal Mengajar Guru
 */
export function downloadJournalRecapExcel(params: ExportJournalParams): { fileName: string; totalRows: number } {
  const {
    startDate,
    endDate,
    presetLabel,
    selectedClass,
    selectedTeacher,
    allClasses,
    hours,
    journals,
    includeEmptySlots,
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

  const periodText =
    startDate === endDate
      ? `${formatIndoDate(startDate)} (${presetLabel})`
      : `${formatIndoDate(startDate)} s/d ${formatIndoDate(endDate)} (${presetLabel})`;

  const dateList = getDateListBetween(startDate, endDate, startDate !== endDate);
  const hourMap = new Map(hours.map((h) => [h.id, h]));

  let totalExportedRows = 0;

  // Helper membangun 1 sheet rekapitulasi
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
    const filledCount = rowsData.filter((r) => r.statusLabel !== "Belum Isi").length;
    const sentCount = rowsData.filter((r) => r.statusLabel === "Terkirim").length;
    const draftCount = rowsData.filter((r) => r.statusLabel === "Draft").length;
    const emptyCount = rowsData.filter((r) => r.statusLabel === "Belum Isi").length;

    const aoa: (string | number)[][] = [
      ["SISTEM INFORMASI AKADEMIK (SIMAK) — SMAN 3 MOJOKERTO"],
      ["REKAPITULASI PEMBERKASAN FISIK MONITORING JURNAL MENGAJAR GURU"],
      [],
      ["Filter / Cakupan", subTitleFilter, "", "Tanggal Cetak", nowStr],
      ["Periode Rekap", periodText, "", "Dicetak Oleh", printedBy],
      [
        "Ringkasan KBM",
        `Total Baris: ${rowsData.length} | Terisi: ${filledCount} (Terkirim: ${sentCount}, Draft: ${draftCount}) | Kosong: ${emptyCount}`,
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

    // Spasi & Blok Tanda Tangan Pemberkasan Fisik
    aoa.push([]);
    aoa.push([]);
    const signDate = new Date().toLocaleDateString("id-ID", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
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

    // Pengaturan lebar kolom agar siap print A4 Landscape
    ws["!cols"] = [
      { wch: 5 },  // No
      { wch: 24 }, // Hari, Tanggal
      { wch: 10 }, // Jam Ke
      { wch: 14 }, // Waktu KBM
      { wch: 14 }, // Kelas
      { wch: 26 }, // Guru Pengajar
      { wch: 22 }, // Mata Pelajaran
      { wch: 42 }, // Materi Pembelajaran
      { wch: 28 }, // Ket. Presensi
      { wch: 14 }, // Status
      { wch: 10 }, // Paraf
    ];

    // Merge judul kop di baris atas
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 10 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 10 } },
      { s: { r: 5, c: 1 }, e: { r: 5, c: 10 } },
    ];

    XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetTitle));
    totalExportedRows += rowsData.length;
  };

  // KASUS 1: Filter Spesifik Kelas (atau Semua Kelas dengan slot jam lengkap per kelas)
  if (selectedClass) {
    const classJournals = journals.filter(
      (j) =>
        j.classId === selectedClass.id ||
        (j.className || "").trim().toLowerCase() === selectedClass.name.trim().toLowerCase()
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
            className: selectedClass.name,
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
        const h = hourMap.get(j.teachingHourId);
        rowsData.push({
          date: j.date,
          hourLabel: `Jam ${j.teachingHourLabel || h?.label || "-"}`,
          timeRange: h ? `${h.startTime} - ${h.endTime}` : "—",
          className: j.className || selectedClass.name,
          teacherName: j.teacherName ?? "—",
          subjectName: j.subjectName ?? "—",
          materi: j.materi ?? "—",
          presenceInfo: j.presenceInfo ?? "—",
          statusLabel: j.status === "sent" ? "Terkirim" : "Draft",
        });
      }
    }

    const filterDesc = selectedTeacher
      ? `Kelas ${selectedClass.name} · Guru: ${selectedTeacher.name}`
      : `Kelas ${selectedClass.name} (Semua Guru)`;

    buildSheet(`Kelas ${selectedClass.name}`, filterDesc, rowsData);
  } else if (selectedTeacher) {
    // KASUS 2: Filter Spesifik Guru (Semua Kelas yang diajar guru tsb)
    const rowsData: Parameters<typeof buildSheet>[2] = journals.map((j) => {
      const h = hourMap.get(j.teachingHourId);
      return {
        date: j.date,
        hourLabel: `Jam ${j.teachingHourLabel || h?.label || "-"}`,
        timeRange: h ? `${h.startTime} - ${h.endTime}` : "—",
        className: j.className || "—",
        teacherName: j.teacherName || selectedTeacher.name,
        subjectName: j.subjectName || "—",
        materi: j.materi || "—",
        presenceInfo: j.presenceInfo || "—",
        statusLabel: j.status === "sent" ? "Terkirim" : "Draft",
      };
    });

    buildSheet(
      `Jurnal - ${selectedTeacher.name}`,
      `Guru Pengajar: ${selectedTeacher.name} (Semua Kelas)`,
      rowsData
    );
  } else {
    // KASUS 3: Semua Kelas & Semua Guru -> Buat Sheet Gabungan + Sheet Per Kelas (jika ada jurnal/opsi)
    const masterRows: Parameters<typeof buildSheet>[2] = journals.map((j) => {
      const h = hourMap.get(j.teachingHourId);
      return {
        date: j.date,
        hourLabel: `Jam ${j.teachingHourLabel || h?.label || "-"}`,
        timeRange: h ? `${h.startTime} - ${h.endTime}` : "—",
        className: j.className || "—",
        teacherName: j.teacherName || "—",
        subjectName: j.subjectName || "—",
        materi: j.materi || "—",
        presenceInfo: j.presenceInfo || "—",
        statusLabel: j.status === "sent" ? "Terkirim" : "Draft",
      };
    });

    buildSheet("Rekap Semua Jurnal", "Seluruh Kelas & Guru Pengajar", masterRows);

    // Jika dicentang sertakan slot kosong per kelas dan rentang <= 7 hari, buat per sheet kelas
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

  const scopeSlug = selectedClass
    ? `Kelas_${selectedClass.name.replace(/\s+/g, "-")}`
    : selectedTeacher
    ? `Guru_${selectedTeacher.name.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 20)}`
    : "Semua_Kelas";

  const dateSlug = startDate === endDate ? startDate : `${startDate}_sd_${endDate}`;
  const fileName = `Rekap_Jurnal_Mengajar_${scopeSlug}_${dateSlug}.xlsx`;

  XLSX.writeFile(wb, fileName);
  return { fileName, totalRows: totalExportedRows };
}
