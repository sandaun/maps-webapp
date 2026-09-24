import * as React from "react";
import { cn } from "@/lib/utils";

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label": string;
  disabled?: boolean;
  /**
   * Temporarily unavailable (e.g. its own value is being saved): announced as
   * disabled but stays focusable, so keyboard users keep their place.
   */
  busy?: boolean;
  /** `sm` = 28×16 spec toggle (tree rows) · `lg` = 34×19 V11 card-field toggle. */
  size?: "sm" | "lg";
  title?: string;
  className?: string;
}

/** Spec ON toggle: 28×16 track, 12px knob, no label inside. */
export function Switch({
  checked,
  onCheckedChange,
  "aria-label": ariaLabel,
  disabled,
  busy,
  size = "sm",
  title,
  className,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-disabled={busy || undefined}
      aria-busy={busy || undefined}
      disabled={disabled}
      title={title}
      className={cn(
        "relative shrink-0 rounded-full transition-colors disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-progress aria-disabled:opacity-50",
        size === "lg" ? "h-[19px] w-[34px]" : "h-4 w-7",
        checked ? "bg-hms-accent" : "bg-toggle-off",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        if (!busy) onCheckedChange(!checked);
      }}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 rounded-full bg-white shadow-[0_1px_2px_rgba(4,61,93,0.3)] transition-[left]",
          size === "lg"
            ? cn("size-[15px]", checked ? "left-[17px]" : "left-0.5")
            : cn("size-3", checked ? "left-3.5" : "left-0.5"),
        )}
      />
    </button>
  );
}
