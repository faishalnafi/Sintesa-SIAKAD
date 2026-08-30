import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/cn";
import { PAGE_SIZE } from "@/lib/pagination";

type Props = {
  page: number;
  totalPages: number;
  total: number;
  from: number;
  to: number;
  pageSize?: number;
  onPageChange: (page: number) => void;
  className?: string;
};

/**
 * Footer pagination: 1 tampilan = maksimal `pageSize` data (default 10).
 * Jumlah halaman tidak dibatasi (bisa 1, 2, 20, … sesuai total data).
 */
export function Pagination({
  page,
  totalPages,
  total,
  from,
  to,
  pageSize = PAGE_SIZE,
  onPageChange,
  className,
}: Props) {
  if (total === 0) return null;

  const canPrev = page > 1;
  const canNext = page < totalPages;

  return (
    <div
      className={cn(
        "flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 py-3 border-t app-divider",
        className,
      )}
    >
      <p className="text-xs app-muted tabular-nums leading-relaxed">
        <span className="font-semibold text-[var(--fg)]">{from}–{to}</span>
        {" dari "}
        <span className="font-semibold text-[var(--fg)]">{total}</span>
        {" data"}
        <span className="hidden sm:inline">
          {" · "}
          <span className="font-medium text-[var(--fg)]">{pageSize} data</span>
          {" per halaman"}
        </span>
      </p>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canPrev}
          onClick={() => onPageChange(page - 1)}
          aria-label="Halaman sebelumnya"
        >
          <span className="material-symbols-outlined text-[18px]">chevron_left</span>
          Prev
        </Button>

        <span className="text-xs sm:text-sm font-semibold tabular-nums px-2 min-w-[7.5rem] text-center text-[var(--fg)]">
          Hal. {page} / {totalPages}
        </span>

        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!canNext}
          onClick={() => onPageChange(page + 1)}
          aria-label="Halaman berikutnya"
        >
          Next
          <span className="material-symbols-outlined text-[18px]">chevron_right</span>
        </Button>
      </div>
    </div>
  );
}
