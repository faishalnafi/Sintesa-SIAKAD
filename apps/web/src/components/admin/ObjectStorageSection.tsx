import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import Swal from "sweetalert2";

export type StorageProviderType = "s3" | "r2" | "gcs" | "generic";

export interface StorageConfigData {
  isActive: boolean;
  provider: StorageProviderType;
  s3: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
    publicUrl?: string;
    forcePathStyle?: boolean;
  };
  r2: {
    accountId: string;
    bucket: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicUrl?: string;
  };
  gcs: {
    bucket: string;
    authMode: "hmac" | "service_account";
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
  };
  generic: {
    name?: string;
    endpoint: string;
    bucket: string;
    region?: string;
    accessKeyId: string;
    secretAccessKey: string;
    publicUrl?: string;
    forcePathStyle?: boolean;
  };
  lastTestedAt?: string | null;
  lastTestedStatus?: "success" | "error" | null;
  lastTestedMessage?: string | null;
}

const DEFAULT_CONFIG: StorageConfigData = {
  isActive: false,
  provider: "r2",
  s3: {
    bucket: "",
    region: "ap-southeast-1",
    accessKeyId: "",
    secretAccessKey: "",
    endpoint: "",
    publicUrl: "",
    forcePathStyle: false,
  },
  r2: {
    accountId: "",
    bucket: "",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
  },
  gcs: {
    bucket: "",
    authMode: "hmac",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
  },
  generic: {
    name: "MinIO",
    endpoint: "http://localhost:9000",
    bucket: "",
    region: "us-east-1",
    accessKeyId: "",
    secretAccessKey: "",
    publicUrl: "",
    forcePathStyle: true,
  },
};

export function ObjectStorageSection() {
  const [config, setConfig] = useState<StorageConfigData>(DEFAULT_CONFIG);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [showSecret, setShowSecret] = useState(false);

  // Fetch current config on mount
  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const res = await api<StorageConfigData>("/admin/storage/config");
      if (res.data) {
        setConfig(res.data);
      }
    } catch (err: any) {
      console.error("Gagal mengambil konfigurasi storage:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleActive = async () => {
    const nextState = !config.isActive;
    const updated = { ...config, isActive: nextState };
    setConfig(updated);

    try {
      await api("/admin/storage/config", {
        method: "POST",
        body: JSON.stringify({ isActive: nextState }),
      });
      Swal.fire({
        icon: "success",
        title: nextState ? "Object Storage Diaktifkan!" : "Penyimpanan Lokal Aktif",
        text: nextState
          ? `File baru yang diunggah akan disimpan langsung ke Cloud (${updated.provider.toUpperCase()}).`
          : "File baru yang diunggah akan disimpan di penyimpanan lokal server.",
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (err: any) {
      setConfig({ ...config, isActive: !nextState });
      Swal.fire({
        icon: "error",
        title: "Gagal Mengubah Status",
        text: err.message,
      });
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const res = await api<StorageConfigData>("/admin/storage/config", {
        method: "POST",
        body: JSON.stringify(config),
      });
      if (res.data) {
        setConfig(res.data);
      }
      Swal.fire({
        icon: "success",
        title: "Berhasil Disimpan",
        text: res.message || "Konfigurasi Object Storage berhasil diperbarui.",
        timer: 2000,
        showConfirmButton: false,
      });
    } catch (err: any) {
      Swal.fire({
        icon: "error",
        title: "Gagal Menyimpan",
        text: err.message,
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setTesting(true);
    try {
      const res = await api<{ success: boolean; message: string }>("/admin/storage/test", {
        method: "POST",
        body: JSON.stringify({
          provider: config.provider,
          config,
        }),
      });

      Swal.fire({
        icon: res.success ? "success" : "error",
        title: res.success ? "Koneksi Berhasil!" : "Koneksi Gagal",
        text: res.message,
      });

      // Refresh test status in state
      setConfig((prev) => ({
        ...prev,
        lastTestedAt: new Date().toISOString(),
        lastTestedStatus: res.success ? "success" : "error",
        lastTestedMessage: res.message,
      }));
    } catch (err: any) {
      Swal.fire({
        icon: "error",
        title: "Gagal Menghubungkan",
        text: err.message || "Terjadi kesalahan saat menguji koneksi.",
      });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return (
      <Card className="p-6 border space-y-4" style={{ borderColor: "var(--divider)" }}>
        <Skeleton className="h-6 w-60" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-48 w-full" />
      </Card>
    );
  }

  return (
    <Card className="p-5 sm:p-6 border space-y-6 overflow-hidden" style={{ borderColor: "var(--divider)" }}>
      {/* ─── Top Header & Master Toggle ─────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b" style={{ borderColor: "var(--divider)" }}>
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-sky-500/10 text-sky-600 dark:text-sky-400 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-[22px]">cloud_upload</span>
            </div>
            <div>
              <h2 className="font-display font-bold text-base sm:text-lg text-[var(--fg)]">
                Konfigurasi Cloud Object Storage
              </h2>
              <p className="text-xs app-muted mt-0.5">
                Simpan semua berkas unggahan (Excel nilai, lampiran jurnal, foto) ke cloud bucket alih-alih server lokal.
              </p>
            </div>
          </div>
        </div>

        {/* Master Toggle Pill Button */}
        <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
          <div className="text-right">
            <div className="text-xs font-bold" style={{ color: config.isActive ? "var(--accent)" : "var(--muted)" }}>
              {config.isActive ? "Object Storage AKTIF" : "Penyimpanan Lokal"}
            </div>
            <div className="text-[10px] app-muted">
              {config.isActive ? `Cloud: ${config.provider.toUpperCase()}` : "Folder lokal server"}
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleActive}
            className={`relative inline-flex h-7 w-13 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
              config.isActive ? "bg-[var(--accent)]" : "bg-slate-300 dark:bg-slate-700"
            }`}
            title="Klik untuk menyalakan/mematikan Object Storage"
          >
            <span
              className={`pointer-events-none inline-block h-6 w-6 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                config.isActive ? "translate-x-6" : "translate-x-0"
              }`}
            />
          </button>
        </div>
      </div>

      {/* ─── Provider Selection Cards ────────────────────────────────────── */}
      <div className="space-y-2">
        <label className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
          Pilih Penyedia Cloud Object Storage:
        </label>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {/* Cloudflare R2 */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, provider: "r2" })}
            className={`p-3.5 rounded-xl border text-left flex flex-col gap-2 transition-all cursor-pointer ${
              config.provider === "r2"
                ? "border-amber-500 bg-amber-500/10 ring-2 ring-amber-500/30"
                : "border-[var(--input-border)] hover:bg-[var(--hover)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-[24px] text-amber-500">bolt</span>
              {config.provider === "r2" && (
                <span className="material-symbols-outlined text-[18px] text-amber-500">check_circle</span>
              )}
            </div>
            <div>
              <div className="font-bold text-xs text-[var(--fg)]">Cloudflare R2</div>
              <div className="text-[10px] app-muted">Bebas biaya egress (0$ Bandwidth)</div>
            </div>
          </button>

          {/* Amazon S3 */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, provider: "s3" })}
            className={`p-3.5 rounded-xl border text-left flex flex-col gap-2 transition-all cursor-pointer ${
              config.provider === "s3"
                ? "border-orange-500 bg-orange-500/10 ring-2 ring-orange-500/30"
                : "border-[var(--input-border)] hover:bg-[var(--hover)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-[24px] text-orange-500">deployed_code</span>
              {config.provider === "s3" && (
                <span className="material-symbols-outlined text-[18px] text-orange-500">check_circle</span>
              )}
            </div>
            <div>
              <div className="font-bold text-xs text-[var(--fg)]">Amazon S3 (AWS)</div>
              <div className="text-[10px] app-muted">Standar industri global</div>
            </div>
          </button>

          {/* Google Cloud Storage (GCS) */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, provider: "gcs" })}
            className={`p-3.5 rounded-xl border text-left flex flex-col gap-2 transition-all cursor-pointer ${
              config.provider === "gcs"
                ? "border-blue-500 bg-blue-500/10 ring-2 ring-blue-500/30"
                : "border-[var(--input-border)] hover:bg-[var(--hover)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-[24px] text-blue-500">cloud</span>
              {config.provider === "gcs" && (
                <span className="material-symbols-outlined text-[18px] text-blue-500">check_circle</span>
              )}
            </div>
            <div>
              <div className="font-bold text-xs text-[var(--fg)]">Google Cloud (GCS)</div>
              <div className="text-[10px] app-muted">Interoperabilitas HMAC S3</div>
            </div>
          </button>

          {/* S3-Compatible / Generic */}
          <button
            type="button"
            onClick={() => setConfig({ ...config, provider: "generic" })}
            className={`p-3.5 rounded-xl border text-left flex flex-col gap-2 transition-all cursor-pointer ${
              config.provider === "generic"
                ? "border-emerald-500 bg-emerald-500/10 ring-2 ring-emerald-500/30"
                : "border-[var(--input-border)] hover:bg-[var(--hover)]"
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="material-symbols-outlined text-[24px] text-emerald-500">dns</span>
              {config.provider === "generic" && (
                <span className="material-symbols-outlined text-[18px] text-emerald-500">check_circle</span>
              )}
            </div>
            <div>
              <div className="font-bold text-xs text-[var(--fg)]">S3-Compatible / Umum</div>
              <div className="text-[10px] app-muted">MinIO, Wasabi, Spaces, B2</div>
            </div>
          </button>
        </div>
      </div>

      {/* ─── Provider Configuration Form ─────────────────────────────────── */}
      <div className="p-4 rounded-2xl bg-[var(--hover)] border space-y-4" style={{ borderColor: "var(--divider)" }}>
        <div className="flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--fg)] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[18px]">settings</span>
            Parameter Kredensial: {config.provider.toUpperCase()}
          </span>

          <button
            type="button"
            onClick={() => setShowSecret(!showSecret)}
            className="text-xs app-muted hover:text-[var(--fg)] flex items-center gap-1 cursor-pointer"
          >
            <span className="material-symbols-outlined text-[16px]">
              {showSecret ? "visibility_off" : "visibility"}
            </span>
            {showSecret ? "Sembunyikan Kunci" : "Tampilkan Kunci"}
          </button>
        </div>

        {/* 1. CLOUDFLARE R2 FORM */}
        {config.provider === "r2" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Cloudflare Account ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: d7a8b3f120e5c94..."
                value={config.r2.accountId}
                onChange={(e) =>
                  setConfig({ ...config, r2: { ...config.r2, accountId: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                R2 Bucket Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: simak-storage"
                value={config.r2.bucket}
                onChange={(e) =>
                  setConfig({ ...config, r2: { ...config.r2, bucket: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                R2 Access Key ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Access Key ID R2"
                value={config.r2.accessKeyId}
                onChange={(e) =>
                  setConfig({ ...config, r2: { ...config.r2, accessKeyId: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                R2 Secret Access Key <span className="text-red-500">*</span>
              </label>
              <input
                type={showSecret ? "text" : "password"}
                placeholder="Secret Access Key R2"
                value={config.r2.secretAccessKey}
                onChange={(e) =>
                  setConfig({ ...config, r2: { ...config.r2, secretAccessKey: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div className="md:col-span-2">
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Public Domain URL / Custom CDN (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: https://cdn.sekolah.sch.id atau https://pub-xxx.r2.dev"
                value={config.r2.publicUrl || ""}
                onChange={(e) =>
                  setConfig({ ...config, r2: { ...config.r2, publicUrl: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
              <span className="text-[10px] app-muted mt-1 block">
                Jika diisi, URL file yang diunggah akan menggunakan domain ini secara publik.
              </span>
            </div>
          </div>
        )}

        {/* 2. AMAZON S3 FORM */}
        {config.provider === "s3" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                S3 Bucket Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: s3-simak-storage"
                value={config.s3.bucket}
                onChange={(e) =>
                  setConfig({ ...config, s3: { ...config.s3, bucket: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                AWS Region <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: ap-southeast-1 atau ap-southeast-3"
                value={config.s3.region}
                onChange={(e) =>
                  setConfig({ ...config, s3: { ...config.s3, region: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                AWS Access Key ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="AKIA..."
                value={config.s3.accessKeyId}
                onChange={(e) =>
                  setConfig({ ...config, s3: { ...config.s3, accessKeyId: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                AWS Secret Access Key <span className="text-red-500">*</span>
              </label>
              <input
                type={showSecret ? "text" : "password"}
                placeholder="Secret Access Key AWS"
                value={config.s3.secretAccessKey}
                onChange={(e) =>
                  setConfig({ ...config, s3: { ...config.s3, secretAccessKey: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div className="md:col-span-2">
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Public URL / CloudFront CDN (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: https://d111111abcdef8.cloudfront.net"
                value={config.s3.publicUrl || ""}
                onChange={(e) =>
                  setConfig({ ...config, s3: { ...config.s3, publicUrl: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>
          </div>
        )}

        {/* 3. GOOGLE CLOUD STORAGE FORM */}
        {config.provider === "gcs" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div className="md:col-span-2">
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                GCS Bucket Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: simak-gcs-bucket"
                value={config.gcs.bucket}
                onChange={(e) =>
                  setConfig({ ...config, gcs: { ...config.gcs, bucket: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Google Cloud HMAC Access ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="GOOG..."
                value={config.gcs.accessKeyId || ""}
                onChange={(e) =>
                  setConfig({ ...config, gcs: { ...config.gcs, accessKeyId: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Google Cloud HMAC Secret <span className="text-red-500">*</span>
              </label>
              <input
                type={showSecret ? "text" : "password"}
                placeholder="HMAC Secret Key Google Cloud"
                value={config.gcs.secretAccessKey || ""}
                onChange={(e) =>
                  setConfig({ ...config, gcs: { ...config.gcs, secretAccessKey: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div className="md:col-span-2">
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Public Domain / CDN URL (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: https://storage.googleapis.com/simak-gcs-bucket"
                value={config.gcs.publicUrl || ""}
                onChange={(e) =>
                  setConfig({ ...config, gcs: { ...config.gcs, publicUrl: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>
          </div>
        )}

        {/* 4. S3-COMPATIBLE / GENERIC FORM */}
        {config.provider === "generic" && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5 text-xs">
            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Label / Nama Provider
              </label>
              <input
                type="text"
                placeholder="Contoh: MinIO Local / Wasabi / DigitalOcean Spaces"
                value={config.generic.name || ""}
                onChange={(e) =>
                  setConfig({ ...config, generic: { ...config.generic, name: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                S3 Endpoint URL <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Contoh: http://localhost:9000 atau https://s3.wasabisys.com"
                value={config.generic.endpoint}
                onChange={(e) =>
                  setConfig({ ...config, generic: { ...config.generic, endpoint: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Bucket Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Nama Bucket"
                value={config.generic.bucket}
                onChange={(e) =>
                  setConfig({ ...config, generic: { ...config.generic, bucket: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Region (Opsional)
              </label>
              <input
                type="text"
                placeholder="us-east-1"
                value={config.generic.region || ""}
                onChange={(e) =>
                  setConfig({ ...config, generic: { ...config.generic, region: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Access Key ID <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                placeholder="Access Key ID"
                value={config.generic.accessKeyId}
                onChange={(e) =>
                  setConfig({ ...config, generic: { ...config.generic, accessKeyId: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div>
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Secret Access Key <span className="text-red-500">*</span>
              </label>
              <input
                type={showSecret ? "text" : "password"}
                placeholder="Secret Access Key"
                value={config.generic.secretAccessKey}
                onChange={(e) =>
                  setConfig({ ...config, generic: { ...config.generic, secretAccessKey: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] font-mono text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>

            <div className="md:col-span-2">
              <label className="font-medium text-slate-600 dark:text-slate-300 block mb-1">
                Public URL / Custom Domain (Opsional)
              </label>
              <input
                type="text"
                placeholder="Contoh: https://storage.domainanda.com"
                value={config.generic.publicUrl || ""}
                onChange={(e) =>
                  setConfig({ ...config, generic: { ...config.generic, publicUrl: e.target.value } })
                }
                className="w-full px-3 py-2 rounded-xl border bg-white dark:bg-zinc-900 text-[var(--fg)] focus:outline-none focus:border-[var(--accent)] text-xs"
                style={{ borderColor: "var(--input-border)" }}
              />
            </div>
          </div>
        )}
      </div>

      {/* ─── Last Tested Status Banner ─────────────────────────────────── */}
      {config.lastTestedAt && (
        <div
          className={`p-3 rounded-xl border flex items-center justify-between gap-3 text-xs ${
            config.lastTestedStatus === "success"
              ? "bg-emerald-50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300"
              : "bg-red-50 dark:bg-red-950/20 border-red-200 dark:border-red-800 text-red-800 dark:text-red-300"
          }`}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="material-symbols-outlined text-[18px] shrink-0">
              {config.lastTestedStatus === "success" ? "check_circle" : "error"}
            </span>
            <span className="truncate">{config.lastTestedMessage || "Tes koneksi selesai."}</span>
          </div>
          <span className="text-[10px] opacity-80 shrink-0 font-mono">
            {new Date(config.lastTestedAt).toLocaleTimeString("id-ID")}
          </span>
        </div>
      )}

      {/* ─── Bottom Actions ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
        <div className="text-xs app-muted flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px] text-sky-500">info</span>
          Perubahan konfigurasi langsung berlaku secara realtime tanpa perlu restart aplikasi.
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <Button
            size="sm"
            variant="secondary"
            disabled={testing || saving}
            onClick={handleTestConnection}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs"
          >
            <span className="material-symbols-outlined text-[16px]">
              {testing ? "sync" : "electrical_services"}
            </span>
            {testing ? "Menguji..." : "Tes Koneksi"}
          </Button>

          <Button
            size="sm"
            variant="primary"
            disabled={saving || testing}
            onClick={handleSaveConfig}
            className="flex items-center gap-1.5 px-4 py-2 text-xs shadow-sm"
          >
            <span className="material-symbols-outlined text-[16px]">save</span>
            {saving ? "Menyimpan..." : "Simpan Konfigurasi"}
          </Button>
        </div>
      </div>
    </Card>
  );
}
