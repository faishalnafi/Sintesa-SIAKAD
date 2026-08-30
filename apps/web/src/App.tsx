import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "@/components/layout/AppShell";
import { ProtectedRoute } from "@/routes/ProtectedRoute";
import { useAuthStore, homeForRoles } from "@/store/auth";
import { useThemeStore } from "@/store/theme";
import { LoginPage } from "@/pages/LoginPage";
import { OfficeLoginPage } from "@/pages/OfficeLoginPage";
import { AuthCallbackPage } from "@/pages/AuthCallbackPage";

import { AdminDashboard } from "@/pages/admin/AdminDashboard";
import { StudentsPage } from "@/pages/admin/StudentsPage";
import { ClassesPage } from "@/pages/admin/ClassesPage";
import { AcademicYearsPage } from "@/pages/admin/AcademicYearsPage";
import { SubjectsPage } from "@/pages/admin/SubjectsPage";
import { AdminMonitoringJurnalPage } from "@/pages/admin/AdminMonitoringJurnalPage";
import { IntegrationsPage } from "@/pages/admin/IntegrationsPage";
import { BackupRestorePage } from "@/pages/admin/BackupRestorePage";
import { TrashPage } from "@/pages/admin/TrashPage";
import { AppUpdatePage } from "@/pages/admin/AppUpdatePage";
import { AlumniPage } from "@/pages/admin/AlumniPage";
import { KeluarPage } from "@/pages/admin/KeluarPage";
import { GuruNilaiPage } from "@/pages/guru/GuruNilaiPage";
import { GuruJurnalPage } from "@/pages/guru/GuruJurnalPage";
import { WalikelasMatrixPage } from "@/pages/walikelas/WalikelasMatrixPage";
import { SiswaDashboard } from "@/pages/siswa/SiswaDashboard";
import { SiswaRaportPage } from "@/pages/siswa/SiswaRaportPage";
import { ProfilePage } from "@/pages/ProfilePage";
import { PublicProfilePage } from "@/pages/PublicProfilePage";

function HomeRedirect() {
  const user = useAuthStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={homeForRoles(user.roles)} replace />;
}

export default function App() {
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const initTheme = useThemeStore((s) => s.init);

  useEffect(() => {
    initTheme();
    bootstrap();

    // Auto-show scrollbar during scrolling
    let scrollTimer: number;
    const onScroll = () => {
      document.documentElement.classList.add("is-scrolling");
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        document.documentElement.classList.remove("is-scrolling");
      }, 1000);
    };

    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    return () => {
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.clearTimeout(scrollTimer);
    };
  }, [bootstrap, initTheme]);

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/u/:uuid" element={<PublicProfilePage />} />
        <Route path="/office" element={<OfficeLoginPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        <Route path="/403" element={<div className="p-8">Akses ditolak (403)</div>} />

        <Route element={<ProtectedRoute />}>
          <Route element={<AppShell />}>
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/profil" element={<ProfilePage />} />

            <Route element={<ProtectedRoute roles={["admin", "superadmin"]} />}>
              <Route path="/admin" element={<AdminDashboard />} />
              <Route path="/admin/students" element={<StudentsPage />} />
              <Route path="/admin/academic-years" element={<AcademicYearsPage />} />
              <Route path="/admin/classes" element={<ClassesPage />} />
              <Route path="/admin/subjects" element={<SubjectsPage />} />
              <Route path="/admin/monitoring-jurnal" element={<AdminMonitoringJurnalPage />} />
              <Route path="/admin/alumni" element={<AlumniPage />} />
              <Route path="/admin/keluar" element={<KeluarPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["superadmin"]} />}>
              <Route path="/admin/app-update" element={<AppUpdatePage />} />
              <Route path="/admin/integrations" element={<IntegrationsPage />} />
              <Route path="/admin/backup-restore" element={<BackupRestorePage />} />
              <Route path="/admin/trash" element={<TrashPage />} />
            </Route>


            <Route element={<ProtectedRoute roles={["guru", "walikelas", "admin", "superadmin"]} />}>
              <Route path="/guru" element={<GuruNilaiPage />} />
              <Route path="/guru/jurnal" element={<GuruJurnalPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["walikelas", "admin", "superadmin"]} />}>
              <Route path="/walikelas" element={<WalikelasMatrixPage />} />
            </Route>

            <Route element={<ProtectedRoute roles={["siswa", "ortu", "admin", "superadmin"]} />}>
              <Route path="/siswa" element={<SiswaDashboard />} />
              <Route path="/siswa/raport" element={<SiswaRaportPage />} />
            </Route>
          </Route>
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
