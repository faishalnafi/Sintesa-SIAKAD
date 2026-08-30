import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type TahunPelajaranRef = {
  id: string;
  tahun_mulai: number;
  tahun_selesai: number;
  semester: string;
  is_aktif: boolean;
};

type Kelas = {
  id: string;
  nama_kelas: string;
  tingkat: string;
  jurusan: string | null;
  tahun_pelajaran_id: string;
  wali_kelas_id: string | null;
  tahun_pelajaran: TahunPelajaranRef;
  wali_kelas: { id: string; nama_lengkap: string; nip_nis: string } | null;
  jumlah_siswa: number;
  created_at: string;
};

function matchesTingkat(
  itemTingkat: string | number | undefined,
  namaKelas: string | undefined,
  selected: string,
): boolean {
  if (!selected) return true;
  const sel = selected.trim().toUpperCase();

  const map: Record<string, string[]> = {
    X: ["X", "10"],
    XI: ["XI", "11"],
    XII: ["XII", "12"],
    VII: ["VII", "7"],
    VIII: ["VIII", "8"],
    IX: ["IX", "9"],
    "10": ["X", "10"],
    "11": ["XI", "11"],
    "12": ["XII", "12"],
    "7": ["VII", "7"],
    "8": ["VIII", "8"],
    "9": ["IX", "9"],
  };
  const equivalents = map[sel] ?? [sel];

  if (itemTingkat) {
    const t = String(itemTingkat).trim().toUpperCase();
    if (equivalents.includes(t)) return true;
  }

  if (namaKelas) {
    const nameUpper = namaKelas.trim().toUpperCase();
    for (const eq of equivalents) {
      if (
        nameUpper.startsWith(eq + "-") ||
        nameUpper.startsWith(eq + " ") ||
        nameUpper === eq ||
        nameUpper.includes("KELAS " + eq) ||
        nameUpper.includes(" " + eq + " ")
      ) {
        return true;
      }
    }
  }

  return false;
}

export function ClassesPage() {
  const [data, setData] = useState<Kelas[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterAktif, setFilterAktif] = useState(true);
  const [filterTingkat, setFilterTingkat] = useState("");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterAktif) params.set("aktif", "true");
      const res = await api<Kelas[]>(`/admin/sso/kelas?${params}`);
      setData(res.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Gagal memuat data kelas dari SSO.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterAktif]);

  // Realtime: auto-reload saat admin CRUD kelas
  useRealtimeEvent(
    ["class_updated", "sync_completed"],
    () => { load(); }
  );

  // Extract unique levels dynamically from live SSO data (checking both tingkat field and nama_kelas prefix)
  const dynamicTingkatOptions = useMemo(() => {
    const set = new Set<string>();
    data.forEach((kls) => {
      let tStr = kls.tingkat != null ? String(kls.tingkat).trim().toUpperCase() : "";
      if (!tStr && kls.nama_kelas) {
        const match = kls.nama_kelas.trim().match(/^(XII|XI|X|VIII|VII|IX|12|11|10|9|8|7)/i);
        if (match) tStr = match[1].toUpperCase();
      }
      if (tStr) {
        if (["10", "X"].includes(tStr)) set.add("X");
        else if (["11", "XI"].includes(tStr)) set.add("XI");
        else if (["12", "XII"].includes(tStr)) set.add("XII");
        else if (["7", "VII"].includes(tStr)) set.add("VII");
        else if (["8", "VIII"].includes(tStr)) set.add("VIII");
        else if (["9", "IX"].includes(tStr)) set.add("IX");
        else set.add(tStr);
      }
    });

    const list = Array.from(set);
    const standardOrder = ["X", "XI", "XII", "VII", "VIII", "IX"];
    list.sort((a, b) => {
      const ia = standardOrder.indexOf(a);
      const ib = standardOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return a.localeCompare(b);
    });

    if (list.length === 0) return ["X", "XI", "XII"];
    return list;
  }, [data]);

  // Filter dataset dynamically
  const filteredData = useMemo(() => {
    return data.filter((kls) => {
      if (filterTingkat && !matchesTingkat(kls.tingkat, kls.nama_kelas, filterTingkat)) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        const matchName = kls.nama_kelas?.toLowerCase().includes(q);
        const matchJurusan = kls.jurusan?.toLowerCase().includes(q);
        const matchWali = kls.wali_kelas?.nama_lengkap?.toLowerCase().includes(q);
        if (!matchName && !matchJurusan && !matchWali) return false;
      }
      return true;
    });
  }, [data, filterTingkat, search]);

  const badgeTingkat = (t: string) => {
    const str = String(t).toUpperCase();
    if (str === "X" || str === "10" || str === "VII" || str === "7") return "success";
    if (str === "XI" || str === "11" || str === "VIII" || str === "8") return "pending";
    return "draft";
  };

  const pager = usePagination(filteredData, { resetKey: `${filterAktif}|${filterTingkat}|${search}` });

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Dari SSO Kredensia"
        title="Data Rombel"
        description="Data rombongan belajar (kelas) diimpor langsung dari portal SSO. Kelola melalui portal Kredensia."
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

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setFilterAktif((v) => !v)}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition-colors ${
            filterAktif ? "border-transparent" : ""
          }`}
          style={
            filterAktif
              ? { background: "var(--accent-soft)", color: "var(--accent)", borderColor: "var(--accent-soft)" }
              : { background: "var(--surface)", color: "var(--muted)", borderColor: "var(--input-border)" }
          }
        >
          <span className="material-symbols-outlined text-[16px]">
            {filterAktif ? "check_circle" : "radio_button_unchecked"}
          </span>
          Hanya Tahun Aktif
        </button>

        <select
          value={filterTingkat}
          onChange={(e) => setFilterTingkat(e.target.value)}
          className="rounded-xl px-3 py-2 text-sm border focus:outline-none focus:ring-2"
          style={{
            background: "var(--surface)",
            borderColor: "var(--input-border)",
            color: "var(--fg)",
          }}
        >
          <option value="">Semua Tingkat</option>
          {dynamicTingkatOptions.map((t) => (
            <option key={t} value={t}>
              Kelas {t}
            </option>
          ))}
        </select>

        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari rombel / jurusan / wali kelas..."
            className="w-full rounded-xl pl-9 pr-3 py-2 text-sm border focus:outline-none focus:ring-2"
            style={{
              background: "var(--surface)",
              borderColor: "var(--input-border)",
              color: "var(--fg)",
            }}
          />
          <span className="material-symbols-outlined absolute left-3 top-2.5 text-[16px] app-muted">
            search
          </span>
        </div>

        <span className="text-xs app-muted ml-auto">
          {loading ? "Memuat..." : `${filteredData.length} dari ${data.length} kelas`}
        </span>
      </div>

      {loading ? (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <Skeleton key={i} className="h-44 rounded-2xl" />
          ))}
        </div>
      ) : filteredData.length === 0 && !error ? (
        <Card className="p-8 text-center">
          <span className="material-symbols-outlined text-[48px] app-muted block mb-3">class</span>
          <p className="text-sm app-muted">Tidak ada data kelas yang cocok dengan filter.</p>
          <p className="text-xs app-muted mt-1">
            Coba ubah opsi tingkat atau kata kunci pencarian.
          </p>
        </Card>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredData.map((kls) => (
            <Card
              key={kls.id}
              className="p-5 flex flex-col gap-3 hover:shadow-[var(--shadow-lg)] transition-shadow duration-300"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <span
                    className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: "var(--accent-soft)" }}
                  >
                    <span className="material-symbols-outlined text-[var(--accent)] text-[20px]">
                      class
                    </span>
                  </span>
                  <div className="min-w-0">
                    <div className="font-display font-bold text-sm leading-snug truncate">
                      {kls.nama_kelas}
                    </div>
                    <div className="text-[11px] app-muted truncate">
                      {kls.jurusan || "Umum"}
                    </div>
                  </div>
                </div>
                <Badge status={badgeTingkat(kls.tingkat)}>Kelas {kls.tingkat}</Badge>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <div>
                  <p className="app-label text-[10px]">Jumlah Siswa</p>
                  <p className="font-bold text-lg mt-0.5">{kls.jumlah_siswa}</p>
                  <p className="text-[11px] text-[var(--fg-muted)] mt-1 truncate" title={kls.wali_kelas?.nama_lengkap ?? "Belum ditugaskan"}>
                    Wali: <span className="font-medium text-[var(--fg)]">{kls.wali_kelas?.nama_lengkap ?? "—"}</span>
                  </p>
                </div>
                <div>
                  <p className="app-label text-[10px]">Tahun Pelajaran</p>
                  <p className="text-sm mt-0.5 font-medium">
                    {kls.tahun_pelajaran
                      ? `${kls.tahun_pelajaran.tahun_mulai}/${kls.tahun_pelajaran.tahun_selesai}`
                      : "—"}
                  </p>
                  <p className="text-[10px] app-muted capitalize">{kls.tahun_pelajaran?.semester}</p>
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
          <CardHeader title="Tabel Kelas" subtitle={`${data.length} rombongan belajar dari SSO`} />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ borderBottom: "1px solid var(--divider)" }}>
                  {["Nama Kelas", "Tingkat", "Jurusan", "Wali Kelas", "Jumlah Siswa", "Tahun Pelajaran"].map((h) => (
                    <th key={h} className="px-5 py-3 text-left app-label text-[11px] font-semibold whitespace-nowrap">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pager.pageItems.map((kls, idx) => (
                  <tr
                    key={kls.id}
                    className="row-hover border-b app-divider last:border-0"
                    style={{ background: idx % 2 === 1 ? "var(--hover)" : undefined }}
                  >
                    <td className="px-5 py-3 font-medium">{kls.nama_kelas}</td>
                    <td className="px-5 py-3">
                      <Badge status={badgeTingkat(kls.tingkat)}>Kelas {kls.tingkat}</Badge>
                    </td>
                    <td className="px-5 py-3 app-muted">{kls.jurusan || "—"}</td>
                    <td className="px-5 py-3 app-muted">
                      {kls.wali_kelas?.nama_lengkap || "—"}
                    </td>
                    <td className="px-5 py-3 font-semibold">{kls.jumlah_siswa}</td>
                    <td className="px-5 py-3 app-muted">
                      {kls.tahun_pelajaran
                        ? `${kls.tahun_pelajaran.tahun_mulai}/${kls.tahun_pelajaran.tahun_selesai} - ${kls.tahun_pelajaran.semester}`
                        : "—"}
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
