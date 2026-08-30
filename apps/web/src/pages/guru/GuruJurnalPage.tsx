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

type ClassItem = { id: string; name: string };
type SubjectItem = { id: string; name: string; code: string | null };
type TeachingHourItem = { id: string; label: string; startTime: string; endTime: string };

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
  const [date, setDate] = useState(() => {
    const today = new Date();
    const offset = today.getTimezoneOffset();
    const local = new Date(today.getTime() - offset * 60 * 1000);
    return local.toISOString().split("T")[0]; // YYYY-MM-DD local time
  });
  
  const [classesList, setClassesList] = useState<ClassItem[]>([]);
  const [subjectsList, setSubjectsList] = useState<SubjectItem[]>([]);
  const [hoursList, setHoursList] = useState<TeachingHourItem[]>([]);
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

  // Load configuration (classes, subjects, teaching hours)
  const loadConfig = async () => {
    setLoadingConfig(true);
    try {
      const [cRes, sRes, hRes] = await Promise.allSettled([
        api<ClassItem[]>("/teacher/classes"),
        api<SubjectItem[]>("/teacher/subjects"),
        api<TeachingHourItem[]>("/teacher/teaching-hours"),
      ]);

      if (cRes.status === "fulfilled" && cRes.value?.data) {
        setClassesList(cRes.value.data);
      }
      if (sRes.status === "fulfilled" && sRes.value?.data) {
        const val = sRes.value.data;
        const list = Array.isArray(val) ? val : ((val as any).subjects || []);
        setSubjectsList(list);
      }
      if (hRes.status === "fulfilled" && hRes.value?.data) {
        setHoursList(hRes.value.data);
      }
    } catch (e) {
      console.error("Gagal memuat konfigurasi jurnal:", e);
    } finally {
      setLoadingConfig(false);
    }
  };

  // Load written journals
  const loadJournals = async () => {
    setLoadingJournals(true);
    try {
      const res = await api<JournalItem[]>("/teacher/journals");
      setJournalsList(res.data ?? []);
    } catch (e) {
      console.error("Gagal memuat riwayat jurnal:", e);
    } finally {
      setLoadingJournals(false);
    }
  };

  useEffect(() => {
    loadConfig();
    loadJournals();
  }, []);

  // Realtime: refresh list jurnal saat ada jurnal yang disimpan/dihapus
  useRealtimeEvent(
    ["journal_saved", "journal_deleted"],
    () => { loadJournals(); }
  );

  // Find names from lists
  const selectedClassName = useMemo(() => {
    return classesList.find((c) => c.id === selectedClassId)?.name ?? "";
  }, [classesList, selectedClassId]);

  const selectedSubjectName = useMemo(() => {
    return subjectsList.find((s) => s.id === selectedSubjectId)?.name ?? "";
  }, [subjectsList, selectedSubjectId]);

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
      await loadJournals();
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
      await loadJournals();
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
      await loadJournals();
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
        title="Jurnal Kegiatan Guru"
        description="Isi dan simpan draft jurnal kegiatan pembelajaran harian Anda di kelas."
      />

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
            {/* Kotak Biru: Tanggal & Jam Mengajar (Berdampingan) */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 rounded-2xl border border-blue-200/50 bg-blue-50/10 dark:bg-blue-900/5">
              {/* Tanggal */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Tanggal</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              {/* Jam Mengajar Awal */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Jam Mengajar Awal</label>
                <select
                  value={startHourId}
                  onChange={(e) => setStartHourId(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">-- Pilih Jam Awal --</option>
                  {hoursList.map((h) => {
                    const isTaken = submittedHourIdsForSelectedDate.has(h.id);
                    return (
                      <option
                        key={h.id}
                        value={h.id}
                        disabled={isTaken}
                        className={isTaken ? "text-gray-400 bg-gray-100 dark:bg-gray-800" : ""}
                      >
                        {h.label}{isTaken ? " — [Sudah Terisi & Terkirim]" : ""}
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
                  onChange={(e) => setEndHourId(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">-- Pilih Jam Akhir --</option>
                  {hoursList.map((h) => {
                    const isTaken = submittedHourIdsForSelectedDate.has(h.id);
                    return (
                      <option
                        key={h.id}
                        value={h.id}
                        disabled={isTaken}
                        className={isTaken ? "text-gray-400 bg-gray-100 dark:bg-gray-800" : ""}
                      >
                        {h.label}{isTaken ? " — [Sudah Terisi & Terkirim]" : ""}
                      </option>
                    );
                  })}
                </select>
              </div>

            </div>

            {/* Kotak Hijau: Kelas & Mapel (Berdampingan) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 rounded-2xl border border-emerald-200/50 bg-emerald-50/10 dark:bg-emerald-900/5">
              {/* Kelas */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Kelas</label>
                <select
                  value={selectedClassId}
                  onChange={(e) => setSelectedClassId(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">-- Pilih Kelas --</option>
                  {classesList.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Mata Pelajaran */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Mata Pelajaran</label>
                <select
                  value={selectedSubjectId}
                  onChange={(e) => setSelectedSubjectId(e.target.value)}
                  className="w-full rounded-xl border border-outline-variant/40 bg-[var(--bg)] px-3.5 py-2.5 text-sm outline-none focus:border-primary"
                >
                  <option value="">-- Pilih Mapel --</option>
                  {subjectsList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} {s.code ? `(${s.code})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Kotak Hijau 2: Materi & Presensi (Berdampingan) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Materi Pembelajaran */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Materi Pembelajaran</label>
                <textarea
                  value={materi}
                  onChange={(e) => setMateri(e.target.value)}
                  placeholder="Tuliskan pokok bahasan atau materi pembelajaran secara lengkap..."
                  rows={4}
                  className="w-full rounded-xl border border-outline-variant/40 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              {/* Keterangan Presensi */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Ket. Presensi</label>
                <textarea
                  value={presenceInfo}
                  onChange={(e) => setPresenceInfo(e.target.value)}
                  placeholder="Contoh: Siswa hadir lengkap, atau A sakit, B izin..."
                  rows={4}
                  className="w-full rounded-xl border border-outline-variant/40 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Action Buttons (Di bawah form) */}
            <div className="flex gap-3 justify-start pt-2">
              <Button
                variant="primary"
                disabled={busy}
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
          title="Riwayat Jurnal Mengajar Anda"
          subtitle="Daftar jurnal yang telah Anda simpan sebagai draft atau dikirim ke sistem."
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
