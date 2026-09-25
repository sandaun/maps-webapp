import * as React from "react";
import { cn } from "@/lib/utils";

export type RadioProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, "type">;

/**
 * Radio in the V13 checkbox family (direction A): 16 px circle inside a 28 px
 * hit area, same borders, hover, focus and disabled tones as `Checkbox`;
 * checked fills accent blue with a white dot. Styling follows the controlled props.
 */
const Radio = React.forwardRef<HTMLInputElement, RadioProps>(({ className, checked, disabled, ...props }, ref) => (
  <span
    className={cn(
      "relative -m-1.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full has-[:focus-visible]:shadow-[0_0_0_2px_rgba(18,104,179,.45)]",
      !disabled && "hover:bg-[rgba(0,48,87,.06)]",
      className,
    )}
  >
    <input
      type="radio"
      ref={ref}
      checked={checked}
      disabled={disabled}
      className={cn(
        "peer absolute inset-0 m-0 size-full appearance-none rounded-full opacity-0 outline-none",
        disabled ? "cursor-not-allowed" : "cursor-pointer",
      )}
      {...props}
    />
    <span
      aria-hidden
      className={cn(
        "pointer-events-none flex size-4 items-center justify-center rounded-full border transition-colors",
        disabled
          ? checked
            ? "border-[#9DC0E0] bg-[#9DC0E0]"
            : "border-[#D5DADE] bg-[#F5F6F7]"
          : checked
            ? "border-hms-accent bg-hms-accent"
            : "border-[#A9B3BA] bg-white peer-hover:border-[#7F8B94]",
      )}
    >
      {checked && <span className="size-1.5 rounded-full bg-white" />}
    </span>
  </span>
));
Radio.displayName = "Radio";

export { Radio };
