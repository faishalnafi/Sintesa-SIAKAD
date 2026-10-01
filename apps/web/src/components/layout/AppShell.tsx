import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
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

const ASISTEN_AI: NavItem = { to: "/guru/ai", label: "NEBULA AI", icon: "auto_awesome" };
const DASHBOARD: NavItem = { to: "/admin", label: "Dashboard", icon: "dashboard" };

const NAV_MANAJEMEN_AKADEMIK: NavItem[] = [
  { to: "/admin/students", label: "Siswa & Pengguna", icon: "group" },
  { to: "/admin/academic-years", label: "Tahun Pelajaran", icon: "calendar_month" },
  { to: "/admin/classes", label: "Data Rombel", icon: "class" },
  { to: "/admin/subjects", label: "Mapel & Penugasan", icon: "menu_book" },
  { to: "/admin/monitoring-jurnal", label: "Monitoring Jurnal", icon: "analytics" },
];

const NAV_PEMBELAJARAN_SUPERADMIN: NavItem[] = [
  { to: "/walikelas", label: "Matrix Persetujuan", icon: "fact_check" },
  { to: "/guru", label: "Input Nilai", icon: "grade" },
  { to: "/guru/jurnal", label: "Jurnal Guru", icon: "auto_stories" },
];

const NAV_PENGATURAN_SUPERADMIN: NavItem[] = [
  { to: "/admin/integrations", label: "Update & Integrasi", icon: "hub" },
  { to: "/admin/trash", label: "Tempat Sampah", icon: "delete_sweep" },
];

const NAV_GURU: NavItem[] = [
  { to: "/guru", label: "Input Nilai", icon: "grade" },
  { to: "/guru/jurnal", label: "Jurnal Guru", icon: "auto_stories" },
];

/**
 * Grup menu sidebar per role.
 * Asisten AI diletakkan di section terpisah paling atas.
 * Profil Saya dipindahkan menyatu ke kartu profil pengguna di bagian bawah sidebar.
 */
function navGroupsForRoles(roles: string[]): NavGroup[] {
  if (hasRole(roles, "superadmin")) {
    return [
      { title: "Asisten AI", items: [ASISTEN_AI] },
      { title: "Utama", items: [DASHBOARD] },
      { title: "Manajemen Akademik", items: NAV_MANAJEMEN_AKADEMIK },
      { title: "Pembelajaran & Kelas", items: NAV_PEMBELAJARAN_SUPERADMIN },
      { title: "Pengaturan Sistem (Superadmin)", items: NAV_PENGATURAN_SUPERADMIN },
    ];
  }

  if (hasRole(roles, "admin")) {
    return [
      { title: "Asisten AI", items: [ASISTEN_AI] },
      { title: "Utama", items: [DASHBOARD] },
      { title: "Manajemen Akademik", items: NAV_MANAJEMEN_AKADEMIK },
      { title: "Pembelajaran & Kelas", items: NAV_GURU },
    ];
  }

  if (hasRole(roles, "walikelas")) {
    const items: NavItem[] = [{ to: "/walikelas", label: "Matrix Persetujuan", icon: "fact_check" }];
    if (hasRole(roles, "guru")) items.push(...NAV_GURU);
    return [
      { title: "Asisten AI", items: [ASISTEN_AI] },
      { title: "Pembelajaran & Kelas", items },
    ];
  }

  if (hasRole(roles, "guru")) {
    return [
      { title: "Asisten AI", items: [ASISTEN_AI] },
      { title: "Pembelajaran & Kelas", items: NAV_GURU },
    ];
  }

  // siswa / ortu / default
  const groups: NavGroup[] = [
    { title: "Utama", items: [{ to: "/siswa", label: "Beranda", icon: "home" }] },
  ];
  if (hasRole(roles, "siswa", "ortu")) {
    groups.push({
      title: "Akademik Siswa",
      items: [{ to: "/siswa/raport", label: "Raport Nilai", icon: "grade" }],
    });
  }
  return groups;
}

function SidebarBody({
  groups,
  userName,
  userRoles,
  avatarUrl,
  onLogout,
  onNavigate,
}: {
  groups: NavGroup[];
  userName?: string;
  userRoles: string[];
  avatarUrl?: string | null;
  onLogout: () => void;
  onNavigate?: () => void;
}) {
  return (
    <>
      <div className="px-5 pt-6 pb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl flex items-center justify-center bg-[var(--accent-soft)] shrink-0">
          <span className="material-symbols-outlined text-[var(--accent)] fill text-[22px]">
            school
          </span>
        </div>
        <div className="min-w-0">
          <div className="font-display font-bold text-[var(--primary)] text-[15px] leading-tight tracking-tight">
            SIMAK
          </div>
          <div className="text-[11px] app-muted mt-0.5">Sistem Informasi Akademik</div>
        </div>
      </div>

      <nav className="flex-1 px-3 space-y-5 overflow-y-auto pb-4 pt-2">
        {groups.map((group, gi) => (
          <div key={gi} className="space-y-1">
            {group.title && (
              <div className="px-3 pb-1 flex items-center gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.title}
                </span>
                <div className="h-[1px] flex-1 bg-[var(--divider)] opacity-50" />
              </div>
            )}
            <div className="space-y-0.5">
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.to.split("/").length <= 2}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors duration-200 min-h-[42px]",
                      isActive
                        ? "bg-[var(--accent-soft)] text-[var(--accent)] font-semibold shadow-xs"
                        : "app-muted hover:bg-[var(--hover)] hover:text-[var(--fg)]",
                    )
                  }
                >
                  <span className="material-symbols-outlined text-[20px] opacity-90">{item.icon}</span>
                  {item.label}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
      </nav>

      <div className="p-3 border-t app-divider mt-auto space-y-2">
        {userName && (
          <NavLink
            to="/profil"
            onClick={onNavigate}
            title="Buka Profil Saya"
            className={({ isActive }) =>
              cn(
                "flex items-center gap-2.5 px-2.5 py-2 rounded-xl transition-all duration-200 group border cursor-pointer",
                isActive
                  ? "bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]/30 shadow-xs"
                  : "bg-slate-500/5 hover:bg-[var(--hover)] border-slate-500/10 text-[var(--fg)]"
              )
            }
          >
            {avatarUrl ? (
              <img
                src={avatarUrl}
                alt={userName}
                referrerPolicy="no-referrer"
                className="w-8 h-8 rounded-full object-cover shrink-0 border border-[var(--card-border)] group-hover:scale-105 transition-transform"
              />
            ) : (
              <div className="w-8 h-8 rounded-full bg-[var(--accent)] text-white flex items-center justify-center text-xs font-bold shrink-0 shadow-xs">
                {userName[0]?.toUpperCase()}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold truncate group-hover:text-[var(--accent)] transition-colors">
                {userName}
              </div>
              <div className="text-[10px] app-muted truncate capitalize">
                {userRoles.length > 0 ? userRoles.join(", ") : "User"}
              </div>
            </div>
            <span className="material-symbols-outlined text-[16px] app-muted group-hover:text-[var(--accent)] group-hover:translate-x-0.5 transition-all shrink-0">
              chevron_right
            </span>
          </NavLink>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="w-full flex items-center justify-center gap-2 rounded-xl py-2.5 px-4 text-[13px] font-bold bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)] hover:text-white transition-colors min-h-[40px]"
        >
          <span className="material-symbols-outlined text-[18px]">logout</span>
          Keluar
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
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsedPref);

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

  // Reflect collapsed state on <html> so scoped CSS (see index.css) can react
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

  const isAiRoute = location.pathname.startsWith("/guru/ai");

  return (
    <div
      className={cn(isAiRoute ? "h-dvh max-h-dvh overflow-hidden" : "min-h-dvh")}
      style={{ background: "var(--bg)", color: "var(--fg)" }}
    >
      {/* Desktop sidebar */}
      <aside className="app-sidebar hidden lg:flex fixed inset-y-0 left-0 w-[260px] flex-col border-r z-30">
        <SidebarBody
          groups={groups}
          userName={user?.name}
          userRoles={user?.roles ?? []}
          avatarUrl={user?.avatarUrl}
          onLogout={onLogout}
        />
      </aside>

      {/* Desktop sidebar minimize/maximize toggle */}
      <button
        type="button"
        id="sidebar-toggle-btn"
        onClick={toggleCollapsed}
        aria-label="Perkecil/perbesar sidebar"
      >
        &#8249;
      </button>

      {/* Mobile drawer overlay */}
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
            "app-sidebar absolute inset-y-0 left-0 w-[min(288px,86vw)] flex flex-col border-r shadow-[var(--shadow-lg)] transition-transform duration-300 ease-out",
            mobileOpen ? "translate-x-0" : "-translate-x-full",
          )}
          role="dialog"
          aria-modal="true"
          aria-label="Navigasi"
        >
          <div className="absolute top-3 right-3 z-10">
            <button
              type="button"
              onClick={() => setMobileOpen(false)}
              className="w-10 h-10 rounded-xl flex items-center justify-center app-muted hover:bg-[var(--hover)]"
              aria-label="Tutup"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
          </div>
          <SidebarBody
            groups={groups}
            userName={user?.name}
            userRoles={user?.roles ?? []}
            avatarUrl={user?.avatarUrl}
            onLogout={onLogout}
            onNavigate={() => setMobileOpen(false)}
          />
        </aside>
      </div>

      {/* Main column */}
      <div
        className={cn(
          "lg:pl-[260px] flex flex-col",
          isAiRoute ? "h-dvh max-h-dvh overflow-hidden" : "min-h-dvh"
        )}
      >
        {/* Top bar — mobile always; desktop subtle optional bar for breadcrumb space */}
        <header
          className="sticky top-0 z-20 border-b px-4 lg:px-8 h-14 shrink-0 flex items-center justify-between gap-3"
          style={{
            background: "color-mix(in srgb, var(--bg) 92%, transparent)",
            borderColor: "var(--divider)",
            backdropFilter: "blur(12px)",
          }}
        >
          <div className="flex items-center gap-2 min-w-0">
            <button
              type="button"
              className="lg:hidden w-10 h-10 -ml-1 rounded-xl flex items-center justify-center app-muted hover:bg-[var(--hover)] hover:text-[var(--fg)]"
              onClick={() => setMobileOpen(true)}
              aria-label="Buka menu"
              aria-expanded={mobileOpen}
            >
              <span className="material-symbols-outlined text-[24px]">menu</span>
            </button>
            <div className="lg:hidden flex items-center gap-2 min-w-0">
              <span className="material-symbols-outlined text-[var(--accent)] fill text-[22px]">
                school
              </span>
              <span className="font-display font-bold text-[var(--primary)] text-sm truncate">
                SIMAK
              </span>
            </div>
            <NavLink
              to="/profil"
              className="hidden lg:flex items-center gap-2.5 text-[13px] app-muted hover:text-[var(--fg)] transition-colors truncate group cursor-pointer"
              title="Buka Profil Saya"
            >
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user?.name ?? "User"}
                  referrerPolicy="no-referrer"
                  className="w-6 h-6 rounded-full object-cover border border-[var(--card-border)] shrink-0 group-hover:scale-105 transition-transform"
                />
              ) : null}
              <span className="group-hover:text-[var(--accent)] transition-colors">
                {user?.name ? `Masuk sebagai ${user.name}` : ""}
              </span>
            </NavLink>
          </div>

          <div className="flex items-center gap-1.5">
            <ThemeToggle className="!static !w-10 !h-10 !shadow-none lg:!hidden" />
            <button
              type="button"
              onClick={onLogout}
              className="lg:hidden w-10 h-10 rounded-xl border flex items-center justify-center app-muted"
              style={{ borderColor: "var(--input-border)" }}
              aria-label="Keluar"
            >
              <span className="material-symbols-outlined text-[20px]">logout</span>
            </button>
          </div>
        </header>

        <main
          className={cn(
            "flex-1 w-full min-h-0",
            isAiRoute
              ? "h-[calc(100dvh-3.5rem)] overflow-hidden flex flex-col p-0 max-w-none"
              : "p-4 md:p-6 lg:p-8 max-w-container mx-auto"
          )}
        >
          <Outlet />
        </main>
      </div>

      <UpdatePendingModal />
      <UpdateNoticeModal />
    </div>
  );
}
