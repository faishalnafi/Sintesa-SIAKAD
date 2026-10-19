import { FormEvent, useEffect, useMemo, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";
import { SearchableSelect } from "@/components/ui/SearchableSelect";
import { Modal } from "@/components/ui/Modal";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";
import { sortClasses, sortSubjects, sortTeachers, sortTeachingHours } from "@/lib/sort";

type Subject = {
  id: string;
  name: string;
  code: string | null;
  type: string;
  isActive: boolean;
  assignmentCount: number;
  gradeCount: number;
};

export type ClassSubjectMapping = {
  id: string;
  classId: string;
  className: string;
  classGrade?: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  subjectType: string;
  teacherUserId: string;
  teacherName: string;
  teacherNip: string | null;
  jp: number;
  createdAt: string;
  updatedAt: string;
};

export type TeacherAssignment = {
  id: string;
  userId: string;
  userName: string;
  userNip: string | null;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  targetJp: number;
  mappedJp: number;
  deficitJp: number;
  excessJp: number;
  status: "under" | "fulfilled" | "over";
};

export type MappingStats = {
  totalMappings: number;
  totalJp: number;
  totalClassesMapped: number;
  classesSummary: Array<{
    classId: string;
    className: string;
    mapelCount: number;
    totalJp: number;
  }>;
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

type TabType = "mapel" | "guru" | "walikelas" | "jam" | "jadwal" | "penilaian";

export function SubjectsPage() {
  const [activeTab, setActiveTab] = useState<TabType>(() => {
    if (typeof window !== "undefined") {
      const hash = window.location.hash.replace("#", "").toLowerCase();
      if (["mapel", "guru", "walikelas", "jam", "jadwal", "penilaian"].includes(hash)) {
        return hash as TabType;
      }
      const searchParams = new URLSearchParams(window.location.search);
      const tabParam = searchParams.get("tab")?.toLowerCase();
      if (tabParam && ["mapel", "guru", "walikelas", "jam", "jadwal", "penilaian"].includes(tabParam)) {
        return tabParam as TabType;
      }
    }
    return "mapel";
  });

  const handleTabChange = (tabId: TabType) => {
    setActiveTab(tabId);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", `#${tabId}`);
    }
  };

  useEffect(() => {
    const onHashChange = () => {
      const hash = window.location.hash.replace("#", "").toLowerCase();
      if (["mapel", "guru", "walikelas", "jam", "jadwal", "penilaian"].includes(hash)) {
        setActiveTab(hash as TabType);
      }
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

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
  const [assignments, setAssignments] = useState<TeacherAssignment[]>([]);
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [targetJpInput, setTargetJpInput] = useState<number>(24);
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

  // Mapping Jadwal & Pemetaan Tugas Guru per Kelas States
  const [mappings, setMappings] = useState<ClassSubjectMapping[]>([]);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [selectedMappingClassId, setSelectedMappingClassId] = useState<string>("");
  const [mappingSearch, setMappingSearch] = useState<string>("");
  const [mappingGradeFilter, setMappingGradeFilter] = useState<string>("ALL");
  const [mappingStats, setMappingStats] = useState<MappingStats | null>(null);

  // Modal / Form state pemetaan mapel ke kelas
  const [isAddMappingModalOpen, setIsAddMappingModalOpen] = useState(false);
  const [editingMappingId, setEditingMappingId] = useState<string | null>(null);
  const [modalSubjectId, setModalSubjectId] = useState("");
  const [modalTeacherUserId, setModalTeacherUserId] = useState("");
  const [modalJp, setModalJp] = useState(2);

  // Modal salin pemetaan ke kelas lain
  const [isCopyClassModalOpen, setIsCopyClassModalOpen] = useState(false);
  const [copyTargetClassId, setCopyTargetClassId] = useState("");

  const loadMappings = async (classId?: string) => {
    setLoadingMappings(true);
    try {
      const url = classId ? `/admin/class-subject-mappings?classId=${classId}` : "/admin/class-subject-mappings";
      const res = await api<ClassSubjectMapping[]>(url);
      setMappings(res.data ?? []);
    } catch (e) {
      console.error("loadMappings error:", e);
    } finally {
      setLoadingMappings(false);
    }
  };

  const loadMappingStats = async () => {
    try {
      const res = await api<MappingStats>("/admin/class-subject-mappings/stats");
      if (res.data) {
        setMappingStats(res.data);
      }
    } catch (e) {
      console.error("loadMappingStats error:", e);
    }
  };

  // Saat kelas terpilih berganti atau data kelas dimuat
  useEffect(() => {
    if (classesList.length > 0 && !selectedMappingClassId) {
      setSelectedMappingClassId(classesList[0].id);
    }
  }, [classesList, selectedMappingClassId]);

  useEffect(() => {
    if (selectedMappingClassId) {
      loadMappings(selectedMappingClassId);
    }
  }, [selectedMappingClassId]);

  useEffect(() => {
    loadMappingStats();
  }, []);

  const handleOpenAddMapping = () => {
    setEditingMappingId(null);
    setModalSubjectId("");
    setModalTeacherUserId("");
    setModalJp(2);
    setIsAddMappingModalOpen(true);
  };

  const handleOpenEditMapping = (m: ClassSubjectMapping) => {
    setEditingMappingId(m.id);
    setModalSubjectId(m.subjectId);
    setModalTeacherUserId(m.teacherUserId);
    setModalJp(m.jp);
    setIsAddMappingModalOpen(true);
  };

  const handleModalSelectSubject = (subjId: string) => {
    setModalSubjectId(subjId);
    // Cari guru yang sudah ditugaskan ke mapel ini di master penugasan guru
    const existing = assignments.find((a) => a.subjectId === subjId);
    if (existing) {
      setModalTeacherUserId(existing.userId);
    }
  };

  const handleSaveMapping = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedMappingClassId) {
      Swal.fire({ icon: "warning", title: "Pilih Kelas", text: "Silakan pilih kelas terlebih dahulu.", confirmButtonColor: "#2563eb" });
      return;
    }
    if (!modalSubjectId) {
      Swal.fire({ icon: "warning", title: "Pilih Mapel", text: "Silakan pilih mata pelajaran.", confirmButtonColor: "#2563eb" });
      return;
    }
    if (!modalTeacherUserId) {
      Swal.fire({ icon: "warning", title: "Pilih Guru", text: "Silakan pilih guru pengajar.", confirmButtonColor: "#2563eb" });
      return;
    }

    setBusy(true);
    try {
      if (editingMappingId) {
        const res = await api<{ success: boolean; message?: string }>(`/admin/class-subject-mappings/${editingMappingId}`, {
          method: "PUT",
          body: JSON.stringify({
            teacherUserId: modalTeacherUserId,
            jp: modalJp,
          }),
        });
        if (res.success) {
          Swal.fire({ icon: "success", title: "Berhasil", text: "Pemetaan tugas guru berhasil diperbarui.", timer: 1500, showConfirmButton: false });
          setIsAddMappingModalOpen(false);
          await Promise.all([loadMappings(selectedMappingClassId), loadMappingStats()]);
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: res.message || "Gagal memperbarui pemetaan.", confirmButtonColor: "#2563eb" });
        }
      } else {
        const res = await api<{ success: boolean; message?: string }>("/admin/class-subject-mappings", {
          method: "POST",
          body: JSON.stringify({
            classId: selectedMappingClassId,
            subjectId: modalSubjectId,
            teacherUserId: modalTeacherUserId,
            jp: modalJp,
          }),
        });
        if (res.success) {
          Swal.fire({ icon: "success", title: "Berhasil", text: "Mata pelajaran & guru berhasil dipetakan ke kelas ini.", timer: 1500, showConfirmButton: false });
          setIsAddMappingModalOpen(false);
          await Promise.all([loadMappings(selectedMappingClassId), loadMappingStats()]);
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: res.message || "Gagal menyimpan pemetaan.", confirmButtonColor: "#2563eb" });
        }
      }
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err instanceof Error ? err.message : "Terjadi kesalahan.", confirmButtonColor: "#2563eb" });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteMapping = async (id: string, subjectName: string, teacherName: string) => {
    const confirm = await Swal.fire({
      title: "Hapus Pemetaan?",
      html: `Apakah Anda yakin ingin menghapus mapel <b>${subjectName}</b> (Guru: <b>${teacherName}</b>) dari kelas ini?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#e11d48",
      cancelButtonColor: "#64748b",
      confirmButtonText: "Ya, Hapus",
      cancelButtonText: "Batal",
    });
    if (!confirm.isConfirmed) return;

    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>(`/admin/class-subject-mappings/${id}`, {
        method: "DELETE",
      });
      if (res.success) {
        Swal.fire({ icon: "success", title: "Terhapus", text: "Pemetaan mapel berhasil dihapus.", timer: 1500, showConfirmButton: false });
        await Promise.all([loadMappings(selectedMappingClassId), loadMappingStats()]);
      } else {
        Swal.fire({ icon: "error", title: "Gagal", text: res.message || "Gagal menghapus.", confirmButtonColor: "#2563eb" });
      }
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err instanceof Error ? err.message : "Terjadi kesalahan.", confirmButtonColor: "#2563eb" });
    } finally {
      setBusy(false);
    }
  };

  const handleQuickUpdateJp = async (mappingId: string, currentJp: number, delta: number) => {
    const targetMapping = mappings.find((m) => m.id === mappingId);
    if (!targetMapping) return;

    const newJp = Math.max(1, Math.min(20, currentJp + delta));
    if (newJp === currentJp) return;

    // Cek jika penambahan akan melebihi target beban JP guru
    if (delta > 0) {
      const assignment = assignments.find(
        (a) => a.subjectId === targetMapping.subjectId && a.userId === targetMapping.teacherUserId
      );
      if (assignment) {
        const targetJp = assignment.targetJp || 24;
        const currentMapped = assignment.mappedJp || 0;
        if (currentMapped + delta > targetJp) {
          Swal.fire({
            icon: "error",
            title: "Beban Mengajar Melebihi Batas!",
            html: `Guru <b>${targetMapping.teacherName}</b> memiliki target beban maksimal <b>${targetJp} JP</b> per pekan.<br/><br/>Saat ini sudah terpetakan <b>${currentMapped} JP</b> di seluruh rombel. Penambahan tidak dapat dilakukan karena akan melebihi target.`,
            confirmButtonColor: "#2563eb",
          });
          return;
        }
      }
    }

    // Optimistic UI update
    setMappings((prev) =>
      prev.map((m) => (m.id === mappingId ? { ...m, jp: newJp } : m))
    );

    try {
      const res = await api<{ success: boolean; message?: string }>(`/admin/class-subject-mappings/${mappingId}`, {
        method: "PUT",
        body: JSON.stringify({ jp: newJp }),
      });
      if (!res.success) {
        Swal.fire({ icon: "error", title: "Gagal Mengubah JP", text: res.message || "Gagal mengubah alokasi JP", confirmButtonColor: "#2563eb" });
        await loadMappings(selectedMappingClassId);
      } else {
        await Promise.all([loadMappingStats(), loadAssignments()]);
      }
    } catch (e) {
      console.error(e);
      Swal.fire({ icon: "error", title: "Gagal Mengubah JP", text: e instanceof Error ? e.message : "Terjadi kesalahan.", confirmButtonColor: "#2563eb" });
      await loadMappings(selectedMappingClassId);
    }
  };

  const handleAutoPopulate = async () => {
    if (!selectedMappingClassId) return;
    const currentClass = classesList.find((c) => c.id === selectedMappingClassId);

    const confirm = await Swal.fire({
      title: "Tautkan Otomatis dari Penugasan Guru?",
      html: `Seluruh mata pelajaran aktif yang sudah memiliki guru penugasan di tab <b>Penugasan Guru</b> akan otomatis ditautkan ke kelas <b>${currentClass?.name || "ini"}</b> dengan alokasi standar <b>2 JP</b> per mapel.<br/><br/><small class="text-gray-500">Mapel yang sudah ada di kelas ini tidak akan ditimpa.</small>`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#2563eb",
      cancelButtonColor: "#64748b",
      confirmButtonText: "Ya, Tautkan Sekarang",
      cancelButtonText: "Batal",
    });

    if (!confirm.isConfirmed) return;

    setBusy(true);
    try {
      const res = await api<{ success: boolean; message: string; data?: { insertedCount: number } }>("/admin/class-subject-mappings/auto-populate", {
        method: "POST",
        body: JSON.stringify({
          classId: selectedMappingClassId,
          defaultJp: 2,
        }),
      });

      if (res.success) {
        Swal.fire({
          icon: "success",
          title: "Selesai",
          text: res.message,
          confirmButtonColor: "#2563eb",
        });
        await Promise.all([loadMappings(selectedMappingClassId), loadMappingStats()]);
      } else {
        Swal.fire({ icon: "error", title: "Gagal", text: res.message, confirmButtonColor: "#2563eb" });
      }
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err instanceof Error ? err.message : "Terjadi kesalahan.", confirmButtonColor: "#2563eb" });
    } finally {
      setBusy(false);
    }
  };

  const handleCopyClass = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedMappingClassId || !copyTargetClassId) return;

    const srcClass = classesList.find((c) => c.id === selectedMappingClassId);
    const destClass = classesList.find((c) => c.id === copyTargetClassId);

    const confirm = await Swal.fire({
      title: "Salin Pemetaan ke Kelas Lain?",
      html: `Duplikasi seluruh pemetaan mapel, guru pengajar, dan JP dari <b>${srcClass?.name}</b> ke <b>${destClass?.name}</b>?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#2563eb",
      cancelButtonColor: "#64748b",
      confirmButtonText: "Ya, Salin",
      cancelButtonText: "Batal",
    });

    if (!confirm.isConfirmed) return;

    setBusy(true);
    try {
      const res = await api<{ success: boolean; message: string }>("/admin/class-subject-mappings/copy-class", {
        method: "POST",
        body: JSON.stringify({
          sourceClassId: selectedMappingClassId,
          targetClassId: copyTargetClassId,
        }),
      });

      if (res.success) {
        Swal.fire({ icon: "success", title: "Berhasil Disalin", text: res.message, confirmButtonColor: "#2563eb" });
        setIsCopyClassModalOpen(false);
        setCopyTargetClassId("");
        await loadMappingStats();
      } else {
        Swal.fire({ icon: "error", title: "Gagal", text: res.message, confirmButtonColor: "#2563eb" });
      }
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err instanceof Error ? err.message : "Terjadi kesalahan.", confirmButtonColor: "#2563eb" });
    } finally {
      setBusy(false);
    }
  };

  const selectedClass = useMemo(() => {
    return classesList.find((c) => c.id === selectedMappingClassId);
  }, [classesList, selectedMappingClassId]);

  const selectedClassHomeroom = useMemo(() => {
    return homeroomAssignmentsList.find((h) => h.classId === selectedMappingClassId);
  }, [homeroomAssignmentsList, selectedMappingClassId]);

  const filteredClassesList = useMemo(() => {
    return classesList.filter((c) => {
      if (mappingGradeFilter === "ALL") return true;
      const nameUpper = c.name.toUpperCase();
      if (mappingGradeFilter === "X") {
        return nameUpper.startsWith("X ") || nameUpper.startsWith("X-") || nameUpper === "X" || nameUpper.startsWith("10");
      }
      if (mappingGradeFilter === "XI") {
        return nameUpper.startsWith("XI ") || nameUpper.startsWith("XI-") || nameUpper === "XI" || nameUpper.startsWith("11");
      }
      if (mappingGradeFilter === "XII") {
        return nameUpper.startsWith("XII ") || nameUpper.startsWith("XII-") || nameUpper === "XII" || nameUpper.startsWith("12");
      }
      return true;
    });
  }, [classesList, mappingGradeFilter]);

  const classSummaryMap = useMemo(() => {
    const map: Record<string, { mapelCount: number; totalJp: number }> = {};
    if (mappingStats?.classesSummary) {
      for (const item of mappingStats.classesSummary) {
        map[item.classId] = {
          mapelCount: item.mapelCount,
          totalJp: item.totalJp,
        };
      }
    }
    return map;
  }, [mappingStats]);

  const filteredMappings = useMemo(() => {
    return mappings.filter((m) => {
      if (!mappingSearch.trim()) return true;
      const q = mappingSearch.toLowerCase();
      return (
        m.subjectName.toLowerCase().includes(q) ||
        (m.subjectCode && m.subjectCode.toLowerCase().includes(q)) ||
        m.teacherName.toLowerCase().includes(q) ||
        (m.teacherNip && m.teacherNip.toLowerCase().includes(q))
      );
    });
  }, [mappings, mappingSearch]);

  const totalClassJp = useMemo(() => {
    return mappings.reduce((acc, curr) => acc + (curr.jp || 0), 0);
  }, [mappings]);

  const currentEditingMapping = useMemo(() => {
    return mappings.find((m) => m.id === editingMappingId);
  }, [mappings, editingMappingId]);

  const loadTeachingHours = async () => {
    setLoadingHours(true);
    try {
      const res = await api<Array<{ id: string; label: string; startTime: string; endTime: string }>>("/admin/teaching-hours");
      setTeachingHoursList(sortTeachingHours(res.data ?? []));
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
      setRows(sortSubjects(res.data?.subjects ?? []));
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
        api<Array<TeacherAssignment>>("/admin/teacher-assignments"),
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
        setTeachers(sortTeachers(tRes.value.data));
      }
      if (htRes.status === "fulfilled" && htRes.value?.data) {
        setHomeroomTeachers(sortTeachers(htRes.value.data));
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

      setClassesList(sortClasses(combinedClasses));

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

  // Realtime: auto-reload saat admin CRUD mapel, penugasan guru, jadwal/pemetaan, atau komponen penilaian
  useRealtimeEvent(
    ["subject_updated", "teacher_assigned", "schedule_updated"],
    () => {
      load();
      loadAssignments();
      loadAssessmentComponents();
      loadMappingStats();
      if (selectedMappingClassId) {
        loadMappings(selectedMappingClassId);
      }
    }
  );

  const handleAssignTeacher = async (e: FormEvent) => {
    e.preventDefault();
    if (!selectedTeacherId || !selectedSubjectId) {
      Swal.fire({ icon: "warning", title: "Pilih Guru & Mapel", text: "Silakan pilih guru dan mata pelajaran terlebih dahulu.", confirmButtonColor: "#2563eb" });
      return;
    }
    setBusy(true);
    try {
      const res = await api<{ success: boolean; message?: string }>("/admin/teacher-assignments", {
        method: "POST",
        body: JSON.stringify({
          userId: selectedTeacherId,
          subjectId: selectedSubjectId,
          targetJp: targetJpInput,
        }),
      });
      if (res.success) {
        Swal.fire({ icon: "success", title: "Berhasil", text: res.message || "Guru berhasil ditugaskan ke mapel", timer: 1500, showConfirmButton: false });
        setSelectedTeacherId("");
        setSelectedSubjectId("");
        setTargetJpInput(24);
        await loadAssignments();
      } else {
        Swal.fire({ icon: "error", title: "Gagal", text: res.message || "Gagal menugaskan guru", confirmButtonColor: "#2563eb" });
      }
    } catch (err) {
      Swal.fire({ icon: "error", title: "Gagal", text: err instanceof Error ? err.message : "Terjadi kesalahan.", confirmButtonColor: "#2563eb" });
    } finally {
      setBusy(false);
    }
  };

  const handleEditTargetJp = async (assignmentId: string, currentTarget: number, teacherName: string, mapelName: string) => {
    const { value: newTarget } = await Swal.fire({
      title: "Ubah Target Beban JP",
      html: `Target JP mingguan untuk <b>${teacherName}</b><br/><small class="text-gray-500">${mapelName}</small>`,
      input: "number",
      inputValue: currentTarget || 24,
      inputAttributes: {
        min: "1",
        max: "60",
        step: "1",
      },
      showCancelButton: true,
      confirmButtonText: "Simpan Target",
      cancelButtonText: "Batal",
      confirmButtonColor: "#2563eb",
      inputValidator: (val) => {
        const num = parseInt(val);
        if (!val || isNaN(num) || num < 1 || num > 60) {
          return "Masukkan angka target JP antara 1 s/d 60 JP";
        }
        return null;
      },
    });

    if (newTarget) {
      setBusy(true);
      try {
        const res = await api<{ success: boolean; message?: string }>(`/admin/teacher-assignments/${assignmentId}`, {
          method: "PUT",
          body: JSON.stringify({ targetJp: parseInt(newTarget) }),
        });
        if (res.success) {
          Swal.fire({ icon: "success", title: "Berhasil", text: "Target JP berhasil diperbarui", timer: 1500, showConfirmButton: false });
          await loadAssignments();
        } else {
          Swal.fire({ icon: "error", title: "Gagal", text: res.message || "Gagal memperbarui target JP", confirmButtonColor: "#2563eb" });
        }
      } catch (err) {
        Swal.fire({ icon: "error", title: "Gagal", text: err instanceof Error ? err.message : "Terjadi kesalahan." });
      } finally {
        setBusy(false);
      }
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
    setActiveTab("penilaian");
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

  const currentTabStats = useMemo(() => {
    switch (activeTab) {
      case "mapel":
        return [
          { label: "Total mapel", value: stats.total, icon: "menu_book" },
          { label: "Aktif", value: stats.aktif, icon: "check_circle" },
          { label: "Nonaktif", value: stats.nonaktif, icon: "cancel" },
          { label: "Jenis umum", value: stats.umum, icon: "category" },
        ];
      case "guru": {
        const assignedTeachers = new Set(assignments.map((a) => a.userId)).size;
        const mappedSubjects = new Set(assignments.map((a) => a.subjectId)).size;
        return [
          { label: "Total Penugasan", value: assignments.length, icon: "assignment" },
          { label: "Guru Bertugas", value: assignedTeachers, icon: "school" },
          { label: "Mapel Terpetakan", value: mappedSubjects, icon: "book" },
          { label: "Total Guru", value: teachers.length, icon: "groups" },
        ];
      }
      case "walikelas": {
        const assignedClasses = new Set(homeroomAssignmentsList.map((h) => h.classId)).size;
        const assignedTeachers = new Set(homeroomAssignmentsList.map((h) => h.userId)).size;
        return [
          { label: "Total Wali Kelas", value: homeroomAssignmentsList.length, icon: "supervisor_account" },
          { label: "Kelas Terisi", value: assignedClasses, icon: "meeting_room" },
          { label: "Total Kelas", value: classesList.length, icon: "domain" },
          { label: "Guru Wali", value: assignedTeachers, icon: "person" },
        ];
      }
      case "jam": {
        const first = teachingHoursList[0]?.startTime ? `Pukul ${teachingHoursList[0].startTime}` : "—";
        const last = teachingHoursList[teachingHoursList.length - 1]?.endTime
          ? `Pukul ${teachingHoursList[teachingHoursList.length - 1].endTime}`
          : "—";
        return [
          { label: "Total Jam KBM", value: teachingHoursList.length, icon: "schedule" },
          { label: "Mulai Pertama", value: first, icon: "login" },
          { label: "Selesai Terakhir", value: last, icon: "logout" },
          { label: "Status Jam", value: teachingHoursList.length > 0 ? "Tersedia" : "Kosong", icon: "timelapse" },
        ];
      }
      case "jadwal":
        return [
          { label: "Total Pemetaan", value: mappingStats?.totalMappings ?? 0, icon: "assignment" },
          { label: "Total JP Terjadwal", value: `${mappingStats?.totalJp ?? 0} JP`, icon: "schedule" },
          { label: "Kelas Terpetakan", value: `${mappingStats?.totalClassesMapped ?? 0} / ${classesList.length}`, icon: "domain" },
          { label: "Rata-rata JP/Kelas", value: mappingStats && mappingStats.totalClassesMapped > 0 ? `${(mappingStats.totalJp / mappingStats.totalClassesMapped).toFixed(1)} JP` : "0 JP", icon: "timelapse" },
        ];
      case "penilaian": {
        const activeCols = assessmentComponentsList.filter((c) => c.status === "active").length;
        const disabledCols = assessmentComponentsList.filter((c) => c.status === "disabled").length;
        const ujianCount = assessmentComponentsList.filter((c) => c.type === "UJIAN").length;
        const tugasCount = assessmentComponentsList.filter((c) => c.type === "TUGAS").length;
        return [
          { label: "Total Komponen", value: assessmentComponentsList.length, icon: "fact_check" },
          { label: "Kolom Aktif", value: activeCols, icon: "check_circle" },
          { label: "Terkunci / Disabled", value: disabledCols, icon: "lock" },
          { label: "Komposisi", value: `${ujianCount} Ujian · ${tugasCount} Tugas`, icon: "pie_chart" },
        ];
      }
      default:
        return [
          { label: "Total mapel", value: stats.total, icon: "menu_book" },
          { label: "Aktif", value: stats.aktif, icon: "check_circle" },
          { label: "Nonaktif", value: stats.nonaktif, icon: "cancel" },
          { label: "Jenis umum", value: stats.umum, icon: "category" },
        ];
    }
  }, [
    activeTab,
    stats,
    assignments,
    teachers.length,
    homeroomAssignmentsList,
    classesList.length,
    teachingHoursList,
    assessmentComponentsList,
    mappingStats,
  ]);

  const tabs: Array<{
    id: TabType;
    label: string;
    icon: string;
    count: number | string;
    description: string;
    isOngoing?: boolean;
  }> = [
    {
      id: "mapel",
      label: "Mata Pelajaran",
      icon: "menu_book",
      count: stats.total,
      description: "Master data dan daftar mata pelajaran sekolah",
    },
    {
      id: "guru",
      label: "Penugasan Guru",
      icon: "school",
      count: assignments.length,
      description: "Pemetaan guru mata pelajaran",
    },
    {
      id: "walikelas",
      label: "Wali Kelas",
      icon: "supervisor_account",
      count: homeroomAssignmentsList.length,
      description: "Pemetaan wali kelas per rombel",
    },
    {
      id: "jam",
      label: "Jam Mengajar",
      icon: "schedule",
      count: teachingHoursList.length,
      description: "Konfigurasi jam pelajaran & jadwal KBM",
    },
    {
      id: "jadwal",
      label: "Mapping Jadwal",
      icon: "calendar_month",
      count: mappingStats?.totalMappings ?? 0,
      description: "Pemetaan tugas mengajar guru & alokasi jam pelajaran (JP) per rombel kelas",
    },
    {
      id: "penilaian",
      label: "Kolom Penilaian",
      icon: "fact_check",
      count: assessmentComponentsList.length,
      description: "Konfigurasi kolom komponen penilaian",
    },
  ];

  const pager = usePagination(rows, {
    resetKey: `${filterType}|${filterActive}`,
  });

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
  };

  const startEdit = (s: Subject) => {
    setActiveTab("mapel");
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
        {currentTabStats.map((s) => (
          <Card key={s.label} className="p-4 transition-all duration-200">
            <div className="flex items-center justify-between">
              <p className="app-label text-[11px]">{s.label}</p>
              {s.icon && (
                <span className="material-symbols-outlined text-[18px] text-[var(--accent)] opacity-80">
                  {s.icon}
                </span>
              )}
            </div>
            <p className="font-display text-2xl font-bold mt-1 tabular-nums">{s.value}</p>
          </Card>
        ))}
      </div>

      {/* Tab Navigation Menu / Organizer Header */}
      <div
        className="flex items-center gap-1.5 p-1.5 rounded-2xl border overflow-x-auto no-scrollbar shadow-xs"
        style={{ background: "var(--card)", borderColor: "var(--divider)" }}
      >
        {tabs.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => handleTabChange(tab.id)}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer ${
                active
                  ? "bg-[var(--accent)] text-white shadow-sm font-bold"
                  : "app-muted hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              }`}
              title={tab.description}
            >
              <span className="material-symbols-outlined text-[19px]">{tab.icon}</span>
              <span>{tab.label}</span>
              <span
                className={`ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold tabular-nums transition-colors ${
                  active
                    ? "bg-white/25 text-white"
                    : tab.isOngoing
                    ? "bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30"
                    : "bg-[var(--hover)] text-[var(--muted)] border border-[var(--divider)]"
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab Content 1: Mata Pelajaran */}
      {activeTab === "mapel" && (
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
      )}

      {/* Tab Content 2: Penugasan Guru */}
      {activeTab === "guru" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-display font-bold text-xl">Penugasan Guru (Tugas Guru)</h2>
            <p className="text-xs app-muted">Pasangkan guru yang diimpor dari SSO ke mata pelajaran di SIAKAD.</p>
          </div>

          <div className="grid lg:grid-cols-[320px_1fr] gap-4 md:gap-6">
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

            <div>
              <label className="app-label block mb-1.5">Target Beban JP / Pekan</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={60}
                  value={targetJpInput}
                  onChange={(e) => setTargetJpInput(Math.max(1, Math.min(60, parseInt(e.target.value) || 1)))}
                  className="w-24 text-center font-bold text-sm app-input py-2 px-3 rounded-xl border border-[var(--divider)]"
                  required
                />
                <span className="text-xs app-muted">JP / Minggu (misal 24 JP, 26 JP, dll)</span>
              </div>
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
            subtitle="Pemetaan guru mengajar mata pelajaran dan pemenuhan beban JP"
          />

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead className="text-left" style={{ background: "var(--hover)" }}>
                <tr>
                  <th className="px-4 py-3 font-semibold">Nama Guru</th>
                  <th className="px-4 py-3 font-semibold">Mata Pelajaran</th>
                  <th className="px-4 py-3 font-semibold text-center w-28">Target JP</th>
                  <th className="px-4 py-3 font-semibold text-center w-28">Terpetakan</th>
                  <th className="px-4 py-3 font-semibold">Status Pemenuhan</th>
                  <th className="px-4 py-3 font-semibold text-right w-24">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {loadingAssignments ? (
                  Array.from({ length: 3 }).map((_, i) => (
                    <tr key={i}>
                      <td colSpan={6} className="px-4 py-3">
                        <Skeleton className="h-8 w-full" />
                      </td>
                    </tr>
                  ))
                ) : assignmentPager.total === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center app-muted">
                      Belum ada penugasan guru. Pasangkan guru di formulir kiri.
                    </td>
                  </tr>
                ) : (
                  assignmentPager.pageItems.map((a) => (
                    <tr
                      key={a.id}
                      className="border-t app-divider row-hover transition-colors"
                    >
                      <td className="px-4 py-3">
                        <div className="font-display font-semibold text-sm">{a.userName}</div>
                        <div className="font-mono text-xs text-[var(--fg-muted)]">
                          {a.userNip ? `NIP: ${a.userNip}` : "Non-NIP"}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge status="success">
                          {a.subjectName} ({a.subjectCode ?? "—"})
                        </Badge>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          type="button"
                          onClick={() => handleEditTargetJp(a.id, a.targetJp || 24, a.userName, a.subjectName)}
                          title="Klik untuk ubah Target JP"
                          className="inline-flex items-center gap-1 font-bold font-mono text-xs px-2.5 py-1 rounded-lg bg-[var(--hover)] hover:bg-[var(--accent-soft)] hover:text-[var(--accent)] border border-[var(--divider)] transition-colors"
                        >
                          {a.targetJp || 24} JP
                          <span className="material-symbols-outlined text-[13px]">edit</span>
                        </button>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold font-mono text-xs text-[var(--fg)]">
                          {a.mappedJp || 0} JP
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {a.status === "under" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-semibold">
                            <span className="material-symbols-outlined text-[14px]">warning</span>
                            Kurang {a.deficitJp} JP ({a.mappedJp || 0}/{a.targetJp || 24} JP)
                          </span>
                        ) : a.status === "fulfilled" ? (
                          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 font-semibold">
                            <span className="material-symbols-outlined text-[14px]">check_circle</span>
                            Terpenuhi ({a.targetJp || 24}/{a.targetJp || 24} JP)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 font-semibold">
                            <span className="material-symbols-outlined text-[14px]">error</span>
                            Lebih {a.excessJp} JP ({a.mappedJp || 0}/{a.targetJp || 24} JP)
                          </span>
                        )}
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
        </div>
      )}

      {/* Tab Content 3: Wali Kelas */}
      {activeTab === "walikelas" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-display font-bold text-xl">Penugasan Wali Kelas (Tugas Wali Kelas)</h2>
            <p className="text-xs app-muted">Pasangkan guru sebagai Wali Kelas ke rombel/kelas di SIAKAD.</p>
          </div>

          <div className="grid lg:grid-cols-[320px_1fr] gap-4 md:gap-6">
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
        </div>
      )}

      {/* Tab Content 4: Jam Mengajar */}
      {activeTab === "jam" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-display font-bold text-xl">Konfigurasi Jam Mengajar</h2>
            <p className="text-xs app-muted">Atur pembagian jam pelajaran untuk pengisian Jurnal Guru.</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
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
        </div>
      )}

      {/* Tab Content 5: Mapping Jadwal & Pemetaan Tugas Guru per Kelas */}
      {activeTab === "jadwal" && (
        <div className="space-y-5">
          {/* Header & Quick Intro */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <h2 className="font-display font-bold text-xl">Pemetaan Tugas Guru & Jam Pelajaran (JP)</h2>
                <Badge status="success">Aktif · Terintegrasi Jurnal</Badge>
              </div>
              <p className="text-xs app-muted">
                Petakan mata pelajaran beserta guru pengajar per rombongan belajar (kelas) dan tentukan alokasi Jam Pelajaran (JP) mingguan.
              </p>
            </div>

            {/* Quick Action Top Bar (Desktop) */}
            <div className="hidden sm:flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={true}
                title="Fitur Tarik Otomatis dinonaktifkan sementara"
                className="gap-1.5 text-xs opacity-50 cursor-not-allowed"
              >
                <span className="material-symbols-outlined text-[16px] text-amber-500">bolt</span>
                Tarik Otomatis
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => {
                  setCopyTargetClassId("");
                  setIsCopyClassModalOpen(true);
                }}
                disabled={busy || !selectedMappingClassId || mappings.length === 0}
                title="Salin seluruh susunan mapel dan guru kelas ini ke kelas rombel lain"
                className="gap-1.5 text-xs"
              >
                <span className="material-symbols-outlined text-[16px] text-sky-500">content_copy</span>
                Salin Kelas
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleOpenAddMapping}
                disabled={busy || !selectedMappingClassId}
                className="gap-1.5 text-xs"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                Petakan Mapel
              </Button>
            </div>
          </div>

          {/* Mobile Top Selector (Prioritas 2: Mobile - Layar < lg) */}
          <div className="lg:hidden space-y-3">
            <Card className="p-3.5 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                  Pilih Rombongan Belajar (Kelas)
                </label>
                <div className="flex items-center gap-1">
                  {["ALL", "X", "XI", "XII"].map((grade) => (
                    <button
                      key={grade}
                      type="button"
                      onClick={() => setMappingGradeFilter(grade)}
                      className={`px-2 py-0.5 text-[11px] rounded-md font-medium transition-colors ${
                        mappingGradeFilter === grade
                          ? "bg-[var(--accent)] text-white"
                          : "bg-[var(--hover)] app-muted hover:text-[var(--fg)]"
                      }`}
                    >
                      {grade === "ALL" ? "Semua" : grade}
                    </button>
                  ))}
                </div>
              </div>

              <select
                value={selectedMappingClassId}
                onChange={(e) => setSelectedMappingClassId(e.target.value)}
                className="w-full text-sm app-input font-medium py-2.5 px-3 rounded-xl border border-[var(--divider)]"
              >
                {filteredClassesList.map((c) => {
                  const summary = classSummaryMap[c.id];
                  const jpText = summary ? ` (${summary.totalJp} JP · ${summary.mapelCount} Mapel)` : " (0 JP)";
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name} {jpText}
                    </option>
                  );
                })}
              </select>

              {/* Mobile Quick Action Buttons */}
              <div className="grid grid-cols-3 gap-2 pt-1 sm:hidden">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleOpenAddMapping}
                  disabled={busy || !selectedMappingClassId}
                  className="w-full text-[11px] px-2 py-2 flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  Petakan
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={true}
                  title="Fitur Tarik Otomatis dinonaktifkan sementara"
                  className="w-full text-[11px] px-2 py-2 flex items-center justify-center gap-1 opacity-50 cursor-not-allowed"
                >
                  <span className="material-symbols-outlined text-[14px] text-amber-500">bolt</span>
                  Otomatis
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setCopyTargetClassId("");
                    setIsCopyClassModalOpen(true);
                  }}
                  disabled={busy || !selectedMappingClassId || mappings.length === 0}
                  className="w-full text-[11px] px-2 py-2 flex items-center justify-center gap-1"
                >
                  <span className="material-symbols-outlined text-[14px] text-sky-500">content_copy</span>
                  Salin
                </Button>
              </div>
            </Card>
          </div>

          {/* Main Layout: Split-View 2 Kolom (Prioritas 1: Desktop, Prioritas 3: Tablet) */}
          <div className="flex flex-col lg:flex-row gap-5 items-start">
            {/* Sidebar Daftar Kelas (Desktop & Large Screen) */}
            <Card className="hidden lg:block w-72 xl:w-80 shrink-0 p-4 space-y-3 sticky top-4">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--divider)]">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: "var(--fg)" }}>Daftar Kelas</h3>
                  <p className="text-[11px] app-muted">Pilih kelas untuk mengatur pemetaan</p>
                </div>
                <Badge status="neutral" className="text-[10px]">
                  {filteredClassesList.length} Rombel
                </Badge>
              </div>

              {/* Filter Tingkat */}
              <div className="grid grid-cols-4 gap-1 p-1 bg-[var(--hover)] rounded-lg text-center text-xs font-medium">
                {["ALL", "X", "XI", "XII"].map((grade) => (
                  <button
                    key={grade}
                    type="button"
                    onClick={() => setMappingGradeFilter(grade)}
                    className={`py-1 rounded-md transition-all ${
                      mappingGradeFilter === grade
                        ? "bg-[var(--card)] text-[var(--accent)] shadow-sm font-semibold"
                        : "text-muted hover:text-[var(--fg)]"
                    }`}
                  >
                    {grade === "ALL" ? "Semua" : grade}
                  </button>
                ))}
              </div>

              {/* List Scrollable Kelas */}
              <div className="max-h-[580px] overflow-y-auto space-y-1.5 pr-1 custom-scrollbar">
                {filteredClassesList.length === 0 ? (
                  <div className="text-center py-8 text-xs app-muted">
                    Tidak ada kelas ditemukan
                  </div>
                ) : (
                  filteredClassesList.map((c) => {
                    const isSelected = c.id === selectedMappingClassId;
                    const summary = classSummaryMap[c.id];
                    const totalJp = isSelected ? totalClassJp : summary?.totalJp || 0;
                    const mapelCount = isSelected ? mappings.length : summary?.mapelCount || 0;

                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setSelectedMappingClassId(c.id)}
                        className={`w-full text-left p-3 rounded-xl border transition-all flex items-center justify-between ${
                          isSelected
                            ? "bg-[var(--accent-soft)] border-[var(--accent)] text-[var(--accent)] shadow-sm font-semibold"
                            : "border-[var(--divider)] bg-[var(--card)] hover:bg-[var(--hover)] text-[var(--fg)]"
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <div className="flex items-center gap-1.5">
                            <span className="material-symbols-outlined text-[16px]">
                              {isSelected ? "school" : "class"}
                            </span>
                            <span className="truncate text-sm">{c.name}</span>
                          </div>
                          <div className="text-[11px] font-normal app-muted mt-0.5">
                            {mapelCount > 0 ? `${mapelCount} Mapel Terpetakan` : "Belum ada mapel"}
                          </div>
                        </div>

                        <div className="text-right shrink-0">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-bold ${
                              isSelected
                                ? "bg-[var(--accent)] text-white"
                                : totalJp > 0
                                ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20"
                                : "bg-[var(--hover)] app-muted"
                            }`}
                          >
                            {totalJp} JP
                          </span>
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </Card>

            {/* Area Detail Pemetaan Kelas Terpilih */}
            <div className="flex-1 min-w-0 w-full space-y-4">
              {/* Header Info Kelas & Mini KPI Card */}
              <Card className="p-4 sm:p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-[var(--divider)]">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-display font-bold text-lg sm:text-xl text-[var(--fg)]">
                        {selectedClass ? selectedClass.name : "Pilih Kelas"}
                      </h3>
                      {selectedClassHomeroom ? (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-500/20 font-medium">
                          <span className="material-symbols-outlined text-[14px]">supervisor_account</span>
                          Walas: {selectedClassHomeroom.userName}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 font-medium">
                          <span className="material-symbols-outlined text-[14px]">person_off</span>
                          Walas Belum Ditugaskan
                        </span>
                      )}
                    </div>
                    <p className="text-xs app-muted mt-1">
                      Daftar mata pelajaran yang diajarkan pada rombel ini beserta alokasi jam tatap muka.
                    </p>
                  </div>

                  {/* Ringkasan Akumulasi JP & Mapel */}
                  <div className="flex items-center gap-2 self-start sm:self-center">
                    <div className="px-3.5 py-1.5 rounded-xl bg-[var(--accent-soft)] border border-[var(--accent)]/30 text-center">
                      <div className="text-[10px] uppercase font-semibold text-[var(--accent)]">Total JP</div>
                      <div className="text-lg font-bold text-[var(--accent)] leading-tight">{totalClassJp} JP</div>
                    </div>
                    <div className="px-3.5 py-1.5 rounded-xl bg-[var(--hover)] border border-[var(--divider)] text-center">
                      <div className="text-[10px] uppercase font-semibold app-muted">Mapel</div>
                      <div className="text-lg font-bold text-[var(--fg)] leading-tight">{mappings.length}</div>
                    </div>
                  </div>
                </div>

                {/* Filter Search Mapel & Guru */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="relative flex-1">
                    <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] app-muted">
                      search
                    </span>
                    <input
                      type="text"
                      placeholder="Cari nama mapel, kode, atau guru pengajar..."
                      value={mappingSearch}
                      onChange={(e) => setMappingSearch(e.target.value)}
                      className="w-full pl-9 pr-4 py-2 text-xs app-input rounded-xl border border-[var(--divider)]"
                    />
                    {mappingSearch && (
                      <button
                        type="button"
                        onClick={() => setMappingSearch("")}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-xs app-muted hover:text-[var(--fg)]"
                      >
                        ✕
                      </button>
                    )}
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-2 text-xs app-muted">
                    <span>
                      Menampilkan <strong className="text-[var(--fg)]">{filteredMappings.length}</strong> dari {mappings.length} mapel
                    </span>
                  </div>
                </div>
              </Card>

              {/* Konten Pemetaan: Loading, Empty State, atau List */}
              {loadingMappings ? (
                <Card className="p-6 space-y-3">
                  <Skeleton className="h-8 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </Card>
              ) : filteredMappings.length === 0 ? (
                <Card className="p-8 sm:p-12 text-center border-dashed border-2" style={{ borderColor: "var(--divider)" }}>
                  <div className="max-w-md mx-auto space-y-4">
                    <div
                      className="w-14 h-14 rounded-2xl mx-auto flex items-center justify-center shadow-inner"
                      style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                    >
                      <span className="material-symbols-outlined text-[32px]">assignment</span>
                    </div>

                    <div>
                      <h4 className="font-semibold text-base text-[var(--fg)]">
                        {mappingSearch ? "Mata Pelajaran Tidak Ditemukan" : "Belum Ada Pemetaan Mapel di Kelas Ini"}
                      </h4>
                      <p className="text-xs app-muted mt-1 leading-relaxed">
                        {mappingSearch
                          ? `Tidak ditemukan mata pelajaran atau guru yang cocok dengan kata kunci "${mappingSearch}".`
                          : `Kelas ${selectedClass?.name || "ini"} belum memiliki daftar mata pelajaran dan guru yang ditugaskan.`}
                      </p>
                    </div>

                    {!mappingSearch && (
                      <div className="flex items-center justify-center gap-2 pt-2 flex-wrap">
                        <Button
                          variant="primary"
                          size="sm"
                          onClick={handleOpenAddMapping}
                          className="gap-1.5 text-xs"
                        >
                          <span className="material-symbols-outlined text-[16px]">add</span>
                          Petakan Mapel Pertama
                        </Button>
                      </div>
                    )}
                  </div>
                </Card>
              ) : (
                <>
                  {/* Prioritas 1 & 3: Table View untuk Desktop dan Tablet (md:block) */}
                  <Card className="hidden md:block overflow-hidden">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="border-b border-[var(--divider)] bg-[var(--hover)]/60 text-muted font-semibold">
                            <th className="py-3 px-3 w-12 text-center">No</th>
                            <th className="py-3 px-4">Mata Pelajaran</th>
                            <th className="py-3 px-4">Guru Pengajar</th>
                            <th className="py-3 px-4 text-center w-40">Alokasi JP</th>
                            <th className="py-3 px-4 text-right w-28">Aksi</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--divider)]">
                          {filteredMappings.map((m, index) => (
                            <tr
                              key={m.id}
                              className="hover:bg-[var(--hover)]/40 transition-colors group"
                            >
                              <td className="py-3 px-3 text-center text-muted font-mono">
                                {index + 1}
                              </td>

                              {/* Mata Pelajaran */}
                              <td className="py-3 px-4">
                                <div className="space-y-0.5">
                                  <div className="font-semibold text-sm text-[var(--fg)]">
                                    {m.subjectName}
                                  </div>
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    {m.subjectCode && (
                                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-muted border border-[var(--divider)]">
                                        {m.subjectCode}
                                      </span>
                                    )}
                                    <Badge status="neutral" className="text-[10px] py-0 px-1.5">
                                      {m.subjectType || "UMUM"}
                                    </Badge>
                                  </div>
                                </div>
                              </td>

                              {/* Guru Pengajar */}
                              <td className="py-3 px-4">
                                <div className="flex items-center gap-2.5">
                                  <div
                                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs uppercase shrink-0"
                                    style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                                  >
                                    {m.teacherName ? m.teacherName.charAt(0) : "G"}
                                  </div>
                                  <div className="min-w-0">
                                    <div className="font-medium text-xs text-[var(--fg)] truncate">
                                      {m.teacherName}
                                    </div>
                                    <div className="text-[11px] app-muted font-mono">
                                      {m.teacherNip ? `NIP: ${m.teacherNip}` : "Non-NIP"}
                                    </div>
                                  </div>
                                </div>
                              </td>

                              {/* Alokasi JP dengan Stepper Cepat */}
                              <td className="py-3 px-4 text-center">
                                <div className="inline-flex items-center gap-1.5 p-1 rounded-xl bg-[var(--hover)]/80 border border-[var(--divider)]">
                                  <button
                                    type="button"
                                    onClick={() => handleQuickUpdateJp(m.id, m.jp, -1)}
                                    disabled={m.jp <= 1}
                                    title="Kurangi 1 JP"
                                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--card)] hover:bg-[var(--divider)] text-[var(--fg)] disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold text-sm shadow-xs"
                                  >
                                    -
                                  </button>
                                  <span className="min-w-[48px] text-center font-bold text-xs font-mono text-[var(--fg)]">
                                    {m.jp} JP
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleQuickUpdateJp(m.id, m.jp, 1)}
                                    disabled={m.jp >= 20}
                                    title="Tambah 1 JP"
                                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-[var(--card)] hover:bg-[var(--divider)] text-[var(--fg)] disabled:opacity-30 disabled:cursor-not-allowed transition-all font-bold text-sm shadow-xs"
                                  >
                                    +
                                  </button>
                                </div>
                              </td>

                              {/* Aksi */}
                              <td className="py-3 px-4 text-right">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEditMapping(m)}
                                    title="Edit Guru atau JP"
                                    className="p-1.5 rounded-lg text-muted hover:text-[var(--accent)] hover:bg-[var(--accent-soft)] transition-colors"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">edit</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteMapping(m.id, m.subjectName, m.teacherName)}
                                    title="Hapus Pemetaan Mapel"
                                    className="p-1.5 rounded-lg text-muted hover:text-rose-600 hover:bg-rose-500/10 transition-colors"
                                  >
                                    <span className="material-symbols-outlined text-[18px]">delete</span>
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot>
                          <tr className="bg-[var(--hover)]/80 font-semibold border-t-2 border-[var(--divider)] text-xs">
                            <td colSpan={3} className="py-3 px-4 text-right">
                              Total Jam Pelajaran Terpetakan:
                            </td>
                            <td className="py-3 px-4 text-center">
                              <span className="inline-flex items-center px-3 py-1 rounded-full bg-[var(--accent)] text-white font-bold font-mono text-xs">
                                {totalClassJp} JP / Minggu
                              </span>
                            </td>
                            <td></td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>

                    <div className="p-3 bg-[var(--card)] border-t border-[var(--divider)] text-[11px] app-muted flex items-center justify-between flex-wrap gap-2">
                      <div className="flex items-center gap-1.5">
                        <span className="material-symbols-outlined text-[16px] text-emerald-500">check_circle</span>
                        <span>Seluruh mata pelajaran di atas tersinkronisasi otomatis dengan Modul Jurnal Mengajar Guru.</span>
                      </div>
                      <div className="text-right">
                        Klik tombol <strong>[-]</strong> atau <strong>[+]</strong> untuk mengubah alokasi JP secara instan.
                      </div>
                    </div>
                  </Card>

                  {/* Prioritas 2: Mobile Card List (md:hidden) */}
                  <div className="md:hidden space-y-3">
                    {filteredMappings.map((m, index) => (
                      <Card key={m.id} className="p-4 space-y-3 shadow-xs">
                        {/* Header Card: Mapel & Tipe */}
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className="font-mono text-[10px] text-muted">#{index + 1}</span>
                              <h4 className="font-bold text-sm text-[var(--fg)] leading-snug">
                                {m.subjectName}
                              </h4>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                              {m.subjectCode && (
                                <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--hover)] text-muted border border-[var(--divider)]">
                                  {m.subjectCode}
                                </span>
                              )}
                              <Badge status="neutral" className="text-[10px] py-0 px-1.5">
                                {m.subjectType || "UMUM"}
                              </Badge>
                            </div>
                          </div>

                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleOpenEditMapping(m)}
                              className="p-2 rounded-lg text-muted hover:text-[var(--accent)] bg-[var(--hover)]"
                              title="Edit"
                            >
                              <span className="material-symbols-outlined text-[16px]">edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteMapping(m.id, m.subjectName, m.teacherName)}
                              className="p-2 rounded-lg text-rose-500 hover:bg-rose-500/10 bg-[var(--hover)]"
                              title="Hapus"
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                            </button>
                          </div>
                        </div>

                        {/* Info Guru Pengajar */}
                        <div className="flex items-center gap-2.5 p-2 rounded-xl bg-[var(--hover)]/50 border border-[var(--divider)]">
                          <div
                            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs uppercase shrink-0"
                            style={{ background: "var(--accent-soft)", color: "var(--accent)" }}
                          >
                            {m.teacherName ? m.teacherName.charAt(0) : "G"}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-xs text-[var(--fg)] truncate">
                              {m.teacherName}
                            </div>
                            <div className="text-[10px] app-muted font-mono">
                              {m.teacherNip ? `NIP: ${m.teacherNip}` : "Non-NIP"}
                            </div>
                          </div>
                        </div>

                        {/* Stepper JP Mobile Touch-Friendly (Target >= 44px) */}
                        <div className="flex items-center justify-between pt-1 border-t border-[var(--divider)]">
                          <span className="text-xs font-semibold app-muted">Alokasi Jam Tatap Muka:</span>
                          <div className="flex items-center gap-2 bg-[var(--hover)] p-1 rounded-xl border border-[var(--divider)]">
                            <button
                              type="button"
                              onClick={() => handleQuickUpdateJp(m.id, m.jp, -1)}
                              disabled={m.jp <= 1}
                              aria-label="Kurangi JP"
                              className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--card)] text-[var(--fg)] font-bold text-base active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed shadow-xs"
                            >
                              -
                            </button>
                            <span className="font-bold text-sm font-mono px-2 text-[var(--fg)]">
                              {m.jp} JP
                            </span>
                            <button
                              type="button"
                              onClick={() => handleQuickUpdateJp(m.id, m.jp, 1)}
                              disabled={m.jp >= 20}
                              aria-label="Tambah JP"
                              className="w-10 h-10 flex items-center justify-center rounded-lg bg-[var(--card)] text-[var(--fg)] font-bold text-base active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed shadow-xs"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      </Card>
                    ))}

                    {/* Summary Card Mobile */}
                    <Card className="p-3.5 bg-[var(--accent-soft)] border border-[var(--accent)]/30 text-center">
                      <div className="text-xs font-medium text-[var(--accent)]">
                        Total Alokasi Rombel {selectedClass?.name}:
                      </div>
                      <div className="text-xl font-bold text-[var(--accent)] mt-0.5">
                        {totalClassJp} JP / Minggu ({filteredMappings.length} Mapel)
                      </div>
                    </Card>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab Content 6: Konfigurasi Kolom Penilaian */}
      {activeTab === "penilaian" && (
        <div className="space-y-4">
          <div className="space-y-1">
            <h2 className="font-display font-bold text-xl">Konfigurasi Kolom Penilaian</h2>
            <p className="text-xs app-muted">
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
      )}

      {/* Modal 1: Tambah / Edit Pemetaan Mapel ke Kelas */}
      <Modal
        isOpen={isAddMappingModalOpen}
        onClose={() => setIsAddMappingModalOpen(false)}
      >
        <div className="bg-[var(--card)] border border-[var(--divider)] rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scaleIn">
          <div className="p-5 border-b border-[var(--divider)] flex items-center justify-between">
            <div>
              <h3 className="font-display font-bold text-base text-[var(--fg)]">
                {editingMappingId ? "Edit Pemetaan Mata Pelajaran" : "Petakan Mata Pelajaran ke Kelas"}
              </h3>
              <p className="text-xs app-muted mt-0.5">
                Rombongan Belajar: <strong className="text-[var(--accent)]">{selectedClass?.name}</strong>
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAddMappingModalOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleSaveMapping} className="p-5 space-y-4">
            {/* Dropdown Tunggal: Mata Pelajaran & Guru Pengajar */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--fg)]">
                Mata Pelajaran & Guru Pengajar <span className="text-rose-500">*</span>
              </label>
              {editingMappingId ? (
                <div className="p-3 rounded-xl bg-[var(--hover)] border border-[var(--divider)] space-y-1">
                  <div className="font-bold text-sm text-[var(--fg)]">
                    {currentEditingMapping?.subjectName || "Mata Pelajaran"}
                  </div>
                  <div className="text-xs app-muted flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-[14px] text-[var(--accent)]">person</span>
                    <span>Guru: <strong className="text-[var(--fg)]">{currentEditingMapping?.teacherName || "-"}</strong></span>
                    {currentEditingMapping?.teacherNip && (
                      <span className="font-mono text-[11px]">({currentEditingMapping.teacherNip})</span>
                    )}
                  </div>
                </div>
              ) : (
                <>
                  <select
                    value={modalSubjectId && modalTeacherUserId ? `${modalSubjectId}:::${modalTeacherUserId}` : ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (!val) {
                        setModalSubjectId("");
                        setModalTeacherUserId("");
                        return;
                      }
                      const [sId, tId] = val.split(":::");
                      setModalSubjectId(sId);
                      setModalTeacherUserId(tId);
                    }}
                    required
                    className="w-full text-sm app-input py-2.5 px-3 rounded-xl border border-[var(--divider)]"
                  >
                    <option value="">-- Pilih Mata Pelajaran & Guru Pengajar --</option>
                    {assignments.map((a) => {
                      const isAlreadyMapped = mappings.some((m) => m.subjectId === a.subjectId);
                      const target = a.targetJp || 24;
                      const mapped = a.mappedJp || 0;
                      const deficit = Math.max(0, target - mapped);
                      let loadText = "";
                      if (deficit > 0) {
                        loadText = `[Kurang ${deficit} JP · Terpetakan ${mapped}/${target} JP]`;
                      } else if (mapped === target) {
                        loadText = `[Terpenuhi · ${target}/${target} JP]`;
                      } else {
                        loadText = `[Lebih ${mapped - target} JP]`;
                      }

                      return (
                        <option key={a.id} value={`${a.subjectId}:::${a.userId}`}>
                          {a.subjectName} {a.subjectCode ? `[${a.subjectCode}]` : ""} — Guru: {a.userName} {loadText} {isAlreadyMapped ? " (Sudah ada di kelas ini)" : ""}
                        </option>
                      );
                    })}
                  </select>
                  <p className="text-[11px] app-muted">
                    Nama guru pengajar & target JP otomatis tertaut sesuai dengan data pada menu <strong>Penugasan Guru</strong>.
                  </p>
                </>
              )}
            </div>

            {/* Field 3: Jam Pelajaran (JP) */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--fg)]">
                Alokasi Jam Pelajaran (JP) Mingguan <span className="text-rose-500">*</span>
              </label>
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-1.5 bg-[var(--hover)] p-1 rounded-xl border border-[var(--divider)]">
                  <button
                    type="button"
                    onClick={() => setModalJp((prev) => Math.max(1, prev - 1))}
                    disabled={modalJp <= 1}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--card)] text-[var(--fg)] font-bold text-base hover:bg-[var(--divider)] disabled:opacity-30 transition-all shadow-xs"
                  >
                    -
                  </button>
                  <input
                    type="number"
                    min={1}
                    max={20}
                    value={modalJp}
                    onChange={(e) => setModalJp(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                    className="w-16 text-center text-sm font-bold font-mono py-1.5 bg-transparent border-none focus:outline-hidden"
                  />
                  <button
                    type="button"
                    onClick={() => setModalJp((prev) => Math.min(20, prev + 1))}
                    disabled={modalJp >= 20}
                    className="w-9 h-9 flex items-center justify-center rounded-lg bg-[var(--card)] text-[var(--fg)] font-bold text-base hover:bg-[var(--divider)] disabled:opacity-30 transition-all shadow-xs"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>

            {/* Modal Actions */}
            <div className="pt-3 border-t border-[var(--divider)] flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsAddMappingModalOpen(false)}
                disabled={busy}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busy}
              >
                {busy ? "Menyimpan..." : editingMappingId ? "Simpan Perubahan" : "Simpan Pemetaan"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>

      {/* Modal 2: Salin Pemetaan ke Kelas Lain */}
      <Modal
        isOpen={isCopyClassModalOpen}
        onClose={() => setIsCopyClassModalOpen(false)}
      >
        <div className="bg-[var(--card)] border border-[var(--divider)] rounded-2xl shadow-2xl w-full max-w-md overflow-hidden animate-scaleIn">
          <div className="p-5 border-b border-[var(--divider)] flex items-center justify-between">
            <div>
              <h3 className="font-display font-bold text-base text-[var(--fg)]">
                Salin Susunan Mapel & Guru
              </h3>
              <p className="text-xs app-muted mt-0.5">
                Duplikasi pemetaan antar rombongan belajar
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsCopyClassModalOpen(false)}
              className="w-8 h-8 rounded-lg flex items-center justify-center text-muted hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors"
            >
              ✕
            </button>
          </div>

          <form onSubmit={handleCopyClass} className="p-5 space-y-4">
            {/* Kelas Sumber */}
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wider app-muted">
                Kelas Asal (Sumber Data)
              </label>
              <div className="p-3 rounded-xl bg-[var(--hover)] border border-[var(--divider)] flex items-center justify-between">
                <div className="font-bold text-sm text-[var(--fg)]">
                  {selectedClass?.name}
                </div>
                <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)] font-semibold">
                  {mappings.length} Mapel · {totalClassJp} JP
                </span>
              </div>
            </div>

            {/* Kelas Tujuan */}
            <div className="space-y-1.5">
              <label className="text-xs font-semibold uppercase tracking-wider text-[var(--fg)]">
                Pilih Kelas Tujuan <span className="text-rose-500">*</span>
              </label>
              <select
                value={copyTargetClassId}
                onChange={(e) => setCopyTargetClassId(e.target.value)}
                required
                className="w-full text-sm app-input py-2.5 px-3 rounded-xl border border-[var(--divider)]"
              >
                <option value="">-- Pilih Kelas Tujuan --</option>
                {classesList
                  .filter((c) => c.id !== selectedMappingClassId)
                  .map((c) => {
                    const summary = classSummaryMap[c.id];
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name} {summary ? `(${summary.totalJp} JP · ${summary.mapelCount} Mapel saat ini)` : "(Kosong)"}
                      </option>
                    );
                  })}
              </select>
            </div>

            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-600 dark:text-amber-400 leading-relaxed flex items-start gap-2">
              <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">info</span>
              <span>
                Mapel yang sudah ada pada kelas tujuan <strong>tidak akan ditimpa</strong>. Hanya mapel baru yang akan ditambahkan beserta guru dan JP-nya.
              </span>
            </div>

            {/* Actions */}
            <div className="pt-3 border-t border-[var(--divider)] flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCopyClassModalOpen(false)}
                disabled={busy}
              >
                Batal
              </Button>
              <Button
                type="submit"
                variant="primary"
                disabled={busy || !copyTargetClassId}
              >
                {busy ? "Menyalin..." : "Salin Sekarang"}
              </Button>
            </div>
          </form>
        </div>
      </Modal>
    </div>
  );
}
