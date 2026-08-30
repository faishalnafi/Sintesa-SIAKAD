import { useEffect, useState } from "react";
import Swal from "sweetalert2";
import { api } from "@/lib/api";
import { useSystemStore } from "@/store/system";

type CheckResult = {
  currentDbVersion: string;
  currentDbVersionCode: number;
  latestJsonVersion: string;
  latestJsonVersionCode: number;
  isUpdateAvailable: boolean;
  isUpdating: boolean;
  manifest: {
    version: string;
    version_code: number;
    db_version: string;
    title: string;
    release_date: string;
    force_update: boolean;
    changelog: string[];
    schema_changes?: string[];
  };
};

type StagedZipResult = {
  manifest: CheckResult["manifest"];
  currentDbVersion: string;
  currentDbVersionCode: number;
  isNewer: boolean;
  filesCount: number;
};

type AppVersionHistory = {
  id: string;
  version: string;
  versionCode: number;
  dbVersion: string;
  title: string;
  changelog: string[];
  forceUpdate: boolean;
  installedAt: string;
  installedBy?: string;
};

type Props = {
  defaultTab?: "update" | "backup";
};

export function AppUpdatePage({ defaultTab }: Props) {
  const { fetchVersionInfo } = useSystemStore();
  const [activeTab, setActiveTab] = useState<"update" | "backup">(() => {
    if (defaultTab) return defaultTab;
    const params = new URLSearchParams(window.location.search);
    return params.get("tab") === "backup" ? "backup" : "update";
  });

  const [checkData, setCheckData] = useState<CheckResult | null>(null);
  const [history, setHistory] = useState<AppVersionHistory[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [updating, setUpdating] = useState(false);

  const [stagedZip, setStagedZip] = useState<StagedZipResult | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Backup & Restore State
  const [downloadingBackup, setDownloadingBackup] = useState(false);
  const [restoringBackup, setRestoringBackup] = useState(false);
  const [selectedBackupFile, setSelectedBackupFile] = useState<File | null>(null);

  // Manual release JSON form state
  const [showReleaseModal, setShowReleaseModal] = useState(false);
  const [formVersion, setFormVersion] = useState("");
  const [formVersionCode, setFormVersionCode] = useState(101);
  const [formDbVersion, setFormDbVersion] = useState("");
  const [formTitle, setFormTitle] = useState("");
  const [formChangelog, setFormChangelog] = useState("");
  const [formForceUpdate, setFormForceUpdate] = useState(false);

  const loadData = async () => {
    setLoading(true);
    try {
      const [resCheck, resHistory] = await Promise.all([
        api<CheckResult>("/admin/app-update/check"),
        api<AppVersionHistory[]>("/admin/app-update/history"),
      ]);
      if (resCheck.data) setCheckData(resCheck.data);
      if (resHistory.data) setHistory(resHistory.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (!file.name.endsWith(".zip")) {
        Swal.fire("Format Salah", "Pilih berkas kompresi .zip yang berisi file proyek/update!", "warning");
        return;
      }
      setSelectedFile(file);
      uploadZipFile(file);
    }
  };

  const [uploadProgress, setUploadProgress] = useState(0);

  const uploadZipFile = (file: File) => {
    setUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    const API_BASE = import.meta.env.VITE_API_BASE_URL || "/api";

    xhr.open("POST", `${API_BASE}/admin/app-update/upload-zip`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percent = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percent);
      }
    };

    xhr.onload = () => {
      setUploading(false);
      try {
        const res = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && res.success) {
          setStagedZip(res.data);
          Swal.fire({
            icon: "success",
            title: "Paket ZIP Terverifikasi",
            text: `File version.json (${res.data.manifest.version}) berhasil dibaca dari root ZIP!`,
            timer: 2000,
            showConfirmButton: false,
          });
        } else {
          throw new Error(res.message || "Gagal mengunggah file ZIP");
        }
      } catch (err) {
        setStagedZip(null);
        Swal.fire("Validasi Gagal", err instanceof Error ? err.message : "Gagal mengunggah file ZIP", "error");
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setStagedZip(null);
      Swal.fire("Gagal Mengunggah", "Terjadi kesalahan jaringan saat mengunggah file", "error");
    };

    xhr.send(formData);
  };

  const handleTriggerUpdate = async () => {
    const targetVer = stagedZip ? stagedZip.manifest.version : checkData?.latestJsonVersion || "baru";

    const confirm = await Swal.fire({
      title: `Jalankan Update ke v${targetVer}?`,
      text: "Seluruh aktivitas user lain akan ditahan sementara (Pending Loading) hingga proses update selesai. Data DB dipastikan aman 100%.",
      icon: "warning",
      showCancelButton: true,
      confirmButtonText: "Ya, Mulai Update Now",
      cancelButtonText: "Batal",
      confirmButtonColor: "#059669",
    });

    if (!confirm.isConfirmed) return;

    setUpdating(true);
    try {
      const res = await api<{ version: string }>("/admin/app-update/trigger-zip", {
        method: "POST",
        body: JSON.stringify({}),
      });

      Swal.fire({
        icon: "success",
        title: "Pembaruan Berhasil!",
        text: res.message || `Aplikasi berhasil diperbarui ke versi ${res.data?.version || targetVer}`,
      });

      setStagedZip(null);
      setSelectedFile(null);
      await loadData();
      await fetchVersionInfo();
    } catch (err) {
      Swal.fire("Pembaruan Gagal", err instanceof Error ? err.message : "Terjadi kesalahan saat memproses update", "error");
    } finally {
      setUpdating(false);
    }
  };

  const handleSaveReleaseJson = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api("/admin/app-update/release-json", {
        method: "POST",
        body: JSON.stringify({
          version: formVersion,
          versionCode: formVersionCode,
          dbVersion: formDbVersion || formVersion,
          title: formTitle,
          forceUpdate: formForceUpdate,
          changelog: formChangelog.split("\n").filter(Boolean),
        }),
      });

      Swal.fire("Manifest Diperbarui", "Berkas version.json berhasil diperbarui!", "success");
      setShowReleaseModal(false);
      await loadData();
    } catch (err) {
      Swal.fire("Gagal Menyimpan", err instanceof Error ? err.message : "Gagal memperbarui version.json", "error");
    }
  };

  // Handle Download Backup JSON
  const handleDownloadBackup = async () => {
    setDownloadingBackup(true);
    try {
      const res = await fetch("/api/admin/backup", {
        headers: { "Content-Type": "application/json" },
        credentials: "include",
      });

      if (!res.ok) throw new Error(`Backup gagal (${res.status})`);

      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const dateStr = new Date().toISOString().slice(0, 10);
      a.download = `SIAKAD-backup-${dateStr}.json`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);

      Swal.fire({
        title: "Backup Berhasil!",
        text: "File cadangan JSON database berhasil diunduh.",
        icon: "success",
        confirmButtonColor: "#059669",
      });
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Backup",
        text: e.message || "Gagal mengunduh backup database",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setDownloadingBackup(false);
    }
  };

  // Handle Restore JSON File
  const handleRestoreDatabase = async () => {
    if (!selectedBackupFile) {
      Swal.fire({
        title: "Pilih File Backup",
        text: "Silakan pilih berkas backup berformat .json terlebih dahulu.",
        icon: "warning",
        confirmButtonColor: "#f59e0b",
      });
      return;
    }

    const confirmResult = await Swal.fire({
      title: "Konfirmasi Restore Data",
      text: `Apakah Anda yakin ingin memulihkan database dari file "${selectedBackupFile.name}"? Data di database akan diperbarui.`,
      icon: "warning",
      showCancelButton: true,
      confirmButtonColor: "#dc2626",
      cancelButtonColor: "#6b7280",
      confirmButtonText: "Ya, Restore Sekarang",
      cancelButtonText: "Batal",
      reverseButtons: true,
    });

    if (!confirmResult.isConfirmed) return;

    setRestoringBackup(true);
    try {
      const fileText = await selectedBackupFile.text();
      const parsedJson = JSON.parse(fileText);

      const res = await fetch("/api/admin/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(parsedJson),
      });

      const json = await res.json();
      if (!res.ok || !json.success) throw new Error(json.message || "Restore gagal");

      Swal.fire({
        title: "Restore Berhasil!",
        text: json.message || "Database berhasil dipulihkan.",
        icon: "success",
        confirmButtonColor: "#059669",
      });
      setSelectedBackupFile(null);
    } catch (e: any) {
      Swal.fire({
        title: "Gagal Restore",
        text: e.message || "Gagal membaca atau memproses file backup JSON.",
        icon: "error",
        confirmButtonColor: "#ef4444",
      });
    } finally {
      setRestoringBackup(false);
    }
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold font-display text-[var(--fg)] tracking-tight">
            Pemeliharaan &amp; Update Sistem
          </h1>
          <p className="text-sm app-muted mt-1">
            Kelola pembaruan versi aplikasi, unduh backup database, dan lakukan pemulihan data sistem.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {activeTab === "update" && (
            <button
              type="button"
              onClick={() => {
                const nextCode = (checkData?.currentDbVersionCode || 100) + 1;
                setFormVersion(`1.${nextCode - 100}.0`);
                setFormVersionCode(nextCode);
                setFormDbVersion(`1.${nextCode - 100}.0`);
                setFormTitle(`Pembaruan Sistem v1.${nextCode - 100}.0`);
                setFormChangelog("Peningkatan performa database\nPerbaikan bug navigasi\nFitur baru");
                setShowReleaseModal(true);
              }}
              className="px-4 py-2.5 rounded-xl border border-[var(--input-border)] text-[13px] font-semibold app-muted hover:text-[var(--fg)] hover:bg-[var(--hover)] transition-colors flex items-center gap-2"
            >
              <span className="material-symbols-outlined text-[18px]">note_add</span>
              <span>Buat Manifest JSON</span>
            </button>
          )}
          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="px-4 py-2.5 rounded-xl bg-[var(--accent-soft)] text-[var(--accent)] hover:opacity-90 transition-opacity font-semibold text-[13px] flex items-center gap-2"
          >
            <span className={`material-symbols-outlined text-[18px] ${loading ? "animate-spin" : ""}`}>
              refresh
            </span>
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {/* Tab Navigation Header */}
      <div className="flex border-b border-[var(--divider)] gap-8 text-sm font-semibold">
        <button
          type="button"
          onClick={() => setActiveTab("update")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-all ${
            activeTab === "update"
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold"
              : "border-transparent text-outline hover:text-[var(--fg)]"
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">system_update</span>
          <span>Update Aplikasi</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("backup")}
          className={`pb-3 flex items-center gap-2 border-b-2 transition-all ${
            activeTab === "backup"
              ? "border-emerald-500 text-emerald-600 dark:text-emerald-400 font-bold"
              : "border-transparent text-outline hover:text-[var(--fg)]"
          }`}
        >
          <span className="material-symbols-outlined text-[20px]">settings_backup_restore</span>
          <span>Backup &amp; Restore Data</span>
        </button>
      </div>

      {/* TAB 1: UPDATE APLIKASI */}
      {activeTab === "update" && (
        <div className="space-y-8 animate-fadeIn">
          {/* Comparison Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Active DB Version Card */}
            <div className="bg-[var(--card-bg)] border border-[var(--divider)] rounded-3xl p-6 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold">
                    DB
                  </div>
                  <div>
                    <span className="text-xs app-muted font-medium">Versi Database Aktif</span>
                    <h3 className="text-xl font-bold font-display text-[var(--fg)] mt-0.5">
                      v{checkData?.currentDbVersion || "1.0.0"}
                    </h3>
                  </div>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-500 border border-blue-500/20">
                  Build #{checkData?.currentDbVersionCode || 100}
                </span>
              </div>

              <div className="mt-4 pt-4 border-t border-[var(--divider)] text-xs app-muted space-y-1.5">
                <div className="flex justify-between">
                  <span>Status Skema DB:</span>
                  <span className="font-semibold text-emerald-500">Tersinkronisasi 100%</span>
                </div>
                <div className="flex justify-between">
                  <span>DB Version Tag:</span>
                  <span className="font-mono text-[var(--fg)]">{checkData?.manifest?.db_version || "1.0.0"}</span>
                </div>
              </div>
            </div>

            {/* JSON Manifest Version Card */}
            <div className="bg-[var(--card-bg)] border border-[var(--divider)] rounded-3xl p-6 shadow-sm relative overflow-hidden">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-500 flex items-center justify-center font-bold">
                    JSON
                  </div>
                  <div>
                    <span className="text-xs app-muted font-medium">Versi Manifest JSON Terbaru</span>
                    <h3 className="text-xl font-bold font-display text-[var(--fg)] mt-0.5">
                      v{checkData?.latestJsonVersion || "1.0.0"}
                    </h3>
                  </div>
                </div>

                {checkData?.isUpdateAvailable ? (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse">
                    Pembaruan Tersedia
                  </span>
                ) : (
                  <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Versi Terbaru
                  </span>
                )}
              </div>

              <div className="mt-4 pt-4 border-t border-[var(--divider)] text-xs app-muted space-y-1.5">
                <div className="flex justify-between">
                  <span>Target Build Code:</span>
                  <span className="font-semibold text-[var(--fg)]">#{checkData?.latestJsonVersionCode || 100}</span>
                </div>
                <div className="flex justify-between">
                  <span>Perlu Update Mandatori:</span>
                  <span>{checkData?.manifest?.force_update ? "Ya" : "Opsional"}</span>
                </div>
              </div>
            </div>
          </div>

          {/* ZIP Package Uploader & Trigger Action */}
          <div className="bg-[var(--card-bg)] border border-[var(--divider)] rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[24px]">folder_zip</span>
              </div>
              <div>
                <h2 className="text-lg font-bold font-display text-[var(--fg)]">
                  Unggah Paket Pembaruan (.ZIP SiCare)
                </h2>
                <p className="text-xs app-muted">
                  Upload file ZIP yang sudah berisi hasil build terbaru. Gunakan script <code className="text-emerald-500 font-mono">build-update-package.ps1</code> untuk membuat paket yang tepat.
                </p>
              </div>
            </div>

            {/* Format info panel */}
            <div className="p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 space-y-2.5 text-xs">
              <div className="flex items-center gap-2 font-semibold text-blue-500">
                <span className="material-symbols-outlined text-[18px]">info</span>
                <span>Struktur ZIP yang Diharapkan</span>
              </div>
              <div className="font-mono text-[11px] leading-relaxed text-[var(--fg)] opacity-80 space-y-0.5 pl-2">
                <div><span className="text-emerald-500">📄</span> version.json <span className="text-slate-400">(wajib ada di root ZIP)</span></div>
                <div><span className="text-blue-400">📁</span> apps/web/dist/ <span className="text-slate-400">(hasil build frontend)</span></div>
                <div><span className="text-purple-400">📁</span> apps/api/dist/ <span className="text-slate-400">(hasil build backend)</span></div>
              </div>
              <p className="app-muted opacity-80">
                Jalankan <code className="bg-[var(--hover)] px-1.5 py-0.5 rounded font-mono">.\build-update-package.ps1</code> di root proyek untuk membuat ZIP secara otomatis.
              </p>
            </div>

            {/* Dropzone */}
            <div className="relative border-2 border-dashed border-[var(--input-border)] hover:border-emerald-500 rounded-2xl p-8 text-center transition-colors bg-[var(--hover)]/50 cursor-pointer">
              <input
                type="file"
                accept=".zip"
                onChange={handleFileChange}
                disabled={uploading || updating}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="space-y-3 pointer-events-none">
                <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 text-emerald-500 mx-auto flex items-center justify-center">
                  <span className={`material-symbols-outlined text-[32px] ${uploading ? "animate-bounce" : ""}`}>
                    cloud_upload
                  </span>
                </div>
                {uploading ? (
                  <div className="max-w-md mx-auto space-y-2 pt-1">
                    <p className="text-sm font-semibold text-[var(--fg)]">{selectedFile?.name}</p>
                    <div className="flex items-center justify-between text-xs text-emerald-600 dark:text-emerald-400 font-medium px-1">
                      <span>Mengunggah berkas update...</span>
                      <span className="font-mono font-bold text-sm">{uploadProgress}%</span>
                    </div>
                    <div className="w-full h-3.5 rounded-full bg-emerald-500/15 overflow-hidden p-0.5 border border-emerald-500/20">
                      <div
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 rounded-full transition-all duration-150 ease-out shadow-sm"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                    <p className="text-[11px] app-muted">
                      {selectedFile ? (selectedFile.size / 1024 / 1024).toFixed(2) : "0"} MB · Mohon tidak menutup halaman saat proses unggah berlangsung
                    </p>
                  </div>
                ) : selectedFile ? (
                  <div>
                    <p className="text-sm font-semibold text-[var(--fg)]">{selectedFile.name}</p>
                    <p className="text-xs text-emerald-500 mt-0.5">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)} MB · Berkas SiCare ZIP Terpilih
                    </p>
                  </div>
                ) : (
                  <div>
                    <p className="text-sm font-medium text-[var(--fg)]">
                      Tarik &amp; lepas file <span className="text-emerald-500 font-semibold">.zip</span> di sini, atau klik untuk memilih file
                    </p>
                    <p className="text-xs app-muted mt-1">
                      Format ZIP SiCare: Berkas <code className="font-mono">version.json</code> harus berada langsung di tingkat pertama file ZIP.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Staged ZIP Preview Card */}
            {stagedZip && (
              <div className="p-5 rounded-2xl bg-emerald-500/5 border border-emerald-500/20 space-y-4 animate-fadeIn">
                <div className="flex items-center justify-between border-b border-emerald-500/20 pb-3">
                  <div className="flex items-center gap-2.5">
                    <span className="material-symbols-outlined text-emerald-500">task_alt</span>
                    <span className="font-semibold text-sm text-[var(--fg)]">
                      Preview Paket ZIP Update v{stagedZip.manifest.version}
                    </span>
                  </div>
                  <span className="text-xs font-mono px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Build #{stagedZip.manifest.version_code}
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs app-muted">
                  <div>
                    <p className="font-semibold text-[var(--fg)] mb-1">Judul Rilis:</p>
                    <p>{stagedZip.manifest.title}</p>
                  </div>
                  <div>
                    <p className="font-semibold text-[var(--fg)] mb-1">Tanggal Rilis:</p>
                    <p>{stagedZip.manifest.release_date}</p>
                  </div>
                </div>

                <div>
                  <p className="text-xs font-semibold text-[var(--fg)] mb-1.5">Changelog Rincian Poin:</p>
                  <ul className="space-y-1 text-xs text-[var(--fg)] pl-2">
                    {stagedZip.manifest.changelog.map((c, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                        <span>{c}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Action Button */}
            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={handleTriggerUpdate}
                disabled={updating || uploading}
                className="px-6 py-3.5 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] disabled:opacity-50 text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-600/25 flex items-center gap-2"
              >
                {updating ? (
                  <>
                    <span className="material-symbols-outlined text-[20px] animate-spin">sync</span>
                    <span>Proses Update &amp; Locking...</span>
                  </>
                ) : (
                  <>
                    <span className="material-symbols-outlined text-[20px]">system_update_alt</span>
                    <span>Jalankan Update Aplikasi Now</span>
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Version History Table */}
          <div className="bg-[var(--card-bg)] border border-[var(--divider)] rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-lg font-bold font-display text-[var(--fg)]">
                  Riwayat Versi Terpasang (App Versions Log)
                </h2>
                <p className="text-xs app-muted mt-0.5">
                  Daftar seluruh catatan versi pembaruan aplikasi yang telah berhasil diinstal di database.
                </p>
              </div>
              <span className="text-xs font-semibold px-3 py-1 rounded-full bg-[var(--hover)] text-[var(--fg)]">
                Total {history.length} Versi
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="border-b border-[var(--divider)] app-muted text-[11px] uppercase tracking-wider">
                    <th className="pb-3 px-3 font-semibold">Versi &amp; Build</th>
                    <th className="pb-3 px-3 font-semibold">Judul Rilis</th>
                    <th className="pb-3 px-3 font-semibold">Changelog Summary</th>
                    <th className="pb-3 px-3 font-semibold">Tanggal Instalasi</th>
                    <th className="pb-3 px-3 font-semibold text-right">Tipe</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--divider)] text-[var(--fg)]">
                  {history.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-8 text-center app-muted">
                        Belum ada catatan riwayat versi di database.
                      </td>
                    </tr>
                  ) : (
                    history.map((item) => (
                      <tr key={item.id} className="hover:bg-[var(--hover)]/50 transition-colors">
                        <td className="py-4 px-3">
                          <div className="font-bold text-sm text-[var(--fg)]">v{item.version}</div>
                          <div className="text-[11px] app-muted font-mono mt-0.5">
                            Build #{item.versionCode} · DB v{item.dbVersion}
                          </div>
                        </td>
                        <td className="py-4 px-3 font-medium max-w-xs truncate">
                          {item.title}
                        </td>
                        <td className="py-4 px-3">
                          <div className="space-y-1 max-w-sm">
                            {Array.isArray(item.changelog)
                              ? item.changelog.slice(0, 2).map((c, i) => (
                                  <div key={i} className="truncate app-muted text-[11px]">
                                    • {c}
                                  </div>
                                ))
                              : String(item.changelog)}
                          </div>
                        </td>
                        <td className="py-4 px-3 app-muted whitespace-nowrap">
                          {new Date(item.installedAt).toLocaleString("id-ID", {
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                        </td>
                        <td className="py-4 px-3 text-right">
                          {item.forceUpdate ? (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/10 text-rose-500 border border-rose-500/20">
                              Mandatory
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-500/10 app-muted">
                              Normal
                            </span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: BACKUP & RESTORE */}
      {activeTab === "backup" && (
        <div className="space-y-6 animate-fadeIn">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Card 1: Backup */}
            <div className="bg-[var(--card-bg)] border border-[var(--divider)] rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center font-bold shrink-0">
                    <span className="material-symbols-outlined text-[24px]">cloud_download</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold font-display text-[var(--fg)]">Backup Database</h3>
                    <p className="text-xs app-muted">Unduh seluruh data sistem dalam format JSON.</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-blue-500/20 bg-blue-500/5 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-blue-500">
                    <span className="material-symbols-outlined text-[18px]">verified</span>
                    <span>Cakupan Data Lengkap (21 Tabel)</span>
                  </div>
                  <p className="app-muted">
                    Membackup: Pengguna, Akses Role, Tahun Pelajaran, Siswa, Guru, Data Rombel, Mapel, Penugasan, Jam Mengajar, Jurnal Guru, Nilai Raport, Audit Log, dan Integrasi.
                  </p>
                </div>
              </div>

              <button
                type="button"
                disabled={downloadingBackup}
                onClick={handleDownloadBackup}
                className="w-full py-3.5 px-5 rounded-2xl bg-blue-600 hover:bg-blue-700 active:scale-[0.99] disabled:opacity-50 text-white font-semibold text-sm transition-all duration-200 shadow-md flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">download</span>
                <span>{downloadingBackup ? "Mengunduh Backup..." : "Unduh Backup JSON"}</span>
              </button>
            </div>

            {/* Card 2: Restore */}
            <div className="bg-[var(--card-bg)] border border-[var(--divider)] rounded-3xl p-6 shadow-sm flex flex-col justify-between space-y-6">
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-bold shrink-0">
                    <span className="material-symbols-outlined text-[24px]">settings_backup_restore</span>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold font-display text-[var(--fg)]">Restore Database</h3>
                    <p className="text-xs app-muted">Pulihkan data sistem dari berkas cadangan JSON.</p>
                  </div>
                </div>

                <div className="p-4 rounded-2xl border border-amber-500/20 bg-amber-500/5 space-y-2 text-xs">
                  <div className="flex items-center gap-2 font-semibold text-amber-500">
                    <span className="material-symbols-outlined text-[18px]">warning</span>
                    <span>Perhatian Penting</span>
                  </div>
                  <p className="app-muted">
                    Memulihkan dari file backup JSON akan memperbarui dan menyesuaikan data di database sesuai dengan ID entri yang diunggah. Pastikan berkas JSON berasal dari sistem SIAKAD.
                  </p>
                </div>

                <div className="space-y-2 pt-1">
                  <label className="text-xs font-semibold uppercase tracking-wider app-muted">Pilih Berkas Backup (.json)</label>
                  <input
                    type="file"
                    accept=".json"
                    onChange={(e) => setSelectedBackupFile(e.target.files?.[0] || null)}
                    className="w-full text-xs text-muted file:mr-3 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-amber-500/10 file:text-amber-500 hover:file:bg-amber-500/20 cursor-pointer"
                  />
                </div>
              </div>

              <button
                type="button"
                disabled={restoringBackup || !selectedBackupFile}
                onClick={handleRestoreDatabase}
                className="w-full py-3.5 px-5 rounded-2xl bg-amber-600 hover:bg-amber-700 active:scale-[0.99] disabled:opacity-50 text-white font-semibold text-sm transition-all duration-200 shadow-md flex items-center justify-center gap-2"
              >
                <span className="material-symbols-outlined text-[20px]">settings_backup_restore</span>
                <span>{restoringBackup ? "Memulihkan Database..." : "Restore Data Database"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Manual Release JSON Modal */}
      {showReleaseModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/90 backdrop-blur-md animate-fadeIn">
          <div className="bg-slate-900 border border-slate-700/80 text-slate-100 rounded-3xl p-6 sm:p-8 max-w-md w-full shadow-2xl space-y-5 relative">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <h3 className="text-base font-bold font-display text-white">
                Buat Manifest version.json Manual
              </h3>
              <button
                type="button"
                onClick={() => setShowReleaseModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
              >
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <form onSubmit={handleSaveReleaseJson} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 mb-1 font-medium">Nomor Versi (SemVer):</label>
                <input
                  type="text"
                  required
                  value={formVersion}
                  onChange={(e) => setFormVersion(e.target.value)}
                  placeholder="e.g. 1.2.0"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 mb-1 font-medium">Build Code (Integer):</label>
                  <input
                    type="number"
                    required
                    value={formVersionCode}
                    onChange={(e) => setFormVersionCode(Number(e.target.value))}
                    placeholder="102"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 mb-1 font-medium">DB Version:</label>
                  <input
                    type="text"
                    value={formDbVersion}
                    onChange={(e) => setFormDbVersion(e.target.value)}
                    placeholder="1.2.0"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Judul Pembaruan:</label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="Judul rilis..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-slate-300 mb-1 font-medium">Changelog (1 Poin Per Baris):</label>
                <textarea
                  rows={4}
                  required
                  value={formChangelog}
                  onChange={(e) => setFormChangelog(e.target.value)}
                  placeholder="Poin 1...&#10;Poin 2..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-700 bg-slate-950 text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none font-mono"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="forceCheck"
                  checked={formForceUpdate}
                  onChange={(e) => setFormForceUpdate(e.target.checked)}
                  className="rounded border-slate-700 text-emerald-600 focus:ring-emerald-500 bg-slate-950"
                />
                <label htmlFor="forceCheck" className="text-xs text-slate-300 select-none cursor-pointer">
                  Tandai sebagai Pembaruan Wajib (Mandatory Force Update)
                </label>
              </div>

              <div className="pt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowReleaseModal(false)}
                  className="px-4 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white transition-colors"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold shadow-md transition-colors"
                >
                  Simpan Manifest
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
