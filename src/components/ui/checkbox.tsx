import * as React from "react";
import { cn } from "@/lib/utils";

export interface CheckboxProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> {
  /** Header "some selected" state: filled with a dash, exposed as aria mixed. */
  indeterminate?: boolean;
}

/**
 * V13 checkbox (direction A): 16 px box inside a 28 px hit area. The hit area
 * uses negative margins, so the control still lays out as a 16 px element.
 * Checked/mixed/disabled styling follows the controlled props.
 */
const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, indeterminate = false, checked, disabled, ...props }, ref) => {
    const innerRef = React.useRef<HTMLInputElement>(null);
    React.useImperativeHandle(ref, () => innerRef.current as HTMLInputElement);
    React.useEffect(() => {
      if (innerRef.current) innerRef.current.indeterminate = indeterminate;
    }, [indeterminate]);

    const on = indeterminate || !!checked;
    return (
      <span
        className={cn(
          "relative -m-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md has-[:focus-visible]:shadow-[0_0_0_2px_rgba(18,104,179,.45)]",
          !disabled && "hover:bg-[rgba(0,48,87,.06)]",
          className,
        )}
      >
        <input
          type="checkbox"
          ref={innerRef}
          checked={checked}
          disabled={disabled}
          className={cn(
            "peer absolute inset-0 m-0 size-full appearance-none rounded-md opacity-0 outline-none",
            disabled ? "cursor-not-allowed" : "cursor-pointer",
          )}
          {...props}
        />
        <span
          aria-hidden
          className={cn(
            "pointer-events-none flex size-4 items-center justify-center rounded-[4px] border text-white transition-colors",
            disabled
              ? on
                ? "border-[#9DC0E0] bg-[#9DC0E0]"
                : "border-[#D5DADE] bg-[#F5F6F7]"
              : on
                ? "border-hms-accent bg-hms-accent"
                : "border-[#A9B3BA] bg-white peer-hover:border-[#7F8B94]",
          )}
        >
          {on && (
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              {indeterminate ? (
                <path d="M3 6h6" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />
              ) : (
                <path
                  d="M2.5 6.2l2.3 2.3 4.7-4.9"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </svg>
          )}
        </span>
      </span>
    );
  },
);
Checkbox.displayName = "Checkbox";

export { Checkbox };
