import { useThemeStore, type ThemePreference } from "@/store/theme";
import { cn } from "@/lib/cn";

const cycle: ThemePreference[] = ["light", "dark", "system"];

const icon: Record<ThemePreference, string> = {
  light: "light_mode",
  dark: "dark_mode",
  system: "contrast",
};

export function ThemeToggle({ className, floating }: { className?: string; floating?: boolean }) {
  const { preference, setPreference } = useThemeStore();

  const next = () => {
    const idx = cycle.indexOf(preference);
    setPreference(cycle[(idx + 1) % cycle.length]);
  };

  return (
    <button
      type="button"
      onClick={next}
      title={`Tema: ${preference}`}
      className={cn(
        "w-12 h-12 rounded-full border flex items-center justify-center transition-transform duration-300 hover:rotate-12 active:scale-90",
        floating && "fixed top-8 right-8 z-50 shadow-[var(--shadow)]",
        className,
      )}
      style={{
        background: "var(--card)",
        borderColor: "var(--input-border)",
        color: "var(--accent)",
      }}
    >
      <span className="material-symbols-outlined">{icon[preference]}</span>
    </button>
  );
}
