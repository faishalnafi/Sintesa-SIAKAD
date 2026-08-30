import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { homeForRoles, useAuthStore } from "@/store/auth";

export function OfficeLoginPage() {
  const [identifier, setIdentifier] = useState("superadmin@faishalnafi.local");
  const [password, setPassword] = useState("@Password123");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const { login, user, bootstrapped } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const err = params.get("error");
    if (err) setError(err);
  }, [params]);

  useEffect(() => {
    if (bootstrapped && user) {
      navigate(homeForRoles(user.roles), { replace: true });
    }
  }, [bootstrapped, user, navigate]);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(identifier, password);
      const u = useAuthStore.getState().user;
      navigate(homeForRoles(u?.roles ?? []), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login gagal");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-dvh flex flex-col overflow-x-hidden transition-colors duration-300 relative"
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      <div className="fixed inset-0 overflow-hidden pointer-events-none z-0">
        <div className="ambient-glow -top-48 -right-48" />
        <div className="ambient-glow -bottom-48 -left-48" />
      </div>

      <ThemeToggle floating />

      <main className="flex-grow flex items-center justify-center px-margin-mobile md:px-0 relative z-10 py-stack-lg">
        <div className="w-full max-w-[440px]">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-3xl bg-primary-container/10 dark:bg-primary-container/20 mb-4 shadow-sm border border-primary-container/20">
              <span className="material-symbols-outlined text-primary text-[40px] fill">badge</span>
            </div>
            <h1 className="font-display text-3xl font-bold text-primary dark:text-primary-fixed mb-1 tracking-tight">
              SIAKAD Office
            </h1>
            <p className="text-base app-muted">Akses Portal Internal & Admin Sekolah</p>
          </div>

          <div className="app-card p-8 md:p-10 !rounded-[28px] shadow-[var(--shadow-lg)]">
            <h2 className="font-display text-xl font-semibold mb-6 text-center tracking-tight">
              Masuk Manual (Internal)
            </h2>

            {error && (
              <div className="mb-6 rounded-2xl bg-error-container text-on-error-container px-4 py-3 text-sm">
                {error}
              </div>
            )}

            <form onSubmit={onSubmit} className="space-y-5">
              <Input
                label="Email atau Username"
                leftIcon="alternate_email"
                name="identifier"
                placeholder="nama@sekolah.sch.id"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                autoComplete="username"
                required
              />
              <div className="space-y-1.5">
                <div className="flex justify-between items-center px-1">
                  <label className="text-sm font-semibold tracking-wide text-on-surface-variant">
                    Kata Sandi
                  </label>
                </div>
                <Input
                  leftIcon="lock"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  rightSlot={
                    <button
                      type="button"
                      className="text-outline hover:text-on-surface"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label="Toggle password"
                    >
                      <span className="material-symbols-outlined">
                        {showPassword ? "visibility_off" : "visibility"}
                      </span>
                    </button>
                  }
                />
              </div>

              <Button type="submit" className="w-full mt-2" size="lg" disabled={loading}>
                {loading ? "Memproses..." : "Masuk ke Office"}
              </Button>
            </form>

          </div>
        </div>
      </main>

      <footer className="py-4 px-margin-mobile relative z-10">
        <div className="max-w-[440px] mx-auto flex justify-center text-outline text-xs">
          <div>© {new Date().getFullYear()} SIAKAD — SMAN 3 Mojokerto.</div>
        </div>
      </footer>
    </div>
  );
}
