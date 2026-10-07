import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";
import { useAuthStore } from "@/store/auth";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type ClassItem = { id: string; name: string };
type TeacherItem = { id: string; name: string; nip?: string | null };

type MonitoringItem = {
  teachingHourId: string;
  label: string;
  startTime: string;
  endTime: string;
  journalId: string | null;
  classId?: string | null;
  className?: string | null;
  teacherName: string | null;
  subjectName: string | null;
  materi: string | null;
  presenceInfo: string | null;
  status: "draft" | "sent" | null;
};

export function AdminMonitoringJurnalPage() {
  const user = useAuthStore((s) => s.user);
  const isSuperAdmin = user?.roles.includes("superadmin") ?? false;

  const [date, setDate] = useState(() => {
    const today = new Date();
    const offset = today.getTimezoneOffset();
    const local = new Date(today.getTime() - offset * 60 * 1000);
    return local.toISOString().split("T")[0]; // YYYY-MM-DD local time
  });

  const [classesList, setClassesList] = useState<ClassItem[]>([]);
  const [teachersList, setTeachersList] = useState<TeacherItem[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [rows, setRows] = useState<MonitoringItem[]>([]);
  const [loadingConfig, setLoadingConfig] = useState(true);
  const [loadingData, setLoadingData] = useState(false);
  const [busy, setBusy] = useState(false);

  // Modal edit states
  const [editingItem, setEditingItem] = useState<MonitoringItem | null>(null);
  const [editMateri, setEditMateri] = useState("");
  const [editPresence, setEditPresence] = useState("");

  const loadMasterData = async () => {
    setLoadingConfig(true);
    try {
      const [cRes, ssoRes, tRes] = await Promise.allSettled([
        api<{ classes?: ClassItem[]; data?: unknown }>("/admin/classes"),
        api<Array<{ id: string; nama_kelas: string }>>("/admin/sso/kelas"),
        api<TeacherItem[]>("/admin/teachers"),
      ]);

      const combinedClasses: ClassItem[] = [];
      const seenIds = new Set<string>();
      const seenNames = new Set<string>();

      if (ssoRes.status === "fulfilled" && ssoRes.value?.data) {
        for (const k of ssoRes.value.data) {
          const cleanName = (k.nama_kelas || "").replace(/^kelas\s+/i, "").trim();
          if (k.id && cleanName) {
            combinedClasses.push({ id: k.id, name: cleanName });
            seenIds.add(k.id);
            seenNames.add(cleanName.toLowerCase());
          }
        }
      }

      if (cRes.status === "fulfilled" && cRes.value?.data) {
        const val = cRes.value.data;
        const localList = val.classes ?? (Array.isArray(val) ? val : []);
        if (Array.isArray(localList)) {
          for (const k of localList) {
            const cleanName = (k.name || "").replace(/^kelas\s+/i, "").trim();
            if (k.id && cleanName && !seenIds.has(k.id) && !seenNames.has(cleanName.toLowerCase())) {
              combinedClasses.push({ id: k.id, name: cleanName });
              seenIds.add(k.id);
              seenNames.add(cleanName.toLowerCase());
            }
          }
        }
      }

      setClassesList(combinedClasses);
      if (combinedClasses.length > 0) {
        setSelectedClassId(combinedClasses[0].id);
      }

      if (tRes.status === "fulfilled" && Array.isArray(tRes.value?.data)) {
        const uniqueTeachers: TeacherItem[] = [];
        const seenTIds = new Set<string>();
        const seenTNames = new Set<string>();
        for (const t of tRes.value.data) {
          const tName = (t.name || "").trim();
          if (t.id && tName && !seenTIds.has(t.id) && !seenTNames.has(tName.toLowerCase())) {
            uniqueTeachers.push({ id: t.id, name: tName, nip: t.nip });
            seenTIds.add(t.id);
            seenTNames.add(tName.toLowerCase());
          }
        }
        setTeachersList(uniqueTeachers);
      }
    } catch (e) {
      console.error("Gagal memuat data kelas/guru:", e);
    } finally {
      setLoadingConfig(false);
    }
  };

  const loadMonitoring = async (cId: string, tId: string, dt: string) => {
    if ((!cId && !tId) || !dt) return;
    setLoadingData(true);
    try {
      const params = new URLSearchParams({ date: dt });
      if (cId) {
        params.set("classId", cId);
        const clsObj = classesList.find((c) => c.id === cId);
        if (clsObj?.name) params.set("className", clsObj.name);
      } else if (tId) {
        params.set("teacherId", tId);
        const tObj = teachersList.find((t) => t.id === tId);
        if (tObj?.name) params.set("teacherName", tObj.name);
      }

      const res = await api<MonitoringItem[]>(`/admin/journals/monitoring?${params.toString()}`);
      setRows(res.data ?? []);
    } catch (e) {
      console.error("Gagal memuat monitoring jurnal:", e);
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    loadMasterData();
  }, []);

  useEffect(() => {
    if ((selectedClassId || selectedTeacherId) && date) {
      loadMonitoring(selectedClassId, selectedTeacherId, date);
    }
  }, [selectedClassId, selectedTeacherId, date, classesList, teachersList]);

  // Realtime: auto-refresh monitoring jurnal saat guru/admin input atau hapus jurnal
  useRealtimeEvent(
    ["journal_saved", "journal_deleted"],
    () => {
      if ((selectedClassId || selectedTeacherId) && date) {
        loadMonitoring(selectedClassId, selectedTeacherId, date);
      }
    }
  );

  const handleKoreksiUlang = async (journalId: string, hourLabel: string) => {
    const confirmResult = await Swal.fire({
      title: "Koreksi Ulang Jurnal?",
      text: `Kembalikan jurnal ${hourLabel} menjadi Draft agar bisa diedit guru?`,
      icon: "question",
      showCancelButton: true,
      confirmButtonColor: "#2563eb",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Set Draft",
      cancelButtonText: "Batal",
    });

    if (!confirmResult.isConfirmed) return;

    setBusy(true);
    try {
      const res = await api<{ message?: string }>("/admin/journals/koreksi-ulang", {
        method: "POST",
        body: JSON.stringify({ journalId }),
      });
      Swal.fire({
        title: "Berhasil!",
        text: res.message || "Jurnal berhasil dikembalikan ke Draft.",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      await loadMonitoring(selectedClassId, selectedTeacherId, date);
    } catch (e: any) {
      Swal.fire({
        title: "Gagal",
        text: e.message || "Gagal mengeset ke draft",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteJournal = async (journalId: string, hourLabel: string) => {
    const confirmResult = await Swal.fire({
      title: "Hapus Jurnal (Soft Delete)?",
      text: `Apakah Anda yakin ingin menghapus jurnal pada ${hourLabel}? Data akan disembunyikan (soft delete).`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#ef4444",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Hapus Jurnal",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!confirmResult.isConfirmed) return;

    setBusy(true);
    try {
      await api(`/admin/journals/${journalId}`, { method: "DELETE" });
      Swal.fire({
        title: "Berhasil!",
        text: "Jurnal mengajar berhasil dihapus (soft delete).",
        icon: "success",
        timer: 1500,
        showConfirmButton: false,
      });
      await loadMonitoring(selectedClassId, selectedTeacherId, date);
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Hapus",
        text: e.message || "Gagal menghapus jurnal",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setBusy(false);
    }
  };

  const openEditModal = (item: MonitoringItem) => {
    setEditingItem(item);
    setEditMateri(item.materi ?? "");
    setEditPresence(item.presenceInfo ?? "");
  };

  const closeEditModal = () => {
    setEditingItem(null);
    setEditMateri("");
    setEditPresence("");
  };

  const handleSaveEdit = async () => {
    if (!editingItem || !editingItem.journalId) return;
    if (!editMateri.trim()) {
      alert("Materi pembelajaran wajib diisi");
      return;
    }
    setBusy(true);
    try {
      await api(`/admin/journals/${editingItem.journalId}`, {
        method: "PATCH",
        body: JSON.stringify({
          materi: editMateri,
          presenceInfo: editPresence,
        }),
      });
      alert("Jurnal berhasil diperbarui!");
      closeEditModal();
      await loadMonitoring(selectedClassId, selectedTeacherId, date);
    } catch (e: any) {
      alert(e.message || "Gagal menyimpan perubahan");
    } finally {
      setBusy(false);
    }
  };

  const selectedClassName = classesList.find((c) => c.id === selectedClassId)?.name ?? "";
  const selectedTeacherName = teachersList.find((t) => t.id === selectedTeacherId)?.name ?? "";
  const isTeacherMode = Boolean(selectedTeacherId);
  const colSpanCount = isTeacherMode ? 8 : 7;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring Jurnal Mengajar"
        description="Pantau, koreksi, dan kelola jurnal mengajar harian berdasarkan kelas atau guru."
      />

      {/* Filter Tanggal, Kelas & Guru */}
      <Card>
        <div className="p-5 grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider app-muted">Pilih Tanggal</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-xl border border-outline-variant/40 bg-transparent px-3.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider app-muted">
              Pilih Kelas <span className="text-[10px] font-normal lowercase opacity-75">(pilih salah satu)</span>
            </label>
            {loadingConfig ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <select
                value={selectedClassId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedClassId(val);
                  if (val) {
                    setSelectedTeacherId("");
                  } else if (!selectedTeacherId && teachersList.length > 0) {
                    setSelectedTeacherId(teachersList[0].id);
                  }
                }}
                className={`w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-all ${
                  selectedClassId
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold"
                    : "border-outline-variant/40 bg-[var(--bg)] opacity-80"
                }`}
              >
                <option value="">— Semua Kelas (Mode Per Guru) —</option>
                {classesList.map((c) => (
                  <option key={c.id} value={c.id}>
                    Kelas {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wider app-muted">
              Pilih Guru <span className="text-[10px] font-normal lowercase opacity-75">(pilih salah satu)</span>
            </label>
            {loadingConfig ? (
              <Skeleton className="h-10 w-full" />
            ) : (
              <select
                value={selectedTeacherId}
                onChange={(e) => {
                  const val = e.target.value;
                  setSelectedTeacherId(val);
                  if (val) {
                    setSelectedClassId("");
                  } else if (!selectedClassId && classesList.length > 0) {
                    setSelectedClassId(classesList[0].id);
                  }
                }}
                className={`w-full rounded-xl border px-3.5 py-2 text-sm outline-none transition-all ${
                  selectedTeacherId
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] font-semibold"
                    : "border-outline-variant/40 bg-[var(--bg)] opacity-80"
                }`}
              >
                <option value="">— Semua Guru (Mode Per Kelas) —</option>
                {teachersList.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </Card>

      {/* Tabel Hasil Monitoring */}
      <Card className="overflow-hidden">
        <CardHeader
          title={
            isTeacherMode
              ? `Jurnal Pembelajaran Guru - ${selectedTeacherName}`
              : `Jurnal Pembelajaran Kelas - ${selectedClassName}`
          }
          subtitle={`Status kegiatan belajar mengajar pada tanggal ${date}`}
        />
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="text-left" style={{ background: "var(--hover)" }}>
              <tr>
                <th className="px-4 py-3 font-semibold">Jam Ke</th>
                {isTeacherMode && <th className="px-4 py-3 font-semibold">Kelas</th>}
                <th className="px-4 py-3 font-semibold">Guru Pengajar</th>
                <th className="px-4 py-3 font-semibold">Mata Pelajaran</th>
                <th className="px-4 py-3 font-semibold">Materi Pembelajaran</th>
                <th className="px-4 py-3 font-semibold">Ket. Presensi</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold text-right">Koreksi & Aksi</th>
              </tr>
            </thead>
            <tbody>
              {loadingData ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i}>
                    <td colSpan={colSpanCount} className="px-4 py-3">
                      <Skeleton className="h-8 w-full" />
                    </td>
                  </tr>
                ))
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={colSpanCount} className="px-4 py-10 text-center app-muted">
                    Tidak ada jam mengajar yang dikonfigurasi. Silakan tambahkan jam mengajar terlebih dahulu di menu Mapel & Penugasan.
                  </td>
                </tr>
              ) : (
                rows.map((r, idx) => (
                  <tr key={`${r.teachingHourId}-${r.journalId ?? idx}`} className="border-t app-divider row-hover transition-colors">
                    <td className="px-4 py-3 font-semibold">{r.label}</td>
                    {isTeacherMode && (
                      <td className="px-4 py-3 font-medium">
                        {r.className ? (
                          r.className.toLowerCase().startsWith("kelas") ? r.className : `Kelas ${r.className}`
                        ) : (
                          <span className="app-muted">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 font-medium">
                      {r.teacherName ?? (isTeacherMode && r.journalId ? selectedTeacherName : <span className="app-muted">—</span>)}
                    </td>
                    <td className="px-4 py-3">{r.subjectName ?? <span className="app-muted">—</span>}</td>
                    <td className="px-4 py-3 max-w-[200px] truncate" title={r.materi ?? ""}>
                      {r.materi ?? <span className="app-muted">—</span>}
                    </td>
                    <td className="px-4 py-3 max-w-[150px] truncate" title={r.presenceInfo ?? ""}>
                      {r.presenceInfo ?? <span className="app-muted">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      {r.status ? (
                        <Badge status={r.status === "sent" ? "success" : "warning"}>
                          {r.status === "sent" ? "Terkirim" : "Draft"}
                        </Badge>
                      ) : (
                        <Badge status="incomplete">Belum Isi</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {r.journalId ? (
                        <div className="flex gap-2 justify-end items-center">
                          <Button size="sm" variant="ghost" disabled={busy} onClick={() => openEditModal(r)}>
                            Edit
                          </Button>
                          {r.status === "sent" && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="!py-1 !px-2.5 text-xs"
                              disabled={busy}
                              onClick={() => handleKoreksiUlang(r.journalId!, r.label)}
                            >
                              Koreksi Ulang
                            </Button>
                          )}
                          {isSuperAdmin && (
                            <Button
                              size="sm"
                              variant="secondary"
                              className="!bg-red-500/10 hover:!bg-red-500/20 !text-red-600 dark:!text-red-400 !py-1 !px-2.5 text-xs gap-1"
                              disabled={busy}
                              onClick={() => handleDeleteJournal(r.journalId!, r.label)}
                            >
                              <span className="material-symbols-outlined text-[16px]">delete</span>
                              Hapus
                            </Button>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs app-muted px-2">Kunci</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Modal Edit Jurnal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-fade-in">
          <Card className="w-full max-w-lg shadow-2xl bg-[var(--bg)] animate-slide-up">
            <CardHeader
              title={`Edit Jurnal: ${editingItem.label}`}
              subtitle={`${editingItem.className ? `Kelas: ${editingItem.className} | ` : ""}Guru: ${editingItem.teacherName || selectedTeacherName} | Mapel: ${editingItem.subjectName}`}
            />
            <div className="p-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Materi Pembelajaran</label>
                <textarea
                  value={editMateri}
                  onChange={(e) => setEditMateri(e.target.value)}
                  placeholder="Tuliskan pokok bahasan atau materi pembelajaran..."
                  rows={4}
                  className="w-full rounded-xl border border-outline-variant/40 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold uppercase tracking-wider app-muted">Keterangan Presensi</label>
                <textarea
                  value={editPresence}
                  onChange={(e) => setEditPresence(e.target.value)}
                  placeholder="Contoh: Hadir lengkap..."
                  rows={3}
                  className="w-full rounded-xl border border-outline-variant/40 bg-transparent px-3 py-2 text-sm outline-none focus:border-primary"
                />
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="ghost" onClick={closeEditModal} disabled={busy}>
                  Batal
                </Button>
                <Button onClick={handleSaveEdit} disabled={busy}>
                  Simpan Perubahan
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
}
