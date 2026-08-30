import { useThemeStore } from "@/store/theme";
import { cn } from "@/lib/cn";

export function ThemeToggle({ className }: { className?: string; floating?: boolean }) {
  const { preference, setPreference } = useThemeStore();

  return (
    <div
      className={cn(
        "bg-slate-100 dark:bg-slate-800 border border-slate-200/80 dark:border-slate-700/80 p-1 flex items-center gap-0.5 rounded-full shadow-2xs",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setPreference("light")}
        title="Mode Terang (Light)"
        aria-label="Mode Terang"
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150",
          preference === "light"
            ? "bg-white dark:bg-slate-700 text-[#0f91fc] shadow-xs font-bold"
            : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200",
        )}
      >
        <span className="material-symbols-outlined text-[16px]">light_mode</span>
      </button>

      <button
        type="button"
        onClick={() => setPreference("system")}
        title="Mengikuti Sistem (System)"
        aria-label="Mengikuti Sistem"
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150",
          preference === "system"
            ? "bg-white dark:bg-slate-700 text-[#0f91fc] shadow-xs font-bold"
            : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200",
        )}
      >
        <span className="material-symbols-outlined text-[16px]">desktop_windows</span>
      </button>

      <button
        type="button"
        onClick={() => setPreference("dark")}
        title="Mode Gelap (Dark)"
        aria-label="Mode Gelap"
        className={cn(
          "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-150",
          preference === "dark"
            ? "bg-white dark:bg-slate-700 text-[#0f91fc] shadow-xs font-bold"
            : "text-slate-400 hover:text-slate-600 dark:hover:text-slate-200",
        )}
      >
        <span className="material-symbols-outlined text-[16px]">dark_mode</span>
      </button>
    </div>
  );
}
