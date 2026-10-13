import { useAuthStore } from "@/store/auth";
import { useThemeStore, type ThemePreference } from "@/store/theme";
import { Card } from "@/components/ui/Card";
import { cn } from "@/lib/cn";
import { md5 } from "@/lib/md5";

const themes: { id: ThemePreference; label: string; icon: string }[] = [
  { id: "light", label: "Light", icon: "light_mode" },
  { id: "dark", label: "Dark", icon: "dark_mode" },
  { id: "system", label: "System", icon: "contrast" },
];

export function ProfilePage() {
  const { user } = useAuthStore();
  const { preference, setPreference } = useThemeStore();

  const avatarSrc =
    user?.avatarUrl ||
    (user?.email
      ? `https://www.gravatar.com/avatar/${md5(user.email.trim().toLowerCase())}?d=identicon&s=250`
      : null);

  return (
    <div className="space-y-8 max-w-xl">
      <div>
        <p className="app-label">Akun</p>
        <h1 className="font-display text-2xl font-bold tracking-tight mt-1">Profil</h1>
        <p className="text-sm app-muted mt-1.5">
          Identitas dari Kredensia (mirror lokal). Preferensi tampilan disimpan di perangkat.
        </p>
      </div>
      <Card className="p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-2xl overflow-hidden bg-primary-container/20 flex items-center justify-center border border-outline-variant/30 shrink-0">
              {avatarSrc ? (
                <img src={avatarSrc} alt={user?.name} className="w-full h-full object-cover" />
              ) : (
                <span className="material-symbols-outlined text-primary-container text-3xl">person</span>
              )}
            </div>
            <div>
              <div className="font-display font-bold text-lg">{user?.name}</div>
              <div className="text-sm app-muted">{user?.email ?? "—"}</div>
              <div className="text-xs app-muted mt-1">{(user?.roles ?? []).join(" · ")}</div>
            </div>
          </div>
          {user?.id && (
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`/u/${user.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-primary-container/15 text-primary-container hover:bg-primary-container/25 transition-colors border border-primary-container/30"
              >
                <span className="material-symbols-outlined text-base">public</span>
                Lihat Profil Publik
                <span className="material-symbols-outlined text-sm">open_in_new</span>
              </a>
              <button
                type="button"
                onClick={async () => {
                  const slug = user.ssoUsername || user.id;
                  const url = `${window.location.origin}/u/${encodeURIComponent(slug)}`;
                  try {
                    await navigator.clipboard.writeText(url);
                  } catch {
                    const ta = document.createElement("textarea");
                    ta.value = url;
                    ta.style.cssText = "position:fixed;top:0;left:0;opacity:0;";
                    document.body.appendChild(ta);
                    ta.focus();
                    ta.select();
                    document.execCommand("copy");
                    document.body.removeChild(ta);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold bg-surface-container-high hover:bg-surface-container hover:text-primary transition-colors border border-outline-variant/30 text-on-surface"
                title="Salin tautan profil publik"
              >
                <span className="material-symbols-outlined text-base">content_copy</span>
                Salin Tautan
              </button>
            </div>
          )}
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-display font-bold">Tampilan</h2>
        <p className="text-sm app-muted">Light, dark, atau ikuti sistem.</p>
        <div className="grid grid-cols-3 gap-2">
          {themes.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setPreference(t.id)}
              className={cn(
                "rounded-2xl border px-3 py-4 text-sm font-medium flex flex-col items-center gap-2 transition-colors",
                preference === t.id
                  ? "border-primary-container bg-primary-container/15 text-primary-container"
                  : "app-muted",
              )}
              style={{ borderColor: preference === t.id ? undefined : "var(--app-input-border)" }}
            >
              <span className="material-symbols-outlined">{t.icon}</span>
              {t.label}
            </button>
          ))}
        </div>
      </Card>
    </div>
  );
}
