import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label": string;
  disabled?: boolean;
  className?: string;
}

/** Spec ON toggle: 28×16 track, 12px knob, no label inside. */
export function Switch({
  checked,
  onCheckedChange,
  "aria-label": ariaLabel,
  disabled,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      className={cn(
        "relative h-4 w-7 shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-hms-accent" : "bg-toggle-off",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 size-3 rounded-full bg-white shadow-[0_1px_2px_rgba(4,61,93,0.3)] transition-[left]",
          checked ? "left-3.5" : "left-0.5",
        )}
      />
    </button>
  );
}
