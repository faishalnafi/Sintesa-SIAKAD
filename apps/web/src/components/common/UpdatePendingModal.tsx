import { useEffect, useRef } from "react";
import { useSystemStore } from "@/store/system";

export function UpdatePendingModal() {
  const { isUpdating, updateMessage, fetchVersionInfo } = useSystemStore();
  const consecutiveFailsRef = useRef(0);

  useEffect(() => {
    if (!isUpdating) return;

    const interval = setInterval(async () => {
      try {
        await fetchVersionInfo();
        consecutiveFailsRef.current = 0;
      } catch {
        consecutiveFailsRef.current++;
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [isUpdating, fetchVersionInfo]);

  if (!isUpdating) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4 sm:p-6 bg-slate-950/90 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-900 border border-slate-700/80 text-slate-100 rounded-3xl p-6 sm:p-8 max-w-md w-full text-center shadow-2xl space-y-6 relative overflow-hidden">
        {/* Top glowing ambient gradient */}
        <div className="absolute -top-16 -left-16 w-36 h-36 bg-amber-500/10 rounded-full blur-2xl pointer-events-none" />

        <div className="relative flex justify-center">
          <div className="w-20 h-20 rounded-2xl bg-amber-500/20 border border-amber-500/30 flex items-center justify-center relative">
            <span className="material-symbols-outlined text-[40px] text-amber-400 animate-spin">
              sync
            </span>
            <div className="absolute -top-1 -right-1 w-4 h-4 bg-amber-400 rounded-full animate-ping" />
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xl font-bold font-display text-white tracking-tight">
            Sistem Sedang Update
          </h3>
          <p className="text-sm text-slate-300 leading-relaxed">
            {updateMessage ||
              "Superadmin sedang menjalankan proses pembaruan sistem. Harap tunggu beberapa saat..."}
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-slate-950/80 border border-slate-800 text-xs text-slate-300 space-y-2 text-left">
          <div className="flex items-center gap-2 text-amber-400 font-semibold">
            <span className="material-symbols-outlined text-base">info</span>
            <span>Informasi Penting</span>
          </div>
          <p className="leading-relaxed">
            Seluruh transaksi data (CRUD) dihentikan sementara agar pengkinian skema dan berkas sistem berjalan dengan aman tanpa risiko konflik data.
          </p>
          <p className="text-[11px] mt-1 text-slate-400">
            Halaman akan otomatis dimuat ulang setelah server selesai melakukan pembaharuan.
          </p>
        </div>

        <div className="pt-2 flex items-center justify-center gap-2 text-xs text-slate-400 font-medium">
          <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
          <span>Memeriksa status pembaruan secara berkala...</span>
        </div>
      </div>
    </div>
  );
}
