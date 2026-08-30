import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { homeForRoles, useAuthStore } from "@/store/auth";
import { Skeleton } from "@/components/ui/Skeleton";

export function AuthCallbackPage() {
  const { bootstrap, user } = useAuthStore();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");

  useEffect(() => {
    // Jika SSO meredirect ke frontend /auth/callback?token=...
    if (token) {
      window.location.href = `/api/auth/sso/callback?token=${encodeURIComponent(token)}`;
      return;
    }

    (async () => {
      await bootstrap();
      const u = useAuthStore.getState().user;
      if (u) navigate(homeForRoles(u.roles), { replace: true });
      else navigate("/login?error=sso_failed", { replace: true });
    })();
  }, [bootstrap, navigate, token]);

  return (
    <div className="min-h-dvh flex items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-4 text-center">
        <div className="mx-auto w-16 h-16 rounded-2xl bg-primary-container/15 flex items-center justify-center">
          <span className="material-symbols-outlined text-primary text-3xl fill">school</span>
        </div>
        <h1 className="font-display text-xl font-bold">Menyelesaikan login SSO…</h1>
        <Skeleton className="h-4 w-48 mx-auto" />
        <Skeleton className="h-4 w-32 mx-auto" />
        {user && <p className="text-sm text-on-surface-variant">Halo, {user.name}</p>}
      </div>
    </div>
  );
}
