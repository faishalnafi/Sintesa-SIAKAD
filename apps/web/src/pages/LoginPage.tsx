import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { homeForRoles, useAuthStore } from "@/store/auth";
import { ssoLoginUrl, googleLoginUrl } from "@/lib/api";
import { ParticleCanvas } from "@/components/common/ParticleCanvas";

const errorMessages: Record<string, string> = {
  missing_token: "Token SSO tidak ditemukan dari callback IdP.",
  invalid_state: "State tidak valid. Coba login ulang.",
  no_role: "Akun tidak memiliki peran yang dikenali di SIAKAD. Hubungi admin untuk mendapatkan akses.",
  user_missing: "Gagal memuat profil pengguna setelah login.",
  account_inactive: "Akun dinonaktifkan. Hubungi admin.",
  sso_failed:
    "Login SSO gagal. Biasanya SSO_JWT_SECRET di apps/api/.env belum sama dengan JWT_SECRET server Kredensia (bukan client_secret).",
  not_configured:
    "SSO belum dikonfigurasi di apps/api/.env (SSO_BASE_URL, SSO_CLIENT_ID, SSO_REDIRECT_URI, SSO_JWT_SECRET).",
  // Google OAuth errors
  google_denied: "Login dibatalkan. Silakan coba lagi.",
  google_no_code: "Respons Google tidak valid. Coba lagi.",
  google_unverified: "Email Google belum diverifikasi. Verifikasi email Anda di Google terlebih dahulu.",
  google_failed: "Login Google gagal.",
};

export function LoginPage() {
  const [error, setError] = useState<string | null>(null);
  const { user, bootstrapped } = useAuthStore();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  useEffect(() => {
    const err = params.get("error");
    const sso = params.get("sso");
    const reason = params.get("reason");
    if (err && errorMessages[err]) {
      setError(reason ? `${errorMessages[err]} Detail: ${reason}` : errorMessages[err]);
    }
    if (sso && errorMessages[sso]) setError(errorMessages[sso]);
  }, [params]);

  // Handle BFCache (Back-Forward Cache): Jika user menekan tombol Back (<-) pada browser,
  // paksa halaman me-reload agar tidak menampilkan form login basi saat sesi masih aktif.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) {
        window.location.reload();
      }
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => window.removeEventListener("pageshow", handlePageShow);
  }, []);

  useEffect(() => {
    if (bootstrapped && user) {
      navigate(homeForRoles(user.roles), { replace: true });
    }
  }, [bootstrapped, user, navigate]);

  if (!bootstrapped) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background dark:bg-[#020617]">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 border-4 border-[#0F91FC] border-t-transparent rounded-full animate-spin"></div>
          <span className="text-xs text-on-surface-variant font-medium animate-pulse">Menghubungkan ke sistem...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen w-full relative flex flex-col lg:flex-row overflow-x-hidden transition-colors duration-300 select-none">
      {/* BACKGROUND SPLIT LAYER: Left White, Right SSO Blue */}
      <div className="absolute inset-0 flex flex-col lg:flex-row pointer-events-none z-0">
        <div className="w-full lg:w-1/2 min-h-screen bg-surface dark:bg-[#090d16] lg:border-r border-outline-variant/20" />
        <div className="hidden lg:block lg:w-1/2 min-h-screen bg-[#0F91FC] dark:bg-[#020617]" />
      </div>

      {/* FULL VIEWPORT INTERACTIVE PARTICLE CANVAS LAYER (Spans whole screen with automatic color change) */}
      <ParticleCanvas className="z-0" />

      {/* LEFT SIDE: Authentic Login Section (Form & Actions) */}
      <div className="relative z-10 w-full lg:w-1/2 shrink-0 min-h-screen flex flex-col justify-between p-6 sm:p-10 md:p-12 pointer-events-none">
        {/* Top Header / Branding */}
        <div className="flex items-center gap-3 pointer-events-auto">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-[#0F91FC]/10 dark:bg-[#0F91FC]/20 border border-[#0F91FC]/20">
            <span className="material-symbols-outlined text-[#0F91FC] text-[24px] fill">school</span>
          </div>
          <div>
            <span className="font-display font-bold text-xl text-[#0F91FC] dark:text-[#0F91FC] tracking-tight">SIAKAD</span>
            <span className="text-[10px] block text-on-surface-variant/70 leading-none">SMAN 3 MOJOKERTO</span>
          </div>
        </div>

        {/* Center Main Login Form */}
        <div className="my-auto py-8 max-w-[400px] w-full mx-auto text-center pointer-events-auto">
          <div className="space-y-2.5 mb-8">
            <h1 className="font-display text-3xl font-extrabold tracking-tight">Masuk ke Sistem</h1>
            <p className="text-sm text-on-surface-variant">Pilih salah satu metode autentikasi SSO di bawah ini untuk mengakses dashboard Anda.</p>
          </div>

          {error && (
            <div className="mb-6 rounded-2xl bg-error-container text-on-error-container px-4 py-3 text-sm leading-relaxed text-left shadow-sm">
              {error}
            </div>
          )}

          <div className="space-y-4">
            {/* Button 1: Masuk dengan Kredensia SSO */}
            <a
              href={ssoLoginUrl()}
              className="group relative w-full flex items-center justify-center gap-3 bg-[#0F91FC] text-white hover:bg-[#0F91FC]/90 active:scale-[0.98] transition-all py-4 px-5 rounded-2xl shadow-md font-semibold text-sm cursor-pointer"
            >
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-white/20">
                <span className="material-symbols-outlined text-white text-[20px] fill">key</span>
              </div>
              <span>Masuk dengan Kredensia SSO</span>
            </a>

            {/* Button 2: Masuk dengan Google */}
            <a
              href={googleLoginUrl()}
              id="btn-google-login"
              className="group w-full flex items-center justify-center gap-3 bg-surface-container-lowest/90 dark:bg-white/5 border border-outline-variant/40 hover:border-[#0F91FC]/50 hover:bg-[#0F91FC]/5 active:scale-[0.98] transition-all py-4 px-5 rounded-2xl text-sm font-medium cursor-pointer shadow-sm"
            >
              <svg className="w-5 h-5 flex-shrink-0" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                />
              </svg>
              <span>Masuk dengan Google</span>
            </a>
          </div>

          {/* Institutional support & alternative links */}
          <div className="mt-8 pt-6 border-t border-outline-variant/10 text-sm text-on-surface-variant">
            <div className="flex items-center justify-center gap-2.5">
              <span className="material-symbols-outlined text-[18px] text-[#0F91FC]">help</span>
              <span>Butuh bantuan akun? <a href="#" className="text-[#0F91FC] hover:underline font-semibold">Hubungi Admin</a></span>
            </div>
          </div>
        </div>

        {/* Footer info (Terms / Copyright) */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 text-[11px] text-on-surface-variant/60 pointer-events-auto">
          <div className="flex gap-4">
            <a href="#" className="hover:text-[#0F91FC] hover:underline">Bantuan</a>
            <a href="#" className="hover:text-[#0F91FC] hover:underline">Kebijakan Privasi</a>
          </div>
          <div>© {new Date().getFullYear()} SIAKAD · SMAN 3 Mojokerto.</div>
        </div>
      </div>

      {/* RIGHT SIDE: Academic Blue Hero Panel with Particle.js Constellation Effect (Hidden on mobile/tablet) */}
      <div className="hidden lg:flex lg:w-1/2 flex-grow relative z-10 items-center justify-center p-16 text-white pointer-events-none">
        {/* Content Section Overlay: Rata Kiri, Sentris Vertikal */}
        <div className="max-w-[480px] w-full text-left space-y-6">
          <div className="space-y-3">
            <h2 className="font-display text-3xl sm:text-4xl font-extrabold tracking-tight drop-shadow-sm leading-tight">
              Belum Melakukan Aktivasi Akun?
            </h2>
            <p className="text-sm text-white/95 leading-relaxed font-light drop-shadow-sm">
              Silakan lakukan verifikasi identitas resmi Anda untuk mengaktifkan kredensial Single Sign-On (SSO) agar dapat mengakses sistem informasi akademik terpadu SMAN 3 Mojokerto.
            </p>
          </div>

          <div className="pt-2 flex justify-start">
            <a
              href="https://sso.sman3mjk.sch.id/otentikasi#verifikasi"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 bg-white text-[#0F91FC] hover:bg-white/95 active:scale-[0.98] transition-all py-3.5 px-6 rounded-2xl font-bold text-sm shadow-lg pointer-events-auto cursor-pointer"
            >
              <span>Aktivasi Akun Sekarang</span>
              <span className="material-symbols-outlined text-[18px] fill">open_in_new</span>
            </a>
          </div>

          <div className="pt-8 border-t border-white/20 flex items-center justify-start gap-2 text-xs text-white/70 drop-shadow-sm">
            <span className="material-symbols-outlined text-[16px] text-white/90">verified_user</span>
            <span>Autentikasi terenkripsi via Kredensia Single Sign-On (SSO)</span>
          </div>
        </div>
      </div>
    </div>
  );
}

