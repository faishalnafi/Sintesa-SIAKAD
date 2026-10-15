import { Hono } from "hono";
import { and, asc, eq, isNull } from "drizzle-orm";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { env } from "../../env.js";
import { db } from "../../db/index.js";
import {
  assessmentComponents,
  classes,
  grades,
  homeroomAssignments,
  students,
  subjects,
  teachers,
  users,
} from "../../db/schema/index.js";
import { requireAuth, type AuthVariables } from "../../middlewares/auth.js";
import { requireRoles } from "../../middlewares/rbac.js";
import { getActiveAcademicYear } from "../../services/academic-lifecycle.js";

export const studentRoutes = new Hono<{ Variables: AuthVariables }>();

studentRoutes.use("*", requireAuth, requireRoles("siswa", "ortu", "admin", "superadmin"));

async function resolveStudent(userId: string, roles: string[]) {
  if (roles.includes("admin") || roles.includes("superadmin")) {
    const [s] = await db.select().from(students).limit(1);
    return s ?? null;
  }
  const [s] = await db.select().from(students).where(eq(students.userId, userId)).limit(1);
  return s ?? null;
}

function filterRelevantReligionGrades<T extends { subjectName: string; uh1?: any; t1?: any; sts?: any; uh2?: any; t2?: any }>(
  gradesList: T[],
): T[] {
  const religionRows = gradesList.filter((g) => /agama/i.test(g.subjectName));
  if (religionRows.length <= 1) {
    return gradesList;
  }

  const hasRealScore = (g: T) =>
    [g.uh1, g.t1, g.sts, g.uh2, g.t2].some((v: any) => v !== null && v !== undefined && Number(v) > 0);

  const nonMuslimRows = religionRows.filter((g) => /kristen|katolik|katholik|hindu|buddha|khonghucu/i.test(g.subjectName));
  const muslimRows = religionRows.filter((g) => /islam|budi pekerti/i.test(g.subjectName));

  const validNonMuslim = nonMuslimRows.find(hasRealScore);
  const muslimHasScore = muslimRows.some(hasRealScore);

  // Jika siswa terisi nilai agama selain muslim dan tervalidasi tidak terisi di agama islam -> non-muslim
  // Selain itu (mayoritas / jika islam terisi) -> islam
  let chosenReligion: T | undefined;
  if (validNonMuslim && !muslimHasScore) {
    chosenReligion = validNonMuslim;
  } else if (muslimRows.length > 0) {
    chosenReligion = muslimRows[0];
  } else {
    chosenReligion = religionRows[0];
  }

  return gradesList.filter((g) => !/agama/i.test(g.subjectName) || g === chosenReligion);
}

function formatWibDateTime(date: Date | string | null | undefined): string {
  if (!date) return "-";
  const d = typeof date === "string" ? new Date(date) : date;
  if (isNaN(d.getTime())) return "-";
  const datePart = d.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const timePart = d.toLocaleTimeString("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: "Asia/Jakarta",
  }).replace(/\./g, ":");
  return `${datePart} ${timePart} WIB`;
}

async function checkStudentApprovalStatus(
  studentId: string,
  student: { isGdsSubmitted: boolean; isKehadiranSubmitted: boolean },
) {
  let studentGrades = await db
    .select({
      id: grades.id,
      status: grades.status,
      subjectName: subjects.name,
      approvedAt: grades.approvedAt,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
    })
    .from(grades)
    .innerJoin(subjects, eq(grades.subjectId, subjects.id))
    .where(and(eq(grades.studentId, studentId), isNull(grades.deletedAt)));

  studentGrades = filterRelevantReligionGrades(studentGrades);

  const hasGrades = studentGrades.length > 0;
  const draftCount = studentGrades.filter((g) => g.status === "draft").length;
  const submittedCount = studentGrades.filter((g) => g.status === "submitted").length;
  const allGradesApproved = hasGrades && studentGrades.every((g) => g.status === "approved");

  const isGdsApproved = Boolean(student.isGdsSubmitted);
  const isKehadiranApproved = Boolean(student.isKehadiranSubmitted);

  const isFullyApproved = allGradesApproved && isGdsApproved && isKehadiranApproved;

  const pendingReasons: string[] = [];
  if (!allGradesApproved) {
    if (!hasGrades) {
      pendingReasons.push("nilai mata pelajaran (belum ada nilai)");
    } else if (draftCount > 0) {
      pendingReasons.push(`nilai mata pelajaran (${draftCount} mapel masih draft)`);
    } else if (submittedCount > 0) {
      pendingReasons.push(`nilai mata pelajaran (${submittedCount} mapel menunggu persetujuan wali kelas)`);
    } else {
      pendingReasons.push("nilai mata pelajaran belum disetujui wali kelas");
    }
  }
  if (!isKehadiranApproved) {
    pendingReasons.push("kehadiran BK (belum diserahkan)");
  }
  if (!isGdsApproved) {
    pendingReasons.push("kedisiplinan GDS (belum diserahkan)");
  }

  const pendingMessage = !isFullyApproved
    ? `Menunggu persetujuan lengkap dari Wali Kelas (${pendingReasons.join(", ")}).`
    : null;

  let latestApprovedAt: Date | null = null;
  for (const g of studentGrades) {
    if (g.approvedAt && (!latestApprovedAt || new Date(g.approvedAt) > latestApprovedAt)) {
      latestApprovedAt = new Date(g.approvedAt);
    }
  }

  return {
    isFullyApproved,
    allGradesApproved,
    isGdsApproved,
    isKehadiranApproved,
    pendingMessage,
    latestApprovedAt,
    studentGrades,
  };
}

studentRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const student = await resolveStudent(user.id, user.roles);
  if (!student) {
    return c.json({ success: false, message: "Profil siswa tidak ditemukan" }, 404);
  }

  const [klass] = student.classId
    ? await db.select().from(classes).where(eq(classes.id, student.classId)).limit(1)
    : [null];

  let gradeRows = await db
    .select({
      subjectName: subjects.name,
      status: grades.status,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
    })
    .from(grades)
    .innerJoin(subjects, eq(grades.subjectId, subjects.id))
    .where(
      and(
        eq(grades.studentId, student.id),
        isNull(grades.deletedAt),
        user.roles.includes("siswa") || user.roles.includes("ortu")
          ? eq(grades.status, "approved")
          : eq(grades.studentId, student.id),
      ),
    );

  gradeRows = filterRelevantReligionGrades(gradeRows);

  return c.json({
    success: true,
    data: {
      student: {
        id: student.id,
        name: student.name,
        nisn: student.nisn || student.nis,
        nis: student.nis,
        className: klass?.name ?? null,
        poinGds: student.poinGds,
        sakit: student.sakit,
        izin: student.izin,
        alpa: student.alpa,
        catatanGds: student.catatanGds ?? null,
        catatanKehadiran: student.catatanKehadiran ?? null,
      },
      grades: gradeRows,
    },
  });
});

studentRoutes.get("/report", async (c) => {
  const user = c.get("user");
  const student = await resolveStudent(user.id, user.roles);
  if (!student) {
    return c.json({ success: false, message: "Profil siswa tidak ditemukan" }, 404);
  }

  const [klass] = student.classId
    ? await db.select().from(classes).where(eq(classes.id, student.classId)).limit(1)
    : [null];

  let rows = await db
    .select({
      subjectName: subjects.name,
      subjectCode: subjects.code,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
      status: grades.status,
      approvedAt: grades.approvedAt,
    })
    .from(grades)
    .innerJoin(subjects, eq(grades.subjectId, subjects.id))
    .where(
      and(
        eq(grades.studentId, student.id),
        isNull(grades.deletedAt),
        user.roles.includes("siswa") || user.roles.includes("ortu")
          ? eq(grades.status, "approved")
          : eq(grades.studentId, student.id),
      ),
    );

  rows = filterRelevantReligionGrades(rows);

  const approvalStatus = await checkStudentApprovalStatus(student.id, student);

  return c.json({
    success: true,
    data: {
      student: {
        name: student.name,
        nisn: student.nisn || student.nis,
        nis: student.nis,
        className: klass?.name ?? null,
        poinGds: student.poinGds,
        sakit: student.sakit,
        izin: student.izin,
        alpa: student.alpa,
        catatanGds: student.catatanGds ?? null,
        catatanKehadiran: student.catatanKehadiran ?? null,
      },
      grades: rows,
      canDownloadPdf: approvalStatus.isFullyApproved,
      isApproved: approvalStatus.isFullyApproved,
      pendingReason: approvalStatus.pendingMessage,
      approvalDetails: {
        allGradesApproved: approvalStatus.allGradesApproved,
        isGdsApproved: approvalStatus.isGdsApproved,
        isKehadiranApproved: approvalStatus.isKehadiranApproved,
      },
    },
  });
});

/** KKM berdasarkan tingkat kelas — sinkron dengan logika di frontend (SiswaRaportPage). */
function getKkm(className: string | null | undefined): number {
  if (!className) return 80;
  const upper = className.toUpperCase();
  if (/\bXII\b|12/.test(upper)) return 82;
  if (/\bXI\b|11/.test(upper)) return 81;
  if (/\bX\b|10/.test(upper)) return 80;
  return 80;
}

studentRoutes.get("/report/pdf", async (c) => {
  const user = c.get("user");
  const student = await resolveStudent(user.id, user.roles);
  if (!student) {
    return c.json({ success: false, message: "Profil siswa tidak ditemukan" }, 404);
  }

  const approvalStatus = await checkStudentApprovalStatus(student.id, student);
  if (!approvalStatus.isFullyApproved) {
    return c.json(
      {
        success: false,
        message: `Raport belum dapat diunduh. ${approvalStatus.pendingMessage}`,
      },
      403,
    );
  }

  const [klass] = student.classId
    ? await db.select().from(classes).where(eq(classes.id, student.classId)).limit(1)
    : [null];

  let waliKelasName = "..................................................";
  let waliKelasNip = "";

  if (student.classId) {
    const [hw] = await db
      .select({
        teacherName: teachers.name,
        teacherNip: teachers.nip,
        userName: users.name,
      })
      .from(homeroomAssignments)
      .leftJoin(users, eq(homeroomAssignments.userId, users.id))
      .leftJoin(teachers, eq(users.id, teachers.userId))
      .where(eq(homeroomAssignments.classId, student.classId))
      .limit(1);

    if (hw) {
      waliKelasName = hw.teacherName || hw.userName || waliKelasName;
      waliKelasNip = hw.teacherNip ? `NIP. ${hw.teacherNip}` : "";
    } else if (klass?.homeroomTeacherId) {
      const [t] = await db
        .select({ name: teachers.name, nip: teachers.nip })
        .from(teachers)
        .where(eq(teachers.id, klass.homeroomTeacherId))
        .limit(1);
      if (t) {
        waliKelasName = t.name;
        waliKelasNip = t.nip ? `NIP. ${t.nip}` : "";
      }
    }
  }

  let rows = await db
    .select({
      subjectName: subjects.name,
      uh1: grades.uh1,
      t1: grades.t1,
      sts: grades.sts,
      uh2: grades.uh2,
      t2: grades.t2,
    })
    .from(grades)
    .innerJoin(subjects, eq(grades.subjectId, subjects.id))
    .where(
      and(
        eq(grades.studentId, student.id),
        isNull(grades.deletedAt),
        eq(grades.status, "approved"),
      ),
    )
    .orderBy(subjects.name);

  rows = filterRelevantReligionGrades(rows);

  const activeYear = await getActiveAcademicYear();
  const tahunAjaran = activeYear?.name ?? "tahun-ajaran";
  const kkm = getKkm(klass?.name);

  // Ambil komponen penilaian yang aktif dari database agar persis seperti tampilan web
  let allComponents = await db
    .select()
    .from(assessmentComponents)
    .orderBy(asc(assessmentComponents.sortOrder), asc(assessmentComponents.createdAt));

  if (allComponents.length === 0) {
    allComponents = [
      { id: "1", code: "uh1", name: "UH1", type: "UJIAN", status: "active", sortOrder: 1 } as any,
      { id: "2", code: "t1", name: "T1", type: "TUGAS", status: "active", sortOrder: 2 } as any,
      { id: "3", code: "sts", name: "STS", type: "UJIAN", status: "active", sortOrder: 3 } as any,
      { id: "4", code: "uh2", name: "UH2", type: "UJIAN", status: "disabled", sortOrder: 4 } as any,
      { id: "5", code: "t2", name: "T2", type: "TUGAS", status: "disabled", sortOrder: 5 } as any,
    ];
  }

  const visibleComponents = allComponents.filter((c) => c.status !== "inactive");

  const columns = visibleComponents.map((c) => ({
    key: c.code.toLowerCase() as "uh1" | "t1" | "sts" | "uh2" | "t2",
    label: c.name || c.code.toUpperCase(),
    status: c.status as "active" | "disabled" | "inactive",
  }));

  const publicUuid = student.userId || student.id;
  const publicProfileUrl = `${env.FRONTEND_URL}/u/${publicUuid}`;
  const qrBuffer = await QRCode.toBuffer(publicProfileUrl, {
    width: 140,
    margin: 1,
    color: { dark: "#0f172a", light: "#ffffff" },
  });

  const doc = new PDFDocument({ size: "A4", margin: 50, font: "Times-Roman", bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const pdfDone = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  doc.font("Times-Bold").fontSize(16).text("RAPORT & STATUS KETUNTASAN NILAI", { align: "center" });
  doc.moveDown(0.3);
  doc.font("Times-Roman").fontSize(12).text("SIAKAD - SMAN 3 Mojokerto", { align: "center" });
  doc.moveDown(1.2);

  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.font("Times-Roman").fontSize(11);
  const infoStartY = doc.y;
  const colHalfWidth = (pageWidth - 20) / 2;
  const labelColWidth = 85;

  // Kolom 1 (Kiri): Nama Lengkap & NISN
  const leftX = 50;
  doc.text("Nama Lengkap", leftX, infoStartY, { width: labelColWidth });
  doc.text(`: ${student.name ?? "-"}`, leftX + labelColWidth, infoStartY, { width: colHalfWidth - labelColWidth });
  doc.text("NISN", leftX, infoStartY + 18, { width: labelColWidth });
  doc.text(`: ${student.nisn || student.nis || "-"}`, leftX + labelColWidth, infoStartY + 18, { width: colHalfWidth - labelColWidth });

  // Kolom 2 (Kanan, Berjajar): Kelas & Tahun Ajaran
  const rightX = 50 + colHalfWidth + 20;
  doc.text("Kelas", rightX, infoStartY, { width: labelColWidth });
  doc.text(`: ${klass?.name ?? "-"}`, rightX + labelColWidth, infoStartY, { width: colHalfWidth - labelColWidth });
  doc.text("Tahun Ajaran", rightX, infoStartY + 18, { width: labelColWidth });
  doc.text(`: ${tahunAjaran}`, rightX + labelColWidth, infoStartY + 18, { width: colHalfWidth - labelColWidth });

  doc.y = infoStartY + 36 + 12;
  doc.x = 50;

  const tableTop = doc.y;
  const subjectColWidth = pageWidth * 0.42;
  const scoreColWidth = (pageWidth - subjectColWidth) / (columns.length || 1);
  const rowHeight = 22;

  // Helper untuk menggambar indikator status (✓, ✗, –) secara tajam dan konsisten di semua PDF reader
  const drawStatusIndicator = (
    pdfDoc: typeof doc,
    cx: number,
    cy: number,
    type: "tuntas" | "tidak_tuntas" | "segera_hadir",
  ) => {
    pdfDoc.save();
    if (type === "tuntas") {
      // Background lingkaran hijau muda
      pdfDoc.circle(cx, cy, 7.5).fillColor("#e6f4ea").fill();
      // Ikon checklist ✓
      pdfDoc.lineWidth(1.8).strokeColor("#0a7a3a").lineCap("round").lineJoin("round");
      pdfDoc.moveTo(cx - 3.8, cy + 0.2).lineTo(cx - 1, cy + 3.2).lineTo(cx + 3.8, cy - 2.8).stroke();
    } else if (type === "tidak_tuntas") {
      // Background lingkaran merah muda
      pdfDoc.circle(cx, cy, 7.5).fillColor("#fce8e6").fill();
      // Ikon silang ✗
      pdfDoc.lineWidth(1.8).strokeColor("#c0392b").lineCap("round");
      pdfDoc.moveTo(cx - 3, cy - 3).lineTo(cx + 3, cy + 3).stroke();
      pdfDoc.moveTo(cx - 3, cy + 3).lineTo(cx + 3, cy - 3).stroke();
    } else {
      // Background lingkaran amber muda
      pdfDoc.circle(cx, cy, 7.5).fillColor("#fef3c7").fill();
      // Ikon strip –
      pdfDoc.lineWidth(1.8).strokeColor("#d97706").lineCap("round");
      pdfDoc.moveTo(cx - 3.5, cy).lineTo(cx + 3.5, cy).stroke();
    }
    pdfDoc.restore();
  };

  const drawHeaderRow = (yPos: number) => {
    doc.font("Times-Bold").fontSize(11);
    doc.rect(50, yPos, pageWidth, rowHeight).fillAndStroke("#f3f4f6", "#d1d5db");
    doc.fillColor("#111827").text("Mata Pelajaran", 55, yPos + 6, { width: subjectColWidth - 10 });
    columns.forEach((col, i) => {
      const x = 50 + subjectColWidth + i * scoreColWidth;
      doc.text(col.label, x, yPos + 6, { width: scoreColWidth, align: "center" });
    });
    let lineX = 50 + subjectColWidth;
    doc.strokeColor("#d1d5db");
    doc.moveTo(50, yPos).lineTo(50, yPos + rowHeight).stroke();
    doc.moveTo(lineX, yPos).lineTo(lineX, yPos + rowHeight).stroke();
    columns.forEach(() => {
      lineX += scoreColWidth;
      doc.moveTo(lineX, yPos).lineTo(lineX, yPos + rowHeight).stroke();
    });
  };

  drawHeaderRow(tableTop);
  let y = tableTop + rowHeight;

  doc.font("Times-Roman").fontSize(11);
  if (rows.length === 0) {
    doc.rect(50, y, pageWidth, rowHeight).strokeColor("#d1d5db").stroke();
    doc.fillColor("black").text("Belum ada raport approved.", 55, y + 6, { width: pageWidth - 10 });
    y += rowHeight;
  } else {
    for (const g of rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom - 120) {
        doc.addPage({ size: "A4", margin: 50 });
        y = doc.page.margins.top;
        drawHeaderRow(y);
        y += rowHeight;
        doc.font("Times-Roman").fontSize(11);
      }

      doc.rect(50, y, pageWidth, rowHeight).strokeColor("#e5e7eb").stroke();
      doc.fillColor("#1f2937").text(g.subjectName, 55, y + 6, { width: subjectColWidth - 10 });

      columns.forEach((col, i) => {
        const x = 50 + subjectColWidth + i * scoreColWidth;
        const cx = x + scoreColWidth / 2;
        const cy = y + rowHeight / 2;

        let indicatorType: "tuntas" | "tidak_tuntas" | "segera_hadir" = "segera_hadir";
        if (col.status === "disabled") {
          indicatorType = "segera_hadir";
        } else {
          const raw = (g as any)[col.key];
          if (raw === null || raw === undefined || raw === "") {
            indicatorType = "tidak_tuntas";
          } else {
            const numeric = Number(raw);
            indicatorType = !isNaN(numeric) && numeric >= kkm ? "tuntas" : "tidak_tuntas";
          }
        }

        drawStatusIndicator(doc, cx, cy, indicatorType);
      });

      let lineX = 50 + subjectColWidth;
      doc.strokeColor("#e5e7eb");
      doc.moveTo(50, y).lineTo(50, y + rowHeight).stroke();
      doc.moveTo(lineX, y).lineTo(lineX, y + rowHeight).stroke();
      columns.forEach(() => {
        lineX += scoreColWidth;
        doc.moveTo(lineX, y).lineTo(lineX, y + rowHeight).stroke();
      });

      y += rowHeight;
    }
  }

  // --- Rekap Presensi & Gerakan Disiplin Siswa (GDS) ---
  const catatanParts: string[] = [];
  if (student.catatanKehadiran && student.catatanKehadiran.trim()) {
    catatanParts.push(`Kehadiran: ${student.catatanKehadiran.trim()}`);
  }
  if (student.catatanGds && student.catatanGds.trim()) {
    catatanParts.push(`GDS: ${student.catatanGds.trim()}`);
  }

  const presColWidth = pageWidth / 4;
  const presHeaderH = 20;
  const presValueH = 22;
  const presCatH = catatanParts.length > 0 ? 20 : 0;
  const presensiTotalH = 12 + 14 + presHeaderH + presValueH + presCatH;

  // Cek apakah sisa halaman cukup untuk tabel presensi & gds
  if (y + presensiTotalH > doc.page.height - doc.page.margins.bottom - 40) {
    doc.addPage({ size: "A4", margin: 50 });
    y = doc.page.margins.top;
  }

  y += 12;
  doc
    .fillColor("#111827")
    .font("Times-Bold")
    .fontSize(10)
    .text("Rekap Presensi & Tata Tertib (GDS):", 50, y);
  y += 14;

  // Header tabel presensi & GDS
  doc.rect(50, y, pageWidth, presHeaderH).fillAndStroke("#f3f4f6", "#d1d5db");
  doc.font("Times-Bold").fontSize(9.5).fillColor("#111827");
  const presHeaders = ["Sakit (S)", "Izin (I)", "Tanpa Keterangan (A)", "Poin GDS"];
  presHeaders.forEach((label, i) => {
    const x = 50 + i * presColWidth;
    doc.text(label, x, y + 5, { width: presColWidth, align: "center" });
    if (i > 0) {
      doc.strokeColor("#d1d5db");
      doc.moveTo(x, y).lineTo(x, y + presHeaderH).stroke();
    }
  });

  y += presHeaderH;

  // Nilai presensi & GDS
  doc.rect(50, y, pageWidth, presValueH).fillAndStroke("#ffffff", "#d1d5db");
  doc.font("Times-Bold").fontSize(10).fillColor("#1f2937");
  const presValues = [
    `${student.sakit ?? 0} Hari`,
    `${student.izin ?? 0} Hari`,
    `${student.alpa ?? 0} Hari`,
    `${student.poinGds ?? 0} Poin`,
  ];
  presValues.forEach((val, i) => {
    const x = 50 + i * presColWidth;
    doc.text(val, x, y + 6, { width: presColWidth, align: "center" });
    if (i > 0) {
      doc.strokeColor("#d1d5db");
      doc.moveTo(x, y).lineTo(x, y + presValueH).stroke();
    }
  });

  y += presValueH;

  // Baris catatan jika ada
  if (catatanParts.length > 0) {
    doc.rect(50, y, pageWidth, presCatH).fillAndStroke("#f9fafb", "#d1d5db");
    doc
      .fillColor("#374151")
      .font("Times-Italic")
      .fontSize(9)
      .text(`Catatan: ${catatanParts.join("   |   ")}`, 56, y + 5, {
        width: pageWidth - 12,
        ellipsis: true,
      });
    y += presCatH;
  }

  const now = new Date();
  const tanggalCetak = now.toLocaleDateString("id-ID", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Jakarta",
  });
  const waktuCetak = formatWibDateTime(now);
  const updaterWalas = approvalStatus.latestApprovedAt
    ? formatWibDateTime(approvalStatus.latestApprovedAt)
    : "-";
  const downloaderName = user.name || (user as any).username || student.name || "Siswa";

  // Kotak Penjelasan Legenda (✓ Tuntas, ✗ Tidak Tuntas, – Segera Hadir)
  const legendBoxH = 74;
  const signColWidth = 190;
  const signBoxWidth = 150;
  const signBoxHeight = 46;
  const signatureHeight = 104;
  const footerReserved = 58; // ruang di pojok bawah untuk QR code & info validasi
  const maxSignBottom = doc.page.height - doc.page.margins.bottom - footerReserved;

  const neededBottomHeight = 12 + legendBoxH + 16 + signatureHeight + footerReserved;
  if (y + neededBottomHeight > doc.page.height - doc.page.margins.bottom) {
    doc.addPage({ size: "A4", margin: 50 });
    y = doc.page.margins.top;
  }

  y += 12;
  const legendBoxY = y;
  doc
    .roundedRect(50, legendBoxY, pageWidth, legendBoxH, 4)
    .fillColor("#f9fafb")
    .strokeColor("#e5e7eb")
    .lineWidth(0.8)
    .fillAndStroke();

  doc
    .fillColor("#111827")
    .font("Times-Bold")
    .fontSize(10)
    .text("Keterangan Status Ketuntasan:", 62, legendBoxY + 8);

  const legendItems: Array<{ type: "tuntas" | "tidak_tuntas" | "segera_hadir"; label: string }> = [
    { type: "tuntas", label: `Tuntas (Nilai >= KKM ${kkm})` },
    { type: "tidak_tuntas", label: `Tidak Tuntas (Nilai < KKM ${kkm} atau Belum Terisi)` },
    { type: "segera_hadir", label: "Segera Hadir (Komponen Penilaian Belum Dibuka)" },
  ];

  legendItems.forEach((item, idx) => {
    const itemY = legendBoxY + 28 + idx * 14;
    drawStatusIndicator(doc, 70, itemY + 4, item.type);
    doc.fillColor("#374151").font("Times-Roman").fontSize(9.5).text(item.label, 84, itemY);
  });

  // Tanda Tangan (Kiri: Wali Murid, Kanan: Wali Kelas)
  let signY = legendBoxY + legendBoxH + 16;
  if (signY + signatureHeight > maxSignBottom) {
    doc.addPage({ size: "A4", margin: 50 });
    signY = doc.page.margins.top;
  }

  const leftSignX = 50;
  const rightSignX = 50 + pageWidth - signColWidth;

  // Kolom Kiri: Wali Murid
  doc.font("Times-Roman").fontSize(10.5).fillColor("#111827");
  doc.text("Mengetahui Wali Murid,", leftSignX, signY, { width: signColWidth, align: "center" });
  doc.font("Times-Bold").text(student.name ?? "-", leftSignX, signY + 14, { width: signColWidth, align: "center" });

  const leftBoxY = signY + 30;

  doc.font("Times-Roman").fontSize(10).fillColor("#4b5563");
  doc.text("( .................................................. )", leftSignX, leftBoxY + signBoxHeight + 8, {
    width: signColWidth,
    align: "center",
  });

  // Kolom Kanan: Wali Kelas
  doc.font("Times-Roman").fontSize(10.5).fillColor("#111827");
  doc.text(`Mojokerto, ${tanggalCetak}`, rightSignX, signY, { width: signColWidth, align: "center" });
  doc.text(`Wali Kelas ${klass?.name ?? "-"}`, rightSignX, signY + 14, { width: signColWidth, align: "center" });

  const rightBoxY = signY + 30;

  doc.font("Times-Bold").fontSize(10.5).fillColor("#111827");
  doc.text(waliKelasName, rightSignX, rightBoxY + signBoxHeight + 6, {
    width: signColWidth,
    align: "center",
  });
  if (waliKelasNip) {
    doc.font("Times-Roman").fontSize(9).fillColor("#4b5563");
    doc.text(waliKelasNip, rightSignX, rightBoxY + signBoxHeight + 19, {
      width: signColWidth,
      align: "center",
    });
  }

  // --- Render Footer & Validasi QR Code di Pojok Kanan Bawah Kertas ---
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);

    const footerQrSize = 44;
    const qrX = doc.page.width - doc.page.margins.right - footerQrSize;
    const qrY = doc.page.height - doc.page.margins.bottom - footerQrSize;

    const textWidth = 160;
    const textX = qrX - textWidth - 8;

    // Keterangan & Tujuan QR Code di pojok kanan bawah
    doc.font("Times-Bold").fontSize(8).fillColor("#111827");
    doc.text("Validasi Keaslian Data", textX, qrY + 2, { width: textWidth, align: "right" });

    doc.font("Times-Roman").fontSize(7).fillColor("#4b5563");
    doc.text(
      "Pindai QR untuk verifikasi keaslian raport & profil publik siswa.",
      textX,
      qrY + 13,
      { width: textWidth, align: "right" },
    );

    doc.font("Times-Roman").fontSize(6.5).fillColor("#9ca3af");
    doc.text(`ID: ${publicUuid}`, textX, qrY + 31, { width: textWidth, align: "right" });

    // Gambar QR Code di pojok kanan bawah
    doc.image(qrBuffer, qrX, qrY, { width: footerQrSize, height: footerQrSize });

    // Keterangan KKM, Dicetak otomatis pada SIAKAD, Diunduh oleh, dan Terakhir disetujui di pojok kiri bawah
    const pageLabel = range.count > 1 ? ` (Hal. ${i + 1}/${range.count})` : "";
    const leftFooterWidth = textX - doc.page.margins.left - 12;

    doc.font("Times-Roman").fontSize(7.5).fillColor("#4b5563");
    doc.text(
      `KKM Kelas: ${kkm} - Dicetak otomatis pada SIAKAD pada ${waktuCetak}${pageLabel}`,
      doc.page.margins.left,
      qrY + 6,
      { width: leftFooterWidth, ellipsis: true },
    );
    doc.text(
      `Diunduh oleh: ${downloaderName}`,
      doc.page.margins.left,
      qrY + 18,
      { width: leftFooterWidth, ellipsis: true },
    );
    doc.text(
      `Terakhir disetujui oleh Wali Kelas: ${updaterWalas}`,
      doc.page.margins.left,
      qrY + 30,
      { width: leftFooterWidth, ellipsis: true },
    );
  }

  doc.end();
  const buffer = await pdfDone;

  const safeTahunAjaran = tahunAjaran.replace(/[\\/]/g, "-");
  const filename = `${student.id}-${safeTahunAjaran}.pdf`;
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(new Uint8Array(buffer));
});
