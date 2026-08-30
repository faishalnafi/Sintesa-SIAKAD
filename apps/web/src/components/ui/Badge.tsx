import { cn } from "@/lib/cn";

const styles: Record<string, string> = {
  draft:
    "bg-slate-200 text-slate-800 dark:bg-slate-700 dark:text-slate-100",
  submitted:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
  approved:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200",
  pending:
    "bg-sky-100 text-sky-900 dark:bg-sky-500/20 dark:text-sky-200",
  ready:
    "bg-indigo-100 text-indigo-900 dark:bg-indigo-500/20 dark:text-indigo-200",
  incomplete:
    "bg-rose-100 text-rose-900 dark:bg-rose-500/20 dark:text-rose-200",
  success:
    "bg-emerald-100 text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200",
  partial:
    "bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-200",
};

export function Badge({
  status,
  children,
  className,
}: {
  status?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const key = (status || "").toLowerCase();
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-semibold",
        styles[key] || styles.pending,
        className,
      )}
    >
      {children}
    </span>
  );
}
