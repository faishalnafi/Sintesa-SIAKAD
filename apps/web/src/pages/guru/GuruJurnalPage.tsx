import { useEffect, useState, useMemo } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pagination } from "@/components/ui/Pagination";
import { usePagination } from "@/lib/pagination";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";
import { useAuthStore } from "@/store/auth";
import { sortClasses, sortSubjects, sortTeachingHours } from "@/lib/sort";

type TeacherItem = { id: string; name: string; nip?: string | null };
type ClassItem = { id: string; name: string };
type SubjectItem = { id: string; name: string; code: string | null };
type TeachingHourItem = { id: string; label: string; startTime: string; endTime: string };

type ScheduleItem = {
  id: string;
  classId: string;
  className: string;
  subjectId: string;
  subjectName: string;
  subjectCode: string | null;
  hari?: string | null;
  startHourId?: string | null;
  startHourLabel?: string | null;
  endHourId?: string | null;
  endHourLabel?: string | null;
  jp: number;
};

type JournalItem = {
  id: string;
  date: string;
  classId: string;
  className: string;
  teachingHourId: string;
  teachingHourLabel: string;
  subjectId: string;
  subjectName: string;
  groupId: string | null;
  materi: string;
  presenceInfo: string;
  status: "draft" | "sent";
  createdAt: string;
};

export function GuruJurnalPage() {
  const { user } = useAuthStore();
  const isAdmin = useMemo(() => {
    return user?.roles.some((r) => r === "admin" || r === "superadmin") ?? false;
  }, [user]);

  const [teachersList, setTeachersList] = useState<TeacherItem[]>([]);
  const [selectedTeacherUserId, setSelectedTeacherUserId] = useState<string>("");
  const isNoTeacherSelected = isAdmin && !selectedTeacherUserId;

  const [date, setDate] = useState(() => {
    const today = new Date();
    const offset = today.getTimezoneOffset();
    const local = new Date(today.getTime() - offset * 60 * 1000);
    return local.toISOString().split("T")[0]; // YYYY-MM-DD local time
  });
  
  const [classesList, setClassesList] = useState<ClassItem[]>([]);
  const [subjectsList, setSubjectsList] = useState<SubjectItem[]>([]);
  const [hoursList, setHoursList] = useState<TeachingHourItem[]>([]);
  const [schedulesList, setSchedulesList] = useState<ScheduleItem[]>([]);
  const [journalsList, setJournalsList] = useState<JournalItem[]>([]);

  const [selectedClassId, setSelectedClassId] = useState("");
  const [startHourId, setStartHourId] = useState("");
  const [endHourId, setEndHourId] = useState("");
  const [selectedSubjectId, setSelectedSubjectId] = useState("");
  const [materi, setMateri] = useState("");
  const [presenceInfo, setPresenceInfo] = useState("");
  const [groupId, setGroupId] = useState<string | null>(null);

  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingJournals, setLoadingJournals] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const getTodayString = () => {
    const today = new Date();
    const offset = today.getTimezoneOffset();
    const local = new Date(today.getTime() - offset * 60 * 1000);
    return local.toISOString().split("T")[0];
  };

  // Filter States
  const [filterClassId, setFilterClassId] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [filterDate, setFilterDate] = useState(getTodayString);

  // Load configuration (classes, subjects, teaching hours, schedules)
  const loadConfig = async (teacherId?: string) => {
    const targetId = teacherId !== undefined ? teacherId : selectedTeacherUserId;
    if (isAdmin && !targetId) {
      setClassesList([]);
      setSubjectsList([]);
      setSchedulesList([]);
      setLoadingConfig(false);
      return;
    }

    setLoadingConfig(true);
    try {
      const queryParam = targetId ? `?teacherUserId=${targetId}` : "";
      const [cRes, sRes, hRes, schedRes] = await Promise.allSettled([
        api<ClassItem[]>(`/teacher/classes${queryParam}`),
        api<SubjectItem[]>(`/teacher/subjects${queryParam}`),
        api<TeachingHourItem[]>("/teacher/teaching-hours"),
        api<ScheduleItem[]>(`/teacher/schedule${queryParam}`),
      ]);

      if (cRes.status === "fulfilled" && cRes.value?.data) {
        setClassesList(sortClasses(cRes.value.data));
      } else {
        setClassesList([]);
      }
      if (sRes.status === "fulfilled" && sRes.value?.data) {
        const val = sRes.value.data;
        const list = Array.isArray(val) ? val : ((val as any).subjects || []);
        setSubjectsList(sortSubjects(list));
      } else {
        setSubjectsList([]);
      }
      if (hRes.status === "fulfilled" && hRes.value?.data) {
        setHoursList(sortTeachingHours(hRes.value.data));
      }
      if (schedRes.status === "fulfilled" && schedRes.value?.data) {
        setSchedulesList(schedRes.value.data);
      } else {
        setSchedulesList([]);
      }
    } catch (e) {
      console.error("Gagal memuat konfigurasi jurnal:", e);
    } finally {
      setLoadingConfig(false);
    }
  };

  // Load written journals
  const loadJournals = async (teacherId?: string) => {
    const targetId = teacherId !== undefined ? teacherId : selectedTeacherUserId;
    if (isAdmin && !targetId) {
      setJournalsList([]);
      setLoadingJournals(false);
      return;
    }

    setLoadingJournals(true);
    try {
      const queryParam = targetId ? `?teacherUserId=${targetId}` : "";
      const res = await api<JournalItem[]>(`/teacher/journals${queryParam}`);
      setJournalsList(res.data ?? []);
    } catch (e) {
      console.error("Gagal memuat riwayat jurnal:", e);
    } finally {
      setLoadingJournals(false);
    }
  };

  // Muat daftar guru jika akun adalah admin / superadmin
  useEffect(() => {
    if (isAdmin) {
      api<TeacherItem[]>("/teacher/teachers")
        .then((res) => {
          const list = res.data ?? [];
          setTeachersList(list);
          if (user?.id && list.some((t) => t.id === user.id)) {
            setSelectedTeacherUserId(user.id);
          }
        })
        .catch((e) => console.error("Gagal memuat daftar guru:", e));
    }
  }, [isAdmin, user?.id]);

  useEffect(() => {
    if (!isAdmin) {
      loadConfig("");
      loadJournals("");
    } else if (selectedTeacherUserId) {
      handleResetForm();
      loadConfig(selectedTeacherUserId);
      loadJournals(selectedTeacherUserId);
    } else {
      handleResetForm();
      setClassesList([]);
      setSubjectsList([]);
      setSchedulesList([]);
      setJournalsList([]);
      setLoadingConfig(false);
    }
  }, [isAdmin, selectedTeacherUserId]);

  // Realtime: refresh list jurnal saat ada jurnal yang disimpan/dihapus
  useRealtimeEvent(
    ["journal_saved", "journal_deleted", "schedule_updated"],
    () => {
      loadJournals(selectedTeacherUserId);
      loadConfig(selectedTeacherUserId);
    }
  );

  const selectedTeacherName = useMemo(() => {
    if (!isAdmin) return user?.name || "";
    return teachersList.find((t) => t.id === selectedTeacherUserId)?.name || "";
  }, [isAdmin, user?.name, teachersList, selectedTeacherUserId]);

  // Nama hari dalam Bahasa Indonesia dari tanggal terpilih
  const DAY_NAMES = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
  const currentDayName = useMemo(() => {
    if (!date) return "";
    const d = new Date(date + "T00:00:00");
    return isNaN(d.getTime()) ? "" : DAY_NAMES[d.getDay()];
  }, [date]);

  // Jadwal mengajar guru pada hari ini sesuai setelan Admin Mapel & Penugasan
  const activeDaySchedules = useMemo(() => {
    if (!currentDayName) return [];
    return schedulesList.filter((s) => s.hari === currentDayName);
  }, [schedulesList, currentDayName]);

  // Hari libur KBM (Sabtu & Minggu): form dinonaktifkan
  const isWeekend = currentDayName === "Sabtu" || currentDayName === "Minggu";
  const isNoTeachingDay = useMemo(() => {
    if (groupId) return false;
    return isWeekend;
  }, [groupId, isWeekend]);

  // Kelas yang valid pada hari terpilih:
  // Prioritaskan kelas yang terjadwal hari ini di urutan teratas, diikuti kelas lainnya milik guru
  const activeClasses = useMemo(() => {
    if (isNoTeacherSelected) return [];
    if (classesList.length > 0) {
      if (activeDaySchedules.length > 0) {
        const scheduledIds = new Set(activeDaySchedules.map((s) => s.classId));
        const scheduled = classesList.filter((c) => scheduledIds.has(c.id));
        const others = classesList.filter((c) => !scheduledIds.has(c.id));
        return [...scheduled, ...others];
      }
      return classesList;
    }
    return [];
  }, [isNoTeacherSelected, activeDaySchedules, classesList]);

  // Mapel yang valid pada kelas terpilih
  const activeSubjects = useMemo(() => {
    if (isNoTeacherSelected) return [];
    if (isWeekend) return subjectsList;
    if (!selectedClassId) {
      if (activeDaySchedules.length > 0) {
        const map = new Map<string, SubjectItem>();
        for (const s of activeDaySchedules) {
          if (!map.has(s.subjectId)) {
            map.set(s.subjectId, { id: s.subjectId, name: s.subjectName, code: s.subjectCode });
          }
        }
        return sortSubjects(Array.from(map.values()));
      }
      return subjectsList;
    }

    // 1. Cek dari jadwal hari ini untuk kelas terpilih
    const matchingDay = activeDaySchedules.filter((s) => s.classId === selectedClassId);
    if (matchingDay.length > 0) {
      const map = new Map<string, SubjectItem>();
      for (const s of matchingDay) {
        map.set(s.subjectId, { id: s.subjectId, name: s.subjectName, code: s.subjectCode });
      }
      return sortSubjects(Array.from(map.values()));
    }

    // 2. Cek dari semua jadwal guru untuk kelas terpilih
    const matchingAll = schedulesList.filter((s) => s.classId === selectedClassId);
    if (matchingAll.length > 0) {
      const map = new Map<string, SubjectItem>();
      for (const s of matchingAll) {
        map.set(s.subjectId, { id: s.subjectId, name: s.subjectName, code: s.subjectCode });
      }
      return sortSubjects(Array.from(map.values()));
    }

    return subjectsList;
  }, [isNoTeacherSelected, isNoTeachingDay, selectedClassId, activeDaySchedules, schedulesList, subjectsList]);

  // Otomatisasi sinkronisasi ketika tanggal berganti
  useEffect(() => {
    if (groupId) return; // Jangan overwrite saat sedang edit draft jurnal

    if (!isNoTeachingDay && activeDaySchedules.length > 0) {
      const isCurrentValid = activeClasses.some((c) => c.id === selectedClassId);
      const targetClassId = isCurrentValid ? selectedClassId : activeClasses[0]?.id || "";
      if (targetClassId !== selectedClassId) {
        setSelectedClassId(targetClassId);
      }

      const match = activeDaySchedules.find((s) => s.classId === targetClassId) || activeDaySchedules[0];
      if (match) {
        setSelectedSubjectId(match.subjectId);
        if (match.startHourId) setStartHourId(match.startHourId);
        if (match.endHourId) setEndHourId(match.endHourId);
      }
    } else if (isNoTeachingDay) {
      setSelectedClassId("");
      setSelectedSubjectId("");
      setStartHourId("");
      setEndHourId("");
    }
  }, [date, isNoTeachingDay, activeDaySchedules, activeClasses]);

  // Handler saat guru memilih kelas: sinkronkan mapel & jam awal/akhir otomatis
  const handleSelectClass = (clsId: string) => {
    setSelectedClassId(clsId);
    if (!clsId) {
      setSelectedSubjectId("");
      setStartHourId("");
      setEndHourId("");
      return;
    }

    // Cari jadwal hari ini terlebih dahulu
    const matchDay = activeDaySchedules.find((s) => s.classId === clsId);
    if (matchDay) {
      setSelectedSubjectId(matchDay.subjectId);
      if (matchDay.startHourId) setStartHourId(matchDay.startHourId);
      if (matchDay.endHourId) setEndHourId(matchDay.endHourId);
      return;
    }

    // Cari dari master jadwal kelas tersebut
    const matchAll = schedulesList.find((s) => s.classId === clsId);
    if (matchAll) {
      setSelectedSubjectId(matchAll.subjectId);
      if (matchAll.startHourId) setStartHourId(matchAll.startHourId);
      if (matchAll.endHourId) setEndHourId(matchAll.endHourId);
    }
  };

  // Handler saat guru memilih mapel: sinkronkan jam awal/akhir jika ada jadwal spesifik
  const handleSelectSubject = (subjId: string) => {
    setSelectedSubjectId(subjId);
    if (!subjId) return;

    if (selectedClassId) {
      const matchDay = activeDaySchedules.find(
        (s) => s.classId === selectedClassId && s.subjectId === subjId
      );
      if (matchDay) {
        if (matchDay.startHourId) setStartHourId(matchDay.startHourId);
        if (matchDay.endHourId) setEndHourId(matchDay.endHourId);
        return;
      }

      const matchAll = schedulesList.find(
        (s) => s.classId === selectedClassId && s.subjectId === subjId
      );
      if (matchAll) {
        if (matchAll.startHourId) setStartHourId(matchAll.startHourId);
        if (matchAll.endHourId) setEndHourId(matchAll.endHourId);
      }
    }
  };

  // Jadwal aktif untuk kelas dan mapel terpilih pada hari ini
  const currentClassSchedule = useMemo(() => {
    if (!selectedClassId) return null;
    const matchDay = activeDaySchedules.find(
      (s) => s.classId === selectedClassId && (!selectedSubjectId || s.subjectId === selectedSubjectId)
    );
    if (matchDay) return matchDay;
    const matchAnyDay = activeDaySchedules.find((s) => s.classId === selectedClassId);
    if (matchAnyDay) return matchAnyDay;
    return (
      schedulesList.find((s) => s.classId === selectedClassId && (!selectedSubjectId || s.subjectId === selectedSubjectId)) ||
      schedulesList.find((s) => s.classId === selectedClassId) ||
      null
    );
  }, [selectedClassId, selectedSubjectId, activeDaySchedules, schedulesList]);

  // Jam mengajar yang valid untuk ditampilkan di dropdown:
  // Jika kelas sudah dipilih, HANYA tampilkan jam yang sesuai dengan jadwal kelas tersebut (jam lain tidak tampil / tidak bisa dipilih)
  const displayHoursList = useMemo(() => {
    if (!selectedClassId) {
      return hoursList;
    }

    const classSchedules = activeDaySchedules.filter((s) => s.classId === selectedClassId);
    const schedulesToUse = classSchedules.length > 0 ? classSchedules : (currentClassSchedule ? [currentClassSchedule] : []);

    const hourIds = new Set<string>();
    for (const sched of schedulesToUse) {
      if (!sched.startHourId || !sched.endHourId) continue;
      const startIdx = hoursList.findIndex((h) => h.id === sched.startHourId);
      const endIdx = hoursList.findIndex((h) => h.id === sched.endHourId);
      if (startIdx !== -1 && endIdx !== -1) {
        const minIdx = Math.min(startIdx, endIdx);
        const maxIdx = Math.max(startIdx, endIdx);
        for (let i = minIdx; i <= maxIdx; i++) {
          hourIds.add(hoursList[i].id);
        }
      } else if (sched.startHourId) {
        hourIds.add(sched.startHourId);
      }
    }

    if (groupId) {
      if (startHourId) hourIds.add(startHourId);
      if (endHourId) hourIds.add(endHourId);
    }

    if (hourIds.size > 0) {
      return hoursList.filter((h) => hourIds.has(h.id));
    }

    return hoursList;
  }, [selectedClassId, currentClassSchedule, activeDaySchedules, hoursList, groupId, startHourId, endHourId]);

  // Find names from lists
  const selectedClassName = useMemo(() => {
    const fromActive = activeClasses.find((c) => c.id === selectedClassId)?.name;
    if (fromActive) return fromActive;
    const fromList = classesList.find((c) => c.id === selectedClassId)?.name;
    if (fromList) return fromList;
    const fromSched = schedulesList.find((s) => s.classId === selectedClassId)?.className;
    return fromSched ?? "";
  }, [activeClasses, classesList, schedulesList, selectedClassId]);

  const selectedSubjectName = useMemo(() => {
    const fromActive = activeSubjects.find((s) => s.id === selectedSubjectId)?.name;
    if (fromActive) return fromActive;
    const fromList = subjectsList.find((s) => s.id === selectedSubjectId)?.name;
    if (fromList) return fromList;
    const fromSched = schedulesList.find((s) => s.subjectId === selectedSubjectId)?.subjectName;
    return fromSched ?? "";
  }, [activeSubjects, subjectsList, schedulesList, selectedSubjectId]);

  // Set jam mengajar yang sudah terisi & terkirim pada tanggal terpilih
  const submittedHourIdsForSelectedDate = useMemo(() => {
    const set = new Set<string>();
    for (const j of journalsList) {
      if (j.date === date && j.status === "sent" && (!groupId || j.groupId !== groupId)) {
        set.add(j.teachingHourId);
      }
    }
    return set;
  }, [journalsList, date, groupId]);

  const handleResetForm = () => {
    setGroupId(null);
    setStartHourId("");
    setEndHourId("");
    setSelectedClassId("");
    setSelectedSubjectId("");
    setMateri("");
    setPresenceInfo("");
    setMessage(null);
  };

  // Handle load details when selecting draft or existing journal
  const handleEditJournal = (j: JournalItem) => {
    if (j.status === "sent") {
      Swal.fire({
        title: "Jurnal Terkirim",
        text: "Jurnal yang sudah dikirim tidak dapat diubah kembali.",
        icon: "info",
        confirmButtonColor: "#0284c7",
      });
      return;
    }

    // Cari seluruh jurnal yang tergabung dalam grup yang sama
    const groupJournals = j.groupId
      ? journalsList.filter((item) => item.groupId === j.groupId)
      : [j];

    // Deteksi jam mengajar awal dan akhir berdasarkan urutan di hoursList
    const hourIndices = groupJournals.map(item => {
      const idx = hoursList.findIndex(h => h.id === item.teachingHourId);
      return { id: item.teachingHourId, idx };
    }).filter(x => x.idx !== -1);

    if (hourIndices.length > 0) {
      hourIndices.sort((a, b) => a.idx - b.idx);
      setStartHourId(hourIndices[0].id);
      setEndHourId(hourIndices[hourIndices.length - 1].id);
    } else {
      setStartHourId(j.teachingHourId);
      setEndHourId(j.teachingHourId);
    }

    setGroupId(j.groupId);
    setDate(j.date);
    setSelectedClassId(j.classId);
    setSelectedSubjectId(j.subjectId);
    setMateri(j.materi);
    setPresenceInfo(j.presenceInfo);
    setMessage({ type: "success", text: "Draft jurnal kelompok dimuat ke form di atas." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const handleDeleteJournal = async (id: string, label: string) => {
    const result = await Swal.fire({
      title: "Hapus Draft Jurnal?",
      text: `Apakah Anda yakin ingin menghapus draft jurnal untuk ${label}?`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Hapus",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    setBusy(true);
    try {
      await api(`/teacher/journals/${id}`, { method: "DELETE" });
      await loadJournals(selectedTeacherUserId);
      Swal.fire({
        title: "Berhasil!",
        text: "Draft jurnal berhasil dihapus.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      handleResetForm();
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Hapus",
        text: e.message || "Gagal menghapus draft jurnal",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleSave = async (status: "draft" | "sent") => {
    setMessage(null);
    if (isAdmin && !selectedTeacherUserId) {
      return setMessage({ type: "error", text: "Pilih guru yang ingin dibantu terlebih dahulu" });
    }
    if (!date) return setMessage({ type: "error", text: "Tanggal wajib diisi" });
    if (!selectedClassId) return setMessage({ type: "error", text: "Kelas wajib dipilih" });
    if (!startHourId) return setMessage({ type: "error", text: "Jam mengajar awal wajib dipilih" });
    if (!endHourId) return setMessage({ type: "error", text: "Jam mengajar akhir wajib dipilih" });
    if (!selectedSubjectId) return setMessage({ type: "error", text: "Mata pelajaran wajib dipilih" });
    if (status === "sent" && !materi.trim()) {
      return setMessage({ type: "error", text: "Materi pembelajaran wajib diisi sebelum mengirim" });
    }

    // Cek apakah rentang jam terpilih mengandung jam yang sudah dikirim/terisi pada tanggal ini
    const startIdx = hoursList.findIndex((h) => h.id === startHourId);
    const endIdx = hoursList.findIndex((h) => h.id === endHourId);
    if (startIdx !== -1 && endIdx !== -1) {
      const minIdx = Math.min(startIdx, endIdx);
      const maxIdx = Math.max(startIdx, endIdx);
      const selectedHours = hoursList.slice(minIdx, maxIdx + 1);
      const conflictHour = selectedHours.find((h) => submittedHourIdsForSelectedDate.has(h.id));
      if (conflictHour) {
        return setMessage({
          type: "error",
          text: `Jam mengajar (${conflictHour.label}) pada tanggal ${date} sudah terisi dan terkirim. Tidak boleh ada data redundan.`,
        });
      }
    }

    setBusy(true);
    try {
      const res = await api<{ message?: string }>("/teacher/journals", {
        method: "POST",
        body: JSON.stringify({
          teacherUserId: isAdmin ? selectedTeacherUserId : undefined,
          groupId,
          date,
          classId: selectedClassId,
          className: selectedClassName,
          startHourId,
          endHourId,
          subjectId: selectedSubjectId,
          subjectName: selectedSubjectName,
          materi,
          presenceInfo: presenceInfo,
          status,
        }),
      });

      setMessage({ type: "success", text: res.message || "Jurnal berhasil disimpan" });
      handleResetForm();
      await loadJournals(selectedTeacherUserId);
    } catch (e: any) {
      const errMsg = e.message || "Gagal menyimpan jurnal";
      setMessage({ type: "error", text: errMsg });
      Swal.fire({
        title: "Jadwal Sudah Terisi!",
        text: errMsg,
        icon: "warning",
        confirmButtonColor: "#f59e0b",
      });
    } finally {
      setBusy(false);
    }
  };

  // Client-side Filter & Pagination
  const filteredJournals = useMemo(() => {
    const list = journalsList.filter((j) => {
      if (filterClassId && j.classId !== filterClassId) return false;
      if (filterSubjectId && j.subjectId !== filterSubjectId) return false;
      if (filterDate && j.date !== filterDate) return false;
      return true;
    });

    return list.sort((a, b) => {
      // Sort by Date first (newest date top)
      if (a.date !== b.date) {
        return b.date.localeCompare(a.date);
      }

      // Within the same date, sort by teaching hour ascending (1, 2, 3...)
      const getHourIdx = (j: JournalItem) => {
        const idx = hoursList.findIndex((h) => h.id === j.teachingHourId);
        if (idx !== -1) return idx;
        const match = j.teachingHourLabel?.match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
      };

      return getHourIdx(a) - getHourIdx(b);
    });
  }, [journalsList, hoursList, filterClassId, filterSubjectId, filterDate]);

  const draftCount = useMemo(() => {
    return filteredJournals.filter((j) => j.status === "draft").length;
  }, [filteredJournals]);

  const handleBulkSend = async () => {
    const draftItems = filteredJournals.filter((j) => j.status === "draft");
    if (draftItems.length === 0) {
      Swal.fire({
        title: "Tidak Ada Draft",
        text: "Tidak ada draft jurnal yang dapat dikirim.",
        icon: "info",
        confirmButtonColor: "#0284c7",
      });
      return;
    }

    const emptyItem = draftItems.find((j) => !j.materi || !j.materi.trim());
    if (emptyItem) {
      Swal.fire({
        title: "Materi Belum Lengkap",
        text: `Jurnal untuk ${emptyItem.className} - ${emptyItem.subjectName} (${emptyItem.teachingHourLabel}) materi-nya masih kosong. Harap lengkapi materi sebelum mengirim.`,
        icon: "warning",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }

    const confirmText = filterDate
      ? `Kirim ${draftItems.length} draft jurnal pada tanggal ${filterDate} secara masal? Jurnal yang dikirim tidak dapat diubah kembali.`
      : `Kirim ${draftItems.length} draft jurnal terpilih secara masal? Jurnal yang dikirim tidak dapat diubah kembali.`;

    const result = await Swal.fire({
      title: "Konfirmasi Kirim Masal",
      text: confirmText,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#059669",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Kirim Sekarang",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!result.isConfirmed) return;

    setBusy(true);
    try {
      const res = await api<{ message?: string }>("/teacher/journals/bulk-send", {
        method: "POST",
        body: JSON.stringify({
          ids: draftItems.map((item) => item.id),
        }),
      });

      Swal.fire({
        title: "Berhasil Terkirim!",
        text: res.message || "Berhasil mengirim jurnal secara masal.",
        icon: "success",
        confirmButtonColor: "#059669",
      });
      await loadJournals(selectedTeacherUserId);
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Kirim",
        text: e.message || "Gagal mengirim jurnal secara masal.",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const pager = usePagination(filteredJournals, { pageSize: 10 });

  return (
    <div className="space-y-6">
      <PageHeader
        title={isAdmin ? "Jurnal Kegiatan Guru (Mode Admin)" : "Jurnal Kegiatan Guru"}
        description={
          isAdmin
            ? "Kelola dan bantu pengisian jurnal KBM guru dengan setelan jadwal dan mata pelajaran yang saling mengunci secara akurat."
            : "Isi dan simpan draft jurnal kegiatan pembelajaran harian Anda di kelas."
        }
      />

      {/* Mode Admin: Pilihan Guru untuk saling mengunci jadwal & mapel */}
      {isAdmin && (
        <Card className="w-full border-2 border-indigo-400/40 bg-gradient-to-r from-indigo-50/50 via-sky-50/30 to-blue-50/20 dark:from-indigo-950/30 dark:via-sky-950/20 dark:to-blue-950/10">
          <div className="p-5 space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="material-symbols-outlined text-[26px] text-indigo-600 dark:text-indigo-400">
                  admin_panel_settings
                </span>
                <div>
                  <h3 className="text-sm font-bold text-fg">Mode Administrator — Bantuan Jurnal Guru</h3>
                  <p className="text-xs text-muted">
                    Pilih guru yang meminta bantuan. Seluruh penugasan kelas, mata pelajaran, dan jam mengajar otomatis saling mengunci sesuai penugasan guru tersebut.
                  </p>
                </div>
              </div>
              {selectedTeacherUserId ? (
                <Badge variant="success" className="self-start sm:self-auto py-1 px-3 text-xs">
                  ✓ Guru Terkunci: {selectedTeacherName || "Terpilih"}
                </Badge>
              ) : (
                <Badge variant="warning" className="self-start sm:self-auto py-1 px-3 text-xs">
                  Belum Ada Guru Dipilih
                </Badge>
              )}
            </div>

            <div className="pt-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted block mb-1.5">
                Pilih Akun Guru yang Ingin Dibantu
              </label>
              <select
                value={selectedTeacherUserId}
                onChange={(e) => setSelectedTeacherUserId(e.target.value)}
                className="w-full rounded-xl border-2 border-indigo-300 dark:border-indigo-600 bg-[var(--bg)] px-3.5 py-2.5 text-sm font-semibold text-fg outline-none focus:border-indigo-500 shadow-sm"
              >
                <option value="">-- Pilih Guru yang Ingin Dibantu / Dikelola --</option>
                {teachersList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} {t.nip ? `(NIP: ${t.nip})` : ""}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </Card>
      )}

      {message && (
        <div
          className={`p-4 rounded-xl text-sm border flex items-start gap-3 ${
            message.type === "success"
              ? "bg-success-soft/30 border-success-soft text-success"
              : "bg-error-soft/30 border-error-soft text-error"
          }`}
        >
          <span className="material-symbols-outlined shrink-0 text-[20px]">
            {message.type === "success" ? "check_circle" : "error"}
          </span>
          <div>{message.text}</div>
        </div>
      )}

      {/* 1. Petunjuk Pengisian (Kotak Merah di atas - Lebar Penuh) */}
      <Card className="w-full border-l-4 border-l-primary">
        <CardHeader title="Petunjuk Pengisian Jurnal Mengajar" />
        <div className="p-5 text-sm space-y-3.5 leading-relaxed text-on-surface-variant">
          <div className="flex gap-3">
            <span className="material-symbols-outlined text-[20px] text-primary shrink-0 mt-0.5">info</span>
            <div>
              Isi jurnal harian ini setiap kali Anda selesai melaksanakan proses pembelajaran di kelas.
            </div>
          </div>
          <div className="flex gap-3">
            <span className="material-symbols-outlined text-[20px] text-primary shrink-0 mt-0.5">schedule</span>
            <div>
              <strong>Awal &amp; Akhir Jam Mengajar:</strong> Wajib diisi. Jika mengajar tunggal (misal hanya 1 jam pelajaran saja di jam ke-8), maka pilih awal jam ke-8 dan akhir jam ke-8. Jika mengajar berurutan (misal jam ke-1 sampai ke-3), pilih awal jam ke-1 dan akhir jam ke-3. Sistem akan otomatis mengisi semua jam pelajaran di dalam rentang tersebut secara instan.
            </div>
          </div>
          <div className="flex gap-3">
            <span className="material-symbols-outlined text-[20px] text-primary shrink-0 mt-0.5">draft</span>
            <div>
              <strong>Simpan Draft:</strong> Untuk menyimpan data sementara. Anda bisa mengubah isinya kembali di lain waktu lewat tabel riwayat.
            </div>
          </div>
          <div className="flex gap-3">
            <span className="material-symbols-outlined text-[20px] text-primary shrink-0 mt-0.5">send</span>
            <div>
              <strong>Kirim Jurnal Masal:</strong> Pengiriman jurnal ke sistem dilakukan melalui tombol hijau <strong>Kirim Masal Draft</strong> di tabel riwayat bawah. Jurnal yang dikirim tidak dapat diubah kembali kecuali jika Admin menekan tombol koreksi ulang.
            </div>
          </div>
        </div>
      </Card>

      {/* Form Jurnal */}
      <Card className="w-full">
        <CardHeader title={groupId ? "Edit Draft Jurnal Kelompok" : "Buat Jurnal Baru"} />
        {loadingConfig ? (
          <div className="space-y-4 p-5">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : (
          <div className="p-5 space-y-5">
            {isNoTeacherSelected && (
              <div className="flex items-center gap-3 p-4 rounded-xl bg-indigo-500/10 border border-indigo-500/30 text-indigo-800 dark:text-indigo-200 text-xs font-medium">
                <span className="material-symbols-outlined text-[22px] text-indigo-600 dark:text-indigo-400 shrink-0">
                  person_search
                </span>
                <div>
                  <strong>Silakan pilih Guru terlebih dahulu pada kotak di atas.</strong> Setelah memilih guru, sistem akan langsung memuat penugasan kelas, mata pelajaran, dan jam mengajar yang saling mengunci secara akurat sesuai akun guru tersebut.
                </div>
              </div>
            )}

            {!isNoTeacherSelected && isWeekend && (
              <div className="flex items-center gap-3 p-3.5 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-800 dark:text-amber-200 text-xs font-medium">
                <span className="material-symbols-outlined text-[20px] text-amber-600 dark:text-amber-400 shrink-0">
                  event_busy
                </span>
                <div>
                  <strong>Tidak ada jam mengajar pada hari libur ({currentDayName}).</strong> Semua pilihan dropdown ditampilkan lengkap namun dinonaktifkan (disabled). Silakan pilih tanggal pada hari saat Anda memiliki jadwal KBM (Senin - Jumat).
                </div>
              </div>
            )}

            {/* Kotak 1: Tanggal, Kelas & Mata Pelajaran (Berdampingan 3 Kolom) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-2xl border border-emerald-200/50 bg-emerald-50/10 dark:bg-emerald-900/5">
              {/* Tanggal & Indikator Hari */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">Tanggal</label>
                  {currentDayName && (
                    <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600 dark:text-blue-400">
                      Hari: {currentDayName}
                    </span>
                  )}
                </div>
                <input
                  type="date"
                  value={date}
                  disabled={isNoTeacherSelected}
                  onChange={(e) => setDate(e.target.value)}
                  className={`w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary ${
                    isNoTeacherSelected ? "opacity-60 cursor-not-allowed bg-slate-100/60 dark:bg-slate-800/60" : ""
                  }`}
                />
                {isNoTeacherSelected ? (
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-400 font-medium">
                    Pilih guru terlebih dahulu
                  </p>
                ) : isWeekend ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                    Hari libur KBM ({currentDayName})
                  </p>
                ) : activeDaySchedules.length > 0 ? (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    ✓ {activeDaySchedules.length} jadwal KBM sinkron pada hari {currentDayName}
                  </p>
                ) : (
                  <p className="text-[11px] text-blue-600 dark:text-blue-400 font-medium">
                    Jadwal mandiri / fleksibel pada hari {currentDayName}
                  </p>
                )}
              </div>

              {/* Kelas */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">Kelas</label>
                  {!isNoTeacherSelected && !isNoTeachingDay && activeDaySchedules.length > 0 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Sinkron Jadwal Admin</span>
                  )}
                </div>
                <select
                  value={selectedClassId}
                  disabled={isNoTeacherSelected || isNoTeachingDay}
                  onChange={(e) => handleSelectClass(e.target.value)}
                  className={`w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary ${
                    isNoTeacherSelected || isNoTeachingDay ? "opacity-60 cursor-not-allowed bg-slate-100/60 dark:bg-slate-800/60" : ""
                  }`}
                >
                  <option value="">
                    {isNoTeacherSelected
                      ? "-- Pilih Guru Terlebih Dahulu --"
                      : isNoTeachingDay
                      ? `-- Hari libur (${currentDayName}) --`
                      : activeClasses.length === 0
                      ? `-- Tidak ada kelas --`
                      : "-- Pilih Kelas --"}
                  </option>
                  {activeClasses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                {selectedClassId && currentClassSchedule ? (
                  <p className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium truncate">
                    ✓ Terjadwal di kelas {selectedClassName}
                  </p>
                ) : selectedClassId ? (
                  <p className="text-[11px] text-muted truncate">Kelas terpilih: {selectedClassName}</p>
                ) : isNoTeacherSelected ? (
                  <p className="text-[11px] text-indigo-600 dark:text-indigo-400">Pilih guru terlebih dahulu</p>
                ) : isNoTeachingDay ? (
                  <p className="text-[11px] text-amber-600 dark:text-amber-400">Dropdown kelas dinonaktifkan</p>
                ) : (
                  <p className="text-[11px] text-muted">Pilih kelas yang diajar</p>
                )}
              </div>

              {/* Mata Pelajaran */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">Mata Pelajaran</label>
                  {!isNoTeacherSelected && !isNoTeachingDay && activeSubjects.length === 1 && (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">Otomatis Terkunci</span>
                  )}
                </div>
                <select
                  value={selectedSubjectId}
                  disabled={isNoTeacherSelected || isNoTeachingDay}
                  onChange={(e) => handleSelectSubject(e.target.value)}
                  className={`w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary ${
                    isNoTeacherSelected || isNoTeachingDay ? "opacity-60 cursor-not-allowed bg-slate-100/60 dark:bg-slate-800/60" : ""
                  }`}
                >
                  <option value="">
                    {isNoTeacherSelected
                      ? "-- Pilih Guru Terlebih Dahulu --"
                      : isNoTeachingDay
                      ? `-- Hari libur (${currentDayName}) --`
                      : activeSubjects.length === 0
                      ? "-- Tidak ada mapel terkait --"
                      : "-- Pilih Mapel --"}
                  </option>
                  {activeSubjects.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.code ? `(${s.code})` : ""}
                    </option>
                  ))}
                </select>
                {selectedSubjectName && (
                  <p className="text-[11px] text-muted truncate">
                    Mapel: {selectedSubjectName}
                  </p>
                )}
              </div>
            </div>

            {/* Kotak 2: Jam Mengajar (Digeser ke Bawah & Disesuaikan Otomatis Berdasarkan Kelas) */}
            <div className="space-y-3 p-4 rounded-2xl border border-blue-200/50 bg-blue-50/10 dark:bg-blue-900/5">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-blue-200/40 pb-2">
                <div className="flex items-center gap-2">
                  <span className="material-symbols-outlined text-[20px] text-blue-600 dark:text-blue-400">schedule</span>
                  <span className="text-xs font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                    Waktu / Jam Mengajar
                  </span>
                </div>
                {isNoTeacherSelected ? (
                  <span className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">
                    Pilih Guru terlebih dahulu untuk memuat jadwal KBM
                  </span>
                ) : isNoTeachingDay ? (
                  <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                    Hari libur KBM pada hari {currentDayName} (Dropdown Lengkap Dinonaktifkan)
                  </span>
                ) : currentClassSchedule?.startHourLabel && currentClassSchedule?.endHourLabel ? (
                  <div className="flex items-center gap-2">
                    <span className="text-xs px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-700 dark:text-blue-300 font-medium border border-blue-500/20">
                      Jadwal: <strong>{currentClassSchedule.startHourLabel} s/d {currentClassSchedule.endHourLabel}</strong>
                      {currentClassSchedule.jp ? ` (${currentClassSchedule.jp} JP)` : ""}
                    </span>
                    {(startHourId !== currentClassSchedule.startHourId || endHourId !== currentClassSchedule.endHourId) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (currentClassSchedule.startHourId) setStartHourId(currentClassSchedule.startHourId);
                          if (currentClassSchedule.endHourId) setEndHourId(currentClassSchedule.endHourId);
                        }}
                        className="text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 underline inline-flex items-center gap-1 cursor-pointer"
                      >
                        <span className="material-symbols-outlined text-[14px]">restart_alt</span> Reset ke Jadwal
                      </button>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-muted">
                    {selectedClassId ? "Jadwal jam fleksibel / silakan tentukan jam mengajar" : "Pilih kelas untuk penyesuaian otomatis jam mengajar"}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Jam Mengajar Awal */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">Jam Mengajar Awal</label>
                  <select
                    value={startHourId}
                    disabled={isNoTeacherSelected || isNoTeachingDay}
                    onChange={(e) => setStartHourId(e.target.value)}
                    className={`w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary ${
                      isNoTeacherSelected || isNoTeachingDay ? "opacity-60 cursor-not-allowed bg-slate-100/60 dark:bg-slate-800/60" : ""
                    }`}
                  >
                    <option value="">
                      {isNoTeacherSelected
                        ? "-- Pilih Guru Terlebih Dahulu --"
                        : isNoTeachingDay
                        ? `-- Hari libur (${currentDayName}) --`
                        : "-- Pilih Jam Awal --"}
                    </option>
                    {displayHoursList.map((h) => {
                      const isTaken = submittedHourIdsForSelectedDate.has(h.id);
                      const cleanLabel = h.label.replace(/\s*\(\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\)/g, "");
                      return (
                        <option
                          key={h.id}
                          value={h.id}
                          disabled={isTaken}
                          className={isTaken ? "text-gray-400 bg-gray-100 dark:bg-gray-800" : ""}
                        >
                          {cleanLabel}{isTaken ? " — [Sudah Terisi & Terkirim]" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>

                {/* Jam Mengajar Akhir */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">Jam Mengajar Akhir</label>
                  <select
                    value={endHourId}
                    disabled={isNoTeacherSelected || isNoTeachingDay}
                    onChange={(e) => setEndHourId(e.target.value)}
                    className={`w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary ${
                      isNoTeacherSelected || isNoTeachingDay ? "opacity-60 cursor-not-allowed bg-slate-100/60 dark:bg-slate-800/60" : ""
                    }`}
                  >
                    <option value="">
                      {isNoTeacherSelected
                        ? "-- Pilih Guru Terlebih Dahulu --"
                        : isNoTeachingDay
                        ? `-- Hari libur (${currentDayName}) --`
                        : "-- Pilih Jam Akhir --"}
                    </option>
                    {displayHoursList.map((h) => {
                      const isTaken = submittedHourIdsForSelectedDate.has(h.id);
                      const cleanLabel = h.label.replace(/\s*\(\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\)/g, "");
                      return (
                        <option
                          key={h.id}
                          value={h.id}
                          disabled={isTaken}
                          className={isTaken ? "text-gray-400 bg-gray-100 dark:bg-gray-800" : ""}
                        >
                          {cleanLabel}{isTaken ? " — [Sudah Terisi & Terkirim]" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              </div>
            </div>

            {/* Kotak Hijau 2: Materi & Presensi (Berdampingan) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Materi Pembelajaran */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Materi Pembelajaran</label>
                <textarea
                  value={materi}
                  disabled={isNoTeacherSelected || isNoTeachingDay}
                  onChange={(e) => setMateri(e.target.value)}
                  placeholder={
                    isNoTeacherSelected
                      ? "Pilih guru terlebih dahulu..."
                      : isNoTeachingDay
                      ? `Hari libur KBM pada hari ${currentDayName}`
                      : "Tuliskan pokok bahasan atau materi pembelajaran secara lengkap..."
                  }
                  rows={4}
                  className={`w-full rounded-xl border border-outline-variant/40 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary ${
                    isNoTeacherSelected || isNoTeachingDay ? "opacity-60 cursor-not-allowed bg-slate-100/60 dark:bg-slate-800/60" : ""
                  }`}
                />
              </div>

              {/* Keterangan Presensi */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Ket. Presensi</label>
                <textarea
                  value={presenceInfo}
                  disabled={isNoTeacherSelected || isNoTeachingDay}
                  onChange={(e) => setPresenceInfo(e.target.value)}
                  placeholder={
                    isNoTeacherSelected
                      ? "Pilih guru terlebih dahulu..."
                      : isNoTeachingDay
                      ? `Hari libur KBM pada hari ${currentDayName}`
                      : "Contoh: Siswa hadir lengkap, atau A sakit, B izin..."
                  }
                  rows={4}
                  className={`w-full rounded-xl border border-outline-variant/40 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary ${
                    isNoTeacherSelected || isNoTeachingDay ? "opacity-60 cursor-not-allowed bg-slate-100/60 dark:bg-slate-800/60" : ""
                  }`}
                />
              </div>
            </div>

            {/* Action Buttons (Di bawah form) */}
            <div className="flex gap-3 justify-start pt-2">
              <Button
                variant="primary"
                disabled={busy || isNoTeacherSelected || isNoTeachingDay}
                onClick={() => handleSave("draft")}
              >
                <span className="material-symbols-outlined text-[18px]">draft</span>
                Simpan Draft
              </Button>
              {groupId && (
                <Button variant="ghost" className="text-muted hover:text-fg" onClick={handleResetForm}>
                  Batal Edit
                </Button>
              )}
            </div>
          </div>
        )}
      </Card>

      {/* Riwayat Jurnal Section dengan Filter & Pagination */}
      <Card>
        <CardHeader
          title={isAdmin && selectedTeacherUserId ? `Riwayat Jurnal Guru: ${selectedTeacherName}` : "Riwayat Jurnal Mengajar Anda"}
          subtitle={
            isAdmin && selectedTeacherUserId
              ? `Daftar jurnal atas nama ${selectedTeacherName} yang telah disimpan sebagai draft atau dikirim ke sistem.`
              : "Daftar jurnal yang telah Anda simpan sebagai draft atau dikirim ke sistem."
          }
        />

        {/* Filter Bar */}
        <div className="px-5 py-4 border-b app-divider flex flex-col md:flex-row gap-3 items-end">
          <div className="flex-1 flex flex-col gap-1.5 w-full">
            <span className="text-xs font-semibold uppercase app-muted">Filter Tanggal</span>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/40 bg-transparent px-3 py-1.5 text-xs outline-none focus:border-primary"
            />
          </div>

          <div className="flex-1 flex flex-col gap-1.5 w-full">
            <span className="text-xs font-semibold uppercase app-muted">Filter Kelas</span>
            <select
              value={filterClassId}
              onChange={(e) => setFilterClassId(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3 py-1.5 text-xs outline-none focus:border-primary"
            >
              <option value="">Semua Kelas</option>
              {classesList.map((c) => (
                <option key={c.id} value={c.id}>
                  Kelas {c.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 flex flex-col gap-1.5 w-full">
            <span className="text-xs font-semibold uppercase app-muted">Filter Mapel</span>
            <select
              value={filterSubjectId}
              onChange={(e) => setFilterSubjectId(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3 py-1.5 text-xs outline-none focus:border-primary"
            >
              <option value="">Semua Mapel</option>
              {subjectsList.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-end justify-end gap-2 shrink-0">
            {draftCount > 0 && (
              <Button
                size="sm"
                className="text-xs !py-1.5 gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={busy}
                onClick={handleBulkSend}
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                Kirim Masal Draft ({draftCount})
              </Button>
            )}
            {(filterDate !== getTodayString() || filterClassId || filterSubjectId) && (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs !py-1.5 text-error"
                onClick={() => {
                  setFilterDate(getTodayString());
                  setFilterClassId("");
                  setFilterSubjectId("");
                }}
              >
                Reset Filter
              </Button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left" style={{ background: "var(--hover)" }}>
              <tr>
                <th className="px-4 py-3 font-semibold">Tanggal</th>
                <th className="px-4 py-3 font-semibold">Jam</th>
                <th className="px-4 py-3 font-semibold">Kelas</th>
                <th className="px-4 py-3 font-semibold">Mata Pelajaran</th>
                <th className="px-4 py-3 font-semibold">Materi</th>
                <th className="px-4 py-3 font-semibold">Presensi</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loadingJournals ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={8} className="px-4 py-3">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              ) : pager.pageItems.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-10 text-center app-muted">
                    Tidak ada riwayat jurnal yang ditemukan.
                  </td>
                </tr>
              ) : (
                pager.pageItems.map((j) => (
                  <tr key={j.id} className="border-t app-divider row-hover transition-colors">
                    <td className="px-4 py-3 font-medium whitespace-nowrap">{j.date}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {j.teachingHourLabel ? j.teachingHourLabel.replace(/\s*\(\d{2}:\d{2}\s*-\s*\d{2}:\d{2}\)/g, "") : ""}
                    </td>
                    <td className="px-4 py-3 font-semibold">{j.className}</td>

                    <td className="px-4 py-3">{j.subjectName}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate" title={j.materi}>{j.materi}</td>
                    <td className="px-4 py-3 max-w-[150px] truncate" title={j.presenceInfo}>{j.presenceInfo || "—"}</td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <Badge status={j.status === "sent" ? "success" : "pending"}>
                        {j.status === "sent" ? "Terkirim" : "Draft"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {j.status === "draft" ? (
                        <div className="flex gap-2 justify-end">
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => handleEditJournal(j)}>
                            Edit / Muat
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-error hover:text-error hover:bg-error-soft/10"
                            disabled={busy}
                            onClick={() => handleDeleteJournal(j.id, j.teachingHourLabel)}
                          >
                            Hapus
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-success font-semibold px-2">Selesai</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Controls */}
        {!loadingJournals && pager.totalPages > 1 && (
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
