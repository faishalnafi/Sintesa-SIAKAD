import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { PageHeader } from "@/components/ui/PageHeader";

// ─── Types ─────────────────────────────────────────────────────────────────────
export type SsoProviderItem = {
  id: string;
  category: "enterprise" | "opensource";
  name: string;
  shortName: string;
  description: string;
  protocol: string;
  icon: string;
  baseUrl?: string | null;
  clientId?: string | null;
  apiBaseUrl?: string | null;
  tenantId?: string | null;
  discoveryUrl?: string | null;
  bindDn?: string | null;
  scopes?: string | null;
  redirectUri: string;
  isConfigured: boolean;
  isActive: boolean;
  hasSecret?: boolean;
  hasApiKey?: boolean;
  isCustom?: boolean;
  lastTestedAt?: string | null;
  lastSyncAt?: string | null;
};

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

type SsoSyncResult = {
  total: number;
  success: number;
  failed: number;
  errors: Array<{ id: string; message: string }>;
};

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

// ─── Provider Logos Component ──────────────────────────────────────────────────
function ProviderLogo({ icon, className = "w-6 h-6" }: { icon: string; className?: string }) {
  if (icon === "google") {
    return (
      <svg className={className} viewBox="0 0 24 24">
        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z" />
        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z" />
      </svg>
    );
  }

  if (icon === "microsoft") {
    return (
      <svg className={className} viewBox="0 0 24 24">
        <path fill="#f25022" d="M1 1h10v10H1z" />
        <path fill="#00a4ef" d="M1 13h10v10H1z" />
        <path fill="#7fba00" d="M13 1h10v10H13z" />
        <path fill="#ffb900" d="M13 13h10v10H13z" />
      </svg>
    );
  }

  if (icon === "apple") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="currentColor">
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M15.97 6.38c.62-.75 1.04-1.8 0.92-2.85-.9.04-1.99.6-2.63 1.35-.57.65-1.06 1.71-.93 2.73 1 .08 2.02-.48 2.64-1.23z" />
      </svg>
    );
  }

  if (icon === "lock_person" || icon === "kredensia") {
    return (
      <div className="w-full h-full rounded-xl flex items-center justify-center bg-blue-500/15 text-blue-600 dark:text-blue-400">
        <span className="material-symbols-outlined text-[20px]">lock_person</span>
      </div>
    );
  }

  if (icon === "vpn_key" || icon === "keycloak") {
    return (
      <div className="w-full h-full rounded-xl flex items-center justify-center bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
        <span className="material-symbols-outlined text-[20px]">vpn_key</span>
      </div>
    );
  }

  if (icon === "shield" || icon === "authentik") {
    return (
      <div className="w-full h-full rounded-xl flex items-center justify-center bg-orange-500/15 text-orange-600 dark:text-orange-400">
        <span className="material-symbols-outlined text-[20px]">shield</span>
      </div>
    );
  }

  if (icon === "verified_user" || icon === "authelia") {
    return (
      <div className="w-full h-full rounded-xl flex items-center justify-center bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
        <span className="material-symbols-outlined text-[20px]">verified_user</span>
      </div>
    );
  }

  if (icon === "door_front" || icon === "casdoor") {
    return (
      <div className="w-full h-full rounded-xl flex items-center justify-center bg-purple-500/15 text-purple-600 dark:text-purple-400">
        <span className="material-symbols-outlined text-[20px]">door_front</span>
      </div>
    );
  }

  if (icon === "folder_shared" || icon === "ldap") {
    return (
      <div className="w-full h-full rounded-xl flex items-center justify-center bg-amber-500/15 text-amber-600 dark:text-amber-400">
        <span className="material-symbols-outlined text-[20px]">folder_shared</span>
      </div>
    );
  }

  return (
    <div className="w-full h-full rounded-xl flex items-center justify-center bg-indigo-500/15 text-indigo-600 dark:text-indigo-400">
      <span className="material-symbols-outlined text-[20px]">{icon || "hub"}</span>
    </div>
  );
}

// ─── Input Field Component ────────────────────────────────────────────────────
function Field({
  label,
  id,
  type = "text",
  value,
  onChange,
  placeholder,
  hint,
  required = false,
}: {
  label: string;
  id: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  required?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="app-label text-[12px] font-semibold">
        {label} {required && <span className="text-red-500">*</span>}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        autoComplete="off"
        className="w-full rounded-xl px-3.5 py-2.5 text-sm border transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
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

// ─── Modal Edit / Konfigurasi SSO Provider ───────────────────────────────────
function SsoConfigModal({
  provider,
  isOpen,
  onClose,
  onSaved,
}: {
  provider: SsoProviderItem | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [baseUrl, setBaseUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");
  const [tenantId, setTenantId] = useState("");
  const [discoveryUrl, setDiscoveryUrl] = useState("");
  const [bindDn, setBindDn] = useState("");
  const [scopes, setScopes] = useState("");
  const [copiedCallback, setCopiedCallback] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (provider) {
      setBaseUrl(provider.baseUrl || "");
      setClientId(provider.clientId || "");
      setClientSecret("");
      setApiKey("");
      setApiBaseUrl(provider.apiBaseUrl || "");
      setTenantId(provider.tenantId || "");
      setDiscoveryUrl(provider.discoveryUrl || "");
      setBindDn(provider.bindDn || "");
      setScopes(provider.scopes || "openid email profile");
    }
  }, [provider]);

  if (!isOpen || !provider) return null;

  const copyCallbackUrl = () => {
    navigator.clipboard.writeText(provider.redirectUri);
    setCopiedCallback(true);
    setTimeout(() => setCopiedCallback(false), 2000);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await api<{ success: boolean; message?: string }>(
        `/admin/integrations/sso-providers/${provider.id}`,
        {
          method: "PUT",
          body: JSON.stringify({
            baseUrl: baseUrl.trim() || undefined,
            clientId: clientId.trim() || undefined,
            clientSecret: clientSecret.trim() || undefined,
            apiKey: apiKey.trim() || undefined,
            apiBaseUrl: apiBaseUrl.trim() || undefined,
            tenantId: tenantId.trim() || undefined,
            discoveryUrl: discoveryUrl.trim() || undefined,
            bindDn: bindDn.trim() || undefined,
            scopes: scopes.trim() || undefined,
            category: provider.category,
            name: provider.name,
            shortName: provider.shortName,
            protocol: provider.protocol,
          }),
        },
      );

      if (res.success) {
        alert(res.message || "Konfigurasi SSO berhasil disimpan!");
        onSaved();
        onClose();
      } else {
        alert(res.message || "Gagal menyimpan konfigurasi.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan saat menyimpan.");
    } finally {
      setSubmitting(false);
    }
  };

  const isKredensia = provider.id === "kredensia";
  const isGoogle = provider.id === "google";
  const isMicrosoft = provider.id === "microsoft";
  const isLdap = provider.id === "ldap";
  const isGenericOidc = provider.id === "generic_oidc";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-xl rounded-2xl p-6 border shadow-2xl flex flex-col gap-5 text-left animate-scaleUp max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--bg)", borderColor: "var(--divider)", color: "var(--fg)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--divider)" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl p-1.5 flex items-center justify-center shrink-0 border border-black/5 dark:border-white/10" style={{ background: "var(--hover)" }}>
              <ProviderLogo icon={provider.icon} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-display font-bold text-base">{provider.name}</h3>
                <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400">
                  {provider.protocol}
                </span>
              </div>
              <p className="text-xs app-muted">{provider.description}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center app-muted hover:bg-[var(--hover)]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Redirect URI Info Pill */}
        <div
          className="rounded-2xl p-4 border flex flex-col gap-2"
          style={{ background: "var(--hover)", borderColor: "var(--accent-soft)" }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)] flex items-center gap-1.5">
              <span className="material-symbols-outlined text-[16px]">link</span>
              Redirect URI / Callback URL
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
            {provider.redirectUri}
          </code>
          <p className="text-[11px] app-muted leading-snug">
            Daftarkan URL di atas pada field <strong>Redirect URI / Callback URL</strong> di dashboard konsol {provider.shortName}.
          </p>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSave} className="flex flex-col gap-4">
          {/* Base URL (if applicable) */}
          {!isGoogle && !isMicrosoft && (
            <Field
              id="prov-url"
              label={isLdap ? "URL Server LDAP (Host & Port)" : "URL Dasar Server / Realm SSO"}
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder={
                isKredensia
                  ? "https://sso.sekolah.sch.id"
                  : isLdap
                  ? "ldap://ldap.sekolah.sch.id:389"
                  : "https://auth.sekolah.sch.id/realms/master"
              }
              hint={isLdap ? "Contoh: ldap://192.168.1.10:389 atau ldaps://..." : "URL endpoint portal SSO tanpa trailing slash."}
            />
          )}

          {/* Microsoft Tenant ID */}
          {isMicrosoft && (
            <Field
              id="prov-tenant-id"
              label="Directory (Tenant) ID Microsoft Azure"
              value={tenantId}
              onChange={setTenantId}
              placeholder="common atau xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
              hint="Gunakan 'common' atau 'organizations' atau Tenant ID spesifik sekolah."
            />
          )}

          {/* Discovery URL for Generic OIDC */}
          {isGenericOidc && (
            <Field
              id="prov-discovery-url"
              label="OpenID Connect Discovery URL (.well-known)"
              value={discoveryUrl}
              onChange={setDiscoveryUrl}
              placeholder="https://auth.sekolah.sch.id/.well-known/openid-configuration"
              hint="URL metadata konfigurasi OIDC provider."
            />
          )}

          {/* Client ID / App ID / Bind DN */}
          <Field
            id="prov-client-id"
            label={isLdap ? "Bind DN (Admin User DN)" : "Client ID / Application ID"}
            value={clientId || (isLdap ? bindDn : "")}
            onChange={(v) => {
              if (isLdap) setBindDn(v);
              else setClientId(v);
            }}
            placeholder={
              isGoogle
                ? "xxxxxxxxxxxx.apps.googleusercontent.com"
                : isKredensia
                ? "019f7d42-6977-7053-853f-4707fa9ea7cf"
                : isLdap
                ? "cn=admin,dc=sekolah,dc=sch,dc=id"
                : "siakad-client-id"
            }
            hint={isLdap ? "Distinguished Name akun pembaca LDAP." : "Identifier unik aplikasi yang dibuat di IdP."}
            required
          />

          {/* Client Secret */}
          <Field
            id="prov-client-secret"
            label={isLdap ? "Password Bind LDAP" : "Client Secret / App Secret"}
            type="password"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder={
              provider.hasSecret
                ? "•••••• (sudah tersimpan — kosongkan jika tidak ingin mengubah)"
                : "Masukkan Client Secret"
            }
            hint="Kunci rahasia otentikasi. Kosongkan jika tidak ingin mengubah."
          />

          {/* Specific Kredensia API Settings */}
          {isKredensia && (
            <div className="pt-2 border-t flex flex-col gap-3.5" style={{ borderColor: "var(--divider)" }}>
              <div className="text-xs font-semibold text-[var(--accent)] flex items-center gap-1.5">
                <span className="material-symbols-outlined text-[16px]">api</span>
                <span>Kredensial API Sinkronisasi Data (Siswa, Rombel &amp; Guru)</span>
              </div>
              <Field
                id="prov-api-base-url"
                label="URL Base API SSO"
                value={apiBaseUrl}
                onChange={setApiBaseUrl}
                placeholder="https://sso.sekolah.sch.id/api/v1"
                hint="Otomatis terisi <URL SSO>/api/v1 jika dikosongkan."
              />
              <Field
                id="prov-api-key"
                label="API Key (X-API-Key)"
                type="password"
                value={apiKey}
                onChange={setApiKey}
                placeholder={
                  provider.hasApiKey
                    ? "•••••• (sudah tersimpan — kosongkan jika tidak ingin mengubah)"
                    : "sso_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
                }
                hint="Dibuat dari Dashboard Kredensia → Kunci API."
              />
            </div>
          )}

          {/* Scopes */}
          <Field
            id="prov-scopes"
            label="OAuth Scopes"
            value={scopes}
            onChange={setScopes}
            placeholder="openid email profile"
            hint="Scope izin otentikasi (dipisahkan spasi)."
          />

          <div className="pt-3 border-t flex items-center justify-end gap-3" style={{ borderColor: "var(--divider)" }}>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={submitting}>
              <span className="material-symbols-outlined text-[16px]">save</span>
              {submitting ? "Menyimpan..." : "Simpan Konfigurasi"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Modal Tambah Integrasi SSO Baru ─────────────────────────────────────────
function CreateSsoModal({
  isOpen,
  onClose,
  onCreated,
}: {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [category, setCategory] = useState<"enterprise" | "opensource">("enterprise");
  const [selectedTemplate, setSelectedTemplate] = useState<string>("google");
  const [customName, setCustomName] = useState("");
  const [protocol, setProtocol] = useState("OAuth 2.0 / OIDC");
  const [baseUrl, setBaseUrl] = useState("");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [scopes, setScopes] = useState("openid email profile");
  const [submitting, setSubmitting] = useState(false);

  const enterpriseTemplates = [
    { id: "google", name: "Google Workspace", icon: "google", protocol: "OAuth 2.0 / OIDC" },
    { id: "microsoft", name: "Microsoft 365 / Entra ID", icon: "microsoft", protocol: "OIDC / OAuth 2.0" },
    { id: "apple", name: "Apple ID Sign-In", icon: "apple", protocol: "OAuth 2.0 / OIDC" },
    { id: "saml_okta", name: "Okta / SAML 2.0 Enterprise", icon: "security", protocol: "SAML 2.0 / OIDC" },
    { id: "github", name: "GitHub / GitLab Enterprise", icon: "code", protocol: "OAuth 2.0" },
    { id: "custom_ent", name: "Custom Enterprise IdP", icon: "hub", protocol: "SAML 2.0 / OIDC" },
  ];

  const openSourceTemplates = [
    { id: "kredensia", name: "Kredensia SSO (Sekolah)", icon: "lock_person", protocol: "OAuth 2.0 + API" },
    { id: "keycloak", name: "Keycloak IAM (Red Hat)", icon: "vpn_key", protocol: "OIDC / SAML 2.0" },
    { id: "authentik", name: "Authentik Self-Hosted", icon: "shield", protocol: "OIDC / OAuth 2.0" },
    { id: "authelia", name: "Authelia 2FA / SSO", icon: "verified_user", protocol: "OIDC" },
    { id: "casdoor", name: "Casdoor UI Platform", icon: "door_front", protocol: "OAuth 2.0 / OIDC" },
    { id: "ldap", name: "OpenLDAP / FreeIPA", icon: "folder_shared", protocol: "LDAP / LDAPS" },
    { id: "generic_oidc", name: "Generic OpenID Connect", icon: "extension", protocol: "OIDC Standard" },
    { id: "custom_os", name: "Custom Open Source IdP", icon: "hub", protocol: "OIDC / OAuth 2.0" },
  ];

  const currentTemplates = category === "enterprise" ? enterpriseTemplates : openSourceTemplates;

  const handleSelectTemplate = (t: typeof enterpriseTemplates[0]) => {
    setSelectedTemplate(t.id);
    setProtocol(t.protocol);
    if (!t.id.startsWith("custom_")) {
      setCustomName(t.name);
    } else {
      setCustomName("");
    }
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const finalName = customName.trim() || currentTemplates.find(t => t.id === selectedTemplate)?.name || "SSO Provider";
    setSubmitting(true);
    try {
      const res = await api<{ success: boolean; message?: string }>("/admin/integrations/sso-providers", {
        method: "POST",
        body: JSON.stringify({
          id: selectedTemplate.startsWith("custom_") ? undefined : selectedTemplate,
          category,
          name: finalName,
          shortName: finalName.split(" ")[0],
          protocol,
          baseUrl: baseUrl.trim() || undefined,
          clientId: clientId.trim() || undefined,
          clientSecret: clientSecret.trim() || undefined,
          scopes: scopes.trim() || undefined,
          icon: currentTemplates.find(t => t.id === selectedTemplate)?.icon || "hub",
        }),
      });

      if (res.success) {
        alert(res.message || "Integrasi SSO berhasil ditambahkan!");
        onCreated();
        onClose();
      } else {
        alert(res.message || "Gagal menambahkan integrasi.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Terjadi kesalahan.");
    } finally {
      setSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-xl rounded-2xl p-6 border shadow-2xl flex flex-col gap-5 text-left animate-scaleUp max-h-[90vh] overflow-y-auto"
        style={{ background: "var(--bg)", borderColor: "var(--divider)", color: "var(--fg)" }}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b pb-4" style={{ borderColor: "var(--divider)" }}>
          <div className="flex items-center gap-3">
            <span className="w-10 h-10 rounded-2xl flex items-center justify-center bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
              <span className="material-symbols-outlined text-[22px]">add_link</span>
            </span>
            <div>
              <h3 className="font-display font-bold text-base">Tambah Integrasi SSO</h3>
              <p className="text-xs app-muted">Pilih standar perusahaan besar atau open-source self-hosted</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center app-muted hover:bg-[var(--hover)]"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Category Selector Tabs */}
        <div className="grid grid-cols-2 gap-2 p-1.5 rounded-xl border" style={{ background: "var(--hover)", borderColor: "var(--divider)" }}>
          <button
            type="button"
            onClick={() => {
              setCategory("enterprise");
              setSelectedTemplate("google");
              setCustomName("Google Workspace");
            }}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              category === "enterprise"
                ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm"
                : "app-muted hover:text-[var(--fg)]"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">domain</span>
            <span>Standar Perusahaan Besar</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setCategory("opensource");
              setSelectedTemplate("kredensia");
              setCustomName("Kredensia SSO");
            }}
            className={`py-2 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
              category === "opensource"
                ? "bg-white dark:bg-zinc-800 text-blue-600 dark:text-blue-400 shadow-sm"
                : "app-muted hover:text-[var(--fg)]"
            }`}
          >
            <span className="material-symbols-outlined text-[16px]">terminal</span>
            <span>Open Source &amp; Self-Hosted</span>
          </button>
        </div>

        {/* Provider Template Grid */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-semibold app-muted uppercase tracking-wider">
            Pilih Platform / Provider:
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {currentTemplates.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTemplate(t)}
                className={`p-3 rounded-xl border text-left flex flex-col gap-2 transition-all ${
                  selectedTemplate === t.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)] ring-1 ring-[var(--accent)]"
                    : "border-[var(--input-border)] hover:bg-[var(--hover)]"
                }`}
              >
                <div className="w-7 h-7 rounded-lg flex items-center justify-center">
                  <ProviderLogo icon={t.icon} className="w-6 h-6" />
                </div>
                <div>
                  <div className="font-bold text-xs truncate" style={{ color: "var(--fg)" }}>{t.name}</div>
                  <div className="text-[10px] app-muted">{t.protocol}</div>
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Form Fields */}
        <form onSubmit={handleCreate} className="flex flex-col gap-3.5 border-t pt-4" style={{ borderColor: "var(--divider)" }}>
          <Field
            id="new-prov-name"
            label="Nama Integrasi / Label"
            value={customName}
            onChange={setCustomName}
            placeholder="Contoh: Google Workspace Sekolah"
            required
          />

          {category === "opensource" && (
            <Field
              id="new-prov-url"
              label="URL Dasar Server SSO"
              value={baseUrl}
              onChange={setBaseUrl}
              placeholder="https://auth.sekolah.sch.id"
              hint="URL dasar endpoint server otentikasi."
            />
          )}

          <Field
            id="new-prov-client-id"
            label="Client ID / Application ID"
            value={clientId}
            onChange={setClientId}
            placeholder="Masukkan Client ID dari dashboard provider"
            required
          />

          <Field
            id="new-prov-client-secret"
            label="Client Secret"
            type="password"
            value={clientSecret}
            onChange={setClientSecret}
            placeholder="Masukkan Client Secret"
          />

          <div className="pt-3 border-t flex items-center justify-end gap-3" style={{ borderColor: "var(--divider)" }}>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              Batal
            </Button>
            <Button type="submit" size="sm" variant="primary" disabled={submitting}>
              <span className="material-symbols-outlined text-[16px]">add</span>
              {submitting ? "Menambahkan..." : "Tambah Integrasi"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Unified Modal for SSO Save & Sync Progress/Result ────────────────────────
function UnifiedSsoModal({
  isOpen,
  loading,
  loadingStep,
  testStatus,
  syncResult,
  syncError,
  onClose,
}: {
  isOpen: boolean;
  loading: boolean;
  loadingStep?: string;
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
              <h3 className="font-display font-bold text-base">Sinkronisasi Data SSO</h3>
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

        {loading ? (
          <div className="py-10 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-14 h-14 rounded-full border-4 border-[var(--accent-soft)] border-t-[var(--accent)] animate-spin" />
            <div>
              <h4 className="font-bold text-base">Sedang Memproses...</h4>
              <p className="text-xs app-muted mt-1 max-w-xs leading-relaxed">
                {loadingStep || "Menyinkronkan data pengguna dan rombel dari Kredensia SSO."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
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
                  <p className="font-semibold" style={{ color: testStatus.connected ? "var(--accent)" : "#ef4444" }}>
                    {testStatus.connected ? "Koneksi API Key SSO: TERHUBUNG" : "Koneksi API Key SSO: GAGAL"}
                  </p>
                  <p className="app-muted mt-0.5 leading-relaxed">{testStatus.info}</p>
                </div>
              </div>
            )}

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
                <div className="grid grid-cols-3 gap-2.5">
                  <div className="rounded-xl p-3 text-center border" style={{ background: "var(--hover)", borderColor: "var(--divider)" }}>
                    <p className="app-label text-[10px]">Total Data</p>
                    <p className="font-display font-bold text-lg mt-0.5">{syncResult.total}</p>
                  </div>
                  <div className="rounded-xl p-3 text-center border" style={{ background: "var(--accent-soft)", borderColor: "var(--accent-soft)" }}>
                    <p className="app-label text-[10px]" style={{ color: "var(--accent)" }}>Berhasil</p>
                    <p className="font-display font-bold text-lg mt-0.5" style={{ color: "var(--accent)" }}>{syncResult.success}</p>
                  </div>
                  <div
                    className="rounded-xl p-3 text-center border"
                    style={{
                      background: syncResult.failed > 0 ? "color-mix(in srgb, #ef4444 12%, transparent)" : "var(--hover)",
                      borderColor: syncResult.failed > 0 ? "color-mix(in srgb, #ef4444 30%, transparent)" : "var(--divider)",
                    }}
                  >
                    <p className="app-label text-[10px]" style={{ color: syncResult.failed > 0 ? "#ef4444" : undefined }}>Gagal</p>
                    <p className="font-display font-bold text-lg mt-0.5" style={{ color: syncResult.failed > 0 ? "#ef4444" : undefined }}>{syncResult.failed}</p>
                  </div>
                </div>

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

            <Button size="sm" variant="primary" onClick={onClose} className="w-full mt-2">
              Selesai &amp; Tutup
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Table Component for SSO Providers ─────────────────────────────────────────
function SsoProviderTable({
  title,
  subtitle,
  badgeText,
  providers,
  onConfigure,
  onToggle,
  onReset,
  onSyncKredensia,
}: {
  title: string;
  subtitle: string;
  badgeText: string;
  providers: SsoProviderItem[];
  onConfigure: (p: SsoProviderItem) => void;
  onToggle: (id: string) => void;
  onReset: (id: string) => void;
  onSyncKredensia?: () => void;
}) {
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const copyText = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  return (
    <Card className="overflow-hidden border" style={{ borderColor: "var(--divider)" }}>
      {/* Table Section Header */}
      <div className="px-5 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3" style={{ borderColor: "var(--divider)", background: "var(--hover)" }}>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-display font-bold text-sm sm:text-base" style={{ color: "var(--fg)" }}>
              {title}
            </h3>
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold tracking-wide uppercase bg-blue-500/10 text-blue-600 dark:text-blue-400">
              {badgeText}
            </span>
          </div>
          <p className="text-xs app-muted mt-0.5">{subtitle}</p>
        </div>
        <div className="text-xs font-semibold app-muted">
          {providers.filter((p) => p.isConfigured).length} dari {providers.length} Terkonfigurasi
        </div>
      </div>

      {/* Table Content */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs border-collapse">
          <thead>
            <tr className="border-b" style={{ borderColor: "var(--divider)", background: "var(--surface)" }}>
              <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Provider / Platform</th>
              <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Protokol</th>
              <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Client ID / Endpoint</th>
              <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Redirect URI (Callback)</th>
              <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Status</th>
              <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted text-right">Aksi</th>
            </tr>
          </thead>
          <tbody className="divide-y" style={{ borderColor: "var(--divider)" }}>
            {providers.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-8 text-center text-zinc-400">
                  Belum ada provider dalam kategori ini.
                </td>
              </tr>
            ) : (
              providers.map((p) => {
                const isMaskedId = p.clientId
                  ? p.clientId.length > 20
                    ? p.clientId.slice(0, 10) + "..." + p.clientId.slice(-6)
                    : p.clientId
                  : null;

                return (
                  <tr key={p.id} className="hover:bg-zinc-50/60 dark:hover:bg-zinc-800/20 transition-colors">
                    {/* Platform */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-3 min-w-[200px]">
                        <div className="w-8 h-8 rounded-xl p-1 flex items-center justify-center shrink-0 border border-black/5 dark:border-white/10" style={{ background: "var(--hover)" }}>
                          <ProviderLogo icon={p.icon} className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-bold text-xs" style={{ color: "var(--fg)" }}>{p.name}</div>
                          <div className="text-[11px] app-muted truncate max-w-[220px]">{p.description}</div>
                        </div>
                      </div>
                    </td>

                    {/* Protocol */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-900/30">
                        {p.protocol}
                      </span>
                    </td>

                    {/* Client ID / Endpoint */}
                    <td className="px-5 py-3.5">
                      {p.clientId ? (
                        <div className="flex items-center gap-1.5 font-mono text-[11px] bg-zinc-50 dark:bg-zinc-900/40 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 w-fit">
                          <span style={{ color: "var(--fg)" }}>{isMaskedId}</span>
                          <button
                            type="button"
                            onClick={() => copyText(p.clientId!, `client_${p.id}`)}
                            className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                            title="Salin Client ID"
                          >
                            <span className="material-symbols-outlined text-[14px]">
                              {copiedId === `client_${p.id}` ? "check" : "content_copy"}
                            </span>
                          </button>
                        </div>
                      ) : p.baseUrl ? (
                        <span className="text-[11px] font-mono app-muted truncate max-w-[160px] block">{p.baseUrl}</span>
                      ) : (
                        <span className="text-zinc-400 italic text-[11px]">Belum diatur</span>
                      )}
                    </td>

                    {/* Redirect URI */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5 font-mono text-[11px] bg-zinc-50 dark:bg-zinc-900/40 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 w-fit">
                        <span className="truncate max-w-[140px]" style={{ color: "var(--muted)" }}>{p.redirectUri}</span>
                        <button
                          type="button"
                          onClick={() => copyText(p.redirectUri, `uri_${p.id}`)}
                          className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                          title="Salin Redirect URI"
                        >
                          <span className="material-symbols-outlined text-[14px]">
                            {copiedId === `uri_${p.id}` ? "check" : "content_copy"}
                          </span>
                        </button>
                      </div>
                    </td>

                    {/* Status */}
                    <td className="px-5 py-3.5 whitespace-nowrap">
                      {p.isConfigured ? (
                        <span
                          className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                            p.isActive
                              ? "bg-green-100 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                              : "bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${p.isActive ? "bg-green-500" : "bg-zinc-400"}`} />
                          {p.isActive ? "TERHUBUNG / AKTIF" : "NONAKTIF"}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-900/20 text-amber-700 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30">
                          BELUM DIKONFIG
                        </span>
                      )}
                    </td>

                    {/* Actions */}
                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-1.5">
                        {/* Sync button specifically for Kredensia */}
                        {p.id === "kredensia" && onSyncKredensia && (
                          <button
                            type="button"
                            onClick={onSyncKredensia}
                            disabled={!p.isConfigured}
                            className="p-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 dark:bg-blue-950/20 dark:border-blue-900/30 flex items-center justify-center transition-colors disabled:opacity-40"
                            title="Sinkronkan Data Anggota & Rombel"
                          >
                            <span className="material-symbols-outlined text-[15px]">sync</span>
                          </button>
                        )}

                        {/* Config Button */}
                        <button
                          type="button"
                          onClick={() => onConfigure(p)}
                          className="px-2.5 py-1.5 rounded-lg border font-semibold text-[11px] bg-[var(--surface)] hover:bg-[var(--hover)] transition-colors flex items-center gap-1"
                          style={{ borderColor: "var(--input-border)", color: "var(--fg)" }}
                        >
                          <span className="material-symbols-outlined text-[14px]">settings</span>
                          <span>Konfigurasi</span>
                        </button>

                        {/* Toggle Active Button */}
                        {p.isConfigured && (
                          <button
                            type="button"
                            onClick={() => onToggle(p.id)}
                            className={`p-1.5 rounded-lg border transition-colors flex items-center justify-center ${
                              p.isActive
                                ? "bg-amber-50 hover:bg-amber-100 border-amber-200 text-amber-600 dark:bg-amber-950/20 dark:border-amber-900/30"
                                : "bg-green-50 hover:bg-green-100 border-green-200 text-green-600 dark:bg-green-950/20 dark:border-green-900/30"
                            }`}
                            title={p.isActive ? "Nonaktifkan Login" : "Aktifkan Login"}
                          >
                            <span className="material-symbols-outlined text-[15px]">
                              {p.isActive ? "power_settings_new" : "play_circle"}
                            </span>
                          </button>
                        )}

                        {/* Reset / Delete Button */}
                        <button
                          type="button"
                          onClick={() => onReset(p.id)}
                          className="p-1.5 rounded-lg bg-red-50 hover:bg-red-100 border border-red-200 text-red-600 dark:bg-red-950/20 dark:border-red-900/30 flex items-center justify-center transition-colors"
                          title="Reset Konfigurasi"
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
    </Card>
  );
}

// ─── Third Party Sync Card (GDS & Kehadiran) ──────────────────────────────────
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

// ─── Main Page ─────────────────────────────────────────────────────────────────
export function IntegrationsPage() {
  const [enterpriseProviders, setEnterpriseProviders] = useState<SsoProviderItem[]>([]);
  const [openSourceProviders, setOpenSourceProviders] = useState<SsoProviderItem[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [recentSync, setRecentSync] = useState<SyncLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [clearingLog, setClearingLog] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Modals state
  const [editingProvider, setEditingProvider] = useState<SsoProviderItem | null>(null);
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);

  // Unified Kredensia sync modal state
  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncModalLoading, setSyncModalLoading] = useState(false);
  const [syncLoadingStep, setSyncLoadingStep] = useState("");
  const [syncTestResult, setSyncTestResult] = useState<{ connected: boolean; info?: string } | null>(null);
  const [ssoSyncResult, setSsoSyncResult] = useState<SsoSyncResult | null>(null);
  const [ssoSyncError, setSsoSyncError] = useState<string | null>(null);

  // API Keys state
  const [apiKeysList, setApiKeysList] = useState<ApiKey[]>([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);
  const [showCreateKeyModal, setShowCreateKeyModal] = useState(false);
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
      const [ssoRes, intRes, keysRes] = await Promise.all([
        api<{ enterprise: SsoProviderItem[]; opensource: SsoProviderItem[] }>("/admin/integrations/sso-providers").catch(() => null),
        api<{ catalog: CatalogItem[]; recentSync: SyncLog[] }>("/admin/integrations").catch(() => null),
        api<ApiKey[]>("/admin/api-keys").catch(() => null),
      ]);

      if (ssoRes?.data) {
        setEnterpriseProviders(ssoRes.data.enterprise || []);
        setOpenSourceProviders(ssoRes.data.opensource || []);
      }
      if (intRes?.data) {
        setCatalog(intRes.data.catalog ?? []);
        setRecentSync(intRes.data.recentSync ?? []);
      }
      if (keysRes?.data) {
        setApiKeysList(keysRes.data);
      }
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Gagal memuat data integrasi");
    } finally {
      if (!isSilent) setLoading(false);
      setApiKeysLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleToggleProvider = async (id: string) => {
    try {
      const res = await api<{ success: boolean; message: string }>(`/admin/integrations/sso-providers/${id}/toggle`, {
        method: "POST",
      });
      if (res.success) {
        setMessage(res.message || "Status provider berhasil diperbarui");
        load(true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal mengubah status provider");
    }
  };

  const handleResetProvider = async (id: string) => {
    if (!confirm(`Reset konfigurasi provider ${id}? Kredensial yang tersimpan akan dibersihkan.`)) return;
    try {
      const res = await api<{ success: boolean; message: string }>(`/admin/integrations/sso-providers/${id}`, {
        method: "DELETE",
      });
      if (res.success) {
        setMessage(res.message || "Konfigurasi provider berhasil direset");
        load(true);
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Gagal mereset provider");
    }
  };

  const handleSyncKredensia = async () => {
    setSyncModalOpen(true);
    setSyncModalLoading(true);
    setSyncLoadingStep("Menguji koneksi API & menyinkronkan data pengguna dari Kredensia SSO...");
    setSyncTestResult(null);
    setSsoSyncResult(null);
    setSsoSyncError(null);

    try {
      const testRes = await api<{ data?: { status?: string }; meta?: { app_name?: string } }>("/admin/sso/test");
      if (testRes.success) {
        setSyncTestResult({
          connected: true,
          info: `Terhubung ke Kredensia API (Aplikasi: ${testRes.data?.meta?.app_name || "OK"})`,
        });
      }
    } catch (err) {
      setSyncTestResult({
        connected: false,
        info: err instanceof Error ? err.message : "Tidak dapat terhubung ke SSO API",
      });
    }

    try {
      const syncRes = await api<SsoSyncResult>("/admin/sso/sync-members", { method: "POST" });
      if (syncRes.data) {
        setSsoSyncResult(syncRes.data);
      } else {
        setSsoSyncError(syncRes.message || "Gagal menyinkronkan data");
      }
    } catch (err) {
      setSsoSyncError(err instanceof Error ? err.message : "Gagal menyinkronkan data pengguna");
    } finally {
      setSyncModalLoading(false);
      load(true);
    }
  };

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
      await load(true);
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
        setShowCreateKeyModal(false);
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
        setApiKeysList(apiKeysList.map((k) => (k.id === id ? { ...k, isActive: res.data!.isActive } : k)));
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
        setApiKeysList(apiKeysList.filter((k) => k.id !== id));
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

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Ekosistem"
        title="Integrasi"
        description="Penyedia Single Sign-On (SSO), Kunci API Pihak Ketiga, dan Sinkronisasi Data Sekolah."
      />

      {message && (
        <div
          className="rounded-2xl px-4 py-3 text-sm flex items-center justify-between gap-3 shadow-xs"
          style={{ background: "var(--accent-soft)", color: "var(--fg)" }}
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage(null)}
            className="w-6 h-6 rounded-md flex items-center justify-center opacity-70 hover:opacity-100"
          >
            <span className="material-symbols-outlined text-[16px]">close</span>
          </button>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* ─── SECTION: KONFIGURASI SSO (2 TABEL) ──────────────────────────────── */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section className="space-y-6">
        {/* Header Section with Title and Add SSO Button */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="font-display font-bold text-lg" style={{ color: "var(--fg)" }}>
              Konfigurasi Single Sign-On (SSO)
            </h2>
            <p className="text-xs app-muted mt-0.5">
              Kelola otentikasi login terpusat dari standar perusahaan besar dan portal open-source sekolah.
            </p>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-1.5 shrink-0 px-4 py-2.5 shadow-sm"
          >
            <span className="material-symbols-outlined text-[18px]">add_link</span>
            <span>Tambah Integrasi SSO</span>
          </Button>
        </div>

        {/* Metrics Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3.5">
          <Card className="p-4 border flex items-center gap-3.5" style={{ borderColor: "var(--divider)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-blue-500/10 text-blue-600 dark:text-blue-400 shrink-0">
              <span className="material-symbols-outlined text-[22px]">domain</span>
            </div>
            <div>
              <div className="text-lg font-bold font-display" style={{ color: "var(--fg)" }}>
                {enterpriseProviders.filter((p) => p.isConfigured).length}
              </div>
              <div className="text-[11px] app-muted">SSO Perusahaan Besar</div>
            </div>
          </Card>

          <Card className="p-4 border flex items-center gap-3.5" style={{ borderColor: "var(--divider)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 shrink-0">
              <span className="material-symbols-outlined text-[22px]">terminal</span>
            </div>
            <div>
              <div className="text-lg font-bold font-display" style={{ color: "var(--fg)" }}>
                {openSourceProviders.filter((p) => p.isConfigured).length}
              </div>
              <div className="text-[11px] app-muted">SSO Open Source</div>
            </div>
          </Card>

          <Card className="p-4 border flex items-center gap-3.5" style={{ borderColor: "var(--divider)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-green-500/10 text-green-600 dark:text-green-400 shrink-0">
              <span className="material-symbols-outlined text-[22px]">verified</span>
            </div>
            <div>
              <div className="text-lg font-bold font-display" style={{ color: "var(--fg)" }}>
                {[...enterpriseProviders, ...openSourceProviders].filter((p) => p.isActive).length}
              </div>
              <div className="text-[11px] app-muted">Login Aktif</div>
            </div>
          </Card>

          <Card className="p-4 border flex items-center gap-3.5" style={{ borderColor: "var(--divider)" }}>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-purple-500/10 text-purple-600 dark:text-purple-400 shrink-0">
              <span className="material-symbols-outlined text-[22px]">hub</span>
            </div>
            <div>
              <div className="text-lg font-bold font-display" style={{ color: "var(--fg)" }}>
                {enterpriseProviders.length + openSourceProviders.length}
              </div>
              <div className="text-[11px] app-muted">Total Provider</div>
            </div>
          </Card>
        </div>

        {loading ? (
          <div className="space-y-6">
            <Skeleton className="h-64 rounded-2xl" />
            <Skeleton className="h-64 rounded-2xl" />
          </div>
        ) : (
          <div className="space-y-6">
            {/* TABEL 1: SSO STANDAR PERUSAHAAN BESAR */}
            <SsoProviderTable
              title="Tabel 1: SSO Standar Perusahaan Besar"
              subtitle="Google Workspace, Microsoft Azure AD / Entra ID, Apple ID, SAML 2.0 Enterprise & GitHub"
              badgeText="Enterprise Standards"
              providers={enterpriseProviders}
              onConfigure={(p) => {
                setEditingProvider(p);
                setShowConfigModal(true);
              }}
              onToggle={handleToggleProvider}
              onReset={handleResetProvider}
            />

            {/* TABEL 2: SSO OPEN SOURCE & SELF-HOSTED */}
            <SsoProviderTable
              title="Tabel 2: SSO Open Source & Self-Hosted"
              subtitle="Kredensia SSO (Sekolah), Keycloak, Authentik, Authelia, Casdoor, OpenLDAP & Generic OIDC"
              badgeText="Open Source & Self-Hosted"
              providers={openSourceProviders}
              onConfigure={(p) => {
                setEditingProvider(p);
                setShowConfigModal(true);
              }}
              onToggle={handleToggleProvider}
              onReset={handleResetProvider}
              onSyncKredensia={handleSyncKredensia}
            />
          </div>
        )}
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* ─── SECTION: KUNCI API REST UNTUK KLIEN ─────────────────────────────── */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      <section className="space-y-4 pt-4 border-t" style={{ borderColor: "var(--divider)" }}>
        <div className="flex flex-col gap-1">
          <h2 className="font-display font-bold text-base" style={{ color: "var(--fg)" }}>
            Kunci API REST SIAKAD
          </h2>
          <p className="text-xs app-muted">Kelola kunci API untuk integrasi data oleh aplikasi pihak ketiga.</p>
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
          <Button size="sm" variant="primary" onClick={() => setShowCreateKeyModal(true)} className="flex items-center gap-1.5 shrink-0 px-4 py-2">
            <span className="material-symbols-outlined text-[16px]">add</span>
            Buat Kunci API
          </Button>
        </Card>

        {/* Table of Keys */}
        <Card className="overflow-hidden border" style={{ borderColor: "var(--divider)" }}>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b" style={{ borderColor: "var(--divider)", background: "var(--hover)" }}>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Nama Aplikasi</th>
                  <th className="px-5 py-3 font-bold uppercase tracking-wider text-[10px] app-muted">Domain Diizinkan</th>
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
                    .filter((k) => k.namaAplikasi.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map((key) => {
                      const isCopied = copiedKey === key.id;
                      const maskedKey = key.apiKey.slice(0, 12) + "..." + key.apiKey.slice(-4);
                      return (
                        <tr key={key.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-800/10">
                          <td className="px-5 py-3.5 font-bold" style={{ color: "var(--fg)" }}>{key.namaAplikasi}</td>
                          <td className="px-5 py-3.5 font-mono text-[11px]" style={{ color: "var(--muted)" }}>{key.domainPrefix}</td>
                          <td className="px-5 py-3.5">
                            <span className="px-2 py-0.5 rounded-lg text-[10px] font-mono font-semibold bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-900/30">
                              {key.customPrefix}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-1.5 font-mono text-[11px] bg-zinc-50 dark:bg-zinc-900/40 px-2 py-1 rounded-lg border border-zinc-200 dark:border-zinc-800 w-fit">
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
        </Card>
      </section>

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* ─── SECTION: SINKRONISASI DATA GDS & KEHADIRAN ──────────────────────── */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
      {syncCards.length > 0 && (
        <section className="space-y-3 pt-4 border-t" style={{ borderColor: "var(--divider)" }}>
          <h2 className="font-display font-bold text-base" style={{ color: "var(--fg)" }}>
            Sinkronisasi Pihak Ketiga (GDS &amp; Kehadiran)
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

      {/* ─────────────────────────────────────────────────────────────────────── */}
      {/* ─── SECTION: LOG SINKRONISASI ───────────────────────────────────────── */}
      {/* ─────────────────────────────────────────────────────────────────────── */}
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
            recentSync.map((s) => (
              <div
                key={s.id}
                className="px-5 py-4 border-b app-divider last:border-0 row-hover flex flex-col gap-2"
              >
                <div className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[10px] tracking-wider uppercase px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-600">
                      {s.source}
                    </span>
                    <span className="font-medium text-xs" style={{ color: "var(--fg)" }}>
                      {s.payloadSummary?.message || "Sinkronisasi selesai"}
                    </span>
                  </div>
                  <span className="text-[11px] app-muted">
                    {new Date(s.createdAt).toLocaleString("id-ID")}
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>

      {/* ─── MODALS ──────────────────────────────────────────────────────────── */}
      {/* 1. Modal Edit Config */}
      <SsoConfigModal
        provider={editingProvider}
        isOpen={showConfigModal}
        onClose={() => {
          setShowConfigModal(false);
          setEditingProvider(null);
        }}
        onSaved={() => load(true)}
      />

      {/* 2. Modal Create SSO Integration */}
      <CreateSsoModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={() => load(true)}
      />

      {/* 3. Modal Kredensia Sync Progress */}
      <UnifiedSsoModal
        isOpen={syncModalOpen}
        loading={syncModalLoading}
        loadingStep={syncLoadingStep}
        testStatus={syncTestResult}
        syncResult={ssoSyncResult}
        syncError={ssoSyncError}
        onClose={() => setSyncModalOpen(false)}
      />

      {/* 4. Modal Create API Key */}
      {showCreateKeyModal && (
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
                onClick={() => setShowCreateKeyModal(false)}
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
                className="w-full px-3 py-2 text-sm rounded-xl border focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
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
                className="w-full px-3 py-2 text-sm rounded-xl border font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
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
                className="w-full px-3 py-2 text-sm rounded-xl border font-mono focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
                style={{ background: "var(--surface)", borderColor: "var(--input-border)", color: "var(--fg)" }}
              />
              <p className="text-[10px] app-muted">Gunakan <code>*</code> untuk memperbolehkan semua domain host.</p>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t mt-2" style={{ borderColor: "var(--divider)" }}>
              <Button type="button" size="sm" variant="secondary" onClick={() => setShowCreateKeyModal(false)}>
                Batal
              </Button>
              <Button type="submit" size="sm" variant="primary" disabled={createSubmitting}>
                {createSubmitting ? "Membuat..." : "Simpan Kunci"}
              </Button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
