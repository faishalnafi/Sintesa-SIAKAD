import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md" | "lg";
};

export function Button({
  className,
  variant = "primary",
  size = "md",
  children,
  ...props
}: Props) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 font-display font-semibold whitespace-nowrap transition-all duration-300 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none",
        size === "sm" && "px-3.5 py-2 text-sm rounded-lg min-h-[40px]",
        size === "md" && "px-4 py-2.5 text-sm rounded-lg min-h-[44px]",
        size === "lg" && "px-5 py-3.5 text-base rounded-2xl min-h-[52px]",
        variant === "primary" &&
          "bg-[var(--accent)] text-white shadow-[0_8px_20px_rgba(14,165,233,0.28)] hover:brightness-105",
        variant === "secondary" &&
          "border border-[var(--accent)]/25 text-[var(--accent)] bg-transparent hover:bg-[var(--accent-soft)]",
        variant === "ghost" &&
          "text-[var(--muted)] hover:bg-[var(--hover)] hover:text-[var(--fg)] rounded-lg",
        variant === "danger" && "bg-error text-on-error hover:brightness-105 rounded-lg",
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
