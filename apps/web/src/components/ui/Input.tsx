import { cn } from "@/lib/cn";
import type { InputHTMLAttributes } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label?: string;
  leftIcon?: string;
  rightSlot?: React.ReactNode;
};

export function Input({ className, label, leftIcon, rightSlot, id, ...props }: Props) {
  const inputId = id || props.name;
  return (
    <div className="space-y-2">
      {label && (
        <label
          htmlFor={inputId}
          className="block ml-1 text-sm font-semibold tracking-wide app-muted"
        >
          {label}
        </label>
      )}
      <div className="relative group">
        {leftIcon && (
          <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
            <span className="material-symbols-outlined text-[20px] app-muted group-focus-within:text-primary-container transition-colors">
              {leftIcon}
            </span>
          </div>
        )}
        <input
          id={inputId}
          className={cn(
            "app-input w-full rounded-2xl py-4 font-normal transition-all",
            leftIcon ? "pl-12" : "pl-4",
            rightSlot ? "pr-12" : "pr-4",
            className,
          )}
          {...props}
        />
        {rightSlot && (
          <div className="absolute inset-y-0 right-0 pr-4 flex items-center">{rightSlot}</div>
        )}
      </div>
    </div>
  );
}
