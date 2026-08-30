import { cn } from "@/lib/cn";
import type { HTMLAttributes } from "react";

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("app-card", className)} {...props} />;
}

export function CardHeader({
  title,
  subtitle,
  action,
  className,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "px-5 py-4 flex items-start justify-between gap-3 border-b app-divider",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="font-display font-bold text-base md:text-lg text-[var(--fg)]">{title}</h2>
        {subtitle ? <p className="text-xs app-muted mt-0.5 leading-relaxed">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}
