import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";

type Props = {
  label: string;
  value: string | number;
  hint?: string;
  icon?: string;
  loading?: boolean;
};

export function StatCard({ label, value, hint, icon, loading }: Props) {
  if (loading) {
    return (
      <Card className="p-4 md:p-5">
        <Skeleton className="h-[88px] w-full" />
      </Card>
    );
  }

  return (
    <Card className="p-4 md:p-5 transition-shadow duration-200 hover:shadow-[var(--shadow-lg)]">
      <div className="flex items-start justify-between gap-3 mb-3">
        <p className="app-label leading-snug">{label}</p>
        {icon ? (
          <span className="w-8 h-8 rounded-lg flex items-center justify-center bg-[var(--accent-soft)] text-[var(--accent)] shrink-0">
            <span className="material-symbols-outlined text-[18px]">{icon}</span>
          </span>
        ) : null}
      </div>
      <div className="app-stat-value text-[26px] md:text-[28px] leading-none tabular-nums">
        {value}
      </div>
      {hint ? <p className="text-[11px] app-muted mt-2.5 leading-snug">{hint}</p> : null}
    </Card>
  );
}
