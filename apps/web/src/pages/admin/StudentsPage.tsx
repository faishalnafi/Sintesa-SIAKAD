import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type SsoRole = {
  id: string;
  nama_role: string;
};

type SsoMember = {
  id: string;
  nama_lengkap: string;
  email: string | null;
  nik: string | null;
  nip_nis: string | null;
  jk: string | null;
  no_telp: string | null;
  tgl_lahir: string | null;
  is_active: boolean;
  claimed_at: string | null;
  created_at: string | null;
  roles?: SsoRole[];
  kelas?: { nama_kelas: string } | null;
};

type Meta = {
  total: number;
  page: number;
  per_page: number;
  last_page: number;
};

export function StudentsPage() {
  const [data, setData] = useState<SsoMember[]>([]);
  const [meta, setMeta] = useState<Meta>({ total: 0, page: 1, per_page: 50, last_page: 1 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchParams, setSearchParams] = useSearchParams();
  const roleParam = searchParams.get("role");
  const [roleFilter, setRoleFilter] = useState(roleParam || "Siswa");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (searchParams.has("role")) {
      setRoleFilter(searchParams.get("role") || "Semua");
    } else {
      setRoleFilter("Siswa");
    }
  }, [searchParams]);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (roleFilter && roleFilter !== "Semua") params.set("role", roleFilter);
      if (search.trim()) params.set("search", search.trim());
      params.set("page", String(page));
      params.set("per_page", "50");

      const res = await api<SsoMember[]>(`/admin/sso/members?${params}`);
      setData(res.data ?? []);
      if (res.meta) {
        setMeta(res.meta as unknown as Meta);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data dari SSO.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roleFilter, page]);

  // Realtime: auto-reload saat admin import / sync SSO selesai
  useRealtimeEvent(
    ["student_updated", "sync_completed"],
    () => { load(); }
  );

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    load();
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dari SSO Kredensia"
        title="Data Siswa &amp; Pengguna"
        description="Seluruh data siswa dan pengguna diimpor dan terintegrasi dari portal Kredensia SSO. Pengelolaan identitas utama dilakukan melalui portal SSO."
      />

      {error && (
        <div
          className="rounded-2xl p-4 border flex items-center justify-between gap-3"
          style={{
            background: "color-mix(in srgb, #ef4444 12%, transparent)",
            borderColor: "color-mix(in srgb, #ef4444 25%, transparent)",
            color: "#ef4444",
          }}
        >
          <div className="flex items-center gap-2 text-sm">
            <span className="material-symbols-outlined text-[20px]">warning</span>
            <span>{error} — Silakan atur URL API &amp; API Key di menu Integrasi.</span>
          </div>
          <Link
            to="/admin/integrations"
            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-white/10 hover:bg-white/20 transition-colors whitespace-nowrap"
          >
            Atur Integrasi →
          </Link>
        </div>
      )}

      {/* Filter & Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {["Siswa", "Guru", "Wali Kelas", "Tendik", "Semua"].map((r) => {
            const active = roleFilter === r || (r === "Semua" && (roleFilter === "" || roleFilter === "Semua"));
            return (
              <button
                key={r}
                type="button"
                onClick={() => {
                  setSearchParams({ role: r });
                  setPage(1);
                }}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                  active ? "border-transparent" : ""
                }`}
                style={
                  active
                    ? { background: "var(--accent-soft)", color: "var(--accent)" }
                    : { background: "var(--surface)", borderColor: "var(--input-border)", color: "var(--muted)" }
                }
              >
                {r}
              </button>
            );
          })}
        </div>

        <form onSubmit={handleSearchSubmit} className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama, NIK, NIS, email..."
            className="rounded-xl px-3.5 py-2 text-xs border focus:outline-none focus:ring-2 min-w-[220px]"
            style={{
              background: "var(--surface)",
              borderColor: "var(--input-border)",
              color: "var(--fg)",
            }}
          />
          <button
            type="submit"
            className="px-3 py-2 rounded-xl text-xs font-medium border flex items-center gap-1 app-muted hover:bg-[var(--hover)]"
            style={{ borderColor: "var(--input-border)" }}
          >
            <span className="material-symbols-outlined text-[16px]">search</span>
            Cari
          </button>
        </form>
      </div>

      {/* Main Content */}
      <Card className="overflow-hidden">
        <CardHeader
          title={`Daftar ${roleFilter || "Pengguna"}`}
          subtitle={
            loading
              ? "Memuat data dari SSO..."
              : `Menampilkan ${data.length} dari ${meta.total || data.length} data pengguna SSO`
          }
        />

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ borderBottom: "1px solid var(--divider)" }}>
                {["Nama Lengkap", "NIP / NIS", "NIK", "Email", "Peran", "Status Akun", "Klaim SSO"].map((h) => (
                  <th key={h} className="px-5 py-3 text-left app-label text-[11px] font-semibold whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={i} className="border-b app-divider">
                    <td colSpan={7} className="px-5 py-3.5">
                      <Skeleton className="h-6 w-full" />
                    </td>
                  </tr>
                ))
              ) : data.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center">
                    <span className="material-symbols-outlined text-[48px] app-muted block mb-3">group_off</span>
                    <p className="text-sm font-medium">Belum ada data siswa / pengguna dari SSO.</p>
                    <p className="text-xs app-muted mt-1 max-w-sm mx-auto">
                      Pastikan API Key sudah dikonfigurasi dan lakukan sinkronisasi data pada menu Integrasi.
                    </p>
                    <Link
                      to="/admin/integrations"
                      className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-xl text-xs font-semibold bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90"
                    >
                      <span className="material-symbols-outlined text-[16px]">sync</span>
                      Ke Menu Integrasi (Sinkronkan Data)
                    </Link>
                  </td>
                </tr>
              ) : (
                data.map((m, idx) => (
                  <tr
                    key={m.id}
                    className="row-hover border-b app-divider last:border-0"
                    style={{ background: idx % 2 === 1 ? "var(--hover)" : undefined }}
                  >
                    <td className="px-5 py-3.5 font-medium whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <span>{m.nama_lengkap}</span>
                        {m.jk && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] app-muted uppercase">
                            {m.jk}
                          </span>
                        )}
                      </div>
                      {m.no_telp && <div className="text-[11px] app-muted">{m.no_telp}</div>}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap font-mono text-xs app-muted">
                      {m.nip_nis || "—"}
                    </td>

                    <td className="px-5 py-3.5 whitespace-nowrap font-mono text-xs app-muted">
                      {m.nik || "—"}
                    </td>

                    <td className="px-5 py-3.5 app-muted text-xs truncate max-w-[200px]">
                      {m.email || "—"}
                    </td>

                    <td className="px-5 py-3.5">
                      <div className="flex flex-wrap gap-1">
                        {(m.roles ?? []).map((r) => (
                          <span
                            key={r.id}
                            className="text-[10px] font-semibold px-2 py-0.5 rounded-lg"
                            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                          >
                            {r.nama_role}
                          </span>
                        ))}
                        {(!m.roles || m.roles.length === 0) && <span className="app-muted text-xs">—</span>}
                      </div>
                    </td>

                    <td className="px-5 py-3.5">
                      <Badge status={m.is_active ? "success" : "draft"}>
                        {m.is_active ? "Aktif" : "Nonaktif"}
                      </Badge>
                    </td>

                    <td className="px-5 py-3.5">
                      <Badge status={m.claimed_at ? "success" : "pending"}>
                        {m.claimed_at ? "Terklaim" : "Belum Klaim"}
                      </Badge>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Simple Pagination Bar */}
        {!loading && meta.last_page > 1 && (
          <div className="p-4 border-t app-divider flex items-center justify-between text-xs app-muted">
            <span>
              Halaman {meta.page} dari {meta.last_page} ({meta.total} pengguna)
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ borderColor: "var(--input-border)" }}
              >
                ← Sebelumnya
              </button>
              <button
                type="button"
                disabled={page >= meta.last_page}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded-lg border disabled:opacity-50"
                style={{ borderColor: "var(--input-border)" }}
              >
                Selanjutnya →
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
