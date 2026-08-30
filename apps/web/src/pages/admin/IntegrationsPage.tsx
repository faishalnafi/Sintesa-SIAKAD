import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";

type Runtime = {
  code: string;
  status: string;
  configured?: boolean;
  message?: string;
  baseUrl?: string | null;
};

type CatalogItem = {
  code: string;
  name: string;
  shortName: string;
  description: string;
  ownsFields: string[];
  status: string;
  icon: string;
  runtime?: Runtime;
};

type SyncLogPayload = {
  message?: string;
  total?: number;
  success?: number;
  failed?: number;
  fieldsImported?: string[];
  errors?: Array<{ id: string; message: string }>;
};

type SyncLog = {
  id: string;
  source: string;
  status: string;
  createdAt: string;
  payloadSummary?: SyncLogPayload | null;
};

type SsoConfig = {
  loginConfigured: boolean;
  apiKeyConfigured: boolean;
  baseUrl: string | null;
  clientId: string | null;
  redirectUri: string | null;
  apiBaseUrl: string | null;
};

type SsoSyncResult = {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
};

// ─── Input Field Component ────────────────────────────────────────────────────
function Field({
  label,
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="app-label text-[12px] font-semibold">
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-xl px-3.5 py-2.5 text-sm border transition-colors focus:outline-none focus:ring-2"
        style={{
          background: "var(--surface)",
          borderColor: "var(--input-border)",
          color: "var(--fg)",
        }}
      />
      {hint && <p className="text-[11px] app-muted leading-snug">{hint}</p>}
    </div>
  );
}

// ─── Unified Modal for SSO Save & Sync Progress/Result ────────────────────────
function UnifiedSsoModal({
  isOpen,
  loading,
  loadingStep,
  saveResult,
  testStatus,
  syncResult,
  syncError,
  onClose,
}: {
  isOpen: boolean;
  loading: boolean;
  loadingStep?: string;
  saveResult?: { success: boolean; message: string } | null;
  testStatus?: { connected: boolean; info?: string } | null;
  syncResult?: SsoSyncResult | null;
  syncError?: string | null;
  onClose: () => void;
}) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-lg rounded-2xl p-6 border shadow-2xl flex flex-col gap-5 text-left animate-scaleUp max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--bg)", borderColor: "var(--divider)", color: "var(--fg)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--divider)" }}>
          <div className="flex items-center gap-3">
            <span
              className="w-10 h-10 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: "var(--accent-soft)" }}
            >
              <span className="material-symbols-outlined text-[var(--accent)] text-[22px]">
                hub
              </span>
            </span>
            <div>
              <h3 className="font-display font-bold text-base">Status Integrasi &amp; Sinkronisasi SSO</h3>
              <p className="text-xs app-muted">Kredensia Portal Otentikasi &amp; Identitas Terpusat</p>
            </div>
          </div>
          {!loading && (
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 rounded-lg flex items-center justify-center app-muted hover:bg-[var(--hover)]"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        {/* Loading Spinner State */}
        {loading ? (
          <div className="py-10 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full border-4 border-[var(--accent-soft)] border-t-[var(--accent)] animate-spin" />
            <div>
              <h4 className="font-bold text-base">Sedang Memproses...</h4>
              <p className="text-xs app-muted mt-1 max-w-xs leading-relaxed">
                {loadingStep || "Menyimpan konfigurasi, menguji koneksi, dan menyinkronkan data dari Kredensia SSO."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Section 1: Konfigurasi & Koneksi Portal SSO */}
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase tracking-wider app-muted flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-[var(--accent)]">settings</span>
                1. Konfigurasi &amp; Koneksi Portal SSO
              </p>

              {/* Status .env */}
              {saveResult && (
                <div
                  className="rounded-xl p-3.5 border flex items-start gap-3 text-xs"
                  style={{
                    background: saveResult.success
                      ? "var(--accent-soft)"
                      : "color-mix(in srgb, #ef4444 12%, transparent)",
                    borderColor: saveResult.success
                      ? "var(--accent-soft)"
                      : "color-mix(in srgb, #ef4444 25%, transparent)",
                  }}
                >
                  <span
                    className="material-symbols-outlined text-[18px] shrink-0 mt-0.5"
                    style={{ color: saveResult.success ? "var(--accent)" : "#ef4444" }}
                  >
                    {saveResult.success ? "check_circle" : "error"}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold" style={{ color: saveResult.success ? "var(--accent)" : "#ef4444" }}>
                      {saveResult.success ? "Simpan File .env: BERHASIL" : "Simpan File .env: GAGAL"}
                    </p>
                    <p className="app-muted mt-0.5 leading-relaxed">{saveResult.message}</p>
                  </div>
                </div>
              )}

              {/* Status Connection Test */}
              {testStatus && (
                <div
                  className="rounded-xl p-3.5 border flex items-start gap-3 text-xs"
                  style={{
                    background: testStatus.connected
                      ? "var(--accent-soft)"
                      : "color-mix(in srgb, #ef4444 12%, transparent)",
                    borderColor: testStatus.connected
                      ? "var(--accent-soft)"
                      : "color-mix(in srgb, #ef4444 25%, transparent)",
                  }}
                >
                  <span
                    className="material-symbols-outlined text-[18px] shrink-0 mt-0.5"
                    style={{ color: testStatus.connected ? "var(--accent)" : "#ef4444" }}
                  >
                    {testStatus.connected ? "verified" : "cloud_off"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-semibold" style={{ color: testStatus.connected ? "var(--accent)" : "#ef4444" }}>
                        {testStatus.connected ? "Koneksi API Key SSO: TERHUBUNG" : "Koneksi API Key SSO: GAGAL"}
                      </p>
                      <Badge status={testStatus.connected ? "success" : "incomplete"}>
                        {testStatus.connected ? "Terhubung" : "Gagal"}
                      </Badge>
                    </div>
                    <p className="app-muted mt-0.5 leading-relaxed">{testStatus.info}</p>
                  </div>
                </div>
              )}
            </div>

            {/* Section 2: Sinkronisasi Data Pengguna / Siswa */}
            <div className="space-y-3 border-t pt-4" style={{ borderColor: "var(--divider)" }}>
              <p className="text-xs font-bold uppercase tracking-wider app-muted flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px] text-[var(--accent)]">sync</span>
                2. Sinkronisasi Data Pengguna &amp; Siswa
              </p>

              {syncError ? (
                <div
                  className="rounded-xl p-3.5 border flex items-start gap-3 text-xs"
                  style={{
                    background: "color-mix(in srgb, #ef4444 12%, transparent)",
                    borderColor: "color-mix(in srgb, #ef4444 25%, transparent)",
                    color: "#ef4444",
                  }}
                >
                  <span className="material-symbols-outlined text-[18px] shrink-0 mt-0.5">error</span>
                  <div>
                    <p className="font-semibold">Sinkronisasi Data Gagal</p>
                    <p className="text-xs opacity-90 mt-0.5">{syncError}</p>
                  </div>
                </div>
              ) : syncResult ? (
                <div className="space-y-3">
                  {/* Metrics Row */}
                  <div className="grid grid-cols-3 gap-2.5">
                    <div
                      className="rounded-xl p-3 text-center border"
                      style={{ background: "var(--hover)", borderColor: "var(--divider)" }}
                    >
                      <p className="app-label text-[10px]">Total Data</p>
                      <p className="font-display font-bold text-lg mt-0.5">{syncResult.total}</p>
                    </div>
                    <div
                      className="rounded-xl p-3 text-center border"
                      style={{
                        background: "var(--accent-soft)",
                        borderColor: "var(--accent-soft)",
                      }}
                    >
                      <p className="app-label text-[10px]" style={{ color: "var(--accent)" }}>
                        Berhasil
                      </p>
                      <p className="font-display font-bold text-lg mt-0.5" style={{ color: "var(--accent)" }}>
                        {syncResult.success}
                      </p>
                    </div>
                    <div
                      className="rounded-xl p-3 text-center border"
                      style={{
                        background:
                          syncResult.failed > 0
                            ? "color-mix(in srgb, #ef4444 12%, transparent)"
                            : "var(--hover)",
                        borderColor:
                          syncResult.failed > 0
                            ? "color-mix(in srgb, #ef4444 30%, transparent)"
                            : "var(--divider)",
                      }}
                    >
                      <p className="app-label text-[10px]" style={{ color: syncResult.failed > 0 ? "#ef4444" : undefined }}>
                        Gagal
                      </p>
                      <p className="font-display font-bold text-lg mt-0.5" style={{ color: syncResult.failed > 0 ? "#ef4444" : undefined }}>
                        {syncResult.failed}
                      </p>
                    </div>
                  </div>

                  {/* Field Tags */}
                  <div className="rounded-xl p-3 text-xs border space-y-1.5" style={{ background: "var(--hover)", borderColor: "var(--divider)" }}>
                    <p className="app-label text-[10px]">Field Yang Berhasil Disinkronkan:</p>
                    <div className="flex flex-wrap gap-1">
                      {[
                        "nama_lengkap",
                        "email",
                        "nik",
                        "nip_nis",
                        "jk",
                        "no_telp",
                        "tgl_lahir",
                        "is_active",
                        "claimed_at",
                        "roles",
                      ].map((f) => (
                        <span
                          key={f}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-white/10"
                          style={{ color: "var(--muted)" }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </div>

                  {/* Errors Breakdown */}
                  {syncResult.errors.length > 0 && (
                    <div className="space-y-1.5 text-xs">
                      <p className="font-semibold text-error text-[11px]">Detail Data Gagal ({syncResult.errors.length}):</p>
                      <div
                        className="max-h-32 overflow-y-auto rounded-xl p-3 border font-mono text-[11px] space-y-1"
                        style={{ background: "var(--hover)", borderColor: "var(--divider)" }}
                      >
                        {syncResult.errors.map((err, idx) => (
                          <div key={idx} className="text-error truncate">
                            • [{err.id.slice(0, 8)}] {err.message}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            <Button size="sm" variant="primary" onClick={onClose} className="w-full mt-2">
              Selesai &amp; Tutup
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SSO Config Card ──────────────────────────────────────────────────────────
function SsoConfigCard({
  ssoConfig,
  onReload,
}: {
  ssoConfig: SsoConfig | null;
  onReload: () => void;
}) {
  const [url, setUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [copiedCallback, setCopiedCallback] = useState(false);

  // Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);
  const [loadingStep, setLoadingStep] = useState("");
  const [saveResult, setSaveResult] = useState<{ success: boolean; message: string } | null>(null);
  const [testResult, setTestResult] = useState<{ connected: boolean; info?: string } | null>(null);
  const [syncResult, setSyncResult] = useState<SsoSyncResult | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [rosterSyncLoading, setRosterSyncLoading] = useState(false);
  const [rosterSyncResult, setRosterSyncResult] = useState<{ message: string; totalUpdated: number } | null>(null);
  const [rosterSyncError, setRosterSyncError] = useState<string | null>(null);

  const callbackUrl = `${window.location.origin}/auth/callback`;

  useEffect(() => {
    if (ssoConfig) {
      setUrl(ssoConfig.baseUrl || "");
      setClientId(ssoConfig.clientId || "");
      setApiBaseUrl(ssoConfig.apiBaseUrl || "");
    }
  }, [ssoConfig]);

  const copyCallbackUrl = () => {
    navigator.clipboard.writeText(callbackUrl);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 2000);
  };

  // Full unified Save + Connection Test + Data Sync flow
  const handleSaveAndSync = async () => {
    if (!url.trim()) return alert("URL SSO wajib diisi.");
    if (!clientId.trim()) return alert("Client ID wajib diisi.");

    setModalOpen(true);
    setModalLoading(true);
    setLoadingStep("1/2: Menyimpan konfigurasi & menguji koneksi API...");
    setSaveResult(null);
    setTestResult(null);
    setSyncResult(null);
    setSyncError(null);

    let saveOk = false;

    try {
      const res = await api<{ message: string }>("/admin/integrations/sso-config", {
        method: "PUT",
        body: JSON.stringify({
          baseUrl: url.trim(),
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
          apiKey: apiKey.trim(),
          apiBaseUrl: apiBaseUrl.trim(),
        }),
      });

      saveOk = true;
      setSaveResult({ success: true, message: res.message || "Konfigurasi SSO disimpan ke .env" });

      // Test SSO connection
      try {
        const testRes = await api<{ data?: { status?: string }; meta?: { app_name?: string } }>("/admin/sso/test");
        if (testRes.success) {
          setTestResult({
            connected: true,
            info: `Terhubung ke Kredensia API (Aplikasi: ${testRes.data?.meta?.app_name || "OK"})`,
          });
        }
      } catch (err) {
        setTestResult({
          connected: false,
          info: err instanceof Error ? err.message : "Tidak dapat terhubung ke SSO API",
        });
      }

      setClientSecret("");
      setApiKey("");
    } catch (e) {
      setSaveResult({
        success: false,
        message: e instanceof Error ? e.message : "Gagal menyimpan konfigurasi.",
      });
    }

    // Step 2: Data sync
    if (saveOk) {
      setLoadingStep("2/2: Menarik dan menyinkronkan data pengguna dari Kredensia SSO...");
      try {
        const syncRes = await api<SsoSyncResult>("/admin/sso/sync-members", { method: "POST" });
        if (syncRes.data) {
          setSyncResult(syncRes.data);
        } else {
          setSyncError(syncRes.message || "Gagal menyinkronkan data");
        }
      } catch (err) {
        setSyncError(err instanceof Error ? err.message : "Koneksi API Key SSO belum valid / gagal sync");
      }
    } else {
      setSyncError("Sinkronisasi dilewati karena penyimpanan .env gagal.");
    }

    setModalLoading(false);
    onReload();
  };

  // Sync data only
  const handleSyncOnly = async () => {
    setModalOpen(true);
    setModalLoading(true);
    setLoadingStep("Menarik data pengguna dari Kredensia SSO...");
    setSaveResult(null);
    setTestResult(null);
    setSyncResult(null);
    setSyncError(null);

    try {
      const syncRes = await api<SsoSyncResult>("/admin/sso/sync-members", { method: "POST" });
      if (syncRes.data) {
        setSyncResult(syncRes.data);
      } else {
        setSyncError(syncRes.message || "Gagal menyinkronkan data");
      }
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : "Gagal menyinkronkan data pengguna");
    } finally {
      setModalLoading(false);
      onReload();
    }
  };

  // Sync class rosters (kelasLabel + classId per student)
  const handleSyncRoster = async () => {
    setRosterSyncLoading(true);
    setRosterSyncResult(null);
    setRosterSyncError(null);
    try {
      const res = await api<{ message: string; totalUpdated: number }>("/admin/sso/sync-kelas-roster", { method: "POST" });
      if (res.data) {
        setRosterSyncResult(res.data);
      } else {
        setRosterSyncError(res.message || "Gagal sync roster kelas");
      }
    } catch (e) {
      setRosterSyncError(e instanceof Error ? e.message : "Gagal sync roster kelas");
    } finally {
      setRosterSyncLoading(false);
    }
  };

  const isLive = ssoConfig?.loginConfigured;
  const hasApiKey = ssoConfig?.apiKeyConfigured;

  return (
    <>
      <Card className="p-6 flex flex-col gap-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span
              className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
              style={{ background: "var(--accent-soft)" }}
            >
              <span className="material-symbols-outlined text-[var(--accent)]">lock_person</span>
            </span>
            <div>
              <div className="font-display font-bold text-sm">Kredensia SSO</div>
              <div className="text-[11px] app-muted">Single Sign-On &amp; Manajemen Identitas</div>
            </div>
          </div>
          <div className="flex gap-2">
            <Badge status={isLive ? "success" : "incomplete"}>
              {isLive ? "Login Terhubung" : "Login Belum Diconfig"}
            </Badge>
            <Badge status={hasApiKey ? "success" : "draft"}>
              {hasApiKey ? "API Key Aktif" : "API Key Kosong"}
            </Badge>
          </div>
        </div>

        <p className="text-sm app-muted leading-relaxed">
          Hubungkan SIAKAD dengan portal SSO sekolah (Kredensia) untuk login terpusat dan impor data
          pengguna, tahun pelajaran, serta rombel.
        </p>

        {/* Callback URL Notice Card */}
        <div
          className="rounded-2xl p-4 border flex flex-col gap-2"
          style={{ background: "var(--hover)", borderColor: "var(--accent-soft)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">link</span>
              URL Callback Login SSO (Redirect URI)
            </span>
            <button
              type="button"
              onClick={copyCallbackUrl}
              className="px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 shrink-0"
              style={{ background: "var(--surface)", borderColor: "var(--input-border)" }}
            >
              <span className="material-symbols-outlined text-[14px]">
                {copiedCallback ? "check" : "content_copy"}
              </span>
              {copiedCallback ? "Tersalin!" : "Salin URL"}
            </button>
          </div>
          <code className="text-xs font-mono px-3 py-2 rounded-xl bg-[var(--surface)] border block truncate select-all" style={{ borderColor: "var(--input-border)" }}>
            {callbackUrl}
          </code>
          <p className="text-[11px] app-muted leading-snug">
            Daftarkan URL callback di atas pada field <strong>Login Callback URL</strong> saat mendaftarkan SIAKAD di portal Kredensia SSO.
          </p>
        </div>

        {/* Section 1 — SSO Login */}
        <div className="flex flex-col gap-4">
          <div
            className="px-4 py-2.5 rounded-xl flex items-center gap-2"
            style={{ background: "var(--hover)" }}
          >
            <span className="material-symbols-outlined text-[16px] text-[var(--accent)]">
              login
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider app-muted">
              Konfigurasi Login SSO
            </span>
          </div>
          <Field
            id="sso-url"
            label="URL Portal SSO"
            value={url}
            onChange={setUrl}
            placeholder="https://sso.sekolah.sch.id"
            hint="URL dasar portal Kredensia tanpa trailing slash."
          />
          <Field
            id="sso-client-id"
            label="Client ID (UUID Aplikasi)"
            value={clientId}
            onChange={setClientId}
            placeholder="019f7d42-6977-7053-853f-4707fa9ea7cf"
            hint="UUID aplikasi SIAKAD yang terdaftar di panel Manajemen Aplikasi Kredensia."
          />
          <Field
            id="sso-client-secret"
            label="Client Secret"
            type="password"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder="Kosongkan jika tidak ingin mengubah"
            hint="Biarkan kosong jika tidak ingin mengubah secret yang sudah tersimpan."
          />
        </div>

        {/* Section 2 — API Data Import */}
        <div className="flex flex-col gap-4">
          <div
            className="px-4 py-2.5 rounded-xl flex items-center gap-2"
            style={{ background: "var(--hover)" }}
          >
            <span className="material-symbols-outlined text-[16px] text-[var(--accent)]">
              api
            </span>
            <span className="text-xs font-semibold uppercase tracking-wider app-muted">
              Kredensial API Impor Data
            </span>
          </div>
          <p className="text-xs app-muted leading-relaxed -mt-2">
            Digunakan untuk menarik data <strong>Pengguna</strong>, <strong>Tahun Pelajaran</strong>,
            dan <strong>Rombel</strong> dari SSO. Buat API Key di{" "}
            <strong>Dashboard Kredensia → Kunci API</strong>.
          </p>
          <Field
            id="sso-api-base-url"
            label="URL Base API SSO"
            value={apiBaseUrl}
            onChange={setApiBaseUrl}
            placeholder="https://sso.sekolah.sch.id/api/v1"
            hint="Otomatis terisi <URL SSO>/api/v1 jika dikosongkan. Ubah hanya jika berbeda."
          />
          <Field
            id="sso-api-key"
            label="API Key (X-API-Key)"
            type="password"
            value={apiKey}
            onChange={setApiKey}
            placeholder={
              hasApiKey
                ? "•••••• (sudah diisi — kosongkan jika tidak ingin mengubah)"
                : "sso_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
            }
            hint={
              hasApiKey
                ? "API Key sudah tersimpan. Kosongkan jika tidak ingin mengubah."
                : "API Key dari menu Kunci API di portal Kredensia (prefix: sso_)."
            }
          />
        </div>

        {/* Action Buttons */}
        <div className="pt-2 flex flex-col sm:flex-row gap-3">
          <Button size="sm" variant="primary" onClick={handleSaveAndSync} className="flex-1">
            <span className="material-symbols-outlined text-[18px]">save</span>
            Simpan Konfigurasi &amp; Sinkronkan Data SSO
          </Button>

          <Button
            size="sm"
            variant="secondary"
            onClick={handleSyncOnly}
            disabled={!hasApiKey && !apiKey}
            className="flex-1"
          >
            <span className="material-symbols-outlined text-[18px]">cloud_download</span>
            Hanya Sinkronkan Data SSO
          </Button>
        </div>
      </Card>

      {/* Unified Status Modal */}
      <UnifiedSsoModal
        isOpen={modalOpen}
        loading={modalLoading}
        loadingStep={loadingStep}
        saveResult={saveResult}
        testStatus={testResult}
        syncResult={syncResult}
        syncError={syncError}
        onClose={() => setModalOpen(false)}
      />
    </>
  );
}

function GoogleOAuthCard() {
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  const googleCallbackUrl = `${window.location.origin}/auth/google/callback`;

  useEffect(() => {
    api<{ configured: boolean; clientId: string | null; hasSecret: boolean }>("/admin/integrations/google-config")
      .then((res) => {
        if (res.data) {
          setConfigured(res.data.configured);
          if (res.data.clientId) setClientId(res.data.clientId);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clientId.trim()) return alert("Google Client ID wajib diisi.");
    setSaving(true);
    try {
      const res = await api<{ success: boolean; message: string }>("/admin/integrations/google-config", {
        method: "PUT",
        body: JSON.stringify({
          clientId: clientId.trim(),
          clientSecret: clientSecret.trim(),
        }),
      });
      if (res.success) {
        alert(res.message || "Konfigurasi Google OAuth berhasil disimpan!");
        setConfigured(true);
        setClientSecret("");
      } else {
        alert(res.message || "Gagal menyimpan konfigurasi.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menyimpan konfigurasi Google OAuth.");
    } finally {
      setSaving(false);
    }
  };

  const copyRedirectUri = () => {
    navigator.clipboard.writeText(googleCallbackUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card className="p-6 flex flex-col gap-5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "rgba(66, 133, 244, 0.1)" }}
          >
            <svg className="w-6 h-6" viewBox="0 0 24 24">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
          </span>
          <div>
            <div className="font-display font-bold text-sm">Masuk dengan Google (OAuth 2.0)</div>
            <div className="text-[11px] app-muted">Otentikasi Akun Google Siswa, Guru, &amp; Staf</div>
          </div>
        </div>
        <Badge status={configured ? "success" : "incomplete"}>
          {configured ? "Google Terhubung" : "Belum Dikonfigurasi"}
        </Badge>
      </div>

      <p className="text-sm app-muted leading-relaxed">
        Aktifkan login Google agar siswa, guru, dan staf dapat masuk ke SIAKAD menggunakan akun Google sekolah atau akun pribadi.
      </p>

      {/* Authorized Redirect URI Notice */}
      <div
        className="rounded-2xl p-4 border flex flex-col gap-2"
        style={{ background: "var(--hover)", borderColor: "var(--accent-soft)" }}
      >
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1.5">
            <span className="material-symbols-outlined text-[16px]">link</span>
            Authorized Redirect URI (Google Console)
          </span>
          <button
            type="button"
            onClick={copyRedirectUri}
            className="px-2.5 py-1 rounded-lg text-xs font-medium border transition-colors flex items-center gap-1 shrink-0"
            style={{ background: "var(--surface)", borderColor: "var(--input-border)" }}
          >
            <span className="material-symbols-outlined text-[14px]">
              {copied ? "check" : "content_copy"}
            </span>
            {copied ? "Tersalin!" : "Salin URL"}
          </button>
        </div>
        <code className="text-xs font-mono px-3 py-2 rounded-xl bg-[var(--surface)] border block truncate select-all" style={{ borderColor: "var(--input-border)" }}>
          {googleCallbackUrl}
        </code>
        <p className="text-[11px] app-muted leading-snug">
          Daftarkan URL di atas pada field <strong>Authorized redirect URIs</strong> di Google Cloud Console (Credentials &rarr; OAuth 2.0 Client IDs).
        </p>
      </div>

      {/* Config Form */}
      <form onSubmit={handleSave} className="flex flex-col gap-4">
        <Field
          id="google-client-id"
          label="Google Client ID"
          value={clientId}
          onChange={setClientId}
          placeholder="xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com"
          hint="Client ID aplikasi dari Google Cloud Console Credentials."
        />
        <Field
          id="google-client-secret"
          label="Google Client Secret"
          type="password"
          value={clientSecret}
          onChange={setClientSecret}
          placeholder={configured ? "•••••• (sudah diisi — kosongkan jika tidak ingin mengubah)" : "GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxx"}
          hint="Client Secret dari Google Cloud Console. Kosongkan jika tidak ingin mengubah."
        />

        <Button size="sm" variant="primary" type="submit" disabled={saving}>
          <span className="material-symbols-outlined text-[18px]">save</span>
          {saving ? "Memproses..." : "Simpan Konfigurasi Google OAuth"}
        </Button>
      </form>
    </Card>
  );
}


function IntegrationCard({
  item,
  onSync,
  busy,
  onReload,
}: {
  item: CatalogItem;
  onSync: (code: "gds" | "kehadiran") => void;
  busy: boolean;
  onReload: () => void;
}) {
  const [showDocs, setShowDocs] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  
  const [baseUrlInput, setBaseUrlInput] = useState(item.runtime?.baseUrl || "");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSaveConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!baseUrlInput.trim()) return alert("URL Base API wajib diisi.");
    setSaving(true);
    try {
      const res = await api<{ success: boolean; message?: string }>(`/admin/integrations/${item.code}-config`, {
        method: "PUT",
        body: JSON.stringify({
          baseUrl: baseUrlInput.trim(),
          apiKey: apiKeyInput.trim(),
        }),
      });
      if (res.success) {
        alert(`Konfigurasi ${item.shortName} berhasil disimpan!`);
        setApiKeyInput("");
        onReload();
      } else {
        alert(res.message || "Gagal menyimpan konfigurasi.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setSaving(false);
    }
  };

  const st = item.runtime?.status ?? item.status;
  const isGds = item.code === "gds";
  const webhookEndpoint = isGds ? "/api/v1/webhooks/gds" : "/api/v1/webhooks/kehadiran";
  const sampleJson = isGds
    ? `{\n  "points": [\n    { "nisn": "0051234567", "poin": 95, "catatan": "Terlambat 3x, perlu perhatian" },\n    { "nisn": "0107782261", "poin": 80 }\n  ]\n}`
    : `{\n  "rekap": [\n    { "nisn": "0051234567", "sakit": 1, "izin": 0, "alpa": 0, "catatan": "Ijin sakit demam" },\n    { "nisn": "0107782261", "sakit": 0, "izin": 2, "alpa": 1 }\n  ]\n}`;

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const badgeStatus = (s?: string) => {
    if (s === "live" || s === "ready" || s === "success") return "success";
    if (s === "coming_soon") return "pending";
    if (s === "error" || s === "misconfigured") return "incomplete";
    return "draft";
  };

  return (
    <Card className="p-5 flex flex-col gap-4 hover:shadow-[var(--shadow-lg)] transition-shadow duration-300">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <span
            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0"
            style={{ background: "var(--accent-soft)" }}
          >
            <span className="material-symbols-outlined text-[var(--accent)]">{item.icon}</span>
          </span>
          <div className="min-w-0">
            <div className="font-display font-bold text-sm leading-snug">{item.shortName}</div>
            <div className="text-[11px] app-muted truncate">{item.name}</div>
          </div>
        </div>
        <Badge status={badgeStatus(st)}>
          {st === "coming_soon" ? "Coming soon" : st}
        </Badge>
      </div>

      <p className="text-sm app-muted leading-relaxed">{item.description}</p>

      {/* Konfigurasi Input API Pihak Ketiga */}
      <div className="flex flex-col gap-3 p-4 rounded-xl border bg-surface-container/10 dark:bg-white/5" style={{ borderColor: "var(--input-border)" }}>
        <div className="text-xs font-semibold text-[var(--accent)] flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">settings</span>
          <span>Konfigurasi Koneksi {item.shortName}</span>
        </div>
        <Field
          id={`${item.code}-base-url`}
          label="URL Base API Aplikasi"
          value={baseUrlInput}
          onChange={setBaseUrlInput}
          placeholder="http://localhost:8001"
          hint={`URL dasar aplikasi PASTi (contoh: http://localhost:8001)`}
        />
        <Field
          id={`${item.code}-api-key`}
          label="API Key (X-API-Key)"
          type="password"
          value={apiKeyInput}
          onChange={setApiKeyInput}
          placeholder={item.runtime?.configured ? "•••••• (sudah diisi — kosongkan jika tidak ingin mengubah)" : "Masukkan API Key"}
          hint="API Key / Token pihak ketiga yang dibuat dari menu Developer API Key PASTi."
        />
        <Button
          size="sm"
          variant="secondary"
          onClick={handleSaveConfig}
          disabled={saving}
          className="w-full mt-1"
        >
          <span className="material-symbols-outlined text-[16px] mr-1">save</span>
          Simpan Parameter {item.shortName}
        </Button>
      </div>

      {/* API Endpoints Info Section for Third-Party Developers */}
      <div className="p-3 rounded-xl border flex flex-col gap-2 bg-surface-container/30 dark:bg-white/5" style={{ borderColor: "var(--input-border)" }}>
        <div className="text-xs font-semibold text-[var(--accent)] flex items-center gap-1.5">
          <span className="material-symbols-outlined text-[16px]">api</span>
          <span>API Endpoint Pihak Ketiga (Developer)</span>
        </div>
        
        <div className="space-y-1.5 text-xs font-mono">
          <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-[var(--surface)] border" style={{ borderColor: "var(--input-border)" }}>
            <span className="truncate"><strong>GET Master Siswa:</strong> /api/v1/students</span>
            <button
              type="button"
              onClick={() => copyText(`${window.location.origin}/api/v1/students`, "get")}
              className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 shrink-0 font-sans font-medium"
            >
              {copied === "get" ? "Tersalin!" : "Salin URL"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-2 p-1.5 rounded-lg bg-[var(--surface)] border" style={{ borderColor: "var(--input-border)" }}>
            <span className="truncate"><strong>POST Push Webhook:</strong> {webhookEndpoint}</span>
            <button
              type="button"
              onClick={() => copyText(`${window.location.origin}${webhookEndpoint}`, "post")}
              className="text-[10px] px-2 py-0.5 rounded bg-primary/10 text-primary hover:bg-primary/20 shrink-0 font-sans font-medium"
            >
              {copied === "post" ? "Tersalin!" : "Salin URL"}
            </button>
          </div>
        </div>

        {/* Collapsible Format JSON */}
        <button
          type="button"
          onClick={() => setShowDocs(!showDocs)}
          className="text-[11px] text-primary hover:underline flex items-center gap-1 mt-1 font-medium"
        >
          <span className="material-symbols-outlined text-[14px]">
            {showDocs ? "expand_less" : "code"}
          </span>
          <span>{showDocs ? "Sembunyikan Contoh Payload JSON" : "Lihat Contoh Format JSON Webhook"}</span>
        </button>

        {showDocs && (
          <div className="mt-1 relative">
            <pre className="text-[10px] font-mono p-2.5 rounded-lg bg-slate-900 text-emerald-400 overflow-x-auto">
              {sampleJson}
            </pre>
            <button
              type="button"
              onClick={() => copyText(sampleJson, "json")}
              className="absolute top-1.5 right-1.5 text-[9px] px-2 py-0.5 rounded bg-white/20 text-white hover:bg-white/30 font-sans font-medium"
            >
              {copied === "json" ? "Tersalin!" : "Salin JSON"}
            </button>
          </div>
        )}
      </div>

      <div>
        <p className="app-label mb-1.5">Field SIAKAD</p>
        <div className="flex flex-wrap gap-1.5">
          {item.ownsFields.map((f) => (
            <code
              key={f}
              className="text-[10px] px-2 py-1 rounded-lg"
              style={{ background: "var(--hover)", color: "var(--muted)" }}
            >
              {f}
            </code>
          ))}
        </div>
      </div>

      <Button
        size="sm"
        className="w-full"
        variant={st === "coming_soon" ? "secondary" : "primary"}
        disabled={busy}
        onClick={() => onSync(item.code as "gds" | "kehadiran")}
      >
        {busy ? "Memproses..." : st === "coming_soon" ? "Uji sync (coming soon)" : `Sync Manual ${item.shortName}`}
      </Button>
    </Card>
  );
}

export type ApiKey = {
  id: string;
  namaAplikasi: string;
  domainPrefix: string;
  customPrefix: string;
  apiKey: string;
  isActive: boolean;
  lastUsedAt?: string | null;
  createdAt: string;
};

// ─── Main Page ─────────────────────────────────────────────────────────────────
export function IntegrationsPage() {
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [recentSync, setRecentSync] = useState<SyncLog[]>([]);
  const [ssoConfig, setSsoConfig] = useState<SsoConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [clearingLog, setClearingLog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // API Keys state
  const [apiKeysList, setApiKeysList] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Create API Key Form States
  const [newAppName, setNewAppName] = useState("");
  const [newDomain, setNewDomain] = useState("*");
  const [newPrefix, setNewPrefix] = useState("data");
  const [createSubmitting, setCreateSubmitting] = useState(false);

  const load = async (isSilent = false) => {
    if (!isSilent) setLoading(true);
    try {
      const [intRes, ssoRes, keysRes] = await Promise.all([
        api<{ catalog: CatalogItem[]; recentSync: SyncLog[] }>("/admin/integrations"),
        api<SsoConfig>("/admin/sso/config").catch(() => null),
        api<ApiKey[]>("/admin/api-keys").catch(() => null),
      ]);
      setCatalog(intRes.data?.catalog ?? []);
      setRecentSync(intRes.data?.recentSync ?? []);
      if (ssoRes?.data) setSsoConfig(ssoRes.data);
      if (keysRes?.data) setApiKeysList(keysRes.data);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal memuat");
    } finally {
      if (!isSilent) setLoading(false);
      setApiKeysLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const sync = async (code: "gds" | "kehadiran") => {
    setBusy(code);
    setMessage(null);
    try {
      const res = await api(`/admin/integrations/${code}/sync`, { method: "POST" });
      setMessage(res.message || "OK");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Sync gagal / coming soon");
    } finally {
      setBusy(null);
      await load();
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAppName.trim()) return;
    if (newPrefix.length > 5) {
      alert("Prefix custom maksimal 5 karakter!");
      return;
    }
    setCreateSubmitting(true);
    try {
      const res = await api<ApiKey>("/admin/api-keys", {
        method: "POST",
        body: JSON.stringify({
          namaAplikasi: newAppName,
          domainPrefix: newDomain,
          customPrefix: newPrefix,
        }),
      });
      if (res.success && res.data) {
        setApiKeysList([res.data, ...apiKeysList]);
        setShowCreateModal(false);
        setNewAppName("");
        setNewDomain("*");
        setNewPrefix("data");
        setMessage("✅ Kunci API berhasil dibuat!");
      } else {
        alert(res.message || "Gagal membuat kunci API");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan");
    } finally {
      setCreateSubmitting(false);
    }
  };

  const handleToggleApiKey = async (id: string) => {
    try {
      const res = await api<ApiKey>(`/admin/api-keys/${id}/toggle`, { method: "POST" });
      if (res.success && res.data) {
        setApiKeysList(apiKeysList.map(k => k.id === id ? { ...k, isActive: res.data!.isActive } : k));
        setMessage("✅ Status kunci API berhasil diubah!");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal mengubah status");
    }
  };

  const handleDeleteApiKey = async (id: string) => {
    if (!confirm("Hapus kunci API ini? Aplikasi klien tidak akan bisa mengakses API lagi.")) return;
    try {
      const res = await api(`/admin/api-keys/${id}`, { method: "DELETE" });
      if (res.success) {
        setApiKeysList(apiKeysList.filter(k => k.id !== id));
        setMessage("✅ Kunci API berhasil dihapus.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal menghapus kunci API");
    }
  };

  const clearSyncLogs = async () => {
    if (!confirm("Hapus semua log sinkronisasi? Tindakan ini tidak dapat dibatalkan.")) return;
    setClearingLog(true);
    try {
      await api("/admin/sync-logs", { method: "DELETE" });
      setRecentSync([]);
      setMessage("✅ Log sinkronisasi berhasil dihapus.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal menghapus log.");
    } finally {
      setClearingLog(false);
    }
  };

  const syncCards = catalog.filter((i) => i.code === "gds" || i.code === "kehadiran");

  const badgeStatus = (s?: string) => {
    if (s === "live" || s === "ready" || s === "success") return "success";
    if (s === "coming_soon") return "pending";
    if (s === "error" || s === "misconfigured") return "incomplete";
    return "draft";
  };

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Ekosistem"
        title="Integrasi"
        description="Kredensia untuk identitas & data. GDS untuk poin. Kehadiran untuk absensi."
      />

      {message && (
        <div
          className="rounded-2xl px-4 py-3 text-sm"
          style={{ background: "var(--accent-soft)", color: "var(--fg)" }}
        >
          {message}
        </div>
      )}

      {/* SSO Config Section */}
      <section className="space-y-3">
        <h2 className="font-display font-bold text-base" style={{ color: "var(--fg)" }}>
          Konfigurasi SSO
        </h2>
        {loading ? (
          <Skeleton className="h-[520px] rounded-2xl" />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <SsoConfigCard ssoConfig={ssoConfig} onReload={() => load(true)} />
            <GoogleOAuthCard />
          </div>
        )}
      </section>

      {/* Kunci API Section */}
      <section className="space-y-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-bold text-base" style={{ color: "var(--fg)" }}>
            Kunci API
          </h2>
          <p className="text-xs app-muted">Kelola kunci API untuk integrasi data oleh aplikasi pihak ketiga.</p>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-4 flex items-center gap-4 bg-white dark:bg-zinc-900 border" style={{ borderColor: "var(--divider)" }}>
            <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(59, 130, 246, 0.1)" }}>
              <span className="material-symbols-outlined text-blue-500 text-[26px]">key</span>
            </span>
            <div>
              <div className="text-xl font-bold font-display" style={{ color: "var(--fg)" }}>{apiKeysList.length}</div>
              <div className="text-xs app-muted">Total Kunci</div>
            </div>
          </Card>
          
          <Card className="p-4 flex items-center gap-4 bg-white dark:bg-zinc-900 border" style={{ borderColor: "var(--divider)" }}>
            <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(34, 197, 94, 0.1)" }}>
              <span className="material-symbols-outlined text-green-500 text-[26px]">check_circle</span>
            </span>
            <div>
              <div className="text-xl font-bold font-display" style={{ color: "var(--fg)" }}>{apiKeysList.filter(k => k.isActive).length}</div>
              <div className="text-xs app-muted">Kunci Aktif</div>
            </div>
          </Card>

          <Card className="p-4 flex items-center gap-4 bg-white dark:bg-zinc-900 border" style={{ borderColor: "var(--divider)" }}>
            <span className="w-12 h-12 rounded-2xl flex items-center justify-center shrink-0" style={{ background: "rgba(245, 158, 11, 0.1)" }}>
              <span className="material-symbols-outlined text-amber-500 text-[26px]">history</span>
            </span>
            <div>
              <div className="text-xl font-bold font-display" style={{ color: "var(--fg)" }}>{apiKeysList.filter(k => k.lastUsedAt).length}</div>
              <div className="text-xs app-muted">Pernah Digunakan</div>
            </div>
          </Card>
        </div>

        {/* Search & Actions Bar */}
        <Card className="p-4 flex flex-col md:flex-row md:items-center justify-between gap-4 border" style={{ borderColor: "var(--divider)" }}>
          <div className="relative flex-1 max-w-md">
            <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px]" style={{ color: "var(--muted)" }}>search</span>
            <input
              type="text"
              placeholder="Cari kunci API..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border focus:outline-none focus:ring-1 focus:ring-primary"
              style={{ background: "var(--surface)", borderColor: "var(--input-border)", color: "var(--fg)" }}
            />
          </div>
          <Button size="sm" variant="primary" onClick={() => setShowCreateModal(true)} className="flex items-center gap-1.5 shrink-0 px-4 py-2">
            <span className="material-symbols-outlined text-[16px]">add</span>
            Buat Kunci
          </Button>
        </Card>

        {/* Table of Keys */}
        <Card className="overflow-hidden border" style={{ borderColor: "var(--divider)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--divider)", background: "var(--hover)" }}>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Nama Aplikasi</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Domain Yang Diizinkan</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Prefix</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">API Key</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Status</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Terakhir Digunakan</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y" style={{ borderColor: "var(--divider)" }}>
                {apiKeysLoading ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-zinc-400">Memuat data kunci API...</td>
                  </tr>
                ) : apiKeysList.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-zinc-400">Tidak ada data kunci API.</td>
                  </tr>
                ) : (
                  apiKeysList
                    .filter(k => k.namaAplikasi.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((key) => {
                      const isCopied = copiedKey === key.id;
                      const maskedKey = key.apiKey.slice(0, 12) + "..." + key.apiKey.slice(-4);
                      return (
                        <tr key={key.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/10">
                          <td className="px-5 py-3.5 font-bold" style={{ color: "var(--fg)" }}>{key.namaAplikasi}</td>
                          <td className="px-5 py-3.5 font-mono text-[11px]" style={{ color: "var(--muted)" }}>{key.domainPrefix}</td>
                          <td className="px-5 py-3.5">
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold bg-blue-550 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 border border-blue-100 dark:border-blue-900/30">
                              {key.customPrefix}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5 font-mono text-[11px] bg-zinc-50 dark:bg-zinc-900/40 px-2 py-1 rounded-lg border border-zinc-100 dark:border-zinc-800 w-fit">
                              <span style={{ color: "var(--fg)" }}>{maskedKey}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard.writeText(key.apiKey);
                                  setCopiedKey(key.id);
                                  setTimeout(() => setCopiedKey(null), 2000);
                                }}
                                className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
                                title="Salin Kunci"
                              >
                                <span className="material-symbols-outlined text-[14px]">
                                  {isCopied ? "check" : "content_copy"}
                                </span>
                              </button>
                            </div>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              key.isActive 
                                ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400" 
                                : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                            }`}>
                              {key.isActive ? "AKTIF" : "NONAKTIF"}
                            </span>
                          </td>
                          <td className="px-5 py-3.5 text-zinc-500 text-[11px]">
                            {key.lastUsedAt ? new Date(key.lastUsedAt).toLocaleString("id-ID") : "Belum pernah"}
                          </td>
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleToggleApiKey(key.id)}
                                className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center ${
                                  key.isActive 
                                    ? "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-600 dark:bg-amber-950/20 dark:border-amber-900/30"
                                    : "bg-green-50 hover:bg-green-100 border-green-200 text-green-600 dark:bg-green-950/20 dark:border-green-900/30"
                                }`}
                                title={key.isActive ? "Nonaktifkan" : "Aktifkan"}
                              >
                                <span className="material-symbols-outlined text-[15px]">{key.isActive ? "power_settings_new" : "play_circle"}</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteApiKey(key.id)}
                                className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 dark:bg-red-950/20 dark:border-red-900/30 flex items-center justify-center"
                                title="Hapus"
                              >
                                <span className="material-symbols-outlined text-[15px]">delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })
                )}
              </tbody>
            </table>
          </div>
          
          {/* Docs Section */}
          <div className="p-5 border-t bg-zinc-50/50 dark:bg-zinc-900/20 text-xs text-zinc-500 leading-relaxed" style={{ borderColor: "var(--divider)" }}>
            <div className="font-semibold text-zinc-700 dark:text-zinc-300 mb-3 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px] text-zinc-400">info</span>
              PANDUAN INTEGRASI REST API SIAKAD
            </div>
            <div className="grid md:grid-cols-3 gap-4 font-normal">
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 text-[10px] font-bold">1</span>
                <span>Buat kunci API untuk aplikasi klien dan simpan token dengan aman.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 text-[10px] font-bold">2</span>
                <span>Kirim request dengan header <code className="px-1.5 py-0.5 bg-zinc-200/50 dark:bg-zinc-800 rounded font-mono">Authorization: Bearer &lt;kunci&gt;</code> ke endpoint API SIAKAD.</span>
              </div>
              <div className="flex items-start gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-100 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0 text-[10px] font-bold">3</span>
                <span>Mendukung filter query parameter seperti <code className="px-1.5 py-0.5 bg-zinc-200/50 dark:bg-zinc-800 rounded font-mono">?status=siswa</code> atau <code className="px-1.5 py-0.5 bg-zinc-200/50 dark:bg-zinc-800 rounded font-mono">?limit=100</code>.</span>
              </div>
            </div>
          </div>
        </Card>
      </section>

      {/* Create Api Key Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <form
            onSubmit={handleCreateApiKey}
            className="w-full max-w-md rounded-2xl p-6 border shadow-2xl flex flex-col gap-4 text-left animate-scaleUp"
            style={{ background: "var(--bg)", borderColor: "var(--divider)", color: "var(--fg)" }}
          >
            <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--divider)" }}>
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[var(--accent)] text-[22px]">vpn_key</span>
                <h3 className="font-display font-bold text-base">Buat Kunci API Baru</h3>
              </div>
              <button
                type="button"
                onClick={() => setShowCreateModal(false)}
                className="w-8 h-8 rounded-lg flex items-center justify-center app-muted hover:bg-[var(--hover)]"
              >
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold">Nama Aplikasi / Klien</label>
              <input
                type="text"
                value={newAppName}
                onChange={(e) => setNewAppName(e.target.value)}
                placeholder="Contoh: Aplikasi Presensi PASTi"
                required
                className="w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2"
                style={{ background: "var(--surface)", borderColor: "var(--input-border)", color: "var(--fg)" }}
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold">Prefix Custom Token (Maks. 5 Karakter)</label>
              <input
                type="text"
                value={newPrefix}
                onChange={(e) => setNewPrefix(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5))}
                placeholder="Contoh: data atau pasti"
                maxLength={5}
                required
                className="w-full px-3 py-2 text-sm rounded-xl border font-mono focus:outline-none focus:ring-2"
                style={{ background: "var(--surface)", borderColor: "var(--input-border)", color: "var(--fg)" }}
              />
              <p className="text-[10px] app-muted">Hanya huruf kecil dan angka. Prefiks token Anda (Contoh: <code>data_...</code>)</p>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-xs font-semibold">Domain / IP Yang Diizinkan</label>
              <input
                type="text"
                value={newDomain}
                onChange={(e) => setNewDomain(e.target.value)}
                placeholder="* atau localhost atau domain.com"
                required
                className="w-full px-3 py-2 text-sm rounded-xl border font-mono focus:outline-none focus:ring-2"
                style={{ background: "var(--surface)", borderColor: "var(--input-border)", color: "var(--fg)" }}
              />
              <p className="text-[10px] app-muted">Gunakan <code>*</code> untuk memperbolehkan semua domain host.</p>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t mt-2" style={{ borderColor: "var(--divider)" }}>
              <Button type="button" size="sm" variant="secondary" onClick={() => setShowCreateModal(false)}>
                Batal
              </Button>
              <Button type="submit" size="sm" variant="primary" disabled={createSubmitting}>
                {createSubmitting ? "Membuat..." : "Simpan Kunci"}
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Sync Section */}
      {syncCards.length > 0 && (
        <section className="space-y-3">
          <h2 className="font-display font-bold text-base" style={{ color: "var(--fg)" }}>
            Sinkronisasi Data
          </h2>
          <div className="grid md:grid-cols-2 gap-4 md:gap-5">
            {loading
              ? [0, 1].map((i) => <Skeleton key={i} className="h-56 rounded-2xl" />)
              : syncCards.map((item) => (
                  <IntegrationCard
                    key={item.code}
                    item={item}
                    busy={busy === item.code}
                    onSync={sync}
                    onReload={() => load(true)}
                  />
                ))}
          </div>
        </section>
      )}

      {/* Sync Logs */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: "var(--divider)" }}>
          <div>
            <div className="font-semibold text-sm" style={{ color: "var(--fg)" }}>Log Sinkronisasi</div>
            <div className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>Riwayat sinkronisasi data dari Kredensia SSO, GDS, dan Kehadiran</div>
          </div>
          {recentSync.length > 0 && (
            <button
              type="button"
              onClick={clearSyncLogs}
              disabled={clearingLog}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors"
              style={{
                borderColor: "color-mix(in srgb, #ef4444 40%, transparent)",
                color: "#ef4444",
                background: "color-mix(in srgb, #ef4444 8%, transparent)",
                opacity: clearingLog ? 0.6 : 1,
                cursor: clearingLog ? "not-allowed" : "pointer",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M9 6V4h6v2" />
              </svg>
              {clearingLog ? "Menghapus…" : "Bersihkan Log"}
            </button>
          )}
        </div>
        <div>
          {loading ? (
            <div className="p-6">
              <Skeleton className="h-12 w-full" />
            </div>
          ) : recentSync.length === 0 ? (
            <div className="p-6 text-sm app-muted text-center">Belum ada log sinkronisasi.</div>
          ) : (
            recentSync.map((s) => {
              const summary = s.payloadSummary;
              const isSso = s.source === "kredensia" || s.source === "sso";
              const fields = summary?.fieldsImported ?? [];
              const errors = summary?.errors ?? [];

              return (
                <div
                  key={s.id}
                  className="px-5 py-4 border-b app-divider last:border-0 row-hover flex flex-col gap-2.5"
                >
                  {/* Top line: Source tag, message, status, time */}
                  <div className="flex items-start justify-between gap-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 min-w-0">
                      <span
                        className="font-bold text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-md shrink-0"
                        style={{
                          background: isSso
                            ? "var(--accent-soft)"
                            : "var(--hover)",
                          color: isSso ? "var(--accent)" : "var(--fg)",
                        }}
                      >
                        {isSso ? "KREDENSIA SSO" : s.source.toUpperCase()}
                      </span>
                      <span className="font-medium text-xs leading-snug">
                        {summary?.message || `Sinkronisasi ${s.source}`}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge status={badgeStatus(s.status)}>{s.status}</Badge>
                      <span className="text-[11px] app-muted whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleString("id-ID")}
                      </span>
                    </div>
                  </div>

                  {/* Metrics Pills (if total available) */}
                  {summary?.total !== undefined && (
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="app-muted">Metrics:</span>
                      <span className="px-2 py-0.5 rounded-lg border font-mono text-[11px]" style={{ borderColor: "var(--divider)" }}>
                        Total: <strong>{summary.total}</strong>
                      </span>
                      <span className="px-2 py-0.5 rounded-lg border font-mono text-[11px] text-[var(--accent)]" style={{ borderColor: "var(--accent-soft)", background: "var(--accent-soft)" }}>
                        Berhasil: <strong>{summary.success ?? 0}</strong>
                      </span>
                      {(summary.failed ?? 0) > 0 && (
                        <span className="px-2 py-0.5 rounded-lg border font-mono text-[11px] text-error" style={{ borderColor: "color-mix(in srgb, #ef4444 30%, transparent)", background: "color-mix(in srgb, #ef4444 10%, transparent)" }}>
                          Gagal: <strong>{summary.failed}</strong>
                        </span>
                      )}
                    </div>
                  )}

                  {/* Imported Fields List */}
                  {fields.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1 text-[11px]">
                      <span className="app-muted text-[10px] uppercase font-semibold mr-1">Field ter-sync:</span>
                      {fields.map((f) => (
                        <span
                          key={f}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                          style={{ background: "var(--hover)", color: "var(--muted)" }}
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Error Breakdown if any */}
                  {errors.length > 0 && (
                    <details className="mt-1 text-xs">
                      <summary className="cursor-pointer text-error font-medium hover:underline flex items-center gap-1 text-[11px]">
                        <span className="material-symbols-outlined text-[14px]">error</span>
                        Lihat {errors.length} detail data gagal
                      </summary>
                      <div
                        className="mt-2 p-3 rounded-xl border space-y-1 font-mono text-[11px]"
                        style={{ background: "var(--hover)", borderColor: "var(--divider)" }}
                      >
                        {errors.map((err, idx) => (
                          <div key={idx} className="text-error truncate">
                            • [{err.id.slice(0, 8)}] {err.message}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
}
