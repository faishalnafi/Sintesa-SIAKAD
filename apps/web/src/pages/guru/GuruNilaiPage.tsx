import { useCallback, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type Klass = { id: string; name: string };
type Subject = { id: string; name: string };
type GradeRow = {
  studentId: string;
  name: string;
  nis: string | null;
  nisn?: string | null;
  uh1: string | null;
  t1: string | null;
  sts: string | null;
  uh2: string | null;
  t2: string | null;
  status: string;
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
  { id: "5", code: "t2", name: "T2", type: "TUGAS", status: "disabled", sortOrder: 5 },
];

const scoreKeys = ["uh1", "t1", "sts", "uh2", "t2"] as const;

export function GuruNilaiPage() {
  const [classes, setClasses] = useState<Klass[]>([]);
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const [classId, setClassId] = useState("");
  const [subjectId, setSubjectId] = useState("");
  const [rows, setRows] = useState<GradeRow[]>([]);
  const [assessmentComponents, setAssessmentComponents] = useState<AssessmentComponent[]>(defaultComponents);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [isSubjectLocked, setIsSubjectLocked] = useState(false);
  const pager = usePagination(rows, { resetKey: `${classId}|${subjectId}` });

  useEffect(() => {
    api<AssessmentComponent[]>("/teacher/assessment-components")
      .then((res) => {
        if (res.data && res.data.length > 0) {
          setAssessmentComponents(res.data);
        }
      })
      .catch(() => {});
  }, []);

  useRealtimeEvent(["subject_updated"], () => {
    api<AssessmentComponent[]>("/teacher/assessment-components")
      .then((res) => {
        if (res.data && res.data.length > 0) {
          setAssessmentComponents(res.data);
        }
      })
      .catch(() => {});
  });

  const visibleComponents = useMemo(() => {
    return assessmentComponents.filter((c) => c.status !== "inactive");
  }, [assessmentComponents]);

  useEffect(() => {
    Promise.allSettled([
      api<Klass[]>("/teacher/classes"),
      api<Array<{ id: string; nama_kelas: string }>>("/admin/sso/kelas"),
    ]).then(([tClsRes, ssoKlsRes]) => {
      const combined: Klass[] = [];
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();

      if (tClsRes.status === "fulfilled" && tClsRes.value?.data && Array.isArray(tClsRes.value.data)) {
        for (const c of tClsRes.value.data) {
          if (c.id && c.name && !seenIds.has(c.id) && !seenNames.has(c.name.toLowerCase())) {
            combined.push(c);
            seenIds.add(c.id);
            seenNames.add(c.name.toLowerCase());
          }
        }
      }

      if (ssoKlsRes.status === "fulfilled" && ssoKlsRes.value?.data && Array.isArray(ssoKlsRes.value.data)) {
        for (const k of ssoKlsRes.value.data) {
          if (k.id && k.nama_kelas && !seenIds.has(k.id) && !seenNames.has(k.nama_kelas.toLowerCase())) {
            combined.push({ id: k.id, name: k.nama_kelas });
            seenIds.add(k.id);
            seenNames.add(k.nama_kelas.toLowerCase());
          }
        }
      }

      setClasses(combined);
      if (combined[0]) {
        setClassId((prev) => prev || combined[0].id);
      }
    });

    api<Subject[]>("/teacher/subjects").then((res) => {
      const list = res.data ?? [];
      setSubjects(list);
      setSubjectId((prev) => prev || list[0]?.id || "");
      setIsSubjectLocked(Boolean((res as any).isLocked));
    });
  }, []);

  const loadGrades = useCallback(async (silent = false) => {
    if (!classId || !subjectId) return;
    if (!silent) setLoading(true);
    try {
      const res = await api<GradeRow[]>(
        `/teacher/grades?classId=${classId}&subjectId=${subjectId}`,
      );
      setRows(res.data ?? []);
    } finally {
      if (!silent) setLoading(false);
    }
  }, [classId, subjectId]);

  useEffect(() => {
    loadGrades();
  }, [loadGrades]);

  // Realtime: refresh tabel nilai saat walikelas approve/reject
  // Hanya aktif jika guru sedang melihat kelas & mapel tertentu
  useRealtimeEvent(
    ["grade_approved", "grade_rejected", "grade_deleted"],
    () => { loadGrades(true); },
    Boolean(classId && subjectId)
  );

  const locked = useMemo(
    () => rows.some((r) => r.status === "submitted" || r.status === "approved"),
    [rows],
  );

  const updateCell = (studentId: string, key: (typeof scoreKeys)[number], value: string) => {
    let sanitizedValue = value;
    if (sanitizedValue !== "") {
      // Remove any decimal part
      sanitizedValue = sanitizedValue.split(".")[0].split(",")[0];
      // Strip anything that is not a digit or minus sign
      sanitizedValue = sanitizedValue.replace(/[^0-9-]/g, "");
      
      const num = parseInt(sanitizedValue, 10);
      if (!isNaN(num)) {
        if (num < 0) {
          sanitizedValue = "0";
        } else if (num > 100) {
          sanitizedValue = "100";
        } else {
          sanitizedValue = String(num);
        }
      } else {
        sanitizedValue = "";
      }
    }

    setRows((prev) =>
      prev.map((r) => {
        if (r.studentId !== studentId) return r;
        if (r.status === "submitted" || r.status === "approved") return r;
        return { ...r, [key]: sanitizedValue === "" ? null : sanitizedValue };
      }),
    );
  };

  const saveDraft = async () => {
    setSaving(true);
    setMessage(null);
    try {
      await api("/teacher/grades/draft", {
        method: "PATCH",
        body: JSON.stringify({
          classId,
          subjectId,
          items: rows.map((r) => ({
            studentId: r.studentId,
            uh1: r.uh1,
            t1: r.t1,
            sts: r.sts,
            uh2: r.uh2,
            t2: r.t2,
          })),
        }),
      });
      setMessage("Draft tersimpan");
      await loadGrades();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal simpan");
    } finally {
      setSaving(false);
    }
  };

  const submit = async () => {
    const activeCols = assessmentComponents
      .filter((c) => c.status === "active")
      .map((c) => c.code.toLowerCase());

    if (activeCols.length > 0) {
      let readyCount = 0;

      for (const r of rows) {
        const filledCount = activeCols.filter((k) => {
          const val = (r as any)[k];
          return val !== null && val !== undefined && String(val).trim() !== "";
        }).length;

        // Kosong total -> Abaikan (tidak memblokir pengiriman siswa lain)
        if (filledCount === 0) continue;

        // Terisi parsial -> Peringatkan Guru
        if (filledCount < activeCols.length) {
          const activeNames = assessmentComponents
            .filter((c) => c.status === "active")
            .map((c) => c.code.toUpperCase())
            .join(", ");

          Swal.fire({
            icon: "warning",
            title: "Pengiriman Gagal",
            html: `Nilai siswa <b>${r.name}</b> baru terisi sebagian.<br/><br/>Jika seorang siswa mulai dinilai, seluruh kolom aktif (<b>${activeNames}</b>) wajib diisi lengkap sebelum dikirim ke Wali Kelas!`,
            confirmButtonColor: "#f59e0b",
          });
          return;
        }

        readyCount++;
      }

      if (readyCount === 0) {
        Swal.fire({
          icon: "info",
          title: "Belum Ada Nilai",
          text: "Silakan isi nilai lengkap (0–100) minimal untuk 1 siswa sebelum mengirim ke Wali Kelas.",
          confirmButtonColor: "#3b82f6",
        });
        return;
      }
    }

    setSaving(true);
    setMessage(null);
    try {
      await saveDraft();
      const res = await api<{ submitted: number }>("/teacher/grades/submit", {
        method: "POST",
        body: JSON.stringify({ classId, subjectId }),
      });
      Swal.fire({
        icon: "success",
        title: "Berhasil Dikirim",
        text: `Berhasil mengirim ${res.data?.submitted ?? 0} data nilai ke Wali Kelas!`,
        timer: 2000,
        showConfirmButton: false,
      });
      setMessage(`Dikirim ke walikelas: ${res.data?.submitted ?? 0} baris`);
      await loadGrades();
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : "Gagal submit";
      setMessage(errMsg);
      Swal.fire({
        icon: "error",
        title: "Gagal Mengirim",
        text: errMsg,
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-on-surface-variant">Guru Mapel</p>
        <h1 className="font-display text-2xl md:text-3xl font-bold">Input Nilai Akademik</h1>
        <p className="text-sm text-on-surface-variant mt-1">
          Pilih kelas dan mata pelajaran untuk mengelola nilai siswa.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm space-y-1">
          <span className="text-on-surface-variant font-medium">Pilih Kelas</span>
          <select
            className="w-full rounded-2xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-dark-elevated px-4 py-3 outline-none focus:border-primary"
            value={classId}
            onChange={(e) => setClassId(e.target.value)}
          >
            {classes.length === 0 ? (
              <option value="">Belum ada data kelas dari SSO</option>
            ) : (
              classes.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.name}
                </option>
              ))
            )}
          </select>
        </label>
        <label className="text-sm space-y-1">
          <span className="text-on-surface-variant font-medium">Mata Pelajaran</span>
          <select
            className="w-full rounded-2xl border border-outline-variant/40 bg-surface-container-lowest dark:bg-dark-elevated px-4 py-3 outline-none focus:border-primary disabled:opacity-60 disabled:bg-surface-variant/20"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
            disabled={isSubjectLocked}
          >
            {subjects.length === 0 ? (
              <option value="">Belum ada mapel</option>
            ) : (
              subjects.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))
            )}
          </select>
        </label>
      </div>

      {message && (
        <div className="rounded-2xl bg-secondary-container/50 dark:bg-white/5 px-4 py-3 text-sm">
          {message}
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="px-4 py-3 border-b border-outline-variant/20 flex items-center justify-between gap-2">
          <div className="text-sm text-on-surface-variant">
            {rows.length} siswa · {Math.min(10, rows.length)} ditampilkan/halaman · draft di server
          </div>
          <Badge status={locked ? "submitted" : "draft"}>{locked ? "Terkunci/Submitted" : "Draft"}</Badge>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm table-sticky-name min-w-[720px]">
            <thead className="bg-surface-container/80 dark:bg-white/5 text-left">
              <tr>
                <th className="px-4 py-3 font-semibold">Nama Siswa</th>
                {visibleComponents.map((c) => (
                  <th key={c.code} className="px-3 py-3 font-semibold uppercase">
                    {c.code}
                  </th>
                ))}
                <th className="px-3 py-3 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={2 + visibleComponents.length} className="px-4 py-3">
                      <Skeleton className="h-10 w-full" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={2 + visibleComponents.length} className="px-4 py-12 text-center text-on-surface-variant">
                    <span className="material-symbols-outlined text-[48px] block mb-2 opacity-40">groups</span>
                    <p className="font-medium text-base">Belum Ada Data Siswa</p>
                    <p className="text-xs opacity-75 mt-1">
                      Data siswa sedang disinkronkan dari SSO Kredensia atau belum terdaftar di kelas ini.
                    </p>
                  </td>
                </tr>
              ) : (
                pager.pageItems.map((r) => (
                  <tr key={r.studentId} className="border-t border-outline-variant/20">
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-on-surface-variant">NISN: {r.nisn ?? r.nis}</div>
                    </td>
                    {visibleComponents.map((c) => {
                      const k = c.code.toLowerCase() as keyof GradeRow;
                      const isFieldDisabled = c.status === "disabled" || r.status === "submitted" || r.status === "approved";
                      return (
                        <td key={c.code} className="px-2 py-2">
                          <input
                            type="text"
                            disabled={isFieldDisabled}
                            placeholder={c.status === "disabled" ? "Segera Hadir" : ""}
                            title={c.status === "disabled" ? "Kolom belum dibuka (Segera Hadir)" : ""}
                            value={(r as any)[k] ?? ""}
                            onChange={(e) => updateCell(r.studentId, k as any, e.target.value)}
                            className={`rounded-xl border px-2 py-2 text-center outline-none transition-all placeholder:text-[10px] placeholder:font-medium ${
                              c.status === "disabled"
                                ? "w-24 bg-amber-500/10 border-amber-500/40 text-amber-600 dark:text-amber-400 font-medium cursor-not-allowed"
                                : "w-16 border-outline-variant/40 bg-transparent focus:border-primary disabled:opacity-60"
                            }`}
                          />
                        </td>
                      );
                    })}
                    <td className="px-3 py-3">
                      <Badge status={r.status}>{r.status}</Badge>
                    </td>
                  </tr>
                ))
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

      <div className="flex flex-col sm:flex-row gap-3 mt-6 pb-6">
        <Button variant="secondary" className="flex-1" onClick={saveDraft} disabled={saving}>
          Simpan Draft
        </Button>
        <Button className="flex-1" onClick={submit} disabled={saving}>
          <span className="material-symbols-outlined text-[18px]">send</span>
          Kirim ke Walikelas
        </Button>
      </div>
    </div>
  );
}
