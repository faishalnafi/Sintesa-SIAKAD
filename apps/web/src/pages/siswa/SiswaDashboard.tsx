import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Badge } from "@/components/ui/Badge";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type Dash = {
  student: {
    name: string;
    nisn: string | null;
    className: string | null;
    poinGds: number;
    sakit: number;
    izin: number;
    alpa: number;
    catatanGds: string | null;
    catatanKehadiran: string | null;
  };
  grades: Array<{ subjectName: string; status: string }>;
};

export function SiswaDashboard() {
  const [data, setData] = useState<Dash | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const silentRef = useRef(false);

  const fetchDashboard = async (silent = false) => {
    if (!silent) setLoading(true);
    silentRef.current = silent;
    try {
      const res = await api<Dash>("/student/dashboard");
      setData(res.data ?? null);
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Gagal memuat");
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  // Realtime: refresh saat nilai di-approve/reject/hapus oleh walikelas
  useRealtimeEvent(
    ["grade_approved", "grade_rejected", "grade_deleted"],
    () => { fetchDashboard(true); }
  );

  if (error) {
    return (
      <Card className="p-6">
        <h1 className="font-display text-xl font-bold mb-2">Dashboard Siswa</h1>
        <p className="text-sm text-on-surface-variant">{error}</p>
      </Card>
    );
  }

  const catatanGds = data?.student.catatanGds;
  const catatanKehadiran = data?.student.catatanKehadiran;

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-on-surface-variant">Beranda</p>
        <h1 className="font-display text-2xl font-bold">
          {loading ? <Skeleton className="h-8 w-48" /> : `Halo, ${data?.student.name}`}
        </h1>
        <p className="text-sm text-on-surface-variant mt-1">
          {data?.student.className} · NISN {data?.student.nisn}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Poin GDS", value: data?.student.poinGds, icon: "stars" },
          { label: "Sakit", value: data?.student.sakit, icon: "medical_services" },
          { label: "Izin", value: data?.student.izin, icon: "event_available" },
          { label: "Alpa", value: data?.student.alpa, icon: "person_off" },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            {loading ? (
              <Skeleton className="h-16 w-full" />
            ) : (
              <>
                <div className="flex items-center gap-2 text-on-surface-variant text-xs mb-2">
                  <span className="material-symbols-outlined text-[18px]">{s.icon}</span>
                  {s.label}
                </div>
                <div className="font-display text-2xl font-bold text-primary dark:text-primary-fixed">
                  {s.value}
                </div>
              </>
            )}
          </Card>
        ))}
      </div>

      {/* Catatan dari Petugas GDS */}
      {!loading && catatanGds && (
        <Card className="p-4 border-l-4 border-primary bg-primary/5 dark:bg-primary/10">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-primary text-[20px] mt-0.5 shrink-0">
              stars
            </span>
            <div>
              <p className="text-xs font-bold text-primary uppercase tracking-wide mb-1">
                Catatan Petugas GDS
              </p>
              <p className="text-sm text-on-surface leading-relaxed">{catatanGds}</p>
            </div>
          </div>
        </Card>
      )}

      {/* Catatan dari Rekap Kehadiran */}
      {!loading && catatanKehadiran && (
        <Card className="p-4 border-l-4 border-amber-500 bg-amber-500/5 dark:bg-amber-500/10">
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-500 text-[20px] mt-0.5 shrink-0">
              event_note
            </span>
            <div>
              <p className="text-xs font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide mb-1">
                Catatan Kehadiran
              </p>
              <p className="text-sm text-on-surface leading-relaxed">{catatanKehadiran}</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display font-bold">Nilai (Approved)</h2>
          <Link to="/siswa/raport" className="text-sm text-primary font-semibold">
            Lihat raport
          </Link>
        </div>
        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : data?.grades?.length ? (
          <div className="space-y-2">
            {data.grades.map((g) => (
              <div
                key={g.subjectName}
                className="flex items-center justify-between rounded-xl bg-surface-container/50 dark:bg-white/5 px-3 py-3"
              >
                <div>
                  <div className="font-medium text-sm">{g.subjectName}</div>
                </div>
                <Badge status={g.status}>{g.status}</Badge>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-on-surface-variant">
            Belum ada nilai yang disetujui wali kelas.
          </p>
        )}
      </Card>
    </div>
  );
}
