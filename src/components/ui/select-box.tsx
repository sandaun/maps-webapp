import * as React from "react";
import { cn } from "@/lib/utils";

export interface SelectBoxProps {
  checked: boolean;
  /** Header "some selected" state — filled like checked, exposed as aria mixed. */
  indeterminate?: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label": string;
  className?: string;
}

/**
 * Spec selection control: 13×13 rounded square that fills accent blue, no tick.
 * Used to multi-select signal rows; not the Active/ON toggle.
 */
export function SelectBox({
  checked,
  indeterminate = false,
  onCheckedChange,
  "aria-label": ariaLabel,
  className,
}: SelectBoxProps) {
  const filled = checked || indeterminate;
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? "mixed" : checked}
      aria-label={ariaLabel}
      className={cn(
        "size-[13px] shrink-0 rounded-[2px] border-[1.5px] transition-colors",
        filled ? "border-hms-accent bg-hms-accent" : "border-border-strong bg-white",
        className,
      )}
      onClick={(e) => {
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
    />
  );
}
