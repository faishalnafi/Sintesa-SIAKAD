import { useSystemStore } from "@/store/system";

export function UpdateNoticeModal() {
  const { showNoticeModal, versionInfo, acknowledgeUpdate } = useSystemStore();

  if (!showNoticeModal || !versionInfo) return null;

  const changelist = Array.isArray(versionInfo.changelog)
    ? versionInfo.changelog
    : typeof versionInfo.changelog === "string"
    ? (versionInfo.changelog as string).split("\n").filter(Boolean)
    : ["Pembaruan stabilitas dan fitur baru."];

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-center justify-center p-4 sm:p-6 bg-slate-950/90 backdrop-blur-md animate-fadeIn"
      role="dialog"
      aria-modal="true"
    >
      <div className="bg-slate-900 border border-slate-700/80 text-slate-100 rounded-3xl p-6 sm:p-8 max-w-lg w-full shadow-2xl space-y-6 relative overflow-hidden">
        {/* Top subtle glow header accent */}
        <div className="absolute -top-20 -right-20 w-48 h-48 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        {/* Modal Header */}
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 pb-5">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-emerald-400 text-[28px]">
                verified
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                  v{versionInfo.currentVersion}
                </span>
                {versionInfo.forceUpdate && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 uppercase tracking-wider border border-rose-500/30">
                    Mandatory
                  </span>
                )}
              </div>
              <h3 className="text-lg font-bold font-display text-white mt-1 tracking-tight">
                {versionInfo.title || "Aplikasi Berhasil Diperbarui"}
              </h3>
            </div>
          </div>
        </div>

        {/* Changelog Section (Solid Dark Background for Max Readability) */}
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs font-medium text-slate-400">
            <span>Rincian Perubahan (Changelog SiCare):</span>
            <span className="text-slate-400 font-mono">{versionInfo.releaseDate || "Terbaru"}</span>
          </div>

          <div className="max-h-60 overflow-y-auto rounded-2xl bg-slate-950/80 border border-slate-800 p-4 space-y-3">
            {changelist.map((item, idx) => (
              <div key={idx} className="flex items-start gap-2.5 text-xs text-slate-200">
                <span className="material-symbols-outlined text-emerald-400 text-base mt-0.5 shrink-0">
                  check_circle
                </span>
                <span className="leading-relaxed font-normal">{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Action Notice Box */}
        <div className="p-4 rounded-2xl bg-amber-950/40 border border-amber-500/30 text-xs text-amber-200 flex items-start gap-2.5">
          <span className="material-symbols-outlined text-amber-400 text-base shrink-0 mt-0.5">
            autorenew
          </span>
          <p className="leading-relaxed">
            Menekan tombol <strong className="text-amber-300">OK</strong> di bawah akan membersihkan cache browser, memperbarui berkas sesi, dan memuat ulang halaman secara penuh.
          </p>
        </div>

        {/* Action Button */}
        <button
          type="button"
          onClick={acknowledgeUpdate}
          className="w-full py-3.5 px-5 rounded-2xl bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white font-semibold text-sm transition-all duration-200 shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer"
        >
          <span>OK, Selesaikan &amp; Perbarui Sesi</span>
          <span className="material-symbols-outlined text-base">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}
