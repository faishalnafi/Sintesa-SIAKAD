import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type TrashJournal = {
  id: string;
  date: string;
  className: string;
  subjectName: string;
  teachingHourLabel: string;
  teacherName: string;
  materi: string;
  presenceInfo: string;
  deletedAt: string;
};

type TrashGrade = {
  id: string;
  studentName: string;
  nisn: string | null;
  className: string;
  subjectName: string;
  academicYear: string;
  semester: number;
  deletedAt: string;
};

export function TrashPage() {
  const [activeTab, setActiveTab] = useState<"journals" | "grades">("journals");
  const [journals, setJournals] = useState<TrashJournal[]>([]);
  const [grades, setGrades] = useState<TrashGrade[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const loadJournals = async () => {
    setLoading(true);
    try {
      const res = await api<TrashJournal[]>("/admin/trash/journals");
      setJournals(res.data ?? []);
    } catch (e) {
      console.error("Gagal memuat tempat sampah jurnal:", e);
    } finally {
      setLoading(false);
    }
  };

  const loadGrades = async () => {
    setLoading(true);
    try {
      const res = await api<TrashGrade[]>("/admin/trash/grades");
      setGrades(res.data ?? []);
    } catch (e) {
      console.error("Gagal memuat tempat sampah nilai:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "journals") {
      loadJournals();
    } else {
      loadGrades();
    }
  }, [activeTab]);

  // Realtime: auto-refresh Trash page saat ada jurnal/nilai dihapus atau dipulihkan
  useRealtimeEvent(
    ["journal_saved", "journal_deleted", "grade_data_restored", "grade_deleted"],
    () => {
      if (activeTab === "journals") {
        loadJournals();
      } else {
        loadGrades();
      }
    }
  );

  // Restore Journal with conflict handling
  const handleRestoreJournal = async (id: string, label: string) => {
    setBusy(true);
    try {
      const res = await api<{ message?: string }>(`/admin/trash/journals/${id}/restore`, {
        method: "POST",
      });

      Swal.fire({
        title: "Berhasil Dipulihkan!",
        text: res.message || "Jurnal mengajar berhasil dipulihkan dari Tempat Sampah.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      await loadJournals();
    } catch (e: any) {
      if (e.status === 409 || e.conflict || e.message?.includes("Sudah terdapat data jurnal baru")) {
        const conflictResult = await Swal.fire({
          title: "Bentrokan Data Baru Terdeteksi!",
          text: "Guru sudah menginput data jurnal baru di tanggal & jam mengajar yang sama. Pilih aksi:",
          icon: "warning",
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonColor: "#dc2626", // Merah
          denyButtonColor: "#2563eb",   // Biru
          cancelButtonColor: "#6b7280", // Gray
          confirmButtonText: "Timpa dengan Data Lama",
          denyButtonText: "Biarkan Data Baru",
          cancelButtonText: "Batal",
        });

        if (conflictResult.isConfirmed) {
          try {
            const res2 = await api<{ message?: string }>(`/admin/trash/journals/${id}/restore?overwrite=true`, {
              method: "POST",
            });
            Swal.fire({
              title: "Berhasil Menimpa!",
              text: res2.message || "Data jurnal lama dipulihkan dan menimpa data baru.",
              icon: "success",
              timer: 2000,
              showConfirmButton: false,
            });
            await loadJournals();
          } catch (err: any) {
            Swal.fire({ title: "Gagal", text: err.message || "Gagal menimpa data", icon: "error" });
          }
        }
      } else {
        Swal.fire({
          title: "Gagal",
          text: e.message || "Gagal memulihkan jurnal",
          icon: "error",
          confirmButtonColor: "#ef4444",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // Permanent Delete Journal
  const handlePermanentDeleteJournal = async (id: string, label: string) => {
    const confirm = await Swal.fire({
      title: "HAPUS PERMANEN?",
      text: `PERHATIAN: Jurnal (${label}) akan dihapus secara PERMANEN dari database dan tidak dapat dikembalikan!`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Hapus Permanen",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!confirm.isConfirmed) return;

    setBusy(true);
    try {
      const res = await api<{ message?: string }>(`/admin/trash/journals/${id}/permanent`, {
        method: "DELETE",
      });
      Swal.fire({
        title: "Dihapus Permanen!",
        text: res.message || "Jurnal berhasil dihapus permanen.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      await loadJournals();
    } catch (e: any) {
      Swal.fire({
        title: "Gagal",
        text: e.message || "Gagal menghapus jurnal secara permanen",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  // Restore Grade with conflict handling
  const handleRestoreGrade = async (id: string, studentName: string) => {
    setBusy(true);
    try {
      const res = await api<{ message?: string }>(`/admin/trash/grades/${id}/restore`, {
        method: "POST",
      });

      Swal.fire({
        title: "Berhasil Dipulihkan!",
        text: res.message || "Data nilai berhasil dipulihkan dari Tempat Sampah.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      await loadGrades();
    } catch (e: any) {
      if (e.status === 409 || e.conflict || e.message?.includes("Sudah terdapat data nilai baru")) {
        const conflictResult = await Swal.fire({
          title: "Bentrokan Data Baru Terdeteksi!",
          text: `Sudah terdapat data nilai baru yang diisi untuk ${studentName}. Pilih aksi:`,
          icon: "warning",
          showCancelButton: true,
          showDenyButton: true,
          confirmButtonColor: "#dc2626", // Merah
          denyButtonColor: "#2563eb",   // Biru
          cancelButtonColor: "#6b7280", // Gray
          confirmButtonText: "Timpa dengan Data Lama",
          denyButtonText: "Biarkan Data Baru",
          cancelButtonText: "Batal",
        });

        if (conflictResult.isConfirmed) {
          try {
            const res2 = await api<{ message?: string }>(`/admin/trash/grades/${id}/restore?overwrite=true`, {
              method: "POST",
            });
            Swal.fire({
              title: "Berhasil Menimpa!",
              text: res2.message || "Data nilai lama dipulihkan dan menimpa data baru.",
              icon: "success",
              timer: 2000,
              showConfirmButton: false,
            });
            await loadGrades();
          } catch (err: any) {
            Swal.fire({ title: "Gagal", text: err.message || "Gagal menimpa data", icon: "error" });
          }
        }
      } else {
        Swal.fire({
          title: "Gagal",
          text: e.message || "Gagal memulihkan nilai",
          icon: "error",
          confirmButtonColor: "#ef4444",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  // Permanent Delete Grade
  const handlePermanentDeleteGrade = async (id: string, studentName: string) => {
    const confirm = await Swal.fire({
      title: "HAPUS PERMANEN?",
      text: `PERHATIAN: Data nilai siswa ${studentName} akan dihapus secara PERMANEN dari database dan tidak dapat dikembalikan!`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Hapus Permanen",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!confirm.isConfirmed) return;

    setBusy(true);
    try {
      const res = await api<{ message?: string }>(`/admin/trash/grades/${id}/permanent`, {
        method: "DELETE",
      });
      Swal.fire({
        title: "Dihapus Permanen!",
        text: res.message || "Data nilai berhasil dihapus permanen.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      await loadGrades();
    } catch (e: any) {
      Swal.fire({
        title: "Gagal",
        text: e.message || "Gagal menghapus nilai secara permanen",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  // Empty Entire Trash Permanently
  const handleEmptyTrash = async () => {
    const isJournal = activeTab === "journals";
    const count = isJournal ? journals.length : grades.length;

    if (count === 0) {
      Swal.fire({
        title: "Tempat Sampah Kosong",
        text: "Tidak ada data yang perlu dihapus.",
        icon: "info",
        confirmButtonColor: "#2563eb",
      });
      return;
    }

    const confirm = await Swal.fire({
      title: "HAPUS SEMUA DATA PERMANEN?",
      text: `PERHATIAN: Seluruh ${count} entri data ${
        isJournal ? "Jurnal Mengajar" : "Nilai Siswa"
      } di Tempat Sampah akan dihapus secara PERMANEN dari database! Aksi ini tidak dapat dibatalkan.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Hapus Semua Permanen",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!confirm.isConfirmed) return;

    setBusy(true);
    try {
      const endpoint = isJournal ? "/admin/trash/journals/empty" : "/admin/trash/grades/empty";
      const res = await api<{ message?: string }>(endpoint, { method: "DELETE" });
      Swal.fire({
        title: "Tempat Sampah Dikosongkan!",
        text: res.message || "Seluruh data sampah berhasil dihapus secara permanen.",
        icon: "success",
        timer: 2000,
        showConfirmButton: false,
      });
      if (isJournal) await loadJournals();
      else await loadGrades();
    } catch (e: any) {
      Swal.fire({
        title: "Gagal",
        text: e.message || "Gagal mengosongkan tempat sampah",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-4">
        <PageHeader
          title="Tempat Sampah (Recycle Bin)"
          description="Kelola dan pulihkan data jurnal mengajar & nilai siswa yang telah di-soft delete oleh Superadmin."
        />
        <Button
          variant="secondary"
          className="!bg-red-600 hover:!bg-red-700 !text-white gap-2 shrink-0"
          disabled={busy || (activeTab === "journals" ? journals.length === 0 : grades.length === 0)}
          onClick={handleEmptyTrash}
        >
          <span className="material-symbols-outlined text-[18px]">delete_forever</span>
          <span>Kosongkan Tempat Sampah</span>
        </Button>
      </div>

      {/* Tabs */}
      <div className="flex gap-3 border-b border-outline-variant/20 pb-2">
        <button
          onClick={() => setActiveTab("journals")}
          className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === "journals"
              ? "bg-primary text-on-primary shadow-sm"
              : "hover:bg-surface-container/60 app-muted"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">auto_stories</span>
          <span>Jurnal Mengajar Terhapus</span>
          {journals.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-white/20">
              {journals.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("grades")}
          className={`px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors flex items-center gap-2 ${
            activeTab === "grades"
              ? "bg-primary text-on-primary shadow-sm"
              : "hover:bg-surface-container/60 app-muted"
          }`}
        >
          <span className="material-symbols-outlined text-[18px]">grade</span>
          <span>Nilai Siswa Terhapus</span>
          {grades.length > 0 && (
            <span className="ml-1 px-2 py-0.5 rounded-full text-xs bg-white/20">
              {grades.length}
            </span>
          )}
        </button>
      </div>

      {/* Content Table */}
      <Card className="overflow-hidden">
        {activeTab === "journals" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[800px]">
              <thead className="bg-surface-container/80 dark:bg-white/5 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold">Tanggal</th>
                  <th className="px-4 py-3 font-semibold">Jam & Kelas</th>
                  <th className="px-4 py-3 font-semibold">Guru & Mapel</th>
                  <th className="px-4 py-3 font-semibold">Materi Pembelajaran</th>
                  <th className="px-4 py-3 font-semibold">Dihapus Pada</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi Pemulihan</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-3">
                        <Skeleton className="h-10 w-full" />
                      </td>
                    </tr>
                  ))
                ) : journals.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center app-muted">
                      Tempat sampah jurnal mengajar kosong.
                    </td>
                  </tr>
                ) : (
                  journals.map((j) => (
                    <tr key={j.id} className="border-t border-outline-variant/20 hover:bg-surface-container/40">
                      <td className="px-4 py-3 font-semibold whitespace-nowrap">{j.date}</td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium">{j.className}</div>
                        <div className="text-xs app-muted">{j.teachingHourLabel}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium">{j.teacherName}</div>
                        <div className="text-xs app-muted">{j.subjectName}</div>
                      </td>
                      <td className="px-4 py-3 max-w-[220px] truncate" title={j.materi}>
                        {j.materi || "—"}
                      </td>
                      <td className="px-4 py-3 text-xs app-muted whitespace-nowrap">
                        {new Date(j.deletedAt).toLocaleString("id-ID")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            className="!bg-emerald-600 hover:!bg-emerald-700 !text-white !py-1 !px-2.5 text-xs gap-1"
                            disabled={busy}
                            onClick={() => handleRestoreJournal(j.id, `${j.date} - ${j.className}`)}
                          >
                            <span className="material-symbols-outlined text-[16px]">restore_page</span>
                            Pulihkan
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="!bg-red-500/10 hover:!bg-red-500/20 !text-red-600 dark:!text-red-400 !py-1 !px-2.5 text-xs gap-1"
                            disabled={busy}
                            onClick={() => handlePermanentDeleteJournal(j.id, `${j.date} - ${j.className}`)}
                          >
                            <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                            Hapus Permanen
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead className="bg-surface-container/80 dark:bg-white/5 text-left">
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama Siswa</th>
                  <th className="px-4 py-3 font-semibold">Kelas & Mapel</th>
                  <th className="px-4 py-3 font-semibold">Tahun Pelajaran</th>
                  <th className="px-4 py-3 font-semibold">Dihapus Pada</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi Pemulihan</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={5} className="px-4 py-3">
                        <Skeleton className="h-10 w-full" />
                      </td>
                    </tr>
                  ))
                ) : grades.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center app-muted">
                      Tempat sampah nilai siswa kosong.
                    </td>
                  </tr>
                ) : (
                  grades.map((g) => (
                    <tr key={g.id} className="border-t border-outline-variant/20 hover:bg-surface-container/40">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium">{g.studentName}</div>
                        <div className="text-xs app-muted">NISN: {g.nisn ?? "—"}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="font-medium">{g.className}</div>
                        <div className="text-xs app-muted">{g.subjectName}</div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {g.academicYear} (S{g.semester})
                      </td>
                      <td className="px-4 py-3 text-xs app-muted whitespace-nowrap">
                        {new Date(g.deletedAt).toLocaleString("id-ID")}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex gap-2 justify-end">
                          <Button
                            size="sm"
                            className="!bg-emerald-600 hover:!bg-emerald-700 !text-white !py-1 !px-2.5 text-xs gap-1"
                            disabled={busy}
                            onClick={() => handleRestoreGrade(g.id, g.studentName)}
                          >
                            <span className="material-symbols-outlined text-[16px]">restore_page</span>
                            Pulihkan
                          </Button>
                          <Button
                            size="sm"
                            variant="secondary"
                            className="!bg-red-500/10 hover:!bg-red-500/20 !text-red-600 dark:!text-red-400 !py-1 !px-2.5 text-xs gap-1"
                            disabled={busy}
                            onClick={() => handlePermanentDeleteGrade(g.id, g.studentName)}
                          >
                            <span className="material-symbols-outlined text-[16px]">delete_forever</span>
                            Hapus Permanen
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
