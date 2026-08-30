import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { Skeleton } from "@/components/ui/Skeleton";

export function ProtectedRoute({ roles }: { roles?: string[] }) {
  const { user, bootstrapped, loading } = useAuthStore();
  const location = useLocation();

  if (!bootstrapped || loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-32 w-full" />
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  if (roles && !roles.some((r) => user.roles.includes(r))) {
    return <Navigate to="/403" replace />;
  }

  return <Outlet />;
}
