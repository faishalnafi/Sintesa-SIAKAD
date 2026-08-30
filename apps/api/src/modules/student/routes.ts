import { Hono } from "hono";
import { and, eq, isNull } from "drizzle-orm";
import PDFDocument from "pdfkit";
import { db } from "../../db/index.js";
import { classes, grades, students, subjects } from "../../db/schema/index.js";
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

studentRoutes.get("/dashboard", async (c) => {
  const user = c.get("user");
  const student = await resolveStudent(user.id, user.roles);
  if (!student) {
    return c.json({ success: false, message: "Profil siswa tidak ditemukan" }, 404);
  }

  const [klass] = student.classId
    ? await db.select().from(classes).where(eq(classes.id, student.classId)).limit(1)
    : [null];

  const gradeRows = await db
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

  return c.json({
    success: true,
    data: {
      student: {
        id: student.id,
        name: student.name,
        nisn: student.nisn,
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

  const rows = await db
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

  return c.json({
    success: true,
    data: {
      student: {
        name: student.name,
        nisn: student.nisn,
        className: klass?.name ?? null,
        poinGds: student.poinGds,
        sakit: student.sakit,
        izin: student.izin,
        alpa: student.alpa,
        catatanGds: student.catatanGds ?? null,
        catatanKehadiran: student.catatanKehadiran ?? null,
      },
      grades: rows,
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

  const [klass] = student.classId
    ? await db.select().from(classes).where(eq(classes.id, student.classId)).limit(1)
    : [null];

  const rows = await db
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

  const activeYear = await getActiveAcademicYear();
  const tahunAjaran = activeYear?.name ?? "tahun-ajaran";
  const kkm = getKkm(klass?.name);

  const columns: Array<{ key: "uh1" | "t1" | "sts" | "uh2" | "t2"; label: string }> = [
    { key: "uh1", label: "UH1" },
    { key: "t1", label: "T1" },
    { key: "sts", label: "STS" },
    { key: "uh2", label: "UH2" },
    { key: "t2", label: "T2" },
  ];

  const doc = new PDFDocument({ size: "A4", margin: 50, font: "Times-Roman" });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(chunk));

  const pdfDone = new Promise<Buffer>((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });

  doc.font("Times-Bold").fontSize(16).text("RAPORT & STATUS KETUNTASAN NILAI", { align: "center" });
  doc.moveDown(0.3);
  doc.font("Times-Roman").fontSize(12).text("SIAKAD - SMAN 3 Mojokerto", { align: "center" });
  doc.moveDown(1.2);

  doc.fontSize(12);
  const infoStartY = doc.y;
  const labelWidth = 110;
  const info: Array<[string, string]> = [
    ["Nama Lengkap", student.name ?? "-"],
    ["NISN", student.nisn ?? "-"],
    ["Kelas", klass?.name ?? "-"],
    ["Tahun Ajaran", tahunAjaran],
  ];
  info.forEach(([label, value], i) => {
    const y = infoStartY + i * 18;
    doc.text(label, 50, y, { width: labelWidth, continued: false });
    doc.text(`: ${value}`, 50 + labelWidth, y);
  });
  doc.y = infoStartY + info.length * 18 + 10;
  doc.x = 50;

  const tableTop = doc.y;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const subjectColWidth = pageWidth * 0.4;
  const scoreColWidth = (pageWidth - subjectColWidth) / columns.length;
  const rowHeight = 22;

  const drawHeaderRow = (y: number) => {
    doc.font("Times-Bold").fontSize(12);
    doc.rect(50, y, pageWidth, rowHeight).stroke();
    doc.text("Mata Pelajaran", 55, y + 6, { width: subjectColWidth - 10 });
    columns.forEach((col, i) => {
      const x = 50 + subjectColWidth + i * scoreColWidth;
      doc.text(col.label, x, y + 6, { width: scoreColWidth, align: "center" });
    });
    let lineX = 50 + subjectColWidth;
    doc.moveTo(50, y).lineTo(50, y + rowHeight).stroke();
    doc.moveTo(lineX, y).lineTo(lineX, y + rowHeight).stroke();
    columns.forEach(() => {
      lineX += scoreColWidth;
      doc.moveTo(lineX, y).lineTo(lineX, y + rowHeight).stroke();
    });
  };

  drawHeaderRow(tableTop);
  let y = tableTop + rowHeight;

  doc.font("Times-Roman").fontSize(12);
  if (rows.length === 0) {
    doc.rect(50, y, pageWidth, rowHeight).stroke();
    doc.text("Belum ada raport approved.", 55, y + 6, { width: pageWidth - 10 });
    y += rowHeight;
  } else {
    for (const g of rows) {
      if (y + rowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
        y = doc.page.margins.top;
        drawHeaderRow(y);
        y += rowHeight;
        doc.font("Times-Roman").fontSize(12);
      }

      doc.rect(50, y, pageWidth, rowHeight).stroke();
      doc.fillColor("black").text(g.subjectName, 55, y + 6, { width: subjectColWidth - 10 });

      columns.forEach((col, i) => {
        const x = 50 + subjectColWidth + i * scoreColWidth;
        const raw = g[col.key];
        const numeric = raw === null || raw === undefined ? null : Number(raw);
        let label = "-";
        let color = "#555555";
        if (numeric !== null && !isNaN(numeric)) {
          const tuntas = numeric >= kkm;
          label = String(numeric);
          color = tuntas ? "#0a7a3a" : "#c0392b";
        }
        doc.fillColor(color).text(label, x, y + 6, { width: scoreColWidth, align: "center" });
      });

      let lineX = 50 + subjectColWidth;
      doc.fillColor("black");
      doc.moveTo(50, y).lineTo(50, y + rowHeight).stroke();
      doc.moveTo(lineX, y).lineTo(lineX, y + rowHeight).stroke();
      columns.forEach(() => {
        lineX += scoreColWidth;
        doc.moveTo(lineX, y).lineTo(lineX, y + rowHeight).stroke();
      });

      y += rowHeight;
    }
  }

  doc.fillColor("black").fontSize(10).text(
    `KKM Kelas: ${kkm} — Dicetak otomatis oleh SIAKAD pada ${new Date().toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })}`,
    50,
    y + 12,
  );

  doc.end();
  const buffer = await pdfDone;

  const safeTahunAjaran = tahunAjaran.replace(/[\\/]/g, "-");
  const filename = `${student.id}-${safeTahunAjaran}.pdf`;
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  return c.body(new Uint8Array(buffer));
});
