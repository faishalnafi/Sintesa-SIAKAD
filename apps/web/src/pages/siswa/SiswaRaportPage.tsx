import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type Report = {
  student: {
    name: string;
    nis: string | null;
    className: string | null;
    poinGds: number;
    sakit: number;
    izin: number;
    alpa: number;
    catatanGds?: string | null;
    catatanKehadiran?: string | null;
  };
  grades: Array<{
    subjectName: string;
    uh1: string | null;
    t1: string | null;
    sts: string | null;
    uh2: string | null;
    t2: string | null;
    status: string;
  }>;
  canDownloadPdf?: boolean;
  isApproved?: boolean;
  pendingReason?: string | null;
  approvalDetails?: {
    allGradesApproved: boolean;
    isGdsApproved: boolean;
    isKehadiranApproved: boolean;
  };
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

/** Tentukan KKM berdasarkan nama kelas:
 *  Kelas X  / 10 → 80
 *  Kelas XI / 11 → 81
 *  Kelas XII/ 12 → 82
 *  Default       → 80
 */
function getKkm(className: string | null | undefined): number {
  if (!className) return 80;
  const upper = className.toUpperCase();
  if (/\bXII\b|12/.test(upper)) return 82;
  if (/\bXI\b|11/.test(upper)) return 81;
  if (/\bX\b|10/.test(upper)) return 80;
  return 80;
}

/** Render ✓ (tuntas, hijau), ✗ (tidak tuntas, merah), atau – (segera hadir, amber) berdasarkan status komponen */
const renderKkmIndicator = (
  val: string | number | null,
  kkm: number,
  compStatus: "active" | "disabled" | "inactive" = "active"
) => {
  if (compStatus === "disabled") {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 font-bold text-xs"
        title="Segera Hadir"
      >
        –
      </span>
    );
  }

  if (val === null || val === undefined || val === "") {
    return (
      <span
        className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-500/15 text-rose-500 dark:text-rose-400 font-bold text-sm"
        title="Belum Terisi"
      >
        ✗
      </span>
    );
  }
  const numeric = Number(val);
  const tuntas = !isNaN(numeric) && numeric >= kkm;
  return tuntas ? (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-sm"
      title={`Tuntas (${numeric} ≥ KKM ${kkm})`}
    >
      ✓
    </span>
  ) : (
    <span
      className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-rose-500/15 text-rose-500 dark:text-rose-400 font-bold text-sm"
      title={`Tidak Tuntas (${numeric} < KKM ${kkm})`}
    >
      ✗
    </span>
  );
};

export function SiswaRaportPage() {
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(true);
  const [assessmentComponents, setAssessmentComponents] = useState<AssessmentComponent[]>(defaultComponents);
  const [downloading, setDownloading] = useState(false);
  const pager = usePagination(data?.grades ?? []);

  const canDownload = !loading && Boolean(data?.canDownloadPdf);

  const handleDownloadPdf = async () => {
    if (!canDownload) {
      await Swal.fire({
        icon: "warning",
        title: "Raport Belum Dapat Diunduh",
        text: data?.pendingReason || "Raport belum disetujui lengkap oleh Wali Kelas (nilai mata pelajaran, kehadiran, dan kedisiplinan).",
        confirmButtonColor: "#2563eb",
      });
      return;
    }

    setDownloading(true);
    try {
      const res = await fetch("/api/student/report/pdf", { credentials: "include" });
      if (!res.ok) {
        let errMessage = `Gagal mengunduh raport (${res.status})`;
        try {
          const errJson = await res.json();
          if (errJson?.message) errMessage = errJson.message;
        } catch {}
        throw new Error(errMessage);
      }
      const disposition = res.headers.get("Content-Disposition") ?? "";
      const match = disposition.match(/filename="?([^";]+)"?/);
      const filename = match?.[1] ?? "raport.pdf";
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (e) {
      await Swal.fire({
        icon: "error",
        title: "Unduh Gagal",
        text: e instanceof Error ? e.message : "Gagal mengunduh raport",
        confirmButtonColor: "#2563eb",
      });
    } finally {
      setDownloading(false);
    }
  };

  const fetchReport = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api<Report>("/student/report");
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
      // fallback to defaults
    }
  };

  useEffect(() => {
    fetchReport();
    fetchComponents();
  }, []);

  useRealtimeEvent(
    [
      "grade_approved",
      "grade_rejected",
      "grade_deleted",
      "grade_data_restored",
      "student_updated",
      "sync_completed",
      "subject_updated",
    ],
    () => {
      fetchReport(true);
      fetchComponents();
    }
  );

  const kkm = getKkm(data?.student?.className);
  const visibleComponents = assessmentComponents.filter((c) => c.status !== "inactive");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold">Raport &amp; Status Ketuntasan Nilai</h1>
          <p className="text-sm text-on-surface-variant mt-1">
            Menampilkan status ketuntasan nilai per mata pelajaran berdasarkan KKM{" "}
            <span className="font-semibold text-primary">
              {data?.student?.className
                ? `Kelas ${data.student.className} (KKM ${kkm})`
                : `(KKM ${kkm})`}
            </span>
            {" "}— ✓ Tuntas &nbsp;/&nbsp; ✗ Tidak Tuntas &nbsp;/&nbsp; – Segera Hadir
          </p>
        </div>
        <button
          type="button"
          onClick={handleDownloadPdf}
          disabled={downloading || !canDownload}
          title={
            !canDownload
              ? (data?.pendingReason || "Raport belum disetujui lengkap oleh wali kelas")
              : "Unduh Raport Siswa (PDF)"
          }
          className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="material-symbols-outlined text-[18px]">
            {!canDownload ? "lock" : "download"}
          </span>
          {downloading ? "Menyiapkan PDF..." : "Unduh Raport (PDF)"}
        </button>
      </div>

      {!loading && !canDownload && (
        <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-900 dark:text-amber-200 flex items-start gap-3">
          <span className="material-symbols-outlined text-amber-600 dark:text-amber-400 text-xl shrink-0 mt-0.5">
            lock_clock
          </span>
          <div className="text-sm">
            <p className="font-semibold text-amber-900 dark:text-amber-100">
              Raport PDF Belum Dapat Diunduh
            </p>
            <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
              {data?.pendingReason || "Menunggu persetujuan lengkap dari Wali Kelas (nilai mata pelajaran, kehadiran, dan kedisiplinan)."}
            </p>
            <p className="mt-1 text-xs opacity-90 text-amber-700 dark:text-amber-300">
              Nilai mata pelajaran hanya akan tampil di web dan dapat diunduh setelah disetujui oleh wali kelas. Rekap presensi dan kedisiplinan tetap dapat dilihat secara langsung di bawah.
            </p>
          </div>
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-sticky-name min-w-[640px]">
            <thead className="bg-surface-container/80 dark:bg-white/5 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Mata Pelajaran</th>
                {visibleComponents.map((c) => (
                  <th key={c.code} className="px-3 py-3 font-semibold text-center uppercase">
                    {c.code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={1 + visibleComponents.length} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                : pager.pageItems.map((g) => (
                    <tr key={g.subjectName} className="border-t border-outline-variant/20 hover:bg-surface-container/30 transition-colors">
                      <td className="px-4 py-3 font-medium whitespace-nowrap">{g.subjectName}</td>
                      {visibleComponents.map((c) => {
                        const k = c.code.toLowerCase() as keyof typeof g;
                        return (
                          <td key={c.code} className="px-3 py-3 text-center">
                            {renderKkmIndicator(g[k] as any, kkm, c.status)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
            </tbody>
          </table>
        </div>
        {!loading && pager.total === 0 && (
          <div className="p-6 text-sm text-on-surface-variant flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-amber-500">schedule</span>
            <span>
              Nilai mata pelajaran belum disetujui oleh wali kelas. Nilai akan otomatis tampil setelah wali kelas melakukan persetujuan.
            </span>
          </div>
        )}
        {!loading && pager.total > 0 && (
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

      {/* Rekap Presensi & Tata Tertib (GDS) */}
      <Card className="p-4 md:p-6 border border-outline-variant/30 shadow-sm">
        <h3 className="font-display font-bold text-base mb-3 text-on-surface">
          Rekap Presensi &amp; Tata Tertib (GDS)
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: "Poin GDS", value: data?.student.poinGds ?? 0, icon: "stars", unit: "Poin", color: "text-primary bg-primary/10" },
            { label: "Sakit (S)", value: data?.student.sakit ?? 0, icon: "medical_services", unit: "Hari", color: "text-amber-500 bg-amber-500/10" },
            { label: "Izin (I)", value: data?.student.izin ?? 0, icon: "event_available", unit: "Hari", color: "text-emerald-500 bg-emerald-500/10" },
            { label: "Tanpa Keterangan (A)", value: data?.student.alpa ?? 0, icon: "person_off", unit: "Hari", color: "text-rose-500 bg-rose-500/10" },
          ].map((item) => (
            <div key={item.label} className="p-3 rounded-xl bg-surface-container/50 border border-outline-variant/20 flex flex-col justify-between">
              <div className="flex items-center gap-2 text-xs text-on-surface-variant font-medium">
                <span className={`p-1 rounded-lg ${item.color}`}>
                  <span className="material-symbols-outlined text-[15px] block">{item.icon}</span>
                </span>
                <span className="truncate">{item.label}</span>
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="font-display text-2xl font-bold text-on-surface">
                  {loading ? "..." : item.value}
                </span>
                <span className="text-xs text-on-surface-variant font-medium">{item.unit}</span>
              </div>
            </div>
          ))}
        </div>

        {/* Catatan jika ada */}
        {!loading && data?.student?.catatanGds && (
          <div className="mt-3 p-3 rounded-xl bg-primary/5 border border-primary/20 text-xs text-primary flex items-start gap-2">
            <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">info</span>
            <div>
              <span className="font-semibold">Catatan Kedisiplinan: </span>
              {data.student.catatanGds}
            </div>
          </div>
        )}
        {!loading && data?.student?.catatanKehadiran && (
          <div className="mt-2 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20 text-xs text-amber-700 dark:text-amber-300 flex items-start gap-2">
            <span className="material-symbols-outlined text-[16px] shrink-0 mt-0.5">event_note</span>
            <div>
              <span className="font-semibold">Catatan Presensi: </span>
              {data.student.catatanKehadiran}
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
