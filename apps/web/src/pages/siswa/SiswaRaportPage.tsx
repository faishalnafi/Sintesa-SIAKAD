import { useEffect, useState } from "react";
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

  const handleDownloadPdf = async () => {
    setDownloading(true);
    try {
      const res = await fetch("/api/student/report/pdf", { credentials: "include" });
      if (!res.ok) throw new Error(`Gagal mengunduh raport (${res.status})`);
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
      alert(e instanceof Error ? e.message : "Gagal mengunduh raport");
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
    ["grade_approved", "grade_rejected", "grade_deleted", "subject_updated"],
    () => {
      fetchReport(true);
      fetchComponents();
    }
  );

  const kkm = getKkm(data?.student?.className);
  const visibleComponents = assessmentComponents.filter((c) => c.status !== "inactive");

  const canDownload = !loading && pager.total > 0;

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
        {canDownload && (
          <button
            type="button"
            onClick={handleDownloadPdf}
            disabled={downloading}
            className="shrink-0 inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-primary text-on-primary text-sm font-semibold shadow-sm hover:opacity-90 active:scale-[0.98] transition-all disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[18px]">download</span>
            {downloading ? "Menyiapkan PDF..." : "Unduh Raport (PDF)"}
          </button>
        )}
      </div>
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
          <div className="p-6 text-sm text-on-surface-variant">
            Belum ada raport approved. Minta guru submit &amp; wali kelas approve dulu.
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
    </div>
  );
}
