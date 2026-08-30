import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuthStore } from "@/store/auth";
import { useSystemStore } from "@/store/system";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { UpdatePendingModal } from "@/components/common/UpdatePendingModal";
import { UpdateNoticeModal } from "@/components/common/UpdateNoticeModal";
import { cn } from "@/lib/cn";

type NavItem = { to: string; label: string; icon: string };
type NavGroup = { title?: string; items: NavItem[] };

function hasRole(roles: string[], ...codes: string[]) {
  const set = new Set(roles.map((r) => r.toLowerCase().trim()));
  return codes.some((c) => set.has(c.toLowerCase()));
}

const DASHBOARD: NavItem = { to: "/admin", label: "Dashboard", icon: "dashboard" };
const PROFIL: NavItem = { to: "/profil", label: "Profil Saya", icon: "person" };

const NAV_MANAJEMEN_AKADEMIK: NavItem[] = [
  { to: "/admin/students", label: "Siswa & Pengguna", icon: "group" },
  { to: "/admin/academic-years", label: "Tahun Pelajaran", icon: "calendar_month" },
  { to: "/admin/classes", label: "Data Rombel", icon: "class" },
  { to: "/admin/subjects", label: "Mapel & Penugasan", icon: "menu_book" },
  { to: "/admin/monitoring-jurnal", label: "Monitoring Jurnal", icon: "analytics" },
];

const NAV_PEMBELAJARAN_KELAS: NavItem[] = [
  { to: "/walikelas", label: "Matrix Persetujuan", icon: "fact_check" },
  { to: "/guru", label: "Input Nilai", icon: "grade" },
  { to: "/guru/jurnal", label: "Jurnal Guru", icon: "auto_stories" },
];

const NAV_PENGATURAN_SUPERADMIN: NavItem[] = [
  { to: "/admin/app-update", label: "Update & Backup", icon: "system_update" },
  { to: "/admin/integrations", label: "Integrasi", icon: "hub" },
  { to: "/admin/trash", label: "Tempat Sampah", icon: "delete_sweep" },
];

const NAV_GURU: NavItem[] = [
  { to: "/guru", label: "Input Nilai", icon: "grade" },
  { to: "/guru/jurnal", label: "Jurnal Guru", icon: "auto_stories" },
];

function navGroupsForRoles(roles: string[]): NavGroup[] {
  if (hasRole(roles, "superadmin")) {
    return [
      { title: "Utama", items: [DASHBOARD, PROFIL] },
      { title: "Manajemen Akademik", items: NAV_MANAJEMEN_AKADEMIK },
      { title: "Pembelajaran & Kelas", items: NAV_PEMBELAJARAN_KELAS },
      { title: "Pengaturan Sistem (Superadmin)", items: NAV_PENGATURAN_SUPERADMIN },
    ];
  }

  if (hasRole(roles, "admin")) {
    return [
      { title: "Utama", items: [DASHBOARD, PROFIL] },
      { title: "Manajemen Akademik", items: NAV_MANAJEMEN_AKADEMIK },
      { title: "Pembelajaran & Kelas", items: NAV_GURU },
    ];
  }

  if (hasRole(roles, "walikelas")) {
    const items: NavItem[] = [{ to: "/walikelas", label: "Matrix Persetujuan", icon: "fact_check" }];
    if (hasRole(roles, "guru")) items.push(...NAV_GURU);
    return [
      { title: "Utama", items: [PROFIL] },
      { title: "Pembelajaran & Kelas", items },
    ];
  }

  if (hasRole(roles, "guru")) {
    return [
      { title: "Utama", items: [PROFIL] },
      { title: "Pembelajaran & Kelas", items: NAV_GURU },
    ];
  }

  // siswa / ortu / default
  const groups: NavGroup[] = [
    { title: "Utama", items: [{ to: "/siswa", label: "Beranda", icon: "home" }, PROFIL] },
  ];
  if (hasRole(roles, "siswa", "ortu")) {
    groups.push({
      title: "Akademik Siswa",
      items: [{ to: "/siswa/raport", label: "Raport Nilai", icon: "grade" }],
    });
  }
  return groups;
}

function getPageTitle(pathname: string, roles: string[]): string {
  if (pathname === "/admin") return hasRole(roles, "superadmin") ? "Beranda Superadmin" : "Beranda Admin";
  if (pathname === "/admin/students") return "Siswa & Pengguna";
  if (pathname === "/admin/academic-years") return "Tahun Pelajaran";
  if (pathname === "/admin/classes") return "Data Rombel";
  if (pathname === "/admin/subjects") return "Mapel & Penugasan";
  if (pathname === "/admin/monitoring-jurnal") return "Monitoring Jurnal";
  if (pathname === "/admin/app-update") return "Pembaruan & Cadangan";
  if (pathname === "/admin/integrations") return "Integrasi & API";
  if (pathname === "/admin/trash") return "Tempat Sampah";
  if (pathname === "/admin/alumni") return "Data Alumni";
  if (pathname === "/admin/keluar") return "Siswa Keluar";
  if (pathname === "/walikelas") return "Matrix Persetujuan";
  if (pathname === "/guru") return "Input Nilai Siswa";
  if (pathname === "/guru/jurnal") return "Jurnal Mengajar Guru";
  if (pathname === "/siswa") return "Beranda Siswa";
  if (pathname === "/siswa/raport") return "Raport Nilai";
  if (pathname === "/profil") return "Profil Saya";
  return "SIAKAD SMAN 3 MOJOKERTO";
}

function SidebarBody({
  groups,
  onLogout,
  onNavigate,
  onToggleCollapse,
  isCollapsed,
}: {
  groups: NavGroup[];
  onLogout: () => void;
  onNavigate?: () => void;
  onToggleCollapse?: () => void;
  isCollapsed?: boolean;
}) {
  return (
    <>
      {/* Top Header inside Sidebar: SSO Brand Pill + Circle Chevron */}
      <div className="p-3.5 flex items-center gap-2">
        <div className="flex-1 flex items-center gap-2.5 bg-white/15 hover:bg-white/20 border border-white/20 rounded-2xl px-3 py-2 text-white shadow-xs backdrop-blur-md min-w-0 transition-colors">
          <div className="w-7 h-7 rounded-xl flex items-center justify-center bg-white/20 text-white shrink-0">
            <span className="material-symbols-outlined text-[18px]">key</span>
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-display font-bold text-[12px] leading-tight tracking-wide truncate text-white uppercase">
              SSO SMAN 3 MOJOKERTO
            </div>
          </div>
        </div>

        {onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-all shrink-0 cursor-pointer shadow-xs border border-white/20"
            title="Perkecil / Perbesar Sidebar"
            aria-label="Perkecil / Perbesar Sidebar"
          >
            <span className="material-symbols-outlined text-[18px]">
              {isCollapsed ? "chevron_right" : "chevron_left"}
            </span>
          </button>
        )}
      </div>

      {/* Navigation Groups */}
      <nav className="flex-1 px-3.5 space-y-4 overflow-y-auto pb-4 pt-1">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.title && (
              <div className="px-3.5 pt-3 pb-1 flex items-center">
                <span className="text-[10.5px] font-bold uppercase tracking-wider text-white/60">
                  {group.title}
                </span>
              </div>
            )}
            <div className="space-y-1">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to.split("/").length <= 2}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3.5 py-2.5 rounded-2xl text-[13px] font-medium transition-all duration-150 min-h-[42px]",
                      isActive
                        ? "bg-white text-[#0f91fc] font-bold shadow-md shadow-black/5"
                        : "text-white/85 hover:text-white hover:bg-white/12",
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn(
                          "material-symbols-outlined text-[20px] transition-colors",
                          isActive ? "text-[#0f91fc]" : "text-white opacity-90",
                        )}
                      >
                        {item.icon}
                      </span>
                      <span className="truncate">{item.label}</span>
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom Logout Button */}
      <div className="p-3.5 mt-auto">
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center gap-3 rounded-2xl py-3 px-4 text-[13.5px] font-semibold bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-all shadow-xs"
        >
          <span className="material-symbols-outlined text-[20px]">logout</span>
          <span>Keluar</span>
        </button>
      </div>
    </>
  );
}

function readCollapsedPref() {
  try {
    return localStorage.getItem("sbc") === "1";
  } catch {
    return false;
  }
}

export function AppShell() {
  const { user, logout } = useAuthStore();
  const fetchVersionInfo = useSystemStore((s) => s.fetchVersionInfo);
  const groups = navGroupsForRoles(user?.roles ?? []);
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPref);

  const pageTitle = getPageTitle(location.pathname, user?.roles ?? []);

  useEffect(() => {
    fetchVersionInfo();
  }, [fetchVersionInfo]);

  // Close drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  // Lock body scroll when drawer open
  useEffect(() => {
    if (!mobileOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

  // Esc closes drawer
  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  // Reflect collapsed state on <html> so scoped CSS can react
  useEffect(() => {
    document.documentElement.classList.toggle("sidebar-collapsed", collapsed);
  }, [collapsed]);

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("sbc", next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const onLogout = async () => {
    try {
      await logout();
    } catch {
      /* ignore */
    }
    window.location.href = "/login";
  };

  return (
    <div className="min-h-dvh flex" style={{ background: "var(--bg)", color: "var(--fg)" }}>
      {/* Desktop Sidebar (SSO Electric Blue) */}
      <aside
        className={cn(
          "app-sidebar hidden lg:flex fixed inset-y-0 left-0 flex-col z-30 transition-all duration-200",
          collapsed ? "w-[76px]" : "w-[260px]",
        )}
        style={{ backgroundColor: "#0f91fc" }}
      >
        <SidebarBody
          groups={groups}
          onLogout={onLogout}
          onToggleCollapse={toggleCollapsed}
          isCollapsed={collapsed}
        />
      </aside>

      {/* Mobile Drawer Overlay */}
      <div
        className={cn(
          "lg:hidden fixed inset-0 z-40 transition-opacity duration-300",
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none",
        )}
        aria-hidden={!mobileOpen}
      >
        <button
          type="button"
          className="absolute inset-0 bg-slate-950/50 backdrop-blur-[2px]"
          aria-label="Tutup menu"
          onClick={() => setMobileOpen(false)}
        />
        <aside
          className={cn(
            "app-sidebar absolute inset-y-0 left-0 w-[min(288px,86vw)] flex flex-col shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          style={{ backgroundColor: "#0f91fc" }}
          role="dialog"
          aria-modal="true"
          aria-label="Navigasi"
        >
          <div className="absolute top-3 right-3 z-10">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="w-8 h-8 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
              aria-label="Tutup"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
          <SidebarBody
            groups={groups}
            onLogout={onLogout}
            onNavigate={() => setMobileOpen(false)}
          />
        </aside>
      </div>

      {/* Main Column */}
      <div
        className={cn(
          "flex-1 min-h-dvh flex flex-col transition-all duration-200",
          collapsed ? "lg:pl-[76px]" : "lg:pl-[260px]",
        )}
      >
        {/* SSO Header (Top Bar) */}
        <header className="sticky top-0 z-20 h-16 px-4 lg:px-8 flex items-center justify-between gap-4 bg-white/85 dark:bg-slate-900/85 backdrop-blur-md border-b border-slate-200/80 dark:border-slate-800">
          {/* Header Left: Mobile menu toggle + Back Chevron + Page Title */}
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              className="lg:hidden w-9 h-9 rounded-full border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu"
              aria-expanded={mobileOpen}
            >
              <span className="material-symbols-outlined text-[20px]">menu</span>
            </button>

            {/* Back Chevron Button */}
            <button
              type="button"
              onClick={() => {
                if (window.history.length > 1) {
                  navigate(-1);
                } else {
                  navigate(hasRole(user?.roles ?? [], "superadmin", "admin") ? "/admin" : "/siswa");
                }
              }}
              className="w-8 h-8 rounded-full border border-slate-200/90 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-2xs transition-colors shrink-0"
              title="Kembali"
              aria-label="Kembali"
            >
              <span className="material-symbols-outlined text-[18px]">chevron_left</span>
            </button>

            {/* Page Title */}
            <h1 className="font-display font-bold text-[17px] sm:text-[18px] text-slate-800 dark:text-white tracking-tight truncate">
              {pageTitle}
            </h1>
          </div>

          {/* Header Right: 3-Button Theme Toggle Pill + User Profile Pill */}
          <div className="flex items-center gap-3 shrink-0">
            {/* Theme Toggle Segmented Pill (Sun, Laptop, Moon) */}
            <ThemeToggle />

            {/* User Profile Pill */}
            <NavLink
              to="/profil"
              className="bg-white dark:bg-slate-800 border border-slate-200/90 dark:border-slate-700/80 pl-1.5 pr-3.5 py-1 flex items-center gap-2.5 rounded-full shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-700/80 transition-colors"
            >
              <div className="w-7 h-7 rounded-full bg-gradient-to-tr from-indigo-500 to-purple-600 flex items-center justify-center text-white text-[12px] font-bold shadow-xs shrink-0">
                <span className="material-symbols-outlined text-[17px]">hub</span>
              </div>
              <div className="font-semibold text-[13px] text-slate-800 dark:text-slate-100 truncate max-w-[130px] hidden sm:block">
                {user?.name || (hasRole(user?.roles ?? [], "superadmin") ? "Superadmin" : "Pengguna")}
              </div>
            </NavLink>
          </div>
        </header>

        {/* Main Content Area */}
        <main className="flex-1 p-4 md:p-6 lg:p-8 max-w-container w-full mx-auto">
          <Outlet />
        </main>
      </div>

      <UpdatePendingModal />
      <UpdateNoticeModal />
    </div>
  );
}
