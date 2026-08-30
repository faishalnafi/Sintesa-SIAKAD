import { FormEvent, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";

type Keluar = {
  id: string;
  name: string;
  nisn: string | null;
  statusNote: string | null;
  statusChangedAt: string | null;
};

type SiswaOpt = {
  id: string;
  name: string;
  nisn: string | null;
  className: string | null;
};

type Klass = { id: string; name: string };

export function KeluarPage() {
  const [keluar, setKeluar] = useState<Keluar[]>([]);
  const [siswaOptions, setSiswaOptions] = useState<SiswaOpt[]>([]);
  const [classes, setClasses] = useState<Klass[]>([]);
  const [studentId, setStudentId] = useState("");
  const [note, setNote] = useState("Mutasi ke sekolah lain");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const pager = usePagination(keluar);

  const load = async () => {
    setLoading(true);
    try {
      const [k, c] = await Promise.all([
        api<{ keluar: Keluar[]; siswaOptions: SiswaOpt[] }>("/admin/keluar"),
        api<{ classes: Klass[] }>("/admin/classes"),
      ]);
      setKeluar(k.data?.keluar ?? []);
      setSiswaOptions(k.data?.siswaOptions ?? []);
      setClasses(c.data?.classes ?? []);
      if (!studentId && k.data?.siswaOptions?.[0]) setStudentId(k.data.siswaOptions[0].id);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const mark = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await api("/admin/keluar", {
        method: "POST",
        body: JSON.stringify({ studentId, note }),
      });
      setMessage(res.message || "OK");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const restore = async (id: string) => {
    const classId = classes[0]?.id;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api(`/admin/keluar/${id}/restore`, {
        method: "POST",
        body: JSON.stringify({ classId, note: "Dikembalikan ke siswa aktif" }),
      });
      setMessage(res.message || "Restored");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const purge = async () => {
    if (!confirm("Hapus permanen SEMUA data siswa keluar?")) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api("/admin/keluar/purge", { method: "POST" });
      setMessage(res.message || "Purged");
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-on-surface-variant">Mutasi / non-aktif</p>
        <h1 className="font-display text-2xl md:text-3xl font-bold">Siswa Keluar</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Status <code className="text-xs">keluar</code> tidak bisa login sampai admin restore ke
          siswa.
        </p>
      </div>

      {message && (
        <div className="rounded-2xl bg-secondary-container/40 dark:bg-white/5 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      <Card className="p-5 space-y-4">
        <h2 className="font-display font-bold">Tandai siswa keluar / mutasi</h2>
        <form onSubmit={mark} className="space-y-3">
          <label className="block text-sm space-y-1">
            <span className="text-on-surface-variant">Siswa aktif</span>
            <select
              className="w-full rounded-2xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-dark-elevated px-4 py-3"
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              required
            >
              {siswaOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.className ?? "-"} · NISN: {s.nisn ?? "—"}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm space-y-1">
            <span className="text-on-surface-variant">Catatan</span>
            <input
              className="w-full rounded-2xl border border-outline-variant/40 bg-transparent px-4 py-3"
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !studentId}>
            Pindahkan ke Keluar
          </Button>
        </form>
      </Card>

      <div className="flex justify-end">
        <Button variant="danger" size="sm" disabled={busy || keluar.length === 0} onClick={purge}>
          Hapus permanen semua keluar
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="px-5 py-3 border-b border-outline-variant/20 font-display font-bold">
          Daftar keluar ({keluar.length})
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-surface-container/60 text-left">
              <tr>
                <th className="px-4 py-3">Nama</th>
                <th className="px-4 py-3">NISN</th>
                <th className="px-4 py-3">Catatan</th>
                <th className="px-4 py-3">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 2 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                : pager.pageItems.map((k) => (
                    <tr key={k.id} className="border-t border-outline-variant/20">
                      <td className="px-4 py-3 font-medium">
                        {k.name}
                        <div>
                          <Badge status="incomplete">keluar</Badge>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        {k.nisn ?? "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">{k.statusNote ?? "—"}</td>
                      <td className="px-4 py-3">
                        <Button size="sm" variant="secondary" disabled={busy} onClick={() => restore(k.id)}>
                          Restore siswa
                        </Button>
                      </td>
                    </tr>
                  ))}
              {!loading && pager.total === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-sm text-on-surface-variant">
                    Belum ada siswa keluar.
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
