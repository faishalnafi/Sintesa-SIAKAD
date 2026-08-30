import React, { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";
import { useAuthStore } from "@/store/auth";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type Matrix = {
  class: { id: string; name: string } | null;
  summary: {
    total: number;
    approved: number;
    ready: number;
    incomplete: number;
    progress: number;
  } | null;
  students: Array<{
    studentId: string;
    name: string;
    nisn: string | null;
    uh1: string | null;
    t1: string | null;
    sts: string | null;
    uh2: string | null;
    t2: string | null;
    poinGds: number;
    sakit: number;
    izin: number;
    alpa: number;
    catatanGds: string | null;
    catatanKehadiran: string | null;
    status: string;
    gradeCount?: number;
    grades?: Array<{
      subjectId: string;
      subjectName: string;
      uh1: string | number | null;
      t1: string | number | null;
      sts: string | number | null;
      uh2: string | number | null;
      t2: string | number | null;
      status: string;
    }>;
  }>;
};

type AssessmentComponent = {
  id: string;
  code: string;
  name: string;
  type: "UJIAN" | "TUGAS";
  status: "active" | "disabled" | "inactive";
  sortOrder: number;
};

const defaultComponents: AssessmentComponent[] = [
  { id: "1", code: "uh1", name: "UH1", type: "UJIAN", status: "active", sortOrder: 1 },
  { id: "2", code: "t1", name: "T1", type: "TUGAS", status: "active", sortOrder: 2 },
  { id: "3", code: "sts", name: "STS", type: "UJIAN", status: "active", sortOrder: 3 },
  { id: "4", code: "uh2", name: "UH2", type: "UJIAN", status: "disabled", sortOrder: 4 },
  { id: "5", code: "t2", name: "T2", type: "TUGAS", status: "disabled", sortOrder: 5 },
];

export function WalikelasMatrixPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.roles.includes("superadmin") ?? false;

  const [data, setData] = useState<Matrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [classes, setClasses] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [expandedStudentIds, setExpandedStudentIds] = useState<Set<string>>(new Set());
  const [assessmentComponents, setAssessmentComponents] = useState<AssessmentComponent[]>(defaultComponents);
  const pager = usePagination(data?.students ?? []);

  const toggleExpand = (studentId: string) => {
    setExpandedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const allPageStudentIds = pager.pageItems.map((s) => s.studentId);
  const isAllExpanded =
    allPageStudentIds.length > 0 && allPageStudentIds.every((id) => expandedStudentIds.has(id));

  const toggleExpandAll = () => {
    setExpandedStudentIds((prev) => {
      const next = new Set(prev);
      if (isAllExpanded) {
        allPageStudentIds.forEach((id) => next.delete(id));
      } else {
        allPageStudentIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const loadClasses = async () => {
    try {
      const res = await api<Array<{ id: string; name: string }>>("/homeroom/classes");
      const list = res.data ?? [];
      setClasses(list);
      if (list.length > 0) {
        setSelectedClassId(list[0].id);
      } else {
        setLoading(false);
      }
    } catch (e) {
      console.error("Failed to load homeroom classes:", e);
      setLoading(false);
    }
  };

  const loadMatrix = async (classId: string, silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api<Matrix>(`/homeroom/matrix?classId=${classId}`);
      setData(res.data ?? null);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const fetchComponents = async () => {
    try {
      const res = await api<AssessmentComponent[]>("/teacher/assessment-components");
      if (res.data && res.data.length > 0) {
        setAssessmentComponents(res.data);
      }
    } catch (e) {
      // fallback
    }
  };

  useEffect(() => {
    loadClasses();
    fetchComponents();
  }, []);

  useEffect(() => {
    if (selectedClassId) {
      loadMatrix(selectedClassId);
    }
  }, [selectedClassId]);

  useRealtimeEvent(
    ["grade_submitted", "grade_rejected", "grade_deleted", "subject_updated"],
    (payload: any) => {
      fetchComponents();
      if (selectedClassId && (!payload.classId || payload.classId === selectedClassId)) {
        loadMatrix(selectedClassId, true);
      }
    },
    Boolean(selectedClassId)
  );

  const visibleComponents = assessmentComponents.filter((c) => c.status !== "inactive");

  type ApproveResult = {
    approvedCount?: number;
    skippedCount?: number;
    approved?: number;
    approvedList?: Array<{ id: string; name: string }>;
    skippedList?: Array<{ id: string; name: string; reason: string }>;
  };

  const approveAll = async () => {
    if (!selectedClassId) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await api<ApproveResult>("/homeroom/approve", {
        method: "POST",
        body: JSON.stringify({ classId: selectedClassId }),
      });

      const approvedList = Array.isArray(res.data?.approvedList) ? res.data!.approvedList : [];
      const skippedList = Array.isArray(res.data?.skippedList) ? res.data!.skippedList : [];
      const approvedCount = res.data?.approvedCount ?? res.data?.approved ?? approvedList.length;
      const skippedCount = res.data?.skippedCount ?? skippedList.length;

      const approvedHtml = approvedList.length
        ? `<div class="mb-3">
             <div class="font-bold text-emerald-600 dark:text-emerald-400 mb-1.5 flex items-center gap-1.5 text-xs">
               <span class="material-symbols-outlined text-[18px]">check_circle</span>
               Berhasil Disetujui (${approvedCount} Siswa):
             </div>
             <ul class="max-h-36 overflow-y-auto text-xs bg-emerald-500/10 dark:bg-emerald-950/30 p-3 rounded-xl text-left list-disc list-inside space-y-1 font-medium text-emerald-950 dark:text-emerald-200">
               ${approvedList.map((s) => `<li>${s.name}</li>`).join("")}
             </ul>
           </div>`
        : "";

      const skippedHtml = skippedList.length
        ? `<div>
             <div class="font-bold text-amber-600 dark:text-amber-400 mb-1.5 flex items-center gap-1.5 text-xs">
               <span class="material-symbols-outlined text-[18px]">warning</span>
               Dilewati / Belum Lengkap (${skippedCount} Siswa):
             </div>
             <ul class="max-h-40 overflow-y-auto text-xs bg-amber-500/10 dark:bg-amber-950/30 p-3 rounded-xl text-left list-disc list-inside space-y-1 text-amber-950 dark:text-amber-200">
               ${skippedList
                 .map(
                   (s) =>
                     `<li><strong>${s.name}</strong> <span class="text-xs text-amber-700 dark:text-amber-400">(${s.reason})</span></li>`
                 )
                 .join("")}
             </ul>
           </div>`
        : "";

      Swal.fire({
        title: "Hasil Persetujuan Raport Masal",
        html: `
          <div class="text-left text-sm space-y-3">
            <p class="text-on-surface-variant text-xs">
              Laporan hasil eksekusi persetujuan masal untuk <strong>Kelas ${data?.class?.name ?? ""}</strong>:
            </p>
            ${approvedHtml}
            ${skippedHtml}
          </div>
        `,
        icon: approvedCount > 0 ? "success" : "info",
        confirmButtonText: "Selesai",
        confirmButtonColor: "#3b82f6",
      });

      await loadMatrix(selectedClassId);
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Approve",
        text: e.message || "Gagal memproses persetujuan raport masal",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleApproveSingle = async (studentId: string, studentName: string) => {
    if (!selectedClassId) return;

    setBusy(true);
    try {
      const res = await api<ApproveResult>("/homeroom/approve", {
        method: "POST",
        body: JSON.stringify({
          classId: selectedClassId,
          studentIds: [studentId],
        }),
      });

      Swal.fire({
        title: "Raport Disetujui!",
        text: `Raport siswa "${studentName}" berhasil disetujui dan siap diterbitkan ke halaman siswa.`,
        icon: "success",
        timer: 2000,
        showConfirmButton: false,
      });

      await loadMatrix(selectedClassId);
    } catch (e: any) {
      Swal.fire({
        title: "Tidak Dapat Disetujui",
        text: e.message || `Raport ${studentName} belum lengkap atau masih berstatus Draft`,
        icon: "warning",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const rejectAll = async () => {
    if (!selectedClassId) return;
    const confirmRes = await Swal.fire({
      title: "Minta Koreksi Ulang?",
      text: "Kembalikan status nilai seluruh siswa kelas ini ke Draft agar guru bisa mengkoreksi nilai?",
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#0284c7",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Minta Koreksi",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });
    if (!confirmRes.isConfirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ success: boolean; message?: string }>("/homeroom/reject", {
        method: "POST",
        body: JSON.stringify({ classId: selectedClassId }),
      });
      Swal.fire({
        title: "Berhasil",
        text: res.message || "Nilai berhasil diset untuk koreksi ulang!",
        icon: "success",
        timer: 1800,
        showConfirmButton: false,
      });
      await loadMatrix(selectedClassId);
    } catch (e) {
      Swal.fire({
        title: "Gagal",
        text: e instanceof Error ? e.message : "Gagal memproses koreksi ulang",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteStudentGrades = async (studentId: string, studentName: string) => {
    const result = await Swal.fire({
      title: "Hapus Nilai Siswa (Soft Delete)?",
      text: `Apakah Anda yakin ingin menghapus seluruh data nilai siswa "${studentName}"? Data akan disembunyikan (soft delete).`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Hapus Nilai",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    setBusy(true);
    setMessage(null);
    try {
      const res = await api<{ message?: string }>(
        `/admin/grades/student/${studentId}?classId=${selectedClassId}`,
        { method: "DELETE" }
      );
      Swal.fire({
        title: "Berhasil!",
        text: res.message || "Data nilai siswa berhasil dihapus.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      await loadMatrix(selectedClassId);
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Hapus",
        text: e.message || "Gagal menghapus nilai siswa",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteSubjectGrade = async (
    subjectId: string,
    subjectName: string,
    studentId: string,
    studentName: string
  ) => {
    if (!selectedClassId) return;

    const result = await Swal.fire({
      title: `Hapus Mapel "${subjectName}"?`,
      html: `
        <div class="text-left text-sm space-y-3">
          <p class="text-on-surface-variant">Pilih cakupan penghapusan catatan nilai mata pelajaran ini:</p>
          <div class="space-y-2">
            <label class="flex items-start gap-2.5 p-3 rounded-xl border border-outline-variant/40 hover:bg-surface-container-high cursor-pointer transition-colors">
              <input type="radio" name="deleteScope" value="single" class="mt-1" />
              <div>
                <div class="font-semibold text-on-surface">Siswa Ini Saja (${studentName})</div>
                <div class="text-xs text-on-surface-variant">Menghapus record mapel ${subjectName} khusus milik ${studentName}</div>
              </div>
            </label>
            <label class="flex items-start gap-2.5 p-3 rounded-xl border border-red-500/30 bg-red-500/5 hover:bg-red-500/10 cursor-pointer transition-colors">
              <input type="radio" name="deleteScope" value="class" class="mt-1 accent-red-600" />
              <div>
                <div class="font-semibold text-red-600 dark:text-red-400">Seluruh Siswa di Kelas (${data?.class?.name ?? ""})</div>
                <div class="text-xs text-red-600/80 dark:text-red-400/80">Gunakan ini jika guru mapel tidak sengaja memilih/mengisi kelas ini</div>
              </div>
            </label>
          </div>
          <p class="text-xs text-on-surface-variant italic mt-1">
            * Data yang dihapus dapat dipulihkan kapan saja oleh Admin melalui menu Tempat Sampah.
          </p>
        </div>
      `,
      showCancelButton: true,
      confirmButtonText: "Hapus Mapel",
      cancelButtonText: "Batal",
      confirmButtonColor: "#ef4444",
      didOpen: () => {
        const confirmBtn = Swal.getConfirmButton();
        if (confirmBtn) {
          confirmBtn.disabled = true;
          confirmBtn.style.opacity = "0.4";
          confirmBtn.style.cursor = "not-allowed";
        }
        const radios = document.getElementsByName("deleteScope") as NodeListOf<HTMLInputElement>;
        for (const r of radios) {
          r.addEventListener("change", () => {
            if (confirmBtn) {
              confirmBtn.disabled = false;
              confirmBtn.style.opacity = "1";
              confirmBtn.style.cursor = "pointer";
            }
          });
        }
      },
      preConfirm: () => {
        const radios = document.getElementsByName("deleteScope") as NodeListOf<HTMLInputElement>;
        let selectedScope: string | null = null;
        for (const r of radios) {
          if (r.checked) selectedScope = r.value;
        }
        if (!selectedScope) {
          Swal.showValidationMessage("Silakan pilih cakupan penghapusan terlebih dahulu.");
          return false;
        }
        return selectedScope;
      },
    });

    if (!result.isConfirmed) return;

    const scope = result.value;
    const isSingle = scope === "single";

    setBusy(true);
    try {
      const res = await api<{ deletedCount: number }>("/homeroom/delete-subject-grade", {
        method: "POST",
        body: JSON.stringify({
          classId: selectedClassId,
          subjectId,
          studentId: isSingle ? studentId : undefined,
        }),
      });

      Swal.fire({
        title: "Berhasil Dihapus",
        text: res.message || "Catatan mapel berhasil dihapus",
        icon: "success",
        timer: 2000,
        showConfirmButton: false,
      });

      await loadMatrix(selectedClassId);
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Hapus",
        text: e.message || "Gagal menghapus catatan mapel",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const summary = data?.summary;

  return (
    <div className="space-y-5">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <p className="text-sm text-on-surface-variant">Persetujuan Raport</p>
          <h1 className="font-display text-2xl md:text-3xl font-bold">
            Matrix Persetujuan Nilai
          </h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Tinjau nilai agregat komponen, poin kedisiplinan, dan absensi sebelum persetujuan raport.
          </p>
        </div>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
          {classes.length > 0 && (
            <select
              className="app-input min-w-[150px] px-3.5 py-2 text-sm rounded-xl border border-outline-variant/30 bg-surface"
              value={selectedClassId}
              onChange={(e) => setSelectedClassId(e.target.value)}
            >
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  Kelas {c.name}
                </option>
              ))}
            </select>
          )}
          <Button
            onClick={approveAll}
            disabled={busy || !selectedClassId || Boolean(summary && summary.ready === 0)}
            title={summary && summary.ready === 0 ? "Tidak ada nilai berstatus Ready/Submitted yang bisa disetujui" : ""}
          >
            <span className="material-symbols-outlined text-[18px]">verified</span>
            Approve for Report Card
          </Button>
          <Button variant="secondary" onClick={rejectAll} disabled={busy || !selectedClassId}>
            <span className="material-symbols-outlined text-[18px]">replay</span>
            Koreksi Ulang
          </Button>
        </div>
      </div>

      {message && (
        <div className="rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 text-emerald-900 dark:text-emerald-100 px-4 py-3 text-sm font-medium">
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {loading || !summary
          ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />)
          : [
              { label: "Total Siswa", value: summary.total, sub: data?.class?.name },
              { label: "Selesai", value: `${summary.progress}%`, sub: `${summary.approved} approved` },
              { label: "Pending", value: summary.ready, sub: "Membutuhkan aksi" },
              { label: "Data Kurang", value: summary.incomplete, sub: "Incomplete" },
            ].map((s) => (
              <Card key={s.label} className="p-4">
                <div className="text-xs text-on-surface-variant">{s.label}</div>
                <div className="font-display text-2xl font-bold mt-1">{s.value}</div>
                <div className="text-xs text-on-surface-variant mt-1">{s.sub}</div>
              </Card>
            ))}
      </div>

      <Card className="overflow-hidden">
        <div className="p-3 border-b border-outline-variant/20 flex flex-wrap items-center justify-between gap-2 bg-surface-container-low/40">
          <span className="text-xs text-on-surface-variant">
            💡 Klik tombol panah pada nama siswa untuk membuka rincian nilai per mata pelajaran.
          </span>
          <Button
            variant="secondary"
            size="sm"
            onClick={toggleExpandAll}
            className="!py-1 !px-2.5 text-xs gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">
              {isAllExpanded ? "unfold_less" : "unfold_more"}
            </span>
            {isAllExpanded ? "Tutup Semua Detail Mapel" : "Buka Semua Detail Mapel"}
          </Button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm table-sticky-name min-w-[850px]">
            <thead className="bg-surface-container/80 dark:bg-white/5 text-left">
              <tr>
                <th className="px-3 py-3 font-semibold text-center w-12">No</th>
                <th className="px-4 py-3 font-semibold">Nama Siswa</th>
                {visibleComponents.map((c) => (
                  <th key={c.code} className="px-3 py-3 font-semibold uppercase">
                    {c.code} (Rata2)
                  </th>
                ))}
                <th className="px-3 py-3 font-semibold">GDS</th>
                <th className="px-3 py-3 font-semibold">BK (S/I/A)</th>
                <th className="px-3 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Aksi Persetujuan</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 4 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6 + visibleComponents.length} className="px-4 py-3">
                        <Skeleton className="h-10 w-full" />
                      </td>
                    </tr>
                  ))
                : pager.pageItems.map((s, index) => {
                    const isExpanded = expandedStudentIds.has(s.studentId);
                    const rowNo = pager.from + index;
                    return (
                      <React.Fragment key={s.studentId}>
                        <tr className="border-t border-outline-variant/20 hover:bg-surface-container/40">
                          <td className="px-3 py-3 font-mono text-xs text-on-surface-variant text-center w-12 font-semibold">
                            {rowNo}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => toggleExpand(s.studentId)}
                                className="p-1 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-primary focus:outline-none"
                                title={isExpanded ? "Sembunyikan rincian mapel" : "Tampilkan rincian mapel"}
                              >
                                <span
                                  className="material-symbols-outlined text-[20px] transition-transform duration-200"
                                  style={{ transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}
                                >
                                  chevron_right
                                </span>
                              </button>
                              <div>
                                <div className="font-medium flex items-center gap-1.5">
                                  <span>{s.name}</span>
                                  <span className="text-[11px] font-normal px-1.5 py-0.5 rounded bg-surface-container-high text-on-surface-variant">
                                    {s.grades?.length ?? s.gradeCount ?? 0} Mapel
                                  </span>
                                </div>
                                <div className="text-xs text-on-surface-variant">NISN: {s.nisn ?? "—"}</div>
                              </div>
                            </div>
                          </td>
                          {visibleComponents.map((c) => {
                            const k = c.code.toLowerCase() as keyof typeof s;
                            if (c.status === "disabled") {
                              return (
                                <td key={c.code} className="px-3 py-3">
                                  <span className="inline-block text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                    Segera Hadir
                                  </span>
                                </td>
                              );
                            }
                            return (
                              <td key={c.code} className="px-3 py-3 font-medium">
                                {(s as any)[k] ?? "—"}
                              </td>
                            );
                          })}
                          <td className="px-3 py-3 whitespace-nowrap">
                            <div className="flex flex-col gap-0.5">
                              <span className="font-medium whitespace-nowrap">{s.poinGds} points</span>
                              {s.catatanGds && (
                                <span
                                  className="inline-block text-[10px] text-primary/80 bg-primary/10 px-1.5 py-0.5 rounded leading-tight max-w-[120px] truncate"
                                  title={s.catatanGds}
                                >
                                  💬 {s.catatanGds}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3 whitespace-nowrap">
                            <div className="flex flex-col gap-0.5">
                              <span>S: {s.sakit} · I: {s.izin} · A: {s.alpa}</span>
                              {s.catatanKehadiran && (
                                <span
                                  className="inline-block text-[10px] text-amber-600 dark:text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded leading-tight max-w-[120px] truncate"
                                  title={s.catatanKehadiran}
                                >
                                  💬 {s.catatanKehadiran}
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-3">
                            <Badge status={s.status}>{s.status}</Badge>
                          </td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="inline-flex items-center gap-1.5 justify-end">
                              <a
                                href={`/u/${s.studentId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-surface-container-high hover:bg-primary/10 hover:text-primary text-on-surface-variant text-xs font-semibold transition-colors border border-outline-variant/30"
                                title="Lihat Profil Publik Siswa (Buka di tab baru)"
                              >
                                <span className="material-symbols-outlined text-[16px]">visibility</span>
                                Lihat Profil
                              </a>

                              {s.status === "approved" ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-xs font-semibold">
                                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                                  Disetujui
                                </span>
                              ) : s.status === "ready" ? (
                                <Button
                                  size="sm"
                                  className="!bg-emerald-600 hover:!bg-emerald-700 !text-white !py-1 !px-2.5 text-xs gap-1 shadow-sm font-medium"
                                  disabled={busy}
                                  onClick={() => handleApproveSingle(s.studentId, s.name)}
                                >
                                  <span className="material-symbols-outlined text-[16px]">verified</span>
                                  Approve Raport
                                </Button>
                              ) : (
                                <span
                                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg bg-surface-container-high text-on-surface-variant/70 text-xs font-medium"
                                  title="Nilai belum lengkap atau masih berstatus Draft"
                                >
                                  <span className="material-symbols-outlined text-[14px]">lock</span>
                                  Belum Lengkap
                                </span>
                              )}

                              {isSuperAdmin && s.status !== "incomplete" && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  className="!bg-red-500/10 hover:!bg-red-500/20 !text-red-600 dark:!text-red-400 !py-1 !px-2 text-xs gap-1"
                                  disabled={busy}
                                  onClick={() => handleDeleteStudentGrades(s.studentId, s.name)}
                                  title="Hapus seluruh nilai siswa ini (Superadmin)"
                                >
                                  <span className="material-symbols-outlined text-[14px]">delete</span>
                                  Hapus Nilai
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {isExpanded && (
                          <tr className="bg-surface-container-lowest/80 dark:bg-black/30">
                            <td colSpan={6 + visibleComponents.length} className="p-3 border-b border-outline-variant/30">
                              <div className="rounded-xl border border-outline-variant/30 overflow-hidden bg-surface dark:bg-surface-container/60 shadow-sm">
                                <div className="px-4 py-2.5 bg-primary/10 dark:bg-primary/20 border-b border-outline-variant/20 flex items-center justify-between text-xs">
                                  <div className="font-semibold text-primary flex items-center gap-1.5">
                                    <span className="material-symbols-outlined text-[16px]">menu_book</span>
                                    Rincian Nilai Mata Pelajaran — {s.name}
                                  </div>
                                  <div className="text-on-surface-variant font-medium">
                                    {s.grades?.length ?? 0} Mata Pelajaran Terdata
                                  </div>
                                </div>
                                {s.grades && s.grades.length > 0 ? (
                                  <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left">
                                      <thead className="bg-surface-container-high/60 dark:bg-white/5 font-semibold text-on-surface-variant border-b border-outline-variant/20">
                                        <tr>
                                          <th className="px-4 py-2 w-10">No</th>
                                          <th className="px-4 py-2">Mata Pelajaran</th>
                                          {visibleComponents.map((c) => (
                                            <th key={c.code} className="px-3 py-2 text-center uppercase">
                                              {c.code}
                                            </th>
                                          ))}
                                          <th className="px-4 py-2 text-center">Status Subjek</th>
                                          <th className="px-4 py-2 text-right">Aksi</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-outline-variant/10">
                                        {s.grades.map((g, idx) => (
                                          <tr key={idx} className="hover:bg-surface-container/40">
                                            <td className="px-4 py-2 text-on-surface-variant font-mono">{idx + 1}</td>
                                            <td className="px-4 py-2 font-medium">{g.subjectName}</td>
                                            {visibleComponents.map((c) => {
                                              const k = c.code.toLowerCase() as keyof typeof g;
                                              if (c.status === "disabled") {
                                                return (
                                                  <td key={c.code} className="px-3 py-2 text-center">
                                                    <span className="inline-block text-[10px] bg-amber-500/15 text-amber-600 dark:text-amber-400 px-2 py-0.5 rounded-full font-semibold whitespace-nowrap">
                                                      Segera Hadir
                                                    </span>
                                                  </td>
                                                );
                                              }
                                              return (
                                                <td key={c.code} className="px-3 py-2 text-center">
                                                  {g[k] ?? "—"}
                                                </td>
                                              );
                                            })}
                                            <td className="px-4 py-2 text-center">
                                              <Badge status={g.status}>{g.status}</Badge>
                                            </td>
                                            <td className="px-4 py-2 text-right whitespace-nowrap">
                                               <button
                                                 type="button"
                                                 disabled={busy}
                                                 onClick={() =>
                                                   handleDeleteSubjectGrade(
                                                     g.subjectId,
                                                     g.subjectName,
                                                     s.studentId,
                                                     s.name
                                                   )
                                                 }
                                                 className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-600 dark:text-red-400 text-[11px] font-medium transition-colors disabled:opacity-50"
                                                 title="Hapus / batalkan record mapel ini"
                                               >
                                                 <span className="material-symbols-outlined text-[14px]">delete</span>
                                                 Hapus Mapel
                                               </button>
                                             </td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  </div>
                                ) : (
                                  <div className="p-4 text-center text-xs text-on-surface-variant italic">
                                    Belum ada data nilai mata pelajaran yang dimasukkan oleh guru untuk siswa ini.
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
            </tbody>
          </table>
        </div>
        {!loading && (
          <Pagination
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            onPageChange={pager.setPage}
          />
        )}
      </Card>
    </div>
  );
}
