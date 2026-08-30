import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";

type TahunPelajaran = {
  id: string;
  tahun_mulai: number;
  tahun_selesai: number;
  semester: string;
  is_aktif: boolean;
  kelas_count: number;
  label: string;
  created_at: string;
};

export function AcademicYearsPage() {
  const [data, setData] = useState<TahunPelajaran[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api<TahunPelajaran[]>("/admin/sso/tahun-pelajaran");
      setData(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data tahun pelajaran dari SSO.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const pager = usePagination(data);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dari SSO Kredensia"
        title="Tahun Pelajaran"
        description="Data tahun pelajaran diimpor langsung dari portal SSO. Untuk mengubah data, kelola melalui portal Kredensia."
      />

      {error && (
        <div
          className="rounded-2xl px-4 py-3 text-sm flex items-center gap-2"
          style={{ background: "color-mix(in srgb, #ef4444 12%, transparent)", color: "#ef4444" }}
        >
          <span className="material-symbols-outlined text-[18px]">error</span>
          <span>{error} — Pastikan URL API SSO dan API Key sudah dikonfigurasi di menu Integrasi.</span>
        </div>
      )}

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : data.length === 0 && !error ? (
        <Card className="p-8 text-center">
          <span className="material-symbols-outlined text-[48px] app-muted block mb-3">calendar_month</span>
          <p className="text-sm app-muted">Belum ada data tahun pelajaran dari SSO.</p>
          <p className="text-xs app-muted mt-1">Konfigurasi SSO API di menu Integrasi terlebih dahulu.</p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {data.map((tp) => (
            <Card
              key={tp.id}
              className="p-5 flex flex-col gap-3 hover:shadow-[var(--shadow-lg)] transition-shadow duration-300"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3">
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "var(--accent-soft)" }}
                  >
                    <span className="material-symbols-outlined text-[var(--accent)] text-[20px]">
                      calendar_month
                    </span>
                  </span>
                  <div>
                    <div className="font-display font-bold text-sm leading-snug">
                      {tp.tahun_mulai}/{tp.tahun_selesai}
                    </div>
                    <div className="text-[11px] app-muted capitalize">{tp.semester}</div>
                  </div>
                </div>
                <Badge status={tp.is_aktif ? "success" : "draft"}>
                  {tp.is_aktif ? "Aktif" : "Tidak Aktif"}
                </Badge>
              </div>

              <div className="flex flex-wrap gap-4 pt-1">
                <div>
                  <p className="app-label text-[10px]">Jumlah Kelas</p>
                  <p className="font-semibold text-sm mt-0.5">{tp.kelas_count ?? 0}</p>
                </div>
                <div>
                  <p className="app-label text-[10px]">Label</p>
                  <p className="font-semibold text-sm mt-0.5">{tp.label}</p>
                </div>
              </div>

              <div
                className="rounded-xl px-3 py-2 text-[11px] app-muted flex items-center gap-1.5"
                style={{ background: "var(--hover)" }}
              >
                <span className="material-symbols-outlined text-[13px]">info</span>
                Hanya baca — kelola di portal Kredensia
              </div>
            </Card>
          ))}
        </div>
      )}

      {!loading && data.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader title="Tabel Tahun Pelajaran" subtitle={`${data.length} tahun pelajaran dari SSO`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--divider)" }}>
                  {["Label", "Tahun Mulai", "Tahun Selesai", "Semester", "Kelas", "Status"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left app-label text-[11px] font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((tp, idx) => (
                  <tr
                    key={tp.id}
                    className="row-hover border-b app-divider last:border-0"
                    style={{ background: idx % 2 === 1 ? "var(--hover)" : undefined }}
                  >
                    <td className="px-5 py-3 font-medium">{tp.label}</td>
                    <td className="px-5 py-3 app-muted">{tp.tahun_mulai}</td>
                    <td className="px-5 py-3 app-muted">{tp.tahun_selesai}</td>
                    <td className="px-5 py-3 capitalize app-muted">{tp.semester}</td>
                    <td className="px-5 py-3">{tp.kelas_count ?? 0}</td>
                    <td className="px-5 py-3">
                      <Badge status={tp.is_aktif ? "success" : "draft"}>
                        {tp.is_aktif ? "Aktif" : "Tidak Aktif"}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={pager.page}
            totalPages={pager.totalPages}
            total={pager.total}
            from={pager.from}
            to={pager.to}
            onPageChange={pager.setPage}
          />
        </Card>
      )}
    </div>
  );
}
