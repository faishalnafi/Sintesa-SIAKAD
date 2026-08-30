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
      <Card className="p-5 space-y-3">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl overflow-hidden bg-primary-container/20 flex items-center justify-center border border-outline-variant/30">
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
