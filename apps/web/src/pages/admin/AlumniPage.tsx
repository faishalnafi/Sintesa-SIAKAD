import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";

type Alumni = {
  id: string;
  name: string;
  nisn: string | null;
  kelasLabel: string | null;
  academicYearId: string | null;
  statusNote: string | null;
};

type Pending = {
  id: string;
  name: string;
  nisn: string | null;
  className: string | null;
  gradeLevel: string | null;
};

type Year = { id: string; name: string };

export function AlumniPage() {
  const [alumni, setAlumni] = useState<Alumni[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [years, setYears] = useState<Year[]>([]);
  const [purgeYearId, setPurgeYearId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pager = usePagination(alumni);
  const pendingPager = usePagination(pending);

  const load = async () => {
    setLoading(true);
    try {
      const res = await api<{ alumni: Alumni[]; pending: Pending[]; years: Year[] }>(
        "/admin/alumni",
      );
      setAlumni(res.data?.alumni ?? []);
      setPending(res.data?.pending ?? []);
      setYears(res.data?.years ?? []);
      if (!purgeYearId && res.data?.years?.[0]) setPurgeYearId(res.data.years[0].id);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const migrate = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api("/admin/alumni/migrate", { method: "POST" });
      setMessage(res.message || "Migrasi selesai");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!purgeYearId) return;
    if (!confirm("Hapus permanen semua alumni pada tahun lulus terpilih?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api("/admin/alumni/purge", {
        method: "POST",
        body: JSON.stringify({ yearId: purgeYearId }),
      });
      setMessage(res.message || "Purge selesai");
      await load();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-on-surface-variant">Kelulusan</p>
        <h1 className="font-display text-2xl md:text-3xl font-bold">Alumni</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Siswa XII dengan tahun pelajaran ≠ tahun aktif dipindah ke status alumni (kelas =
          ALUMNI).
        </p>
      </div>

      {message && (
        <div className="rounded-2xl bg-secondary-container/40 dark:bg-white/5 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      <Card className="p-5 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 className="font-display font-bold">Pending migrasi (kelas XII)</h2>
            <p className="text-sm text-on-surface-variant">
              {pending.length} siswa menunggu dipindah ke alumni
            </p>
          </div>
          <Button onClick={migrate} disabled={busy || pending.length === 0}>
            Proses migrasi alumni
          </Button>
        </div>
        {loading ? (
          <Skeleton className="h-16 w-full" />
        ) : pending.length === 0 ? (
          <p className="text-sm text-on-surface-variant">Tidak ada pending.</p>
        ) : (
          <>
            <ul className="text-sm space-y-1">
              {pendingPager.pageItems.map((p) => (
                <li key={p.id} className="flex justify-between gap-2 border-b border-outline-variant/20 py-2">
                  <span>
                    {p.name} · {p.className}
                  </span>
                  <Badge status="pending">XII</Badge>
                </li>
              ))}
            </ul>
            <Pagination
              page={pendingPager.page}
              totalPages={pendingPager.totalPages}
              total={pendingPager.total}
              from={pendingPager.from}
              to={pendingPager.to}
              onPageChange={pendingPager.setPage}
            />
          </>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-display font-bold">Hapus permanen by tahun lulus</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <select
            className="rounded-2xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-dark-elevated px-4 py-3 text-sm"
            value={purgeYearId}
            onChange={(e) => setPurgeYearId(e.target.value)}
          >
            {years.map((y) => (
              <option key={y.id} value={y.id}>
                {y.name}
              </option>
            ))}
          </select>
          <Button variant="danger" onClick={purge} disabled={busy || !purgeYearId}>
            Purge alumni tahun ini
          </Button>
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-outline-variant/20 font-display font-bold">
          Daftar alumni ({alumni.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container/60 text-left">
              <tr>
                <th className="px-4 py-3">Nama</th>
                <th className="px-4 py-3">NIS/NISN</th>
                <th className="px-4 py-3">Label</th>
                <th className="px-4 py-3">Catatan</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                : pager.pageItems.map((a) => (
                    <tr key={a.id} className="border-t border-outline-variant/20">
                      <td className="px-4 py-3 font-medium">{a.name}</td>
                      <td className="px-4 py-3">
                        {a.nisn ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge status="success">{a.kelasLabel ?? "ALUMNI"}</Badge>
                      </td>
                      <td className="px-4 py-3 text-xs text-on-surface-variant">
                        {a.statusNote ?? "—"}
                      </td>
                    </tr>
                  ))}
              {!loading && pager.total === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-on-surface-variant">
                    Belum ada alumni.
                  </td>
                </tr>
              )}
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
