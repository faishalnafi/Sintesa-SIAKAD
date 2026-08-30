import type { ReactNode } from "react";

type Props = {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
};

/** Stitch hierarchy: small label + Plus Jakarta title + Inter body */
export function PageHeader({ eyebrow, title, description, action }: Props) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-1">
      <div className="min-w-0 space-y-1.5">
        {eyebrow ? <p className="app-label">{eyebrow}</p> : null}
        <h1 className="font-display text-2xl md:text-[28px] font-bold text-[var(--fg)] tracking-tight">
          {title}
        </h1>
        {description ? (
          <p className="text-sm app-muted leading-relaxed max-w-2xl">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
