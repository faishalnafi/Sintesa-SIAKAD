import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { useAuthStore } from "@/store/auth";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { PageHeader } from "@/components/ui/PageHeader";
import { StatCard } from "@/components/ui/StatCard";
import { useRealtimeEvent } from "@/hooks/useRealtimeEvent";

type Dashboard = {
  stats: {
    totalStudents: number;
    totalAlumni?: number;
    totalKeluar?: number;
    totalTeachers: number;
    totalTendik?: number;
    totalClasses: number;
    syncHealth: number;
  };
  roles?: Array<{ code: string; name: string; category: string; canLogin: boolean }>;
  recentSync?: Array<{ id: string; source: string; status: string; createdAt: string }>;
};

const quickLinksAdmin = [
  { to: "/admin/students", label: "Data siswa", icon: "group" },
  { to: "/admin/classes", label: "Data rombel", icon: "class" },
  { to: "/admin/subjects", label: "Data mapel", icon: "menu_book" },
  { to: "/admin/academic-years", label: "Tahun pelajaran", icon: "calendar_month" },
  { to: "/admin/alumni", label: "Alumni", icon: "workspace_premium" },
  { to: "/admin/integrations", label: "Integrasi", icon: "hub" },
];

/** Superadmin juga melihat pintasan menu manajemen role lain */
const quickLinksSuperadminExtra = [
  { to: "/walikelas", label: "Matrix persetujuan", icon: "fact_check" },
  { to: "/guru", label: "Input nilai", icon: "grade" },
];

export function AdminDashboard() {
  const user = useAuthStore((s) => s.user);
  const isSuperadmin = (user?.roles ?? []).some(
    (r) => r.toLowerCase() === "superadmin",
  );
  const quickLinks = useMemo<Array<{ to: string; label: string; icon: string }>>(
    () =>
      isSuperadmin
        ? [...quickLinksAdmin, ...quickLinksSuperadminExtra]
        : quickLinksAdmin,
    [isSuperadmin],
  );
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchDashboard = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await api<Dashboard>("/admin/dashboard");
      setData(res.data ?? null);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDashboard();
  }, []);

  // Realtime: refresh stats saat ada perubahan data master / nilai / sync
  useRealtimeEvent(
    ["student_updated", "class_updated", "subject_updated", "sync_completed", "grade_approved"],
    () => { fetchDashboard(true); }
  );

  const primaryStats = [
    {
      label: "Siswa aktif",
      value: data?.stats.totalStudents ?? 0,
      hint: "Status siswa pada tahun berjalan",
      icon: "group",
      to: "/admin/students",
    },
    {
      label: "Guru",
      value: data?.stats.totalTeachers ?? 0,
      hint: "Tenaga pendidik terdaftar",
      icon: "school",
      to: "/admin/students?role=Guru",
    },
    {
      label: "Tendik",
      value: data?.stats.totalTendik ?? 0,
      hint: "Tenaga kependidikan",
      icon: "badge",
      to: "/admin/students?role=Tendik",
    },
    {
      label: "Rombel",
      value: data?.stats.totalClasses ?? 0,
      hint: "Rombongan belajar / kelas",
      icon: "class",
      to: "/admin/classes",
    },
  ];

  const secondaryStats = [
    {
      label: "Alumni",
      value: data?.stats.totalAlumni ?? 0,
      hint: "Status lulus",
      icon: "workspace_premium",
      to: "/admin/alumni",
    },
    {
      label: "Keluar / mutasi",
      value: data?.stats.totalKeluar ?? 0,
      hint: "Tidak aktif akademik",
      icon: "person_off",
      to: "/admin/keluar",
    },
  ];

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Administrasi"
        title="Dashboard"
        description="Ringkasan operasional akademik. Autentikasi dan master identitas melalui Kredensia; pengelolaan nilai, tahun ajar, dan rekap di SIAKAD."
        action={
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/students">
              <Button variant="secondary" size="sm">
                Data siswa
              </Button>
            </Link>
            <Link to="/admin/classes">
              <Button variant="secondary" size="sm">
                Data rombel
              </Button>
            </Link>
            <Link to="/admin/integrations">
              <Button size="sm">Integrasi</Button>
            </Link>
          </div>
        }
      />

      {/* Quick access — professional strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2.5">
        {quickLinks.map((q) => (
          <Link
            key={q.to}
            to={q.to}
            className="app-card flex items-center gap-3 px-3.5 py-3 transition-shadow duration-200 hover:shadow-[var(--shadow-lg)]"
          >
            <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
              <span className="material-symbols-outlined text-[20px]">{q.icon}</span>
            </span>
            <span className="text-[13px] font-semibold text-[var(--fg)]">{q.label}</span>
          </Link>
        ))}
      </div>

      {/* Primary metrics */}
      <section className="space-y-3">
        <h2 className="app-label">Indikator utama</h2>
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-3 md:gap-4">
          {primaryStats.map((s) => {
            const card = (
              <StatCard
                label={s.label}
                value={loading ? "—" : s.value}
                hint={s.hint}
                icon={s.icon}
                loading={loading}
              />
            );
            return s.to ? (
              <Link key={s.label} to={s.to} className="block focus:outline-none">
                {card}
              </Link>
            ) : (
              <div key={s.label}>{card}</div>
            );
          })}
        </div>
      </section>

      {/* Secondary metrics — less visual weight */}
      <section className="space-y-3">
        <h2 className="app-label">Status lanjutan</h2>
        <div className="grid grid-cols-2 gap-3 md:gap-4 max-w-2xl">
          {secondaryStats.map((s) => {
            const card = (
              <StatCard
                label={s.label}
                value={loading ? "—" : s.value}
                hint={s.hint}
                icon={s.icon}
                loading={loading}
              />
            );
            return s.to ? (
              <Link key={s.label} to={s.to} className="block focus:outline-none">
                {card}
              </Link>
            ) : (
              <div key={s.label}>{card}</div>
            );
          })}
        </div>
      </section>

      {/* Layanan terhubung */}
      <Card>
        <CardHeader
          title="Layanan terhubung"
          subtitle="Status integrasi eksternal"
          action={
            <Link
              to="/admin/integrations"
              className="text-xs font-semibold text-[var(--accent)] hover:underline"
            >
              Kelola
            </Link>
          }
        />
        <div className="p-4 grid md:grid-cols-3 gap-3">
          {[
            {
              icon: "key",
              title: "Kredensia SSO",
              desc: "Autentikasi & identitas",
              status: "Live",
            },
            {
              icon: "stars",
              title: "GDS",
              desc: "Poin kedisiplinan",
              status: "Coming soon",
            },
            {
              icon: "event_available",
              title: "Kehadiran Siswa",
              desc: "Rekap sakit / izin / alpa",
              status: "Coming soon",
            },
          ].map((item) => (
            <div
              key={item.title}
              className="flex items-center gap-3 rounded-xl px-3 py-3"
              style={{ background: "var(--hover)" }}
            >
              <span className="w-9 h-9 rounded-lg flex items-center justify-center bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
                <span className="material-symbols-outlined text-[18px]">{item.icon}</span>
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[13px] font-semibold">{item.title}</div>
                <div className="text-[11px] app-muted truncate">{item.desc}</div>
              </div>
              <Badge status={item.status === "Live" ? "success" : "pending"}>
                {item.status}
              </Badge>
            </div>
          ))}
        </div>
      </Card>

      {data?.roles?.length ? (
        <Card className="p-5 md:p-6">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-4">
            <div>
              <h2 className="font-display font-bold text-base md:text-lg">Pemetaan peran</h2>
              <p className="text-sm app-muted mt-0.5">
                Kode RBAC SIAKAD yang dipetakan dari peran Kredensia.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.roles.map((r) => (
              <span
                key={r.code}
                className="inline-flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium border"
                style={{
                  borderColor: "var(--divider)",
                  background: "var(--hover)",
                }}
                title={r.category}
              >
                <span className="font-mono text-[11px] font-semibold text-[var(--accent)]">
                  {r.code}
                </span>
                <span className="app-muted">{r.name}</span>
                {!r.canLogin && (
                  <span className="text-error text-[10px] font-semibold">no-login</span>
                )}
              </span>
            ))}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
