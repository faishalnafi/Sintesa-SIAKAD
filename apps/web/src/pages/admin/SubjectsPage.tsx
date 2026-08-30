import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type Subject = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  isActive: boolean;
  assignmentCount: number;
  gradeCount: number;
};

type FormState = {
  name: string;
  code: string;
  type: string;
};

const emptyForm: FormState = {
  name: "",
  code: "",
  type: "umum",
};

const TYPE_OPTIONS = [
  { value: "umum", label: "Umum" },
  { value: "pilihan", label: "Pilihan" },
  { value: "mulok", label: "Muatan lokal" },
  { value: "lainnya", label: "Lainnya" },
];

export function SubjectsPage() {
  const [rows, setRows] = useState<Subject[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [filterType, setFilterType] = useState("");
  const [filterActive, setFilterActive] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Penugasan Guru states
  const [teachers, setTeachers] = useState<Array<{ id: string; name: string; nip: string | null }>>([]);
  const [homeroomTeachers, setHomeroomTeachers] = useState<Array<{ id: string; name: string; nip: string | null }>>([]);
  const [assignments, setAssignments] = useState<Array<{
    id: string;
    userId: string;
    userName: string;
    userNip: string | null;
    subjectId: string;
    subjectName: string;
    subjectCode: string | null;
  }>>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [loadingAssignments, setLoadingAssignments] = useState(false);

  // Penugasan Wali Kelas states
  const [classesList, setClassesList] = useState<Array<{ id: string; name: string }>>([]);
  const [homeroomAssignmentsList, setHomeroomAssignmentsList] = useState<Array<{
    id: string;
    userId: string;
    userName: string;
    userNip: string | null;
    classId: string;
    className: string;
  }>>([]);
  const [selectedHomeroomTeacherId, setSelectedHomeroomTeacherId] = useState("");
  const [selectedHomeroomClassId, setSelectedHomeroomClassId] = useState("");

  const homeroomTeacherOptions = useMemo(() => {
    return homeroomTeachers.length > 0 ? homeroomTeachers : teachers;
  }, [homeroomTeachers, teachers]);

  const teacherSelectOptions = useMemo(
    () =>
      teachers.map((t) => ({
        value: t.id,
        label: t.name,
        sublabel: t.nip ? `NIP: ${t.nip}` : undefined,
      })),
    [teachers]
  );

  const subjectSelectOptions = useMemo(
    () =>
      rows
        .filter((r) => r.isActive)
        .map((s) => ({
          value: s.id,
          label: s.name,
          sublabel: s.code ?? undefined,
        })),
    [rows]
  );

  const homeroomSelectOptions = useMemo(
    () =>
      homeroomTeacherOptions.map((t) => ({
        value: t.id,
        label: t.name,
        sublabel: t.nip ? `NIP: ${t.nip}` : undefined,
      })),
    [homeroomTeacherOptions]
  );

  const classSelectOptions = useMemo(
    () =>
      classesList.map((c) => ({
        value: c.id,
        label: c.name,
      })),
    [classesList]
  );

  // Jam Mengajar states
  const [teachingHoursList, setTeachingHoursList] = useState<Array<{ id: string; label: string; startTime: string; endTime: string }>>([]);
  const [loadingHours, setLoadingHours] = useState(false);
  const [newHourLabel, setNewHourLabel] = useState("");
  const [newHourStart, setNewHourStart] = useState("");
  const [newHourEnd, setNewHourEnd] = useState("");

  // Konfigurasi Kolom Penilaian (Assessment Components) States
  const [assessmentComponentsList, setAssessmentComponentsList] = useState<Array<{
    id: string;
    code: string;
    name: string;
    type: "UJIAN" | "TUGAS";
    status: "active" | "disabled" | "inactive";
    sortOrder: number;
  }>>([]);
  const [loadingComponents, setLoadingComponents] = useState(false);
  const [compName, setCompName] = useState("");
  const [compCode, setCompCode] = useState("");
  const [compType, setCompType] = useState<"UJIAN" | "TUGAS">("UJIAN");
  const [compStatus, setCompStatus] = useState<"active" | "disabled" | "inactive">("active");
  const [compSortOrder, setCompSortOrder] = useState(1);
  const [editingCompId, setEditingCompId] = useState<string | null>(null);

  const loadTeachingHours = async () => {
    setLoadingHours(true);
    try {
      const res = await api<Array<{ id: string; label: string; startTime: string; endTime: string }>>("/admin/teaching-hours");
      setTeachingHoursList(res.data ?? []);
    } catch (e) {
      console.error("loadTeachingHours error:", e);
    } finally {
      setLoadingHours(false);
    }
  };

  const loadAssessmentComponents = async () => {
    setLoadingComponents(true);
    try {
      const res = await api<Array<{
        id: string;
        code: string;
        name: string;
        type: "UJIAN" | "TUGAS";
        status: "active" | "disabled" | "inactive";
        sortOrder: number;
      }>>("/admin/assessment-components");
      const data = res.data ?? [];
      setAssessmentComponentsList(data);
      if (!editingCompId) {
        setCompSortOrder(data.length + 1);
      }
    } catch (e) {
      console.error("loadAssessmentComponents error:", e);
    } finally {
      setLoadingComponents(false);
    }
  };


  const load = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterType) params.set("type", filterType);
      if (filterActive) params.set("active", filterActive);
      const q = params.toString() ? `?${params}` : "";
      const res = await api<{ subjects: Subject[] }>(`/admin/subjects${q}`);
      setRows(res.data?.subjects ?? []);
    } finally {
      setLoading(false);
    }
  };

  const loadAssignments = async () => {
    setLoadingAssignments(true);
    try {
      const [tRes, htRes, aRes, cRes, ssoKlsRes, hRes] = await Promise.allSettled([
        api<Array<{ id: string; name: string; nip: string | null }>>("/admin/teachers"),
        api<Array<{ id: string; name: string; nip: string | null }>>("/admin/teachers?role=walikelas"),
        api<Array<{
          id: string;
          userId: string;
          userName: string;
          userNip: string | null;
          subjectId: string;
          subjectName: string;
          subjectCode: string | null;
        }>>("/admin/teacher-assignments"),
        api<{ classes?: Array<{ id: string; name: string }>; data?: unknown }>("/admin/classes"),
        api<Array<{ id: string; nama_kelas: string }>>("/admin/sso/kelas"),
        api<Array<{
          id: string;
          userId: string;
          userName: string;
          userNip: string | null;
          classId: string;
          className: string;
        }>>("/admin/homeroom-assignments"),
      ]);

      if (tRes.status === "fulfilled" && tRes.value?.data) {
        setTeachers(tRes.value.data);
      }
      if (htRes.status === "fulfilled" && htRes.value?.data) {
        setHomeroomTeachers(htRes.value.data);
      }
      if (aRes.status === "fulfilled" && aRes.value?.data) {
        setAssignments(aRes.value.data);
      }

      const combinedClasses: Array<{ id: string; name: string }> = [];
      const seenClassIds = new Set<string>();
      const seenClassNames = new Set<string>();

      if (ssoKlsRes.status === "fulfilled" && ssoKlsRes.value?.data && Array.isArray(ssoKlsRes.value.data)) {
        for (const k of ssoKlsRes.value.data) {
          if (k.id && k.nama_kelas) {
            combinedClasses.push({ id: k.id, name: k.nama_kelas });
            seenClassIds.add(k.id);
            seenClassNames.add(k.nama_kelas.toLowerCase());
          }
        }
      }

      if (cRes.status === "fulfilled" && cRes.value?.data) {
        const val = cRes.value.data;
        const localList = val.classes ?? (Array.isArray(val) ? val : []);
        if (Array.isArray(localList)) {
          for (const k of localList) {
            if (k.id && k.name && !seenClassIds.has(k.id) && !seenClassNames.has(k.name.toLowerCase())) {
              combinedClasses.push({ id: k.id, name: k.name });
              seenClassIds.add(k.id);
              seenClassNames.add(k.name.toLowerCase());
            }
          }
        }
      }

      setClassesList(combinedClasses);

      if (hRes.status === "fulfilled" && hRes.value?.data) {
        setHomeroomAssignmentsList(hRes.value.data);
      }
    } catch (e) {
      console.error("loadAssignments error:", e);
    } finally {
      setLoadingAssignments(false);
    }
  };

  useEffect(() => {
    load();
    loadAssignments();
    loadTeachingHours();
    loadAssessmentComponents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterType, filterActive]);

  // Realtime: auto-reload saat admin CRUD mapel, penugasan guru, atau komponen penilaian
  useRealtimeEvent(
    ["subject_updated", "teacher_assigned"],
    () => {
      load();
      loadAssignments();
      loadAssessmentComponents();
    }
  );

  const handleAssignTeacher = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedTeacherId || !selectedSubjectId) {
      alert("Pilih guru dan mapel terlebih dahulu");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>("/admin/teacher-assignments", {
        method: "POST",
        body: JSON.stringify({
          userId: selectedTeacherId,
          subjectId: selectedSubjectId,
        }),
      });
      if (res.success) {
        setMessage(res.message || "Guru berhasil ditugaskan ke mapel");
        setSelectedTeacherId("");
        setSelectedSubjectId("");
        await loadAssignments();
      } else {
        alert(res.message || "Gagal menugaskan guru");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveAssignment = async (id: string, name: string, mapel: string) => {
    if (!confirm(`Hapus penugasan mengajar ${name} untuk mapel ${mapel}?`)) return;
    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>(`/admin/teacher-assignments/${id}`, {
        method: "DELETE",
      });
      if (res.success) {
        setMessage(res.message || "Penugasan dihapus");
        await loadAssignments();
      } else {
        alert(res.message || "Gagal menghapus penugasan");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const handleAssignHomeroom = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedHomeroomTeacherId || !selectedHomeroomClassId) {
      alert("Pilih guru dan kelas terlebih dahulu");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>("/admin/homeroom-assignments", {
        method: "POST",
        body: JSON.stringify({
          userId: selectedHomeroomTeacherId,
          classId: selectedHomeroomClassId,
        }),
      });
      if (res.success) {
        setMessage(res.message || "Wali kelas berhasil ditugaskan");
        setSelectedHomeroomTeacherId("");
        setSelectedHomeroomClassId("");
        await loadAssignments();
      } else {
        alert(res.message || "Gagal menugaskan wali kelas");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveHomeroom = async (id: string, name: string, className: string) => {
    if (!confirm(`Hapus penugasan wali kelas ${name} untuk kelas ${className}?`)) return;
    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>(`/admin/homeroom-assignments/${id}`, {
        method: "DELETE",
      });
      if (res.success) {
        setMessage(res.message || "Penugasan wali kelas dihapus");
        await loadAssignments();
      } else {
        alert(res.message || "Gagal menghapus penugasan wali kelas");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const handleAddTeachingHour = async (e: FormEvent) => {
    e.preventDefault();
    if (!newHourLabel || !newHourStart || !newHourEnd) {
      alert("Lengkapi semua field jam mengajar!");
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>("/admin/teaching-hours", {
        method: "POST",
        body: JSON.stringify({
          label: newHourLabel,
          startTime: newHourStart,
          endTime: newHourEnd,
        }),
      });
      if (res.success) {
        setNewHourLabel("");
        setNewHourStart("");
        setNewHourEnd("");
        await loadTeachingHours();
      } else {
        alert(res.message || "Gagal menambahkan jam mengajar");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const handleRemoveTeachingHour = async (id: string, label: string) => {
    if (!confirm(`Hapus konfigurasi ${label}?`)) return;
    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>(`/admin/teaching-hours/${id}`, {
        method: "DELETE",
      });
      if (res.success) {
        await loadTeachingHours();
      } else {
        alert(res.message || "Gagal menghapus jam mengajar");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal");
    } finally {
      setBusy(false);
    }
  };

  const assignmentPager = usePagination(assignments, {
    resetKey: "assignments_page",
  });

  const homeroomPager = usePagination(homeroomAssignmentsList, {
    resetKey: "homeroom_page",
  });

  const teachingHoursPager = usePagination(teachingHoursList, {
    resetKey: "teaching_hours_page",
  });

  const assessmentComponentsPager = usePagination(assessmentComponentsList, {
    resetKey: "assessment_components_page",
  });

  const handleSaveComponent = async (e: FormEvent) => {
    e.preventDefault();
    if (!compName.trim() || !compCode.trim()) {
      alert("Nama dan Kode komponen penilaian wajib diisi");
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: compName.trim(),
        code: compCode.trim().toLowerCase(),
        type: compType,
        status: compStatus,
        sortOrder: Number(compSortOrder) || 0,
      };

      if (editingCompId) {
        await api(`/admin/assessment-components/${editingCompId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setMessage("Komponen penilaian berhasil diperbarui");
      } else {
        await api("/admin/assessment-components", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMessage("Komponen penilaian berhasil ditambahkan");
      }

      setEditingCompId(null);
      setCompName("");
      setCompCode("");
      setCompType("UJIAN");
      setCompStatus("active");
      setCompSortOrder(assessmentComponentsList.length + 1);
      await loadAssessmentComponents();
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menyimpan komponen penilaian");
    } finally {
      setBusy(false);
    }
  };

  const handleEditComponent = (c: {
    id: string;
    code: string;
    name: string;
    type: "UJIAN" | "TUGAS";
    status: "active" | "disabled" | "inactive";
    sortOrder: number;
  }) => {
    setEditingCompId(c.id);
    setCompName(c.name);
    setCompCode(c.code);
    setCompType(c.type);
    setCompStatus(c.status);
    setCompSortOrder(c.sortOrder);
  };

  const handleResetCompForm = () => {
    setEditingCompId(null);
    setCompName("");
    setCompCode("");
    setCompType("UJIAN");
    setCompStatus("active");
    setCompSortOrder(assessmentComponentsList.length + 1);
  };

  const handleToggleCompStatus = async (
    cId: string,
    newStatus: "active" | "disabled" | "inactive"
  ) => {
    setBusy(true);
    try {
      await api(`/admin/assessment-components/${cId}`, {
        method: "PUT",
        body: JSON.stringify({ status: newStatus }),
      });
      await loadAssessmentComponents();
    } catch (err) {
      alert("Gagal mengubah status komponen penilaian");
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteComponent = async (id: string, name: string) => {
    if (!confirm(`Apakah Anda yakin ingin menghapus kolom penilaian '${name}'?`)) return;
    setBusy(true);
    try {
      await api(`/admin/assessment-components/${id}`, { method: "DELETE" });
      await loadAssessmentComponents();
    } catch (err) {
      alert("Gagal menghapus komponen penilaian");
    } finally {
      setBusy(false);
    }
  };

  const stats = useMemo(() => {
    const total = rows.length;
    const aktif = rows.filter((r) => r.isActive).length;
    const umum = rows.filter((r) => r.type === "umum").length;
    return { total, aktif, nonaktif: total - aktif, umum };
  }, [rows]);

  const pager = usePagination(rows, {
    resetKey: `${filterType}|${filterActive}`,
  });

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const startEdit = (s: Subject) => {
    setEditingId(s.id);
    setForm({
      name: s.name,
      code: s.code ?? "",
      type: s.type || "umum",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    const payload = {
      name: form.name.trim(),
      code: form.code.trim() || null,
      type: form.type,
    };
    try {
      if (editingId) {
        const res = await api(`/admin/subjects/${editingId}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        setMessage(res.message || "Mapel diperbarui");
      } else {
        const res = await api("/admin/subjects", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        setMessage(res.message || "Mapel ditambahkan");
      }
      resetForm();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal menyimpan");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s: Subject) => {
    if (!confirm(`Hapus permanen mapel ${s.name}? Lebih aman nonaktifkan jika ada riwayat nilai.`))
      return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await api(`/admin/subjects/${s.id}`, { method: "DELETE" });
      setMessage(res.message || "Dihapus");
      if (editingId === s.id) resetForm();
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal menghapus");
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (s: Subject, active: boolean) => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await api(`/admin/subjects/${s.id}/${active ? "activate" : "deactivate"}`, {
        method: "POST",
      });
      setMessage(res.message || (active ? "Diaktifkan" : "Dinonaktifkan"));
      await load();
    } catch (err) {
      setMessage(err instanceof Error ? err.message : "Gagal mengubah status");
    } finally {
      setBusy(false);
    }
  };

  const inputCls = "app-input w-full px-3.5 py-2.5 text-sm";
  const typeLabel = (t: string) => TYPE_OPTIONS.find((o) => o.value === t)?.label ?? t;

  return (
    <div className="space-y-6 md:space-y-8">
      <PageHeader
        eyebrow="Akademik"
        title="Mapel & Penugasan"
        description="Kelola master mata pelajaran serta penugasan mengajar Guru Mapel dan Wali Kelas."
      />

      {message && (
        <div
          className="rounded-2xl px-4 py-3 text-sm border"
          style={{ background: "var(--accent-soft)", borderColor: "transparent", color: "var(--fg)" }}
        >
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total mapel", value: stats.total },
          { label: "Aktif", value: stats.aktif },
          { label: "Nonaktif", value: stats.nonaktif },
          { label: "Jenis umum", value: stats.umum },
        ].map((s) => (
          <Card key={s.label} className="p-4">
            <p className="app-label text-[11px]">{s.label}</p>
            <p className="font-display text-2xl font-bold mt-1 tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 md:gap-6">
        <Card className="p-5 md:p-6 space-y-4 h-fit lg:sticky lg:top-20">
          <div>
            <h2 className="font-display font-bold text-lg">
              {editingId ? "Edit mapel" : "Tambah mapel"}
            </h2>
            <p className="text-xs app-muted mt-1">Contoh: Informatika · INF · umum</p>
          </div>

          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="app-label block mb-1.5">Nama mapel</label>
              <input
                className={inputCls}
                placeholder="Informatika"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                required
              />
            </div>

            <div>
              <label className="app-label block mb-1.5">Kode</label>
              <input
                className={inputCls}
                placeholder="INF"
                value={form.code}
                onChange={(e) => setForm((f) => ({ ...f, code: e.target.value.toUpperCase() }))}
              />
            </div>

            <div>
              <label className="app-label block mb-1.5">Jenis</label>
              <select
                className={inputCls}
                value={form.type}
                onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))}
              >
                {TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex gap-2 pt-1">
              <Button type="submit" disabled={busy} className="flex-1">
                {editingId ? "Simpan" : "Tambah"}
              </Button>
              {editingId && (
                <Button type="button" variant="ghost" disabled={busy} onClick={resetForm}>
                  Batal
                </Button>
              )}
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Daftar mapel"
            subtitle="Master mata pelajaran sekolah"
            action={
              <div className="flex flex-wrap gap-2">
                <select
                  className="app-input px-3 py-2 text-sm min-w-[120px]"
                  value={filterActive}
                  onChange={(e) => setFilterActive(e.target.value)}
                >
                  <option value="">Semua status</option>
                  <option value="true">Aktif</option>
                  <option value="false">Nonaktif</option>
                </select>
                <select
                  className="app-input px-3 py-2 text-sm min-w-[120px]"
                  value={filterType}
                  onChange={(e) => setFilterType(e.target.value)}
                >
                  <option value="">Semua jenis</option>
                  {TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            }
          />

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-left" style={{ background: "var(--hover)" }}>
                <tr>
                  <th className="px-4 py-3 font-semibold">Mapel</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Kode</th>
                  <th className="px-4 py-3 font-semibold">Jenis</th>
                  <th className="px-4 py-3 font-semibold text-right">Penugasan</th>
                  <th className="px-4 py-3 font-semibold text-right">Nilai</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 4 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={7} className="px-4 py-3">
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))
                  : pager.total === 0
                    ? (
                      <tr>
                        <td colSpan={7} className="px-4 py-10 text-center app-muted">
                          Belum ada mapel. Tambah di formulir kiri.
                        </td>
                      </tr>
                      )
                    : pager.pageItems.map((s) => (
                        <tr
                          key={s.id}
                          className="border-t app-divider row-hover transition-colors"
                        >
                          <td className="px-4 py-3 font-display font-semibold">{s.name}</td>
                          <td className="px-4 py-3">
                            {s.isActive ? (
                              <Badge status="success">Aktif</Badge>
                            ) : (
                              <span className="text-xs app-muted">Nonaktif</span>
                            )}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs">{s.code ?? "—"}</td>
                          <td className="px-4 py-3">
                            <Badge status={s.type === "umum" ? "success" : "pending"}>
                              {typeLabel(s.type)}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">{s.assignmentCount}</td>
                          <td className="px-4 py-3 text-right tabular-nums">{s.gradeCount}</td>
                          <td className="px-4 py-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              {s.isActive ? (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() => setActive(s, false)}
                                >
                                  Nonaktifkan
                                </Button>
                              ) : (
                                <Button
                                  size="sm"
                                  disabled={busy}
                                  onClick={() => setActive(s, true)}
                                >
                                  Aktifkan
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="secondary"
                                disabled={busy}
                                onClick={() => startEdit(s)}
                              >
                                Edit
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                disabled={busy}
                                onClick={() => remove(s)}
                              >
                                Hapus
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
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

      <hr className="border-[var(--divider)] my-8" />

      <div className="space-y-3">
        <h2 className="font-display font-bold text-xl">Penugasan Guru (Tugas Guru)</h2>
        <p className="text-xs app-muted">Pasangkan guru yang diimpor dari SSO ke mata pelajaran di SIAKAD.</p>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 md:gap-6 mt-4">
        <Card className="p-5 md:p-6 space-y-4 h-fit">
          <div>
            <h2 className="font-display font-bold text-lg">Tugaskan Guru</h2>
            <p className="text-xs app-muted mt-1">Satu guru dapat merangkap beberapa mapel.</p>
          </div>

          <form onSubmit={handleAssignTeacher} className="space-y-3">
            <div>
              <label className="app-label block mb-1.5">Pilih Guru</label>
              <SearchableSelect
                options={teacherSelectOptions}
                value={selectedTeacherId}
                onChange={setSelectedTeacherId}
                placeholder="-- Pilih Guru --"
                searchPlaceholder="Cari nama guru atau NIP..."
                required
              />
            </div>

            <div>
              <label className="app-label block mb-1.5">Pilih Mapel</label>
              <SearchableSelect
                options={subjectSelectOptions}
                value={selectedSubjectId}
                onChange={setSelectedSubjectId}
                placeholder="-- Pilih Mapel --"
                searchPlaceholder="Cari mata pelajaran..."
                required
              />
            </div>

            <div className="pt-1">
              <Button type="submit" disabled={busy} className="w-full">
                Pasangkan Guru & Mapel
              </Button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Daftar Penugasan Guru"
            subtitle="Pemetaan guru mengajar mata pelajaran"
          />

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="text-left" style={{ background: "var(--hover)" }}>
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama Guru</th>
                  <th className="px-4 py-3 font-semibold">NIP / Identitas</th>
                  <th className="px-4 py-3 font-semibold">Mata Pelajaran</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loadingAssignments ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : assignmentPager.total === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center app-muted">
                      Belum ada penugasan guru. Pasangkan guru di formulir kiri.
                    </td>
                  </tr>
                ) : (
                  assignmentPager.pageItems.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t app-divider row-hover transition-colors"
                    >
                      <td className="px-4 py-3 font-display font-semibold">{a.userName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--fg-muted)]">
                        {a.userNip ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge status="success">
                          {a.subjectName} ({a.subjectCode ?? "—"})
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => handleRemoveAssignment(a.id, a.userName, a.subjectName)}
                        >
                          Hapus
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loadingAssignments && (
            <Pagination
              page={assignmentPager.page}
              totalPages={assignmentPager.totalPages}
              total={assignmentPager.total}
              from={assignmentPager.from}
              to={assignmentPager.to}
              onPageChange={assignmentPager.setPage}
            />
          )}
        </Card>
      </div>

      <hr className="border-[var(--divider)] my-8" />

      <div className="space-y-3">
        <h2 className="font-display font-bold text-xl">Penugasan Wali Kelas (Tugas Wali Kelas)</h2>
        <p className="text-xs app-muted">Pasangkan guru sebagai Wali Kelas ke rombel/kelas di SIAKAD.</p>
      </div>

      <div className="grid lg:grid-cols-[320px_1fr] gap-4 md:gap-6 mt-4">
        <Card className="p-5 md:p-6 space-y-4 h-fit">
          <div>
            <h2 className="font-display font-bold text-lg">Tugaskan Wali Kelas</h2>
            <p className="text-xs app-muted mt-1">Satu guru dapat menjadi wali kelas untuk beberapa kelas.</p>
          </div>

          <form onSubmit={handleAssignHomeroom} className="space-y-3">
            <div>
              <label className="app-label block mb-1.5">Pilih Wali Kelas</label>
              <SearchableSelect
                options={homeroomSelectOptions}
                value={selectedHomeroomTeacherId}
                onChange={setSelectedHomeroomTeacherId}
                placeholder="-- Pilih Wali Kelas --"
                searchPlaceholder="Cari nama wali kelas..."
                required
              />
            </div>

            <div>
              <label className="app-label block mb-1.5">Pilih Kelas</label>
              <SearchableSelect
                options={classSelectOptions}
                value={selectedHomeroomClassId}
                onChange={setSelectedHomeroomClassId}
                placeholder="-- Pilih Kelas --"
                searchPlaceholder="Cari nama kelas..."
                required
              />
            </div>

            <div className="pt-1">
              <Button type="submit" disabled={busy} className="w-full">
                Pasangkan Wali Kelas & Rombel
              </Button>
            </div>
          </form>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader
            title="Daftar Penugasan Wali Kelas"
            subtitle="Pemetaan wali kelas per kelas/rombel"
          />

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[600px]">
              <thead className="text-left" style={{ background: "var(--hover)" }}>
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama Wali Kelas</th>
                  <th className="px-4 py-3 font-semibold">NIP / Identitas</th>
                  <th className="px-4 py-3 font-semibold">Nama Kelas</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loadingAssignments ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={4} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : homeroomPager.total === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-4 py-10 text-center app-muted">
                      Belum ada penugasan wali kelas. Pasangkan wali kelas di formulir kiri.
                    </td>
                  </tr>
                ) : (
                  homeroomPager.pageItems.map((h) => (
                    <tr
                      key={h.id}
                      className="border-t app-divider row-hover transition-colors"
                    >
                      <td className="px-4 py-3 font-display font-semibold">{h.userName}</td>
                      <td className="px-4 py-3 font-mono text-xs text-[var(--fg-muted)]">
                        {h.userNip ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <Badge status="pending">{h.className}</Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => handleRemoveHomeroom(h.id, h.userName, h.className)}
                        >
                          Hapus
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loadingAssignments && (
            <Pagination
              page={homeroomPager.page}
              totalPages={homeroomPager.totalPages}
              total={homeroomPager.total}
              from={homeroomPager.from}
              to={homeroomPager.to}
              onPageChange={homeroomPager.setPage}
            />
          )}
        </Card>
      </div>

      <hr className="border-[var(--divider)] my-8" />

      <div className="space-y-3">
        <h2 className="font-display font-bold text-xl">Konfigurasi Jam Mengajar</h2>
        <p className="text-xs app-muted">Atur pembagian jam pelajaran untuk pengisian Jurnal Guru.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start mt-4">
        {/* Form Tambah Jam */}
        <Card>
          <CardHeader title="Tambah Jam Mengajar" />
          <form onSubmit={handleAddTeachingHour} className="p-5 space-y-4">
            <div>
              <label className="app-label block mb-1.5">Label Jam</label>
              <input
                type="text"
                placeholder="Contoh: Jam ke-1"
                className={inputCls}
                value={newHourLabel}
                onChange={(e) => setNewHourLabel(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="app-label block mb-1.5">Mulai Pukul</label>
                <input
                  type="time"
                  className={inputCls}
                  value={newHourStart}
                  onChange={(e) => setNewHourStart(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="app-label block mb-1.5">Hingga Pukul</label>
                <input
                  type="time"
                  className={inputCls}
                  value={newHourEnd}
                  onChange={(e) => setNewHourEnd(e.target.value)}
                  required
                />
              </div>
            </div>
            <Button type="submit" disabled={busy} className="w-full">
              Tambah Jam
            </Button>
          </form>
        </Card>

        {/* Tabel Jam Pelajaran */}
        <Card className="lg:col-span-2 overflow-hidden">
          <CardHeader
            title="Daftar Jam Pelajaran"
            subtitle="Pembagian jam yang akan tampil di jurnal mengajar guru"
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left" style={{ background: "var(--hover)" }}>
                <tr>
                  <th className="px-4 py-3 font-semibold">Jam Ke</th>
                  <th className="px-4 py-3 font-semibold">Waktu Mengajar</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loadingHours ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={3} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : teachingHoursPager.total === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-4 py-10 text-center app-muted">
                      Belum ada jam mengajar yang dikonfigurasi.
                    </td>
                  </tr>
                ) : (
                  teachingHoursPager.pageItems.map((h) => (
                    <tr key={h.id} className="border-t app-divider row-hover transition-colors">
                      <td className="px-4 py-3 font-semibold">{h.label}</td>
                      <td className="px-4 py-3">
                        <Badge status="success">
                          Pukul {h.startTime} s.d. {h.endTime}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => handleRemoveTeachingHour(h.id, h.label)}
                        >
                          Hapus
                        </Button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!loadingHours && (
            <Pagination
              page={teachingHoursPager.page}
              totalPages={teachingHoursPager.totalPages}
              total={teachingHoursPager.total}
              from={teachingHoursPager.from}
              to={teachingHoursPager.to}
              onPageChange={teachingHoursPager.setPage}
            />
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Konfigurasi Kolom Penilaian (Assessment Components) */}
      {/* ------------------------------------------------------------------ */}
      <div className="space-y-4 pt-4 border-t app-divider">
        <div>
          <h2 className="font-display font-bold text-lg">Konfigurasi Kolom Penilaian</h2>
          <p className="text-xs app-muted mt-0.5">
            Atur kolom komponen nilai yang akan tampil pada tabel Input Nilai Guru dan Raport/Dashboard Siswa.
          </p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Form Tambah/Edit Kolom Penilaian */}
          <Card className="p-5 md:p-6 space-y-4 h-fit">
            <div>
              <h3 className="font-display font-bold text-base">
                {editingCompId ? "Edit Kolom Penilaian" : "Tambah Kolom Penilaian"}
              </h3>
              <p className="text-xs app-muted mt-1">Input nama, kode, dan status kolom nilai</p>
            </div>

            <form onSubmit={handleSaveComponent} className="space-y-3">
              <div>
                <label className="app-label text-[11px] block mb-1">NAMA KOLOM</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: Ulangan Harian 1"
                  value={compName}
                  onChange={(e) => setCompName(e.target.value)}
                  className="app-input w-full px-3.5 py-2.5 text-sm"
                />
              </div>

              <div>
                <label className="app-label text-[11px] block mb-1">KODE (LABEL KOLOM)</label>
                <input
                  type="text"
                  required
                  placeholder="Contoh: UH1, T1, STS"
                  value={compCode}
                  onChange={(e) => setCompCode(e.target.value)}
                  className="app-input w-full px-3.5 py-2.5 text-sm uppercase"
                />
              </div>

              <div>
                <label className="app-label text-[11px] block mb-1">JENIS PENILAIAN</label>
                <select
                  value={compType}
                  onChange={(e) => setCompType(e.target.value as "UJIAN" | "TUGAS")}
                  className="app-input w-full px-3.5 py-2.5 text-sm"
                >
                  <option value="UJIAN">UJIAN</option>
                  <option value="TUGAS">TUGAS</option>
                </select>
              </div>

              <div>
                <label className="app-label text-[11px] block mb-1">STATUS KOLOM</label>
                <select
                  value={compStatus}
                  onChange={(e) => setCompStatus(e.target.value as "active" | "disabled" | "inactive")}
                  className="app-input w-full px-3.5 py-2.5 text-sm"
                >
                  <option value="active">🟢 Aktif (Tampil & Bisa Diisi)</option>
                  <option value="disabled">🟡 Disabled (Segera Hadir / Terkunci Triwulan)</option>
                  <option value="inactive">🔴 Nonaktif (Sembunyi / Hilang)</option>
                </select>
              </div>

              <div>
                <label className="app-label text-[11px] block mb-1">URUTAN TAMPILAN</label>
                <input
                  type="number"
                  min={1}
                  value={compSortOrder}
                  onChange={(e) => setCompSortOrder(parseInt(e.target.value, 10) || 1)}
                  className="app-input w-full px-3.5 py-2.5 text-sm"
                />
              </div>

              <div className="flex gap-2 pt-2">
                <Button type="submit" disabled={busy} className="w-full">
                  {editingCompId ? "Simpan Perubahan" : "Tambah Kolom"}
                </Button>
                {editingCompId && (
                  <Button type="button" variant="secondary" onClick={handleResetCompForm}>
                    Batal
                  </Button>
                )}
              </div>
            </form>
          </Card>

          {/* Tabel Daftar Kolom Penilaian */}
          <Card className="lg:col-span-2 overflow-hidden">
            <CardHeader
              title="Daftar Kolom Penilaian"
              subtitle="Status kolom menentukan apakah kolom dapat diisi guru atau dikunci"
            />
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left" style={{ background: "var(--hover)" }}>
                  <tr>
                    <th className="px-4 py-3 font-semibold">Kode</th>
                    <th className="px-4 py-3 font-semibold">Nama Kolom</th>
                    <th className="px-4 py-3 font-semibold">Jenis</th>
                    <th className="px-4 py-3 font-semibold">Status Tampilan</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {loadingComponents ? (
                    Array.from({ length: 3 }).map((_, i) => (
                      <tr key={i}>
                        <td colSpan={5} className="px-4 py-3">
                          <Skeleton className="h-8 w-full" />
                        </td>
                      </tr>
                    ))
                  ) : assessmentComponentsPager.total === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-10 text-center app-muted">
                        Belum ada kolom penilaian yang dikonfigurasi.
                      </td>
                    </tr>
                  ) : (
                    assessmentComponentsPager.pageItems.map((c) => (
                      <tr key={c.id} className="border-t app-divider row-hover transition-colors">
                        <td className="px-4 py-3 font-bold uppercase">{c.code}</td>
                        <td className="px-4 py-3 font-medium">{c.name}</td>
                        <td className="px-4 py-3">
                          <Badge status={c.type === "UJIAN" ? "info" : "warning"}>
                            {c.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {c.status === "active" && (
                            <Badge status="success">🟢 Aktif (Bisa Diisi)</Badge>
                          )}
                          {c.status === "disabled" && (
                            <Badge status="warning">🟡 Segera Hadir / Terkunci</Badge>
                          )}
                          {c.status === "inactive" && (
                            <Badge status="neutral">🔴 Nonaktif (Sembunyi)</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            <select
                              value={c.status}
                              onChange={(e) =>
                                handleToggleCompStatus(
                                  c.id,
                                  e.target.value as "active" | "disabled" | "inactive"
                                )
                              }
                              className="text-xs app-input px-2 py-1"
                            >
                              <option value="active">Aktif</option>
                              <option value="disabled">Disable (Segera Hadir)</option>
                              <option value="inactive">Nonaktif</option>
                            </select>
                            <Button size="sm" variant="ghost" onClick={() => handleEditComponent(c)}>
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => handleDeleteComponent(c.id, c.name)}
                            >
                              Hapus
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {!loadingComponents && (
              <Pagination
                page={assessmentComponentsPager.page}
                totalPages={assessmentComponentsPager.totalPages}
                total={assessmentComponentsPager.total}
                from={assessmentComponentsPager.from}
                to={assessmentComponentsPager.to}
                onPageChange={assessmentComponentsPager.setPage}
              />
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
