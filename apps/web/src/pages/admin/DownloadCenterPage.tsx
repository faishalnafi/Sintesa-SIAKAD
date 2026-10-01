import { useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { useAuthStore } from "@/store/auth";
import {
  downloadJournalRecapExcel,
  type ExportJournalRecord,
  type ExportTeachingHour,
} from "@/lib/journalRecapExport";
import {
  downloadGradeLegerExcel,
  hasAnyNumericScore,
  type ExportGradeComponent,
  type ExportGradeRecord,
  type ExportGradeStudent,
  type ExportGradeSubject,
} from "@/lib/gradeLegerExport";

type ClassItem = { id: string; name: string };
type TeacherItem = { id: string; name: string; nip?: string | null };
type DatePreset = "today" | "week" | "month" | "all" | "custom";

function toLocalYmd(d: Date): string {
  const offset = d.getTimezoneOffset();
  const local = new Date(d.getTime() - offset * 60 * 1000);
  return local.toISOString().split("T")[0];
}

function getPresetRange(preset: DatePreset, selectedMonth: string): { start: string; end: string; label: string } {
  const now = new Date();
  const todayStr = toLocalYmd(now);

  if (preset === "today") {
    return { start: todayStr, end: todayStr, label: "Hari Ini" };
  }

  if (preset === "week") {
    const day = now.getDay();
    const diffToMonday = day === 0 ? -6 : 1 - day;
    const monday = new Date(now);
    monday.setDate(now.getDate() + diffToMonday);
    const saturday = new Date(monday);
    saturday.setDate(monday.getDate() + 5);
    return {
      start: toLocalYmd(monday),
      end: toLocalYmd(saturday),
      label: "1 Pekan (Senin–Sabtu)",
    };
  }

  if (preset === "month") {
    const [y, m] = (selectedMonth || todayStr.slice(0, 7)).split("-").map(Number);
    const firstDay = new Date(y, m - 1, 1);
    const lastDay = new Date(y, m, 0);
    const monthName = firstDay.toLocaleDateString("id-ID", { month: "long", year: "numeric" });
    return {
      start: toLocalYmd(firstDay),
      end: toLocalYmd(lastDay),
      label: `1 Bulan (${monthName})`,
    };
  }

  if (preset === "all") {
    return { start: "", end: "", label: "Semua Tanggal (Seluruh Riwayat)" };
  }

  return { start: todayStr, end: todayStr, label: "Rentang Kustom" };
}

type GradeExportPayload = {
  classInfo: { id: string; name: string; homeroomTeacherName: string | null };
  roster: ExportGradeStudent[];
  subjects: ExportGradeSubject[];
  components: ExportGradeComponent[];
  grades: ExportGradeRecord[];
};

export function DownloadCenterPage() {
  const user = useAuthStore((s) => s.user);
  const isAdmin = useMemo(() => {
    const roles = (user?.roles ?? []).map((r) => r.toLowerCase().trim());
    return roles.includes("admin") || roles.includes("superadmin");
  }, [user]);

  const [classesList, setClassesList] = useState<ClassItem[]>([]);
  const [teachersList, setTeachersList] = useState<TeacherItem[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // =========================================================================
  // STATE MODUL #1: Rekap Monitoring Jurnal Guru
  // =========================================================================
  const [preset, setPreset] = useState<DatePreset>("today");
  const [selectedMonth, setSelectedMonth] = useState(() => toLocalYmd(new Date()).slice(0, 7));
  const [startDate, setStartDate] = useState(() => toLocalYmd(new Date()));
  const [endDate, setEndDate] = useState(() => toLocalYmd(new Date()));
  const [selectedTeacherId, setSelectedTeacherId] = useState(() => (!isAdmin && user?.id ? user.id : ""));
  const [selectedClassId, setSelectedClassId] = useState("");
  const [includeEmptySlots, setIncludeEmptySlots] = useState(() => isAdmin);

  const [previewHours, setPreviewHours] = useState<ExportTeachingHour[]>([]);
  const [previewJournals, setPreviewJournals] = useState<ExportJournalRecord[]>([]);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [exporting, setExporting] = useState(false);

  // =========================================================================
  // STATE MODUL #2: Buku Leger & Rekap Nilai Akademik
  // =========================================================================
  const [gradeClassId, setGradeClassId] = useState("");
  const [gradeSubjectId, setGradeSubjectId] = useState(""); // "" = Buku Leger Kelas (Semua Mapel)
  const [gradeStatusFilter, setGradeStatusFilter] = useState("all");
  const [gradeData, setGradeData] = useState<GradeExportPayload | null>(null);
  const [loadingGradePreview, setLoadingGradePreview] = useState(false);
  const [exportingGrades, setExportingGrades] = useState(false);

  // Sinkronkan tanggal otomatis saat memilih Preset
  useEffect(() => {
    if (preset !== "custom") {
      const range = getPresetRange(preset, selectedMonth);
      setStartDate(range.start);
      setEndDate(range.end);
    }
  }, [preset, selectedMonth]);

  // Pastikan untuk Guru non-admin, selectedTeacherId terkunci ke user.id sendiri
  useEffect(() => {
    if (!isAdmin && user?.id) {
      setSelectedTeacherId(user.id);
    }
  }, [isAdmin, user?.id]);

  // Load daftar Kelas & Guru sesuai role (Admin vs Guru Pribadi)
  useEffect(() => {
    const loadMaster = async () => {
      setLoadingConfig(true);
      try {
        if (isAdmin) {
          const [cRes, ssoRes, tRes] = await Promise.allSettled([
            api<{ classes?: ClassItem[]; data?: unknown }>("/admin/classes"),
            api<Array<{ id: string; nama_kelas: string }>>("/admin/sso/kelas"),
            api<TeacherItem[]>("/admin/teachers"),
          ]);

          const combinedClasses: ClassItem[] = [];
          const seenCIds = new Set<string>();
          const seenCNames = new Set<string>();

          if (ssoRes.status === "fulfilled" && ssoRes.value?.data) {
            for (const k of ssoRes.value.data) {
              const cleanName = (k.nama_kelas || "").replace(/^kelas\s+/i, "").trim();
              if (k.id && cleanName) {
                combinedClasses.push({ id: k.id, name: cleanName });
                seenCIds.add(k.id);
                seenCNames.add(cleanName.toLowerCase());
              }
            }
          }

          if (cRes.status === "fulfilled" && cRes.value?.data) {
            const val = cRes.value.data;
            const localList = val.classes ?? (Array.isArray(val) ? val : []);
            if (Array.isArray(localList)) {
              for (const k of localList) {
                const cleanName = (k.name || "").replace(/^kelas\s+/i, "").trim();
                if (k.id && cleanName && !seenCIds.has(k.id) && !seenCNames.has(cleanName.toLowerCase())) {
                  combinedClasses.push({ id: k.id, name: cleanName });
                  seenCIds.add(k.id);
                  seenCNames.add(cleanName.toLowerCase());
                }
              }
            }
          }

          setClassesList(combinedClasses);
          if (combinedClasses.length > 0) {
            setSelectedClassId(combinedClasses[0].id);
            setGradeClassId(combinedClasses[0].id);
          }

          if (tRes.status === "fulfilled" && Array.isArray(tRes.value?.data)) {
            const uniqueTeachers: TeacherItem[] = [];
            const seenTIds = new Set<string>();
            const seenTNames = new Set<string>();
            for (const t of tRes.value.data) {
              const tName = (t.name || "").trim();
              if (t.id && tName && !seenTIds.has(t.id) && !seenTNames.has(tName.toLowerCase())) {
                uniqueTeachers.push({ id: t.id, name: tName, nip: t.nip });
                seenTIds.add(t.id);
                seenTNames.add(tName.toLowerCase());
              }
            }
            setTeachersList(uniqueTeachers);
          }
        } else {
          // POV Guru Pribadi: muat daftar kelas dari endpoint guru & kunci guru ke diri sendiri
          const [tClsRes, ssoRes] = await Promise.allSettled([
            api<ClassItem[]>("/teacher/classes"),
            api<Array<{ id: string; nama_kelas: string }>>("/admin/sso/kelas"),
          ]);

          const combinedClasses: ClassItem[] = [];
          const seenCIds = new Set<string>();
          const seenCNames = new Set<string>();

          if (tClsRes.status === "fulfilled" && Array.isArray(tClsRes.value?.data)) {
            for (const c of tClsRes.value.data) {
              const cleanName = (c.name || "").replace(/^kelas\s+/i, "").trim();
              if (c.id && cleanName && !seenCIds.has(c.id) && !seenCNames.has(cleanName.toLowerCase())) {
                combinedClasses.push({ id: c.id, name: cleanName });
                seenCIds.add(c.id);
                seenCNames.add(cleanName.toLowerCase());
              }
            }
          }

          if (ssoRes.status === "fulfilled" && Array.isArray(ssoRes.value?.data)) {
            for (const k of ssoRes.value.data) {
              const cleanName = (k.nama_kelas || "").replace(/^kelas\s+/i, "").trim();
              if (k.id && cleanName && !seenCIds.has(k.id) && !seenCNames.has(cleanName.toLowerCase())) {
                combinedClasses.push({ id: k.id, name: cleanName });
                seenCIds.add(k.id);
                seenCNames.add(cleanName.toLowerCase());
              }
            }
          }

          setClassesList(combinedClasses);
          setSelectedClassId("");
          if (combinedClasses.length > 0) {
            setGradeClassId(combinedClasses[0].id);
          }

          if (user) {
            setTeachersList([{ id: user.id, name: user.name, nip: user.username }]);
            setSelectedTeacherId(user.id);
          }
        }
      } catch (e) {
        console.error("Gagal memuat master kelas/guru:", e);
      } finally {
        setLoadingConfig(false);
      }
    };
    loadMaster();
  }, [isAdmin, user]);

  // Helper fallback client-side untuk Jurnal Guru jika endpoint export gagal/belum ter-reload
  const fetchTeacherJournalsFallback = async (
    sDate: string,
    eDate: string,
    clsId: string,
    clsName: string
  ): Promise<{ hours: ExportTeachingHour[]; journals: ExportJournalRecord[] }> => {
    const [jRes, hRes] = await Promise.all([
      api<ExportJournalRecord[]>("/teacher/journals"),
      api<ExportTeachingHour[]>("/teacher/teaching-hours"),
    ]);
    const allJournals = (jRes.data ?? []).map((j) => ({
      ...j,
      teacherName: j.teacherName || user?.name || "Guru",
    }));
    const hours = hRes.data ?? [];
    const cleanTargetName = clsName.replace(/^kelas\s+/i, "").trim().toLowerCase();

    const filtered = allJournals.filter((j) => {
      if (sDate && j.date < sDate) return false;
      if (eDate && j.date > eDate) return false;
      if (clsId) {
        const jClsName = (j.className || "").replace(/^kelas\s+/i, "").trim().toLowerCase();
        const matchId = j.classId === clsId;
        const matchName = cleanTargetName !== "" && jClsName === cleanTargetName;
        if (!matchId && !matchName) return false;
      }
      return true;
    });

    return { hours, journals: filtered };
  };

  // Load ringkasan data Modul #1 (Jurnal)
  useEffect(() => {
    if (preset !== "all" && (!startDate || !endDate || startDate > endDate)) return;
    const fetchSummary = async () => {
      setLoadingPreview(true);
      const clsObj = classesList.find((c) => c.id === selectedClassId);
      const clsName = clsObj?.name || "";
      try {
        const params = new URLSearchParams();
        if (preset !== "all" && startDate) params.set("startDate", startDate);
        if (preset !== "all" && endDate) params.set("endDate", endDate);
        if (selectedClassId) {
          params.set("classId", selectedClassId);
          if (clsName) params.set("className", clsName);
        }
        const effectiveTeacherId = isAdmin ? selectedTeacherId : user?.id || "";
        if (effectiveTeacherId) {
          params.set("teacherId", effectiveTeacherId);
          const tObj = teachersList.find((t) => t.id === effectiveTeacherId);
          const tName = tObj?.name || (!isAdmin ? user?.name : "");
          if (tName) params.set("teacherName", tName);
        }

        const res = await api<{ hours: ExportTeachingHour[]; journals: ExportJournalRecord[] }>(
          `/admin/journals/export?${params.toString()}`
        );
        const hours = res.data?.hours ?? [];
        const journals = (res.data?.journals ?? []).map((j) => ({
          ...j,
          teacherName: j.teacherName || (!isAdmin ? user?.name ?? null : null),
        }));
        setPreviewHours(hours);
        setPreviewJournals(journals);
      } catch (e) {
        if (!isAdmin) {
          try {
            const fb = await fetchTeacherJournalsFallback(
              preset === "all" ? "" : startDate,
              preset === "all" ? "" : endDate,
              selectedClassId,
              clsName
            );
            setPreviewHours(fb.hours);
            setPreviewJournals(fb.journals);
            return;
          } catch (_) {}
        }
        console.error("Gagal memuat pratinjau ekspor jurnal:", e);
      } finally {
        setLoadingPreview(false);
      }
    };
    fetchSummary();
  }, [preset, startDate, endDate, selectedClassId, selectedTeacherId, isAdmin, user?.id, user?.name, classesList, teachersList]);

  // Load ringkasan data Modul #2 & #3 (Leger Nilai + Presensi & GDS Siswa)
  useEffect(() => {
    if (!gradeClassId) return;
    const fetchGradePreview = async () => {
      setLoadingGradePreview(true);
      const clsObj = classesList.find((c) => c.id === gradeClassId);
      const clsName = clsObj?.name || "";
      try {
        const params = new URLSearchParams({ classId: gradeClassId });
        if (clsName) params.set("className", clsName);
        if (gradeSubjectId) params.set("subjectId", gradeSubjectId);
        if (gradeStatusFilter !== "all") params.set("status", gradeStatusFilter);

        const res = await api<GradeExportPayload>(`/admin/grades/export?${params.toString()}`);
        if (res.data) {
          setGradeData(res.data);
          if (!isAdmin && res.data.subjects.length === 1 && !gradeSubjectId) {
            setGradeSubjectId(res.data.subjects[0].id);
          }
        }
      } catch (e) {
        // Fallback untuk Guru jika endpoint /admin/grades/export belum merespons
        if (!isAdmin) {
          try {
            const [sRes, compRes] = await Promise.all([
              api<ExportGradeSubject[]>("/teacher/subjects"),
              api<ExportGradeComponent[]>("/teacher/assessment-components"),
            ]);
            const rawSubjs = Array.isArray(sRes.data)
              ? sRes.data
              : ((sRes.data as any)?.subjects ?? []);
            const subjects: ExportGradeSubject[] = rawSubjs.map((s: any) => ({
              id: s.id,
              code: s.code || s.name,
              name: s.name,
              type: s.type || "umum",
              teacherNames: user?.name || null,
            }));
            const targetSubjId = gradeSubjectId || subjects[0]?.id || "";
            let roster: ExportGradeStudent[] = [];
            let grades: ExportGradeRecord[] = [];

            if (targetSubjId) {
              const gRes = await api<Array<any>>(
                `/teacher/grades?classId=${encodeURIComponent(gradeClassId)}&subjectId=${encodeURIComponent(targetSubjId)}`
              );
              const rows = gRes.data ?? [];
              roster = rows.map((r: any) => ({
                id: r.studentId,
                name: r.name,
                nis: r.nis,
                nisn: r.nisn,
                gender: null,
              }));
              grades = rows
                .filter((r: any) => r.gradeId || r.uh1 != null || r.t1 != null || r.sts != null || r.uh2 != null || r.t2 != null)
                .map((r: any) => ({
                  id: r.gradeId || `${r.studentId}-${targetSubjId}`,
                  studentId: r.studentId,
                  classId: gradeClassId,
                  subjectId: targetSubjId,
                  uh1: r.uh1 != null ? String(r.uh1) : null,
                  t1: r.t1 != null ? String(r.t1) : null,
                  sts: r.sts != null ? String(r.sts) : null,
                  uh2: r.uh2 != null ? String(r.uh2) : null,
                  t2: r.t2 != null ? String(r.t2) : null,
                  status: r.status || "draft",
                }));
            }

            setGradeData({
              classInfo: { id: gradeClassId, name: clsName || "Kelas", homeroomTeacherName: null },
              roster,
              subjects,
              components: compRes.data ?? [],
              grades,
            });
            if (subjects.length === 1 && !gradeSubjectId) {
              setGradeSubjectId(subjects[0].id);
            }
            return;
          } catch (_) {}
        }
        console.error("Gagal memuat pratinjau leger nilai:", e);
      } finally {
        setLoadingGradePreview(false);
      }
    };
    fetchGradePreview();
  }, [gradeClassId, gradeSubjectId, gradeStatusFilter, isAdmin, classesList, user?.name]);

  const presetLabel = useMemo(() => {
    return getPresetRange(preset, selectedMonth).label;
  }, [preset, selectedMonth]);

  const selectedClassObj = useMemo(
    () => classesList.find((c) => c.id === selectedClassId) ?? null,
    [classesList, selectedClassId]
  );

  const selectedTeacherObj = useMemo(() => {
    if (!isAdmin && user) {
      return { id: user.id, name: user.name };
    }
    return teachersList.find((t) => t.id === selectedTeacherId) ?? null;
  }, [isAdmin, user, teachersList, selectedTeacherId]);

  const handleExportJournalExcel = async () => {
    if (preset !== "all" && (!startDate || !endDate)) {
      Swal.fire({ icon: "warning", title: "Tanggal Wajib Diisi", text: "Silakan pilih rentang tanggal terlebih dahulu." });
      return;
    }
    if (preset !== "all" && startDate > endDate) {
      Swal.fire({
        icon: "warning",
        title: "Rentang Tanggal Tidak Valid",
        text: "Tanggal mulai tidak boleh lebih besar dari tanggal selesai.",
      });
      return;
    }

    setExporting(true);
    try {
      let hours = previewHours;
      let journals = previewJournals;

      const dates = journals.map((j) => j.date).filter(Boolean).sort();
      const effectiveStart = preset === "all" ? (dates[0] || toLocalYmd(new Date())) : startDate;
      const effectiveEnd = preset === "all" ? (dates[dates.length - 1] || toLocalYmd(new Date())) : endDate;

      const { fileName, totalRows } = downloadJournalRecapExcel({
        startDate: effectiveStart,
        endDate: effectiveEnd,
        presetLabel,
        selectedClass: selectedClassObj,
        selectedTeacher: selectedTeacherObj,
        allClasses: classesList,
        hours,
        journals,
        includeEmptySlots: isAdmin && preset !== "all" ? includeEmptySlots : false,
        printedBy: user?.name || "Guru SIAKAD",
      });

      Swal.fire({
        icon: "success",
        title: "Berhasil Mengunduh Excel!",
        html: `
          <div class="text-sm space-y-2 text-left">
            <p>File pemberkasan fisik berhasil dibuat dan diunduh:</p>
            <div class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/30 font-mono text-xs break-all text-emerald-800 dark:text-emerald-300">
              📄 ${fileName}
            </div>
            <p class="text-xs opacity-80">Total baris terekam di tabel: <b>${totalRows} baris</b> (${journals.length} jurnal terisi).</p>
          </div>
        `,
        timer: 3500,
        confirmButtonColor: "#10b981",
      });
    } catch (e: any) {
      Swal.fire({
        icon: "error",
        title: "Gagal Mengekspor Excel",
        text: e.message || "Terjadi kesalahan saat mengunduh rekap jurnal.",
      });
    } finally {
      setExporting(false);
    }
  };

  const handleExportGradeExcel = async () => {
    if (!gradeClassId || !gradeData) {
      Swal.fire({ icon: "warning", title: "Pilih Kelas", text: "Silakan pilih kelas terlebih dahulu." });
      return;
    }

    setExportingGrades(true);
    try {
      const { fileName, studentCount, subjectCount } = downloadGradeLegerExcel({
        classInfo: gradeData.classInfo,
        roster: gradeData.roster,
        subjects: gradeData.subjects,
        components: gradeData.components,
        grades: gradeData.grades,
        selectedSubjectId: gradeSubjectId || undefined,
        statusFilter: gradeStatusFilter,
        printedBy: user?.name || "Guru SIAKAD",
      });

      Swal.fire({
        icon: "success",
        title: "Berhasil Mengunduh Leger / Nilai!",
        html: `
          <div class="text-sm space-y-2 text-left">
            <p>File Excel pemberkasan nilai berhasil dibuat:</p>
            <div class="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/30 font-mono text-xs break-all text-emerald-800 dark:text-emerald-300">
              📊 ${fileName}
            </div>
            <p class="text-xs opacity-80">Cakupan: <b>${studentCount} siswa</b> · <b>${subjectCount} mata pelajaran</b>.</p>
          </div>
        `,
        timer: 3500,
        confirmButtonColor: "#10b981",
      });
    } catch (e: any) {
      Swal.fire({
        icon: "error",
        title: "Gagal Mengekspor Nilai",
        text: e.message || "Terjadi kesalahan saat mengunduh leger nilai.",
      });
    } finally {
      setExportingGrades(false);
    }
  };

  const sentCount = previewJournals.filter((j) => j.status === "sent").length;
  const draftCount = previewJournals.filter((j) => j.status === "draft").length;

  const gradeApprovedCount = gradeData?.grades.filter((g) => g.status === "approved").length ?? 0;
  const gradeSubmittedCount = gradeData?.grades.filter((g) => g.status === "submitted").length ?? 0;
  const gradeDraftCount =
    gradeData?.grades.filter((g) => g.status === "draft" && hasAnyNumericScore(g)).length ?? 0;

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow={isAdmin ? "Manajemen Akademik & Pemberkasan" : `Pemberkasan Pribadi Guru — ${user?.name ?? ""}`}
        title="Pusat Unduhan"
        description={
          isAdmin
            ? "Pusat ekspor laporan Excel (.xlsx) resmi siap cetak untuk pemberkasan fisik kurikulum, supervisi jurnal, leger nilai, presensi & GDS, serta SK penugasan."
            : "Unduh laporan Excel (.xlsx) jurnal mengajar pribadi, rekap nilai akademik mata pelajaran yang Anda ampu, serta data presensi siswa."
        }
      />

      {/* ===================================================================== */}
      {/* MODUL #1 (AKTIF): REKAP PEMBERKASAN FISIK MONITORING JURNAL GURU      */}
      {/* ===================================================================== */}
      <Card className="overflow-hidden border-2" style={{ borderColor: "color-mix(in srgb, var(--accent) 35%, var(--divider))" }}>
        <div
          className="px-6 py-4 border-b flex flex-wrap items-center justify-between gap-3"
          style={{ background: "var(--accent-soft)", borderColor: "var(--divider)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-xs"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              <span className="material-symbols-outlined text-[24px]">auto_stories</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-lg" style={{ color: "var(--fg)" }}>
                  {isAdmin ? "1. Rekap Monitoring Jurnal Mengajar Guru" : "1. Rekap Jurnal Mengajar Pribadi Saya"}
                </h2>
                <Badge status="success">Aktif · Siap Unduh (.xlsx)</Badge>
              </div>
              <p className="text-xs app-muted mt-0.5">
                {isAdmin
                  ? "Ekspor tabel monitoring jurnal KBM harian dengan kop sekolah, status keterisian jam, dan blok tanda tangan pemberkasan fisik."
                  : `Rekapitulasi jurnal mengajar khusus atas nama ${user?.name ?? "Anda"} — pilih berdasarkan rentang tanggal atau kelas yang diajar.`}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Baris 1: Pilihan Rentang Waktu Cepat (Preset) */}
          <div className="space-y-2">
            <label className="text-xs font-semibold uppercase tracking-wider app-muted block">
              Langkah 1 — Pilih Rentang Waktu Rekapitulasi <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: "today", label: "Hari Ini", icon: "today" },
                  { id: "week", label: "1 Pekan (Senin–Sabtu)", icon: "date_range" },
                  { id: "month", label: "1 Bulan Penuh", icon: "calendar_month" },
                  { id: "all", label: "Semua Tanggal (Seluruh Riwayat)", icon: "history" },
                  { id: "custom", label: "Rentang Tanggal Kustom", icon: "edit_calendar" },
                ] as const
              ).map((item) => {
                const active = preset === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setPreset(item.id)}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
                      active
                        ? "border-[var(--accent)] bg-[var(--accent)] text-white shadow-xs"
                        : "border-outline-variant/40 hover:bg-[var(--hover)]"
                    }`}
                  >
                    <span className="material-symbols-outlined text-[17px]">{item.icon}</span>
                    {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Baris 2: Detail Tanggal & Filter Guru / Kelas */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            {preset === "month" ? (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                  Pilih Bulan <span className="text-red-500">*</span>
                </label>
                <input
                  type="month"
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            ) : (
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                  Dari Tanggal {preset !== "all" && <span className="text-red-500">*</span>}
                </label>
                <input
                  type="date"
                  value={startDate}
                  disabled={preset === "all"}
                  onChange={(e) => {
                    setPreset("custom");
                    setStartDate(e.target.value);
                  }}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
                />
              </div>
            )}

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                Sampai Tanggal {preset !== "all" && <span className="text-red-500">*</span>}
              </label>
              <input
                type="date"
                value={endDate}
                disabled={preset === "month" || preset === "all"}
                onChange={(e) => {
                  setPreset("custom");
                  setEndDate(e.target.value);
                }}
                className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary disabled:opacity-60"
              />
            </div>

            {isAdmin ? (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                    Filter Per Guru <span className="text-[10px] font-normal lowercase opacity-75">(pilih salah satu)</span>
                  </label>
                  {loadingConfig ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <select
                      value={selectedTeacherId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedTeacherId(val);
                        if (val) {
                          setSelectedClassId("");
                        } else if (!selectedClassId && classesList.length > 0) {
                          setSelectedClassId(classesList[0].id);
                        }
                      }}
                      className={`w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-all ${
                        selectedTeacherId
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold"
                          : "border-outline-variant/40 bg-[var(--bg)] opacity-80"
                      }`}
                    >
                      <option value="">— Semua Guru (Mode Per Kelas) —</option>
                      {teachersList.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                    Filter Per Kelas <span className="text-[10px] font-normal lowercase opacity-75">(pilih salah satu)</span>
                  </label>
                  {loadingConfig ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <select
                      value={selectedClassId}
                      onChange={(e) => {
                        const val = e.target.value;
                        setSelectedClassId(val);
                        if (val) {
                          setSelectedTeacherId("");
                        } else if (!selectedTeacherId && teachersList.length > 0) {
                          setSelectedTeacherId(teachersList[0].id);
                        }
                      }}
                      className={`w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-all ${
                        selectedClassId
                          ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold"
                          : "border-outline-variant/40 bg-[var(--bg)] opacity-80"
                      }`}
                    >
                      <option value="">— Semua Kelas (Mode Per Guru) —</option>
                      {classesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          Kelas {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                    Guru Pengajar (Terkunci Pribadi)
                  </label>
                  <div
                    className="w-full rounded-xl border px-3.5 py-2 text-sm font-semibold flex items-center gap-2 select-none"
                    style={{
                      borderColor: "var(--accent)",
                      background: "var(--accent-soft)",
                      color: "var(--fg)",
                    }}
                  >
                    <span className="material-symbols-outlined text-[18px] text-[var(--accent)]">lock_person</span>
                    <span className="truncate">{user?.name ?? "Guru"}</span>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                    Filter Kelas / Rombel <span className="text-[10px] font-normal lowercase opacity-75">(opsional)</span>
                  </label>
                  {loadingConfig ? (
                    <Skeleton className="h-10 w-full" />
                  ) : (
                    <select
                      value={selectedClassId}
                      onChange={(e) => setSelectedClassId(e.target.value)}
                      className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary"
                    >
                      <option value="">— Semua Kelas yang Saya Ajar —</option>
                      {classesList.map((c) => (
                        <option key={c.id} value={c.id}>
                          Kelas {c.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Opsi Tambahan & Ringkasan Pratinjau */}
          <div
            className="p-4 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            style={{ background: "var(--hover)", borderColor: "var(--divider)" }}
          >
            <div className="space-y-2">
              {isAdmin && preset !== "all" && (
                <label className="inline-flex items-center gap-2.5 text-sm font-medium cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeEmptySlots}
                    onChange={(e) => setIncludeEmptySlots(e.target.checked)}
                    className="w-4 h-4 rounded accent-[var(--accent)]"
                  />
                  <span>
                    Tampilkan juga slot <b>Jam Pelajaran Kosong (Belum Isi)</b> saat memfilter per Kelas
                  </span>
                </label>
              )}

              <div className="flex flex-wrap items-center gap-3 text-xs app-muted">
                <span>
                  📅 Periode:{" "}
                  {preset === "all" ? (
                    <b style={{ color: "var(--fg)" }}>Seluruh Riwayat Tanggal</b>
                  ) : (
                    <>
                      <b style={{ color: "var(--fg)" }}>{startDate}</b> s/d{" "}
                      <b style={{ color: "var(--fg)" }}>{endDate}</b> ({presetLabel})
                    </>
                  )}
                </span>
                <span>•</span>
                <span>
                  🏫 Kelas:{" "}
                  <b style={{ color: "var(--fg)" }}>
                    {selectedClassObj ? `Kelas ${selectedClassObj.name}` : isAdmin ? "Semua Kelas" : "Semua Kelas yang Saya Ajar"}
                  </b>
                </span>
                <span>•</span>
                <span>
                  👨‍🏫 Guru: <b style={{ color: "var(--fg)" }}>{selectedTeacherObj ? selectedTeacherObj.name : "Semua Guru"}</b>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div
                className="px-3.5 py-2 rounded-xl border text-xs flex items-center gap-3"
                style={{ background: "var(--bg)", borderColor: "var(--divider)" }}
              >
                {loadingPreview ? (
                  <span className="app-muted">Menghitung data...</span>
                ) : (
                  <>
                    <span>
                      Terisi: <b>{previewJournals.length}</b> jurnal
                    </span>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      (Terkirim: <b>{sentCount}</b>
                    </span>
                    <span className="text-amber-600 dark:text-amber-400">
                      Draft: <b>{draftCount}</b>)
                    </span>
                  </>
                )}
              </div>

              <Button
                variant="primary"
                onClick={handleExportJournalExcel}
                disabled={exporting || loadingPreview}
                className="px-5 py-2.5 font-semibold shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[19px]">download</span>
                {exporting ? "Menyiapkan Excel..." : "Unduh Rekap Jurnal (.xlsx)"}
              </Button>
            </div>
          </div>

          {/* Pratinjau Mini (5 baris pertama) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider app-muted">
                Pratinjau Data Jurnal Terisi ({previewJournals.length} catatan ditemukan)
              </span>
              {previewJournals.length > 5 && (
                <span className="text-xs app-muted">Menampilkan 5 catatan terbaru di layar (semua data masuk ke Excel)</span>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--divider)" }}>
              <table className="w-full text-xs">
                <thead className="text-left" style={{ background: "var(--hover)" }}>
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">Tanggal</th>
                    <th className="px-3.5 py-2.5 font-semibold">Jam Ke</th>
                    <th className="px-3.5 py-2.5 font-semibold">Kelas</th>
                    <th className="px-3.5 py-2.5 font-semibold">Guru Pengajar</th>
                    <th className="px-3.5 py-2.5 font-semibold">Mata Pelajaran</th>
                    <th className="px-3.5 py-2.5 font-semibold">Materi Pembelajaran</th>
                    <th className="px-3.5 py-2.5 font-semibold">Presensi</th>
                    <th className="px-3.5 py-2.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingPreview ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center app-muted">
                        Memuat pratinjau data...
                      </td>
                    </tr>
                  ) : previewJournals.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="px-4 py-6 text-center app-muted">
                        Belum ada jurnal terisi pada filter ini.
                      </td>
                    </tr>
                  ) : (
                    previewJournals.slice(0, 5).map((j) => (
                      <tr key={j.id} className="border-t app-divider">
                        <td className="px-3.5 py-2.5 whitespace-nowrap font-medium">{j.date}</td>
                        <td className="px-3.5 py-2.5">Jam {j.teachingHourLabel}</td>
                        <td className="px-3.5 py-2.5 font-medium">{j.className}</td>
                        <td className="px-3.5 py-2.5">{j.teacherName || user?.name || "—"}</td>
                        <td className="px-3.5 py-2.5">{j.subjectName}</td>
                        <td className="px-3.5 py-2.5 max-w-[220px] truncate" title={j.materi}>
                          {j.materi}
                        </td>
                        <td className="px-3.5 py-2.5 max-w-[160px] truncate" title={j.presenceInfo}>
                          {j.presenceInfo}
                        </td>
                        <td className="px-3.5 py-2.5">
                          <Badge status={j.status === "sent" ? "success" : "warning"}>
                            {j.status === "sent" ? "Terkirim" : "Draft"}
                          </Badge>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>

      {/* ===================================================================== */}
      {/* MODUL #2 (AKTIF): LEGER & REKAP NILAI AKADEMIK                        */}
      {/* ===================================================================== */}
      <Card className="overflow-hidden border-2" style={{ borderColor: "color-mix(in srgb, var(--accent) 35%, var(--divider))" }}>
        <div
          className="px-6 py-4 border-b flex flex-wrap items-center justify-between gap-3"
          style={{ background: "var(--accent-soft)", borderColor: "var(--divider)" }}
        >
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center shadow-xs"
              style={{ background: "var(--accent)", color: "#fff" }}
            >
              <span className="material-symbols-outlined text-[24px]">table_chart</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-lg" style={{ color: "var(--fg)" }}>
                  {isAdmin ? "2. Buku Leger & Rekap Nilai Akademik" : "2. Rekap Nilai Akademik Mata Pelajaran Saya"}
                </h2>
                <Badge status="success">Aktif · Siap Unduh (.xlsx)</Badge>
              </div>
              <p className="text-xs app-muted mt-0.5">
                {isAdmin
                  ? "Ekspor Buku Leger Kelas (gabungan seluruh mata pelajaran + matriks persetujuan + peringkat) atau daftar nilai rinci per mata pelajaran."
                  : "Ekspor daftar nilai akademik siswa untuk mata pelajaran yang Anda ampu per kelas."}
              </p>
            </div>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Filter Kelas, Mata Pelajaran, dan Status Nilai */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                Pilih Kelas / Rombel <span className="text-red-500">*</span>
              </label>
              {loadingConfig ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <select
                  value={gradeClassId}
                  onChange={(e) => setGradeClassId(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm font-medium outline-none focus:border-primary"
                >
                  {classesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      Kelas {c.name}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                {isAdmin ? "Mode / Mata Pelajaran" : "Mata Pelajaran yang Diampu"}
              </label>
              {loadingGradePreview && !gradeData ? (
                <Skeleton className="h-10 w-full" />
              ) : (
                <select
                  value={gradeSubjectId}
                  onChange={(e) => setGradeSubjectId(e.target.value)}
                  disabled={!isAdmin && (gradeData?.subjects.length ?? 0) === 1}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary disabled:opacity-75"
                >
                  {(isAdmin || (gradeData?.subjects.length ?? 0) > 1) && (
                    <option value="">
                      {isAdmin
                        ? "📚 Buku Leger Kelas (Semua Mapel + Matriks Persetujuan + Sheet Rincian)"
                        : "📚 Semua Mata Pelajaran Saya"}
                    </option>
                  )}
                  {(gradeData?.subjects ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      Mapel: {s.name} ({s.code || s.name})
                    </option>
                  ))}
                </select>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                Filter Status Nilai
              </label>
              <select
                value={gradeStatusFilter}
                onChange={(e) => setGradeStatusFilter(e.target.value)}
                className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="all">Semua Status (Draft, Terkirim & Disetujui)</option>
                <option value="approved">Hanya Disetujui Wali Kelas (Approved)</option>
                <option value="submitted">Hanya Terkirim (Submitted)</option>
                <option value="draft">Hanya Draft</option>
              </select>
            </div>
          </div>

          {/* Ringkasan & Tombol Unduh */}
          <div
            className="p-4 rounded-2xl border flex flex-col lg:flex-row lg:items-center justify-between gap-4"
            style={{ background: "var(--hover)", borderColor: "var(--divider)" }}
          >
            <div className="space-y-1.5">
              <div className="text-sm font-semibold" style={{ color: "var(--fg)" }}>
                {gradeSubjectId
                  ? `Mode Ekspor: Rekap Nilai Mata Pelajaran ${
                      gradeData?.subjects.find((s) => s.id === gradeSubjectId)?.name ?? ""
                    }`
                  : `Mode Ekspor: Buku Leger Induk Kelas ${gradeData?.classInfo.name ?? ""} + Matriks Persetujuan + Sheet Mapel`}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs app-muted">
                <span>
                  👨‍🎓 Siswa Terdaftar: <b style={{ color: "var(--fg)" }}>{gradeData?.roster.length ?? 0} siswa</b>
                </span>
                <span>•</span>
                <span>
                  📚 Cakupan Mapel: <b style={{ color: "var(--fg)" }}>{gradeData?.subjects.length ?? 0} mapel</b>
                </span>
                <span>•</span>
                <span>
                  👩‍🏫 Wali Kelas:{" "}
                  <b style={{ color: "var(--fg)" }}>{gradeData?.classInfo.homeroomTeacherName || "Belum ditentukan"}</b>
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <div
                className="px-3.5 py-2 rounded-xl border text-xs flex items-center gap-3"
                style={{ background: "var(--bg)", borderColor: "var(--divider)" }}
              >
                {loadingGradePreview ? (
                  <span className="app-muted">Menghitung nilai...</span>
                ) : (
                  <>
                    <span className="text-emerald-600 dark:text-emerald-400">
                      Approved: <b>{gradeApprovedCount}</b>
                    </span>
                    <span className="text-blue-600 dark:text-blue-400">
                      Submitted: <b>{gradeSubmittedCount}</b>
                    </span>
                    <span className="text-amber-600 dark:text-amber-400">
                      Draft Terisi: <b>{gradeDraftCount}</b>
                    </span>
                  </>
                )}
              </div>

              <Button
                variant="primary"
                onClick={handleExportGradeExcel}
                disabled={exportingGrades || loadingGradePreview || !gradeClassId}
                className="px-5 py-2.5 font-semibold shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <span className="material-symbols-outlined text-[19px]">download</span>
                {exportingGrades
                  ? "Menyiapkan Excel..."
                  : gradeSubjectId
                  ? "Unduh Nilai Mapel (.xlsx)"
                  : "Unduh Buku Leger (.xlsx)"}
              </Button>
            </div>
          </div>

          {/* Pratinjau Mini Leger Siswa (5 siswa pertama) */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider app-muted">
                Pratinjau Daftar Siswa & Nilai ({gradeData?.roster.length ?? 0} siswa di kelas ini)
              </span>
              {(gradeData?.roster.length ?? 0) > 5 && (
                <span className="text-xs app-muted">Menampilkan 5 siswa pertama (seluruh siswa akan masuk ke Excel)</span>
              )}
            </div>

            <div className="overflow-x-auto rounded-xl border" style={{ borderColor: "var(--divider)" }}>
              <table className="w-full text-xs">
                <thead className="text-left" style={{ background: "var(--hover)" }}>
                  <tr>
                    <th className="px-3.5 py-2.5 font-semibold">No</th>
                    <th className="px-3.5 py-2.5 font-semibold">NISN / NIS</th>
                    <th className="px-3.5 py-2.5 font-semibold">Nama Lengkap Siswa</th>
                    {(gradeSubjectId
                      ? gradeData?.subjects.filter((s) => s.id === gradeSubjectId) ?? []
                      : (gradeData?.subjects ?? []).slice(0, 6)
                    ).map((s) => (
                      <th key={s.id} className="px-3.5 py-2.5 font-semibold text-center">
                        {s.code || s.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loadingGradePreview ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center app-muted">
                        Memuat pratinjau leger nilai...
                      </td>
                    </tr>
                  ) : !gradeData || gradeData.roster.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="px-4 py-6 text-center app-muted">
                        Belum ada data siswa terdaftar di kelas ini.
                      </td>
                    </tr>
                  ) : (
                    gradeData.roster.slice(0, 5).map((stu, idx) => {
                      const shownSubjects = gradeSubjectId
                        ? gradeData.subjects.filter((s) => s.id === gradeSubjectId)
                        : gradeData.subjects.slice(0, 6);
                      return (
                        <tr key={stu.id} className="border-t app-divider">
                          <td className="px-3.5 py-2.5">{idx + 1}</td>
                          <td className="px-3.5 py-2.5 font-mono">{stu.nisn || stu.nis || "—"}</td>
                          <td className="px-3.5 py-2.5 font-medium">{stu.name}</td>
                          {shownSubjects.map((subj) => {
                            const g = gradeData.grades.find(
                              (gr) => gr.studentId === stu.id && gr.subjectId === subj.id
                            );
                            const vals = [g?.uh1, g?.t1, g?.sts, g?.uh2, g?.t2]
                              .map((v) => (v != null && String(v).trim() !== "" ? Number(v) : null))
                              .filter((v): v is number => v !== null && Number.isFinite(v));
                            const avg =
                              vals.length > 0
                                ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10
                                : null;
                            return (
                              <td key={subj.id} className="px-3.5 py-2.5 text-center font-medium">
                                {avg !== null ? avg : <span className="app-muted">—</span>}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </Card>

      {/* ===================================================================== */}
      {/* MODUL #3 s/d #6: SEGERA HADIR (COMING SOON / NONAKTIF)                */}
      {/* ===================================================================== */}
      <div className="space-y-3">
        <h3 className="font-display font-bold text-base" style={{ color: "var(--fg)" }}>
          Modul Pemberkasan Lainnya (Segera Hadir)
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              no: 3,
              icon: "fact_check",
              title: "Rekap Matrix Persetujuan Nilai",
              desc: "Laporan progres pengumpulan dan persetujuan nilai guru mapel oleh Wali Kelas.",
            },
            {
              no: 4,
              icon: "groups",
              title: "Buku Induk Siswa, Alumni & Mutasi",
              desc: "Arsip data peserta didik aktif per rombel, daftar alumni per angkatan, dan riwayat mutasi keluar.",
            },
            {
              no: 5,
              icon: "assignment_ind",
              title: "SK Penugasan Guru & Wali Kelas",
              desc: "Daftar pembagian tugas mengajar guru mata pelajaran, jam mengajar, dan daftar wali kelas aktif.",
            },
            {
              no: 6,
              icon: "verified_user",
              title: "Rekap Kedisiplinan (GDS) & Presensi",
              desc: "Laporan poin ketertiban siswa dan rekapitulasi ketidakhadiran (Sakit, Izin, Alpa) per kelas.",
            },
          ].map((m) => (
            <Card key={m.no} className="p-5 flex flex-col justify-between gap-4 opacity-70 select-none pointer-events-none">
              <div className="flex items-start gap-3.5">
                <div
                  className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                  style={{ background: "var(--hover)" }}
                >
                  <span className="material-symbols-outlined text-[20px] app-muted">{m.icon}</span>
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-display font-bold text-sm" style={{ color: "var(--fg)" }}>
                      {m.no}. {m.title}
                    </span>
                  </div>
                  <p className="text-xs app-muted leading-relaxed">{m.desc}</p>
                </div>
              </div>
              <div className="flex justify-end">
                <Badge status="draft">Segera Hadir</Badge>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
